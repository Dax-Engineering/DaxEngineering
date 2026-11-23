import { Controller, Get } from '@nestjs/common';
import type { InventorySummary } from '@dax/inventory-contract';
import { Requires } from '@dax/platform-core';
import { PrismaService } from '@dax/platform-db';
import { belowMinIds } from './item-queries';
import { MainStore } from './main-store.service';
import { StockAgeService } from './reports/stock-age.service';

@Controller('inventory/summary')
export class SummaryController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: MainStore,
    private readonly age: StockAgeService,
  ) {}

  @Get()
  @Requires('inventory.item.view')
  async summary(): Promise<InventorySummary> {
    const storeId = await this.store.id();
    const [items, low, inStock, bins, zones, brands, aged] = await Promise.all([
      this.prisma.item.count({ where: { status: 'ACTIVE' } }),
      belowMinIds(this.prisma, storeId),
      this.prisma.stockBalance.count({ where: { storeId, onHand: { gt: 0 } } }),
      this.prisma.bin.count({ where: { storeId, active: true } }),
      this.prisma.zone.count({ where: { storeId, active: true } }),
      this.prisma.brand.count({ where: { active: true } }),
      this.age.agedOver(),
    ]);
    return {
      items,
      belowMin: low.length,
      agedOver: aged.count,
      agedLimit: aged.limit,
      inStock,
      bins,
      zones,
      brands,
    };
  }
}
