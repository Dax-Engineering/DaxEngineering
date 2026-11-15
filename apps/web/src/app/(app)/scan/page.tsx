import { canDo, PageHead, SectionCard } from '@dax/web-shell';
import { flatten, type SearchParams } from '../../../lib/query';
import { requirePermission } from '../../../lib/server';
import { PhonesOnly } from './phones-only';
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
  const canPhone = canDo(caps, 'inventory.item.view');
  const { qr } = flatten(await searchParams);
  return (
    <>
      <PageHead
        eyebrow="Inventory"
        title="Scan"
        lede="Point the camera at a label or barcode. You can also type the code, or use a hand-held scanner."
      />
      {/* PCs scan by lending a phone; the camera scanner is for phones. */}
      <PhonesOnly pcPath={canPhone ? '/scan/phone' : null}>
        <SectionCard>
          <ScanClient notice={qr ? (NOTICES[qr] ?? null) : null} />
        </SectionCard>
      </PhonesOnly>
    </>
  );
}
