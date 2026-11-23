import { randomBytes, randomUUID } from 'node:crypto';
import {
  AttachmentAccessRegistry,
  AuditService,
  EventBus,
  InboxService,
  NumberingService,
  PolicyService,
  type RequestContext,
} from '@dax/platform-core';
import { PrismaService } from '@dax/platform-db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INVENTORY_ENTITIES } from '../entities';
import { MainStore } from '../main-store.service';
import { stockFigures } from '../stock-math';
import { findMismatches } from '../stock/reconcile';
import { StockPostingService } from '../stock/stock-posting.service';
import { fakePolicy } from '../testing';
import { familySearch, itemSearch } from '../item-queries';
import { belowMinReport } from '../reports/below-min';
import { refreshFamily } from '../supersession';
import { BundlesService } from '../bundles/bundles.service';
import { AodsService } from './aods.service';
import { ensureCustomerParts } from './customer-parts';
import { HoldsService } from './holds.service';
import { MrnsService } from './mrns.service';

const url = process.env['TEST_DATABASE_URL'];
const ACTOR = '00000000-0000-0000-0000-000000000001';

describe.skipIf(!url)('issuing against Postgres', { timeout: 60_000 }, () => {
  let prisma: PrismaService;
  let engine: StockPostingService;
  let holds: HoldsService;
  let mrns: MrnsService;
  let aods: AodsService;
  let bundles: BundlesService;
  let departmentId: string;
  let customerId: string;
  let itemA: string;
  let itemB: string;
  let binA: string;
  let partA: string;
  const policy = fakePolicy([
    'inventory.hold.view',
    'inventory.mrn.view',
    'inventory.mrn.create',
    'inventory.aod.view',
    'inventory.aod.issue',
  ]);

  const approver = {
    ...fakePolicy(['inventory.aod.view', 'inventory.aod.approve']),
    userId: randomUUID(),
  };
  const approved = async (aod: { id: string; version: number }) => {
    const sent = await aods.submit(policy, aod.id, aod.version);
    return aods.approve(approver, aod.id, sent.version);
  };

  const token = () => randomBytes(8).toString('hex').slice(0, 12);
  const letters = (n: number) =>
    [...randomBytes(n)].map((b) => String.fromCharCode(65 + (b % 26))).join('');
  const figures = async (itemId: string) =>
    stockFigures(
      await prisma.stockBalance.findFirst({
        where: { itemId },
        select: { onHand: true, held: true, quarantine: true, receiving: true },
      }),
    ).figures;
  const receive = (itemId: string, qty: string) =>
    prisma.$transaction((tx) =>
      engine.post(
        tx,
        [
          {
            itemId,
            binId: binA,
            qty,
            movement: 'RECEIVE',
            docType: 'TEST',
            docId: randomUUID(),
          },
        ],
        ACTOR,
      ),
    );
  const failure = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      return error as { response?: { code?: string; message?: string } };
    }
    throw new Error('Expected a failure');
  };
  const readyMrn = async (itemId: string, qty: string) => {
    const draft = await mrns.create(policy, {
      subtype: 'PRT',
      departmentId,
      lines: [{ itemId, qty }],
    });
    const submitted = await mrns.submit(policy, draft.id, draft.version);
    return mrns.check(policy, draft.id, submitted.version);
  };

  beforeAll(async () => {
    prisma = new PrismaService({
      url: url as string,
      applicationName: 'dax-test',
    });
    const context = { get: () => ({}) } as unknown as RequestContext;
    const store = new MainStore(prisma);
    const audit = new AuditService(prisma, context, [...INVENTORY_ENTITIES]);
    bundles = new BundlesService(prisma, audit);
    const numbering = new NumberingService();
    engine = new StockPostingService(store, context);
    holds = new HoldsService(prisma, audit, numbering, engine);
    mrns = new MrnsService(prisma, audit, numbering, engine, store, []);
    aods = new AodsService(
      prisma,
      audit,
      numbering,
      new EventBus(),
      engine,
      store,
      mrns,
      new AttachmentAccessRegistry(),
      new InboxService(prisma, new PolicyService(prisma)),
    );
    const series: [string, string][] = [
      ['HLD', ''],
      ['MRN', 'PRT'],
      ['MRN', 'SRV'],
      ['AOD', 'SER'],
      ['AOD', 'DIR'],
    ];
    for (const [docType, subtype] of series) {
      await prisma.numberSeries.upsert({
        where: { docType_subtype: { docType, subtype } },
        create: {
          moduleKey: 'inventory',
          docType,
          subtype,
          name: `${docType} ${subtype}`,
          pattern: subtype ? '{DOC}/{SUB}/{FY}/{SEQ}' : '{DOC}/{FY}/{SEQ}',
        },
        update: {},
      });
    }

    const suffix = token().toUpperCase();
    departmentId = (
      await prisma.department.create({
        data: {
          key: `test_${suffix.toLowerCase()}`,
          name: `Service ${suffix}`,
        },
      })
    ).id;
    customerId = (
      await prisma.customer.create({
        data: {
          code: `CUS-T${suffix}`,
          name: `Test customer ${suffix}`,
          createdBy: ACTOR,
          updatedBy: ACTOR,
        },
      })
    ).id;
    const storeRow = await prisma.store.findUniqueOrThrow({
      where: { code: 'MAIN' },
    });
    const zone = await prisma.zone.create({
      data: {
        storeId: storeRow.id,
        code: letters(3),
        name: 'Issuing test zone',
      },
    });
    binA = (
      await prisma.bin.create({
        data: {
          storeId: storeRow.id,
          zoneId: zone.id,
          code: `${zone.code}-01-01-A`,
          rack: '01',
          shelf: '01',
          position: 'A',
          kind: 'STORAGE',
          qrToken: token(),
          createdBy: ACTOR,
          updatedBy: ACTOR,
        },
      })
    ).id;
    const brand = await prisma.brand.create({
      data: { name: `Issuing ${suffix}` },
    });
    const item = async (n: string) =>
      prisma.item.create({
        data: {
          partNo: `I${n}-${suffix}`,
          partNoNorm: `I${n}${suffix}`,
          brandId: brand.id,
          description: 'Issuing test part',
          uom: 'PCS',
          defaultBinId: binA,
          qrToken: token(),
          createdBy: ACTOR,
          updatedBy: ACTOR,
        },
      });
    const a = await item('A');
    itemA = a.id;
    partA = a.partNo;
    itemB = (await item('B')).id;
    await receive(itemA, '10');
    await receive(itemB, '2');
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('takes a hold through to a signed AOD and a closed request', async () => {
    const hold = await holds.create(policy, {
      departmentId,
      customerId,
      reason: 'Customer is collecting next week',
      lines: [{ itemId: itemA, qty: '4' }],
    });
    expect(hold.number).toMatch(/^HLD\/\d{2}\/\d{4}$/);
    expect(hold.customer?.id).toBe(customerId);
    expect(await figures(itemA)).toMatchObject({ held: '4', free: '6' });

    const tooMuch = await failure(
      holds.create(policy, {
        departmentId,
        lines: [{ itemId: itemA, qty: '7' }],
      }),
    );
    expect(tooMuch.response).toMatchObject({
      code: 'NOT_ENOUGH_FREE_STOCK',
      message: `Only 6 of ${partA} is free.`,
    });

    const mrn = await mrns.convertHold(policy, hold.id, {
      version: hold.version,
      subtype: 'SRV',
      jobNumber: 'J-100',
    });
    expect(mrn.status).toBe('READY');
    expect(mrn.number).toMatch(/^MRN\/SRV\/\d{2}\/\d{4}$/);
    expect(mrn.hold?.id).toBe(hold.id);
    expect(mrn.lines.map((l) => [l.qtyReserved, l.qtyWaiting])).toEqual([
      ['4', '0'],
    ]);
    expect((await holds.detail(policy, hold.id)).status).toBe('CONVERTED');
    expect(await figures(itemA)).toMatchObject({ held: '4', free: '6' });

    const aod = await aods.create(policy, {
      mrnId: mrn.id,
      type: 'SER',
      deliverTo: 'Site A',
    });
    expect(aod.lines.map((l) => [l.qty, l.bin?.id, l.reservedForLine])).toEqual(
      [['4', binA, '4']],
    );
    const ok = await approved(aod);
    const issued = await aods.issue(policy, aod.id, ok.version);
    expect(issued.status).toBe('ISSUED');
    expect(issued.number).toMatch(/^AOD\/SER\/\d{2}\/\d{4}$/);
    expect(await figures(itemA)).toMatchObject({
      onHand: '6',
      held: '0',
      free: '6',
    });
    expect((await mrns.detail(policy, mrn.id)).status).toBe('ISSUED');

    const { pdf } = await aods.pdf(policy, aod.id);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');

    const unsigned = await failure(
      aods.sign(policy, aod.id, {
        version: issued.version,
        attachmentId: randomUUID(),
      }),
    );
    expect(unsigned.response?.code).toBe('INVALID_INPUT');
    const file = await prisma.attachment.create({
      data: {
        moduleKey: 'inventory',
        entityKey: 'inventory.aod',
        entityId: aod.id,
        kind: 'signed_aod',
        fileName: 'signed.pdf',
        contentType: 'application/pdf',
        size: 10,
        sha256: 'x'.repeat(64),
        storageKey: `test/${randomUUID()}`,
        uploadedBy: ACTOR,
      },
    });
    const signed = await aods.sign(policy, aod.id, {
      version: issued.version,
      attachmentId: file.id,
    });
    expect(signed.status).toBe('SIGNED');
    expect(signed.signedFileId).toBe(file.id);
    expect((await mrns.detail(policy, mrn.id)).status).toBe('CLOSED');
  });

  it('reserves what is free, waits for the rest, and allocates new stock', async () => {
    const draft = await mrns.create(policy, {
      subtype: 'PRT',
      departmentId,
      customerId,
      lines: [{ itemId: itemB, qty: '5' }],
    });
    expect(draft.number).toBeNull();
    const submitted = await mrns.submit(policy, draft.id, draft.version);
    expect(submitted.number).toMatch(/^MRN\/PRT\//);
    const checked = await mrns.check(policy, draft.id, submitted.version);
    expect(checked.status).toBe('CHECKED');
    expect(checked.lines.map((l) => [l.qtyReserved, l.qtyWaiting])).toEqual([
      ['2', '3'],
    ]);
    expect(checked.waitingLines).toBe(1);
    const waiting = await mrns.list(policy, {
      status: 'WAITING',
      page: 1,
      limit: 200,
    });
    expect(waiting.items.map((m) => m.id)).toContain(draft.id);

    await receive(itemB, '4');
    const allocated = await mrns.allocate(policy, draft.id, {
      version: checked.version,
    });
    expect(allocated.status).toBe('READY');
    expect(allocated.lines.map((l) => [l.qtyReserved, l.qtyWaiting])).toEqual([
      ['5', '0'],
    ]);
    expect(await figures(itemB)).toMatchObject({
      onHand: '6',
      held: '5',
      free: '1',
    });
  });

  it('releases reservations and cancels picking when closing short', async () => {
    const mrn = await readyMrn(itemA, '2');
    expect(mrn.status).toBe('READY');
    const aod = await aods.create(policy, { mrnId: mrn.id, type: 'DIR' });
    const before = await mrns.detail(policy, mrn.id);
    const closed = await mrns.shortClose(policy, mrn.id, {
      version: before.version,
      reason: 'Customer no longer needs it',
    });
    expect(closed.status).toBe('SHORT_CLOSED');
    expect(closed.closeReason).toBe('Customer no longer needs it');
    expect(closed.lines.map((l) => [l.qtyShortClosed, l.qtyReserved])).toEqual([
      ['2', '0'],
    ]);
    expect((await aods.detail(policy, aod.id)).status).toBe('CANCELLED');
    expect(await figures(itemA)).toMatchObject({ held: '0', free: '6' });
  });

  it('lets only one of two pickers issue the same reserved stock', async () => {
    const mrn = await readyMrn(itemA, '1');
    const aod = await approved(
      await aods.create(policy, { mrnId: mrn.id, type: 'SER' }),
    );
    const results = await Promise.allSettled([
      aods.issue(policy, aod.id, aod.version),
      aods.issue(policy, aod.id, aod.version),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect(
      (rejected as PromiseRejectedResult | undefined)?.reason,
    ).toMatchObject({
      status: 409,
    });
    expect(await figures(itemA)).toMatchObject({ onHand: '5', held: '0' });
    const ledger = await prisma.stockLedger.findMany({
      where: { docType: 'AOD', docId: aod.id },
    });
    expect(ledger).toHaveLength(1);
  });

  it('keeps an AOD with Stores until a department head approves it', async () => {
    const mrn = await readyMrn(itemA, '1');
    const viewer = {
      ...fakePolicy(['inventory.aod.view', 'inventory.mrn.view']),
      userId: randomUUID(),
    };
    const aod = await aods.create(policy, { mrnId: mrn.id, type: 'SER' });
    expect(aod.lines[0]?.customerPartNo).toBeNull();
    expect(await failure(aods.detail(viewer, aod.id))).toMatchObject({
      status: 404,
    });
    expect((await mrns.detail(viewer, mrn.id)).aods).toEqual([]);
    expect(
      await failure(aods.issue(policy, aod.id, aod.version)),
    ).toMatchObject({ response: { code: 'INVALID_STATE' } });

    const sent = await aods.submit(policy, aod.id, aod.version);
    expect(sent.status).toBe('PENDING_APPROVAL');
    expect((await aods.detail(approver, aod.id)).canApprove).toBe(true);

    const rejected = await aods.reject(approver, aod.id, {
      version: sent.version,
      reason: 'Wrong vehicle number',
    });
    expect(rejected.status).toBe('PICKING');
    expect(rejected.rejectReason).toBe('Wrong vehicle number');
    expect(await failure(aods.detail(viewer, aod.id))).toMatchObject({
      status: 404,
    });

    const again = await aods.submit(policy, aod.id, rejected.version);
    expect(again.rejectReason).toBeNull();
    const sender = { ...approver, userId: policy.userId };
    const ok = await aods.approve(sender, aod.id, again.version);
    expect(ok.status).toBe('APPROVED');
    expect(ok.approved).not.toBeNull();
    expect((await aods.detail(viewer, aod.id)).status).toBe('APPROVED');
    expect(await failure(aods.pdf(policy, aod.id))).toMatchObject({
      response: { code: 'NOT_ISSUED' },
    });

    const issued = await aods.issue(policy, aod.id, ok.version);
    expect(issued.status).toBe('ISSUED');
    const { pdf } = await aods.pdf(policy, aod.id);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('generates one customer part number per customer per part and finds AODs by it', async () => {
    const customer = async (label: string) =>
      prisma.customer.create({
        data: {
          code: `CP${label}-${token().slice(0, 4).toUpperCase()}`,
          name: `Numbering ${label}`,
          createdBy: ACTOR,
          updatedBy: ACTOR,
        },
      });
    const first = await customer('A');
    const second = await customer('B');

    const both = await prisma.$transaction((tx) =>
      ensureCustomerParts(tx, first.id, [itemA, itemB], ACTOR),
    );
    expect([...both.values()].sort()).toEqual([
      `${first.code}-00001`,
      `${first.code}-00002`,
    ]);
    const again = await prisma.$transaction((tx) =>
      ensureCustomerParts(tx, first.id, [itemA], ACTOR),
    );
    expect(again.get(itemA)).toBe(both.get(itemA));

    const raced = await Promise.all([
      prisma.$transaction((tx) =>
        ensureCustomerParts(tx, second.id, [itemA], ACTOR),
      ),
      prisma.$transaction((tx) =>
        ensureCustomerParts(tx, second.id, [itemB], ACTOR),
      ),
    ]);
    expect([raced[0].get(itemA), raced[1].get(itemB)].sort()).toEqual([
      `${second.code}-00001`,
      `${second.code}-00002`,
    ]);

    const draft = await mrns.create(policy, {
      subtype: 'PRT',
      departmentId,
      customerId: first.id,
      lines: [{ itemId: itemA, qty: '1' }],
    });
    const submitted = await mrns.submit(policy, draft.id, draft.version);
    await mrns.check(policy, draft.id, submitted.version);
    const aod = await aods.create(policy, { mrnId: draft.id, type: 'DIR' });
    expect(aod.lines.map((l) => l.customerPartNo)).toEqual([both.get(itemA)]);

    const found = await aods.list(policy, {
      q: both.get(itemA),
      status: 'ALL',
      page: 1,
      limit: 25,
    });
    expect(found.items.map((a) => a.id)).toEqual([aod.id]);
    const items = await prisma.item.findMany({
      where: itemSearch(both.get(itemA)),
      select: { id: true },
    });
    expect(items.map((i) => i.id)).toEqual([itemA]);

    const open = await mrns.detail(policy, draft.id);
    await mrns.cancel(policy, draft.id, open.version);
  });

  it('pools stock across superseded numbers, oldest first, and supplies the old number', async () => {
    const base = await prisma.item.findUniqueOrThrow({
      where: { id: itemA },
      select: { brandId: true },
    });
    const code = letters(4);
    const part = (n: string) =>
      prisma.item.create({
        data: {
          partNo: `F${n}-${code}`,
          partNoNorm: `F${n}${code}`,
          brandId: base.brandId,
          description: 'Family test part',
          uom: 'PCS',
          defaultBinId: binA,
          qrToken: token(),
          createdBy: ACTOR,
          updatedBy: ACTOR,
        },
      });
    const oldest = await part('0739');
    const older = await part('0750');
    const current = await part('1808');
    const branch = await part('0740');
    expect(current.familyId).toBe(current.id);
    const supersede = async (id: string, by: string) => {
      await prisma.item.update({
        where: { id },
        data: { supersededById: by },
      });
      await prisma.$transaction((tx) => refreshFamily(tx, id));
    };
    await supersede(older.id, current.id);
    await supersede(oldest.id, older.id);
    await supersede(branch.id, older.id);
    const fam = await prisma.item.findMany({
      where: { id: { in: [oldest.id, older.id, current.id, branch.id] } },
      select: { id: true, familyId: true, familyDepth: true },
    });
    expect(
      Object.fromEntries(fam.map((f) => [f.id, [f.familyId, f.familyDepth]])),
    ).toEqual({
      [oldest.id]: [current.id, 2],
      [branch.id]: [current.id, 2],
      [older.id]: [current.id, 1],
      [current.id]: [current.id, 0],
    });

    await receive(oldest.id, '4');
    await receive(older.id, '3');
    await receive(current.id, '7');

    const listed = await prisma.item.findMany({
      where: { AND: [{ supersededById: null }, familySearch(oldest.partNo)] },
      select: { id: true },
    });
    expect(listed.map((i) => i.id)).toEqual([current.id]);
    const low = await belowMinReport(
      prisma,
      (await prisma.store.findUniqueOrThrow({ where: { code: 'MAIN' } })).id,
      2000,
    );
    expect(low.items.some((r) => r.item.id === older.id)).toBe(false);

    const draft = await mrns.create(policy, {
      subtype: 'PRT',
      departmentId,
      lines: [{ itemId: current.id, qty: '9' }],
    });
    const submitted = await mrns.submit(policy, draft.id, draft.version);
    const checked = await mrns.check(policy, draft.id, submitted.version);
    const [line] = checked.lines;
    expect(line?.qtyReserved).toBe('9');
    expect(line?.freeNow).toBe('5');
    expect(line?.reservedBy.map((r) => [r.item.id, r.qty])).toEqual([
      [oldest.id, '4'],
      [older.id, '3'],
      [current.id, '2'],
    ]);

    const aod = await aods.create(policy, { mrnId: draft.id, type: 'SER' });
    expect(
      aod.lines.map((l) => [l.item.id, l.qty, l.requestedItem?.id ?? null]),
    ).toEqual([
      [oldest.id, '4', current.id],
      [older.id, '3', current.id],
      [current.id, '2', null],
    ]);
    const wrong = await failure(
      aods.update(policy, aod.id, {
        version: aod.version,
        lines: aod.lines.map((l) => ({
          id: l.id,
          mrnLineId: l.mrnLineId,
          itemId: l.item.id === oldest.id ? branch.id : l.item.id,
          binId: binA,
          qty: l.qty,
          scanned: false,
        })),
      }),
    );
    expect(wrong.response?.code).toBe('MORE_THAN_RESERVED');

    const ok = await approved(aod);
    await aods.issue(policy, aod.id, ok.version);
    expect(await figures(oldest.id)).toMatchObject({ onHand: '0', held: '0' });
    expect(await figures(older.id)).toMatchObject({ onHand: '0', held: '0' });
    expect(await figures(current.id)).toMatchObject({ onHand: '5', held: '0' });
    const { pdf } = await aods.pdf(policy, aod.id);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');

    await prisma.item.update({
      where: { id: older.id },
      data: { supersededById: null },
    });
    await prisma.$transaction((tx) => refreshFamily(tx, older.id));
    const split = await prisma.item.findMany({
      where: { id: { in: [oldest.id, older.id] } },
      select: { familyId: true },
    });
    expect(split.map((f) => f.familyId)).toEqual([older.id, older.id]);
  });

  it('ships a bundle in whole sets and numbers it for the customer', async () => {
    const base = await prisma.item.findUniqueOrThrow({
      where: { id: itemA },
      select: { brandId: true },
    });
    const code = letters(4);
    const part = (n: string) =>
      prisma.item.create({
        data: {
          partNo: `K${n}-${code}`,
          partNoNorm: `K${n}${code}`,
          brandId: base.brandId,
          description: `Kit part ${n}`,
          uom: 'PCS',
          defaultBinId: binA,
          qrToken: token(),
          createdBy: ACTOR,
          updatedBy: ACTOR,
        },
      });
    const filter = await part('1');
    const seal = await part('2');
    await receive(filter.id, '5');
    await receive(seal.id, '1');
    const customer = await prisma.customer.create({
      data: {
        code: `KB-${code}`,
        name: `Kit customer ${code}`,
        createdBy: ACTOR,
        updatedBy: ACTOR,
      },
    });
    const kit = await bundles.create(ACTOR, {
      name: `Service kit ${code}`,
      lines: [
        { itemId: filter.id, qty: '2' },
        { itemId: seal.id, qty: '1' },
      ],
    });
    expect(kit.partCount).toBe(2);

    const raise = async (bundleId: string | null, name: string) => {
      const draft = await mrns.create(policy, {
        subtype: 'PRT',
        departmentId,
        customerId: customer.id,
        lines: [],
        bundles: [
          {
            bundleId,
            name,
            qtySets: 2,
            lines: [
              { itemId: filter.id, qtyPerSet: '2' },
              { itemId: seal.id, qtyPerSet: '1' },
            ],
          },
        ],
      });
      const sent = await mrns.submit(policy, draft.id, draft.version);
      return mrns.check(policy, draft.id, sent.version);
    };

    const mrn = await raise(kit.id, kit.name);
    expect(mrn.lines.map((l) => [l.qtyRequested, l.qtyReserved])).toEqual([
      ['4', '4'],
      ['2', '1'],
    ]);
    expect(mrn.bundles[0]).toMatchObject({ qtySets: 2, setsReady: 1 });

    const aod = await aods.create(policy, { mrnId: mrn.id, type: 'DIR' });
    expect(aod.lines.map((l) => l.qty)).toEqual(['2', '1']);
    expect(aod.bundles).toEqual([
      expect.objectContaining({ sets: 1, customerPartNo: `KB-${code}-00003` }),
    ]);
    const partial = await failure(
      aods.update(policy, aod.id, {
        version: aod.version,
        lines: aod.lines.map((l) => ({
          id: l.id,
          mrnLineId: l.mrnLineId,
          itemId: l.item.id,
          binId: binA,
          qty: l.item.id === filter.id ? '1' : l.qty,
          scanned: false,
        })),
      }),
    );
    expect(partial.response?.code).toBe('BUNDLE_INCOMPLETE');

    const ok = await approved(aod);
    await aods.issue(policy, aod.id, ok.version);
    const byKit = await aods.list(policy, {
      q: `KB-${code}-00003`,
      status: 'ALL',
      page: 1,
      limit: 25,
    });
    expect(byKit.items.map((a) => a.id)).toEqual([aod.id]);
    const { pdf } = await aods.pdf(policy, aod.id, 'customer');
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');

    await receive(filter.id, '6');
    await receive(seal.id, '4');
    const again = await raise(kit.id, kit.name);
    const second = await aods.create(policy, { mrnId: again.id, type: 'DIR' });
    expect(second.bundles[0]?.customerPartNo).toBe(`KB-${code}-00003`);

    await receive(filter.id, '4');
    await receive(seal.id, '2');
    const oneOff = await raise(null, 'One-off set');
    const third = await aods.create(policy, { mrnId: oneOff.id, type: 'DIR' });
    expect(third.bundles[0]?.customerPartNo).toBe(`KB-${code}-00004`);
  });

  it('agrees with the nightly reconciliation', async () => {
    const mismatches = await prisma.$transaction((tx) => findMismatches(tx));
    expect(
      mismatches.filter((m) => m.itemId === itemA || m.itemId === itemB),
    ).toEqual([]);
  });
});
