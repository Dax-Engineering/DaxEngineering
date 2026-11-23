import { Alert } from '@mantine/core';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  looksLikeSerial,
  normalizeSerial,
  SerialDto,
} from '@dax/inventory-contract';
import {
  CardBody,
  Facts,
  Mono,
  PageHead,
  Pill,
  SectionCard,
} from '@dax/web-shell';
import { SerialBarcode } from '../../../../../components/serial-barcode';
import { formatDateTime, formatQty } from '../../../../../lib/format';
import { load } from '../../../../../lib/load';
import { api, requirePermission } from '../../../../../lib/server';

const DOC_PATHS: Record<string, string> = {
  GRN: '/inventory/receiving/grns/',
  CNT: '/inventory/counts/',
  RTN: '/inventory/returns/',
  AOD: '/inventory/issuing/aods/',
};

function grouped(serial: string): string {
  return serial.replace(/(.{4})(?=.)/g, '$1 ');
}

export default async function SerialPage({
  params,
}: {
  params: Promise<{ serial: string }>;
}) {
  await requirePermission('inventory.item.view');
  const { serial: raw } = await params;
  if (!looksLikeSerial(decodeURIComponent(raw))) notFound();
  const serial = normalizeSerial(decodeURIComponent(raw));
  const s = await load(
    api.request(`/inventory/serials/${serial}`, (d) => SerialDto.parse(d)),
  );
  const docBase = DOC_PATHS[s.doc.type];
  const doc = s.doc.number ? (
    docBase ? (
      <Link href={`${docBase}${s.doc.id}`} className="dax-link">
        <Mono>{s.doc.number}</Mono>
      </Link>
    ) : (
      <Mono>{s.doc.number}</Mono>
    )
  ) : (
    'Stock in the store before serial numbers'
  );

  return (
    <>
      <PageHead
        back={{ href: `/inventory/items/${s.item.id}`, label: s.item.partNo }}
        eyebrow="Serial number"
        title={<Mono>{grouped(s.serial)}</Mono>}
        lede={`${s.item.partNo} · ${s.item.brand} · ${s.item.description}`}
      />
      <div className="dax-chips">
        {s.status === 'VOID' ? (
          <Pill tone="bad">Void</Pill>
        ) : (
          <Pill tone="ok">Active</Pill>
        )}
        {s.condition === 'DAMAGED' ? (
          <Pill tone="bad">Received damaged</Pill>
        ) : null}
        {s.source === 'EXISTING' ? <Pill>Existing stock</Pill> : null}
      </div>
      {s.status === 'VOID' ? (
        <Alert color="red" title="This serial is void">
          Its GRN was reversed
          {s.voidedAt ? ` on ${formatDateTime(s.voidedAt)}` : ''}. The part it
          was on never stayed in the store.
        </Alert>
      ) : null}
      <SectionCard title="Barcode" note="Code 128">
        <CardBody>
          <SerialBarcode serial={s.serial} />
          <div style={{ marginTop: 8 }}>
            <Mono>{grouped(s.serial)}</Mono>
          </div>
        </CardBody>
      </SectionCard>
      <SectionCard title="Where it came from">
        <Facts
          items={[
            {
              label: 'Part',
              value: (
                <Link
                  href={`/inventory/items/${s.item.id}`}
                  className="dax-link"
                >
                  <Mono>{s.item.partNo}</Mono>
                </Link>
              ),
            },
            { label: 'Brand', value: s.item.brand },
            { label: 'Description', value: s.item.description },
            { label: s.source === 'GRN' ? 'GRN' : 'Arrived on', value: doc },
            {
              label: 'Unit',
              value:
                s.qty === '1'
                  ? s.unitsOnLine > 1
                    ? `${s.unitNo} of ${s.unitsOnLine}`
                    : 'Single unit'
                  : `${formatQty(s.qty)} ${s.item.uom} (one batch)`,
            },
            { label: 'Received', value: formatDateTime(s.receivedAt) },
            { label: 'Supplier', value: s.supplierName ?? '—' },
            {
              label: 'Last placed in',
              value: s.bin ? <Mono>{s.bin.code}</Mono> : '—',
            },
            {
              label: 'Label printed',
              value: s.printCount
                ? `${s.printCount} ${s.printCount === 1 ? 'time' : 'times'}, last ${formatDateTime(s.lastPrintedAt ?? s.receivedAt)}`
                : 'Not yet',
            },
          ]}
        />
      </SectionCard>
    </>
  );
}
