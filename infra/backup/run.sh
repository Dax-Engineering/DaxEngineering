#!/bin/bash
# Runs backup.sh once a day at BACKUP_AT (HH:MM, container time zone). No cron daemon needed.
set -uo pipefail
trap 'exit 0' TERM INT

at="${BACKUP_AT:-01:30}"
if ! [[ "$at" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]]; then
  echo "BACKUP_AT must be HH:MM, got '$at'" >&2
  exit 2
fi

seconds_until() {
  local now target
  now=$(date +%s)
  target=$(date -d "$(date +%Y-%m-%d) $1" +%s)
  [ "$target" -le "$now" ] && target=$((target + 86400))
  echo $((target - now))
}

echo "Backups run daily at $at ($(date +%Z))"
while true; do
  wait_for=$(seconds_until "$at")
  echo "Next backup in $((wait_for / 60)) minutes"
  sleep "$wait_for" &
  wait $!
  backup.sh || echo "Backup failed; see above" >&2
done
