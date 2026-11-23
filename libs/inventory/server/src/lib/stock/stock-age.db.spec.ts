import { randomBytes, randomUUID } from 'node:crypto';
import { AuditService, type RequestContext } from '@dax/platform-core';
import { PrismaService } from '@dax/platform-db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INVENTORY_ENTITIES } from '../entities';
import { MainStore } from '../main-store.service';
import { StockAgeService } from '../reports/stock-age.service';
import { rebuildStockAge } from './stock-age';
import { type Movement, StockPostingService } from './stock-posting.service';

const url = process.env['TEST_DATABASE_URL'];
const ACTOR = '00000000-0000-0000-0000-000000000001';
const DAY = 86_400_000;

describe.skipIf(!url)('stock age against Postgres', () => {
  let prisma: PrismaService;
  let engine: StockPostingService;
  let age: StockAgeService;
  let storeId: string;
  let itemId: string;
  let partNo: string;
  let receiving: string;
  let shelfA: string;
  let shelfB: string;
  let quarantine: string;
  const issueLine = randomUUID();
  const grnLines: string[] = [];

  const token = () => randomBytes(8).toString('hex').slice(0, 12);
  const post = (moves: Omit<Movement, 'itemId'>[]) =>
    prisma.$transaction((tx) =>
      engine.post(
        tx,
        moves.map((m) => ({ ...m, itemId })),
        ACTOR,
      ),
    );
  const layers = () =>
    prisma.stockLayer.findMany({
      where: { itemId },
      orderBy: [{ agedFrom: 'asc' }, { id: 'asc' }],
    });
  const uses = () =>
    prisma.stockLayerUse.findMany({
      where: { itemId },
      orderBy: [{ usedAt: 'asc' }, { id: 'asc' }],
    });
  const receive = async () => {
    const docId = randomUUID();
    const docLineId = randomUUID();
    grnLines.push(docLineId);
    const grn = { docType: 'GRN', docId, docLineId, docNumber: 'GRN/AGE/1' };
    await post([{ ...grn, binId: receiving, qty: '1', movement: 'RECEIVE' }]);
    await post([
      { ...grn, binId: receiving, qty: '-1', movement: 'PUTAWAY_OUT' },
      { ...grn, binId: shelfA, qty: '1', movement: 'PUTAWAY_IN' },
    ]);
  };

  beforeAll(async () => {
    prisma = new PrismaService({
      url: url as string,
      applicationName: 'dax-test',
    });
    const context = { get: () => ({}) } as unknown as RequestContext;
    const store = new MainStore(prisma);
    engine = new StockPostingService(store, context);
    age = new StockAgeService(
      prisma,
      store,
      new AuditService(prisma, context, [...INVENTORY_ENTITIES]),
    );
    storeId = await store.id();
    const suffix = token().toUpperCase();
    const zone = await prisma.zone.create({
      data: {
        storeId,
        code: [...randomBytes(3)]
          .map((b) => String.fromCharCode(65 + (b % 26)))
          .join(''),
        name: 'Age zone',
      },
    });
    const bin = async (
      kind: 'RECEIVING' | 'STORAGE' | 'QUARANTINE',
      position: string,
    ) =>
      (
        await prisma.bin.create({
          data: {
            storeId,
            zoneId: zone.id,
            code: `${zone.code}-01-01-${position}`,
            rack: '01',
            shelf: '01',
            position,
            kind,
            qrToken: token(),
            createdBy: ACTOR,
            updatedBy: ACTOR,
          },
        })
      ).id;
    receiving = await bin('RECEIVING', 'R');
    shelfA = await bin('STORAGE', 'A');
    shelfB = await bin('STORAGE', 'B');
    quarantine = await bin('QUARANTINE', 'Q');
    const brand = await prisma.brand.create({
      data: { name: `Age ${suffix}` },
    });
    partNo = `AG-${suffix}`;
    itemId = (
      await prisma.item.create({
        data: {
          partNo,
          partNoNorm: `AG${suffix}`,
          brandId: brand.id,
          description: 'Oil filter for age tests',
          uom: 'PCS',
          qrToken: token(),
          createdBy: ACTOR,
          updatedBy: ACTOR,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('starts each filter on the shelf with the day its GRN received it', async () => {
    for (let i = 0; i < 3; i++) await receive();
    const rows = await layers();
    expect(rows.map((l) => [l.source, String(l.qtyLeft)])).toEqual([
      ['GRN', '1'],
      ['GRN', '1'],
      ['GRN', '1'],
    ]);
    const received = await prisma.stockLedger.findMany({
      where: { itemId, movement: 'RECEIVE' },
      orderBy: { occurredAt: 'asc' },
    });
    expect(rows.map((l) => l.agedFrom.getTime())).toEqual(
      received.map((r) => r.occurredAt.getTime()),
    );
    expect(rows.map((l) => l.docLineId)).toEqual(grnLines);
  });

  it('leaves the ages alone when stock moves between shelf bins', async () => {
    const before = await layers();
    await post([
      {
        binId: shelfA,
        qty: '-1',
        movement: 'COUNT_ADJUST',
        docType: 'CNT',
        docId: randomUUID(),
      },
      {
        binId: shelfB,
        qty: '1',
        movement: 'COUNT_ADJUST',
        docType: 'CNT',
        docId: randomUUID(),
      },
    ]);
    expect((await layers()).map((l) => String(l.qtyLeft))).toEqual(
      before.map((l) => String(l.qtyLeft)),
    );
    expect(await uses()).toEqual([]);
  });

  it('issues the oldest filter and records its days in store', async () => {
    const [oldest] = await layers();
    await post([
      {
        binId: shelfB,
        qty: '-1',
        movement: 'ISSUE',
        docType: 'AOD',
        docId: randomUUID(),
        docLineId: issueLine,
        docNumber: 'AOD/AGE/1',
      },
    ]);
    const [use] = await uses();
    expect(use).toMatchObject({
      layerId: oldest?.id,
      docLineId: issueLine,
      docNumber: 'AOD/AGE/1',
      movement: 'ISSUE',
      daysInStore: 0,
    });
    expect(String(use?.qty)).toBe('1');
    expect(String((await layers())[0]?.qtyLeft)).toBe('0');
  });

  it('takes the oldest left when stock goes to quarantine, and opens a layer for a count gain', async () => {
    await post([
      {
        binId: shelfA,
        qty: '-1',
        movement: 'PUTAWAY_OUT',
        docType: 'TEST',
        docId: randomUUID(),
      },
      {
        binId: quarantine,
        qty: '1',
        movement: 'PUTAWAY_IN',
        docType: 'TEST',
        docId: randomUUID(),
      },
    ]);
    await post([
      {
        binId: shelfA,
        qty: '2',
        movement: 'COUNT_ADJUST',
        docType: 'CNT',
        docId: randomUUID(),
      },
    ]);
    const rows = await layers();
    expect(rows.map((l) => [l.source, String(l.qtyLeft)])).toEqual([
      ['GRN', '0'],
      ['GRN', '0'],
      ['GRN', '1'],
      ['COUNT', '2'],
    ]);
    expect(await uses()).toHaveLength(2);
  });

  it('rebuilds the same layers from the ledger and matches the shelf', async () => {
    const shape = async () => ({
      layers: (await layers()).map((l) => [
        l.source,
        l.agedFrom.getTime(),
        String(l.qtyIn),
        String(l.qtyLeft),
        l.docLineId,
      ]),
      uses: (await uses()).map((u) => [
        u.movement,
        String(u.qty),
        u.docLineId,
        u.daysInStore,
      ]),
    });
    const live = await shape();
    await prisma.$transaction((tx) => rebuildStockAge(tx, [itemId]));
    expect(await shape()).toEqual(live);

    const shelf = await prisma.binStock.aggregate({
      where: { itemId, binId: { in: [shelfA, shelfB] } },
      _sum: { qty: true },
    });
    const held = await prisma.stockLayer.aggregate({
      where: { itemId },
      _sum: { qtyLeft: true },
    });
    expect(String(held._sum.qtyLeft)).toBe(String(shelf._sum.qty));
  });

  it('bands the shelf stock by age, counts it on Home and shows it on the part', async () => {
    const now = new Date();
    const open = (await layers()).filter((l) => Number(l.qtyLeft) > 0);
    const [grn, count] = open;
    await prisma.stockLayer.update({
      where: { id: grn?.id as string },
      data: { agedFrom: new Date(now.getTime() - 10 * DAY) },
    });
    await prisma.stockLayer.update({
      where: { id: count?.id as string },
      data: { agedFrom: new Date(now.getTime() - 400 * DAY) },
    });

    const report = await age.report({ q: partNo }, 2000, now);
    expect(report.limits).toEqual([30, 90, 180, 365]);
    expect(report.items).toEqual([
      expect.objectContaining({
        onShelf: '3',
        bands: ['1', '0', '0', '0', '2'],
        oldestDays: 400,
        averageDays: 270,
        atLeast: false,
      }),
    ]);
    const old = await age.report({ q: partNo, band: 4 }, 2000, now);
    expect(old.items).toHaveLength(1);
    expect((await age.agedOver(now)).count).toBeGreaterThanOrEqual(1);

    const part = await age.item(itemId, { page: 1, limit: 20 }, now);
    expect(part.shelf.map((l) => [l.source, l.qtyLeft, l.days])).toEqual([
      ['COUNT', '2', 400],
      ['GRN', '1', 10],
    ]);
    expect(part.out.total).toBe(2);
    expect(part.out.items.map((u) => u.movement)).toEqual([
      'PUTAWAY_OUT',
      'ISSUE',
    ]);
  });

  it('lets the bands be changed, refusing a stale version', async () => {
    const before = await age.settings();
    const changed = await age.updateSettings(
      { bands: [10, 20], version: before.version },
      ACTOR,
    );
    expect(changed.bands).toEqual([10, 20]);
    await expect(
      age.updateSettings({ bands: [5, 6], version: before.version }, ACTOR),
    ).rejects.toMatchObject({ response: { code: 'STALE' } });
    await age.updateSettings(
      { bands: before.bands, version: changed.version },
      ACTOR,
    );
  });
});
