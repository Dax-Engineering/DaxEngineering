'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * The installed app starts at /?from=app. On a phone-sized screen it goes
 * straight to Scan; on a PC it stays on Home.
 */
export function StartOnScan() {
  const router = useRouter();
  useEffect(() => {
    if (window.matchMedia('(max-width: 900px)').matches) {
      router.replace('/scan');
    }
  }, [router]);
  return null;
}
