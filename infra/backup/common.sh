#!/bin/bash
# Shared by backup.sh and restore.sh. rclone remotes come from the environment, no config file.

require() {
  local name
  for name in "$@"; do
    if [ -z "${!name:-}" ]; then
      echo "$name is not set" >&2
      exit 2
    fi
  done
}

# remote <rclone name> <endpoint> <access key> <secret key>
remote() {
  local upper
  upper=$(echo "$1" | tr '[:lower:]' '[:upper:]')
  export "RCLONE_CONFIG_${upper}_TYPE=s3"
  export "RCLONE_CONFIG_${upper}_PROVIDER=${BACKUP_S3_PROVIDER:-Cloudflare}"
  export "RCLONE_CONFIG_${upper}_ENDPOINT=$2"
  export "RCLONE_CONFIG_${upper}_ACCESS_KEY_ID=$3"
  export "RCLONE_CONFIG_${upper}_SECRET_ACCESS_KEY=$4"
  export "RCLONE_CONFIG_${upper}_REGION=${S3_REGION:-auto}"
  export "RCLONE_CONFIG_${upper}_NO_CHECK_BUCKET=true"
}

backup_remote() {
  require BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_ACCESS_KEY_ID BACKUP_S3_SECRET_ACCESS_KEY
  remote backup "$BACKUP_S3_ENDPOINT" "$BACKUP_S3_ACCESS_KEY_ID" "$BACKUP_S3_SECRET_ACCESS_KEY"
  BACKUP_ROOT="backup:$BACKUP_S3_BUCKET"
}
