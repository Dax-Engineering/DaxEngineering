#!/bin/bash
# One backup run: encrypted database dump and a copy of uploaded files, then a ping.
set -euo pipefail
. "$(dirname "$0")/common.sh"

step=start
ping() {
  [ -n "${BACKUP_PING_URL:-}" ] || return 0
  curl -fsS -m 10 --retry 3 --data-raw "$2" "${BACKUP_PING_URL%/}$1" >/dev/null || true
}
trap 'ping /fail "backup failed during: $step"' ERR

require PGHOST PGDATABASE PGUSER PGPASSWORD BACKUP_AGE_RECIPIENT
backup_remote

name="dax-$(date +%Y%m%d-%H%M).dump.age"
incoming="$BACKUP_ROOT/incoming/$name"

step=database
pg_dump -Fc --no-password | age -r "$BACKUP_AGE_RECIPIENT" | rclone rcat "$incoming"

step=verify
size=$(rclone size --json "$incoming" | sed -n 's/.*"bytes":\([0-9]*\).*/\1/p')
if [ "${size:-0}" -lt 1024 ]; then
  echo "Uploaded dump is only ${size:-0} bytes" >&2
  false
fi

# Only complete dumps reach the locked daily/, weekly/ and monthly/ folders.
step=publish
rclone copyto "$incoming" "$BACKUP_ROOT/daily/$name"
if [ "$(date +%u)" = 7 ]; then rclone copyto "$incoming" "$BACKUP_ROOT/weekly/$name"; fi
if [ "$(date +%d)" = 01 ]; then rclone copyto "$incoming" "$BACKUP_ROOT/monthly/$name"; fi
rclone deletefile "$incoming"

step=files
if [ -n "${FILES_S3_BUCKET:-}" ]; then
  require FILES_S3_ENDPOINT FILES_READ_ACCESS_KEY_ID FILES_READ_SECRET_ACCESS_KEY
  remote files "$FILES_S3_ENDPOINT" "$FILES_READ_ACCESS_KEY_ID" "$FILES_READ_SECRET_ACCESS_KEY"
  # copy, not sync: files deleted in the app stay in the backup.
  rclone copy "files:$FILES_S3_BUCKET" "$BACKUP_ROOT/files" --fast-list --transfers 8
fi

step=done
echo "Backup $name: $size bytes"
ping "" "ok $name $size bytes"
