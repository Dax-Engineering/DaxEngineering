# TLS and DNS

## Symptoms

- UptimeRobot email: the certificate expires soon, or the site is down with an SSL error.
- Browsers warn that the connection isn't private, or the name doesn't resolve.

## Confirm

```sh
dig +short stores.<domain>
curl -vI https://stores.<domain>/healthz 2>&1 | grep -E 'expire|subject|issuer'
```

The address must be the VPS. In Coolify, open the proxy logs and search for `acme`.

## Fix

- **DNS points elsewhere:** fix the `A` record at the DNS provider. If the name is proxied by
  Cloudflare, its SSL mode must be **Full (strict)**.
- **Certificate not renewing:** Let's Encrypt needs port 80 open to everyone. Check
  `ufw status`, then restart the proxy in Coolify (**Servers → Proxy → Restart**), which retries
  the renewal.
- **Rate-limited by Let's Encrypt** after many failures: fix the cause, wait out the window the
  error names, then restart the proxy.
- **Domain expired:** renew it with the registrar; DNS can take hours to return.

## Check

- `curl -I https://stores.<domain>/healthz` returns 200 and the certificate expires about 90
  days out.
- UptimeRobot shows every monitor up.
