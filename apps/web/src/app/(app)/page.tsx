import Link from 'next/link';
import {
  ActionTiles,
  type ActionTileItem,
  canDo,
  Empty,
  Facts,
  greeting,
  type Kpi,
  KpiTiles,
  LinkList,
  Mono,
  PageHead,
  Pill,
  SearchBox,
  SectionCard,
  todayLabel,
} from '@dax/web-shell';
import { formatQty } from '../../lib/format';
import { requireCapabilities } from '../../lib/server';
import { getInventorySummary, listStock } from './inventory/_lib/data';
import { getIssuingSummary } from './inventory/issuing/_lib/data';
import { getReceivingSummary } from './inventory/receiving/_lib/data';
import { getPartiesSummary } from './parties/_party/data';
import { StartOnScan } from '../../components/start-on-scan';
import { flatten, type SearchParams } from '../../lib/query';

const count = new Intl.NumberFormat('en-LK');

export default async function HomePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const caps = await requireCapabilities();
  const can = (p: string) => canDo(caps, p);
  const canSeeItems = can('inventory.item.view');
  const canSeeStock = can('inventory.stock.view');
  const canScan = canSeeItems || can('inventory.location.view');

  const canPutAway = can('inventory.grn.putaway');
  const canSign = can('inventory.aod.attach_signed');
  const canAllocate = can('inventory.mrn.allocate');
  const canApprove = can('inventory.aod.approve');
  const [inventory, parties, low, receiving] = await Promise.all([
    canSeeItems ? getInventorySummary() : null,
    getPartiesSummary(),
    canSeeStock ? listStock({ belowMin: 'true', limit: '5' }) : null,
    canPutAway ? getReceivingSummary() : null,
  ]);
  const issuing =
    canSign || canAllocate || canApprove ? await getIssuingSummary() : null;
  const firstName = caps.user.name.trim().split(/\s+/)[0] ?? caps.user.name;

  const kpis: Kpi[] = [];
  if (inventory) {
    kpis.push(
      {
        label: 'Items',
        value: count.format(inventory.items),
        tone: 'int',
        href: canSeeStock ? '/inventory/stock' : undefined,
      },
      {
        label: 'Below minimum',
        value: count.format(inventory.belowMin),
        tone: 'bad',
        href: canSeeStock ? '/inventory/stock?belowMin=true' : undefined,
      },
      {
        label: 'In stock',
        value: count.format(inventory.inStock),
        tone: 'ok',
        href: canSeeStock ? '/inventory/stock?inStock=true' : undefined,
      },
      {
        label: 'Bins',
        value: count.format(inventory.bins),
        tone: 'hi',
        href: can('inventory.location.view')
          ? '/inventory/locations'
          : undefined,
      },
    );
  } else {
    if (parties?.customers != null) {
      kpis.push({
        label: 'Customers',
        value: count.format(parties.customers),
        tone: 'int',
        href: '/parties/customers',
      });
    }
    if (parties?.suppliers != null) {
      kpis.push({
        label: 'Suppliers',
        value: count.format(parties.suppliers),
        tone: 'ext',
        href: '/parties/suppliers',
      });
    }
  }

  const tiles: ActionTileItem[] = [];
  if (canScan)
    tiles.push({
      href: '/scan/choose',
      title: 'Scan a label',
      sub: 'Use a camera or a phone on a bin or item label.',
      icon: 'scan',
      use: 'often',
    });
  if (canApprove)
    tiles.push({
      href: '/inventory/issuing/aods?status=PENDING_APPROVAL',
      title: 'Approve AODs',
      sub: 'Waiting for your approval before Stores issues them.',
      icon: 'check',
      use: 'often',
      count: issuing?.awaitingApproval,
    });
  if (canSign)
    tiles.push({
      href: '/inventory/issuing/aods?status=ISSUED',
      title: 'Awaiting signature',
      sub: 'Issued AODs that need their signed copy uploaded.',
      icon: 'send',
      use: 'often',
      count: issuing?.awaitingSignature,
    });
  if (canAllocate)
    tiles.push({
      href: '/inventory/issuing/mrns?status=WAITING',
      title: 'Waiting for stock',
      sub: 'Assign newly arrived stock to waiting MRNs.',
      icon: 'history',
      use: 'often',
      count: issuing?.mrnWaiting,
    });
  if (canPutAway)
    tiles.push({
      href: '/inventory/receiving/putaway',
      title: 'Waiting for put-away',
      sub: 'Move received stock from the receiving bin to its shelf.',
      icon: 'box',
      use: 'often',
      count: receiving?.awaitingPutaway,
    });
  if (can('inventory.grn.check'))
    tiles.push({
      href: '/inventory/receiving/grns/new',
      title: 'Raise GRN',
      sub: 'Check a delivery at the dock on a GRN.',
      icon: 'truck',
      use: 'often',
    });
  if (can('inventory.count.approve'))
    tiles.push({
      href: '/inventory/counts?status=SUBMITTED',
      title: 'Approve counts',
      sub: 'Review differences before stock changes.',
      icon: 'clipboard',
      use: 'sometimes',
    });
  else if (can('inventory.count.count'))
    tiles.push({
      href: '/inventory/counts',
      title: 'Count stock',
      sub: 'Count the bins on an open count sheet.',
      icon: 'clipboard',
      use: 'sometimes',
    });
  if (can('inventory.return_note.create'))
    tiles.push({
      href: '/inventory/returns/new',
      title: 'Take back a return',
      sub: 'Parts coming back from a job or customer.',
      icon: 'undo',
      use: 'sometimes',
    });
  if (can('inventory.warranty.tag'))
    tiles.push({
      href: '/inventory/warranty/new',
      title: 'Tag a failed part',
      sub: 'Record a part for a warranty claim.',
      icon: 'shield',
      use: 'sometimes',
    });
  if (canSeeStock)
    tiles.push({
      href: '/inventory/reports/below-minimum',
      title: 'See what to reorder',
      sub: 'Parts below their minimum quantity.',
      icon: 'chart',
      use: 'sometimes',
      count: inventory?.belowMin,
    });
  if (canSeeStock)
    tiles.push({
      href: '/inventory/reports/stock-age',
      title: 'Age analysis',
      sub: inventory
        ? `Parts held over ${count.format(inventory.agedLimit)} days.`
        : 'How long parts have been on the shelf.',
      icon: 'history',
      use: 'sometimes',
      count: inventory?.agedOver,
    });
  if (canSeeStock)
    tiles.push({
      href: '/inventory/stock',
      title: 'Find a part',
      sub: 'Search parts and see on hand, held and free by bin.',
      icon: 'search',
      use: 'often',
    });
  if (can('inventory.item.create'))
    tiles.push({
      href: '/inventory/items/new',
      title: 'Add an item',
      sub: 'Part number, brand, unit and minimum.',
      icon: 'plus',
      use: 'rarely',
    });
  if (can('inventory.location.print_label'))
    tiles.push({
      href: '/inventory/locations',
      title: 'Print bin labels',
      sub: 'Tick bins, then print a sheet of labels.',
      icon: 'printer',
      use: 'rarely',
    });
  if (can('parties.customer.view'))
    tiles.push({
      href: '/parties/customers',
      title: 'Find a customer',
      sub: 'Contacts, phone numbers and addresses.',
      icon: 'users',
      use: 'sometimes',
    });
  if (can('parties.supplier.view'))
    tiles.push({
      href: '/parties/suppliers',
      title: 'Find a supplier',
      sub: 'Local and foreign suppliers.',
      icon: 'building',
      use: 'sometimes',
    });

  const glance = [
    ...(inventory
      ? [
          { label: 'Zones', value: count.format(inventory.zones) },
          { label: 'Bins', value: count.format(inventory.bins) },
          { label: 'Brands', value: count.format(inventory.brands) },
          { label: 'Active items', value: count.format(inventory.items) },
        ]
      : []),
    ...(parties?.customers != null
      ? [{ label: 'Customers', value: count.format(parties.customers) }]
      : []),
    ...(parties?.suppliers != null
      ? [{ label: 'Suppliers', value: count.format(parties.suppliers) }]
      : []),
  ];

  const fromApp = flatten(await searchParams)['from'] === 'app';
  return (
    <>
      {fromApp && canScan ? <StartOnScan /> : null}
      <PageHead
        eyebrow={todayLabel()}
        title={`${greeting()}, ${firstName}`}
        lede="Find parts, check stock and print labels for the main store."
        actions={
          canSeeStock ? (
            <SearchBox
              action="/inventory/stock"
              label="Find a part"
              placeholder="Search parts, barcodes…"
            />
          ) : null
        }
      />
      {kpis.length ? <KpiTiles items={kpis} /> : null}
      {tiles.length ? (
        <SectionCard
          title="What would you like to do?"
          note={
            <span className="dax-tile-key">
              <span>
                <i className="orange" />
                Daily work
              </span>
              <span>
                <i className="blue" />
                Now and then
              </span>
              <span>
                <i className="gray" />
                Setup
              </span>
            </span>
          }
        >
          <ActionTiles items={tiles} />
        </SectionCard>
      ) : (
        <Empty title="No screens yet">
          Your account has no screens yet. Ask an administrator for access.
        </Empty>
      )}
      {low || glance.length ? (
        <div className="dax-grid2">
          {low ? (
            <SectionCard
              title="Below minimum"
              note="Parts to reorder soon"
              actions={
                low.items.length ? (
                  <Link
                    className="dax-link"
                    href="/inventory/stock?belowMin=true"
                  >
                    See all
                  </Link>
                ) : null
              }
            >
              {low.items.length ? (
                <LinkList
                  items={low.items.map((row) => ({
                    key: row.item.id,
                    href: canSeeItems
                      ? `/inventory/items/${row.item.id}`
                      : undefined,
                    title: <Mono>{row.item.partNo}</Mono>,
                    sub: row.item.description,
                    aside: (
                      <Pill tone="bad">
                        {formatQty(row.stock.onHand)} of {formatQty(row.minQty)}{' '}
                        {row.item.uom}
                      </Pill>
                    ),
                  }))}
                />
              ) : (
                <Empty title="All parts are above minimum" />
              )}
            </SectionCard>
          ) : null}
          {glance.length ? (
            <SectionCard title="Store at a glance" note="Active records">
              <Facts items={glance} big />
            </SectionCard>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
