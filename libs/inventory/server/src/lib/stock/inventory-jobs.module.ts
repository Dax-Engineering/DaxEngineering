import { Module } from '@nestjs/common';
import { LowStockJobs } from '../low-stock/low-stock.jobs';
import { MainStore } from '../main-store.service';
import {
  ExistingSerialsJob,
  StockAgeRebuildJob,
  StockReconcileJob,
} from './reconcile';

@Module({
  providers: [
    MainStore,
    StockReconcileJob,
    StockAgeRebuildJob,
    ExistingSerialsJob,
    LowStockJobs,
  ],
})
export class InventoryJobsModule {}
