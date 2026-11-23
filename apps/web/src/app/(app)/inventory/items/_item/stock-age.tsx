import {
  Table,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
} from '@mantine/core';
import Link from 'next/link';
import {
  type ItemAge,
  type ItemAgeLayer,
  type ItemAgeUse,
  stockAgeBand,
  stockAgeBandLabels,
} from '@dax/inventory-contract';
import { CardBody, Empty, Mono, Pill } from '@dax/web-shell';
import { formatDateTime, formatQty } from '../../../../../lib/format';
import { qtyNumber } from '../../receiving/_lib/lines';

const DOC_PATHS: Record<string, string> = {
  GRN: '/inventory/receiving/grns/',
  AOD: '/inventory/issuing/aods/',
  RTN: '/inventory/returns/',
  CNT: '/inventory/counts/',
};

const ARRIVED: Record<ItemAgeLayer['source'], string> = {
  GRN: 'Received',
  OPENING: 'Opening stock',
  RETURN: 'Returned',
  COUNT: 'Found in a count',
  OTHER: 'Added',
};

function wentOut(use: ItemAgeUse): string {
  switch (use.movement) {
    case 'ISSUE':
      return 'Issued';
    case 'COUNT_ADJUST':
      return 'Count loss';
    case 'REVERSAL':
      return 'GRN reversed';
    default:
      return 'Moved off the shelf';
  }
}

function Doc({ doc }: { doc: ItemAgeLayer['doc'] }) {
  const base = DOC_PATHS[doc.type];
  const text = <Mono>{doc.number ?? doc.type}</Mono>;
  return base ? (
    <Link href={`${base}${doc.id}`} className="dax-link">
      {text}
    </Link>
  ) : (
    text
  );
}

/** Each lot on the shelf with its age, and how long the units that left had been in the store. */
export function StockAgeCard({ age, uom }: { age: ItemAge; uom: string }) {
  const labels = stockAgeBandLabels(age.limits);
  const last = labels.length - 1;
  return (
    <>
      {age.shelf.length === 0 ? (
        <CardBody>
          <Empty title="Nothing on the shelf" />
        </CardBody>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <Table>
            <TableThead>
              <TableTr>
                <TableTh>On the shelf</TableTh>
                <TableTh>Arrived</TableTh>
                <TableTh ta="right">Quantity</TableTh>
                <TableTh ta="right">Days in store</TableTh>
                <TableTh>Band</TableTh>
              </TableTr>
            </TableThead>
            <TableTbody>
              {age.shelf.map((l) => {
                const band = stockAgeBand(l.days, age.limits);
                return (
                  <TableTr key={l.id}>
                    <TableTd>
                      {ARRIVED[l.source]} · <Doc doc={l.doc} />
                    </TableTd>
                    <TableTd>{formatDateTime(l.agedFrom)}</TableTd>
                    <TableTd className="dax-num">
                      {formatQty(l.qtyLeft)}{' '}
                      <span className="dax-muted">{uom}</span>
                    </TableTd>
                    <TableTd className="dax-num">
                      <b>
                        {l.atLeast ? 'at least ' : ''}
                        {l.days.toLocaleString('en-LK')}
                      </b>
                    </TableTd>
                    <TableTd>
                      <Pill tone={band === last ? 'hi' : undefined}>
                        {labels[band]} d
                      </Pill>
                    </TableTd>
                  </TableTr>
                );
              })}
            </TableTbody>
          </Table>
        </div>
      )}
      {age.out.items.length ? (
        <div style={{ overflowX: 'auto' }}>
          <Table>
            <TableThead>
              <TableTr>
                <TableTh>Gone out</TableTh>
                <TableTh>Date</TableTh>
                <TableTh ta="right">Quantity</TableTh>
                <TableTh ta="right">Days in store</TableTh>
                <TableTh />
              </TableTr>
            </TableThead>
            <TableTbody>
              {age.out.items.map((u) => (
                <TableTr key={u.id}>
                  <TableTd>
                    {wentOut(u)} · <Doc doc={u.doc} />
                  </TableTd>
                  <TableTd>{formatDateTime(u.usedAt)}</TableTd>
                  <TableTd className="dax-num">
                    {formatQty(u.qty)} <span className="dax-muted">{uom}</span>
                  </TableTd>
                  <TableTd className="dax-num">
                    <b>{u.daysInStore.toLocaleString('en-LK')}</b>
                  </TableTd>
                  <TableTd>
                    {qtyNumber(u.returnedQty) > 0 ? (
                      <Pill tone="ok">
                        {formatQty(u.returnedQty)} came back
                      </Pill>
                    ) : null}
                  </TableTd>
                </TableTr>
              ))}
            </TableTbody>
          </Table>
          {age.out.total > age.out.items.length ? (
            <CardBody>
              <span className="dax-muted">
                The latest {age.out.items.length} of {age.out.total}. Older ones
                are in Movements.
              </span>
            </CardBody>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
