import { code128Bars, code128Modules } from '@dax/inventory-contract';

const QUIET = 10;

/** A Code 128 barcode drawn as SVG bars, black on white so it scans in either theme. */
export function SerialBarcode({
  serial,
  height = 56,
}: {
  serial: string;
  height?: number;
}) {
  const width = code128Modules(serial) + QUIET * 2;
  return (
    <svg
      viewBox={`0 0 ${width} 40`}
      height={height}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Barcode for serial ${serial}`}
      style={{
        width: '100%',
        maxWidth: 420,
        background: '#fff',
        display: 'block',
      }}
    >
      <rect x="0" y="0" width={width} height="40" fill="#fff" />
      {code128Bars(serial).map(([x, w]) => (
        <rect key={x} x={x + QUIET} y="0" width={w} height="40" fill="#000" />
      ))}
    </svg>
  );
}
