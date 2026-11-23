import { Injectable } from '@nestjs/common';
import {
  looksLikeSerial,
  normalizePartNo,
  normalizeSerial,
  type ScanResult,
} from '@dax/inventory-contract';
import { can, type Policy } from '@dax/platform-core';
import { PrismaService } from '@dax/platform-db';
import { extractGtin, gtinForms } from './phone-scan/barcode-info';
import { MainStore } from './main-store.service';
import { type LabelKind, looksLikeBinCode, parseScanCode } from './scan-code';

const NONE: ScanResult = { type: 'none' };
const MAX_CHOICES = 20;

export const itemPath = (id: string) => `/inventory/items/${id}`;
export const binPath = (id: string) => `/inventory/locations/bins/${id}`;
export const serialPath = (serial: string) => `/inventory/serials/${serial}`;

@Injectable()
export class ScanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: MainStore,
  ) {}

  async resolve(policy: Policy, raw: string): Promise<ScanResult> {
    const code = parseScanCode(raw);
    if (code.kind === 'empty') return NONE;

    const value = code.value;
    if (looksLikeSerial(value) && can(policy, 'inventory.item.view')) {
      const serial = normalizeSerial(value);
      const hit = await this.prisma.itemSerial.findUnique({
        where: { serial },
        select: { id: true },
      });
      if (hit) {
        return { type: 'serial', id: hit.id, serial, path: serialPath(serial) };
      }
    }
    if (code.maybeToken) {
      const hit = await this.findToken(value);
      if (hit) return this.allowed(policy, hit.type, hit.id);
    }
    const barcode = await this.prisma.itemBarcode.findUnique({
      where: { code: value },
      select: { itemId: true },
    });
    if (barcode) return this.allowed(policy, 'item', barcode.itemId);
    // The same product number in another form (UPC vs EAN, or inside a GS1
    // box label) still finds the item.
    const gtin = extractGtin(value);
    if (gtin) {
      const same = await this.prisma.itemBarcode.findFirst({
        where: { code: { in: gtinForms(gtin) } },
        select: { itemId: true },
      });
      if (same) return this.allowed(policy, 'item', same.itemId);
    }

    if (looksLikeBinCode(value)) {
      const bin = await this.prisma.bin.findFirst({
        where: { storeId: await this.store.id(), code: value.toUpperCase() },
        select: { id: true },
      });
      if (bin) return this.allowed(policy, 'bin', bin.id);
    }
    return this.byPartNo(policy, value);
  }

  private async findToken(
    token: string,
  ): Promise<{ type: LabelKind; id: string } | null> {
    const item = await this.prisma.item.findUnique({
      where: { qrToken: token },
      select: { id: true },
    });
    if (item) return { type: 'item', id: item.id };
    const bin = await this.prisma.bin.findUnique({
      where: { qrToken: token },
      select: { id: true },
    });
    if (bin) return { type: 'bin', id: bin.id };
    // A hand-held scanner with Caps Lock on flips the letter case.
    const anyCase = {
      qrToken: { equals: token, mode: 'insensitive' as const },
    };
    const [items, bins] = await Promise.all([
      this.prisma.item.findMany({
        where: anyCase,
        select: { id: true },
        take: 2,
      }),
      this.prisma.bin.findMany({
        where: anyCase,
        select: { id: true },
        take: 2,
      }),
    ]);
    if (items.length + bins.length !== 1) return null;
    return items[0]
      ? { type: 'item', id: items[0].id }
      : { type: 'bin', id: (bins[0] as { id: string }).id };
  }

  private async byPartNo(policy: Policy, value: string): Promise<ScanResult> {
    const norm = normalizePartNo(value);
    if (!norm || !can(policy, 'inventory.item.view')) return NONE;
    const items = await this.prisma.item.findMany({
      where: { partNoNorm: norm },
      select: {
        id: true,
        partNo: true,
        description: true,
        brand: { select: { name: true } },
      },
      orderBy: [{ status: 'asc' }, { partNo: 'asc' }],
      take: MAX_CHOICES,
    });
    const [only] = items;
    if (!only) return NONE;
    if (items.length === 1)
      return { type: 'item', id: only.id, path: itemPath(only.id) };
    return {
      type: 'choices',
      items: items.map((i) => ({
        id: i.id,
        partNo: i.partNo,
        brand: i.brand.name,
        description: i.description,
        path: itemPath(i.id),
      })),
    };
  }

  private allowed(policy: Policy, type: LabelKind, id: string): ScanResult {
    if (type === 'item') {
      return can(policy, 'inventory.item.view')
        ? { type, id, path: itemPath(id) }
        : NONE;
    }
    return can(policy, 'inventory.location.view')
      ? { type, id, path: binPath(id) }
      : NONE;
  }
}
