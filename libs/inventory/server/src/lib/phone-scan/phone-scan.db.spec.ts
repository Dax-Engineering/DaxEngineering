import { randomBytes } from 'node:crypto';
import {
  AttachmentAccessRegistry,
  AuditService,
  type FilesService,
  type Policy,
  type PolicyService,
  type RequestContext,
} from '@dax/platform-core';
import { PrismaService } from '@dax/platform-db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INVENTORY_ENTITIES } from '../entities';
import { ItemsService } from '../items.service';
import { MainStore } from '../main-store.service';
import { ScanService } from '../scan.service';
import { fakePolicy } from '../testing';
import { OnlineLookup } from './online-lookup';
import { PhoneScanService } from './phone-scan.service';

const url = process.env['TEST_DATABASE_URL'];
const ACTOR = '00000000-0000-0000-0000-000000000001';
const MIN = 60_000;
// Never call the online barcode database from tests.
process.env['BARCODE_LOOKUP'] = 'off';

describe.skipIf(!url)(
  'phone scanning against Postgres',
  { timeout: 30_000 },
  () => {
    let prisma: PrismaService;
    let phone: PhoneScanService;
    let barcode: string;
    let itemId: string;
    let binCode: string;
    const pc: Policy = {
      ...fakePolicy(['inventory.item.view', 'inventory.location.view']),
      userId: '0190a000-0000-7000-8000-0000000000dd',
    };
    const token = () => randomBytes(8).toString('hex').slice(0, 12);

    beforeAll(async () => {
      prisma = new PrismaService({
        url: url as string,
        applicationName: 'dax-test',
      });
      const policies = {
        forUser: async () => pc,
      } as unknown as PolicyService;
      const mainStore = new MainStore(prisma);
      const context = { get: () => ({}) } as unknown as RequestContext;
      const audit = new AuditService(prisma, context, [...INVENTORY_ENTITIES]);
      phone = new PhoneScanService(
        prisma,
        policies,
        new ScanService(prisma, mainStore),
        new ItemsService(prisma, audit, mainStore),
        {} as FilesService,
        new AttachmentAccessRegistry(),
        new OnlineLookup(),
        mainStore,
      );
      const suffix = token().toUpperCase();
      const brand = await prisma.brand.create({
        data: { name: `Phone ${suffix}` },
      });
      const item = await prisma.item.create({
        data: {
          partNo: `PH-${suffix}`,
          partNoNorm: `PH${suffix}`,
          brandId: brand.id,
          description: 'Phone scan test part',
          uom: 'PCS',
          qrToken: token(),
          createdBy: ACTOR,
          updatedBy: ACTOR,
        },
      });
      itemId = item.id;
      barcode = `890${randomBytes(5).readUIntBE(0, 5)}`;
      await prisma.itemBarcode.create({
        data: { itemId: item.id, code: barcode, kind: 'MANUFACTURER' },
      });
      const store = await prisma.store.findUniqueOrThrow({
        where: { code: 'MAIN' },
      });
      const zoneCode = [...randomBytes(3)]
        .map((b) => String.fromCharCode(65 + (b % 26)))
        .join('');
      const zone = await prisma.zone.create({
        data: { storeId: store.id, code: zoneCode, name: 'Phone zone' },
      });
      binCode = `${zoneCode}-01-01-A`;
      await prisma.bin.create({
        data: {
          storeId: store.id,
          zoneId: zone.id,
          code: binCode,
          rack: '01',
          shelf: '01',
          position: 'A',
          qrToken: token(),
          createdBy: ACTOR,
          updatedBy: ACTOR,
        },
      });
    });

    afterAll(async () => {
      await prisma?.$disconnect();
    });

    it('pairs with the right code, then adds +1 per scan', async () => {
      const start = await phone.start(pc);
      const wrong = start.code === '000000' ? '111111' : '000000';
      expect(
        await phone.pair({ linkToken: start.linkToken, code: wrong }),
      ).toEqual({ ok: false, reason: 'wrong_code', attemptsLeft: 4 });

      const paired = await phone.pair({
        linkToken: start.linkToken,
        code: start.code,
      });
      expect(paired.ok).toBe(true);
      if (!paired.ok) return;
      // A second phone can't use the same link.
      expect(
        await phone.pair({ linkToken: start.linkToken, code: start.code }),
      ).toEqual({ ok: false, reason: 'used' });

      const { phoneToken } = paired;
      expect(
        (await phone.scan({ phoneToken, code: barcode, format: 'ean_13' }))
          .result,
      ).toBe('added');
      const again = await phone.scan({ phoneToken, code: barcode });
      expect(again.line?.qty).toBe('2');
      expect(
        (await phone.scan({ phoneToken, code: 'NO-SUCH-CODE' })).result,
      ).toBe('unknown');
      expect((await phone.scan({ phoneToken, code: binCode })).result).toBe(
        'bin',
      );

      const view = await phone.view(pc, start.id);
      expect(view.status).toBe('PAIRED');
      expect(view.lines.map((l) => [l.code, l.qty, l.item !== null])).toEqual(
        expect.arrayContaining([
          [barcode, '2', true],
          ['NO-SUCH-CODE', '1', false],
        ]),
      );

      const known = view.lines.find((l) => l.code === barcode);
      expect(known?.format).toBe('ean_13');
      expect(known?.kind).toBe('part');
      expect(known?.stock).toEqual({ onHand: '0', free: '0', bins: 0 });
      expect(
        view.lines.find((l) => l.code === 'NO-SUCH-CODE')?.stock,
      ).toBeNull();

      // Only the owner sees the session.
      const other = { ...pc, userId: '0190a000-0000-7000-8000-0000000000ee' };
      await expect(phone.view(other, start.id)).rejects.toThrow();

      await phone.end(pc, start.id);
      expect((await phone.scan({ phoneToken, code: barcode })).result).toBe(
        'ended',
      );
      expect((await phone.state(phoneToken)).status).toBe('ENDED');
    });

    it("the PC's own camera adds to the same list, before and after pairing", async () => {
      const start = await phone.start(pc);
      expect(
        (await phone.scanFromPc(pc, start.id, { code: barcode })).result,
      ).toBe('added');

      const paired = await phone.pair({
        linkToken: start.linkToken,
        code: start.code,
      });
      if (!paired.ok) throw new Error('did not pair');
      await phone.scan({ phoneToken: paired.phoneToken, code: barcode });
      expect(
        (await phone.scanFromPc(pc, start.id, { code: binCode })).result,
      ).toBe('bin');

      const view = await phone.view(pc, start.id);
      expect(view.lines.map((l) => [l.code, l.qty])).toEqual([[barcode, '2']]);

      const other = { ...pc, userId: '0190a000-0000-7000-8000-0000000000ee' };
      await expect(
        phone.scanFromPc(other, start.id, { code: barcode }),
      ).rejects.toThrow();

      await phone.end(pc, start.id);
      expect(
        (await phone.scanFromPc(pc, start.id, { code: barcode })).result,
      ).toBe('ended');
    });

    it('locks the link after five wrong codes', async () => {
      const start = await phone.start(pc);
      const wrong = start.code === '999999' ? '888888' : '999999';
      for (let i = 0; i < 4; i++) {
        await phone.pair({ linkToken: start.linkToken, code: wrong });
      }
      expect(
        await phone.pair({ linkToken: start.linkToken, code: wrong }),
      ).toEqual({ ok: false, reason: 'locked' });
      expect(
        await phone.pair({ linkToken: start.linkToken, code: start.code }),
      ).toEqual({ ok: false, reason: 'locked' });
    });

    it('expires, and "Add 15 min" stops at two hours', async () => {
      const t0 = new Date();
      const start = await phone.start(pc, t0);
      const paired = await phone.pair(
        { linkToken: start.linkToken, code: start.code },
        t0,
      );
      if (!paired.ok) throw new Error('did not pair');
      let view = await phone.view(pc, start.id, t0);
      for (let i = 0; i < 10; i++) view = await phone.extend(pc, start.id, t0);
      expect(new Date(view.expiresAt).getTime()).toBe(t0.getTime() + 120 * MIN);
      expect(view.canExtend).toBe(false);

      const later = new Date(t0.getTime() + 121 * MIN);
      expect(
        (
          await phone.scan(
            { phoneToken: paired.phoneToken, code: barcode },
            later,
          )
        ).result,
      ).toBe('ended');
      expect((await phone.view(pc, start.id, later)).status).toBe('ENDED');
    });

    it('a new link stops the old unused one', async () => {
      const first = await phone.start(pc);
      await phone.start(pc);
      expect(
        await phone.pair({ linkToken: first.linkToken, code: first.code }),
      ).toEqual({ ok: false, reason: 'expired' });
    });
    it('links an unknown code to an item, keeps the barcode, merges lines', async () => {
      const start = await phone.start(pc);
      const paired = await phone.pair({
        linkToken: start.linkToken,
        code: start.code,
      });
      if (!paired.ok) throw new Error('did not pair');
      const { phoneToken } = paired;
      const unknown = `NEW-${token().toUpperCase()}`;
      await phone.scan({ phoneToken, code: barcode });
      await phone.scan({ phoneToken, code: unknown });
      await phone.scan({ phoneToken, code: unknown });

      let view = await phone.view(pc, start.id);
      const line = view.lines.find((l) => l.code === unknown);
      expect(line?.item).toBeNull();
      const suggestion = await phone.suggest(pc, start.id, line?.id ?? '');
      expect(suggestion.partNo).toBe(unknown);
      expect(suggestion.source).toBe('barcode');

      // Linking to the item that already has a line adds the quantities.
      const editor: Policy = {
        ...pc,
        permissions: new Map([
          ...pc.permissions,
          ['inventory.item.edit', { scope: 'ALL' as const, storeIds: [] }],
        ]),
      };
      view = await phone.link(editor, start.id, line?.id ?? '', {
        itemId,
        saveBarcode: true,
      });
      expect(view.lines).toHaveLength(1);
      expect(view.lines[0]?.qty).toBe('3');
      const saved = await prisma.itemBarcode.findUnique({
        where: { code: unknown },
      });
      expect(saved?.itemId).toBe(itemId);

      // Next scan of that code finds the item straight away.
      expect((await phone.scan({ phoneToken, code: unknown })).result).toBe(
        'added',
      );

      // Saving a barcode needs the edit permission.
      const other = `NEW-${token().toUpperCase()}`;
      await phone.scan({ phoneToken, code: other });
      view = await phone.view(pc, start.id);
      const otherLine = view.lines.find((l) => l.code === other);
      await expect(
        phone.link(pc, start.id, otherLine?.id ?? '', {
          itemId,
          saveBarcode: true,
        }),
      ).rejects.toThrow();
    });
  },
);
