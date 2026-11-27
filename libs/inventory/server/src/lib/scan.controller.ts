import { Controller, Get, Header, Query, Req } from '@nestjs/common';
import type { ScanResult } from '@dax/inventory-contract';
import {
  Authenticated,
  type DaxRequest,
  RateLimit,
  sessionOf,
} from '@dax/platform-core';
import { ScanService } from './scan.service';

const MAX_CODE_LENGTH = 512;

@Controller('inventory')
export class ScanController {
  constructor(private readonly scan: ScanService) {}

  @Get('scan')
  @RateLimit(120)
  @Authenticated()
  @Header('Cache-Control', 'no-store')
  resolve(
    @Req() req: DaxRequest,
    @Query('code') code: unknown,
  ): Promise<ScanResult> | ScanResult {
    if (typeof code !== 'string' || code.length > MAX_CODE_LENGTH)
      return { type: 'none' };
    return this.scan.resolve(sessionOf(req).policy, code);
  }
}
