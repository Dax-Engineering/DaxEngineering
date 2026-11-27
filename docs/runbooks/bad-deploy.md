# Bad deploy

## Symptoms

- Errors or a failing health check start right after a deploy.
- Coolify email: deployment failed.

## Confirm

1. GitHub, **Actions → Deploy**: which commit went out, and when.
2. Sentry: are the new errors on the new release? The release is the image tag in use.
3. Coolify: did `migrate` finish? Its log lists the migrations it applied.

## Fix

Roll back by pinning the previous images:

1. Find the last good commit SHA in the Deploy workflow history.
2. In Coolify, set `IMAGE_TAG` to that full SHA and redeploy. Every image is pushed with its SHA
   tag, so nothing is rebuilt.
3. Once a fix is deployed, set `IMAGE_TAG` back to `staging` or `production`.

Migrations only move forward. If the bad deploy ran a migration:

- If it only added things (tables, nullable columns), the old code still works. Roll back as
  above.
- If it renamed, dropped or changed something the old code uses, don't roll back. Fix forward
  with a new commit. Restoring the database ([restore.md](restore.md)) is the last resort: it
  loses everything written since the backup.

## Check

- Sentry shows no new events from the bad release.
- `/healthz/deep` is `ok`; sign in and do one normal task.
