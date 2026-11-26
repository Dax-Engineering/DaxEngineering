# Secret rotation

Rotate a secret when it may have leaked, when someone with access leaves, and once a year.
Generate new values with `openssl rand -hex 32`. Change one secret at a time, redeploy, check,
then move to the next.

| Secret                                                             | How                                                                                                                                                  | Side effect                                      |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `BETTER_AUTH_SECRET`                                               | New value in Coolify, redeploy                                                                                                                       | Everyone is signed out                           |
| `INTERNAL_TOKEN_WEB`, `INTERNAL_TOKEN_ADMIN`                       | New value in Coolify, redeploy (api, web and admin restart together)                                                                                 | A few seconds of errors during the restart       |
| `DAX_APP_PASSWORD`, `DAX_MIGRATOR_PASSWORD`, `DAX_BACKUP_PASSWORD` | As `postgres`: `ALTER ROLE <role> PASSWORD '<new>';`, then the same value in Coolify, redeploy                                                       | Errors between the two steps                     |
| `RESEND_API_KEY`                                                   | New send-only key in Resend, update Coolify, redeploy, delete the old key                                                                            | None                                             |
| `S3_*`, `BACKUP_S3_*`, `FILES_READ_*`                              | New R2 token with the same scope, update Coolify, redeploy, delete the old token                                                                     | None                                             |
| `DATA_ENCRYPTION_KEYS`                                             | Add `k2:<new>` to the ring, set `DATA_ENCRYPTION_ACTIVE_KEY=k2`, redeploy, re-encrypt old values (`rotateEncryptedColumns`), remove `k1` when unused | Keep every retired key offline for old backups   |
| `BACKUP_AGE_RECIPIENT`                                             | `age-keygen -o key.txt` on the PC, put the new public key in Coolify, redeploy, store the private key in the password manager                        | Keep old private keys until their backups expire |
| `SENTRY_DSN`, `SENTRY_DSN_WEB`, `SENTRY_DSN_ADMIN`                 | Revoke the client key in the Sentry project, create a new one, update Coolify, redeploy                                                              | None                                             |
| `BACKUP_PING_URL`                                                  | Regenerate the check's ping URL in Healthchecks.io, update Coolify, redeploy                                                                         | None                                             |
| GitHub secret `COOLIFY_TOKEN`                                      | New API token in Coolify, update the GitHub environment secret, delete the old token                                                                 | None                                             |

## After a leak

1. Rotate the leaked secret first. Then look for misuse: Sentry, the Coolify logs, the admin
   app's audit log, and R2 and Resend activity.
2. If it was committed to git, rotating is the fix. Rewriting history doesn't help once it was
   pushed.
3. Write it up with the [postmortem template](../postmortem-template.md).
