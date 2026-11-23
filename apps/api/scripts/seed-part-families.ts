// Dev only. Adds the superseded seed parts (marked -OLD) to a database that was
// seeded before part families existed, without reseeding. A fresh
// pnpm db:seed:stores already includes them.
// Run: pnpm db:seed:families   Undo: pnpm db:unseed:stores (removes them with the rest)
import {
  AuditService,
  type EntityDef,
  NumberingService,
  type Policy,
  type RequestContext,
} from '@dax/platform-core';
import { PrismaService } from '@dax/platform-db';
import {
  INVENTORY_ENTITIES,
  ItemsService,
  MainStore,
  StockPostingService,
} from '@dax/inventory-server';
import { PARTIES_ENTITIES } from '@dax/parties-server';
// eslint-disable-next-line @nx/enforce-module-boundaries
import { CountsService } from '../../../libs/inventory/server/src/lib/counts/counts.service';
import { assertLocalDatabase } from './seed-guard';
import { ITEMS, SEED_USERS } from './stores-seed-data';

const ENTITIES: EntityDef[] = [...INVENTORY_ENTITIES, ...PARTIES_ENTITIES];

function seedPolicy(userId: string): Policy {
  const fields = new Map(
    ENTITIES.map((def) => [
      def.key,
      {
        read: new Set(Object.keys(def.fields)),
        write: new Set(
          Object.entries(def.fields)
            .filter(([, meta]) => meta.writable)
            .map(([name]) => name),
        ),
      },
    ]),
  );
  return {
    userId,
    isSuperAdmin: false,
    require2fa: false,
    departmentIds: [],
    roleIds: [],
    enabledModules: new Set(['inventory', 'parties']),
    permissions: new Map(
      [
        'inventory.count.view',
        'inventory.count.create',
        'inventory.count.count',
        'inventory.count.submit',
        'inventory.count.approve',
        'inventory.item.view',
      ].map((p) => [p, { scope: 'ALL' as const, storeIds: [] }]),
    ),
    sources: new Map(),
    denied: new Set(),
    fields,
    validUntil: Number.MAX_SAFE_INTEGER,
    version: 'seed',
  };
}

const contextFor = (actor: { id: string; name: string }) =>
  ({ get: () => ({ actor }) }) as unknown as RequestContext;

async function main() {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is not set.');
  assertLocalDatabase(url);
  const prisma = new PrismaService({ url, applicationName: 'dax-seed' });
  try {
    const seeded = await prisma.user.count({
      where: { id: SEED_USERS.keeper.id },
    });
    if (seeded === 0) {
      console.log('No stores seed here. Run pnpm db:seed:stores instead.');
      return;
    }
    const older = ITEMS.filter((it) => it.supersededBy);
    const brandIds = new Map(
      (await prisma.brand.findMany({ select: { id: true, name: true } })).map(
        (b) => [b.name, b.id],
      ),
    );
    const key = (brand: string, partNo: string) => `${brand}|${partNo}`;
    const existing = new Map(
      (
        await prisma.item.findMany({
          select: { id: true, partNo: true, version: true, brandId: true },
        })
      ).map((i) => [`${i.brandId}|${i.partNo}`, i]),
    );
    const find = (brand: string, partNo: string) =>
      existing.get(`${brandIds.get(brand)}|${partNo}`);
    if (older.every((it) => find(it.brand, it.partNo))) {
      console.log('The superseded seed parts are already here.');
      return;
    }

    const keeper = seedPolicy(SEED_USERS.keeper.id);
    const approver = seedPolicy(SEED_USERS.approver.id);
    const store = new MainStore(prisma);
    const numbering = new NumberingService();
    const keeperCtx = contextFor(SEED_USERS.keeper);
    const items = new ItemsService(
      prisma,
      new AuditService(prisma, keeperCtx, ENTITIES),
      store,
    );
    const engine = new StockPostingService(store, keeperCtx);
    const countsAs = (actor: { id: string; name: string }) =>
      new CountsService(
        prisma,
        new AuditService(prisma, contextFor(actor), ENTITIES),
        numbering,
        engine,
        store,
      );
    const binIds = new Map(
      (await prisma.bin.findMany({ select: { id: true, code: true } })).map(
        (b) => [b.code, b.id],
      ),
    );
    const modelIds = new Map(
      (
        await prisma.machineModel.findMany({ select: { id: true, name: true } })
      ).map((m) => [m.name, m.id]),
    );
    const need = <T>(value: T | undefined, what: string): T => {
      if (value === undefined) throw new Error(`Missing ${what}`);
      return value;
    };

    const ids = new Map<string, { id: string; version: number }>();
    for (const it of older) {
      const created = await items.create(keeper, {
        partNo: it.partNo,
        brandId: need(brandIds.get(it.brand), it.brand),
        description: it.description,
        uom: it.uom,
        minQty: it.minQty,
        defaultBinId: need(binIds.get(it.stock[0][0]), it.stock[0][0]),
        machineModelIds: it.models.map((m) => need(modelIds.get(m), m)),
        supplierId: null,
        tags: [],
        preCostPrice: null,
        sellingPrice: null,
      });
      ids.set(key(it.brand, it.partNo), {
        id: created.id,
        version: created.version,
      });
      console.log(`Added ${it.partNo}`);
    }

    // Their bins have had their one opening count, so the stock goes in on a cycle count.
    const bins = [...new Set(older.flatMap((it) => it.stock.map(([b]) => b)))];
    const keeperCounts = countsAs(SEED_USERS.keeper);
    let count = await keeperCounts.create(keeper, {
      kind: 'CYCLE',
      blind: false,
      notes: 'Stock of the superseded seed parts.',
      zoneIds: [],
      binIds: bins.map((b) => need(binIds.get(b), b)),
    });
    const unchanged = count.bins.flatMap((b) =>
      b.lines.map((l) => ({ lineId: l.id, countedQty: l.systemQty ?? '0' })),
    );
    if (unchanged.length) {
      count = await keeperCounts.enter(keeper, count.id, {
        version: count.version,
        lines: unchanged,
      });
    }
    for (const it of older) {
      for (const [bin, qty] of it.stock) {
        if (Number(qty) <= 0) continue;
        count = await keeperCounts.addLine(keeper, count.id, {
          version: count.version,
          binId: need(binIds.get(bin), bin),
          itemId: need(ids.get(key(it.brand, it.partNo)), it.partNo).id,
          countedQty: qty,
        });
      }
    }
    count = await keeperCounts.submit(keeper, count.id, count.version);
    count = await countsAs(SEED_USERS.approver).approve(
      approver,
      count.id,
      count.version,
    );
    console.log(`Count ${count.number} posted their stock.`);

    for (const it of older) {
      const self = need(ids.get(key(it.brand, it.partNo)), it.partNo);
      const target =
        ids.get(key(it.brand, it.supersededBy ?? '')) ??
        find(it.brand, it.supersededBy ?? '');
      const updated = await items.supersede(keeper, self.id, {
        replacementId: need(target, `${it.supersededBy}`).id,
        version: self.version,
      });
      self.version = updated.version;
      console.log(`${it.partNo} superseded by ${it.supersededBy}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
