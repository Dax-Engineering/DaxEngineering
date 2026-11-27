# Deploying on Coolify

One VPS runs Coolify with two environments of the `dax` project, both from
`infra/coolify/compose.yml`: `staging` and `production`. They share nothing: separate databases,
volumes, secrets and R2 buckets. Staging only ever holds fake data.

The server never builds anything. GitHub Actions builds six images (`dax-postgres`,
`dax-migrate`, `dax-api`, `dax-web`, `dax-admin`, `dax-backup`), pushes them to GHCR, then asks
Coolify to deploy. `dax-postgres` is `postgres:18-alpine` with `infra/postgres/initdb` baked in;
`dax-backup` is built from `infra/backup`.

## 1. Server setup (once)

1. A fresh Ubuntu 24.04 VPS with **8 GB RAM**, SSH keys only and no root password login. The
   compose file caps each container (`mem_limit`, `cpus`); together the caps come to about
   4.2 GB per environment, so 8 GB holds staging and production with room for Coolify. On a
   4 GB server, lower the caps in `infra/coolify/compose.yml` (for example halve `postgres`
   and `api`) and run only one environment there.
2. Install Coolify with the official script from coolify.io (`curl -fsSL https://cdn.coollabs.io/coolify/install.sh | sudo bash`).
3. Firewall (`ufw`):
   - 80 and 443 open to everyone.
   - 22 from allowlisted IPs only.
   - 8000 (the Coolify dashboard before it has a domain) from allowlisted IPs only. Close it once
     the dashboard has its own domain.
4. In Coolify settings, give the dashboard its own domain (HTTPS), create the admin account and
   turn on 2FA.
5. `unattended-upgrades` enabled.
6. Let the server pull the private images: create a GitHub token with **read:packages** only and
   run `docker login ghcr.io -u <github-user>` on the server with it.

## 2. Project and resources

1. Create a project `dax` with two environments, `staging` and `production`.
2. In each environment add a **Docker Compose** resource from this GitHub repository (through
   the Coolify GitHub App), branch `main`, compose file `/infra/coolify/compose.yml`.
3. **Turn off automatic deployment on push.** CI starts each deploy once its images exist, so a
   push must not race ahead of the build.

## 3. Environment variables (set per environment in Coolify)

Coolify lists every `${VAR:?…}` in the compose file as a required variable.

| Variable                       | Notes                                                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `IMAGE_REGISTRY`               | e.g. `ghcr.io/<github-org>`                                                                                                           |
| `IMAGE_TAG`                    | `staging` or `production` (CI moves these tags; every image also has an immutable SHA tag for rollback)                               |
| `POSTGRES_SUPERUSER_PASSWORD`  | Only used by Postgres itself. Long random value                                                                                       |
| `DAX_MIGRATOR_PASSWORD`        | Migration role                                                                                                                        |
| `DAX_APP_PASSWORD`             | Runtime app role                                                                                                                      |
| `DAX_BACKUP_PASSWORD`          | Read-only backup role                                                                                                                 |
| `LOG_LEVEL`                    | `info` (default)                                                                                                                      |
| `BETTER_AUTH_SECRET`           | Signs session cookies. Long random value; changing it signs everyone out                                                              |
| `INTERNAL_TOKEN_WEB`           | Shared by `api` and `web`. Must differ from the admin token                                                                           |
| `INTERNAL_TOKEN_ADMIN`         | Shared by `api` and `admin`                                                                                                           |
| `WEB_ORIGIN`                   | e.g. `https://stores.<domain>` (no trailing slash)                                                                                    |
| `ADMIN_ORIGIN`                 | e.g. `https://admin.<domain>`                                                                                                         |
| `RESEND_API_KEY`               | Resend key with send-only permission                                                                                                  |
| `MAIL_FROM`                    | e.g. `DAX <no-reply@<domain>>`; the domain must be verified in Resend                                                                 |
| `BOOTSTRAP_ADMIN_*`            | `NAME`, `USERNAME`, `EMAIL`, `PASSWORD`. Set for the first deploy only, then delete them                                              |
| `DATA_ENCRYPTION_KEYS`         | Key ring for Restricted columns: `k1:<base64 32 bytes>`, comma-separated when rotating. Back it up offline; losing it loses that data |
| `DATA_ENCRYPTION_ACTIVE_KEY`   | Id of the key new values are encrypted with, e.g. `k1`                                                                                |
| `S3_ENDPOINT`                  | Cloudflare R2: `https://<account-id>.r2.cloudflarestorage.com` (no bucket in the URL)                                                 |
| `S3_BUCKET`                    | Private R2 bucket for this environment only, e.g. `dax-staging-files` or `dax-prod-files`. No public access                           |
| `S3_ACCESS_KEY_ID`             | R2 API token scoped to that one bucket with **Object Read & Write** only (no admin, no other buckets)                                 |
| `S3_SECRET_ACCESS_KEY`         | Secret for the same R2 token                                                                                                          |
| `S3_REGION`                    | `auto` (default) for R2                                                                                                               |
| `BACKUP_AGE_RECIPIENT`         | Public key (`age1...`) the backups are encrypted with. See section 7                                                                  |
| `BACKUP_S3_BUCKET`             | Backup bucket for this environment, e.g. `dax-prod-backups`. Same R2 account as `S3_ENDPOINT`                                         |
| `BACKUP_S3_ACCESS_KEY_ID`      | R2 token scoped to the backup bucket with **Object Read & Write**                                                                     |
| `BACKUP_S3_SECRET_ACCESS_KEY`  | Secret for the same token                                                                                                             |
| `FILES_READ_ACCESS_KEY_ID`     | Second R2 token on the files bucket with **Object Read** only, used to copy files into the backup                                     |
| `FILES_READ_SECRET_ACCESS_KEY` | Secret for the same token                                                                                                             |
| `BACKUP_PING_URL`              | The Healthchecks.io ping URL for this environment's backup check                                                                      |
| `BACKUP_AT`                    | Optional. Daily backup time, `HH:MM` Colombo time (default `01:30`)                                                                   |
| `PITR_S3_BUCKET`               | Point-in-time recovery bucket for this environment, e.g. `dax-prod-pitr`. Not the backup bucket. See section 7                        |
| `PITR_S3_ACCESS_KEY_ID`        | R2 token scoped to the PITR bucket with **Object Read & Write**                                                                       |
| `PITR_S3_SECRET_ACCESS_KEY`    | Secret for the same token                                                                                                             |
| `PITR_CIPHER_PASS`             | Encrypts everything in the PITR bucket. Long random value; store it offline too, without it nothing can be restored                   |
| `PITR_PING_URL`                | The Healthchecks.io ping URL for this environment's PITR check                                                                        |
| `PITR_BACKUP_AT`               | Optional. Daily base backup time, `HH:MM` Colombo time (default `02:30`)                                                              |
| `DAX_RESTORE`                  | Never set in normal running. Only during a restore: see `docs/runbooks/restore.md`                                                    |
| `SENTRY_DSN`                   | Optional. DSN of the Sentry project for `api` and `worker`. Unset sends nothing                                                       |
| `SENTRY_DSN_WEB`               | Optional. DSN of the Sentry project for the stores app                                                                                |
| `SENTRY_DSN_ADMIN`             | Optional. DSN of the Sentry project for the admin app                                                                                 |
| `SENTRY_ENVIRONMENT`           | Optional. `staging` or `production`, shown on every error                                                                             |

Generate each password, secret and token with `openssl rand -hex 32`. Hex keeps them safe inside connection URLs.

## 4. Domains

In the resource, give a domain to the `web` service (port 3000) and to the `admin` service
(port 3000), e.g. `https://stores.<domain>:3000`. Coolify routes them through its Traefik proxy
and gets the certificates. Never give a domain to `api`, `worker`, `migrate` or `postgres`: they
stay on the internal `backend` network.

For staging, let only the office and developers in. Add these labels to the staging `web` and
`admin` services (Coolify: the service's custom labels), with your own IPs:

```
traefik.http.middlewares.dax-staging-allow.ipallowlist.sourcerange=203.0.113.10/32,198.51.100.0/24
traefik.http.routers.<router-name>.middlewares=dax-staging-allow
```

Use the router name Coolify generated for that service (shown in its labels), and keep any
middlewares Coolify already lists there, comma-separated.

In both environments, also rate-limit each client at the edge (on `web` and `admin`). The API
has its own per-client limits on top (1,000 requests a minute, lower for pairing, PDFs and
imports):

```
traefik.http.middlewares.dax-ratelimit.ratelimit.average=50
traefik.http.middlewares.dax-ratelimit.ratelimit.burst=100
traefik.http.routers.<router-name>.middlewares=dax-ratelimit
```

On staging, list both middlewares: `...middlewares=dax-staging-allow,dax-ratelimit`.

## 5. Deploys from GitHub

1. In Coolify, **Keys & Tokens → API tokens**: create a token with the deploy permission.
2. Copy each environment's resource UUID (in the resource's URL or its webhook settings).
3. In GitHub, **Settings → Environments**, create `staging` and `production`, each with:
   - variable `COOLIFY_URL`: the dashboard address, e.g. `https://coolify.<domain>`
   - secret `COOLIFY_TOKEN`: the API token
   - secret `COOLIFY_RESOURCE_UUID`: that environment's resource UUID

   Add required reviewers to `production` so a production deploy needs a second person.

Pushing to `main` builds the images, tags them `staging` and deploys staging. Run the **Deploy**
workflow by hand and pick `production` to release.

GitHub's runners call the dashboard's API, so the dashboard domain can't sit behind an IP
allowlist. It is protected by the token, the admin account's 2FA and HTTPS. Putting Cloudflare
Access in front of it is a later step.

**Rollback:** set `IMAGE_TAG` to the previous commit's SHA in Coolify and redeploy. Migrations
only move forward, so roll back code only when the schema still fits it.

## 6. First deploy

1. Set the `BOOTSTRAP_ADMIN_*` variables and deploy. The API creates the first super admin
   only when the database has no users.
2. Sign in to the admin app with that account. It must choose a new password and set up
   two-step sign-in before anything else.
3. Delete the four `BOOTSTRAP_ADMIN_*` variables from Coolify and redeploy. The API logs a
   warning while they are still set.

## 7. Backups

The `backup` service dumps the database every night at `BACKUP_AT`, encrypts it with age and
uploads it to R2, then copies new uploaded files. It pings Healthchecks.io on success and on
failure. Restores and the restore drill: `docs/runbooks/restore.md`.

1. **Keys**, on your PC: `age-keygen -o dax-<env>-backup.key`. The file holds the private key;
   its `# public key: age1...` line is the public key.
   - Put only the public key in Coolify (`BACKUP_AGE_RECIPIENT`).
   - Store the private key file and `DATA_ENCRYPTION_KEYS` in the password manager, then delete
     the file from the PC. A backup is useless without both.
2. **Bucket**, in Cloudflare R2: one per environment, e.g. `dax-prod-backups`, private.
   - Lifecycle rules: delete prefix `incoming/` after 1 day, `daily/` after 14 days, `weekly/`
     after 60 days, `monthly/` after 400 days.
   - Bucket lock rules: 14 days on prefixes `daily/`, `weekly/` and `monthly/`, so a stolen
     token can't delete recent backups. Don't lock `incoming/`: the job removes its upload from
     there once the dump is checked.
3. **Tokens**: one with Object Read & Write on the backup bucket only (`BACKUP_S3_*`), and one
   with Object Read on the files bucket only (`FILES_READ_*`).
4. Deploy, then check the next morning that `daily/` has a dump and Healthchecks.io is green.
   To test at once, run `backup.sh` in the `backup` container from Coolify's terminal.

### Point-in-time recovery

The nightly dump can lose up to a day. Point-in-time recovery cuts that to about 15 seconds:

- Postgres sends its write-ahead log (every committed change) to the PITR bucket with
  pgBackRest, at most 15 seconds after a change and only when something changed.
- The `pitr` service takes a base backup every day at `PITR_BACKUP_AT`: full on Sundays,
  differential on other days. It keeps the last three full backups and the log since the oldest.
- Everything in the bucket is compressed and encrypted with `PITR_CIPHER_PASS`.
- A restore replays the log to the latest change, or to any moment since the oldest full backup (two weeks or more).

Setup, per environment:

1. **Bucket**: `dax-<env>-pitr`, private. No lifecycle rules and no bucket lock: pgBackRest
   rewrites its index files and removes expired backups itself.
2. **Token**: Object Read & Write on that bucket only (`PITR_S3_*`).
3. **Passphrase**: `openssl rand -hex 32` into `PITR_CIPHER_PASS`, and into the password manager.
4. **Check**: Healthchecks.io, period 10 minutes, grace 30 minutes, ping URL in `PITR_PING_URL`.
   The `pitr` service pings every 5 minutes, and pings `/fail` with the reason when the log
   can't reach R2, a daily backup fails or the last backup is over 26 hours old.
5. Deploy. The `pitr` service creates the repository and takes the first full backup at once;
   `docker logs` on it shows `Backup finished`.

The nightly dump stays: it is a second, independent copy in a different format.

## 8. Monitoring and alerts

All free plans; every alert goes by email to the shared on-call mailbox
(`docs/runbooks/README.md`).

**Sentry** (Developer plan, 5k errors a month):

1. Create three projects: `dax-api` (Node.js, also used by the worker), `dax-web` and
   `dax-admin` (Next.js). Copy each DSN into `SENTRY_DSN`, `SENTRY_DSN_WEB`, `SENTRY_DSN_ADMIN`
   and set `SENTRY_ENVIRONMENT`. One set of projects serves both environments.
2. In each project's **Security & Privacy** settings, turn on **Prevent Storing of IP
   Addresses** and leave **Data Scrubber** on. The apps already strip bodies, cookies, headers,
   query strings and personal details before sending; only the user id and a `request_id` tag
   remain.
3. Alerts: the default "new issue" email rule is enough. Tracing stays off to keep the quota for
   errors.

Browsers send their errors to `/monitoring` on the same site, which forwards them to Sentry, so
the page CSP stays `'self'`.

**UptimeRobot** (5-minute checks):

1. HTTP(S) monitor `https://stores.<domain>/healthz/deep`. It returns 503 when the API, the
   database, the worker heartbeat or the outbox is unhealthy.
2. HTTP(S) monitor `https://admin.<domain>/healthz`.
3. SSL expiry reminders are a paid UptimeRobot feature. Coolify renews certificates itself, and
   both checks fail if HTTPS breaks.

**Healthchecks.io**: two checks per environment:

- Nightly backup: period 1 day, grace 2 hours, ping URL `BACKUP_PING_URL`.
- Point-in-time recovery: period 10 minutes, grace 30 minutes, ping URL `PITR_PING_URL`.

**Coolify notifications** (**Notifications → Email**, through a separate send-only Resend key):
turn on container stopped or unhealthy, deployment failed, and server disk usage above 80%
(**Servers → your server → Disk usage notification**).
