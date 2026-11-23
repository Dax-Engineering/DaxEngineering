import {
  Box,
  Table,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
} from '@mantine/core';
import {
  StockAgeQuery,
  type StockAgeRow,
  stockAgeBandLabels,
} from '@dax/inventory-contract';
import { canDo, CardBody, Empty, PageHead, SectionCard } from '@dax/web-shell';
import { ListFilters } from '../../../../../components/list-filters';
import { LinkButton } from '../../../../../components/links';
import { formatQty } from '../../../../../lib/format';
import {
  flatten,
  readQuery,
  type SearchParams,
} from '../../../../../lib/query';
import { requirePermission } from '../../../../../lib/server';
import { qtyNumber } from '../../receiving/_lib/lines';
import { ExportButton } from '../_lib/buttons';
import { PartNo, TruncatedNote } from '../_lib/cells';
import { getStockAge } from '../_lib/data';
import { BASE, exportHref } from '../_lib/reports';

function days(row: StockAgeRow, value: number): string {
  return `${row.atLeast ? 'at least ' : ''}${value.toLocaleString('en-LK')} d`;
}

function BandQty({ qty, oldest }: { qty: string; oldest: boolean }) {
  if (qtyNumber(qty) === 0) return <span className="dax-muted">—</span>;
  return oldest ? (
    <b className="dax-age-old">{formatQty(qty)}</b>
  ) : (
    <>{formatQty(qty)}</>
  );
}

export default async function StockAgePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const caps = await requirePermission('inventory.stock.view');
  const query = flatten(await searchParams);
  const filters = readQuery(StockAgeQuery, query);
  const report = await getStockAge(query);
  const labels = stockAgeBandLabels(report.limits);
  const last = labels.length - 1;
  const linked = canDo(caps, 'inventory.item.view');
  const canExport = canDo(caps, 'inventory.stock.export');
  const canSetBands = canDo(caps, 'inventory.stock_age.settings');
  // Parts, not quantities: units differ from part to part.
  const parts = labels.map(
    (_, i) =>
      report.items.filter((r) => qtyNumber(r.bands[i] ?? '0') > 0).length,
  );

  return (
    <>
      <PageHead
        eyebrow="Reports"
        title="Stock age"
        back={{ href: BASE, label: 'Reports' }}
        lede="How long the stock on the shelf has been in the store, oldest first. The oldest units count as issued first. Returned parts keep the age they left with. Opening stock counts from the opening count, so its real age may be higher."
        actions={
          <>
            {canSetBands ? (
              <LinkButton variant="default" href={`${BASE}/stock-age/settings`}>
                Change bands
              </LinkButton>
            ) : null}
            {canExport && report.items.length ? (
              <ExportButton
                href={exportHref('stock-age', {
                  q: filters.q,
                  band: filters.band?.toString(),
                })}
              />
            ) : null}
          </>
        }
      />
      <TruncatedNote truncated={report.truncated} canExport={canExport} />
      <div
        className="dax-age-bands"
        aria-label="Parts holding stock in each age band"
      >
        {labels.map((label, i) => (
          <div key={label} className={i === last ? 'b old' : 'b'}>
            <span className="l">{label} days</span>
            <b>
              {parts[i] ?? 0} {parts[i] === 1 ? 'part' : 'parts'}
            </b>
          </div>
        ))}
      </div>
      <SectionCard
        flush
        title="Shelf stock by age"
        note={`${report.items.length}${report.truncated ? '+' : ''} ${report.items.length === 1 ? 'part' : 'parts'}`}
        toolbar={
          <ListFilters
            searchPlaceholder="Part number or description"
            selects={[
              {
                name: 'band',
                label: 'Holding stock aged',
                placeholder: 'Any age',
                data: labels.map((label, i) => ({
                  value: String(i),
                  label:
                    i === last ? `${label} days` : `${label} days or older`,
                })),
              },
            ]}
          />
        }
      >
        {report.items.length === 0 ? (
          <CardBody>
            <Empty title="No shelf stock here">
              Nothing on the shelf matches these filters.
            </Empty>
          </CardBody>
        ) : (
          <>
            <Box visibleFrom="md" style={{ overflowX: 'auto' }}>
              <Table>
                <TableThead>
                  <TableTr>
                    <TableTh>Part number</TableTh>
                    <TableTh ta="right">On shelf</TableTh>
                    {labels.map((label) => (
                      <TableTh key={label} ta="right">
                        {label} d
                      </TableTh>
                    ))}
                    <TableTh ta="right">Oldest</TableTh>
                    <TableTh ta="right">Average</TableTh>
                  </TableTr>
                </TableThead>
                <TableTbody>
                  {report.items.map((row) => (
                    <TableTr key={row.item.id}>
                      <TableTd>
                        <PartNo item={row.item} linked={linked} />
                        <div className="dax-sub">{row.item.description}</div>
                      </TableTd>
                      <TableTd className="dax-num">
                        {formatQty(row.onShelf)}{' '}
                        <span className="dax-muted">{row.item.uom}</span>
                      </TableTd>
                      {row.bands.map((qty, i) => (
                        <TableTd key={labels[i]} className="dax-num">
                          <BandQty qty={qty} oldest={i === last} />
                        </TableTd>
                      ))}
                      <TableTd className="dax-num">
                        <b>{days(row, row.oldestDays)}</b>
                      </TableTd>
                      <TableTd className="dax-num">
                        {days(row, row.averageDays)}
                      </TableTd>
                    </TableTr>
                  ))}
                </TableTbody>
              </Table>
            </Box>
            <Box hiddenFrom="md" className="dax-rows">
              {report.items.map((row) => (
                <div key={row.item.id} className="dax-row">
                  <div className="dax-row-main">
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 8,
                      }}
                    >
                      <span style={{ fontSize: 17 }}>
                        <PartNo item={row.item} linked={linked} />
                      </span>
                      <b>Oldest {days(row, row.oldestDays)}</b>
                    </div>
                    <span>{row.item.description}</span>
                    <span className="dax-sub">
                      {formatQty(row.onShelf)} {row.item.uom} on the shelf ·
                      average {days(row, row.averageDays)}
                    </span>
                    <span className="dax-sub">
                      {row.bands
                        .map((qty, i) =>
                          qtyNumber(qty) > 0
                            ? `${formatQty(qty)} at ${labels[i]} d`
                            : null,
                        )
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </div>
                </div>
              ))}
            </Box>
          </>
        )}
      </SectionCard>
    </>
  );
}
