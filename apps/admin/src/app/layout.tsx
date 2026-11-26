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
import { DaxProvider } from '@dax/web-shell';
import { fontVariables } from '@dax/web-shell/fonts';
import { PRODUCT } from '../lib/server';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: PRODUCT,
  description: 'Users and settings',
  robots: { index: false, follow: false },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '48x48' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const h = await headers();
  const nonce = h.get('x-nonce') ?? undefined;
  const monitoring = browserMonitoringJson('admin', h.get('x-request-id'));
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
      </body>
    </html>
  );
}
