import { seesMrnCustomer } from './issuing/shared';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { type ImportResult, pageMeta, pageWindow } from '@dax/contracts';
import {
  type BarcodeInput,
  type ItemDetail,
  type ItemFacets,
  type ItemImportMode,
  type ItemInput,
  type ItemPage,
  type ItemQuery,
  type ItemStatusInput,
  type ItemSummary,
  type ItemUpdate,
  normalizePartNo,
  type SupersedeInput,
  UOMS,
} from '@dax/inventory-contract';
import {
  assertWritable,
  AuditService,
  can,
  type Policy,
} from '@dax/platform-core';
import {
  Prisma,
  PrismaService,
  type TransactionClient,
} from '@dax/platform-db';
import {
  canRead,
  conflict,
  invalid,
  isUniqueViolation,
  MODULE_KEY,
  newQrToken,
  notFound,
  stale,
} from './common';
import { itemEntity } from './entities';
import {
  type ExistingItem,
  type ItemChanges,
  itemKey,
  nameKey,
  readItemCsv,
  validateImport,
  type ValidItem,
  type ValidUpdate,
} from './item-import';
import {
  belowMinFilter,
  belowMinIds,
  cleanTags,
  extrasFilter,
  familySearch,
  familySelect,
  ITEM_EXTRAS_SELECT,
  itemExtras,
  nextOfFor,
} from './item-queries';
import { MainStore } from './main-store.service';
import { activeSupplier } from './receiving/shared';
import {
  dec,
  familyFigures,
  isBelowMin,
  isWhole,
  qtyString,
  stockFigures,
} from './stock-math';
import {
  createsCycle,
  latestReplacementId,
  refreshFamily,
} from './supersession';

const ITEM_REF = {
  id: true,
  partNo: true,
  brand: { select: { name: true } },
} as const;

function summarySelect(storeId: string) {
  return {
    id: true,
    partNo: true,
    description: true,
    uom: true,
    status: true,
    minQty: true,
    brand: { select: { id: true, name: true } },
    supersededBy: { select: ITEM_REF },
    balances: {
      where: { storeId },
      select: { onHand: true, held: true, quarantine: true, receiving: true },
    },
    family: familySelect(storeId),
    ...ITEM_EXTRAS_SELECT,
  } as const;
}

function detailSelect(storeId: string) {
  return {
    ...summarySelect(storeId),
    allowFraction: true,
    supersededById: true,
    notes: true,
    version: true,
    createdAt: true,
    updatedAt: true,
    defaultBin: { select: { id: true, code: true } },
    barcodes: {
      select: { id: true, code: true, kind: true },
      orderBy: { createdAt: 'asc' },
    },
    supersedes: { select: ITEM_REF, orderBy: { partNo: 'asc' } },
    binStock: {
      where: { qty: { gt: 0 } },
      select: { qty: true, bin: { select: { id: true, code: true } } },
      orderBy: { bin: { code: 'asc' } },
    },
  } as const;
}

type SummaryRow = Prisma.ItemGetPayload<{
  select: ReturnType<typeof summarySelect>;
}>;
type DetailRow = Prisma.ItemGetPayload<{
  select: ReturnType<typeof detailSelect>;
}>;
type RefRow = Prisma.ItemGetPayload<{ select: typeof ITEM_REF }>;

const toRef = (row: RefRow) => ({
  id: row.id,
  partNo: row.partNo,
  brand: row.brand.name,
});

/** `familyStock` shows the family's combined stock (lists); otherwise the item's own. */
export function toSummary(row: SummaryRow, familyStock = false): ItemSummary {
  const own = stockFigures(row.balances[0]);
  const family = familyFigures(row.family.familyMembers);
  const figures = familyStock ? family.stock : own.figures;
  return {
    id: row.id,
    partNo: row.partNo,
    brand: row.brand,
    description: row.description,
    uom: row.uom,
    status: row.status,
    supersededBy: row.supersededBy ? toRef(row.supersededBy) : null,
    minQty: qtyString(row.minQty),
    stock: figures,
    belowMin: isBelowMin(family.onHand, row.minQty),
    family: { stock: family.stock, members: family.members },
    ...itemExtras(row),
  };
}

const WRITABLE_KEYS = [
  'partNo',
  'brandId',
  'description',
  'uom',
  'minQty',
  'defaultBinId',
  'notes',
  'supplierId',
  'tags',
  'preCostPrice',
  'sellingPrice',
] as const;

type ItemFields = Partial<Pick<ItemInput, (typeof WRITABLE_KEYS)[number]>>;

function writable(input: Record<string, unknown>) {
  return Object.fromEntries(
    WRITABLE_KEYS.filter((k) => input[k] !== undefined).map((k) => [
      k,
      input[k],
    ]),
  );
}

function itemExists(): never {
  conflict(
    'ITEM_EXISTS',
    'An item with this part number already exists for this brand.',
  );
}

@Injectable()
export class ItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly store: MainStore,
  ) {}

  async list(query: ItemQuery): Promise<ItemPage> {
    const storeId = await this.store.id();
    const ids = query.belowMin ? await belowMinIds(this.prisma, storeId) : [];
    const where: Prisma.ItemWhereInput = {
      AND: [
        query.status === 'ALL' ? {} : { status: query.status },
        { supersededById: null },
        query.brandId ? { brandId: query.brandId } : {},
        query.machineModelId
          ? {
              machineModels: {
                some: { machineModelId: query.machineModelId },
              },
            }
          : {},
        familySearch(query.q),
        belowMinFilter(query.belowMin, ids),
        extrasFilter(query),
      ],
    };
    const [rows, total] = await Promise.all([
      this.prisma.item.findMany({
        where,
        select: summarySelect(storeId),
        orderBy: [{ partNo: 'asc' }, { id: 'asc' }],
        ...pageWindow(query),
      }),
      this.prisma.item.count({ where }),
    ]);
    return {
      items: rows.map((r) => toSummary(r, true)),
      ...pageMeta(query, total),
    };
  }

  async facets(): Promise<ItemFacets> {
    const [suppliers, tags] = await Promise.all([
      this.prisma.item.groupBy({
        by: ['supplierId', 'supplierName'],
        where: { supplierId: { not: null } },
        orderBy: { supplierName: 'asc' },
      }),
      this.prisma.$queryRaw<{ tag: string }[]>`
        SELECT DISTINCT unnest(tags) AS tag FROM inventory.item ORDER BY tag`,
    ]);
    return {
      suppliers: suppliers.flatMap((s) =>
        s.supplierId && s.supplierName
          ? [{ id: s.supplierId, name: s.supplierName }]
          : [],
      ),
      tags: tags.map((t) => t.tag),
    };
  }

  async detail(policy: Policy, id: string): Promise<ItemDetail> {
    const storeId = await this.store.id();
    const row = await this.prisma.item.findUnique({
      where: { id },
      select: detailSelect(storeId),
    });
    if (!row) notFound('Item not found.');
    return this.toDetail(policy, row);
  }

  private async toDetail(policy: Policy, row: DetailRow): Promise<ItemDetail> {
    const latestId = await latestReplacementId(
      row.supersededById,
      nextOfFor(this.prisma),
    );
    const latest =
      latestId && latestId !== row.supersededBy?.id
        ? await this.prisma.item.findUnique({
            where: { id: latestId },
            select: ITEM_REF,
          })
        : row.supersededBy;
    const customerParts = seesMrnCustomer(policy)
      ? await this.prisma.customerPart.findMany({
          where: { itemId: row.id },
          select: { customerId: true, customerName: true, partNo: true },
          orderBy: [{ customerName: 'asc' }, { partNo: 'asc' }],
        })
      : [];
    return {
      ...toSummary(row),
      allowFraction: row.allowFraction,
      defaultBin: row.defaultBin,
      machineModels: row.machineModels.map(({ machineModel: m }) => ({
        id: m.id,
        name: m.name,
      })),
      barcodes: row.barcodes,
      supersedes: row.supersedes.map(toRef),
      latestReplacement: latest ? toRef(latest) : null,
      notes: canRead(policy, itemEntity, 'notes') ? row.notes : null,
      stockByBin: row.binStock.map((s) => ({
        binId: s.bin.id,
        binCode: s.bin.code,
        qty: qtyString(s.qty),
      })),
      customerParts,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async create(policy: Policy, input: ItemInput): Promise<ItemDetail> {
    input = { ...input, tags: cleanTags(input.tags) };
    assertWritable(itemEntity, policy, writable(input));
    const supplier = input.supplierId
      ? await activeSupplier(this.prisma, input.supplierId)
      : null;
    const partNoNorm = this.partNoNorm(input.partNo);
    const allowFraction = this.checkQty(input.uom, input.minQty);
    await this.checkRefs({
      brandId: input.brandId,
      defaultBinId: input.defaultBinId,
      machineModelIds: input.machineModelIds,
    });
    const clash = await this.prisma.item.findUnique({
      where: { brandId_partNoNorm: { brandId: input.brandId, partNoNorm } },
      select: { id: true },
    });
    if (clash) itemExists();

    const id = await this.uniqueGuard(() =>
      this.prisma.$transaction(async (tx) => {
        const created = await tx.item.create({
          data: {
            partNo: input.partNo,
            partNoNorm,
            brandId: input.brandId,
            description: input.description,
            uom: input.uom,
            allowFraction,
            minQty: input.minQty,
            defaultBinId: input.defaultBinId,
            notes: input.notes ?? null,
            supplierId: supplier?.id ?? null,
            supplierName: supplier?.name ?? null,
            tags: input.tags,
            preCostPrice: input.preCostPrice,
            sellingPrice: input.sellingPrice,
            qrToken: newQrToken(),
            createdBy: policy.userId,
            updatedBy: policy.userId,
            machineModels: {
              create: input.machineModelIds.map((machineModelId) => ({
                machineModelId,
              })),
            },
          },
          select: { id: true },
        });
        await this.record(tx, created.id, 'create', null, {
          ...writable(input),
          machineModelIds: input.machineModelIds,
        });
        return created.id;
      }),
    );
    return this.detail(policy, id);
  }

  async update(
    policy: Policy,
    id: string,
    input: ItemUpdate,
    present: ReadonlySet<string>,
  ): Promise<ItemDetail> {
    const changes: ItemFields = {};
    for (const key of WRITABLE_KEYS) {
      if (present.has(key) && input[key] !== undefined) {
        Object.assign(changes, { [key]: input[key] });
      }
    }
    const machineModelIds = present.has('machineModelIds')
      ? input.machineModelIds
      : undefined;
    if (changes.tags) changes.tags = cleanTags(changes.tags);
    assertWritable(itemEntity, policy, changes);

    const before = await this.prisma.item.findUnique({
      where: { id },
      include: { machineModels: { select: { machineModelId: true } } },
    });
    if (!before) notFound('Item not found.');
    if (before.version !== input.version) stale();

    const brandId = changes.brandId ?? before.brandId;
    const partNoNorm =
      changes.partNo !== undefined
        ? this.partNoNorm(changes.partNo)
        : before.partNoNorm;
    const uom = changes.uom ?? before.uom;
    const minQty = changes.minQty ?? before.minQty.toString();
    const allowFraction = this.checkQty(uom, minQty);
    await this.checkRefs({
      brandId:
        changes.brandId !== undefined && changes.brandId !== before.brandId
          ? brandId
          : undefined,
      defaultBinId:
        changes.defaultBinId && changes.defaultBinId !== before.defaultBinId
          ? changes.defaultBinId
          : null,
      machineModelIds: machineModelIds ?? [],
    });
    let supplierName: string | null | undefined;
    if (changes.supplierId !== undefined) {
      supplierName =
        changes.supplierId === null
          ? null
          : changes.supplierId === before.supplierId
            ? before.supplierName
            : (await activeSupplier(this.prisma, changes.supplierId)).name;
    }
    if (brandId !== before.brandId || partNoNorm !== before.partNoNorm) {
      const clash = await this.prisma.item.findUnique({
        where: { brandId_partNoNorm: { brandId, partNoNorm } },
        select: { id: true },
      });
      if (clash && clash.id !== id) itemExists();
    }

    await this.uniqueGuard(() =>
      this.prisma.$transaction(async (tx) => {
        const bumped = await tx.item.updateMany({
          where: { id, version: input.version },
          data: {
            ...changes,
            ...(supplierName !== undefined ? { supplierName } : {}),
            partNoNorm,
            allowFraction,
            version: { increment: 1 },
            updatedBy: policy.userId,
          },
        });
        if (bumped.count === 0) stale();
        if (machineModelIds) {
          await tx.itemMachineModel.deleteMany({ where: { itemId: id } });
          await tx.itemMachineModel.createMany({
            data: machineModelIds.map((machineModelId) => ({
              itemId: id,
              machineModelId,
            })),
            skipDuplicates: true,
          });
        }
        const beforeValues: Record<string, unknown> = Object.fromEntries(
          Object.keys(changes).map((k) => [
            k,
            before[k as keyof typeof before],
          ]),
        );
        const afterValues: Record<string, unknown> = { ...changes };
        if (machineModelIds) {
          beforeValues['machineModelIds'] = before.machineModels
            .map((m) => m.machineModelId)
            .sort();
          afterValues['machineModelIds'] = [...machineModelIds].sort();
        }
        await this.record(tx, id, 'update', beforeValues, afterValues);
      }),
    );
    return this.detail(policy, id);
  }

  async setStatus(
    policy: Policy,
    id: string,
    input: ItemStatusInput,
  ): Promise<ItemDetail> {
    assertWritable(itemEntity, policy, { status: input.status });
    const storeId = await this.store.id();
    const before = await this.prisma.item.findUnique({
      where: { id },
      select: {
        status: true,
        balances: { where: { storeId }, select: { onHand: true } },
      },
    });
    if (!before) notFound('Item not found.');
    if (
      input.status === 'ARCHIVED' &&
      dec(before.balances[0]?.onHand ?? 0).gt(0)
    ) {
      conflict(
        'ITEM_HAS_STOCK',
        'This item still has stock. Move or issue it before archiving.',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      const bumped = await tx.item.updateMany({
        where: { id, version: input.version },
        data: {
          status: input.status,
          version: { increment: 1 },
          updatedBy: policy.userId,
        },
      });
      if (bumped.count === 0) stale();
      await this.record(
        tx,
        id,
        input.status === 'ARCHIVED' ? 'archived' : 'restored',
        { status: before.status },
        { status: input.status },
      );
    });
    return this.detail(policy, id);
  }

  async supersede(
    policy: Policy,
    id: string,
    input: SupersedeInput,
  ): Promise<ItemDetail> {
    assertWritable(itemEntity, policy, { supersededById: input.replacementId });
    const before = await this.prisma.item.findUnique({
      where: { id },
      select: { supersededById: true },
    });
    if (!before) notFound('Item not found.');
    const replacementId = input.replacementId;
    if (replacementId === id)
      invalid('A part number cannot supersede itself.', ['replacementId']);
    if (replacementId) {
      const exists = await this.prisma.item.findUnique({
        where: { id: replacementId },
        select: { id: true },
      });
      if (!exists)
        invalid('The superseding part number does not exist.', [
          'replacementId',
        ]);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('inventory.item.supersession'))`;
      if (
        replacementId &&
        (await createsCycle(id, replacementId, nextOfFor(tx)))
      ) {
        invalid('That would make a loop of superseded part numbers.', [
          'replacementId',
        ]);
      }
      const bumped = await tx.item.updateMany({
        where: { id, version: input.version },
        data: {
          supersededById: replacementId,
          version: { increment: 1 },
          updatedBy: policy.userId,
        },
      });
      if (bumped.count === 0) stale();
      await refreshFamily(tx, id);
      await this.record(
        tx,
        id,
        replacementId ? 'superseded' : 'supersession_cleared',
        { supersededById: before.supersededById },
        { supersededById: replacementId },
      );
    });
    return this.detail(policy, id);
  }

  async addBarcode(
    policy: Policy,
    id: string,
    input: BarcodeInput,
  ): Promise<ItemDetail> {
    const item = await this.prisma.item.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!item) notFound('Item not found.');
    const used = await this.prisma.itemBarcode.findUnique({
      where: { code: input.code },
      select: { itemId: true, item: { select: { partNo: true } } },
    });
    if (used) barcodeInUse(used.itemId === id ? null : used.item.partNo);
    try {
      await this.prisma.$transaction(async (tx) => {
        const created = await tx.itemBarcode.create({
          data: { itemId: id, code: input.code, kind: input.kind },
          select: { id: true },
        });
        await this.record(tx, id, 'barcode_added', null, {
          barcodeId: created.id,
          code: input.code,
          kind: input.kind,
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) barcodeInUse(undefined);
      throw error;
    }
    return this.detail(policy, id);
  }

  async removeBarcode(
    policy: Policy,
    id: string,
    barcodeId: string,
  ): Promise<ItemDetail> {
    const barcode = await this.prisma.itemBarcode.findFirst({
      where: { id: barcodeId, itemId: id },
    });
    if (!barcode) notFound('Barcode not found.');
    await this.prisma.$transaction(async (tx) => {
      await tx.itemBarcode.delete({ where: { id: barcodeId } });
      await this.record(
        tx,
        id,
        'barcode_removed',
        { barcodeId, code: barcode.code, kind: barcode.kind },
        null,
      );
    });
    return this.detail(policy, id);
  }

  async import(
    policy: Policy,
    text: string,
    dryRun: boolean,
    mode: ItemImportMode = 'add',
  ): Promise<ImportResult> {
    if (mode === 'upsert' && !can(policy, 'inventory.item.edit')) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: "You don't have permission to update parts.",
      });
    }
    const read = readItemCsv(text);
    if (!read.ok)
      return {
        dryRun,
        total: read.total,
        created: 0,
        updated: 0,
        errors: read.errors,
      };
    const rows = read.rows;
    const storeId = await this.store.id();
    const norms = [...new Set(rows.map((r) => r.partNoNorm).filter(Boolean))];
    const codes = [...new Set(rows.flatMap((r) => r.barcodes))];
    const binCodes = [
      ...new Set(rows.map((r) => r.defaultBinCode).filter(Boolean)),
    ];
    const [brands, models, bins, existing, barcodes, suppliers] =
      await Promise.all([
        this.prisma.brand.findMany({
          select: { id: true, name: true, active: true },
        }),
        this.prisma.machineModel.findMany({ select: { id: true, name: true } }),
        this.prisma.bin.findMany({
          where: {
            storeId,
            code: { in: binCodes },
            active: true,
            kind: 'STORAGE',
          },
          select: { id: true, code: true },
        }),
        this.prisma.item.findMany({
          where: { partNoNorm: { in: norms } },
          select: {
            id: true,
            version: true,
            brandId: true,
            partNo: true,
            partNoNorm: true,
            status: true,
            description: true,
            uom: true,
            minQty: true,
            defaultBinId: true,
            notes: true,
            supplierId: true,
            tags: true,
            preCostPrice: true,
            sellingPrice: true,
            machineModels: { select: { machineModelId: true } },
            barcodes: { select: { code: true } },
          },
        }),
        this.prisma.itemBarcode.findMany({
          where: { code: { in: codes } },
          select: { code: true, item: { select: { partNo: true } } },
        }),
        this.prisma.supplier.findMany({
          select: { id: true, name: true, active: true },
        }),
      ]);
    const { items, updates, errors } = validateImport(
      rows,
      {
        brands: new Map(brands.map((b) => [nameKey(b.name), b])),
        machineModels: new Map(models.map((m) => [nameKey(m.name), m])),
        suppliers: new Map(suppliers.map((p) => [nameKey(p.name), p])),
        storageBins: new Map(bins.map((b) => [b.code, b])),
        existingItems: new Map(
          existing.map((e) => [
            itemKey(e.brandId, e.partNoNorm),
            {
              id: e.id,
              version: e.version,
              partNo: e.partNo,
              archived: e.status === 'ARCHIVED',
              description: e.description,
              uom: e.uom,
              minQty: e.minQty.toString(),
              defaultBinId: e.defaultBinId,
              notes: e.notes,
              supplierId: e.supplierId,
              tags: e.tags,
              preCostPrice: e.preCostPrice?.toString() ?? null,
              sellingPrice: e.sellingPrice?.toString() ?? null,
              machineModelIds: e.machineModels.map((m) => m.machineModelId),
              barcodes: e.barcodes.map((b) => b.code),
            },
          ]),
        ),
        barcodesInUse: new Map(barcodes.map((b) => [b.code, b.item.partNo])),
      },
      mode,
    );
    const result = {
      dryRun,
      total: rows.length,
      created: 0,
      updated: 0,
      errors,
    };
    if (errors.length) return result;
    const counts = { created: items.length, updated: updates.length };
    if (dryRun) return { ...result, ...counts };
    const touched = (key: keyof ItemChanges) =>
      updates.some((u) => u.changes[key] !== undefined);
    if (items.length) {
      assertWritable(itemEntity, policy, {
        partNo: true,
        brandId: true,
        description: true,
        uom: true,
        minQty: true,
        ...(items.some((i) => i.defaultBinId) ? { defaultBinId: true } : {}),
        ...(items.some((i) => i.notes) ? { notes: true } : {}),
        ...(items.some((i) => i.supplier) ? { supplierId: true } : {}),
        ...(items.some((i) => i.tags.length) ? { tags: true } : {}),
        ...(items.some((i) => i.preCostPrice) ? { preCostPrice: true } : {}),
        ...(items.some((i) => i.sellingPrice) ? { sellingPrice: true } : {}),
      });
    }
    assertWritable(
      itemEntity,
      policy,
      Object.fromEntries(
        (
          [
            ['description', 'description'],
            ['uom', 'uom'],
            ['minQty', 'minQty'],
            ['defaultBinId', 'defaultBinId'],
            ['notes', 'notes'],
            ['supplier', 'supplierId'],
            ['tags', 'tags'],
            ['preCostPrice', 'preCostPrice'],
            ['sellingPrice', 'sellingPrice'],
          ] as const
        )
          .filter(([key]) => touched(key))
          .map(([, field]) => [field, true]),
      ),
    );
    await this.uniqueGuard(
      () => this.writeImport(policy, items, updates),
      true,
    );
    return { ...result, ...counts };
  }

  private writeImport(
    policy: Policy,
    items: ValidItem[],
    updates: ValidUpdate[],
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        for (let i = 0; i < items.length; i += 1000) {
          const chunk = items.slice(i, i + 1000);
          const created = await tx.item.createManyAndReturn({
            data: chunk.map((item) => ({
              partNo: item.partNo,
              partNoNorm: item.partNoNorm,
              brandId: item.brandId,
              description: item.description,
              uom: item.uom,
              allowFraction: item.allowFraction,
              minQty: item.minQty,
              defaultBinId: item.defaultBinId,
              notes: item.notes,
              supplierId: item.supplier?.id ?? null,
              supplierName: item.supplier?.name ?? null,
              tags: item.tags,
              preCostPrice: item.preCostPrice,
              sellingPrice: item.sellingPrice,
              qrToken: newQrToken(),
              createdBy: policy.userId,
              updatedBy: policy.userId,
            })),
            select: { id: true, brandId: true, partNoNorm: true },
          });
          const idOf = new Map(
            created.map((c) => [itemKey(c.brandId, c.partNoNorm), c.id]),
          );
          const links: { itemId: string; machineModelId: string }[] = [];
          const codes: {
            itemId: string;
            code: string;
            kind: 'MANUFACTURER';
          }[] = [];
          for (const item of chunk) {
            const itemId = idOf.get(itemKey(item.brandId, item.partNoNorm));
            if (!itemId) continue;
            for (const machineModelId of item.machineModelIds)
              links.push({ itemId, machineModelId });
            for (const code of item.barcodes)
              codes.push({ itemId, code, kind: 'MANUFACTURER' });
          }
          if (links.length)
            await tx.itemMachineModel.createMany({ data: links });
          if (codes.length) await tx.itemBarcode.createMany({ data: codes });
        }
        for (const update of updates) {
          await this.writeImportUpdate(tx, policy, update);
        }
        await this.audit.record(
          {
            moduleKey: MODULE_KEY,
            entityKey: itemEntity.key,
            action: 'imported',
            after: { count: items.length, updated: updates.length },
          },
          tx,
        );
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  }

  private async writeImportUpdate(
    tx: TransactionClient,
    policy: Policy,
    { existing, changes, machineModelIds, addBarcodes }: ValidUpdate,
  ) {
    const { supplier, ...fields } = changes;
    const bumped = await tx.item.updateMany({
      where: { id: existing.id, version: existing.version },
      data: {
        ...fields,
        ...(supplier
          ? { supplierId: supplier.id, supplierName: supplier.name }
          : {}),
        version: { increment: 1 },
        updatedBy: policy.userId,
      },
    });
    if (bumped.count === 0) {
      conflict(
        'IMPORT_CONFLICT',
        `${existing.partNo} was changed meanwhile. Check the file again.`,
      );
    }
    if (machineModelIds) {
      await tx.itemMachineModel.deleteMany({ where: { itemId: existing.id } });
      await tx.itemMachineModel.createMany({
        data: machineModelIds.map((machineModelId) => ({
          itemId: existing.id,
          machineModelId,
        })),
      });
    }
    if (addBarcodes.length) {
      await tx.itemBarcode.createMany({
        data: addBarcodes.map((code) => ({
          itemId: existing.id,
          code,
          kind: 'MANUFACTURER' as const,
        })),
      });
    }
    const after: Record<string, unknown> = { ...fields };
    const before: Record<string, unknown> = Object.fromEntries(
      Object.keys(fields)
        .filter((k) => k !== 'allowFraction')
        .map((k) => [k, existing[k as keyof ExistingItem]]),
    );
    delete after['allowFraction'];
    if (supplier) {
      before['supplierId'] = existing.supplierId;
      after['supplierId'] = supplier.id;
    }
    if (machineModelIds) {
      before['machineModelIds'] = [...existing.machineModelIds].sort();
      after['machineModelIds'] = [...machineModelIds].sort();
    }
    if (addBarcodes.length) {
      before['barcodes'] = existing.barcodes;
      after['barcodes'] = [...existing.barcodes, ...addBarcodes];
    }
    await this.record(tx, existing.id, 'update', before, after);
  }

  private partNoNorm(partNo: string): string {
    const norm = normalizePartNo(partNo);
    if (!norm)
      invalid('The part number needs at least one letter or digit.', [
        'partNo',
      ]);
    return norm;
  }

  private checkQty(uom: string, minQty: string): boolean {
    const unit = UOMS.find((u) => u.code === uom);
    if (!unit) invalid('Unknown unit.', ['uom']);
    if (!unit.fraction && !isWhole(minQty)) {
      invalid(`Minimum quantity must be a whole number for ${unit.code}.`, [
        'minQty',
      ]);
    }
    return unit.fraction;
  }

  private async checkRefs(refs: {
    brandId?: string;
    defaultBinId: string | null;
    machineModelIds: readonly string[];
  }) {
    const storeId = await this.store.id();
    const ids = [...new Set(refs.machineModelIds)];
    const [brand, bin, models] = await Promise.all([
      refs.brandId
        ? this.prisma.brand.findUnique({
            where: { id: refs.brandId },
            select: { active: true },
          })
        : null,
      refs.defaultBinId
        ? this.prisma.bin.findUnique({
            where: { id: refs.defaultBinId },
            select: { storeId: true, active: true, kind: true },
          })
        : null,
      ids.length
        ? this.prisma.machineModel.count({ where: { id: { in: ids } } })
        : 0,
    ]);
    if (refs.brandId && !brand?.active)
      invalid('Choose an active brand.', ['brandId']);
    if (
      refs.defaultBinId &&
      (!bin || !bin.active || bin.kind !== 'STORAGE' || bin.storeId !== storeId)
    ) {
      invalid('The default bin must be an active storage bin.', [
        'defaultBinId',
      ]);
    }
    if (models !== ids.length)
      invalid('Unknown machine model.', ['machineModelIds']);
  }

  private async uniqueGuard<T>(
    run: () => Promise<T>,
    importing = false,
  ): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (isUniqueViolation(error)) {
        if (importing) {
          conflict(
            'IMPORT_CONFLICT',
            'Some items or barcodes were added meanwhile. Check the file again.',
          );
        }
        itemExists();
      }
      throw error;
    }
  }

  private record(
    tx: TransactionClient,
    entityId: string,
    action: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
  ) {
    return this.audit.record(
      {
        moduleKey: MODULE_KEY,
        entityKey: itemEntity.key,
        entityId,
        action,
        before,
        after,
      },
      tx,
    );
  }
}

/** `null` when the barcode is already on this part; `undefined` when the other part is unknown. */
function barcodeInUse(otherPartNo: string | null | undefined): never {
  conflict(
    'BARCODE_IN_USE',
    otherPartNo === null
      ? 'This part already has that barcode.'
      : otherPartNo
        ? `That barcode is already on another part: ${otherPartNo}.`
        : 'That barcode is already on another part.',
  );
}
