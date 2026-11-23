// Dev only. Adds the sample bundles to a database that was seeded before
// bundles existed, without reseeding. A fresh pnpm db:seed:stores already
// includes them.
// Run: pnpm db:seed:bundles   Undo: pnpm db:unseed:stores (removes them with the rest)
/* eslint-disable @nx/enforce-module-boundaries -- dev-only seed, see stores-seed-documents.ts */
import {
  AttachmentAccessRegistry,
  AuditService,
  type EntityDef,
  EventBus,
  InboxService,
  NumberingService,
  type Policy,
  PolicyService,
  type RequestContext,
} from '@dax/platform-core';
import { PrismaService } from '@dax/platform-db';
import {
  INVENTORY_ENTITIES,
  MainStore,
  StockPostingService,
} from '@dax/inventory-server';
import { PARTIES_ENTITIES } from '@dax/parties-server';
import { AodsService } from '../../../libs/inventory/server/src/lib/issuing/aods.service';
import { MrnsService } from '../../../libs/inventory/server/src/lib/issuing/mrns.service';
/* eslint-enable @nx/enforce-module-boundaries */
import { assertLocalDatabase } from './seed-guard';
import { SEED_KIT, seedBundles } from './stores-seed-bundles';
import { SEED_USERS } from './stores-seed-data';

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
        'inventory.item.view',
        'inventory.stock.view',
        'inventory.mrn.view',
        'inventory.mrn.create',
        'inventory.aod.view',
        'inventory.aod.issue',
        'inventory.aod.approve',
      ].map((p) => [p, { scope: 'ALL' as const, storeIds: [] }]),
    ),
    sources: new Map(),
    denied: new Set(),
    fields,
    validUntil: Number.MAX_SAFE_INTEGER,
    version: 'seed',
  };
}

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
    if (await prisma.bundle.count({ where: { name: SEED_KIT } })) {
      console.log('The sample bundles are already here.');
      return;
    }
    const department = await prisma.department.findFirst({
      where: { active: true },
      orderBy: { name: 'asc' },
      select: { id: true },
    });
    if (!department) throw new Error('There is no active department.');

    const keeper = seedPolicy(SEED_USERS.keeper.id);
    const keeperCtx = {
      get: () => ({ actor: SEED_USERS.keeper }),
    } as unknown as RequestContext;
    const store = new MainStore(prisma);
    const numbering = new NumberingService();
    const engine = new StockPostingService(store, keeperCtx);
    const audit = new AuditService(prisma, keeperCtx, ENTITIES);
    const mrns = new MrnsService(prisma, audit, numbering, engine, store, []);
    const aods = new AodsService(
      prisma,
      audit,
      numbering,
      new EventBus(),
      engine,
      store,
      mrns,
      new AttachmentAccessRegistry(),
      new InboxService(prisma, new PolicyService(prisma)),
    );
    const summary = await seedBundles({
      prisma,
      keeper,
      audit,
      mrns,
      aods,
      departmentId: department.id,
    });
    for (const line of summary) console.log(`  ${line}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
