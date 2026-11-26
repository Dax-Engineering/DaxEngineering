import { ITEM_CSV_COLUMNS } from '@dax/inventory-contract';
import { canDo, PageHead } from '@dax/web-shell';
import { ImportScreen } from '../../../../../components/import-screen';
import { requirePermission } from '../../../../../lib/server';

export default async function ImportItemsPage() {
  const caps = await requirePermission('inventory.item.import');
  const canUpdate = canDo(caps, 'inventory.item.edit');
  return (
    <>
      <PageHead
        back={{ href: '/inventory/stock', label: 'Stock' }}
        title="Import items"
        lede={
          canUpdate
            ? 'Add many parts at once from a CSV file, or update parts you already have.'
            : 'Add many parts at once from a CSV file.'
        }
      />
      <ImportScreen
        kind="items"
        noun="part"
        columns={ITEM_CSV_COLUMNS}
        backHref="/inventory/stock"
        modes={[
          {
            value: 'add',
            label: 'Add new parts only',
            notes: [
              'A row whose part number and brand already exist is refused.',
            ],
          },
          ...(canUpdate
            ? [
                {
                  value: 'upsert' as const,
                  label: 'Add new parts and update existing ones',
                  notes: [
                    'A row whose part number and brand already exist updates that part. Other rows are added as new parts.',
                    'When updating, a blank cell leaves that value as it is; it never clears it.',
                    'machine_models and tags replace the current list when filled in. Barcodes are added to the part; its other barcodes stay.',
                    'Stock, supersession and archive status are never changed. Archived parts cannot be updated.',
                  ],
                },
              ]
            : []),
        ]}
        notes={[
          'Brands, machine models and bins must already exist; use the same names and codes as in the app.',
          'uom is a unit code such as PCS, SET, L or KG.',
          'Several machine models, barcodes or tags go in one cell, separated by |.',
          'supplier is the supplier name as in Contacts. Prices are in rupees, like 1250 or 1250.50.',
          'supplier, tags, pre_cost_price and selling_price are optional columns.',
          'Save the file as CSV (UTF-8) from Excel or Google Sheets.',
        ]}
      />
    </>
  );
}
