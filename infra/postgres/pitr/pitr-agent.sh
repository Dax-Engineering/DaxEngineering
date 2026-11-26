#!/bin/bash
# Runs next to Postgres: creates the PITR repository, takes the daily backup at PITR_BACKUP_AT
# (full on Sundays, differential otherwise) and reports to Healthchecks.io every 5 minutes.
set -uo pipefail
trap 'exit 0' TERM INT

at="${PITR_BACKUP_AT:-02:30}"
if ! [[ "$at" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]]; then
  echo "PITR_BACKUP_AT must be HH:MM, got '$at'" >&2
  exit 2
fi

SOCKET=/var/run/postgresql

sql() {
  psql -h "$SOCKET" -U postgres -d postgres -Atc "$1"
}

pause() {
  sleep "$1" &
  wait $!
}

ping() {
  [ -n "${PITR_PING_URL:-}" ] || return 0
  curl -fsS -m 10 --retry 3 -o /dev/null --data-raw "${2:-}" "${PITR_PING_URL}$1" || true
}

last_backup_stop() {
  dax-pgbackrest info --output=json | jq -r '[.[0].backup[]?.timestamp.stop] | max // 0'
}

# The archiver is healthy when nothing has failed since the last file reached R2.
archiving_ok() {
  local state
  state=$(sql "SELECT CASE WHEN last_failed_time IS NULL THEN 'ok'
                           WHEN last_archived_time > last_failed_time THEN 'ok'
                           ELSE 'failing' END FROM pg_stat_archiver") || return 1
  [ "$state" = ok ]
}

until [ "$(sql 'SELECT NOT pg_is_in_recovery()' 2>/dev/null)" = t ]; do pause 5; done
# After a restore the checkpointer sleeps a full checkpoint_timeout before it first honours
# archive_timeout; a checkpoint wakes it so changes leave within 15 seconds from the start.
sql CHECKPOINT >/dev/null
until dax-pgbackrest stanza-create; do
  ping /fail "stanza-create failed"
  pause 60
done
echo "PITR backups run daily at $at ($(date +%Z)); WAL is archived continuously"

while true; do
  now=$(date +%s)
  today_at=$(date -d "$(date +%Y-%m-%d) $at" +%s)
  last=$(last_backup_stop || echo error)
  problem=""

  if [ "$last" = error ]; then
    problem="cannot read the backup repository"
  elif [ "$last" -eq 0 ] || { [ "$now" -ge "$today_at" ] && [ "$last" -lt "$today_at" ]; }; then
    type=diff
    [ "$(date +%u)" = 7 ] && type=full
    echo "Starting $type backup"
    if dax-pgbackrest backup --type="$type"; then
      echo "Backup finished"
    else
      problem="$type backup failed"
    fi
  elif [ $((now - last)) -gt $((26 * 3600)) ]; then
    problem="no backup in the last 26 hours"
  fi

  if [ -z "$problem" ] && ! archiving_ok; then
    problem="WAL archiving to R2 is failing"
  fi

  if [ -n "$problem" ]; then
    echo "PITR problem: $problem" >&2
    ping /fail "$problem"
  else
    ping ""
  fi
  pause 300
done
