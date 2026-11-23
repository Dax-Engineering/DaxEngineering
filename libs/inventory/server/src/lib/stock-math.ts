import type { StockFigures } from '@dax/inventory-contract';
import { Prisma } from '@dax/platform-db';

export type DecimalLike = Prisma.Decimal | string | number;

export interface BalanceRow {
  onHand: DecimalLike;
  held: DecimalLike;
  quarantine: DecimalLike;
  receiving?: DecimalLike;
}

export function dec(value: DecimalLike): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

export function qtyString(value: DecimalLike): string {
  return dec(value).toDecimalPlaces(3).toFixed();
}

export function stockFigures(balance: BalanceRow | null | undefined): {
  figures: StockFigures;
  onHand: Prisma.Decimal;
} {
  const onHand = dec(balance?.onHand ?? 0);
  const held = dec(balance?.held ?? 0);
  const quarantine = dec(balance?.quarantine ?? 0);
  const receiving = dec(balance?.receiving ?? 0);
  return {
    onHand,
    figures: {
      onHand: qtyString(onHand),
      held: qtyString(held),
      quarantine: qtyString(quarantine),
      receiving: qtyString(receiving),
      free: qtyString(onHand.minus(held).minus(quarantine).minus(receiving)),
    },
  };
}

type FamilyMember = {
  id: string;
  partNo: string;
  familyDepth: number;
  supersededBy: { partNo: string } | null;
  balances: readonly BalanceRow[];
};

/** Stock of every family number plus the family total; members come oldest first. */
export function familyFigures(members: readonly FamilyMember[]): {
  stock: StockFigures;
  onHand: Prisma.Decimal;
  members: {
    id: string;
    partNo: string;
    current: boolean;
    supersededBy: string | null;
    onHand: string;
    held: string;
    free: string;
    receiving: string;
  }[];
} {
  const sum = {
    onHand: dec(0),
    held: dec(0),
    quarantine: dec(0),
    receiving: dec(0),
  };
  const rows = members.map((m) => {
    const b = m.balances[0];
    sum.onHand = sum.onHand.plus(dec(b?.onHand ?? 0));
    sum.held = sum.held.plus(dec(b?.held ?? 0));
    sum.quarantine = sum.quarantine.plus(dec(b?.quarantine ?? 0));
    sum.receiving = sum.receiving.plus(dec(b?.receiving ?? 0));
    const { figures } = stockFigures(b);
    return {
      id: m.id,
      partNo: m.partNo,
      current: m.familyDepth === 0,
      supersededBy: m.supersededBy?.partNo ?? null,
      onHand: figures.onHand,
      held: figures.held,
      free: figures.free,
      receiving: figures.receiving,
    };
  });
  const { figures, onHand } = stockFigures(sum);
  return { stock: figures, onHand, members: rows };
}

export function isBelowMin(onHand: DecimalLike, minQty: DecimalLike): boolean {
  const min = dec(minQty);
  return min.gt(0) && dec(onHand).lt(min);
}

export function isWhole(value: DecimalLike): boolean {
  return dec(value).isInteger();
}
