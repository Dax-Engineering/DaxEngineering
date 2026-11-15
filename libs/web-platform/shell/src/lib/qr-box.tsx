'use client';

import QRCode from 'react-qr-code';

/** A QR code on a white tile, so phones can read it in dark mode too. */
export function QrBox({ value, size = 200 }: { value: string; size?: number }) {
  return (
    <div className="dax-phone-qr">
      <QRCode value={value} size={size} />
    </div>
  );
}
