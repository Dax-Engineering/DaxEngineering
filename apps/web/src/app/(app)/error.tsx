'use client';

import { Button } from '@mantine/core';
import { Icon, StatusPage } from '@dax/web-shell';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <StatusPage
      scene="error"
      title="Something went wrong"
      reference={error.digest}
      alert
      actions={
        <>
          <Button
            size="md"
            onClick={reset}
            leftSection={<Icon name="refresh" size={18} />}
          >
            Try again
          </Button>
          <Button
            size="md"
            component="a"
            href="/"
            variant="default"
            leftSection={<Icon name="home" size={18} />}
          >
            Go home
          </Button>
        </>
      }
    >
      This page could not be loaded. Check your connection and try again. If it
      keeps happening, tell your manager or the system administrator.
    </StatusPage>
  );
}
