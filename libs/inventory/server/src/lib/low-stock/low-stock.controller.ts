import { Body, Controller, Get, Put, Req } from '@nestjs/common';
import {
  type LowStockSettingsDto,
  LowStockSettingsInput,
} from '@dax/inventory-contract';
import { type DaxRequest, Requires, sessionOf } from '@dax/platform-core';
import { parse } from '../common';
import { LowStockSettingsService } from './low-stock-settings.service';

@Controller('inventory/low-stock/settings')
export class LowStockController {
  constructor(private readonly settings: LowStockSettingsService) {}

  @Get()
  @Requires('inventory.low_stock.settings')
  get(): Promise<LowStockSettingsDto> {
    return this.settings.get();
  }

  @Put()
  @Requires('inventory.low_stock.settings')
  update(
    @Req() req: DaxRequest,
    @Body() body: unknown,
  ): Promise<LowStockSettingsDto> {
    return this.settings.update(
      parse(LowStockSettingsInput, body),
      sessionOf(req).user.id,
    );
  }
}
