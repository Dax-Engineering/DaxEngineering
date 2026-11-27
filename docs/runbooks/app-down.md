# App down

## Symptoms

- UptimeRobot email: `stores.<domain>/healthz/deep` or `admin.<domain>/healthz` is down.
- Users see "Can't load this page", or the browser can't connect.

## Confirm

1. Open `https://stores.<domain>/healthz/deep`. The JSON names the failing check:
   - `database: down`: see [database.md](database.md).
   - `worker: down`: no worker heartbeat for 2 minutes. See [outbox-worker.md](outbox-worker.md).
   - `outbox: down`: failed or stuck events. See [outbox-worker.md](outbox-worker.md).
   - `api: down`, a 503 without checks, or a timeout: the API itself is down. Carry on below.
2. In Coolify, see which services are stopped, restarting or unhealthy.
3. Read the failing service's last log lines in Coolify.

## Fix

- **A container keeps restarting:** the last log lines say why. `Invalid API environment: X`
  means variable `X` is missing or wrong in Coolify. Fix it and redeploy.
- **Out of memory** (`docker inspect <container> --format '{{.State.OOMKilled}}'` is `true`):
  raise that service's `mem_limit` in `infra/coolify/compose.yml` if the server has room;
  otherwise look in Sentry for what grew first.
- **It started right after a deploy:** see [bad-deploy.md](bad-deploy.md).
- **Server unreachable:** restart it from the VPS provider's panel. Coolify and the containers
  start again by themselves.
- **Only one site down:** restart that one service from Coolify.

## Check

- `/healthz/deep` returns `{"status":"ok", ...}` and UptimeRobot sends the "up" email.
- Sign in to the stores app and open a stock page.
