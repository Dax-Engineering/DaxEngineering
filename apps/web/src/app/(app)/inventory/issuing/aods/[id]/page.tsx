import {
  Alert,
  Box,
  Button,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
} from '@mantine/core';
import Link from 'next/link';
import type { AodDto } from '@dax/inventory-contract';
import {
  canDo,
  Facts,
  Icon,
  Mono,
  PageHead,
  Pill,
  SectionCard,
  ScrollTable,
} from '@dax/web-shell';
import { ConfirmAction } from '../../../../../../components/confirm-action';
import { LinkButton } from '../../../../../../components/links';
import { formatDateTime, formatQty } from '../../../../../../lib/format';
import { uuidParam } from '../../../../../../lib/load';
import { requirePermission } from '../../../../../../lib/server';
import { aodStep } from '../../_lib/actions';
import { findMrn, getAod } from '../../_lib/data';
import {
  AOD_TYPE_LABELS,
  type AodCopy,
  aodPdfPath,
  BASE,
  mrnPath,
} from '../../_lib/labels';
import { AodStatusPill } from '../../_lib/pills';
import { AodPicking, type BinStock } from './aod-picking';
import { RejectButton } from './reject-button';
import { SignUpload } from './sign-upload';
import {
  type BundleRef,
  BundleTitle,
  groupByBundle,
  setsText,
} from '../../_lib/bundle-groups';

function stamp(s: { by: string | null; at: string } | null): string {
  if (!s) return '—';
  return s.by ? `${s.by} · ${formatDateTime(s.at)}` : formatDateTime(s.at);
}

function Banner({
  id,
  eyebrow,
  title,
  tone,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  tone: 'yel' | 'int';
  children: React.ReactNode;
}) {
  return (
    <section
      className="dax-card"
      style={{ background: `var(--dax-${tone}-soft)` }}
      aria-labelledby={id}
    >
      <div className="dax-stack" style={{ gap: 14 }}>
        <div>
          <div className="dax-eyebrow">{eyebrow}</div>
          <h2
            id={id}
            className="dax-h1"
            style={{
              fontSize: 34,
              color: tone === 'yel' ? 'var(--dax-yel-ink)' : 'var(--dax-int)',
            }}
          >
            {title}
          </h2>
        </div>
        {children}
      </div>
    </section>
  );
}

function PrintButton({
  id,
  primary,
  copy = 'dax',
}: {
  id: string;
  primary?: boolean;
  copy?: AodCopy;
}) {
  return (
    <Button
      component="a"
      href={aodPdfPath(id, copy)}
      target="_blank"
      rel="noreferrer"
      size={primary ? 'lg' : 'sm'}
      variant={primary ? 'filled' : 'default'}
      leftSection={<Icon name="printer" size={20} />}
    >
      {copy === 'customer' ? 'Print customer AOD' : 'Print DAX AOD'}
    </Button>
  );
}

function Lines({ aod }: { aod: AodDto }) {
  const groups = groupByBundle(aod.lines, aod.bundles);
  const sets = new Map(aod.bundles.map((b) => [b.id, b.sets]));
  const head = (b: BundleRef) => (
    <BundleTitle bundle={b}>
      <span className="dax-muted">{setsText(sets.get(b.id) ?? 0)}</span>
    </BundleTitle>
  );
  return (
    <>
      <Box visibleFrom="md">
        <ScrollTable>
          <TableThead>
            <TableTr>
              <TableTh>Part</TableTh>
              <TableTh>Bin</TableTh>
              <TableTh ta="right">Quantity</TableTh>
              <TableTh>Scanned</TableTh>
            </TableTr>
          </TableThead>
          <TableTbody>
            {groups.flatMap((g) => [
              ...(g.bundle
                ? [
                    <TableTr key={`b-${g.bundle.id}`}>
                      <TableTd colSpan={4} className="dax-bundle-cell">
                        <span className="dax-chips">{head(g.bundle)}</span>
                      </TableTd>
                    </TableTr>,
                  ]
                : []),
              ...g.lines.map((l) => (
                <TableTr
                  key={l.id}
                  className={g.bundle ? 'dax-bundle-part' : undefined}
                >
                  <TableTd>
                    <Mono>{l.item.partNo}</Mono>
                    <span className="dax-sub">{l.item.description}</span>
                    {l.requestedItem ? (
                      <span className="dax-sub">
                        Supplied for <Mono>{l.requestedItem.partNo}</Mono>
                      </span>
                    ) : null}
                    {l.customerPartNo ? (
                      <span className="dax-sub">
                        Customer no. <Mono>{l.customerPartNo}</Mono>
                      </span>
                    ) : null}
                  </TableTd>
                  <TableTd>{l.bin ? <Mono>{l.bin.code}</Mono> : '—'}</TableTd>
                  <TableTd className="dax-num">
                    {formatQty(l.qty)}{' '}
                    <span className="dax-muted">{l.item.uom}</span>
                  </TableTd>
                  <TableTd>
                    {l.scanned ? <Pill tone="ok">Scanned</Pill> : '—'}
                  </TableTd>
                </TableTr>
              )),
            ])}
          </TableTbody>
        </ScrollTable>
      </Box>
      <Box hiddenFrom="md" className="dax-rows">
        {groups.flatMap((g) => [
          ...(g.bundle
            ? [
                <div key={`b-${g.bundle.id}`} className="dax-bundle-head">
                  {head(g.bundle)}
                </div>,
              ]
            : []),
          ...g.lines.map((l) => (
            <div
              key={l.id}
              className={g.bundle ? 'dax-row dax-bundle-part' : 'dax-row'}
            >
              <div className="dax-row-main">
                <b style={{ fontSize: 17 }}>
                  <Mono>{l.item.partNo}</Mono>
                </b>
                <span>{l.item.description}</span>
                {l.requestedItem ? (
                  <span className="dax-sub">
                    Supplied for <Mono>{l.requestedItem.partNo}</Mono>
                  </span>
                ) : null}
                {l.customerPartNo ? (
                  <span className="dax-sub">
                    Customer no. <Mono>{l.customerPartNo}</Mono>
                  </span>
                ) : null}
                <span className="dax-sub">
                  {formatQty(l.qty)} {l.item.uom} from{' '}
                  {l.bin ? <Mono>{l.bin.code}</Mono> : 'no bin'}
                  {l.scanned ? ' · scanned' : ''}
                </span>
              </div>
            </div>
          )),
        ])}
      </Box>
    </>
  );
}

export default async function AodPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const caps = await requirePermission('inventory.aod.view');
  const id = await uuidParam(params);
  const aod = await getAod(id);
  const can = (p: string) => canDo(caps, p);
  const picking = aod.status === 'PICKING';
  const canPick = picking && can('inventory.aod.issue');
  const mrn = canPick ? await findMrn(aod.mrn.id) : null;
  const binsByLine: Record<string, BinStock[]> = Object.fromEntries(
    (mrn?.lines ?? []).map((l) => [l.id, l.bins]),
  );
  const issued = aod.status === 'ISSUED' || aod.status === 'SIGNED';
  const printable = issued && can('inventory.aod.print');
  const stores = can('inventory.aod.issue');
  const cancellable =
    aod.status === 'PICKING' ||
    aod.status === 'PENDING_APPROVAL' ||
    aod.status === 'APPROVED';
  const who = [aod.department.name, aod.customer?.name]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <PageHead
        back={{ href: `${BASE}/aods`, label: 'AODs' }}
        eyebrow={
          <>
            {AOD_TYPE_LABELS[aod.type]} AOD · Started{' '}
            {formatDateTime(aod.createdAt)}
          </>
        }
        title={
          aod.number ? (
            <Mono>{aod.number}</Mono>
          ) : aod.mrn.number ? (
            <>
              AOD for <Mono>{aod.mrn.number}</Mono>
            </>
          ) : (
            `${AOD_TYPE_LABELS[aod.type]} AOD`
          )
        }
        lede={who}
        actions={
          <>
            {cancellable && can('inventory.aod.cancel') ? (
              <ConfirmAction
                action={aodStep}
                payload={{ id: aod.id, version: aod.version, step: 'cancel' }}
                label={picking ? 'Cancel picking' : 'Cancel AOD'}
                title="Cancel this AOD?"
                message="Nothing has left the store. The stock stays reserved for the MRN."
                confirmLabel="Cancel AOD"
                color="red"
              />
            ) : null}
            {printable ? <PrintButton id={aod.id} /> : null}
            {printable && aod.customer ? (
              <PrintButton id={aod.id} copy="customer" />
            ) : null}
            {issued && can('inventory.return_note.create') ? (
              <LinkButton
                href={`/inventory/returns/new?aod=${aod.id}`}
                variant="default"
                size="sm"
              >
                Return items
              </LinkButton>
            ) : null}
          </>
        }
      />
      <div className="dax-chips">
        <AodStatusPill status={aod.status} />
      </div>

      {picking && aod.rejected ? (
        <Alert color="red" title="Rejected">
          {aod.rejectReason ?? 'No reason given.'} · {stamp(aod.rejected)}.{' '}
          {stores ? 'Fix it and send it for approval again, or cancel it.' : ''}
        </Alert>
      ) : null}

      {aod.status === 'PENDING_APPROVAL' ? (
        <Banner
          id="await-approval"
          eyebrow="Not issued yet"
          title="Awaiting approval"
          tone="yel"
        >
          <p className="dax-lede">
            Sent for approval by {aod.submitted?.by ?? 'Stores'}
            {aod.submitted ? ` on ${formatDateTime(aod.submitted.at)}` : ''},
            for {aod.department.name} to approve. Until it is approved, only
            Stores and its approvers can see it, and it cannot be issued or
            printed.
          </p>

          {aod.canApprove ? (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <ConfirmAction
                action={aodStep}
                payload={{ id: aod.id, version: aod.version, step: 'approve' }}
                primary
                label="Approve"
                title="Approve this AOD?"
                message="Stores can then issue it, which takes the stock out and gives it its number, and print it."
                confirmLabel="Approve"
              />
              <RejectButton id={aod.id} version={aod.version} />
            </div>
          ) : stores ? (
            <div>
              <ConfirmAction
                action={aodStep}
                payload={{
                  id: aod.id,
                  version: aod.version,
                  step: 'withdraw',
                }}
                label="Take back to change"
                title="Take this AOD back?"
                message="It returns to picking so you can change it. Approvers no longer see it until you send it again."
                confirmLabel="Take back"
              />
            </div>
          ) : (
            <span className="dax-sub">
              An approver for {aod.department.name} approves it.
            </span>
          )}
        </Banner>
      ) : null}

      {aod.status === 'APPROVED' ? (
        <Banner
          id="approved"
          eyebrow="Approved"
          title="Ready to issue"
          tone="int"
        >
          <p className="dax-lede">
            Approved {stamp(aod.approved)}. Issue it to take the stock out and
            give it its number, then print it.
          </p>
          {stores ? (
            <div>
              <ConfirmAction
                action={aodStep}
                payload={{ id: aod.id, version: aod.version, step: 'issue' }}
                primary
                label="Issue"
                title="Issue this AOD?"
                message="The stock leaves its bins now and the AOD gets its number. Print it, have it signed on delivery and upload the signed copy."
                confirmLabel="Issue AOD"
              />
            </div>
          ) : (
            <span className="dax-sub">Stores issues and prints it.</span>
          )}
        </Banner>
      ) : null}

      {aod.status === 'ISSUED' ? (
        <section
          className="dax-card"
          style={{ background: 'var(--dax-bad-soft)' }}
          aria-labelledby="await-sign"
        >
          <div className="dax-stack" style={{ gap: 14 }}>
            <div>
              <div className="dax-eyebrow">Not complete yet</div>
              <h2
                id="await-sign"
                className="dax-h1"
                style={{ fontSize: 34, color: 'var(--dax-bad)' }}
              >
                Awaiting signature
              </h2>
              <p className="dax-lede">
                Print the AOD, have the receiver sign it, then upload the signed
                copy. Issued {stamp(aod.issued)}.
              </p>
            </div>
            <div>
              {printable ? (
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <PrintButton id={aod.id} primary />
                  {aod.customer ? (
                    <PrintButton id={aod.id} primary copy="customer" />
                  ) : null}
                </div>
              ) : null}
            </div>
            {can('inventory.aod.attach_signed') ? (
              <SignUpload id={aod.id} version={aod.version} />
            ) : (
              <span className="dax-sub">
                Someone with permission to attach signed copies completes it.
              </span>
            )}
          </div>
        </section>
      ) : null}

      {aod.status === 'SIGNED' ? (
        <SectionCard title="Signed" note="Complete">
          <Facts
            items={[
              { label: 'Signed copy received', value: stamp(aod.signed) },
              {
                label: 'Signed copy',
                value: aod.signedFileId ? (
                  <a
                    href={`/files/${aod.signedFileId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="dax-link"
                  >
                    Open the signed copy
                  </a>
                ) : (
                  '—'
                ),
              },
            ]}
          />
        </SectionCard>
      ) : null}

      {canPick ? (
        <AodPicking key={aod.version} aod={aod} binsByLine={binsByLine} />
      ) : (
        <>
          <SectionCard title="AOD details">
            <Facts
              items={[
                {
                  label: 'AOD number',
                  value: aod.number ?? 'Given when issued',
                },
                { label: 'Type', value: AOD_TYPE_LABELS[aod.type] },
                {
                  label: 'MRN',
                  value: can('inventory.mrn.view') ? (
                    <Link href={mrnPath(aod.mrn.id)} className="dax-link">
                      <Mono>{aod.mrn.number ?? 'MRN'}</Mono>
                    </Link>
                  ) : (
                    <Mono>{aod.mrn.number ?? '—'}</Mono>
                  ),
                },
                { label: 'Department', value: aod.department.name },
                ...(aod.customer
                  ? [{ label: 'Customer', value: aod.customer.name }]
                  : []),
                { label: 'Deliver to', value: aod.deliverTo ?? '—' },
                { label: 'Vehicle', value: aod.vehicleNo ?? '—' },
                { label: 'Sent for approval', value: stamp(aod.submitted) },
                { label: 'Approved', value: stamp(aod.approved) },
                { label: 'Issued', value: stamp(aod.issued) },
                {
                  label: 'Notes',
                  value: (
                    <span style={{ whiteSpace: 'pre-wrap' }}>
                      {aod.notes ?? '—'}
                    </span>
                  ),
                },
              ]}
            />
          </SectionCard>
          <SectionCard
            flush
            title="Parts"
            note={`${aod.lines.length} ${aod.lines.length === 1 ? 'pick' : 'picks'}`}
          >
            <Lines aod={aod} />
          </SectionCard>
        </>
      )}
    </>
  );
}
