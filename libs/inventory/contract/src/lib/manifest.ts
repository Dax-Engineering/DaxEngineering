import { defineModule, type PermissionKeysOf } from '@dax/contracts';

export const inventoryManifest = defineModule({
  key: 'inventory',
  name: 'Stores & Inventory',
  description:
    'Items, bins, receiving, issuing, holds, returns, counts and the warranty bin.',
  dependsOn: ['parties'],
  features: {
    item: {
      name: 'Items',
      actions: {
        view: {},
        create: {},
        edit: {},
        archive: {},
        print_label: { label: 'Print labels' },
        import: { label: 'Import from CSV' },
        supersede: {
          label: 'Change supersession',
          description:
            'Marks a part number as superseded by another, which changes which stock MRNs reserve first.',
        },
      },
    },
    serial: {
      name: 'Serial numbers',
      actions: {
        print_label: {
          label: 'Print serial labels',
          description: 'Prints and reprints the Code 128 label of each unit.',
        },
      },
    },
    phone_scan: {
      name: 'Scan with External Phone',
      actions: {
        use: {
          label: 'Lend a phone as a scanner',
          description:
            'Pairs a phone with this PC so its camera scans into a list here.',
        },
      },
    },
    catalog: {
      name: 'Brands and machine models',
      actions: { view: {}, manage: {} },
    },
    bundle: {
      name: 'Bundles',
      description:
        'Saved sets of parts that go out together on an MRN and AOD.',
      actions: { view: {}, manage: { label: 'Manage bundles' } },
    },
    location: {
      name: 'Stores, zones and bins',
      actions: { view: {}, manage: {}, print_label: { label: 'Print labels' } },
    },
    stock: { name: 'Stock levels', actions: { view: {}, export: {} } },
    stock_age: {
      name: 'Age analysis',
      actions: {
        settings: {
          label: 'Change age bands',
          description:
            'Sets the day limits of the bands in the Age analysis report.',
        },
      },
    },
    low_stock: {
      name: 'Low-stock alerts',
      actions: {
        email: {
          label: 'Email low-stock alerts',
          description:
            'Department heads with this also get the weekly report and, when switched on, an email per part.',
        },
        settings: { label: 'Change low-stock email settings' },
      },
    },
    grn: {
      name: 'GRNs (goods received notes)',
      actions: {
        view: {},
        check: { label: 'Check GRN' },
        post: { label: 'Post GRN' },
        putaway: { label: 'Put away' },
        reverse: { label: 'Reverse posted GRN' },
      },
    },
    discrepancy: {
      name: 'Shortage and damage',
      actions: { view: {}, report: {}, close: {} },
    },
    mrn: {
      name: 'MRNs (material request notes)',
      actions: {
        view: { scopes: ['OWN', 'DEPARTMENT', 'ALL'] },
        create: {},
        check: { label: 'Check and reserve stock' },
        allocate: { label: 'Assign new stock to waiting MRNs' },
        cancel: {},
        short_close: { label: 'Close with short lines' },
      },
    },
    aod: {
      name: 'AODs (advice of dispatch)',
      actions: {
        view: { scopes: ['OWN', 'DEPARTMENT', 'ALL'] },
        issue: { label: 'Pick and issue AOD' },
        attach_signed: { label: 'Attach signed AOD' },
        print: {
          label: 'Print AODs',
          description: 'Prints and reprints the DAX and customer copies.',
        },
        approve: {
          label: 'Approve AODs',
          description:
            'Approves or rejects an AOD before Stores issues and prints it. Department: AODs for your own departments.',
          scopes: ['DEPARTMENT', 'ALL'],
          approval: true,
        },
        cancel: {},
      },
    },
    hold: {
      name: 'Stock holds',
      actions: {
        view: { scopes: ['OWN', 'DEPARTMENT', 'ALL'] },
        create: {},
        release: {},
        convert: { label: 'Convert to MRN' },
      },
    },
    return_note: {
      name: 'Returns from jobs',
      actions: {
        view: {},
        create: { label: 'Create and edit drafts' },
        post: { label: 'Post return' },
      },
    },
    count: {
      name: 'Stock counts',
      actions: {
        view: {},
        create: {},
        count: { label: 'Enter counts' },
        submit: {},
        approve: { label: 'Approve differences', approval: true },
        cancel: {},
      },
    },
    warranty: {
      name: 'Warranty bin',
      actions: {
        view: {},
        tag: { label: 'Tag failed part' },
        send: { label: 'Send to supplier' },
        close: {},
      },
    },
    ledger: { name: 'Stock movements', actions: { view: {}, export: {} } },
  },
  numberSeries: [
    {
      docType: 'GRN',
      name: 'Goods received note',
      subtypes: { FOR: 'Foreign', LOC: 'Local' },
    },
    // SAL subtype still to be confirmed with DAX.
    {
      docType: 'MRN',
      name: 'Material request note',
      subtypes: { PRT: 'Parts', SRV: 'Service', SAL: 'Sales' },
    },
    {
      docType: 'AOD',
      name: 'Advice of dispatch',
      subtypes: {
        SER: 'Service',
        REP: 'Repair',
        INS: 'Inspection',
        BRK: 'Breakdown',
        DIR: 'Direct sale',
        HIR: 'Hiring',
      },
    },
    { docType: 'HLD', name: 'Stock hold' },
    { docType: 'RTN', name: 'Return note' },
    { docType: 'CNT', name: 'Stock count' },
    { docType: 'WTY', name: 'Warranty tag' },
  ],
  menu: [
    {
      key: 'inventory.stock',
      label: 'Stock',
      path: '/inventory/stock',
      permission: 'inventory.stock.view',
      icon: 'boxes',
    },
    {
      key: 'inventory.items',
      label: 'Items',
      path: '/inventory/items',
      permission: 'inventory.item.view',
      icon: 'tag',
    },
    {
      key: 'inventory.locations',
      label: 'Bins',
      path: '/inventory/locations',
      permission: 'inventory.location.view',
      icon: 'grid',
    },
    {
      key: 'inventory.catalog',
      label: 'Brands and models',
      path: '/inventory/catalog',
      permission: 'inventory.catalog.view',
      icon: 'layers',
    },
    {
      key: 'inventory.bundles',
      label: 'Bundles',
      path: '/inventory/bundles',
      permission: 'inventory.bundle.view',
      icon: 'box',
    },
    {
      key: 'inventory.receiving',
      label: 'Receiving',
      path: '/inventory/receiving',
      permission: 'inventory.grn.view',
      icon: 'truck',
    },
    {
      key: 'inventory.issuing',
      label: 'Issuing',
      path: '/inventory/issuing',
      permission: 'inventory.mrn.view',
      icon: 'send',
    },
    {
      key: 'inventory.holds',
      label: 'Holds',
      path: '/inventory/issuing/holds',
      permission: 'inventory.hold.view',
      icon: 'lock',
    },
    {
      key: 'inventory.returns',
      label: 'Returns',
      path: '/inventory/returns',
      permission: 'inventory.return_note.view',
      icon: 'undo',
    },
    {
      key: 'inventory.counts',
      label: 'Counts',
      path: '/inventory/counts',
      permission: 'inventory.count.view',
      icon: 'clipboard',
    },
    {
      key: 'inventory.warranty',
      label: 'Warranty bin',
      path: '/inventory/warranty',
      permission: 'inventory.warranty.view',
      icon: 'shield',
    },
    {
      key: 'inventory.reports',
      label: 'Reports',
      path: '/inventory/reports',
      permission: 'inventory.stock.view',
      icon: 'chart',
    },
  ],
  defaultGrants: {
    stores_manager: { '*': 'ALL', 'aod.approve': null },
    stores_keeper: {
      'item.view': 'ALL',
      'item.create': 'ALL',
      'item.edit': 'ALL',
      'item.print_label': 'ALL',
      'serial.print_label': 'ALL',
      'phone_scan.use': 'ALL',
      'catalog.view': 'ALL',
      'bundle.view': 'ALL',
      'location.view': 'ALL',
      'location.print_label': 'ALL',
      'stock.view': 'ALL',
      'grn.view': 'ALL',
      'grn.check': 'ALL',
      'grn.post': 'ALL',
      'grn.putaway': 'ALL',
      'discrepancy.view': 'ALL',
      'discrepancy.report': 'ALL',
      'mrn.view': 'ALL',
      'mrn.create': 'ALL',
      'mrn.check': 'ALL',
      'aod.view': 'ALL',
      'aod.issue': 'ALL',
      'aod.attach_signed': 'ALL',
      'aod.print': 'ALL',
      'hold.view': 'ALL',
      'hold.create': 'ALL',
      'hold.release': 'ALL',
      'hold.convert': 'ALL',
      'return_note.view': 'ALL',
      'return_note.create': 'ALL',
      'return_note.post': 'ALL',
      'count.view': 'ALL',
      'count.count': 'ALL',
      'count.submit': 'ALL',
      'warranty.view': 'ALL',
      'warranty.tag': 'ALL',
      'warranty.send': 'ALL',
      'ledger.view': 'ALL',
    },
    stock_viewer: {
      'item.view': 'ALL',
      'catalog.view': 'ALL',
      'location.view': 'ALL',
      'stock.view': 'ALL',
    },
  },
});

export type InventoryPermission = PermissionKeysOf<typeof inventoryManifest>;
