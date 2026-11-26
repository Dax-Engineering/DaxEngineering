#!/bin/bash
# Restores from the PITR repository into an empty data directory when DAX_RESTORE is set,
# then hands over to the stock Postgres entrypoint.
#   DAX_RESTORE=latest                        everything that reached R2
#   DAX_RESTORE="2026-11-26 10:42:00+05:30"   the database as it was at that moment
#   DAX_RESTORE_SCRATCH=true                  a side copy: never archives into the repository
set -euo pipefail

if [ -n "${DAX_RESTORE:-}" ] && [ ! -s "$PGDATA/PG_VERSION" ]; then
  mkdir -p "$PGDATA"
  chown postgres:postgres "$PGDATA"
  chmod 700 "$PGDATA"
  if [ "$DAX_RESTORE" = latest ]; then
    args=(restore)
  else
    args=(restore --type=time "--target=$DAX_RESTORE" --target-action=promote)
  fi
  if [ "${DAX_RESTORE_SCRATCH:-false}" = true ]; then
    args+=(--archive-mode=off)
  fi
  echo "Restoring the database from the PITR backups ($DAX_RESTORE)"
  PITR_LOG_LEVEL=info gosu postgres dax-pgbackrest "${args[@]}"
  echo "Files restored; Postgres now replays the changes and opens the database"
fi

exec docker-entrypoint.sh "$@"
