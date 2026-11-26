# Restore

The `backup` service runs every night at 01:30 Colombo time:

- The database dump (`pg_dump -Fc`, as the read-only `dax_backup` role) is encrypted with the
  backup age public key and uploaded as `daily/dax-<YYYYMMDD-HHMM>.dump.age`. Sundays are also
  copied to `weekly/`, the 1st of the month to `monthly/`.
- Uploaded files are copied to `files/` in the backup bucket. Copied, never synced, so files
  deleted in the app stay in the backup.
- Healthchecks.io gets a ping on success and a `/fail` ping with the failed step otherwise.

A restore needs **both** offline secrets from the password manager: the age private key and the
environment's `DATA_ENCRYPTION_KEYS`. Without the second, Restricted fields can't be read.

## Restore into a database

`restore.sh` in the `dax-backup` image downloads a dump, decrypts it and runs
`pg_restore --no-owner --role=dax_owner`. On the server:

```sh
docker run --rm -it --network <the compose backend network> \
  -e BACKUP_S3_ENDPOINT -e BACKUP_S3_BUCKET \
  -e BACKUP_S3_ACCESS_KEY_ID -e BACKUP_S3_SECRET_ACCESS_KEY \
  -v /root/restore-key.txt:/tmp/key.txt:ro \
  <IMAGE_REGISTRY>/dax-backup:<IMAGE_TAG> \
  restore.sh --key /tmp/key.txt \
    --target postgresql://dax_migrator:<password>@postgres:5432/dax_restore
```

- Export the four `BACKUP_S3_*` values in the shell first (copy them from Coolify).
- Without `--dump` it restores the newest daily dump; `--dump weekly/dax-<...>.dump.age` picks
  another.
- It refuses a database that already has tables. `--force` drops and replaces them.
- Delete the key file from the server when done.

To replace production: stop `api`, `worker` and `backup`; create `dax_restore` (owner
`dax_owner`) and restore into it; check it; then, as `postgres`, rename `dax` to `dax_old` and
`dax_restore` to `dax`, and start the services again. If files were lost too, copy `files/`
from the backup bucket back into the files bucket with `rclone copy`.

## Monthly restore drill

On the first working day of each month. It proves that the backups and both keys work.

1. With the PC's Postgres 18 running, create a scratch database:
   `psql -U postgres -c "CREATE DATABASE dax_drill OWNER dax_owner"`.
2. Restore the newest production dump into it. Either run the image as above with
   `--target postgresql://dax_migrator:<local password>@host.docker.internal:5432/dax_drill`,
   or by hand: `rclone cat` the dump, pipe it through `age -d -i key.txt`, then
   `pg_restore --no-owner --role=dax_owner -d dax_drill`.
3. Point a local API at it: in `.env`, set `DATABASE_URL` to `dax_drill` (as `dax_app`) and
   `DATA_ENCRYPTION_KEYS` / `DATA_ENCRYPTION_ACTIVE_KEY` to the production values. Run `pnpm dev`.
4. Sign in, open a recent GRN, and open a customer to check that Restricted fields decrypt.
5. Record the date, the dump name and how long the restore took in the table below.
6. Put `.env` back, drop `dax_drill`, and delete the key and dump from the PC.

| Date | Dump | Restore time | Notes |
| ---- | ---- | ------------ | ----- |
|      |      |              |       |
