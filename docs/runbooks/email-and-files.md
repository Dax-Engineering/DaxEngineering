# Email and files

Emails go out through Resend. Photos, signed AODs and other uploads live in the environment's
R2 bucket.

## Symptoms

- Password-reset or alert emails don't arrive; outbox events fail with Resend errors.
- Uploads fail, or attachments don't open; `api` logs show storage errors (`AccessDenied`,
  `NoSuchBucket`, timeouts).

## Confirm

1. Check the Resend and Cloudflare status pages.
2. Resend dashboard, **Logs**: was the email accepted, bounced or rejected? Is the sending domain
   still verified?
3. Cloudflare dashboard, **R2**: does the bucket exist and is its API token still active?
4. The `api` and `worker` logs show the exact error.

## Fix

- **Resend key revoked or expired:** create a new send-only key, set `RESEND_API_KEY` in Coolify,
  redeploy, then requeue the failed events ([outbox-worker.md](outbox-worker.md)).
- **Sending domain unverified:** re-add the DNS records Resend lists and wait for verification.
- **R2 token revoked or expired:** create a token scoped to the files bucket with Object Read &
  Write, set `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`, redeploy.
- **Provider outage:** nothing to fix here. Tell users that emails and uploads are delayed; the
  outbox keeps retrying emails for several hours by itself.

## Check

- Request a password reset for your own account and receive it.
- Upload a photo on a GRN line and open it again.
