import { Injectable } from '@nestjs/common';
import type {
  LowStockSettingsDto,
  LowStockSettingsInput,
} from '@dax/inventory-contract';
import { AuditService } from '@dax/platform-core';
import {
  type Prisma,
  PrismaService,
  type TransactionClient,
} from '@dax/platform-db';
import { MODULE_KEY, stale } from '../common';

type Db = PrismaService | TransactionClient;
type SettingsRow = Prisma.LowStockSettingsModel;

export const SETTINGS_ID = 1;

export async function loadSettings(db: Db): Promise<SettingsRow> {
  return db.lowStockSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID },
    update: {},
  });
}

function toDto(row: SettingsRow): LowStockSettingsDto {
  return {
    reportWeekday: row.reportWeekday,
    reportTime: row.reportTime,
    instantEmail: row.instantEmail,
    lastReportAt: row.lastReportAt?.toISOString() ?? null,
    version: row.version,
  };
}

function audited(row: SettingsRow) {
  return {
    reportWeekday: row.reportWeekday,
    reportTime: row.reportTime,
    instantEmail: row.instantEmail,
  };
}

@Injectable()
export class LowStockSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<LowStockSettingsDto> {
    return toDto(await loadSettings(this.prisma));
  }

  async update(
    input: LowStockSettingsInput,
    actorId: string,
  ): Promise<LowStockSettingsDto> {
    return this.prisma.$transaction(async (tx) => {
      const before = await loadSettings(tx);
      const { count } = await tx.lowStockSettings.updateMany({
        where: { id: SETTINGS_ID, version: input.version },
        data: {
          reportWeekday: input.reportWeekday,
          reportTime: input.reportTime,
          instantEmail: input.instantEmail,
          updatedBy: actorId,
          version: { increment: 1 },
        },
      });
      if (count === 0) stale();
      const after = await loadSettings(tx);
      await this.audit.record(
        {
          moduleKey: MODULE_KEY,
          entityKey: 'inventory.low_stock_settings',
          entityId: String(SETTINGS_ID),
          action: 'update',
          before: audited(before),
          after: audited(after),
        },
        tx,
      );
      return toDto(after);
    });
  }
}
