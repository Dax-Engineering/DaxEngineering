'use client';

import {
  Checkbox,
  Group,
  Table,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  Text,
} from '@mantine/core';
import Link from 'next/link';
import { useState } from 'react';
import type { SerialPage } from '@dax/inventory-contract';
import { CardBody, Empty, Mono, Pill } from '@dax/web-shell';
import { SerialLabelsButton } from '../../../../../components/serial-labels';
import { formatDateTime, formatQty } from '../../../../../lib/format';

/** The part's serials, newest first, with label printing. */
export function SerialsCard({
  itemId,
  uom,
  page,
  canPrint,
}: {
  itemId: string;
  uom: string;
  page: SerialPage;
  canPrint: boolean;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const toggle = (id: string, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  if (page.total === 0) {
    return (
      <CardBody>
        <Empty title="No serial numbers yet">
          Units get serial numbers when a GRN for this part is posted.
        </Empty>
      </CardBody>
    );
  }

  return (
    <>
      {canPrint ? (
        <CardBody>
          <Group gap="sm">
            {page.unprinted ? (
              <SerialLabelsButton
                scope={{ itemId }}
                label={`Print ${page.unprinted} unprinted labels`}
                unprintedOnly
              />
            ) : null}
            <SerialLabelsButton
              scope={{ serialIds: [...picked] }}
              label={`Print ${picked.size} selected`}
              count={picked.size}
              offerUnprinted={false}
              disabled={picked.size === 0}
            />
          </Group>
        </CardBody>
      ) : null}
      <div style={{ overflowX: 'auto' }}>
        <Table>
          <TableThead>
            <TableTr>
              {canPrint ? <TableTh w={40} /> : null}
              <TableTh>Serial</TableTh>
              <TableTh>Received</TableTh>
              <TableTh>From</TableTh>
              <TableTh>Bin</TableTh>
              <TableTh ta="right">Quantity</TableTh>
              <TableTh>Label</TableTh>
            </TableTr>
          </TableThead>
          <TableTbody>
            {page.items.map((s) => (
              <TableTr key={s.id}>
                {canPrint ? (
                  <TableTd>
                    <Checkbox
                      aria-label={`Select ${s.serial}`}
                      checked={picked.has(s.id)}
                      onChange={(e) => toggle(s.id, e.currentTarget.checked)}
                    />
                  </TableTd>
                ) : null}
                <TableTd>
                  <Link
                    href={`/inventory/serials/${s.serial}`}
                    className="dax-link"
                  >
                    <Mono>{s.serial}</Mono>
                  </Link>
                  {s.condition === 'DAMAGED' ? (
                    <>
                      {' '}
                      <Pill tone="bad">Damaged</Pill>
                    </>
                  ) : null}
                </TableTd>
                <TableTd>{formatDateTime(s.receivedAt)}</TableTd>
                <TableTd>
                  {s.doc.number ? (
                    <Mono>{s.doc.number}</Mono>
                  ) : (
                    'Existing stock'
                  )}
                  {s.unitsOnLine > 1 ? (
                    <span className="dax-muted">
                      {' '}
                      · {s.unitNo} of {s.unitsOnLine}
                    </span>
                  ) : null}
                </TableTd>
                <TableTd>{s.bin ? <Mono>{s.bin.code}</Mono> : '—'}</TableTd>
                <TableTd className="dax-num">
                  {formatQty(s.qty)} <span className="dax-muted">{uom}</span>
                </TableTd>
                <TableTd>
                  {s.printCount ? (
                    <Pill tone="ok">Printed</Pill>
                  ) : (
                    <Pill tone="yel">Not printed</Pill>
                  )}
                </TableTd>
              </TableTr>
            ))}
          </TableTbody>
        </Table>
      </div>
      {page.total > page.items.length ? (
        <CardBody>
          <Text size="sm" c="dimmed">
            The latest {page.items.length} of {page.total}. Search a serial in
            Items to find an older one.
          </Text>
        </CardBody>
      ) : null}
    </>
  );
}
