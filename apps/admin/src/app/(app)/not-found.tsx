import { Button } from '@mantine/core';
import { Icon, StatusPage } from '@dax/web-shell';

export default function NotFound() {
  return (
    <StatusPage
      scene="not-found"
      title="Nothing here"
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
      This record doesn't exist, or you don't have access to it.
    </StatusPage>
  );
}
