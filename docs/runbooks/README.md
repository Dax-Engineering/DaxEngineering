# Runbooks

One page per kind of incident. Each page has the same four parts: symptoms, confirm, fix, check.

| Page                                     | Use it when                                                     |
| ---------------------------------------- | --------------------------------------------------------------- |
| [app-down.md](app-down.md)               | The stores or admin site doesn't load, or `/healthz/deep` fails |
| [database.md](database.md)               | Disk full, slow pages, too many connections                     |
| [outbox-worker.md](outbox-worker.md)     | Emails or inbox messages stop, events marked failed             |
| [email-and-files.md](email-and-files.md) | Resend or R2 errors: no emails, uploads or PDFs fail            |
| [bad-deploy.md](bad-deploy.md)           | Things broke right after a deploy                               |
| [tls-dns.md](tls-dns.md)                 | Certificate warnings, the domain doesn't resolve                |
| [restore.md](restore.md)                 | Restoring a backup, and the monthly restore drill               |
| [secret-rotation.md](secret-rotation.md) | A secret leaked, someone left, or a yearly rotation             |

After any incident users noticed, write it up with the
[postmortem template](../postmortem-template.md) within a week.

## On call

- One named developer is on call each week. Keep the rota in the team calendar and hand over on
  Monday morning.
- Every alert arrives by email: UptimeRobot (site down, certificate expiry), Healthchecks.io
  (backup missed or failed), Coolify (container stopped or unhealthy, deploy failed, disk above
  80%) and Sentry (new errors). Send them all to a shared mailbox the on-call person watches.
- Escalate to the IT lead if it isn't fixed within an hour, or straight away if data may be lost
  or exposed. Tell the Stores Manager what users should do in the meantime.

## Where things are

- Coolify: each environment's `dax` resource, with logs per service.
- Server shell: `docker ps`, `docker logs --tail 200 <container>`. Container names start with
  the service name (`api-`, `worker-`, `postgres-`, ...).
- Database shell: `docker exec -it <postgres container> psql -U postgres -d dax`.
- Errors: the environment's Sentry project. Every event has a `request_id` tag; search the
  Coolify logs for the same id to see the whole request.
