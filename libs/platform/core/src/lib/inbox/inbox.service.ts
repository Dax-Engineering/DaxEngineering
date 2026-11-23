import { Injectable } from '@nestjs/common';
import type {
  InboxMessageDto,
  InboxPage,
  InboxQuery,
} from '@dax/platform-contract';
import { pageMeta, pageWindow } from '@dax/contracts';
import {
  type Prisma,
  PrismaService,
  type TransactionClient,
} from '@dax/platform-db';
import { can, grantOf } from '../acm/policy';
import { PolicyService } from '../acm/policy.service';

type Db = PrismaService | TransactionClient;

export interface InboxDelivery {
  userIds: readonly string[];
  kind: string;
  title: string;
  body: string;
  link?: string | null;
  sourceKey: string;
}

export interface Recipient {
  userId: string;
  name: string;
  email: string;
}

const MESSAGE_SELECT = {
  id: true,
  kind: true,
  title: true,
  body: true,
  link: true,
  createdAt: true,
  readAt: true,
  doneAt: true,
} as const satisfies Prisma.InboxMessageSelect;

type MessageRow = Prisma.InboxMessageGetPayload<{
  select: typeof MESSAGE_SELECT;
}>;

function toDto(row: MessageRow): InboxMessageDto {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
    doneAt: row.doneAt?.toISOString() ?? null,
  };
}

@Injectable()
export class InboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policies: PolicyService,
  ) {}

  async deliver(db: Db, delivery: InboxDelivery): Promise<number> {
    if (delivery.userIds.length === 0) return 0;
    const result = await db.inboxMessage.createMany({
      data: [...new Set(delivery.userIds)].map((userId) => ({
        userId,
        kind: delivery.kind,
        title: delivery.title,
        body: delivery.body,
        link: delivery.link ?? null,
        sourceKey: delivery.sourceKey,
      })),
      skipDuplicates: true,
    });
    return result.count;
  }

  /**
   * Active users granted the permission by a non-super-admin role or a GRANT override;
   * super admin's implied access does not count. With `departmentId`, only those whose
   * scope covers that department.
   */
  async recipients(
    permissionKey: string,
    options: { now?: Date; departmentId?: string } = {},
  ): Promise<Recipient[]> {
    const now = options.now ?? new Date();
    const candidates = await this.prisma.user.findMany({
      where: {
        active: true,
        OR: [
          {
            roles: {
              some: {
                OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
                role: {
                  archivedAt: null,
                  isSuperAdmin: false,
                  permissions: { some: { permissionKey } },
                },
              },
            },
          },
          {
            overrides: {
              some: {
                permissionKey,
                effect: 'GRANT',
                OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
              },
            },
          },
        ],
      },
      select: { id: true, name: true, email: true },
      orderBy: { id: 'asc' },
    });
    const found: Recipient[] = [];
    for (const user of candidates) {
      const policy = await this.policies.forUser(user.id, now);
      if (!can(policy, permissionKey)) continue;
      if (options.departmentId) {
        const scope = grantOf(policy, permissionKey)?.scope;
        const inScope =
          scope === 'ALL' ||
          (scope === 'DEPARTMENT' &&
            policy.departmentIds.includes(options.departmentId));
        if (!inScope) continue;
      }
      found.push({ userId: user.id, name: user.name, email: user.email });
    }
    return found;
  }

  /** Marks every recipient's copy of a message done, e.g. once someone has acted on it. */
  async close(db: Db, sourceKey: string, now = new Date()): Promise<number> {
    const result = await db.inboxMessage.updateMany({
      where: { sourceKey, doneAt: null },
      data: { doneAt: now },
    });
    return result.count;
  }

  async list(userId: string, query: InboxQuery): Promise<InboxPage> {
    const where: Prisma.InboxMessageWhereInput = {
      userId,
      doneAt: query.tab === 'open' ? null : { not: null },
    };
    const [rows, total] = await Promise.all([
      this.prisma.inboxMessage.findMany({
        where,
        select: MESSAGE_SELECT,
        orderBy: [
          query.tab === 'open' ? { createdAt: 'desc' } : { doneAt: 'desc' },
          { id: 'desc' },
        ],
        ...pageWindow(query),
      }),
      this.prisma.inboxMessage.count({ where }),
    ]);
    return { items: rows.map(toDto), ...pageMeta(query, total) };
  }

  unread(userId: string): Promise<number> {
    return this.prisma.inboxMessage.count({
      where: { userId, doneAt: null, readAt: null },
    });
  }

  async markRead(userId: string, id: string): Promise<boolean> {
    const found = await this.prisma.inboxMessage.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    return found.count > 0 || (await this.owns(userId, id));
  }

  async markDone(userId: string, id: string): Promise<boolean> {
    const now = new Date();
    const found = await this.prisma.inboxMessage.updateMany({
      where: { id, userId, doneAt: null },
      data: { doneAt: now },
    });
    if (found.count > 0) {
      await this.prisma.inboxMessage.updateMany({
        where: { id, userId, readAt: null },
        data: { readAt: now },
      });
      return true;
    }
    return this.owns(userId, id);
  }

  private async owns(userId: string, id: string): Promise<boolean> {
    return (
      (await this.prisma.inboxMessage.count({ where: { id, userId } })) > 0
    );
  }
}
