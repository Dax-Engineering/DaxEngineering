# Deploying on Coolify

One VPS runs Coolify with two environments of the `dax` project, both from
`infra/coolify/compose.yml`: `staging` and `production`. They share nothing: separate databases,
volumes, secrets and R2 buckets. Staging only ever holds fake data.

The server never builds anything. GitHub Actions builds five images (`dax-postgres`,
`dax-migrate`, `dax-api`, `dax-web`, `dax-admin`), pushes them to GHCR, then asks Coolify to
deploy. `dax-postgres` is `postgres:18-alpine` with `infra/postgres/initdb` baked in.

## 1. Server setup (once)

1. A fresh Ubuntu 24.04 VPS (4 GB RAM or more), with SSH keys only and no root password login.
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

| Variable                      | Notes                                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `IMAGE_REGISTRY`              | e.g. `ghcr.io/<github-org>`                                                                                                           |
| `IMAGE_TAG`                   | `staging` or `production` (CI moves these tags; every image also has an immutable SHA tag for rollback)                               |
| `POSTGRES_SUPERUSER_PASSWORD` | Only used by Postgres itself. Long random value                                                                                       |
| `DAX_MIGRATOR_PASSWORD`       | Migration role                                                                                                                        |
| `DAX_APP_PASSWORD`            | Runtime app role                                                                                                                      |
| `DAX_BACKUP_PASSWORD`         | Read-only backup role                                                                                                                 |
| `LOG_LEVEL`                   | `info` (default)                                                                                                                      |
| `BETTER_AUTH_SECRET`          | Signs session cookies. Long random value; changing it signs everyone out                                                              |
| `INTERNAL_TOKEN_WEB`          | Shared by `api` and `web`. Must differ from the admin token                                                                           |
| `INTERNAL_TOKEN_ADMIN`        | Shared by `api` and `admin`                                                                                                           |
| `WEB_ORIGIN`                  | e.g. `https://stores.<domain>` (no trailing slash)                                                                                    |
| `ADMIN_ORIGIN`                | e.g. `https://admin.<domain>`                                                                                                         |
| `RESEND_API_KEY`              | Resend key with send-only permission                                                                                                  |
| `MAIL_FROM`                   | e.g. `DAX <no-reply@<domain>>`; the domain must be verified in Resend                                                                 |
| `BOOTSTRAP_ADMIN_*`           | `NAME`, `USERNAME`, `EMAIL`, `PASSWORD`. Set for the first deploy only, then delete them                                              |
| `DATA_ENCRYPTION_KEYS`        | Key ring for Restricted columns: `k1:<base64 32 bytes>`, comma-separated when rotating. Back it up offline; losing it loses that data |
| `DATA_ENCRYPTION_ACTIVE_KEY`  | Id of the key new values are encrypted with, e.g. `k1`                                                                                |
| `S3_ENDPOINT`                 | Cloudflare R2: `https://<account-id>.r2.cloudflarestorage.com` (no bucket in the URL)                                                 |
| `S3_BUCKET`                   | Private R2 bucket for this environment only, e.g. `dax-staging-files` or `dax-prod-files`. No public access                           |
| `S3_ACCESS_KEY_ID`            | R2 API token scoped to that one bucket with **Object Read & Write** only (no admin, no other buckets)                                 |
| `S3_SECRET_ACCESS_KEY`        | Secret for the same R2 token                                                                                                          |
| `S3_REGION`                   | `auto` (default) for R2                                                                                                               |

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

## Still to come

Encrypted nightly backups to R2 arrive in the go-live milestone (`infra/backup`). Until then,
back up `DATA_ENCRYPTION_KEYS` offline.
