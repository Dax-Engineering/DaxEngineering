# Outbox and worker

The worker delivers events from `core.outbox_event`: emails, inbox messages, low-stock alerts.
A failing event is retried with back-off and marked `FAILED` after 10 attempts, or at once if
its payload is invalid. Each `FAILED` event also reaches Sentry as "Event delivery failed for
good", tagged with the event name.

## Symptoms

- `/healthz/deep` shows `worker: down` (no heartbeat for 2 minutes) or `outbox: down` (a
  `FAILED` event, or a `PENDING` one older than 15 minutes).
- Users don't get password-reset emails or inbox messages.

## Confirm

```sql
SELECT last_run_at, now() - last_run_at AS age
  FROM core.job_run WHERE name = 'worker.heartbeat';

SELECT status, name, count(*), min(created_at)
  FROM core.outbox_event WHERE status <> 'DONE' GROUP BY 1, 2 ORDER BY 1, 2;

SELECT id, name, attempts, available_at, last_error
  FROM core.outbox_event WHERE status = 'FAILED' ORDER BY created_at DESC LIMIT 20;
```

## Fix

- **Worker not running:** restart `worker` in Coolify and read its log.
- **Failed events:** read `last_error`.
  1. A provider outage (Resend, R2): fix that first, see [email-and-files.md](email-and-files.md).
  2. A code bug: deploy the fix first.
  3. Requeue. Handlers that already succeeded are skipped (`core.processed_event`), so a
     requeue never delivers twice:

     ```sql
     UPDATE core.outbox_event
        SET status = 'PENDING', attempts = 0, available_at = now(), last_error = NULL
      WHERE status = 'FAILED' AND id IN ('<id>', '<id>');
     ```

  4. An event that must never be delivered (for example, the user was removed): leave it
     `FAILED` and record it in the incident notes. Never delete outbox rows.
- **Old `PENDING` events:** they wait for their next retry (`available_at` in the future). Fix the
  cause; to retry straight away, set `available_at = now()` for those ids.

## Check

- The queries show no `FAILED` rows and no `PENDING` rows older than a few minutes.
- `/healthz/deep` is `ok`.
