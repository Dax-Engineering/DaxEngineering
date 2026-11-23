import type { ReactNode } from 'react';
import { Mono, Pill } from '@dax/web-shell';

export interface BundleRef {
  id: string;
  name: string;
  customerPartNo: string | null;
}

export interface LineGroup<L> {
  bundle: BundleRef | null;
  lines: L[];
}

/** Bundles first, each with its parts, then loose parts. */
export function groupByBundle<L extends { bundleId: string | null }>(
  lines: readonly L[],
  bundles: readonly BundleRef[],
): LineGroup<L>[] {
  const groups: LineGroup<L>[] = bundles.map((b) => ({
    bundle: b,
    lines: lines.filter((l) => l.bundleId === b.id),
  }));
  const loose = lines.filter((l) => !l.bundleId);
  if (loose.length) groups.push({ bundle: null, lines: loose });
  return groups.filter((g) => g.lines.length > 0);
}

export function BundleTitle({
  bundle,
  children,
}: {
  bundle: BundleRef;
  children?: ReactNode;
}) {
  return (
    <>
      <Pill tone="ext">Bundle</Pill>
      <span className="n">{bundle.name}</span>
      {bundle.customerPartNo ? (
        <span className="dax-muted">
          Customer no. <Mono>{bundle.customerPartNo}</Mono>
        </span>
      ) : null}
      {children}
    </>
  );
}

export function BundleHead({
  bundle,
  children,
}: {
  bundle: BundleRef;
  children?: ReactNode;
}) {
  return (
    <div className="dax-bundle-head">
      <BundleTitle bundle={bundle}>{children}</BundleTitle>
    </div>
  );
}

export function setsText(n: number): string {
  return `${n} ${n === 1 ? 'set' : 'sets'}`;
}
