import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  StreamableFile,
} from '@nestjs/common';
import {
  type SerialDto,
  SerialLabelRequest,
  type SerialPage,
  SerialQuery,
} from '@dax/inventory-contract';
import {
  Authenticated,
  can,
  type DaxRequest,
  Requires,
  sessionOf,
} from '@dax/platform-core';
import { parse } from '../common';
import { SerialsService } from './serials.service';

/** Anyone receiving, putting away or labelling parts may print serial labels. */
export const SERIAL_LABEL_PERMISSIONS = [
  'inventory.grn.post',
  'inventory.grn.putaway',
  'inventory.item.print_label',
] as const;

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
  @Authenticated()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async labels(
    @Req() req: DaxRequest,
    @Body() body: unknown,
  ): Promise<StreamableFile> {
    const { policy } = sessionOf(req);
    if (!SERIAL_LABEL_PERMISSIONS.some((p) => can(policy, p))) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: "You don't have access to this.",
      });
    }
    const pdf = await this.serials.labels(parse(SerialLabelRequest, body));
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: 'inline; filename="serial-labels.pdf"',
      length: pdf.length,
    });
  }
}
