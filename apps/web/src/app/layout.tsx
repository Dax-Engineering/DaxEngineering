import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import '@dax/web-shell/styles.css';
import './global.css';
import { mantineHtmlProps } from '@mantine/core';
import { headers } from 'next/headers';
import {
  browserMonitoringJson,
  MONITORING_ELEMENT_ID,
} from '@dax/web-data-access/monitoring';
import { THEME_SCRIPT } from '@dax/web-shell/server';
import type { Metadata, Viewport } from 'next';
import { DaxProvider } from '@dax/web-shell';
import { fontVariables } from '@dax/web-shell/fonts';
import { ServiceWorkerRegistration } from '../components/service-worker';
import { PRODUCT, THEME_COLOR } from '../lib/server';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: PRODUCT,
  description: 'Stores and inventory',
  robots: { index: false, follow: false },
  applicationName: PRODUCT,
  appleWebApp: { capable: true, title: 'DAX', statusBarStyle: 'default' },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '48x48' },
      { url: '/icons/icon.svg', type: 'image/svg+xml' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
};

export const viewport: Viewport = {
  themeColor: THEME_COLOR,
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const h = await headers();
  const nonce = h.get('x-nonce') ?? undefined;
  const monitoring = browserMonitoringJson('web', h.get('x-request-id'));
  return (
    <html lang="en" className={fontVariables} {...mantineHtmlProps}>
      <head>
        {/* Sets light/dark before first paint. A plain server-rendered tag:
            next/script also renders it on the client, where React warns that
            it never runs. THEME_SCRIPT is a fixed string, not user input.
            Browsers hide the nonce after load, hence suppressHydrationWarning. */}
        <script
          id="dax-theme"
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }}
        />
        {monitoring && (
          <script
            id={MONITORING_ELEMENT_ID}
            type="application/json"
            nonce={nonce}
            suppressHydrationWarning
            dangerouslySetInnerHTML={{ __html: monitoring }}
          />
        )}
      </head>
      <body>
        <DaxProvider>{children}</DaxProvider>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
