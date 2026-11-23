import {
  Box,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
} from '@mantine/core';
import Link from 'next/link';
import type { ItemSummary } from '@dax/inventory-contract';
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
  TagChips,
} from '../../../../components/item-extras';
import { ListFilters } from '../../../../components/list-filters';
import { BelowMinBadge, StockLine } from '../../../../components/stock';
import { formatCount, formatMoney, formatQty } from '../../../../lib/format';
import { flatten, type SearchParams } from '../../../../lib/query';
import { requirePermission } from '../../../../lib/server';
import { getCatalog, itemFilterSelects, listItems } from '../_lib/data';

function ItemBadges({ item }: { item: ItemSummary }) {
  return (
    <div className="dax-chips" style={{ gap: 4 }}>
      {item.supersededBy ? <Pill tone="yel">Superseded</Pill> : null}
      {item.status === 'ARCHIVED' ? <Pill>Archived</Pill> : null}
      <BelowMinBadge belowMin={item.belowMin} />
    </div>
  );
}

export default async function ItemsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const caps = await requirePermission('inventory.item.view');
  const query = flatten(await searchParams);
  const [catalog, page, extraSelects] = await Promise.all([
    getCatalog(),
    listItems(query),
    itemFilterSelects(),
  ]);
  const canPrint = canDo(caps, 'inventory.item.print_label');
  const ids = page.items.map((i) => i.id);
  const filtered = Boolean(
    query['q'] ||
    query['brandId'] ||
    query['machineModelId'] ||
    query['supplierId'] ||
    query['machineTypeId'] ||
    query['tag'] ||
    query['belowMin'],
  );

  return (
    <LabelSelection kind="item" enabled={canPrint}>
      <PageHead
        eyebrow="Inventory"
        title="Items"
        lede="Every part the store keeps, with its brand, stock and barcodes."
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
                <SelectionHint>Tick items to print their labels.</SelectionHint>
              </>
            ) : null}
          </>
        }
        toolbar={
          <ListFilters
            searchPlaceholder="Part number, description or barcode"
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
            toggles={[{ name: 'belowMin', label: 'Below minimum' }]}
          />
        }
      >
        {page.items.length === 0 ? (
          <CardBody>
            <Empty title="No items found">
              {filtered
                ? 'Try a different search or filter.'
                : 'Add an item or import a CSV file.'}
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
                    <TableTh ta="right">On hand</TableTh>
                    <TableTh ta="right">Held</TableTh>
                    <TableTh ta="right">Free</TableTh>
                    <TableTh ta="right">Selling</TableTh>
                    <TableTh />
                  </TableTr>
                </TableThead>
                {page.items.map((item) => (
                  <TableTbody key={item.id}>
                    <TableTr>
                      {canPrint ? (
                        <TableTd>
                          <SelectCheckbox id={item.id} label={item.partNo} />
                        </TableTd>
                      ) : null}
                      <TableTd>
                        <Link
                          href={`/inventory/items/${item.id}`}
                          className="dax-link"
                        >
                          <Mono>{item.partNo}</Mono>
                        </Link>
                        <FamilyToggle family={inStock(item.family)} />
                      </TableTd>
                      <TableTd>{item.brand.name}</TableTd>
                      <TableTd>
                        {item.description}
                        <TagChips tags={item.tags} />
                      </TableTd>
                      <TableTd>{item.supplier?.name ?? '—'}</TableTd>
                      <TableTd className="dax-num">
                        {formatQty(item.stock.onHand)}
                        <FamilyBar family={inStock(item.family)} />
                      </TableTd>
                      <TableTd className="dax-num">
                        {formatQty(item.stock.held)}
                      </TableTd>
                      <TableTd className="dax-num">
                        <b>{formatQty(item.stock.free)}</b>{' '}
                        <span className="dax-muted">{item.uom}</span>
                      </TableTd>
                      <TableTd className="dax-num">
                        {formatMoney(item.sellingPrice)}
                      </TableTd>
                      <TableTd>
                        <ItemBadges item={item} />
                      </TableTd>
                    </TableTr>
                    {inStock(item.family).members.length > 1
                      ? inStock(item.family).members.map((m) => (
                          <TableTr key={m.id} className="dax-fam-sub">
                            {canPrint ? <TableTd /> : null}
                            <TableTd colSpan={4}>
                              <FamilyMemberPart member={m} />
                            </TableTd>
                            <TableTd className="dax-num">
                              {formatQty(m.onHand)}
                              <FamilyShare
                                member={m}
                                family={inStock(item.family)}
                              />
                            </TableTd>
                            <TableTd className="dax-num">
                              {formatQty(m.held)}
                            </TableTd>
                            <TableTd className="dax-num">
                              {formatQty(m.free)}
                            </TableTd>
                            <TableTd colSpan={2}>
                              {m.id === item.id ? null : (
                                <Link
                                  href={`/inventory/items/${m.id}`}
                                  className="dax-link"
                                >
                                  Open
                                </Link>
                              )}
                            </TableTd>
                          </TableTr>
                        ))
                      : null}
                  </TableTbody>
                ))}
              </ScrollTable>
            </Box>
            <Box hiddenFrom="md" className="dax-rows">
              {page.items.map((item) => (
                <div key={item.id} className="dax-row">
                  <SelectCheckbox id={item.id} label={item.partNo} />
                  <div className="dax-row-main">
                    <Link
                      href={`/inventory/items/${item.id}`}
                      className="dax-link"
                      style={{ fontSize: 17 }}
                    >
                      <Mono>{item.partNo}</Mono>
                    </Link>
                    <span>{item.description}</span>
                    <span className="dax-sub">
                      {[item.brand.name, item.supplier?.name]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    <StockLine stock={item.stock} />
                    <FamilyBar family={inStock(item.family)} />
                    <FamilyList family={inStock(item.family)} />
                    {item.sellingPrice ? (
                      <span className="dax-sub">
                        Selling <b>{formatMoney(item.sellingPrice)}</b>
                      </span>
                    ) : null}
                    <TagChips tags={item.tags} />
                    <ItemBadges item={item} />
                  </div>
                </div>
              ))}
            </Box>
          </>
        )}
        <Pager
          path={'/inventory/items'}
          query={query}
          total={page.total}
          page={page.page}
          limit={page.limit}
        />
      </SectionCard>
    </LabelSelection>
  );
}
