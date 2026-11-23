import { Button } from '@mantine/core';
import { Icon, StatusPage } from '@dax/web-shell';

export default function NotFound() {
  return (
    <StatusPage
      scene="not-found"
      title="Page not found"
      full
      actions={
        <Button
          size="md"
          component="a"
          href="/"
          variant="default"
          leftSection={<Icon name="home" size={18} />}
        >
          Go home
        </Button>
      }
    >
      This link doesn't go anywhere. Check the address, or go back home.
    </StatusPage>
  );
}
