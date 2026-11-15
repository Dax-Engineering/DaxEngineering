import 'server-only';
import { cache } from 'react';
import { z } from 'zod';
import {
  BinDetail,
  BinPage,
  BinQuery,
  CatalogLists,
  InventorySummary,
  ItemDetail,
  ItemFacets,
  ItemPage,
  ItemQuery,
  StockPage,
  StockQuery,
  ZoneDto,
} from '@dax/inventory-contract';
import { load, optional, unlessForbidden } from '../../../../lib/load';
import { type Query, readQuery, toQuery } from '../../../../lib/query';
import { api } from '../../../../lib/server';

const ZoneList = z.object({ zones: z.array(ZoneDto) });
const EMPTY_CATALOG: CatalogLists = {
  brands: [],
  machineModels: [],
  machineTypes: [],
};

/** Suppliers and tags in use on items, for list filters. */
export const getItemFacets = cache(() =>
  unlessForbidden(
    api.request('/inventory/items/facets', (d) => ItemFacets.parse(d)),
    { suppliers: [], tags: [] },
  ),
);

/** Filter dropdowns for supplier, machine type and tag. */
export async function itemFilterSelects() {
  const [facets, catalog] = await Promise.all([getItemFacets(), getCatalog()]);
  return [
    {
      name: 'supplierId',
      label: 'Supplier',
      data: facets.suppliers.map((s) => ({ value: s.id, label: s.name })),
    },
    {
      name: 'machineTypeId',
      label: 'Machine type',
      data: catalog.machineTypes.map((t) => ({ value: t.id, label: t.name })),
    },
    {
      name: 'tag',
      label: 'Tag',
      data: facets.tags.map((t) => ({ value: t, label: t })),
    },
  ].filter((s) => s.data.length > 0);
}

export const getCatalog = cache(() =>
  unlessForbidden(
    api.request('/inventory/catalog', (d) => CatalogLists.parse(d)),
    EMPTY_CATALOG,
  ),
);

export const getZones = cache(async () => {
  const { zones } = await unlessForbidden(
    api.request('/inventory/zones', (d) => ZoneList.parse(d)),
    { zones: [] },
  );
  return zones;
});

export function listItems(raw: Query) {
  return load(
    api.request(`/inventory/items${toQuery(readQuery(ItemQuery, raw))}`, (d) =>
      ItemPage.parse(d),
    ),
  );
}

export function getItem(id: string) {
  return load(
    api.request(`/inventory/items/${id}`, (d) => ItemDetail.parse(d)),
  );
}

export function listBins(raw: Query) {
  return load(
    api.request(`/inventory/bins${toQuery(readQuery(BinQuery, raw))}`, (d) =>
      BinPage.parse(d),
    ),
  );
}

export function getBin(id: string) {
  return load(api.request(`/inventory/bins/${id}`, (d) => BinDetail.parse(d)));
}

export function listStock(raw: Query) {
  return load(
    api.request(`/inventory/stock${toQuery(readQuery(StockQuery, raw))}`, (d) =>
      StockPage.parse(d),
    ),
  );
}

export const getInventorySummary = cache(() =>
  optional(api.request('/inventory/summary', (d) => InventorySummary.parse(d))),
);
