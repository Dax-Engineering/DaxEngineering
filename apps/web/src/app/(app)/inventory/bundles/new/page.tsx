import { PageHead, SectionCard } from '@dax/web-shell';
import { requirePermission } from '../../../../../lib/server';
import { BundleForm } from '../bundle-form';

export default async function NewBundlePage() {
  await requirePermission('inventory.bundle.manage');
  return (
    <>
      <PageHead
        back={{ href: '/inventory/bundles', label: 'Bundles' }}
        title="New bundle"
        lede="List the parts in one set. An MRN then asks for a number of sets."
      />
      <SectionCard>
        <BundleForm />
      </SectionCard>
    </>
  );
}
