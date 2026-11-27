# Architecture

DAX Engineering's system covers parts sales, costing, import and local purchasing, stores,
workshop, warranty and accounts. It is built one module at a time. **Phase 1 is Stores /
Inventory only**. The only money data is a pre-costing and a selling price per item, as plain
item fields (QuickBooks stays the money book). Every later module
plugs in without changing inventory code.

Three goals drive the design:

1. **Lego modules.** A module is a set of libraries with a public contract. Modules only talk
   through contracts, ports and events.
2. **An admin-controlled Access Control Matrix.** Module → feature → action permissions, with row
   scopes and per-field read/write grants, all editable in the admin panel.
3. **Data sensitivity at the root.** The API only queries and sends the fields a user may see.
   Restricted data is encrypted and every read of it is audited.

## Decisions

| Area             | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stack            | Nx + pnpm · Next.js 16 (`web`, `admin`) · NestJS 11 (`api`) · Postgres 18 · Prisma 7 · Mantine · Zod 4                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Hosting          | Contabo VPS · Coolify (Traefik TLS) · staging and production stacks · GitHub Actions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Auth             | Better Auth inside NestJS, login only · sign in with username or email · optional TOTP 2FA, mandatory for super admins · no self sign-up                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Passwords        | 12+ characters, no breach-list check · reset by email link (Resend), every account has an email · 5 failed sign-ins lock the account for 15 minutes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| First admin      | Created on first boot from `BOOTSTRAP_ADMIN_*` env vars when no users exist; must change the password and set up 2FA at first sign-in                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| API path         | Next.js is the gateway: the browser talks only to Next.js; the API is on a private network                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Authorization    | Own ACM · many roles per user + per-user allow/deny overrides (deny wins) · scope per grant: Own / Department / All (store list ready for later)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Field visibility | Per-field read/write grants · hidden fields never selected or sent · tiers: Internal / Confidential / Restricted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Super admin      | Sees everything; Restricted reads still audited · only super admins assign the Super Admin role or edit super admin accounts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Admin access     | Permission-based (`core.admin.access` + `core.*` permissions) · delegated admins hand out only what they hold · user management follows scope (Department = own departments) · 2FA is a per-role switch                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Audit            | All changes with before/after + Restricted reads and exports · append-only (DB trigger) · kept forever                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Encryption       | App-level AES-256-GCM for Restricted columns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Modularity       | Modular monolith + module registry (admin enables/disables) · one Postgres schema per module · REST + shared Zod contracts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Processes        | Explicit state machines per document + a shared approvals service                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Numbering        | Configurable series, April financial year in Colombo time (`26` = Apr 2026 – Mar 2027), gap-free                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Jobs / files     | Own transactional outbox table + worker process (pg-boss dropped: it creates tables at runtime, which the app role may not) · Cloudflare R2 private buckets                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Stores UX        | Phone camera scanning in a PWA (online only) · phones get a bottom bar with a raised Scan button, the installed app opens on Scan, and app shortcuts for Scan/Receive/Count · Scan also works in a PC browser (webcam, typed code or a USB hand-held scanner), from a Scan button in the PC top bar · "Scan with phone" on the PC lends a phone as a scanner: QR link + 6-digit code typed on the phone (5 wrong codes lock it), no phone sign-in, 15 minutes from pairing (PC can add 15 min up to 2 h, or end), scans build one live list on the PC (+1 per scan; unknown codes kept); link, code and phone token stored only as SHA-256 hashes; the phone token is an httpOnly cookie scoped to its /p/<link> path · scans are queued, never dropped; a code counts again only after it leaves view; beep, buzz and flash per hit/miss, mutable · labels on A4 sticker sheets (3×8) carry the 12-character label token: part labels as Code 128 (the same scanner reads serial labels), bin labels as a QR code, readable from further away on a shelf; old QR label links no longer open anything · dev phone testing through a Cloudflare quick tunnel (`pnpm dev:phone`), trusted only outside production · bin codes Zone-Rack-Shelf-Position, e.g. A-01-03-B                                                                                                            |
| Master data      | Brands and machine models are managed lists; every item has a brand · superseded numbers form a family (`item.family_id` = the current number, `family_depth` = steps back): each number keeps its own stock, but MRNs and holds reserve across the family oldest number first, an AOD line may supply an older number ("1R-1808 (supplied as 1R-0750)"), lists and search show one row per family with the older numbers listed, and minimums and low-stock alerts use the family total · customer/supplier codes auto-numbered (CUS-0001, SUP-0001) · CSV import for items, customers, suppliers (dry run, all-or-nothing) · no item photos yet                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Receiving        | No expected arrivals: every delivery is received on a GRN against a supplier, and each line has an optional delivery-note quantity used for short/excess reports · damaged goods received into quarantine · over-receipt allowed and flagged as excess · stock is free only after put-away · one person may check and post · GRN/FOR vs GRN/LOC from the supplier, editable · no back-dating (delivery date kept as information) · a posted GRN can be reversed by the Stores Manager only while its stock is untouched · every unit received gets a serial number when the GRN is posted (good and damaged; parts sold by length or weight get one per line), a 16-character Crockford base32 hash of the receipt data, printed as Code 128 labels on A4 sheets of 30; scanning or searching a serial finds its part; a reversed GRN voids its serials; stock already in the store got serials once at go-live                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Issuing          | MRN check reserves the free stock and the rest waits; only the Stores Manager assigns new stock to waiting MRNs (nothing automatic) · holds have no expiry and convert to an MRN only as a whole · scanning while picking is optional · every AOD needs approval before it is issued: Stores sends it, a holder of `inventory.aod.approve` for the request's department (or All) approves it or rejects it back to picking with a reason; the sender may approve their own AOD if they hold the permission · until approved, only Stores (holders of `inventory.aod.issue`) and its approvers can see it · it is issued, numbered and printable only after approval · an AOD is complete only once the signed copy is uploaded · printable AOD on A4 · bundles: a set of parts that ships together, either saved (`inventory.bundle`, managed with `inventory.bundle.manage`) or put together one-off on the MRN; an MRN copies the parts into `mrn_bundle` + its `mrn_line`s (`qty_per_set`), each part reserves as usual, and the AOD takes only whole sets (ready sets = least of reserved ÷ per set over its parts; `BUNDLE_INCOMPLETE` otherwise) · the customer gets one number per saved bundle (`customer_bundle_part`) and a new one per one-off bundle, from the same running sequence as parts · both printouts show the bundle as a heading with its parts under it |
| Returns          | Against an issued AOD (qty up to issued minus already returned) or a free return with a reason · the Stores Keeper picks per line: good to a storage bin, damaged to quarantine, faulty opens a warranty tag and adds no stock                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Counts           | Blind or not chosen per count · counted bins are frozen until the count is posted or cancelled · the Stores Manager approves differences and cannot approve a count they counted or submitted · opening counts run zone by zone, once per bin                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Warranty bin     | Tags are custody only and never change stock · Tagged → Sent to supplier → Closed with an outcome                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Reports          | Below minimum, stock movements, stock by bin (printable), stock age · quantities only · CSV export needs the export permission · stock age: shelf stock (storage bins only) is aged from the GRN receipt, oldest units count as leaving first (FIFO), a return keeps the age it left with, opening stock counts from the opening count as "at least"; bands are set with `inventory.stock_age.settings` (default 30/90/180/365 days) and Home's blue Stock age tile counts parts in the oldest band                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Low-stock alerts | A part is low when free stock is under its minimum · every holder of `core.department.head` gets an inbox message when a part drops below (one message per part, or a single summary when more than 10 drop in one run) · email needs `inventory.low_stock.email` too: a weekly report on a day and time set by holders of `inventory.low_stock.settings`, plus an optional email per part (one switch, off by default) · super admin's implied access does not count as holding these · routing by department comes later                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

## Topology

```
Browser / phone ──HTTPS──► Traefik (Coolify)
   app.<domain>   ─► web   (Next.js staff PWA)  ┐   internal "backend" network
   admin.<domain> ─► admin (Next.js admin)      ├─► api (NestJS) ─► Postgres
                                                ┘                ─► R2 (files, backups)
```

The API and Postgres have no public route. Each Next.js app calls the API with its own
internal token, the user's session cookie and a request id. Admin API routes accept only the
admin app's token.

## Authentication

- **Two Better Auth instances** in the API, one per app (`web`, `admin`), sharing the `auth`
  schema. Cookies are host-only and prefixed `dax-web.` / `dax-admin.`. Each session records
  the app that created it, and the API rejects a session used from the other app.
- **Admin app** sign-in needs the `core.admin.access` permission; super admins have it.
- **Internal tokens:** every API call carries `x-internal-token`; the token decides which app is
  calling. Only `/api/health/*` is open, for container probes.
- **Next.js auth proxy** (`/api/auth/*` in each app) forwards an allowlist of sign-in, password and
  two-step endpoints. It checks the request is same-origin, forwards only that app's cookies, and
  strips session tokens and user records from response bodies.
- **Default deny:** a global guard requires a session on every API route unless it is marked
  `@Public()`. Users with a pending password change or a missing 2FA (super admins) can only
  reach `/api/me` until they finish setup.
- **Email** leaves the server only through Resend. The API joins an outbound-only `egress`
  network for this; it still has no public route.
- **Users** are created by a super admin in the admin app and get a 72-hour email link to set
  their password. Admins can unlock, deactivate and resend links.
- **Lockout:** 5 wrong passwords lock the account for 15 minutes; the two-step code has its own
  5-attempt lockout. Per-IP rate limits apply in production.

## Repository layout and boundaries

```
apps/        api · web · admin · web-e2e
libs/
  shared/        contracts · util · ui
  platform/      db · core · contract
  web-platform/  data-access · shell
  <module>/      contract · server · web      (parties, inventory, later sales, commercial...)
tools/scripts/   prisma-lint · copy-lint
infra/           postgres roles · Dockerfiles · Coolify compose
```

Each project carries `scope:*` and `type:*` tags. `@nx/enforce-module-boundaries` (root
`eslint.config.mjs`) enforces:

- a module imports platform, shared, its own libs, and **only the `contract` lib** of other modules;
- platform never imports modules; only apps compose modules;
- browser-side libs (`web`, `ui`, `data-access`) never import server libs or server packages;
- contracts stay framework-free (no Nest, Prisma, React, Mantine).

Further ESLint rules ban Next.js shared caching (`'use cache'`, `unstable_cache`, `force-cache`)
in the web apps and libs, because a shared cache can serve one user's filtered data to another.

### Prisma

One schema folder at `libs/platform/db/prisma/schema/` with one subfolder per module, one
generated client. `prisma-lint` enforces three rules:

- `@@schema` matches the folder;
- no relation crosses modules (`auth`, `core` and `audit` may relate to each other);
- migration names start with a module key.

Cross-module references are plain uuid columns with a name snapshot. A typed per-module facade
(`ModuleDb<'inventory'>`) will expose only that module's tables. CHECK constraints, triggers and
grants live in migration SQL.

### Database roles

| Role           | Can                                                                                                               |
| -------------- | ----------------------------------------------------------------------------------------------------------------- |
| `dax_owner`    | Owns every schema and table; cannot log in                                                                        |
| `dax_migrator` | Runs migrations; every session acts as `dax_owner`                                                                |
| `dax_app`      | API and worker: data only, no DDL, 15 s statement timeout. INSERT + SELECT only on the stock ledger and audit log |
| `dax_backup`   | Read-only, for `pg_dump`                                                                                          |

`libs/platform/db/prisma/sql/grants.sql` reapplies grants after every migration and picks up
new module schemas automatically.

## Module system

A module's **manifest** (in its contract lib) is pure data. It declares:

- features and actions, with allowed scopes and approval flags;
- number series;
- menu entries;
- dependencies;
- default grants for seeded roles.

Typed permission keys such as `'inventory.grn.post'` are derived from it. See
`libs/shared/contracts/src/lib/module-manifest.ts` and `libs/inventory/contract`.

- **Registry sync on boot.** Upserts modules, features, permissions, entities, fields and series
  into `core` tables. Vanished keys are marked removed (grants are never deleted). Default grants
  apply only to newly seen permissions. Boot fails if a route lacks a permission decorator.
- **Field classification.** Each entity's field metadata is keyed by Prisma's generated field
  enum, so an unclassified column fails to compile.
- **Enable / disable.** The API composes only enabled modules at boot, so a disabled module has
  no routes, subscribers or jobs. Toggling checks dependencies in both directions and restarts
  the API. Tables always exist.
- **Integration between modules** happens only through:
  1. **Ports**: interfaces in a contract lib that join the caller's transaction. Inventory's
     ports cover availability, reserve/release, requestIssue, expectArrival, startMrnFromHold
     and flagReorder.
  2. **Domain events**: versioned Zod schemas written to `core.outbox_event` inside the business
     transaction; the worker delivers them. Subscribers are idempotent (`core.processed_event`).
  3. **Extension hooks**, e.g. an MRN release gate list that is empty in phase 1 and lets
     Accounts add release clearance later.
  4. **Web extension slots** filled by `apps/web`.

## Access Control Matrix (schema `core`)

| Table                                   | Purpose                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------- |
| `module`, `feature`, `permission`       | Registry synced from manifests                                                  |
| `entity`, `field`                       | Field registry: tier, encrypted, locked (always readable), writable, filterable |
| `department`                            | Stores, Parts Sales, Workshop, Sales, Accounts, Commercial, Finance, Management |
| `role`                                  | Includes `isSuperAdmin` and `require2fa`                                        |
| `role_permission`                       | Role × permission × scope (+ store list)                                        |
| `role_field_grant`                      | Role × field × read/write. Only deviations from the tier default are stored     |
| `user_role`, `user_permission_override` | Many roles per user; GRANT/DENY overrides with reason and expiry                |
| `user_profile`, `policy_epoch`          | Departments, and version counters for cache invalidation                        |

**Resolution rules:**

- Permissions: the union of the user's roles, with the widest scope winning. GRANT overrides
  are added and DENY overrides removed (deny wins). Disabled modules are dropped.
- Fields:
  - by default, Internal fields are readable and Confidential/Restricted are hidden;
  - grant rows override the default;
  - write access is always a subset of read access.
- Policies are cached per user and invalidated by database triggers when anything changes.

## Visibility layer (API request pipeline)

1. Internal caller check (per-app token).
2. Session (Better Auth), then policy, then request context.
3. Module enabled.
4. Permission: `@Requires('inventory.grn.post')`. Every route needs one; **default deny**.
5. Strict Zod validation, then a writable-fields check, then an idempotency key.
6. Queries use `scopeWhere` (row scope; out of scope returns 404) and `buildSelect`
   (**only readable columns are selected**).
7. The response passes `project()`: an allowlist of keys, decryption, Restricted-read audit,
   type conversion.

Contracts mark gated fields optional: an absent key means "not visible to you". Filtering and
sorting are only allowed on readable fields, search indexes only cover Internal fields, and the
audit viewer and exports run through the same projection.

## Sensitive data

- **Classification:** checked at compile time and in CI.
- **Physical separation:** money data lives in its own module schema, never as columns on
  inventory tables. Exception, by DAX's decision: an item's pre-costing and selling price are
  Internal columns on `inventory.item`, visible to anyone who can see items.
- **Column encryption:** AES-256-GCM with a key id prefix for rotation. Additional data binds
  each value to its table, column and row. The key is held outside the database. This protects
  dumps and backups, not a full server compromise.
- **Logs:** pino redacts cookies, auth headers, tokens and secrets. Request bodies are never
  logged.
- **Headers:** Helmet on the API. Next.js sends nosniff, `frame-ancestors`, referrer and
  permissions policies, plus a per-request nonce CSP from each app's `proxy.ts`.
- **Files:** stored in a private R2 bucket. A download needs a permission and scope check, an
  audit row, then a 60-second signed URL.
- **Backups:** nightly `pg_dump` encrypted with `age` to a separate R2 bucket. Monthly restore
  drill.

## Inventory domain (phase 1)

- **Master data:**
  - items, with supersession and alternate/manufacturer barcodes, a main supplier (uuid + name
    snapshot), tags, and pre-costing and selling prices;
  - machine types (Excavator, Generator...) on machine models; an item's types come from the
    models it fits;
  - store → zone → bin, one default store for now. Bin kinds: storage, receiving, quarantine,
    warranty.
- **Stock engine:** one posting service is the only code that changes stock.
  - Balances have CHECK constraints: on hand ≥ 0, held ≥ 0, held ≤ on hand.
  - The ledger is append-only.
  - Reservations are one mechanism for holds, MRNs and future sales orders.
  - A hold or MRN line can hold one reservation per family number; issuing must name the reserved number. The nightly reconcile also checks `held` against the reservations.
  - Numbers are assigned on post, never at draft.

| Document                           | Flow                                                                                 | Stock effect                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| GRN (FOR, LOC)                     | Draft → Checked → Posted → Put away                                                  | receive into receiving bin, then move to target bin  |
| Discrepancy                        | Open → Closed                                                                        | damaged quantity to quarantine                       |
| MRN (PRT, SRV, SAL)                | Draft → Submitted → Checked → Ready → Issued → Closed                                | reserve                                              |
| AOD (SER, REP, INS, BRK, DIR, HIR) | Picking → Awaiting approval → Approved → Issued → Signed (reject returns to Picking) | consume reservation, issue (on Issued only)          |
| Hold                               | Active → Converted / Released                                                        | hold / release                                       |
| Return note                        | Draft → Posted                                                                       | back to a bin, quarantine if damaged, none if faulty |
| Stock count (cycle, full, opening) | Counting → Submitted → Posted on Stores Manager approval                             | adjust; counted bins frozen while open               |
| Warranty tag                       | Tagged → Sent → Closed (outcome)                                                     | none (custody only)                                  |

**Seeded roles:** Super Admin, Stores Manager, Stores Keeper, Stock Viewer. In phase 1 other
departments are read-only viewers.

**Inbox:** `core.inbox_message` holds per-user messages; modules deliver through
`InboxService.deliver()` inside their transaction and find recipients by permission with
`InboxService.recipients()`. The worker checks for low parts every 5 minutes
(`inventory.low_stock`, open alerts in `inventory.low_stock_alert`) and for the weekly report
(`inventory.low_stock_report`); emails leave through outbox events so failed sends retry.

**Bundles:** `inventory.bundle` / `bundle_line` hold saved recipes. An MRN's `mrn_bundle`
snapshots the name and sets; its parts are ordinary `mrn_line`s with `mrn_bundle_id` and
`qty_per_set` (line numbers from 1001 per bundle), so reserving, family pooling and
reconciling need no change. AOD create, edit and issue enforce whole sets.

**Serial numbers:** `inventory.item_serial` holds one row per received unit (or per bulk batch):
the 16-character serial (`receiving/serials.ts` hashes part, brand, GRN number, line, unit,
condition and time with SHA-256, re-salted on a clash), the source document, `bin_id`
(receiving or quarantine on receipt, moved to the shelf on put-away, not tracked after that)
and `print_count`. GRN post makes them, reversal voids them, the worker job
`inventory.serials_existing` gives existing stock serials once after the age layers are built.
Labels: `POST /inventory/labels/serials` renders Code 128 as vector bars
(`@dax/inventory-contract` `code128Bars`, shared with the web serial page).

**Stock age:** `inventory.stock_layer` holds shelf stock that arrived together (`aged_from`,
`qty_left`) and `stock_layer_use` records what left each layer, by which document, with its
days in store. `StockPostingService.post()` keeps them in step for storage-bin movements only
(`stock/stock-age.ts`): moves between storage bins in one batch cancel out, a put-away layer is
dated by the GRN's RECEIVE row, a return restores the issued uses shifted by the days out, and
everything else leaving takes the oldest layers. Every ledger row of one `post()` shares one
timestamp, so `rebuildStockAge()` can replay the ledger batch by batch; the worker job
`inventory.stock_age_rebuild` runs it once while `stock_age_settings.rebuilt_at` is null, and the
nightly reconcile then checks layers against shelf stock.

## Adding a module later (example: costing)

1. Generate `libs/commercial/{contract,server,web}` and `prisma/schema/commercial/`.
2. Add tables with cost fields marked **Restricted + encrypted**.
3. The manifest declares its features, approvals, series, menu and `dependsOn: ['inventory']`.
4. Subscribe to `inventory.goods_received.v1`; call `expectArrival()` when a PO is placed.
5. Deploy. The module appears in admin as disabled. Grant cost fields only to the right roles,
   then enable it.
6. **No changes in `libs/inventory/*`.** If one is needed, the boundaries are wrong.

## Milestones

| #   | Scope                                                                                                                                                                                                                                                              | Status          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------- |
| M0  | Workspace, boundaries, Prisma layout, DB roles, logging, health, Docker, CI                                                                                                                                                                                        | done            |
| M1  | Better Auth in NestJS, Next auth proxy, login/2FA screens, internal tokens                                                                                                                                                                                         | built           |
| M2  | Registry, ACM, policy cache, visibility layer, audit, crypto, numbering, approvals, files, events, admin panel                                                                                                                                                     | built           |
| M3  | Parties, items, bins, QR labels, stock views, scanner, PWA                                                                                                                                                                                                         | built           |
| M4  | Stock engine, receiving, GRN, put-away                                                                                                                                                                                                                             | built           |
| M5  | MRN, AOD, holds                                                                                                                                                                                                                                                    | built           |
| M6  | Returns, counts, warranty bin, reports                                                                                                                                                                                                                             | built           |
| M7  | Hardening: encrypted nightly backups + point-in-time recovery + restore drill, duplicate-save protection, API rate limits, client IP fix, dependency and secret scanning, Sentry error tracking, deep health check, container limits, runbooks · then UAT, go-live | hardening built |

## Decision notes

- **2026-11-26, monitoring stack:** free hosted services only, nothing self-hosted. Sentry
  (errors, tracing off, DSNs read at runtime so one image serves staging and production),
  UptimeRobot (`/healthz/deep` and `/healthz`), Healthchecks.io (backup heartbeat) and Coolify's
  own notifications. All alerts go by email. Metrics dashboards and central log search wait
  until volume needs them; Coolify's container logs are enough for now.
- **2026-11-26, backups:** nightly `pg_dump` as `dax_backup`, encrypted with age, to a separate
  R2 bucket with lifecycle rules and a 14-day bucket lock; uploaded files are copied, never
  synced. Up to a day of data can be lost; point-in-time recovery is the next step if that is
  too much.
- **2026-11-26, point-in-time recovery:** pgBackRest in the `dax-postgres` image ships WAL to a
  separate encrypted R2 bucket (`archive_timeout = 15s`, only when something changed), with a
  daily base backup from the `pitr` service. A disk loss costs at most about 15 seconds of
  committed work instead of a day. Chosen over WAL-G because it installs from the Postgres
  package repository and has time-target restore built in. Synchronous replication to a second
  server (no loss at all) was declined: saves would stop whenever that server is down.
- **2026-11-26, duplicate saves:** the web and admin apps send an `Idempotency-Key` with every
  save, derived from a per-browser cookie that rotates after each successful save. A retry
  after a lost response replays the first result. Claims left unfinished by a crash are taken
  over after 60 seconds.
- **2026-11-26, throttling:** `@nestjs/throttler` with in-memory storage (one API instance),
  1,000 requests a minute per client IP, lower on phone pairing, phone scans, PDFs, CSV imports
  and scan lookups; health routes are exempt. The client IP comes from `x-dax-client-ip`, which
  only the Next apps (holding an internal token) can send; they take it from `X-Real-Ip`, else
  the rightmost `X-Forwarded-For` entry, never the client-controlled leftmost one. Throttling is
  on in development too: the limits are per minute and far above one developer's use, and no
  test calls the API over HTTP. One office behind one public IP shares the 1,000; raise it if
  that is ever hit. Traefik adds an edge limit (average 50/s, burst 100) per client.

## Open points to confirm with DAX

- MRN subtype for the Sales department (SAL assumed).
- Financial-year label convention (start year assumed).
- Whether direct-sale AODs may leave without Accounts release in phase 1.
- Whether users can belong to several departments (modelled as a list).
- Label size and printer.
- Whether damaged received goods go to quarantine or are rejected at the dock.
