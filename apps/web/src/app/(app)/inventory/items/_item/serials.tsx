'use client';

import {
  Box,
  Checkbox,
  Group,
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
import { CardBody, Empty, Mono, Pill, ScrollTable } from '@dax/web-shell';
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
      {canPrint && (page.unprinted || picked.size) ? (
        <CardBody>
          <Group gap="sm">
            {page.unprinted ? (
              <SerialLabelsButton
                scope={{ itemId }}
                label={`Print ${page.unprinted} unprinted labels`}
                unprintedOnly
              />
            ) : null}
            {picked.size ? (
              <SerialLabelsButton
                scope={{ serialIds: [...picked] }}
                label={`Print ${picked.size} selected`}
                count={picked.size}
                offerUnprinted={false}
              />
            ) : null}
          </Group>
        </CardBody>
      ) : null}
      <Box hiddenFrom="md" className="dax-rows">
        {page.items.map((s) => (
          <div key={s.id} className="dax-row">
            {canPrint ? (
              <Checkbox
                size="md"
                aria-label={`Select ${s.serial}`}
                checked={picked.has(s.id)}
                onChange={(e) => toggle(s.id, e.currentTarget.checked)}
                style={{ alignSelf: 'center' }}
              />
            ) : null}
            <div className="dax-row-main">
              <Link
                href={`/inventory/serials/${s.serial}`}
                className="dax-link"
              >
                <b>
                  <Mono>{s.serial}</Mono>
                </b>
              </Link>
              <span className="dax-sub">
                {s.doc.number ? <Mono>{s.doc.number}</Mono> : 'Existing stock'}
                {s.unitsOnLine > 1 ? ` · ${s.unitNo} of ${s.unitsOnLine}` : ''}
                {s.bin ? (
                  <>
                    {' · '}
                    <Mono>{s.bin.code}</Mono>
                  </>
                ) : null}
              </span>
              <span className="dax-sub">{formatDateTime(s.receivedAt)}</span>
              <div className="dax-chips">
                {s.printCount ? (
                  <Pill tone="ok">Printed</Pill>
                ) : (
                  <Pill tone="yel">Not printed</Pill>
                )}
                {s.condition === 'DAMAGED' ? (
                  <Pill tone="bad">Damaged</Pill>
                ) : null}
                {Number(s.qty) !== 1 ? (
                  <Pill>
                    {formatQty(s.qty)} {uom}
                  </Pill>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </Box>
      <Box visibleFrom="md" style={{ overflowX: 'auto' }}>
        <ScrollTable>
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
        </ScrollTable>
      </Box>
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
