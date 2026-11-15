import type { MetadataRoute } from 'next';
import { PRODUCT, THEME_COLOR } from '../lib/server';

const SHORTCUT_ICON = [
  { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
];

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: PRODUCT,
    short_name: 'DAX',
    description: 'Stores and inventory for DAX Engineering staff.',
    // Phones open the installed app on Scan; see components/start-on-scan.tsx.
    start_url: '/?from=app',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f5f7fa',
    theme_color: THEME_COLOR,
    shortcuts: [
      { name: 'Scan', short_name: 'Scan', url: '/scan', icons: SHORTCUT_ICON },
      {
        name: 'Receive a delivery',
        short_name: 'Receive',
        url: '/inventory/receiving/grns/new',
        icons: SHORTCUT_ICON,
      },
      {
        name: 'Count stock',
        short_name: 'Count',
        url: '/inventory/counts',
        icons: SHORTCUT_ICON,
      },
    ],
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
