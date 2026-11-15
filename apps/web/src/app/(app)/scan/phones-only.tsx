'use client';

import { Group, Loader } from '@mantine/core';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';

/** Same breakpoint as the phone bottom bar. */
const PHONE = '(max-width: 900px)';

/**
 * The camera scanner is for phones. On a PC-sized screen this sends you to
 * "Scan with phone" instead, before the camera is ever asked for.
 */
export function PhonesOnly({
  pcPath,
  children,
}: {
  /** Where a PC goes instead; null keeps PCs on a message. */
  pcPath: string | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const [phone, setPhone] = useState<boolean | null>(null);

  useEffect(() => {
    const query = window.matchMedia(PHONE);
    const update = () => setPhone(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (phone === false && pcPath) router.replace(pcPath);
  }, [phone, pcPath, router]);

  if (phone) return <>{children}</>;
  if (phone === false && !pcPath) {
    return <p>Scanning works on phones. Open this page on a phone.</p>;
  }
  return (
    <Group justify="center" p="xl">
      <Loader />
    </Group>
  );
}
