import {
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  type InboxCount,
  type InboxPage,
  InboxQuery,
} from '@dax/platform-contract';
import { parse } from '../admin/common';
import type { DaxRequest } from '../auth/internal-caller';
import { Authenticated, sessionOf } from '../auth/session.guard';
import { InboxService } from './inbox.service';

function missing(): never {
  throw new NotFoundException({
    code: 'NOT_FOUND',
    message: 'That message is no longer in your inbox.',
  });
}

@Controller('me/inbox')
@Authenticated()
export class InboxController {
  constructor(private readonly inbox: InboxService) {}

  @Get()
  list(@Req() req: DaxRequest, @Query() query: unknown): Promise<InboxPage> {
    return this.inbox.list(sessionOf(req).user.id, parse(InboxQuery, query));
  }

  @Get('count')
  async count(@Req() req: DaxRequest): Promise<InboxCount> {
    return { unread: await this.inbox.unread(sessionOf(req).user.id) };
  }

  @Post(':id/read')
  @HttpCode(204)
  async read(
    @Req() req: DaxRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    if (!(await this.inbox.markRead(sessionOf(req).user.id, id))) missing();
  }

  @Post(':id/done')
  @HttpCode(204)
  async done(
    @Req() req: DaxRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    if (!(await this.inbox.markDone(sessionOf(req).user.id, id))) missing();
  }
}
