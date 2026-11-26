# DAX Engineering

Stores and inventory system for DAX Engineering, built to grow module by module into the
full business system (sales, costing, purchasing, workshop, accounts).

- **Phase 1:** Stores / Inventory: items, bins, QR labels, receiving (GRN), issuing (MRN → AOD),
  holds, returns, stock counts and the warranty bin. Quantities, plus a pre-costing and selling
  price per item.
- **Later:** each department's module plugs in without changing inventory code.

See [docs/architecture.md](docs/architecture.md) for the design.

## Layout

```
apps/
  api/      NestJS API (private: only the Next.js apps call it)
  web/      Staff app (Next.js, mobile-friendly for phone scanning)
  admin/    Admin panel (Next.js, separate subdomain)
libs/
  shared/        contracts (module manifests, Zod primitives), util, ui
  platform/      db (Prisma), core (auth, access control, audit...), contract
  web-platform/  data-access (server-only API client), shell
  parties/       customers and suppliers module
  inventory/     stores and inventory module
infra/           Postgres roles, Dockerfiles, Coolify compose
tools/scripts/   prisma-lint, copy-lint, native Postgres/MinIO helpers
```

## Getting started

Requirements: Node 24, pnpm 11, PostgreSQL 18 installed on your PC. No Docker needed.

```sh
pnpm install
cp .env.example .env        # local development values only
pnpm db:native:setup        # once: DAX roles and databases (asks for the postgres password)
pnpm db:deploy              # migrations
pnpm db:up                  # checks Postgres is reachable on localhost:5432
pnpm files:up               # file uploads: downloads + starts MinIO on 127.0.0.1:39000 (files:down, files:status)
pnpm dev:api                # http://127.0.0.1:3100/api/health/ready
pnpm dev:web                # http://localhost:4200
pnpm dev:admin              # http://localhost:4300
pnpm dev:phone              # everything, plus an https tunnel so a phone can scan (PC: "Scan with phone")
```

Run all checks (same as CI): `pnpm check`

## Deployment

Contabo VPS running Coolify, with separate staging and production environments. Pushing to `main`
builds images and deploys staging; production deploys are manual and need approval.
See [infra/coolify/README.md](infra/coolify/README.md).
