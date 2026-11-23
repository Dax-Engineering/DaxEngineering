import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  type OnModuleInit,
} from '@nestjs/common';
import {
  PHONE_SCAN_MAX_ATTEMPTS,
  PHONE_SCAN_MAX_MINUTES,
  PHONE_SCAN_MINUTES,
  BarcodeInput,
  type CodeKind,
  type PhoneScanCode,
  type PhoneScanPcCode,
  type PhoneScanLink,
  type PhoneScanPair,
  type PhoneScanPaired,
  type PhoneScanReply,
  type PhoneScanStart,
  type PhoneScanState,
  type PhoneScanSuggestion,
  type PhoneScanView,
} from '@dax/inventory-contract';
import {
  AttachmentAccessRegistry,
  can,
  FilesService,
  type Policy,
  PolicyService,
} from '@dax/platform-core';
import { PrismaService } from '@dax/platform-db';
import { MODULE_KEY, newQrToken, notFound } from '../common';
import { ItemsService } from '../items.service';
import { MainStore } from '../main-store.service';
import { parseScanCode } from '../scan-code';
import { userNames } from '../receiving/shared';
import { ScanService } from '../scan.service';
import { qtyString } from '../stock-math';
import {
  companyPrefix,
  displayGtin,
  extractGtin,
  gtinForms,
  partNumberFrom,
} from './barcode-info';
import { OnlineLookup } from './online-lookup';

const NO_STOCK = { onHand: '0', free: '0', bins: 0 };

/** What a scanned code is, from its content alone. */
export function codeKind(code: string): CodeKind {
  if (extractGtin(code)) return /^\d+$/.test(code.trim()) ? 'product' : 'box';
  const parsed = parseScanCode(code);
  if (parsed.kind === 'text' && parsed.maybeToken) return 'dax';
  return partNumberFrom(code) ? 'part' : 'text';
}

/** Label photos taken on the phone are attachments of the scan line. */
export const PHONE_LINE_KEY = 'inventory.phone_scan_line';

const MINUTE = 60_000;

/** Tokens and codes are kept only as SHA-256 hashes. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** The code is salted with the link token, so equal codes never share a hash. */
export function codeHash(linkToken: string, code: string): string {
  return sha256(`${linkToken}:${code}`);
}

/** New end time for "Add 15 min": never past the session's maximum length. */
export function extendedUntil(
  expiresAt: Date,
  pairedAt: Date,
  now: Date,
): Date {
  const base = Math.max(expiresAt.getTime(), now.getTime());
  const cap = pairedAt.getTime() + PHONE_SCAN_MAX_MINUTES * MINUTE;
  return new Date(Math.min(base + PHONE_SCAN_MINUTES * MINUTE, cap));
}

const LINE_SELECT = {
  id: true,
  code: true,
  format: true,
  matches: true,
  qty: true,
  lastSeenAt: true,
  item: {
    select: {
      id: true,
      partNo: true,
      description: true,
      uom: true,
      brand: { select: { name: true } },
    },
  },
} as const;

type Session = {
  id: string;
  userId: string;
  status: 'WAITING' | 'PAIRED' | 'ENDED' | 'LOCKED';
  expiresAt: Date;
  pairedAt: Date | null;
};

/**
 * A phone used as a scanner for a PC user, for a short time. The PC starts a
 * session and shows a link and a 6-digit code; the phone opens the link,
 * types the code and gets a scan-only token. Every scan adds to one list the
 * PC watches. The phone never signs in and can do nothing else.
 */
@Injectable()
export class PhoneScanService implements OnModuleInit {
  private readonly logger = new Logger(PhoneScanService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policies: PolicyService,
    private readonly scans: ScanService,
    private readonly items: ItemsService,
    private readonly files: FilesService,
    private readonly attachments: AttachmentAccessRegistry,
    private readonly online: OnlineLookup,
    private readonly store: MainStore,
  ) {}

  onModuleInit(): void {
    // A line's photos belong to the PC user whose session it is.
    const mine = async (policy: Policy, lineId: string) =>
      (await this.prisma.phoneScanLine.count({
        where: { id: lineId, session: { userId: policy.userId } },
      })) > 0;
    this.attachments.register(PHONE_LINE_KEY, {
      moduleKey: MODULE_KEY,
      canView: mine,
      canAttach: mine,
    });
  }

  private async photos(lineIds: string[]): Promise<Map<string, string>> {
    if (lineIds.length === 0) return new Map();
    const rows = await this.prisma.attachment.findMany({
      where: {
        entityKey: PHONE_LINE_KEY,
        entityId: { in: lineIds },
        deletedAt: null,
      },
      select: { id: true, entityId: true },
      orderBy: { createdAt: 'asc' },
    });
    return new Map(rows.map((r) => [r.entityId, r.id]));
  }

  /** WAITING or PAIRED sessions past their time are closed when next read. */
  private async closeIfExpired<T extends Session>(row: T, now: Date) {
    if (
      (row.status === 'WAITING' || row.status === 'PAIRED') &&
      row.expiresAt <= now
    ) {
      await this.prisma.phoneScanSession.updateMany({
        where: { id: row.id, status: row.status },
        data: { status: 'ENDED', endedAt: now },
      });
      return { ...row, status: 'ENDED' as const };
    }
    return row;
  }

  async start(policy: Policy, now = new Date()): Promise<PhoneScanStart> {
    // One open link per user: an older link that was never used stops working.
    await this.prisma.phoneScanSession.updateMany({
      where: { userId: policy.userId, status: 'WAITING' },
      data: { status: 'ENDED', endedAt: now },
    });
    const linkToken = newQrToken(24);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = new Date(now.getTime() + PHONE_SCAN_MINUTES * MINUTE);
    const row = await this.prisma.phoneScanSession.create({
      data: {
        userId: policy.userId,
        linkTokenHash: sha256(linkToken),
        codeHash: codeHash(linkToken, code),
        expiresAt,
      },
      select: { id: true },
    });
    return { id: row.id, linkToken, code, expiresAt: expiresAt.toISOString() };
  }

  private async own(policy: Policy, id: string): Promise<Session> {
    const row = await this.prisma.phoneScanSession.findFirst({
      where: { id, userId: policy.userId },
      select: {
        id: true,
        userId: true,
        status: true,
        expiresAt: true,
        pairedAt: true,
      },
    });
    if (!row) notFound('Phone session not found.');
    return row;
  }

  /** On hand, free and bins holding stock, per item, in the main store. */
  private async stockOf(itemIds: string[]) {
    const out = new Map<
      string,
      { onHand: string; free: string; bins: number }
    >();
    if (itemIds.length === 0) return out;
    const storeId = await this.store.id();
    const [balances, bins] = await Promise.all([
      this.prisma.stockBalance.findMany({
        where: { storeId, itemId: { in: itemIds } },
        select: {
          itemId: true,
          onHand: true,
          held: true,
          quarantine: true,
          receiving: true,
        },
      }),
      this.prisma.binStock.groupBy({
        by: ['itemId'],
        where: {
          itemId: { in: itemIds },
          qty: { gt: 0 },
          bin: { storeId, kind: 'STORAGE' },
        },
        _count: { _all: true },
      }),
    ]);
    const binCount = new Map(bins.map((b) => [b.itemId, b._count._all]));
    for (const b of balances) {
      const free = b.onHand
        .minus(b.held)
        .minus(b.quarantine)
        .minus(b.receiving);
      out.set(b.itemId, {
        onHand: qtyString(b.onHand),
        free: qtyString(free.isNegative() ? 0 : free),
        bins: binCount.get(b.itemId) ?? 0,
      });
    }
    return out;
  }

  async view(
    policy: Policy,
    id: string,
    now = new Date(),
  ): Promise<PhoneScanView> {
    const row = await this.closeIfExpired(await this.own(policy, id), now);
    const lines = await this.prisma.phoneScanLine.findMany({
      where: { sessionId: id },
      select: LINE_SELECT,
      orderBy: [{ lastSeenAt: 'desc' }, { id: 'asc' }],
    });
    const itemIds = [
      ...new Set(lines.flatMap((l) => (l.item ? [l.item.id] : []))),
    ];
    const [photos, stock] = await Promise.all([
      this.photos(lines.map((l) => l.id)),
      this.stockOf(itemIds),
    ]);
    return {
      id: row.id,
      status: row.status,
      expiresAt: row.expiresAt.toISOString(),
      pairedAt: row.pairedAt?.toISOString() ?? null,
      canExtend:
        row.status === 'WAITING' ||
        (row.status === 'PAIRED' &&
          row.pairedAt !== null &&
          extendedUntil(row.expiresAt, row.pairedAt, now) > row.expiresAt),
      lines: lines.map((l) => ({
        id: l.id,
        code: l.code,
        matches: l.matches,
        qty: qtyString(l.qty),
        lastSeenAt: l.lastSeenAt.toISOString(),
        photoId: photos.get(l.id) ?? null,
        format: l.format,
        kind: codeKind(l.code),
        gtin: extractGtin(l.code),
        stock: l.item ? (stock.get(l.item.id) ?? NO_STOCK) : null,
        item: l.item
          ? {
              id: l.item.id,
              partNo: l.item.partNo,
              brand: l.item.brand.name,
              description: l.item.description,
              uom: l.item.uom,
            }
          : null,
      })),
    };
  }

  async extend(
    policy: Policy,
    id: string,
    now = new Date(),
  ): Promise<PhoneScanView> {
    const row = await this.closeIfExpired(await this.own(policy, id), now);
    let expiresAt: Date | null = null;
    if (row.status === 'WAITING') {
      expiresAt = new Date(now.getTime() + PHONE_SCAN_MINUTES * MINUTE);
    } else if (row.status === 'PAIRED' && row.pairedAt) {
      expiresAt = extendedUntil(row.expiresAt, row.pairedAt, now);
    }
    if (expiresAt) {
      await this.prisma.phoneScanSession.updateMany({
        where: { id, status: row.status },
        data: { expiresAt },
      });
    }
    return this.view(policy, id, now);
  }

  async end(
    policy: Policy,
    id: string,
    now = new Date(),
  ): Promise<PhoneScanView> {
    await this.own(policy, id);
    await this.prisma.phoneScanSession.updateMany({
      where: { id, status: { in: ['WAITING', 'PAIRED'] } },
      data: { status: 'ENDED', endedAt: now },
    });
    return this.view(policy, id, now);
  }

  async setQty(
    policy: Policy,
    id: string,
    lineId: string,
    qty: string,
  ): Promise<PhoneScanView> {
    await this.own(policy, id);
    const { count } = await this.prisma.phoneScanLine.updateMany({
      where: { id: lineId, sessionId: id },
      data: { qty },
    });
    if (count === 0) notFound('Line not found.');
    return this.view(policy, id);
  }

  async removeLine(
    policy: Policy,
    id: string,
    lineId: string,
  ): Promise<PhoneScanView> {
    await this.own(policy, id);
    await this.prisma.phoneScanLine.deleteMany({
      where: { id: lineId, sessionId: id },
    });
    return this.view(policy, id);
  }

  // ---------------------------------------------------------------- phone

  async pair(input: PhoneScanPair, now = new Date()): Promise<PhoneScanPaired> {
    const row = await this.prisma.phoneScanSession.findUnique({
      where: { linkTokenHash: sha256(input.linkToken) },
      select: {
        id: true,
        userId: true,
        status: true,
        expiresAt: true,
        pairedAt: true,
        codeHash: true,
        failedAttempts: true,
      },
    });
    if (!row) return { ok: false, reason: 'expired' };
    const current = await this.closeIfExpired(row, now);
    if (current.status === 'LOCKED') return { ok: false, reason: 'locked' };
    if (current.status === 'PAIRED') return { ok: false, reason: 'used' };
    if (current.status === 'ENDED') return { ok: false, reason: 'expired' };

    if (!sameHash(codeHash(input.linkToken, input.code), row.codeHash)) {
      const failed = row.failedAttempts + 1;
      const locked = failed >= PHONE_SCAN_MAX_ATTEMPTS;
      await this.prisma.phoneScanSession.updateMany({
        where: { id: row.id, status: 'WAITING' },
        data: {
          failedAttempts: failed,
          ...(locked ? { status: 'LOCKED' } : {}),
        },
      });
      if (locked) {
        this.logger.warn(`Phone scan link ${row.id} locked after wrong codes`);
        return { ok: false, reason: 'locked' };
      }
      return {
        ok: false,
        reason: 'wrong_code',
        attemptsLeft: PHONE_SCAN_MAX_ATTEMPTS - failed,
      };
    }

    const phoneToken = newQrToken(32);
    const expiresAt = new Date(now.getTime() + PHONE_SCAN_MINUTES * MINUTE);
    // Only one phone can pair: the status guard makes a second try a no-op.
    const { count } = await this.prisma.phoneScanSession.updateMany({
      where: { id: row.id, status: 'WAITING' },
      data: {
        status: 'PAIRED',
        pairedAt: now,
        expiresAt,
        phoneTokenHash: sha256(phoneToken),
      },
    });
    if (count === 0) return { ok: false, reason: 'used' };
    const names = await userNames(this.prisma, [row.userId]);
    return {
      ok: true,
      phoneToken,
      expiresAt: expiresAt.toISOString(),
      owner: names.get(row.userId) ?? 'the PC',
    };
  }

  private async paired(phoneToken: string, now: Date) {
    const row = await this.prisma.phoneScanSession.findUnique({
      where: { phoneTokenHash: sha256(phoneToken) },
      select: {
        id: true,
        userId: true,
        status: true,
        expiresAt: true,
        pairedAt: true,
      },
    });
    return row ? this.closeIfExpired(row, now) : null;
  }

  async state(phoneToken: string, now = new Date()): Promise<PhoneScanState> {
    const row = await this.paired(phoneToken, now);
    if (!row) return { status: 'NONE', expiresAt: null, owner: null, lines: 0 };
    const [names, lines] = await Promise.all([
      userNames(this.prisma, [row.userId]),
      this.prisma.phoneScanLine.count({ where: { sessionId: row.id } }),
    ]);
    return {
      status: row.status,
      expiresAt: row.expiresAt.toISOString(),
      owner: names.get(row.userId) ?? null,
      lines,
    };
  }

  async scan(input: PhoneScanCode, now = new Date()): Promise<PhoneScanReply> {
    const ended: PhoneScanReply = {
      result: 'ended',
      line: null,
      expiresAt: null,
    };
    const row = await this.paired(input.phoneToken, now);
    if (!row || row.status !== 'PAIRED') return ended;
    // The phone scans as the PC user, with whatever that user may see now.
    let policy: Policy;
    try {
      policy = await this.policies.forUser(row.userId, now);
    } catch {
      return ended;
    }
    if (!can(policy, 'inventory.item.view')) return ended;
    return this.addScan(row, policy, input.code, input.format, now);
  }

  /** The PC adds to its own list with its camera or a hand-held scanner. */
  async scanFromPc(
    policy: Policy,
    id: string,
    input: PhoneScanPcCode,
    now = new Date(),
  ): Promise<PhoneScanReply> {
    const row = await this.closeIfExpired(await this.own(policy, id), now);
    if (row.status !== 'WAITING' && row.status !== 'PAIRED') {
      return { result: 'ended', line: null, expiresAt: null };
    }
    return this.addScan(row, policy, input.code, input.format, now);
  }

  private async addScan(
    row: Session,
    policy: Policy,
    code: string,
    format: string | undefined,
    now: Date,
  ): Promise<PhoneScanReply> {
    const input = { code, format };
    const found = await this.scans.resolve(policy, input.code);
    const expiresAt = row.expiresAt.toISOString();
    if (found.type === 'bin') return { result: 'bin', line: null, expiresAt };

    const itemId = found.type === 'item' ? found.id : null;
    const matches = found.type === 'choices' ? found.items.length : 0;
    const key = itemId ? `item:${itemId}` : `code:${input.code}`;
    const line = await this.prisma.phoneScanLine.upsert({
      where: { sessionId_key: { sessionId: row.id, key } },
      create: {
        sessionId: row.id,
        key,
        code: input.code,
        format: input.format ?? null,
        itemId,
        matches,
      },
      update: { qty: { increment: 1 }, lastSeenAt: now },
      select: LINE_SELECT,
    });
    await this.prisma.phoneScanSession.update({
      where: { id: row.id },
      data: { lastScanAt: now },
    });
    return {
      result: itemId ? 'added' : matches > 1 ? 'several' : 'unknown',
      line: {
        id: line.id,
        partNo: line.item?.partNo ?? null,
        brand: line.item?.brand.name ?? null,
        description: line.item?.description ?? null,
        qty: qtyString(line.qty),
      },
      expiresAt,
    };
  }

  // ------------------------------------------------- PC: sort out a line

  private async ownLine(policy: Policy, id: string, lineId: string) {
    await this.own(policy, id);
    const line = await this.prisma.phoneScanLine.findFirst({
      where: { id: lineId, sessionId: id },
      select: { id: true, code: true, itemId: true, matches: true, qty: true },
    });
    if (!line) notFound('Line not found.');
    return line;
  }

  /** Details for a scanned code, before anyone types them. */
  async suggest(
    policy: Policy,
    id: string,
    lineId: string,
  ): Promise<PhoneScanSuggestion> {
    const line = await this.ownLine(policy, id, lineId);
    const gtin = extractGtin(line.code);
    const result: PhoneScanSuggestion = {
      gtin,
      partNo: partNumberFrom(line.code),
      brand: null,
      description: null,
      source: null,
      matches: [],
    };
    if (result.partNo) result.source = 'barcode';

    if (line.matches > 1) {
      const found = await this.scans.resolve(policy, line.code);
      if (found.type === 'choices') {
        const rows = await this.prisma.item.findMany({
          where: { id: { in: found.items.map((i) => i.id) } },
          select: {
            id: true,
            partNo: true,
            description: true,
            uom: true,
            brand: { select: { name: true } },
          },
        });
        result.matches = rows.map((r) => ({
          id: r.id,
          partNo: r.partNo,
          brand: r.brand.name,
          description: r.description,
          uom: r.uom,
        }));
      }
    }
    if (!gtin) return result;

    // Same maker prefix as a barcode we already know: probably the same brand.
    const prefix = companyPrefix(gtin);
    const similar = await this.prisma.itemBarcode.findMany({
      where: {
        OR: [
          { code: { startsWith: prefix } },
          { code: { startsWith: `0${prefix}` } },
        ],
      },
      select: {
        item: { select: { brand: { select: { id: true, name: true } } } },
      },
      take: 50,
    });
    const counts = new Map<string, { id: string; name: string; n: number }>();
    for (const s of similar) {
      const b = s.item.brand;
      const c = counts.get(b.id) ?? { ...b, n: 0 };
      c.n += 1;
      counts.set(b.id, c);
    }
    const top = [...counts.values()].sort((a, b) => b.n - a.n)[0];
    if (top) {
      result.brand = { id: top.id, name: top.name };
      result.source = 'similar';
    }

    const product = await this.online.find(gtin);
    if (product) {
      result.source = 'online';
      result.description = product.title;
      result.partNo ??= product.model;
      if (product.brand) {
        const brand = await this.prisma.brand.findFirst({
          where: { name: { equals: product.brand, mode: 'insensitive' } },
          select: { id: true, name: true },
        });
        result.brand = brand ?? { id: null, name: product.brand };
      }
    }
    return result;
  }

  /**
   * The PC says which item a line is. If that item already has a line, the
   * quantities are added together. Optionally the scanned code is kept on
   * the item as a barcode, so the next scan finds it at once.
   */
  async link(
    policy: Policy,
    id: string,
    lineId: string,
    input: PhoneScanLink,
  ): Promise<PhoneScanView> {
    const line = await this.ownLine(policy, id, lineId);
    const item = await this.prisma.item.findUnique({
      where: { id: input.itemId },
      select: { id: true, barcodes: { select: { code: true } } },
    });
    if (!item) notFound('Item not found.');

    // A GS1 box label is saved as the product number inside it: that is what
    // the next box (with another batch or date) shares.
    const gtin = extractGtin(line.code);
    const saveAs = gtin ? displayGtin(gtin) : line.code.trim();
    const already = item.barcodes.some(
      (b) =>
        b.code === saveAs ||
        (gtin !== null && gtinForms(gtin).includes(b.code)),
    );
    if (input.saveBarcode && !already) {
      if (!can(policy, 'inventory.item.edit')) {
        throw new ForbiddenException({
          code: 'PERMISSION_DENIED',
          message: 'You are not allowed to add barcodes to items.',
        });
      }
      const barcode = BarcodeInput.safeParse({
        code: saveAs,
        kind: 'MANUFACTURER',
      });
      if (!barcode.success) {
        throw new ConflictException({
          code: 'BARCODE_NOT_SAVABLE',
          message:
            'This code cannot be saved as a barcode: it needs 3 to 64 letters, digits or symbols.',
        });
      }
      await this.items.addBarcode(policy, item.id, barcode.data);
    }

    const key = `item:${item.id}`;
    await this.prisma.$transaction(async (tx) => {
      const other = await tx.phoneScanLine.findUnique({
        where: { sessionId_key: { sessionId: id, key } },
        select: { id: true },
      });
      if (other && other.id !== line.id) {
        await tx.phoneScanLine.update({
          where: { id: other.id },
          data: { qty: { increment: line.qty } },
        });
        // Keep any label photo with the line that stays.
        await tx.attachment.updateMany({
          where: { entityKey: PHONE_LINE_KEY, entityId: line.id },
          data: { entityId: other.id },
        });
        await tx.phoneScanLine.delete({ where: { id: line.id } });
      } else {
        await tx.phoneScanLine.update({
          where: { id: line.id },
          data: { key, itemId: item.id, matches: 0 },
        });
      }
    });
    return this.view(policy, id);
  }

  // ------------------------------------------------- phone: label photo

  async photo(
    phoneToken: string,
    lineId: string,
    file: { buffer: Buffer; originalname?: string },
    now = new Date(),
  ): Promise<{ ok: boolean }> {
    const row = await this.paired(phoneToken, now);
    if (!row || row.status !== 'PAIRED') return { ok: false };
    const line = await this.prisma.phoneScanLine.findFirst({
      where: { id: lineId, sessionId: row.id },
      select: { id: true },
    });
    if (!line) return { ok: false };
    const policy = await this.policies.forUser(row.userId, now);
    await this.files.upload(
      {
        entityKey: PHONE_LINE_KEY,
        entityId: line.id,
        kind: 'label_photo',
        fileName: file.originalname || 'label.jpg',
        buffer: file.buffer,
      },
      policy,
      { id: row.userId },
    );
    return { ok: true };
  }
}
