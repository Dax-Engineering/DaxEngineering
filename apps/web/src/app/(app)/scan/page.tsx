import Link from 'next/link';
import { canDo, PageHead, SectionCard } from '@dax/web-shell';
import { flatten, type SearchParams } from '../../../lib/query';
import { requirePermission } from '../../../lib/server';
import { ScanClient } from './scan-client';

const NOTICES: Record<string, string> = {
  none: "That label isn't linked to an item or bin any more.",
  denied: "You don't have access to what that label points to.",
};

export default async function ScanPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const caps = await requirePermission(
    'inventory.item.view',
    'inventory.location.view',
  );
  const canPhone = canDo(caps, 'inventory.phone_scan.use');
  const { qr } = flatten(await searchParams);
  return (
    <>
      <PageHead
        eyebrow="Inventory"
        title="Scan"
        lede="Point the camera at a label or barcode. You can also type the code, or use a hand-held scanner."
      />
      <SectionCard>
        <ScanClient notice={qr ? (NOTICES[qr] ?? null) : null} />
      </SectionCard>
      {canPhone ? (
        <p className="dax-muted dax-pc-only">
          No camera on this PC, or scanning a whole delivery?{' '}
          <Link href="/scan/phone">Scan with External Phone instead</Link>.
        </p>
      ) : null}
    </>
  );
}
