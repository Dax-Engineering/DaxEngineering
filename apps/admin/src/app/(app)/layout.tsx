import { cookies } from 'next/headers';
import { CapabilityProvider, DaxShell, RAIL_COOKIE } from '@dax/web-shell';
import { requireCapabilities, requireReadyUser } from '../../lib/server';

const FALLBACK_ICONS: Record<string, string> = {
  users: 'users',
  roles: 'key',
  departments: 'hierarchy',
  modules: 'puzzle',
  numbering: 'hash',
  audit: 'history',
};

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await requireReadyUser();
  const caps = await requireCapabilities();
  const nav = [
    { key: 'home', label: 'Home', path: '/', icon: 'home' },
    ...caps.menu.map(({ key, label, path, icon }) => ({
      key,
      label,
      path,
      icon: icon ?? FALLBACK_ICONS[key] ?? 'grid',
    })),
  ];
  return (
    <CapabilityProvider value={caps}>
      <DaxShell
        railOpen={(await cookies()).get(RAIL_COOKIE)?.value === 'open'}
        appLabel="Admin"
        userName={me.user.name}
        userNote={me.user.isSuperAdmin ? 'Super admin' : 'Admin'}
        nav={nav}
      >
        {children}
      </DaxShell>
    </CapabilityProvider>
  );
}
