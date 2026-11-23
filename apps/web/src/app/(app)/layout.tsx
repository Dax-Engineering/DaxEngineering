import { cookies } from 'next/headers';
import Link from 'next/link';
import {
  CapabilityProvider,
  canDo,
  DaxShell,
  RAIL_COOKIE,
  Icon,
  type ShellNavItem,
} from '@dax/web-shell';
import { InboxCount } from '@dax/platform-contract';
import { ScanMenu } from '../../components/scan-menu';
import { api, requireCapabilities, requireReadyUser } from '../../lib/server';

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
    menu: ['inventory.items', 'inventory.bundles', 'inventory.catalog'],
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

async function unreadCount(): Promise<number> {
  try {
    const { unread } = await api.request('/me/inbox/count', (d) =>
      InboxCount.parse(d),
    );
    return unread;
  } catch {
    return 0;
  }
}

function InboxBell({ unread }: { unread: number }) {
  const label = unread
    ? `Inbox, ${unread} unread ${unread === 1 ? 'message' : 'messages'}`
    : 'Inbox';
  return (
    <Link href="/inbox" className="dax-bell" aria-label={label} title={label}>
      <Icon name="bell" size={20} />
      {unread ? (
        <span className="dax-bell-count">{unread > 99 ? '99+' : unread}</span>
      ) : null}
    </Link>
  );
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
  const unread = await unreadCount();
  return (
    <CapabilityProvider value={caps}>
      <DaxShell
        railOpen={(await cookies()).get(RAIL_COOKIE)?.value === 'open'}
        appLabel="Stores"
        userName={me.user.name}
        userNote={me.user.isSuperAdmin ? 'Super admin' : 'Stores'}
        nav={nav}
        scan={canScan ? { href: '/scan', label: 'Scan' } : undefined}
        mobileKeys={['home', 'stock', 'issuing']}
        actions={
          // Phones scan from the bottom bar; the scan buttons are PC-only.
          <>
            <InboxBell unread={unread} />
            {canScan ? (
              <ScanMenu
                here={canScan}
                phone={canDo(caps, 'inventory.phone_scan.use')}
              />
            ) : null}
          </>
        }
      >
        {children}
      </DaxShell>
    </CapabilityProvider>
  );
}
