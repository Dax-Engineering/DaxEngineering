import Link from 'next/link';
import { BundleDto } from '@dax/inventory-contract';
import { canDo, Mono, PageHead, Pill, SectionCard } from '@dax/web-shell';
import { ConfirmAction } from '../../../../../components/confirm-action';
import { formatQty } from '../../../../../lib/format';
import { load, uuidParam } from '../../../../../lib/load';
import { api, requirePermission } from '../../../../../lib/server';
import { setBundleActive } from '../actions';
import { BundleForm } from '../bundle-form';

export default async function BundleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const caps = await requirePermission('inventory.bundle.view');
  const id = await uuidParam(params);
  const bundle = await load(
    api.request(`/inventory/bundles/${id}`, (d) => BundleDto.parse(d)),
  );
  const canManage = canDo(caps, 'inventory.bundle.manage');
  return (
    <>
      <PageHead
        back={{ href: '/inventory/bundles', label: 'Bundles' }}
        eyebrow="Bundle"
        title={bundle.name}
        lede={bundle.description ?? undefined}
        actions={
          canManage ? (
            <ConfirmAction
              action={setBundleActive}
              payload={{
                id: bundle.id,
                version: bundle.version,
                active: !bundle.active,
              }}
              label={bundle.active ? 'Archive' : 'Use again'}
              title={
                bundle.active
                  ? 'Archive this bundle?'
                  : 'Use this bundle again?'
              }
              message={
                bundle.active
                  ? 'New MRNs can no longer pick it. MRNs and AODs that already have it keep it.'
                  : 'New MRNs can pick it again.'
              }
              color={bundle.active ? 'red' : undefined}
            />
          ) : null
        }
      />
      {bundle.active ? null : (
        <div className="dax-chips">
          <Pill>Archived</Pill>
        </div>
      )}
      {canManage ? (
        <SectionCard title="Edit">
          <BundleForm key={bundle.version} bundle={bundle} />
        </SectionCard>
      ) : (
        <SectionCard flush title="Parts in one set">
          <div className="dax-rows">
            {bundle.lines.map((l) => (
              <div key={l.item.id} className="dax-row">
                <div className="dax-row-main">
                  <Link
                    href={`/inventory/items/${l.item.id}`}
                    className="dax-link"
                  >
                    <Mono>{l.item.partNo}</Mono>
                  </Link>
                  <span>{l.item.description}</span>
                  <span className="dax-sub">
                    {formatQty(l.qty)} {l.item.uom} per set
                  </span>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </>
  );
}
