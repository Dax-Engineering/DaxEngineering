import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  PhoneScanCode,
  PhoneScanLineUpdate,
  PhoneScanLink,
  PhoneScanPair,
  PhoneScanPcCode,
  type PhoneScanPaired,
  type PhoneScanReply,
  type PhoneScanStart,
  type PhoneScanState,
  type PhoneScanSuggestion,
  type PhoneScanView,
} from '@dax/inventory-contract';
import {
  type DaxRequest,
  Public,
  Requires,
  sessionOf,
} from '@dax/platform-core';
import { z } from 'zod';
import { parse } from '../common';
import { PhoneScanService } from './phone-scan.service';

const PhoneToken = z.strictObject({ phoneToken: z.string().min(16).max(128) });
const PhotoFields = PhoneToken.extend({ lineId: z.uuid() });
/** Phones shrink label photos before sending; this is a generous cap. */
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

@Controller('inventory/phone-scans')
export class PhoneScanController {
  constructor(private readonly phone: PhoneScanService) {}

  // PC side: the signed-in user who lends their access to a phone.

  @Post()
  @Requires('inventory.phone_scan.use')
  @Header('Cache-Control', 'no-store')
  start(@Req() req: DaxRequest): Promise<PhoneScanStart> {
    return this.phone.start(sessionOf(req).policy);
  }

  @Get(':id')
  @Requires('inventory.phone_scan.use')
  @Header('Cache-Control', 'no-store')
  view(
    @Req() req: DaxRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PhoneScanView> {
    return this.phone.view(sessionOf(req).policy, id);
  }

  @Post(':id/extend')
  @Requires('inventory.phone_scan.use')
  @HttpCode(200)
  extend(
    @Req() req: DaxRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PhoneScanView> {
    return this.phone.extend(sessionOf(req).policy, id);
  }

  @Post(':id/end')
  @Requires('inventory.phone_scan.use')
  @HttpCode(200)
  end(
    @Req() req: DaxRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PhoneScanView> {
    return this.phone.end(sessionOf(req).policy, id);
  }

  @Patch(':id/lines/:lineId')
  @Requires('inventory.phone_scan.use')
  setQty(
    @Req() req: DaxRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body() body: unknown,
  ): Promise<PhoneScanView> {
    const { qty } = parse(PhoneScanLineUpdate, body);
    return this.phone.setQty(sessionOf(req).policy, id, lineId, qty);
  }

  @Delete(':id/lines/:lineId')
  @Requires('inventory.phone_scan.use')
  removeLine(
    @Req() req: DaxRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
  ): Promise<PhoneScanView> {
    return this.phone.removeLine(sessionOf(req).policy, id, lineId);
  }

  @Post(':id/scan')
  @Requires('inventory.phone_scan.use')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  scanFromPc(
    @Req() req: DaxRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<PhoneScanReply> {
    return this.phone.scanFromPc(
      sessionOf(req).policy,
      id,
      parse(PhoneScanPcCode, body),
    );
  }

  @Get(':id/lines/:lineId/suggest')
  @Requires('inventory.phone_scan.use')
  @Header('Cache-Control', 'no-store')
  suggest(
    @Req() req: DaxRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
  ): Promise<PhoneScanSuggestion> {
    return this.phone.suggest(sessionOf(req).policy, id, lineId);
  }

  @Post(':id/lines/:lineId/link')
  @Requires('inventory.phone_scan.use')
  @HttpCode(200)
  link(
    @Req() req: DaxRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body() body: unknown,
  ): Promise<PhoneScanView> {
    return this.phone.link(
      sessionOf(req).policy,
      id,
      lineId,
      parse(PhoneScanLink, body),
    );
  }

  // Phone side: no sign-in. Reachable only through the web app (internal
  // token), and only with the link token + code, then the phone token.

  @Post('pair')
  @Public()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  pair(@Body() body: unknown): Promise<PhoneScanPaired> {
    return this.phone.pair(parse(PhoneScanPair, body));
  }

  @Post('state')
  @Public()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  state(@Body() body: unknown): Promise<PhoneScanState> {
    return this.phone.state(parse(PhoneToken, body).phoneToken);
  }

  @Post('scan')
  @Public()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  scan(@Body() body: unknown): Promise<PhoneScanReply> {
    return this.phone.scan(parse(PhoneScanCode, body));
  }

  @Post('photo')
  @Public()
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_PHOTO_BYTES, files: 1, fields: 3, parts: 4 },
    }),
  )
  photo(
    @Body() body: unknown,
    @UploadedFile() file: { buffer: Buffer; originalname?: string } | undefined,
  ): Promise<{ ok: boolean }> {
    const fields = parse(PhotoFields, body);
    if (!file) return Promise.resolve({ ok: false });
    return this.phone.photo(fields.phoneToken, fields.lineId, file);
  }
}
