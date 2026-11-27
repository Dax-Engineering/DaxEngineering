import { randomBytes } from 'node:crypto';
import {
  AuditService,
  type Policy,
  type RequestContext,
} from '@dax/platform-core';
import { PrismaService } from '@dax/platform-db';
import { ITEM_CSV_COLUMNS, normalizePartNo } from '@dax/inventory-contract';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INVENTORY_ENTITIES } from './entities';
import { ItemsService } from './items.service';
import { MainStore } from './main-store.service';
import { fakePolicy } from './testing';

const url = process.env['TEST_DATABASE_URL'];
const ACTOR = '00000000-0000-0000-0000-000000000001';

describe.skipIf(!url)('items against Postgres', { timeout: 30_000 }, () => {
  let prisma: PrismaService;
  let items: ItemsService;
  let brandName: string;
  let itemId: string;
  let otherPartNo: string;
  const suffix = randomBytes(4).toString('hex').toUpperCase();
  const token = () => randomBytes(8).toString('hex').slice(0, 12);
  const code = () => `77${randomBytes(5).readUIntBE(0, 5)}`;
  const policy: Policy = {
    ...fakePolicy([
      'inventory.item.view',
      'inventory.item.edit',
      'inventory.item.import',
    ]),
    userId: ACTOR,
  };
  const csv = (...rows: string[]) =>
    [ITEM_CSV_COLUMNS.join(','), ...rows].join('\n');

  beforeAll(async () => {
    prisma = new PrismaService({
      url: url as string,
      applicationName: 'dax-test',
    });
    const context = { get: () => ({}) } as unknown as RequestContext;
    const audit = new AuditService(prisma, context, [...INVENTORY_ENTITIES]);
    items = new ItemsService(prisma, audit, new MainStore(prisma));
    brandName = `Items ${suffix}`;
    const brand = await prisma.brand.create({ data: { name: brandName } });
    const make = (partNo: string, description: string) =>
      prisma.item.create({
        data: {
          partNo,
          partNoNorm: normalizePartNo(partNo),
          brandId: brand.id,
          description,
          uom: 'PCS',
          minQty: 2,
          notes: 'Keep dry',
          qrToken: token(),
          createdBy: ACTOR,
          updatedBy: ACTOR,
        },
      });
    itemId = (await make(`IT-${suffix}`, 'Fuel filter')).id;
    otherPartNo = (await make(`OT-${suffix}`, 'Oil filter')).partNo;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('adds and removes barcodes, refusing one already on another part', async () => {
    const first = code();
    const added = await items.addBarcode(policy, itemId, {
      code: first,
      kind: 'SUPPLIER',
    });
    expect(added.barcodes).toEqual([
      expect.objectContaining({ code: first, kind: 'SUPPLIER' }),
    ]);

    const other = await prisma.item.findFirstOrThrow({
      where: { partNo: otherPartNo },
    });
    await expect(
      items.addBarcode(policy, other.id, { code: first, kind: 'MANUFACTURER' }),
    ).rejects.toMatchObject({
      response: {
        code: 'BARCODE_IN_USE',
        message: `That barcode is already on another part: IT-${suffix}.`,
      },
    });
    await expect(
      items.addBarcode(policy, itemId, { code: first, kind: 'MANUFACTURER' }),
    ).rejects.toMatchObject({
      response: { message: 'This part already has that barcode.' },
    });

    const barcodeId = added.barcodes[0]?.id as string;
    const removed = await items.removeBarcode(policy, itemId, barcodeId);
    expect(removed.barcodes).toEqual([]);
    const actions = await prisma.auditLog.findMany({
      where: { entityId: itemId },
      select: { action: true },
      orderBy: { occurredAt: 'asc' },
    });
    expect(actions.map((a) => a.action)).toEqual([
      'barcode_added',
      'barcode_removed',
    ]);
  });

  it('adds new parts and updates existing ones, keeping blank cells', async () => {
    const before = await items.detail(policy, itemId);
    const newCode = code();
    const file = csv(
      `it ${suffix},${brandName},,,5,,,${newCode},,,,,2500`,
      `NEW-${suffix},${brandName},Air filter,PCS,1,,,,`,
      `OT-${suffix},${brandName},,,,,,,`,
    );

    const refused = await items.import(policy, file, true, 'add');
    expect([...new Set(refused.errors.map((e) => e.row))]).toEqual([2, 4]);

    const dry = await items.import(policy, file, true, 'upsert');
    expect(dry).toMatchObject({ errors: [], created: 1, updated: 1 });
    expect((await items.detail(policy, itemId)).version).toBe(before.version);

    const done = await items.import(policy, file, false, 'upsert');
    expect(done).toMatchObject({ errors: [], created: 1, updated: 1 });

    const after = await items.detail(policy, itemId);
    expect(after).toMatchObject({
      partNo: `IT-${suffix}`,
      description: 'Fuel filter',
      uom: 'PCS',
      minQty: '5',
      notes: 'Keep dry',
      sellingPrice: '2500.00',
      version: before.version + 1,
    });
    expect(after.barcodes.map((b) => b.code)).toEqual([newCode]);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: itemId, action: 'update' },
      orderBy: { occurredAt: 'desc' },
    });
    expect(audit.after).toMatchObject({ minQty: '5', sellingPrice: '2500' });
    expect(
      await prisma.item.count({ where: { partNo: `NEW-${suffix}` } }),
    ).toBe(1);
  });
});
