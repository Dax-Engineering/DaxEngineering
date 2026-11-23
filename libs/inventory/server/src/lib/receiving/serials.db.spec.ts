import { randomBytes, randomUUID } from 'node:crypto';
import {
  AuditService,
  EventBus,
  NumberingService,
  type RequestContext,
} from '@dax/platform-core';
import { PrismaService } from '@dax/platform-db';
import { SERIAL_PATTERN } from '@dax/inventory-contract';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INVENTORY_ENTITIES } from '../entities';
import { itemSearch } from '../item-queries';
import { LocationsService } from '../locations.service';
import { MainStore } from '../main-store.service';
import { ScanService } from '../scan.service';
import { StockPostingService } from '../stock/stock-posting.service';
import { fakePolicy } from '../testing';
import { GrnsService } from './grns.service';
import { PutawayService } from './putaway.service';
import { makeExistingSerials } from './serials';
import { SerialsService } from './serials.service';

const url = process.env['TEST_DATABASE_URL'];
const ACTOR = '00000000-0000-0000-0000-000000000001';

describe.skipIf(!url)(
  'serial numbers against Postgres',
  { timeout: 30_000 },
  () => {
    let prisma: PrismaService;
    let engine: StockPostingService;
    let grns: GrnsService;
    let putaway: PutawayService;
    let serials: SerialsService;
    let scan: ScanService;
    let supplierId: string;
    let filter: string;
    let oil: string;
    let shelf: string;
    let filterPartNo: string;
    let grnId: string;
    const policy = fakePolicy(['inventory.item.view']);

    const token = () => randomBytes(8).toString('hex').slice(0, 12);
    const letters = (n: number) =>
      [...randomBytes(n)]
        .map((b) => String.fromCharCode(65 + (b % 26)))
        .join('');
    const failure = async (promise: Promise<unknown>) => {
      try {
        await promise;
      } catch (error) {
        return error as { response?: { code?: string } };
      }
      throw new Error('Expected a failure');
    };
    const receive = async (
      lines: { itemId: string; qtyGood: string; qtyDamaged?: string }[],
    ) => {
      const draft = await grns.create(policy, { supplierId });
      const edited = await grns.update(policy, draft.id, {
        version: draft.version,
        lines: lines.map((l) => ({
          qtyDamaged: '0',
          ...l,
          wrongItem: false,
        })),
      });
      const checked = await grns.check(policy, draft.id, edited.version);
      return grns.post(policy, draft.id, checked.version);
    };

    beforeAll(async () => {
      prisma = new PrismaService({
        url: url as string,
        applicationName: 'dax-test',
      });
      const context = { get: () => ({}) } as unknown as RequestContext;
      const store = new MainStore(prisma);
      const audit = new AuditService(prisma, context, [...INVENTORY_ENTITIES]);
      engine = new StockPostingService(store, context);
      grns = new GrnsService(
        prisma,
        audit,
        new NumberingService(),
        new EventBus(),
        engine,
        store,
      );
      putaway = new PutawayService(
        prisma,
        audit,
        new EventBus(),
        engine,
        store,
      );
      serials = new SerialsService(prisma, audit);
      scan = new ScanService(prisma, store);
      await new LocationsService(prisma, audit, store).ensureSpecialAreas();
      for (const subtype of ['FOR', 'LOC']) {
        await prisma.numberSeries.upsert({
          where: { docType_subtype: { docType: 'GRN', subtype } },
          create: {
            moduleKey: 'inventory',
            docType: 'GRN',
            subtype,
            name: `Goods received note ${subtype}`,
          },
          update: {},
        });
      }
      const suffix = token().toUpperCase();
      supplierId = (
        await prisma.supplier.create({
          data: {
            code: `SUP-S${suffix}`,
            name: `Serial supplier ${suffix}`,
            isForeign: true,
            createdBy: ACTOR,
            updatedBy: ACTOR,
          },
        })
      ).id;
      const storeRow = await prisma.store.findUniqueOrThrow({
        where: { code: 'MAIN' },
      });
      const zone = await prisma.zone.create({
        data: { storeId: storeRow.id, code: letters(3), name: 'Serial zone' },
      });
      shelf = (
        await prisma.bin.create({
          data: {
            storeId: storeRow.id,
            zoneId: zone.id,
            code: `${zone.code}-01-01-S`,
            rack: '01',
            shelf: '01',
            position: 'S',
            kind: 'STORAGE',
            qrToken: token(),
            createdBy: ACTOR,
            updatedBy: ACTOR,
          },
        })
      ).id;
      const brand = await prisma.brand.create({
        data: { name: `Serial ${suffix}` },
      });
      const item = (n: string, uom: string) =>
        prisma.item.create({
          data: {
            partNo: `S${n}-${suffix}`,
            partNoNorm: `S${n}${suffix}`,
            brandId: brand.id,
            description: `Serial test ${n}`,
            uom,
            qrToken: token(),
            createdBy: ACTOR,
            updatedBy: ACTOR,
          },
        });
      const f = await item('F', 'PCS');
      filter = f.id;
      filterPartNo = f.partNo;
      oil = (await item('O', 'L')).id;
    });

    afterAll(async () => {
      await prisma.$disconnect();
    });

    it('gives every received unit a serial when the GRN is posted', async () => {
      const grn = await receive([
        { itemId: filter, qtyGood: '3', qtyDamaged: '1' },
        { itemId: oil, qtyGood: '200' },
      ]);
      grnId = grn.id;
      const [filterLine, oilLine] = grn.lines;
      expect(
        filterLine?.serials.map((s) => [s.unitNo, s.condition, s.qty]),
      ).toEqual([
        [1, 'GOOD', '1'],
        [2, 'GOOD', '1'],
        [3, 'GOOD', '1'],
        [4, 'DAMAGED', '1'],
      ]);
      expect(oilLine?.serials.map((s) => [s.unitNo, s.qty])).toEqual([
        [1, '200'],
      ]);
      const all = [...(filterLine?.serials ?? []), ...(oilLine?.serials ?? [])];
      expect(all.every((s) => SERIAL_PATTERN.test(s.serial))).toBe(true);
      expect(new Set(all.map((s) => s.serial)).size).toBe(5);

      const one = await serials.bySerial(
        filterLine?.serials[1]?.serial as string,
      );
      expect(one).toMatchObject({
        unitNo: 2,
        unitsOnLine: 4,
        source: 'GRN',
        doc: { type: 'GRN', number: grn.number },
        supplierName: expect.stringContaining('Serial supplier'),
        item: { id: filter },
      });
    });

    it('moves the put-away units to their shelf, lowest numbers first', async () => {
      const grn = await grns.detail(grnId);
      const line = grn.lines[0];
      await putaway.putAway(policy, {
        moves: [{ grnLineId: line?.id as string, binId: shelf, qty: '2' }],
      });
      const rows = await prisma.itemSerial.findMany({
        where: { docLineId: line?.id },
        orderBy: { unitNo: 'asc' },
        select: { unitNo: true, binId: true },
      });
      expect(rows.map((r) => r.binId === shelf)).toEqual([
        true,
        true,
        false,
        false,
      ]);
    });

    it('prints labels, counting each print, and finds parts by serial', async () => {
      const pdf = await serials.labels({ grnId, unprinted: true, skip: 0 });
      expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
      const printed = await prisma.itemSerial.findMany({
        where: { docId: grnId },
      });
      expect(printed.every((s) => s.printCount === 1)).toBe(true);
      const again = await failure(
        serials.labels({ grnId, unprinted: true, skip: 0 }),
      );
      expect(again.response?.code).toBe('NO_SERIALS');

      const target = printed.find((s) => s.itemId === filter)?.serial as string;
      const spaced = target.replace(/(.{4})(?=.)/g, '$1 ').toLowerCase();
      expect(await scan.resolve(policy, spaced)).toMatchObject({
        type: 'serial',
        serial: target,
        path: `/inventory/serials/${target}`,
      });
      const found = await prisma.item.findMany({
        where: itemSearch(target),
        select: { partNo: true },
      });
      expect(found.map((i) => i.partNo)).toEqual([filterPartNo]);
    });

    it('voids the serials of a reversed GRN', async () => {
      const grn = await receive([{ itemId: filter, qtyGood: '2' }]);
      await grns.reverse(policy, grn.id, {
        version: grn.version,
        reason: 'Wrong delivery',
      });
      const rows = await prisma.itemSerial.findMany({
        where: { docId: grn.id },
      });
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.status === 'VOID' && r.voidedAt)).toBe(true);
      const page = await serials.forItem(filter, {
        status: 'VOID',
        page: 1,
        limit: 25,
      });
      expect(page.items.map((r) => r.doc.id)).toContain(grn.id);
    });

    it('gives stock already in the store serials once', async () => {
      const suffix = token().toUpperCase();
      const brand = await prisma.brand.findFirstOrThrow({
        where: { items: { some: { id: filter } } },
      });
      const old = await prisma.item.create({
        data: {
          partNo: `SX-${suffix}`,
          partNoNorm: `SX${suffix}`,
          brandId: brand.id,
          description: 'Stock from before serials',
          uom: 'PCS',
          qrToken: token(),
          createdBy: ACTOR,
          updatedBy: ACTOR,
        },
      });
      await prisma.$transaction((tx) =>
        engine.post(
          tx,
          [
            {
              itemId: old.id,
              binId: shelf,
              qty: '3',
              movement: 'OPENING',
              docType: 'CNT',
              docId: randomUUID(),
              docNumber: 'CNT/26/9001',
            },
          ],
          ACTOR,
        ),
      );
      const made = await prisma.$transaction((tx) =>
        makeExistingSerials(tx, [old.id]),
      );
      expect(made).toBe(3);
      const rows = await prisma.itemSerial.findMany({
        where: { itemId: old.id },
      });
      expect(
        rows.every(
          (r) =>
            r.source === 'EXISTING' &&
            r.binId === shelf &&
            r.docNumber === 'CNT/26/9001',
        ),
      ).toBe(true);
      expect(
        await prisma.$transaction((tx) => makeExistingSerials(tx, [old.id])),
      ).toBe(0);
    });
  },
);
