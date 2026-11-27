# Nightly encrypted backups: pg_dump (same major as the server) | age | rclone to R2.
FROM postgres:19-alpine
RUN apk add --no-cache age bash curl rclone tzdata \
 && adduser -D -H -u 10001 backup
COPY --chmod=755 infra/backup/common.sh infra/backup/backup.sh infra/backup/restore.sh infra/backup/run.sh /usr/local/bin/
ENV HOME=/tmp TZ=Asia/Colombo RCLONE_CONFIG=/dev/null
USER backup
ENTRYPOINT []
CMD ["run.sh"]
