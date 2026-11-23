import {
  Alert,
  Table,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
} from '@mantine/core';
import Link from 'next/link';
import {
  canDo,
  Empty,
  Facts,
  Mono,
  PageHead,
  Pill,
  SectionCard,
} from '@dax/web-shell';
import { ConfirmAction } from '../../../../../components/confirm-action';
import { PrintLabelsButton } from '../../../../../components/labels';
import { AppLink } from '../../../../../components/links';
import { BelowMinBadge, StockPanel } from '../../../../../components/stock';
import { names, TagChips } from '../../../../../components/item-extras';
import {
  formatDateTime,
  formatMoney,
  formatQty,
  uomLabel,
} from '../../../../../lib/format';
import { optional, uuidParam } from '../../../../../lib/load';
import { requirePermission } from '../../../../../lib/server';
import {
  getCatalog,
  getItem,
  getItemAge,
  getItemSerials,
} from '../../_lib/data';
import { listMovements } from '../../receiving/_lib/data';
import { setItemStatus } from '../_item/actions';
import { Barcodes } from '../_item/barcodes';
import { ItemForm } from '../_item/item-form';
import { Movements } from '../_item/movements';
import { Replacement } from '../_item/replacement';
import { SerialsCard } from '../_item/serials';
import { StockAgeCard } from '../_item/stock-age';

export default async function ItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const caps = await requirePermission('inventory.item.view');
  const id = await uuidParam(params);
  const [item, movements, age, serials] = await Promise.all([
    getItem(id),
    canDo(caps, 'inventory.ledger.view') ? optional(listMovements(id)) : null,
    canDo(caps, 'inventory.stock.view') ? optional(getItemAge(id)) : null,
    optional(getItemSerials(id)),
  ]);
  const canPrintSerials =
    canDo(caps, 'inventory.item.print_label') ||
    canDo(caps, 'inventory.grn.post') ||
    canDo(caps, 'inventory.grn.putaway');
  const active = item.status === 'ACTIVE';
  const canEdit = canDo(caps, 'inventory.item.edit') && active;
  const canArchive = canDo(caps, 'inventory.item.archive');
  const canPrint = canDo(caps, 'inventory.item.print_label');
  const catalog = canEdit ? await getCatalog() : null;
  const replacement = item.latestReplacement ?? item.supersededBy;

  return (
    <>
      <PageHead
        back={{ href: '/inventory/items', label: 'Items' }}
        eyebrow={
          <>
            {item.brand.name} · Added {formatDateTime(item.createdAt)} · Updated{' '}
            {formatDateTime(item.updatedAt)}
          </>
        }
        title={<Mono>{item.partNo}</Mono>}
        lede={item.description}
        actions={
          <>
            {canPrint ? (
              <PrintLabelsButton kind="item" ids={[item.id]} />
            ) : null}
            {canArchive ? (
              <ConfirmAction
                action={setItemStatus}
                payload={{
                  id: item.id,
                  version: item.version,
                  status: active ? 'ARCHIVED' : 'ACTIVE',
                }}
                label={active ? 'Archive' : 'Restore'}
                title={
                  active ? `Archive ${item.partNo}?` : `Restore ${item.partNo}?`
                }
                message={
                  active
                    ? 'Archived items are hidden from pickers and new documents. Stock and history stay visible.'
                    : 'The item can be used in new documents again.'
                }
                color={active ? 'red' : undefined}
              />
            ) : null}
          </>
        }
      />
      {!active || item.belowMin || item.supersededBy ? (
        <div className="dax-chips">
          {!active ? <Pill>Archived</Pill> : <Pill tone="ok">Active</Pill>}
          {item.supersededBy ? <Pill tone="yel">Superseded</Pill> : null}
          <BelowMinBadge belowMin={item.belowMin} />
        </div>
      ) : null}

      {replacement ? (
        <Alert color="yellow" title="This part number has been superseded">
          Superseded by{' '}
          <AppLink href={`/inventory/items/${replacement.id}`} fw={700}>
            <Mono>{replacement.partNo}</Mono> ({replacement.brand})
          </AppLink>
          . Use the new number where you can. This number's stock still counts
          towards the family and is used first, and it is shown below.
        </Alert>
      ) : null}

      <SectionCard title="Stock" note="Main store">
        <div className="dax-stack" style={{ gap: 16 }}>
          <StockPanel
            stock={item.stock}
            minQty={item.minQty}
            uom={item.uom}
            belowMin={item.belowMin}
          />
          {item.stockByBin.length ? (
            <Table>
              <TableThead>
                <TableTr>
                  <TableTh>Bin</TableTh>
                  <TableTh ta="right">Quantity</TableTh>
                </TableTr>
              </TableThead>
              <TableTbody>
                {item.stockByBin.map((row) => (
                  <TableTr key={row.binId}>
                    <TableTd>
                      <Link
                        href={`/inventory/locations/bins/${row.binId}`}
                        className="dax-link"
                      >
                        <Mono>{row.binCode}</Mono>
                      </Link>
                    </TableTd>
                    <TableTd className="dax-num">
                      {formatQty(row.qty)} {item.uom}
                    </TableTd>
                  </TableTr>
                ))}
              </TableTbody>
            </Table>
          ) : (
            <Empty title="Not in any bin yet" />
          )}
        </div>
      </SectionCard>

      {item.family.members.length > 1 ? (
        <SectionCard
          flush
          title="Part family"
          note="Superseded numbers share their stock: MRNs reserve the oldest number first"
        >
          <Table>
            <TableThead>
              <TableTr>
                <TableTh>Part number</TableTh>
                <TableTh />
                <TableTh ta="right">On hand</TableTh>
                <TableTh ta="right">Free</TableTh>
              </TableTr>
            </TableThead>
            <TableTbody>
              {item.family.members.map((m) => (
                <TableTr key={m.id}>
                  <TableTd>
                    {m.id === item.id ? (
                      <b>
                        <Mono>{m.partNo}</Mono>
                      </b>
                    ) : (
                      <Link
                        href={`/inventory/items/${m.id}`}
                        className="dax-link"
                      >
                        <Mono>{m.partNo}</Mono>
                      </Link>
                    )}
                  </TableTd>
                  <TableTd>
                    {m.current ? (
                      <Pill tone="ok">Current</Pill>
                    ) : (
                      <Pill>Superseded</Pill>
                    )}
                  </TableTd>
                  <TableTd className="dax-num">{formatQty(m.onHand)}</TableTd>
                  <TableTd className="dax-num">{formatQty(m.free)}</TableTd>
                </TableTr>
              ))}
              <TableTr>
                <TableTd>
                  <b>Family total</b>
                </TableTd>
                <TableTd />
                <TableTd className="dax-num">
                  <b>{formatQty(item.family.stock.onHand)}</b>
                </TableTd>
                <TableTd className="dax-num">
                  <b>{formatQty(item.family.stock.free)}</b>
                </TableTd>
              </TableTr>
            </TableTbody>
          </Table>
        </SectionCard>
      ) : null}

      {serials ? (
        <SectionCard
          flush
          id="serials"
          title="Serial numbers"
          note={`${serials.total} active · newest first`}
        >
          <SerialsCard
            itemId={item.id}
            uom={item.uom}
            page={serials}
            canPrint={canPrintSerials}
          />
        </SectionCard>
      ) : null}

      {age ? (
        <SectionCard
          flush
          title="Stock age"
          note="Oldest first. Units that left took the oldest stock"
        >
          <StockAgeCard age={age} uom={item.uom} />
        </SectionCard>
      ) : null}

      {movements ? (
        <SectionCard
          flush
          title="Movements"
          note="Every change to this part's stock, newest first"
        >
          <Movements itemId={item.id} uom={item.uom} initial={movements} />
        </SectionCard>
      ) : null}

      <SectionCard title="Details">
        {canEdit && catalog ? (
          <ItemForm key={item.version} catalog={catalog} item={item} />
        ) : (
          <Facts
            items={[
              { label: 'Brand', value: item.brand.name },
              {
                label: 'Unit',
                value: `${uomLabel(item.uom)} (${item.uom})`,
              },
              { label: 'Minimum stock', value: formatQty(item.minQty) },
              {
                label: 'Usual bin',
                value: item.defaultBin ? (
                  <Link
                    href={`/inventory/locations/bins/${item.defaultBin.id}`}
                    className="dax-link"
                  >
                    <Mono>{item.defaultBin.code}</Mono>
                  </Link>
                ) : (
                  '—'
                ),
              },
              {
                label: 'Fits machine models',
                value: item.machineModels.map((m) => m.name).join(', ') || '—',
              },
              { label: 'Machine types', value: names(item.machineTypes) },
              { label: 'Main supplier', value: item.supplier?.name ?? '—' },
              {
                label: 'Pre-costing price',
                value: formatMoney(item.preCostPrice),
              },
              { label: 'Selling price', value: formatMoney(item.sellingPrice) },
              {
                label: 'Tags',
                value: item.tags.length ? <TagChips tags={item.tags} /> : '—',
              },
              {
                label: 'Notes',
                value: (
                  <span style={{ whiteSpace: 'pre-wrap' }}>
                    {item.notes ?? '—'}
                  </span>
                ),
              },
            ]}
          />
        )}
      </SectionCard>

      <div className="dax-grid2">
        <SectionCard
          title="Barcodes"
          note="A scan of any of these finds the item"
        >
          <Barcodes item={item} canEdit={canEdit} />
        </SectionCard>
        <SectionCard title="Supersession">
          <Replacement item={item} canEdit={canEdit} />
        </SectionCard>
      </div>

      {item.customerParts.length ? (
        <SectionCard
          flush
          title="Customer part numbers"
          note="Generated the first time the part goes on a customer's AOD"
        >
          <Table>
            <TableThead>
              <TableTr>
                <TableTh>Customer</TableTh>
                <TableTh>Customer part no.</TableTh>
                <TableTh>AODs</TableTh>
              </TableTr>
            </TableThead>
            <TableTbody>
              {item.customerParts.map((c) => (
                <TableTr key={c.partNo}>
                  <TableTd>{c.customerName}</TableTd>
                  <TableTd>
                    <Mono>{c.partNo}</Mono>
                  </TableTd>
                  <TableTd>
                    {canDo(caps, 'inventory.aod.view') ? (
                      <Link
                        className="dax-link"
                        href={`/inventory/issuing/aods?status=ALL&q=${encodeURIComponent(c.partNo)}`}
                      >
                        AODs with this part
                      </Link>
                    ) : (
                      '—'
                    )}
                  </TableTd>
                </TableTr>
              ))}
            </TableTbody>
          </Table>
        </SectionCard>
      ) : null}
    </>
  );
}
