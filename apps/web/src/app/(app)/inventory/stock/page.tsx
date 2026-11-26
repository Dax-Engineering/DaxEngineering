import {
  Box,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
} from '@mantine/core';
import Link from 'next/link';
import type { StockRow } from '@dax/inventory-contract';
import {
  canDo,
  CardBody,
  Empty,
  Mono,
  PageHead,
  Pager,
  Pill,
  SectionCard,
  ScrollTable,
} from '@dax/web-shell';
import {
  LabelSelection,
  SelectAllCheckbox,
  SelectCheckbox,
  SelectionHint,
} from '../../../../components/labels';
import { LinkButton } from '../../../../components/links';
import {
  FamilyBar,
  FamilyList,
  FamilyMemberPart,
  FamilyShare,
  FamilyToggle,
  inStock,
  names,
  TagChips,
} from '../../../../components/item-extras';
import { ListFilters } from '../../../../components/list-filters';
import { BelowMinBadge, StockLine } from '../../../../components/stock';
import { formatCount, formatMoney, formatQty } from '../../../../lib/format';
import { flatten, type SearchParams } from '../../../../lib/query';
import { requirePermission } from '../../../../lib/server';
import {
  getCatalog,
  getZones,
  itemFilterSelects,
  listStock,
} from '../_lib/data';

function Bins({ row }: { row: StockRow }) {
  if (row.bins.length === 0) return <span className="dax-muted">—</span>;
  return (
    <div className="dax-chips" style={{ gap: 4 }}>
      {row.bins.map((b) => (
        <span key={`${b.code}-${b.partNo ?? ''}`} className="dax-pill">
          <Mono>{b.code}</Mono> {formatQty(b.qty)}
          {b.partNo ? (
            <>
              {' '}
              of <Mono>{b.partNo}</Mono>
            </>
          ) : null}
        </span>
      ))}
    </div>
  );
}

/** The bins holding one number of the family. */
function MemberBins({ row, partNo }: { row: StockRow; partNo: string }) {
  const bins = row.bins.filter((b) => (b.partNo ?? row.item.partNo) === partNo);
  if (bins.length === 0) return <span className="dax-muted">—</span>;
  return (
    <div className="dax-chips" style={{ gap: 4 }}>
      {bins.map((b) => (
        <span key={b.code} className="dax-pill">
          <Mono>{b.code}</Mono> {formatQty(b.qty)}
        </span>
      ))}
    </div>
  );
}

export default async function StockPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const caps = await requirePermission('inventory.stock.view');
  const query = flatten(await searchParams);
  const [zones, catalog, page, extraSelects] = await Promise.all([
    getZones(),
    getCatalog(),
    listStock(query),
    itemFilterSelects(),
  ]);
  const canSeeItems = canDo(caps, 'inventory.item.view');
  const canPrint = canDo(caps, 'inventory.item.print_label');
  const ids = page.items.map((r) => r.item.id);
  const part = (row: StockRow) => (
    <>
      {canSeeItems ? (
        <Link href={`/inventory/items/${row.item.id}`} className="dax-link">
          <Mono>{row.item.partNo}</Mono>
        </Link>
      ) : (
        <b>
          <Mono>{row.item.partNo}</Mono>
        </b>
      )}
      <FamilyToggle family={inStock(row.family)} />
      {row.item.status === 'ARCHIVED' ? (
        <>
          {' '}
          <Pill>Archived</Pill>
        </>
      ) : null}
    </>
  );
  const filtered = Boolean(
    query['q'] ||
    query['inStock'] ||
    query['belowMin'] ||
    query['zoneId'] ||
    query['brandId'] ||
    query['machineModelId'] ||
    (query['status'] && query['status'] !== 'ACTIVE') ||
    query['supplierId'] ||
    query['machineTypeId'] ||
    query['tag'],
  );

  return (
    <LabelSelection kind="item" enabled={canPrint}>
      <PageHead
        eyebrow="Inventory"
        title="Stock"
        lede="Every part the store keeps and where it is. Free is what can be issued now; stock in receiving becomes free after put-away, quarantine never does."
        actions={
          <>
            {canDo(caps, 'inventory.item.import') ? (
              <LinkButton href="/inventory/items/import" variant="default">
                Import CSV
              </LinkButton>
            ) : null}
            {canDo(caps, 'inventory.item.create') ? (
              <LinkButton href="/inventory/items/new">New item</LinkButton>
            ) : null}
          </>
        }
      />
      <SectionCard
        flush
        title="Parts"
        note={
          <>
            {formatCount(page.total)} total
            {canPrint && page.items.length ? (
              <>
                {' · '}
                <SelectionHint>Tick parts to print their labels.</SelectionHint>
              </>
            ) : null}
          </>
        }
        toolbar={
          <ListFilters
            searchPlaceholder="Part number, description, barcode or serial"
            selects={[
              {
                name: 'brandId',
                label: 'Brand',
                data: catalog.brands.map((b) => ({
                  value: b.id,
                  label: b.name,
                })),
              },
              {
                name: 'machineModelId',
                label: 'Machine model',
                data: catalog.machineModels.map((m) => ({
                  value: m.id,
                  label: m.brand ? `${m.name} (${m.brand.name})` : m.name,
                })),
              },
              {
                name: 'zoneId',
                label: 'Zone',
                data: zones.map((z) => ({
                  value: z.id,
                  label: `${z.code} · ${z.name}`,
                })),
              },
              ...extraSelects,
              {
                name: 'status',
                label: 'Show',
                defaultValue: 'ACTIVE',
                chips: true,
                data: [
                  { value: 'ACTIVE', label: 'Active' },
                  { value: 'ARCHIVED', label: 'Archived' },
                  { value: 'ALL', label: 'All' },
                ],
              },
            ]}
            toggles={[
              { name: 'inStock', label: 'In stock' },
              { name: 'belowMin', label: 'Below minimum' },
            ]}
          />
        }
      >
        {page.items.length === 0 ? (
          <CardBody>
            <Empty title="Nothing to show">
              {filtered
                ? 'Try a different search or filter.'
                : 'Add an item or import a CSV file to get started.'}
            </Empty>
          </CardBody>
        ) : (
          <>
            <Box visibleFrom="md">
              <ScrollTable>
                <TableThead>
                  <TableTr>
                    {canPrint ? (
                      <TableTh w={40}>
                        <SelectAllCheckbox ids={ids} />
                      </TableTh>
                    ) : null}
                    <TableTh>Part number</TableTh>
                    <TableTh>Brand</TableTh>
                    <TableTh>Description</TableTh>
                    <TableTh>Supplier</TableTh>
                    <TableTh>Machine type</TableTh>
                    <TableTh ta="right">On hand</TableTh>
                    <TableTh ta="right">Held</TableTh>
                    <TableTh ta="right">Free</TableTh>
                    <TableTh ta="right">In receiving</TableTh>
                    <TableTh ta="right">Minimum</TableTh>
                    <TableTh ta="right">Pre-cost</TableTh>
                    <TableTh ta="right">Selling</TableTh>
                    <TableTh>Bins</TableTh>
                  </TableTr>
                </TableThead>
                {page.items.map((row) => (
                  <TableTbody key={row.item.id}>
                    <TableTr>
                      {canPrint ? (
                        <TableTd>
                          <SelectCheckbox
                            id={row.item.id}
                            label={row.item.partNo}
                          />
                        </TableTd>
                      ) : null}
                      <TableTd>{part(row)}</TableTd>
                      <TableTd>{row.item.brand}</TableTd>
                      <TableTd>
                        {row.item.description}
                        <TagChips tags={row.tags} />
                      </TableTd>
                      <TableTd>{row.supplier?.name ?? '—'}</TableTd>
                      <TableTd>{names(row.machineTypes)}</TableTd>
                      <TableTd className="dax-num">
                        {formatQty(row.stock.onHand)}
                        <FamilyBar family={inStock(row.family)} />
                      </TableTd>
                      <TableTd className="dax-num">
                        {formatQty(row.stock.held)}
                      </TableTd>
                      <TableTd className="dax-num">
                        <b>{formatQty(row.stock.free)}</b>{' '}
                        <span className="dax-muted">{row.item.uom}</span>
                      </TableTd>
                      <TableTd className="dax-num">
                        {formatQty(row.stock.receiving)}
                      </TableTd>
                      <TableTd className="dax-num">
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'flex-end',
                            gap: 4,
                          }}
                        >
                          {formatQty(row.minQty)}
                          <BelowMinBadge belowMin={row.belowMin} />
                        </div>
                      </TableTd>
                      <TableTd className="dax-num">
                        {formatMoney(row.preCostPrice)}
                      </TableTd>
                      <TableTd className="dax-num">
                        <b>{formatMoney(row.sellingPrice)}</b>
                      </TableTd>
                      <TableTd>
                        <Bins row={row} />
                      </TableTd>
                    </TableTr>
                    {inStock(row.family).members.length > 1
                      ? inStock(row.family).members.map((m) => (
                          <TableTr key={m.id} className="dax-fam-sub">
                            {canPrint ? <TableTd /> : null}
                            <TableTd colSpan={5}>
                              <FamilyMemberPart member={m} />
                            </TableTd>
                            <TableTd className="dax-num">
                              {formatQty(m.onHand)}
                              <FamilyShare
                                member={m}
                                family={inStock(row.family)}
                              />
                            </TableTd>
                            <TableTd className="dax-num">
                              {formatQty(m.held)}
                            </TableTd>
                            <TableTd className="dax-num">
                              {formatQty(m.free)}
                            </TableTd>
                            <TableTd className="dax-num">
                              {formatQty(m.receiving)}
                            </TableTd>
                            <TableTd colSpan={3} />
                            <TableTd>
                              <MemberBins row={row} partNo={m.partNo} />
                            </TableTd>
                          </TableTr>
                        ))
                      : null}
                  </TableTbody>
                ))}
              </ScrollTable>
            </Box>
            <Box hiddenFrom="md" className="dax-rows">
              {page.items.map((row) => (
                <div key={row.item.id} className="dax-row">
                  <SelectCheckbox id={row.item.id} label={row.item.partNo} />
                  <div className="dax-row-main">
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 8,
                      }}
                    >
                      <span style={{ fontSize: 17 }}>{part(row)}</span>
                      <span className="dax-sub">{row.item.brand}</span>
                    </div>
                    <span>{row.item.description}</span>
                    {row.supplier || row.machineTypes.length ? (
                      <span className="dax-sub">
                        {[
                          row.supplier?.name,
                          ...row.machineTypes.map((t) => t.name),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    ) : null}
                    <StockLine stock={row.stock} />
                    <FamilyBar family={inStock(row.family)} />
                    <FamilyList family={inStock(row.family)} />
                    {row.preCostPrice || row.sellingPrice ? (
                      <span className="dax-sub">
                        Pre-cost {formatMoney(row.preCostPrice)} · Selling{' '}
                        <b>{formatMoney(row.sellingPrice)}</b>
                      </span>
                    ) : null}
                    <TagChips tags={row.tags} />
                    <span className="dax-sub">
                      Minimum {formatQty(row.minQty)} {row.item.uom}
                    </span>
                    <div className="dax-chips" style={{ gap: 4 }}>
                      <BelowMinBadge belowMin={row.belowMin} />
                    </div>
                    <Bins row={row} />
                  </div>
                </div>
              ))}
            </Box>
          </>
        )}
        <Pager
          path={'/inventory/stock'}
          query={query}
          total={page.total}
          page={page.page}
          limit={page.limit}
        />
      </SectionCard>
    </LabelSelection>
  );
}
