import { canDo, PageHead, SectionCard } from '@dax/web-shell';
import { requirePermission } from '../../../../../../lib/server';
import { getDepartments, getSavedBundles } from '../../_lib/data';
import { BASE } from '../../_lib/labels';
import { MrnForm } from '../mrn-form';

export default async function NewMrnPage() {
  const caps = await requirePermission('inventory.mrn.create');
  const [departments, savedBundles] = await Promise.all([
    getDepartments(),
    canDo(caps, 'inventory.bundle.view') ? getSavedBundles() : [],
  ]);
  return (
    <>
      <PageHead
        back={{ href: `${BASE}/mrns`, label: 'MRNs' }}
        eyebrow="Issuing"
        title="Raise MRN"
        lede="List the parts a job needs. Stores checks it, reserves what is free and the rest waits for stock."
      />
      <SectionCard>
        <MrnForm
          departments={departments}
          canSubmit={canDo(caps, 'inventory.mrn.create')}
          savedBundles={savedBundles}
        />
      </SectionCard>
    </>
  );
}
