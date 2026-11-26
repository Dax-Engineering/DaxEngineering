#!/bin/bash
# Restore a backup into an empty database.
#   restore.sh --key <age identity file> --target <postgres URL> [--dump daily/dax-....dump.age] [--force]
# Without --dump it takes the newest daily dump.
set -euo pipefail
. "$(dirname "$0")/common.sh"

key='' target='' dump='' force=false
while [ $# -gt 0 ]; do
  case "$1" in
    --key) key="$2"; shift 2 ;;
    --target) target="$2"; shift 2 ;;
    --dump) dump="$2"; shift 2 ;;
    --force) force=true; shift ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done
[ -r "$key" ] || { echo "--key must name a readable age identity file" >&2; exit 2; }
[ -n "$target" ] || { echo "--target is required" >&2; exit 2; }
backup_remote

if [ -z "$dump" ]; then
  dump="daily/$(rclone lsf "$BACKUP_ROOT/daily/" --include 'dax-*.dump.age' | sort | tail -n 1)"
  [ "$dump" != "daily/" ] || { echo "No dumps found in $BACKUP_ROOT/daily" >&2; exit 1; }
fi

tables=$(psql "$target" -Atc "SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')")
if [ "$tables" -gt 0 ] && [ "$force" != true ]; then
  echo "Target database already has $tables tables. Use an empty database, or pass --force." >&2
  exit 1
fi

clean=()
[ "$force" = true ] && clean=(--clean --if-exists)

echo "Restoring $dump"
started=$(date +%s)
rclone cat "$BACKUP_ROOT/$dump" | age -d -i "$key" \
  | pg_restore --no-owner --role=dax_owner --exit-on-error "${clean[@]}" -d "$target"
echo "Restored $dump in $(( $(date +%s) - started )) seconds"
