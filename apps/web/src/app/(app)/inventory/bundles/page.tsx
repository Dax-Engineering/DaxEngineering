import Link from 'next/link';
import { BundlePage, BundleQuery } from '@dax/inventory-contract';
import {
  canDo,
  Empty,
  LinkList,
  PageHead,
  Pill,
  SectionCard,
} from '@dax/web-shell';
import { LinkButton } from '../../../../components/links';
import { load } from '../../../../lib/load';
import { flatten, readQuery, toQuery } from '../../../../lib/query';
import { api, requirePermission } from '../../../../lib/server';

export default async function BundlesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const caps = await requirePermission('inventory.bundle.view');
  const query = readQuery(BundleQuery, {
    limit: '100',
    ...flatten(await searchParams),
  });
  const page = await load(
    api.request(`/inventory/bundles${toQuery(query)}`, (d) =>
      BundlePage.parse(d),
    ),
  );
  const all = query.status === 'ALL';
  return (
    <>
      <PageHead
        eyebrow="Items"
        title="Bundles"
        lede="A bundle is a set of parts that goes out together, like a service kit. Add it to an MRN by name. The customer AOD prints it as one line with its parts under it."
        actions={
          canDo(caps, 'inventory.bundle.manage') ? (
            <LinkButton href="/inventory/bundles/new">New bundle</LinkButton>
          ) : null
        }
      />
      <SectionCard
        flush
        title="Saved bundles"
        note={`${page.total} ${page.total === 1 ? 'bundle' : 'bundles'}`}
        actions={
          <Link
            className="dax-link"
            href={all ? '/inventory/bundles' : '/inventory/bundles?status=ALL'}
          >
            {all ? 'Hide archived' : 'Show archived'}
          </Link>
        }
      >
        {page.items.length ? (
          <LinkList
            items={page.items.map((b) => ({
              key: b.id,
              href: `/inventory/bundles/${b.id}`,
              title: b.name,
              sub: `${b.partCount} ${b.partCount === 1 ? 'part' : 'parts'}${b.description ? ` · ${b.description}` : ''}`,
              aside: b.active ? undefined : <Pill>Archived</Pill>,
            }))}
          />
        ) : (
          <Empty title="No bundles yet">
            Save a bundle for sets you send often. You can also put one together
            on an MRN without saving it.
          </Empty>
        )}
      </SectionCard>
    </>
  );
}
