import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  type BundleDto,
  BundleInput,
  type BundlePage,
  BundleQuery,
  BundleStatusInput,
  BundleUpdate,
} from '@dax/inventory-contract';
import { type DaxRequest, Requires, sessionOf } from '@dax/platform-core';
import { parse } from '../common';
import { BundlesService } from './bundles.service';

@Controller('inventory/bundles')
export class BundlesController {
  constructor(private readonly bundles: BundlesService) {}

  @Get()
  @Requires('inventory.bundle.view')
  list(@Query() query: unknown): Promise<BundlePage> {
    return this.bundles.list(parse(BundleQuery, query));
  }

  @Get(':id')
  @Requires('inventory.bundle.view')
  detail(@Param('id', ParseUUIDPipe) id: string): Promise<BundleDto> {
    return this.bundles.detail(id);
  }

  @Post()
  @Requires('inventory.bundle.manage')
  create(@Req() req: DaxRequest, @Body() body: unknown): Promise<BundleDto> {
    return this.bundles.create(
      sessionOf(req).user.id,
      parse(BundleInput, body),
    );
  }

  @Patch(':id')
  @Requires('inventory.bundle.manage')
  update(
    @Req() req: DaxRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<BundleDto> {
    return this.bundles.update(
      sessionOf(req).user.id,
      id,
      parse(BundleUpdate, body),
    );
  }

  @Post(':id/status')
  @Requires('inventory.bundle.manage')
  status(
    @Req() req: DaxRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<BundleDto> {
    return this.bundles.setActive(
      sessionOf(req).user.id,
      id,
      parse(BundleStatusInput, body),
    );
  }
}
