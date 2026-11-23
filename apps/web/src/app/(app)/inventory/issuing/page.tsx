import Link from 'next/link';
import {
  ActionTiles,
  type ActionTileItem,
  canDo,
  Chips,
  Empty,
  LinkList,
  Mono,
  PageHead,
  SectionCard,
} from '@dax/web-shell';
import { formatDateTime } from '../../../../lib/format';
import { flatten, type SearchParams, toQuery } from '../../../../lib/query';
import { requirePermission } from '../../../../lib/server';
import { getIssuingSummary, listMrns } from './_lib/data';
import { BASE, MRN_SUBTYPE_LABELS, mrnPath } from './_lib/labels';
import { MrnStatusPill, WaitingPill } from './_lib/pills';

const CHIPS = [
  { value: 'OPEN', label: 'Open' },
  { value: 'SUBMITTED', label: 'To check' },
  { value: 'WAITING', label: 'Waiting for stock' },
  { value: 'READY', label: 'Ready to pick' },
  { value: 'ALL', label: 'All' },
];

export default async function IssuingPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const caps = await requirePermission(
    'inventory.mrn.view',
    'inventory.aod.view',
    'inventory.hold.view',
  );
  const can = (p: string) => canDo(caps, p);
  const query = flatten(await searchParams);
  const status = CHIPS.some((c) => c.value === query['status'])
    ? (query['status'] ?? 'OPEN')
    : 'OPEN';
  const canMrns = can('inventory.mrn.view');
  const canAods = can('inventory.aod.view');

  const [summary, mrns] = await Promise.all([
    getIssuingSummary(),
    canMrns ? listMrns({ status, limit: '10' }) : null,
  ]);

  const n = (v: number | undefined) => (summary ? v : undefined);
  const tiles: ActionTileItem[] = [];
  if (can('inventory.mrn.create'))
    tiles.push({
      href: `${BASE}/mrns/new`,
      title: 'Raise MRN',
      sub: 'Parts a job or department needs.',
      icon: 'plus',
      use: 'often',
    });
  if (can('inventory.mrn.check') && canMrns)
    tiles.push({
      href: `${BASE}/mrns?status=SUBMITTED`,
      title: 'Check MRNs',
      sub: 'Check new MRNs and reserve what is free.',
      icon: 'clipboard',
      use: 'often',
      count: n(summary?.mrnToCheck),
    });
  if (can('inventory.aod.issue'))
    tiles.push({
      href: `${BASE}/mrns?status=READY`,
      title: 'Pick and issue AOD',
      sub: 'MRNs ready to pick. Pick parts and print the AOD.',
      icon: 'send',
      use: 'often',
      count: n(summary?.mrnReady),
    });
  if (can('inventory.aod.issue') && canAods)
    tiles.push({
      href: `${BASE}/aods?status=PICKING`,
      title: 'Continue picking',
      sub: 'AODs still being picked.',
      icon: 'box',
      use: 'often',
      count: n(summary?.picking),
    });
  if (can('inventory.aod.issue') && canAods)
    tiles.push({
      href: `${BASE}/aods?status=APPROVED`,
      title: 'Issue approved AODs',
      sub: 'Approved and ready to issue and print.',
      icon: 'check',
      use: 'often',
      count: n(summary?.approved),
    });
  if (can('inventory.mrn.allocate'))
    tiles.push({
      href: `${BASE}/mrns?status=WAITING`,
      title: 'Waiting for stock',
      sub: 'Assign newly arrived stock to waiting MRNs.',
      icon: 'history',
      use: 'often',
      count: n(summary?.mrnWaiting),
    });
  if (can('inventory.aod.approve'))
    tiles.push({
      href: `${BASE}/aods?status=PENDING_APPROVAL`,
      title: 'Approve AODs',
      sub: 'Waiting for your approval before Stores issues them.',
      icon: 'check',
      use: 'often',
      count: n(summary?.awaitingApproval),
    });
  if (canAods)
    tiles.push({
      href: `${BASE}/aods?status=ISSUED`,
      title: 'Awaiting signature',
      sub: 'Issued AODs that need their signed copy uploaded.',
      icon: 'edit',
      use: 'often',
      count: n(summary?.awaitingSignature),
    });
  if (can('inventory.hold.view'))
    tiles.push({
      href: `${BASE}/holds`,
      title: 'Holds',
      sub: 'Active holds. Stock kept aside for a customer or job.',
      icon: 'lock',
      use: 'sometimes',
      count: n(summary?.activeHolds),
    });

  return (
    <>
      <PageHead
        eyebrow="Inventory"
        title="Issuing"
        lede="MRNs are checked and reserved, picked onto an AOD, approved, issued, then completed with the signed copy."
      />
      {tiles.length ? (
        <SectionCard title="What would you like to do?">
          <ActionTiles items={tiles} />
        </SectionCard>
      ) : null}
      {mrns ? (
        <SectionCard
          title="MRNs"
          note="Material request notes"
          actions={
            <Link className="dax-link" href={`${BASE}/mrns`}>
              See all
            </Link>
          }
          toolbar={
            <Chips
              items={CHIPS.map((c) => ({
                href: `${BASE}${toQuery({ status: c.value === 'OPEN' ? undefined : c.value })}`,
                label: c.label,
                active: c.value === status,
              }))}
            />
          }
        >
          {mrns.items.length ? (
            <LinkList
              items={mrns.items.map((m) => ({
                key: m.id,
                href: mrnPath(m.id),
                title: (
                  <>
                    <Mono>{m.number ?? 'Draft'}</Mono> · {m.department.name}
                    {m.customer ? ` · ${m.customer.name}` : ''}
                  </>
                ),
                sub: [
                  MRN_SUBTYPE_LABELS[m.subtype],
                  m.jobNumber ? `Job ${m.jobNumber}` : null,
                  `${m.lineCount} ${m.lineCount === 1 ? 'line' : 'lines'}`,
                  formatDateTime(m.createdAt),
                ]
                  .filter(Boolean)
                  .join(' · '),
                aside: (
                  <span className="dax-chips" style={{ gap: 4 }}>
                    <WaitingPill count={m.waitingLines} />
                    <MrnStatusPill status={m.status} />
                  </span>
                ),
              }))}
            />
          ) : (
            <Empty title="No MRNs here">
              {status === 'OPEN'
                ? 'Nothing is open right now.'
                : 'Try another filter.'}
            </Empty>
          )}
        </SectionCard>
      ) : null}
    </>
  );
}
