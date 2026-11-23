// Sample bundles: a saved service kit issued to a customer, and a one-off set
// on an AOD that waits for a department head's approval.
// Called by stores-seed-documents.ts, and by seed-bundles.ts for a database
// seeded before bundles existed.
/* eslint-disable @nx/enforce-module-boundaries -- dev-only seed, see stores-seed-documents.ts */
import type { AuditService, Policy } from '@dax/platform-core';
import type { PrismaService } from '@dax/platform-db';
import { BundlesService } from '../../../libs/inventory/server/src/lib/bundles/bundles.service';
import type { AodsService } from '../../../libs/inventory/server/src/lib/issuing/aods.service';
import type { MrnsService } from '../../../libs/inventory/server/src/lib/issuing/mrns.service';
/* eslint-enable @nx/enforce-module-boundaries */

export const SEED_KIT = '500-hr service kit (CAT C9)';

export interface BundleSeedDeps {
  prisma: PrismaService;
  keeper: Policy;
  audit: AuditService;
  mrns: MrnsService;
  aods: AodsService;
  departmentId: string;
}

export async function seedBundles(deps: BundleSeedDeps): Promise<string[]> {
  const { prisma, keeper, mrns, aods, departmentId } = deps;
  const bundles = new BundlesService(prisma, deps.audit);
  const items = await prisma.item.findMany({
    where: {
      createdBy: keeper.userId,
      partNo: { in: ['1R-0750', '1R-1808', '15W40-CK4', 'LF9009', 'FF5052'] },
    },
    select: { id: true, partNo: true },
  });
  const itemId = (partNo: string) => {
    const found = items.find((i) => i.partNo === partNo);
    if (!found) throw new Error(`Bundle seed names an unknown item: ${partNo}`);
    return found.id;
  };
  const customerId = async (name: string) =>
    (
      await prisma.customer.findFirstOrThrow({
        where: { name, createdBy: keeper.userId },
        select: { id: true },
      })
    ).id;

  const kit = await bundles.create(keeper.userId, {
    name: SEED_KIT,
    description: 'Filters and oil for a 500-hour service on a CAT C9 engine.',
    lines: [
      { itemId: itemId('1R-0750'), qty: '2' },
      { itemId: itemId('1R-1808'), qty: '1' },
      { itemId: itemId('15W40-CK4'), qty: '12' },
    ],
  });
  const kitLines = kit.lines.map((l) => ({
    itemId: l.item.id,
    qtyPerSet: l.qty,
  }));

  const raise = async (
    customer: string,
    job: string,
    bundle: {
      bundleId: string | null;
      name: string;
      qtySets: number;
      lines: { itemId: string; qtyPerSet: string }[];
    },
    loose: [string, string][],
  ) => {
    const draft = await mrns.create(keeper, {
      subtype: 'SAL',
      departmentId,
      customerId: await customerId(customer),
      jobNumber: job,
      lines: loose.map(([part, qty]) => ({ itemId: itemId(part), qty })),
      bundles: [bundle],
    });
    const sent = await mrns.submit(keeper, draft.id, draft.version);
    return mrns.check(keeper, sent.id, sent.version);
  };

  // Saved kit × 2 plus a loose part, issued: both printouts show the bundle.
  const kitMrn = await raise(
    'Lankaputra Constructions (Pvt) Ltd',
    'JOB-2611-031',
    { bundleId: kit.id, name: kit.name, qtySets: 2, lines: kitLines },
    [['LF9009', '2']],
  );
  let kitAod = await aods.create(keeper, {
    mrnId: kitMrn.id,
    type: 'DIR',
    deliverTo: 'Lankaputra Constructions, Kelaniya yard',
    vehicleNo: 'WP CAB-7720',
  });
  const sent = await aods.submit(keeper, kitAod.id, kitAod.version);
  const approved = await aods.approve(keeper, kitAod.id, sent.version);
  kitAod = await aods.issue(keeper, kitAod.id, approved.version);

  // One-off set, sent for approval and left waiting.
  const oneOff = await raise(
    'Ceylon Power Rentals',
    'JOB-2611-032',
    {
      bundleId: null,
      name: 'Generator filter set',
      qtySets: 1,
      lines: [
        { itemId: itemId('LF9009'), qtyPerSet: '1' },
        { itemId: itemId('FF5052'), qtyPerSet: '2' },
      ],
    },
    [],
  );
  const pending = await aods.create(keeper, {
    mrnId: oneOff.id,
    type: 'DIR',
    deliverTo: 'Ceylon Power Rentals, Peliyagoda',
  });
  await aods.submit(keeper, pending.id, pending.version);

  return [
    `Bundle ${kit.name}: saved`,
    `AOD ${kitAod.number}: ${kit.name} × 2 issued to a customer`,
    `MRN ${oneOff.number}: one-off bundle, AOD awaiting approval`,
  ];
}
