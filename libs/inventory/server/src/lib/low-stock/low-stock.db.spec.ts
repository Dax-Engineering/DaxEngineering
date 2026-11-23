import { randomBytes, randomUUID } from 'node:crypto';
import {
  EventBus,
  InboxService,
  type MailMessage,
  PolicyService,
  type RequestContext,
} from '@dax/platform-core';
import { PrismaService } from '@dax/platform-db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MainStore } from '../main-store.service';
import { StockPostingService } from '../stock/stock-posting.service';
import { lowStockAlertEmail, lowStockReportEmail } from './events';
import {
  EMAIL_PERMISSION,
  HEAD_PERMISSION,
  LowStockJobs,
} from './low-stock.jobs';
import { SETTINGS_ID } from './low-stock-settings.service';

const url = process.env['TEST_DATABASE_URL'];
const ACTOR = '00000000-0000-0000-0000-000000000001';
const DAY_MS = 86_400_000;

describe.skipIf(!url)(
  'low-stock alerts against Postgres',
  { timeout: 60_000 },
  () => {
    let prisma: PrismaService;
    let engine: StockPostingService;
    let jobs: LowStockJobs;
    let itemId: string;
    let binId: string;
    let headOnly: string;
    let headWithEmail: string;
    let neither: string;
    let superOnly: string;
    let superHead: string;
    const sent: MailMessage[] = [];
    const token = () => randomBytes(8).toString('hex').slice(0, 12);

    const runAlerts = (now = new Date()) =>
      prisma.$transaction((tx) =>
        jobs.alerts({ name: 'inventory.low_stock', tx, now, lastRunAt: null }),
      );
    const openAlerts = () =>
      prisma.lowStockAlert.findMany({ where: { itemId, clearedAt: null } });
    const messagesFor = (userId: string) =>
      prisma.inboxMessage.findMany({
        where: { userId, link: `/inventory/items/${itemId}` },
      });
    const eventsFor = async (name: string, userId: string) =>
      (await prisma.outboxEvent.findMany({ where: { name } })).filter(
        (e) => (e.payload as { userId?: string }).userId === userId,
      );

    async function makeUser(label: string, keys: string[]): Promise<string> {
      const user = await prisma.user.create({
        data: { name: `${label} ${token()}`, email: `${token()}@test.invalid` },
      });
      if (keys.length) {
        const role = await prisma.role.create({
          data: {
            name: `Low stock ${label} ${token()}`,
            permissions: {
              create: keys.map((permissionKey) => ({
                permissionKey,
                scope: 'ALL' as const,
                storeIds: [],
              })),
            },
          },
        });
        await prisma.userRole.create({
          data: { userId: user.id, roleId: role.id },
        });
      }
      return user.id;
    }

    beforeAll(async () => {
      prisma = new PrismaService({
        url: url as string,
        applicationName: 'dax-test',
      });
      const store = new MainStore(prisma);
      const context = { get: () => ({}) } as unknown as RequestContext;
      engine = new StockPostingService(store, context);
      jobs = new LowStockJobs(
        store,
        new InboxService(prisma, new PolicyService(prisma)),
        new EventBus(),
        { send: async (m: MailMessage) => void sent.push(m) },
        {
          web: 'https://stores.test',
          admin: 'https://admin.test',
        },
      );

      for (const [key, name] of [
        ['core', 'Platform'],
        ['inventory', 'Stores & Inventory'],
      ] as const) {
        await prisma.module.upsert({
          where: { key },
          create: { key, name, enabled: true, dependsOn: [] },
          update: { enabled: true, removedAt: null },
        });
      }
      for (const [key, moduleKey, featureKey, action] of [
        [HEAD_PERMISSION, 'core', 'department', 'head'],
        [EMAIL_PERMISSION, 'inventory', 'low_stock', 'email'],
      ] as const) {
        await prisma.permission.upsert({
          where: { key },
          create: {
            key,
            moduleKey,
            featureKey,
            action,
            label: key,
            scopes: ['ALL'],
          },
          update: { removedAt: null },
        });
      }
      await prisma.lowStockSettings.upsert({
        where: { id: SETTINGS_ID },
        create: { id: SETTINGS_ID },
        update: { instantEmail: false },
      });

      headOnly = await makeUser('Head', [HEAD_PERMISSION]);
      headWithEmail = await makeUser('Head mail', [
        HEAD_PERMISSION,
        EMAIL_PERMISSION,
      ]);
      neither = await makeUser('Viewer', [EMAIL_PERMISSION]);
      const superRole = await prisma.role.create({
        data: { name: `Low stock super ${token()}`, isSuperAdmin: true },
      });
      superOnly = await makeUser('Super', []);
      superHead = await makeUser('Super head', []);
      for (const userId of [superOnly, superHead]) {
        await prisma.userRole.create({
          data: { userId, roleId: superRole.id },
        });
      }
      await prisma.userPermissionOverride.create({
        data: {
          userId: superHead,
          permissionKey: HEAD_PERMISSION,
          effect: 'GRANT',
          reason: 'Test',
        },
      });

      // Absorb parts other tests left below minimum, so the next run sees only ours.
      await runAlerts();

      const main = await prisma.store.findUniqueOrThrow({
        where: { code: 'MAIN' },
      });
      const zone = await prisma.zone.create({
        data: {
          storeId: main.id,
          code: token().slice(0, 4).toUpperCase(),
          name: 'Low stock zone',
        },
      });
      binId = (
        await prisma.bin.create({
          data: {
            storeId: main.id,
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
      const suffix = token().toUpperCase();
      const brand = await prisma.brand.create({
        data: { name: `Low ${suffix}` },
      });
      itemId = (
        await prisma.item.create({
          data: {
            partNo: `LS-${suffix}`,
            partNoNorm: `LS${suffix}`,
            brandId: brand.id,
            description: 'Low stock test part',
            uom: 'PCS',
            minQty: '5',
            qrToken: token(),
            createdBy: ACTOR,
            updatedBy: ACTOR,
          },
        })
      ).id;
    });

    afterAll(async () => {
      await prisma.lowStockSettings.update({
        where: { id: SETTINGS_ID },
        data: { instantEmail: false },
      });
      await prisma.$disconnect();
    });

    it('alerts department heads once when a part drops below minimum', async () => {
      await runAlerts();
      expect(await openAlerts()).toHaveLength(1);
      expect(await messagesFor(headOnly)).toHaveLength(1);
      expect(await messagesFor(headWithEmail)).toHaveLength(1);
      expect(await messagesFor(neither)).toHaveLength(0);
      expect(await messagesFor(superOnly)).toHaveLength(0);
      expect(await messagesFor(superHead)).toHaveLength(1);
      expect(
        await eventsFor(lowStockAlertEmail.name, headWithEmail),
      ).toHaveLength(0);

      await runAlerts();
      expect(await openAlerts()).toHaveLength(1);
      expect(await messagesFor(headOnly)).toHaveLength(1);
    });

    it('closes the alert when free stock recovers', async () => {
      await prisma.$transaction((tx) =>
        engine.post(
          tx,
          [
            {
              itemId,
              binId,
              qty: '10',
              movement: 'RECEIVE',
              docType: 'TEST',
              docId: randomUUID(),
            },
          ],
          ACTOR,
        ),
      );
      await runAlerts();
      expect(await openAlerts()).toHaveLength(0);
    });

    it('alerts again, and emails only heads with the email permission, when reserved stock leaves too little free', async () => {
      await prisma.lowStockSettings.update({
        where: { id: SETTINGS_ID },
        data: { instantEmail: true },
      });
      await prisma.$transaction((tx) =>
        engine.reserve(tx, {
          source: 'HOLD',
          sourceId: randomUUID(),
          sourceLineId: randomUUID(),
          itemId,
          qty: '8',
        }),
      );
      await runAlerts();
      const [alert] = await openAlerts();
      expect(alert).toBeDefined();
      expect(await messagesFor(headOnly)).toHaveLength(2);
      expect(await eventsFor(lowStockAlertEmail.name, headOnly)).toHaveLength(
        0,
      );
      const [event] = await eventsFor(lowStockAlertEmail.name, headWithEmail);
      expect(event?.payload).toMatchObject({ alertIds: [alert.id] });

      await prisma.$transaction((tx) =>
        jobs.sendAlert(
          { userId: headWithEmail, alertIds: [alert.id] },
          {
            eventId: randomUUID(),
            name: lowStockAlertEmail.name,
            occurredAt: new Date(),
            tx,
          },
        ),
      );
      const mail = sent.at(-1);
      expect(mail?.subject).toMatch(/^LS-.* is below minimum$/);
      expect(mail?.text).toContain('free 2 of minimum 5 PCS, short 3');
    });

    it('sends the weekly report once per send time', async () => {
      await prisma.$executeRaw`
        UPDATE inventory.low_stock_settings
        SET last_report_at = NULL, updated_at = now()
        WHERE id = ${SETTINGS_ID}`;
      const later = new Date(Date.now() + 8 * DAY_MS);
      const run = () =>
        prisma.$transaction((tx) =>
          jobs.weeklyReport({
            name: 'inventory.low_stock_report',
            tx,
            now: later,
            lastRunAt: null,
          }),
        );
      const before = (await eventsFor(lowStockReportEmail.name, headWithEmail))
        .length;
      await run();
      await run();
      expect(
        await eventsFor(lowStockReportEmail.name, headWithEmail),
      ).toHaveLength(before + 1);
      expect(await eventsFor(lowStockReportEmail.name, headOnly)).toHaveLength(
        0,
      );
      const settings = await prisma.lowStockSettings.findUniqueOrThrow({
        where: { id: SETTINGS_ID },
      });
      expect(settings.lastReportAt?.toISOString()).toBe(later.toISOString());
    });
  },
);
