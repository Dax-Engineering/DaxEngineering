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
