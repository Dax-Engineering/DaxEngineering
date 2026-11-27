# Restore

Two independent backups exist. Use point-in-time recovery first; the nightly dump is the fallback.

|                | Point-in-time recovery (`pitr`)                          | Nightly dump (`backup`)                        |
| -------------- | -------------------------------------------------------- | ---------------------------------------------- |
| What           | Base backup daily plus every change, in `dax-<env>-pitr` | `pg_dump` at 01:30, in `dax-<env>-backups`     |
| Loses at most  | About 15 seconds                                         | About a day                                    |
| Can go back to | Any moment in the last two weeks or more                 | Each night: 14 daily, 8 weekly, 13 monthly     |
| Needs          | `PITR_CIPHER_PASS` and `DATA_ENCRYPTION_KEYS`            | The age private key and `DATA_ENCRYPTION_KEYS` |

All the secrets are in the password manager. Without `DATA_ENCRYPTION_KEYS`, Restricted fields
can't be read after either kind of restore.

## A. The server or its disk is lost

1. **Server.** If the old one is gone: a new VPS, Coolify, and the `dax` project as in
   `infra/coolify/README.md` sections 1 to 5. Paste the environment variables back from the
   password manager and point the DNS records at the new IP. Don't deploy yet.
2. **Restore on deploy.** Add `DAX_RESTORE=latest` to the environment's variables and deploy.
   The `postgres` container sees an empty volume, downloads the last base backup, replays every
   change that reached R2, then opens the database. Its log ends with
   `database system is ready to accept connections`. The other services start once it is
   healthy; migrations find nothing to do.
3. **Check** before telling anyone: sign in to the admin app, open the newest GRN and the newest
   issue, and compare their times with when the outage began.
4. **Remove `DAX_RESTORE`** from the variables. It only acts on an empty volume, but leaving it
   set invites a surprise later.
5. **Fresh base backup**, so the next restore doesn't replay across the gap:
   `docker exec <pitr container> dax-pgbackrest backup --type=full`.
6. **Tell the stores team** that anything saved in the last few seconds before the outage may be
   missing, and to check their last entry. Photos and signed documents live in R2 and are not
   affected.
7. Add the incident to `docs/incidents.md`.

If the server is fine but the database is damaged: stop the resource in Coolify, remove the
database volume (`docker volume ls | grep pgdata`, then `docker volume rm <name>`), and continue
from step 2.

Never deploy a new server with an empty volume and no `DAX_RESTORE`: Postgres would start a
brand-new empty database, and the PITR check fails because the repository belongs to the old one.

## B. Wrong data was saved or deleted

Restoring production to an earlier time would also throw away everything good saved since. Restore
a side copy as it was just before the mistake, then copy back only what was lost. Production keeps
running.

On the server, with the time in Colombo time and its `+05:30` offset:

```sh
docker exec <postgres container> env | grep '^PITR_' > /root/pitr.env
docker run -d --name dax-scratch --env-file /root/pitr.env   -e DAX_RESTORE='2026-11-26 10:42:00+05:30' -e DAX_RESTORE_SCRATCH=true   -e POSTGRES_PASSWORD=unused   <IMAGE_REGISTRY>/dax-postgres:<IMAGE_TAG>
docker logs -f dax-scratch        # wait for "ready to accept connections"
docker exec -it dax-scratch psql -U postgres dax
```

- `DAX_RESTORE_SCRATCH=true` turns archiving off in the copy, so it never writes into the
  production repository.
- Compare the rows with production and write the fixes as normal app actions where possible
  (an adjustment, a corrected document) so the ledger and audit stay complete. Change rows by
  hand only when there is no app action for it, and note it in `docs/incidents.md`.
- Clean up: `docker rm -f dax-scratch`, then `rm /root/pitr.env`.

## C. Restore a nightly dump

Only when point-in-time recovery can't be used (its bucket or passphrase is lost).
`restore.sh` in the `dax-backup` image downloads a dump, decrypts it and runs
`pg_restore --no-owner --role=dax_owner`. It needs both networks: the compose `egress` network to
reach R2 and the `backend` network to reach Postgres. On the server:

```sh
docker network ls                 # note the resource's <backend> and <egress> networks
docker create --name dax-restore -it --network <egress>   -e BACKUP_S3_ENDPOINT -e BACKUP_S3_BUCKET   -e BACKUP_S3_ACCESS_KEY_ID -e BACKUP_S3_SECRET_ACCESS_KEY   -v /root/restore-key.txt:/tmp/key.txt:ro   <IMAGE_REGISTRY>/dax-backup:<IMAGE_TAG>   restore.sh --key /tmp/key.txt     --target postgresql://dax_migrator:<password>@postgres:5432/dax_restore
docker network connect <backend> dax-restore
docker start -ai dax-restore
docker rm dax-restore
```

- Export the four `BACKUP_S3_*` values in the shell first (copy them from Coolify).
- Without `--dump` it restores the newest daily dump; `--dump weekly/dax-<...>.dump.age` picks
  another.
- It refuses a database that already has tables. `--force` drops and replaces them.
- Delete the key file from the server when done.

To replace production: stop `api`, `worker`, `backup` and `pitr`; create `dax_restore` (owner
`dax_owner`) and restore into it; check it; then, as `postgres`, rename `dax` to `dax_old` and
`dax_restore` to `dax`, and start the services again. Take a fresh full PITR backup afterwards. If
files were lost too, copy `files/` from the backup bucket back into the files bucket with
`rclone copy`.

## Restore drill

Before go-live, then on the first working day of every third month. It proves that the backups
and the keys work, and how long a restore takes.

**Point-in-time recovery**, on the staging server (it has Docker): run section B with production's
`PITR_*` values in the env file and a time from earlier that day. Open a GRN saved shortly before
that time and check that one saved shortly after is missing. Record it below, then clean up.

**Nightly dump**, on the PC:

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
