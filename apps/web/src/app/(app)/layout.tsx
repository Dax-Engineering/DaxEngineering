import Link from 'next/link';
import {
  CapabilityProvider,
  canDo,
  DaxShell,
  Icon,
  type ShellNavItem,
} from '@dax/web-shell';
import { requireCapabilities, requireReadyUser } from '../../lib/server';

const SECTIONS = [
  {
    key: 'stock',
    label: 'Stock',
    icon: 'boxes',
    menu: ['inventory.stock', 'inventory.locations', 'inventory.counts'],
  },
  {
    key: 'items',
    label: 'Items',
    icon: 'tag',
    menu: ['inventory.items', 'inventory.catalog'],
  },
  {
    key: 'receiving',
    label: 'Receiving',
    icon: 'truck',
    menu: ['inventory.receiving'],
  },
  {
    key: 'issuing',
    label: 'Issuing',
    icon: 'send',
    menu: ['inventory.issuing', 'inventory.holds'],
  },
  {
    key: 'returns',
    label: 'Returns',
    icon: 'undo',
    menu: ['inventory.returns', 'inventory.warranty'],
  },
  {
    key: 'reports',
    label: 'Reports',
    icon: 'chart',
    menu: ['inventory.reports'],
  },
  {
    key: 'contacts',
    label: 'Contacts',
    icon: 'users',
    menu: ['parties.customers', 'parties.suppliers'],
  },
];

type MenuEntry = {
  key: string;
  label: string;
  path: string;
  icon?: string | null;
};

function buildNav(menu: MenuEntry[]): ShellNavItem[] {
  const byKey = new Map(menu.map((m) => [m.key, m]));
  const grouped = new Set(SECTIONS.flatMap((s) => s.menu));
  const sections = SECTIONS.flatMap((section) => {
    const tabs = section.menu
      .map((key) => byKey.get(key))
      .filter((m): m is MenuEntry => m !== undefined)
      .map(({ key, label, path }) => ({ key, label, path }));
    const first = tabs[0];
    if (!first) return [];
    return [
      {
        key: section.key,
        label: tabs.length === 1 ? first.label : section.label,
        path: first.path,
        icon: section.icon,
        tabs,
      },
    ];
  });
  const rest = menu
    .filter((m) => !grouped.has(m.key))
    .map(({ key, label, path, icon }) => ({
      key,
      label,
      path,
      icon: icon ?? 'grid',
    }));
  return [
    { key: 'home', label: 'Home', path: '/', icon: 'home' },
    ...sections,
    ...rest,
  ];
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await requireReadyUser();
  const caps = await requireCapabilities();
  const canScan =
    canDo(caps, 'inventory.item.view') ||
    canDo(caps, 'inventory.location.view');
  const nav = buildNav(caps.menu);
  return (
    <CapabilityProvider value={caps}>
      <DaxShell
        appLabel="Stores"
        userName={me.user.name}
        userNote={me.user.isSuperAdmin ? 'Super admin' : 'Stores'}
        nav={nav}
        scan={canScan ? { href: '/scan', label: 'Scan' } : undefined}
        mobileKeys={['home', 'stock', 'issuing']}
        actions={
          // On the PC the only scan option is lending a phone; phones scan
          // with their own camera from the bottom bar.
          canDo(caps, 'inventory.item.view') ? (
            <Link href="/scan/phone" className="dax-cta">
              <Icon name="phone" size={20} />
              Scan with phone
            </Link>
          ) : null
        }
      >
        {children}
      </DaxShell>
    </CapabilityProvider>
  );
}
