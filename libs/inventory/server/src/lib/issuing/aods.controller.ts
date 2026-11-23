import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  StreamableFile,
} from '@nestjs/common';
import {
  AodCreate,
  type AodDto,
  type AodPage,
  AodQuery,
  AodReject,
  AodSign,
  AodTransition,
  AodUpdate,
} from '@dax/inventory-contract';
import { type DaxRequest, Requires, sessionOf } from '@dax/platform-core';
import { parse } from '../common';
import { AodsService } from './aods.service';

@Controller('inventory/aods')
export class AodsController {
  constructor(private readonly aods: AodsService) {}

  @Get()
  @Requires('inventory.aod.view')
  list(@Req() req: DaxRequest, @Query() query: unknown): Promise<AodPage> {
    return this.aods.list(sessionOf(req).policy, parse(AodQuery, query));
  }

  @Get(':id')
  @Requires('inventory.aod.view')
  get(
    @Req() req: DaxRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AodDto> {
    return this.aods.detail(sessionOf(req).policy, id);
  }

  @Get(':id/pdf')
  @Requires('inventory.aod.print')
  @Header('Cache-Control', 'no-store')
  async pdf(
    @Req() req: DaxRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('copy') copy: unknown,
  ): Promise<StreamableFile> {
    const which = copy === 'customer' ? 'customer' : 'dax';
    const { number, pdf } = await this.aods.pdf(
      sessionOf(req).policy,
      id,
      which,
    );
    const base = (number ?? 'aod').replace(/[^A-Za-z0-9-]+/g, '-');
    const name = which === 'customer' ? `${base}-customer` : base;
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: `inline; filename="${name}.pdf"`,
      length: pdf.length,
    });
  }

  @Post()
  @Requires('inventory.aod.issue')
  create(@Req() req: DaxRequest, @Body() body: unknown): Promise<AodDto> {
    return this.aods.create(sessionOf(req).policy, parse(AodCreate, body));
  }

  @Patch(':id')
  @Requires('inventory.aod.issue')
  update(
    @Req() req: DaxRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<AodDto> {
    return this.aods.update(sessionOf(req).policy, id, parse(AodUpdate, body));
  }

  @Post(':id/submit')
  @Requires('inventory.aod.issue')
  submit(
    @Req() req: DaxRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<AodDto> {
    const { version } = parse(AodTransition, body);
    return this.aods.submit(sessionOf(req).policy, id, version);
  }

  @Post(':id/withdraw')
  @Requires('inventory.aod.issue')
  withdraw(
    @Req() req: DaxRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<AodDto> {
    const { version } = parse(AodTransition, body);
    return this.aods.withdraw(sessionOf(req).policy, id, version);
  }

  @Post(':id/approve')
  @Requires('inventory.aod.approve')
  approve(
    @Req() req: DaxRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<AodDto> {
    const { version } = parse(AodTransition, body);
    return this.aods.approve(sessionOf(req).policy, id, version);
  }

  @Post(':id/reject')
  @Requires('inventory.aod.approve')
  reject(
    @Req() req: DaxRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<AodDto> {
    return this.aods.reject(sessionOf(req).policy, id, parse(AodReject, body));
  }

  @Post(':id/issue')
  @Requires('inventory.aod.issue')
  issue(
    @Req() req: DaxRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<AodDto> {
    const { version } = parse(AodTransition, body);
    return this.aods.issue(sessionOf(req).policy, id, version);
  }

  @Post(':id/cancel')
  @Requires('inventory.aod.cancel')
  cancel(
    @Req() req: DaxRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<AodDto> {
    const { version } = parse(AodTransition, body);
    return this.aods.cancel(sessionOf(req).policy, id, version);
  }

  @Post(':id/sign')
  @Requires('inventory.aod.attach_signed')
  sign(
    @Req() req: DaxRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<AodDto> {
    return this.aods.sign(sessionOf(req).policy, id, parse(AodSign, body));
  }
}
