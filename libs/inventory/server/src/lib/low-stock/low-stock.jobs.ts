import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type BelowMinRow,
  REPORT_CSV_ROW_LIMIT,
} from '@dax/inventory-contract';
import {
  type EventContext,
  EventBus,
  InboxService,
  type JobContext,
  MAILER,
  type Mailer,
  PUBLIC_ORIGINS,
  type PublicOrigins,
  type Recipient,
  Scheduled,
  Subscribe,
} from '@dax/platform-core';
import type { TransactionClient } from '@dax/platform-db';
import { MainStore } from '../main-store.service';
import { belowMinReport } from '../reports/below-min';
import { lowStockAlertEmail, lowStockReportEmail } from './events';
import {
  lowStockAlertEmail as alertMessage,
  lowStockReportEmail as reportMessage,
  REPORT_PATH,
} from './low-stock-email';
import { loadSettings, SETTINGS_ID } from './low-stock-settings.service';
import { reportDue } from './schedule';

export const HEAD_PERMISSION = 'core.department.head';
export const EMAIL_PERMISSION = 'inventory.low_stock.email';
export const INBOX_KIND = 'inventory.low_stock';
/** More new low parts than this in one run become a single inbox message. */
export const ONE_BY_ONE_LIMIT = 10;
const REPORT_EMAIL_ROWS = 200;
const NAMES_IN_SUMMARY = 5;

interface Opened {
  alertId: string;
  row: BelowMinRow;
}

function partName(row: BelowMinRow): string {
  return `${row.item.partNo} (${row.item.brand})`;
}

function summaryBody(opened: readonly Opened[]): string {
  const names = opened.slice(0, NAMES_IN_SUMMARY).map((o) => partName(o.row));
  const rest = opened.length - names.length;
  return `Free stock is under the minimum for ${names.join(', ')}${rest > 0 ? ` and ${rest} more` : ''}.`;
}

@Injectable()
export class LowStockJobs {
  private readonly logger = new Logger('LowStock');

  constructor(
    private readonly store: MainStore,
    private readonly inbox: InboxService,
    private readonly events: EventBus,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(PUBLIC_ORIGINS) private readonly origins: PublicOrigins,
  ) {}

  @Scheduled({ name: 'inventory.low_stock', everySeconds: 300 })
  async alerts(ctx: JobContext): Promise<void> {
    const { tx, now } = ctx;
    const storeId = await this.store.id();
    const low = await belowMinReport(tx, storeId, REPORT_CSV_ROW_LIMIT);
    const lowIds = new Set(low.items.map((r) => r.item.id));
    const open = await tx.lowStockAlert.findMany({
      where: { storeId, clearedAt: null },
      select: { id: true, itemId: true },
    });
    const openIds = new Set(open.map((a) => a.itemId));

    // A cut-off list cannot tell recovered parts from unlisted ones.
    if (low.truncated) {
      this.logger.warn(
        { shown: low.items.length },
        'Too many parts below minimum to clear alerts',
      );
    } else {
      const recovered = open
        .filter((a) => !lowIds.has(a.itemId))
        .map((a) => a.id);
      if (recovered.length) {
        await tx.lowStockAlert.updateMany({
          where: { id: { in: recovered } },
          data: { clearedAt: now },
        });
      }
    }

    const opened: Opened[] = [];
    for (const row of low.items) {
      if (openIds.has(row.item.id)) continue;
      const alert = await tx.lowStockAlert.create({
        data: { itemId: row.item.id, storeId, openedAt: now },
        select: { id: true },
      });
      opened.push({ alertId: alert.id, row });
    }
    if (opened.length === 0) return;

    const heads = await this.inbox.recipients(HEAD_PERMISSION, { now });
    await this.notify(tx, heads, opened);

    const settings = await loadSettings(tx);
    if (!settings.instantEmail) return;
    for (const user of await this.emailable(heads, now)) {
      await this.events.publish(tx, lowStockAlertEmail, {
        userId: user.userId,
        alertIds: opened.map((o) => o.alertId),
      });
    }
  }

  @Scheduled({ name: 'inventory.low_stock_report', everySeconds: 300 })
  async weeklyReport(ctx: JobContext): Promise<void> {
    const { tx, now } = ctx;
    const settings = await loadSettings(tx);
    if (!reportDue(settings, now)) return;
    const heads = await this.inbox.recipients(HEAD_PERMISSION, { now });
    const storeId = await this.store.id();
    const low = await belowMinReport(tx, storeId, 1);
    if (low.items.length > 0) {
      for (const user of await this.emailable(heads, now)) {
        await this.events.publish(tx, lowStockReportEmail, {
          userId: user.userId,
        });
      }
    }
    await tx.lowStockSettings.update({
      where: { id: SETTINGS_ID },
      data: { lastReportAt: now },
    });
  }

  @Subscribe(lowStockAlertEmail)
  async sendAlert(
    payload: { userId: string; alertIds: string[] },
    ctx: EventContext,
  ): Promise<void> {
    const user = await this.activeUser(ctx.tx, payload.userId);
    if (!user) return;
    const alerts = await ctx.tx.lowStockAlert.findMany({
      where: { id: { in: payload.alertIds }, clearedAt: null },
      select: { itemId: true, storeId: true },
    });
    if (alerts.length === 0) return;
    const itemIds = new Set(alerts.map((a) => a.itemId));
    const low = await belowMinReport(
      ctx.tx,
      alerts[0].storeId,
      REPORT_CSV_ROW_LIMIT,
    );
    const rows = low.items.filter((r) => itemIds.has(r.item.id));
    if (rows.length === 0) return;
    await this.mailer.send(alertMessage(user, rows, this.origins.web));
  }

  @Subscribe(lowStockReportEmail)
  async sendReport(
    payload: { userId: string },
    ctx: EventContext,
  ): Promise<void> {
    const user = await this.activeUser(ctx.tx, payload.userId);
    if (!user) return;
    const low = await belowMinReport(
      ctx.tx,
      await this.store.id(),
      REPORT_EMAIL_ROWS,
    );
    if (low.items.length === 0) return;
    await this.mailer.send(reportMessage(user, low, this.origins.web));
  }

  private async notify(
    tx: TransactionClient,
    heads: readonly Recipient[],
    opened: readonly Opened[],
  ): Promise<void> {
    const userIds = heads.map((h) => h.userId);
    if (userIds.length === 0) return;
    if (opened.length > ONE_BY_ONE_LIMIT) {
      await this.inbox.deliver(tx, {
        userIds,
        kind: INBOX_KIND,
        title: `${opened.length} parts went below minimum`,
        body: summaryBody(opened),
        link: REPORT_PATH,
        sourceKey: `low_stock:${opened[0].alertId}:batch`,
      });
      return;
    }
    for (const { alertId, row } of opened) {
      await this.inbox.deliver(tx, {
        userIds,
        kind: INBOX_KIND,
        title: `${partName(row)} is below minimum`,
        body: `${row.item.description}. Free ${row.free} of minimum ${row.minQty} ${row.item.uom}, short by ${row.shortBy}.`,
        link: `/inventory/items/${row.item.id}`,
        sourceKey: `low_stock:${alertId}`,
      });
    }
  }

  private async emailable(
    heads: readonly Recipient[],
    now: Date,
  ): Promise<Recipient[]> {
    if (heads.length === 0) return [];
    const allowed = new Set(
      (await this.inbox.recipients(EMAIL_PERMISSION, { now })).map(
        (r) => r.userId,
      ),
    );
    return heads.filter((h) => allowed.has(h.userId));
  }

  private activeUser(tx: TransactionClient, id: string) {
    return tx.user.findFirst({
      where: { id, active: true },
      select: { email: true, name: true },
    });
  }
}
