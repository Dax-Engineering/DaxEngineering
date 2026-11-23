import type { PartFamily } from '@dax/inventory-contract';

/** Tags as small chips; nothing when there are none. */
export function TagChips({ tags }: { tags: readonly string[] }) {
  if (tags.length === 0) return null;
  return (
    <div className="dax-chips" style={{ gap: 4 }}>
      {tags.map((t) => (
        <span key={t} className="dax-pill dax-tag">
          {t}
        </span>
      ))}
    </div>
  );
}

export function names(refs: readonly { name: string }[]): string {
  return refs.length ? refs.map((r) => r.name).join(', ') : '—';
}

type FamilyMember = PartFamily['members'][number];

/** Whether the part has superseded numbers worth showing. */
export function hasFamily(family: PartFamily): boolean {
  return family.members.length > 1;
}

/** The family without older numbers that hold no stock, for stock views; the current number always stays. */
export function inStock(family: PartFamily): PartFamily {
  return {
    ...family,
    members: family.members.filter((m) => m.current || Number(m.onHand) > 0),
  };
}

/** The family's on-hand stock split by number, oldest first; older numbers are issued first. */
export function FamilyBar({ family }: { family: PartFamily }) {
  if (!hasFamily(family)) return null;
  const total = Number(family.stock.onHand);
  if (!(total > 0)) return null;
  const olderQty = family.members
    .filter((m) => !m.current)
    .reduce((sum, m) => sum + Number(m.onHand), 0);
  const current = family.members.find((m) => m.current);
  const label = family.members
    .map((m) => `${m.partNo} ${Number(m.onHand)}`)
    .join(', ');
  return (
    <span className="dax-fam-bar-wrap">
      <span
        className="dax-fam-bar"
        role="img"
        aria-label={`On hand by number: ${label}`}
      >
        {family.members.map((m, i) =>
          Number(m.onHand) > 0 ? (
            <i
              key={m.id}
              title={`${m.partNo}: ${Number(m.onHand)}`}
              data-current={m.current ? 'true' : undefined}
              data-shade={m.current ? undefined : String(i % 2)}
              style={{ flex: Number(m.onHand) }}
            />
          ) : null,
        )}
      </span>
      <span className="dax-fam-legend">
        <span>
          <i /> <b>{olderQty}</b> older
        </span>
        <span>
          <i data-current="true" /> <b>{Number(current?.onHand ?? 0)}</b>{' '}
          current
        </span>
      </span>
    </span>
  );
}

/** "Supersedes" with each older number and its stock; opens the family's rows without script through `:has()`. */
export function FamilyToggle({ family }: { family: PartFamily }) {
  if (!hasFamily(family)) return null;
  const older = family.members.filter((m) => !m.current);
  return (
    <label className="dax-fam-toggle" title="Show each number's stock and bins">
      <input
        type="checkbox"
        className="dax-fam-check"
        aria-label={`Show the ${family.members.length} numbers in this family`}
      />
      <span className="dax-fam-label">Supersedes</span>
      {older.map((m) => (
        <span
          key={m.id}
          className="dax-fam-badge"
          data-empty={Number(m.onHand) > 0 ? undefined : 'true'}
        >
          <span className="pn">{m.partNo}</span>
          <span className="q">{Number(m.onHand)}</span>
        </span>
      ))}
      <span className="dax-fam-caret" aria-hidden="true">
        ▶
      </span>
    </label>
  );
}

/** One line per family number for phone cards, behind a disclosure. */
export function FamilyList({ family }: { family: PartFamily }) {
  if (!hasFamily(family)) return null;
  return (
    <details className="dax-fam-details">
      <summary>{family.members.length} numbers in this family</summary>
      <ul>
        {family.members.map((m) => (
          <li key={m.id}>
            <span
              className="dax-fam-dot"
              data-current={m.current ? 'true' : undefined}
            />
            <span className="dax-mono">{m.partNo}</span>
            <span className="dax-sub">
              {m.current ? 'current' : `superseded by ${m.supersededBy}`} ·{' '}
              {Number(m.onHand)} on hand · {Number(m.free)} free
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** The part-number cell of a family sub-row. */
export function FamilyMemberPart({ member }: { member: FamilyMember }) {
  return (
    <span className="dax-fam-member">
      <span
        className="dax-fam-dot"
        data-current={member.current ? 'true' : undefined}
      />
      <span className="dax-mono">{member.partNo}</span>
      {member.current ? (
        <span className="dax-pill ok">Current</span>
      ) : (
        <span className="dax-sub">superseded by {member.supersededBy}</span>
      )}
    </span>
  );
}

/** A number's on-hand stock with its share of the family's. */
export function FamilyShare({
  member,
  family,
}: {
  member: FamilyMember;
  family: PartFamily;
}) {
  const total = Number(family.stock.onHand);
  const share = total > 0 ? (Number(member.onHand) / total) * 100 : 0;
  return (
    <span className="dax-fam-share" aria-hidden="true">
      <i
        data-current={member.current ? 'true' : undefined}
        style={{ width: `${share}%` }}
      />
    </span>
  );
}
