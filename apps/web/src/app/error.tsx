'use client';

import { Button } from '@mantine/core';
import { Icon, StatusPage } from '@dax/web-shell';

export default function RootError({ reset }: { reset: () => void }) {
  return (
    <StatusPage
      scene="error"
      title="Can't load this page"
      alert
      full
      actions={
        <Button
          size="md"
          onClick={reset}
          leftSection={<Icon name="refresh" size={18} />}
        >
          Try again
        </Button>
      }
    >
      The server may still be starting up, or the connection dropped. Wait a
      moment and try again.
    </StatusPage>
  );
}
