import type { Metadata, Viewport } from 'next';
import { phoneState } from './actions';
import { PhoneScanner } from './phone-scanner';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'DAX phone scanner',
  robots: { index: false, follow: false },
};
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

/**
 * The phone scanner. Bookmark this one address on the phone. There is no
 * sign-in: scanning the QR code on a PC's "Scan with phone" screen pairs the
 * phone with that PC for a short time, and scans only go to that PC's list.
 */
export default async function PhoneScannerPage() {
  return <PhoneScanner initial={await phoneState()} />;
}
