import { redirect } from 'next/navigation';
import { flatten, type SearchParams, toQuery } from '../../../../lib/query';

/** Items and stock are one list now: old links land on Stock. */
export default async function ItemsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  redirect(`/inventory/stock${toQuery(flatten(await searchParams))}`);
}
