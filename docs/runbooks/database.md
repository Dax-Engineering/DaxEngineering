# Database

## Symptoms

- `/healthz/deep` shows `database: down`, or pages time out.
- Coolify email: disk usage above 80%.
- Logs show `too many clients`, `could not extend file` or `No space left on device`.

## Confirm

```sh
df -h /
docker exec -it <postgres container> psql -U postgres -d dax
```

```sql
SELECT pg_size_pretty(pg_database_size('dax'));
SELECT usename, application_name, state, count(*)
  FROM pg_stat_activity GROUP BY 1, 2, 3 ORDER BY 4 DESC;
SELECT pid, now() - query_start AS running, left(query, 80)
  FROM pg_stat_activity WHERE state <> 'idle' ORDER BY running DESC LIMIT 10;
```

## Fix

- **Disk full:**
  1. `docker system prune -af` removes old images and build cache. It never touches volumes.
  2. `journalctl --vacuum-size=200M` trims the system logs.
  3. Check whether the write-ahead log is piling up because it can't reach R2:
     `SELECT * FROM pg_stat_archiver;` with a recent `last_failed_time`, and the PITR check red
     in Healthchecks.io. Fix the R2 token or bucket; Postgres then sends the backlog and frees
     the space. Past 4 GB pgBackRest drops the backlog so the disk survives, which breaks
     point-in-time recovery until the next base backup.
  4. Still tight: grow the VPS disk with the provider. Never delete files inside the Postgres
     volume by hand, `pg_wal` included.
- **Slow:** stop a runaway query from the list above with `SELECT pg_cancel_backend(<pid>);`.
  The app role has a 15 s statement timeout, so long queries usually come from a manual
  session. A page that is slow every time is a bug: note the request id and report it.
- **Too many connections:** many `idle in transaction` rows from `dax-api` mean the API is stuck.
  Restart `api` in Coolify.
- **Postgres won't start:** read its log. If the data files are damaged, restore into a fresh
  volume with point-in-time recovery ([restore.md](restore.md), section A) rather than
  repairing in place.

## Check

- `/healthz/deep` is `ok` again.
- `df -h /` is under 80%.
