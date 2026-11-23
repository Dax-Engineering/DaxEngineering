import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  Req,
  StreamableFile,
} from '@nestjs/common';
import {
  type ItemAge,
  ItemAgeQuery,
  StockAgeQuery,
  type StockAgeReport,
  type StockAgeSettingsDto,
  StockAgeSettingsInput,
} from '@dax/inventory-contract';
import { type DaxRequest, Requires, sessionOf } from '@dax/platform-core';
import { parse } from '../common';
import { StockAgeService } from './stock-age.service';

@Controller('inventory')
export class StockAgeController {
  constructor(private readonly service: StockAgeService) {}

  @Get('reports/stock-age')
  @Requires('inventory.stock.view')
  report(@Query() query: unknown): Promise<StockAgeReport> {
    return this.service.report(parse(StockAgeQuery, query));
  }

  @Get('reports/stock-age/csv')
  @Requires('inventory.stock.export')
  @Header('Cache-Control', 'no-store')
  async csv(@Query() query: unknown): Promise<StreamableFile> {
    const file = await this.service.csv(parse(StockAgeQuery, query));
    const body = Buffer.from(file.text, 'utf8');
    return new StreamableFile(body, {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="${file.name}"`,
      length: body.length,
    });
  }

  @Get('reports/stock-age/settings')
  @Requires('inventory.stock_age.settings')
  settings(): Promise<StockAgeSettingsDto> {
    return this.service.settings();
  }

  @Put('reports/stock-age/settings')
  @Requires('inventory.stock_age.settings')
  updateSettings(
    @Req() req: DaxRequest,
    @Body() body: unknown,
  ): Promise<StockAgeSettingsDto> {
    return this.service.updateSettings(
      parse(StockAgeSettingsInput, body),
      sessionOf(req).user.id,
    );
  }

  @Get('items/:id/age')
  @Requires('inventory.stock.view')
  item(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: unknown,
  ): Promise<ItemAge> {
    return this.service.item(id, parse(ItemAgeQuery, query));
  }
}
