import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import {
  type SerialDto,
  SerialLabelRequest,
  type SerialPage,
  SerialQuery,
} from '@dax/inventory-contract';
import { Requires } from '@dax/platform-core';
import { parse } from '../common';
import { SerialsService } from './serials.service';

@Controller('inventory')
export class SerialsController {
  constructor(private readonly serials: SerialsService) {}

  @Get('serials/:serial')
  @Requires('inventory.item.view')
  bySerial(@Param('serial') serial: string): Promise<SerialDto> {
    return this.serials.bySerial(serial);
  }

  @Get('items/:id/serials')
  @Requires('inventory.item.view')
  forItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: unknown,
  ): Promise<SerialPage> {
    return this.serials.forItem(id, parse(SerialQuery, query));
  }

  @Post('labels/serials')
  @Requires('inventory.serial.print_label')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async labels(@Body() body: unknown): Promise<StreamableFile> {
    const pdf = await this.serials.labels(parse(SerialLabelRequest, body));
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: 'inline; filename="serial-labels.pdf"',
      length: pdf.length,
    });
  }
}
