# Ecom

A multipurpose, market-adaptable commerce platform: a public **storefront** for
shoppers and an **enterprise back office** for the team running it, in one
Next.js application sharing one database and one authorization model.

Nothing about the catalogue is vertical-specific. Currency, locale, tax,
shipping, stock policy and review moderation are all settings, so the same
build runs an electronics shop, a clothing shop or a hardware supplier.

---

## Contents

- [What it does](#what-it-does)
- [Stack](#stack)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Commands](#commands)
- [Project layout](#project-layout)
- [Architecture](#architecture)
- [Security](#security)
- [Testing](#testing)
- [Production deployment](#production-deployment)
- [Known limitations](#known-limitations)

---

## What it does

**Storefront** — browse by category, search and filter, product pages with
variants and live stock, basket, discount codes, guest or account checkout,
order confirmation and tracking, customer accounts, product reviews.

**Back office** — dashboard with KPIs and trends, orders (payment, fulfilment,
partial shipments, refunds, cancellation), catalogue (products, variants,
categories, brands, review moderation), inventory with an append-only stock
ledger, customers, discounts, reports, notifications, audit log, settings, and
user/role/permission administration.

Every list screen supports search, filtering, sorting, pagination and CSV
export, works on a 320px phone, and has explicit loading, empty and error
states.

---

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Framework | Next.js 16 (App Router) + React 19 | Server components for data-heavy screens; one deployable for storefront, back office and API |
| Language | TypeScript 5.9 (`strict`) | Pinned to 5.x for ESLint/Prisma ecosystem support |
| Database | PostgreSQL 17 | Relational integrity for orders, stock and money |
| ORM | Prisma 7 + `@prisma/adapter-pg` | Prisma 7 requires an explicit driver adapter |
| Styling | Tailwind CSS 4 | CSS-first config; semantic tokens in `globals.css` |
| Validation | Zod 4 | One schema validates the API and the form |
| Forms | React Hook Form 7 | With `@hookform/resolvers` against the same Zod schemas |
| Auth | Hand-rolled, DB-backed sessions | Opaque tokens, server-side revocation, optional Entra ID SSO |
| Icons | Lucide | |
| Charts | Recharts 3 | |
| Tests | Vitest 5, Testing Library, Playwright | |

### A note on the brief

The original brief listed **"Frontend: php"** alongside React, Prisma, Zod,
React Hook Form and TypeScript strict typing. Those cannot coexist — Prisma,
Zod and RHF are Node/TypeScript libraries with no PHP equivalent, and the
brief's own code-quality section mandates TypeScript strict typing.

This is built end-to-end in **TypeScript on Next.js**, which satisfies every
other stated requirement. If PHP was the real constraint rather than a
leftover from a template, this is the decision to revisit first.

Other placeholders in the brief were resolved as:

| Placeholder | Resolved as |
| --- | --- |
| `[ecom]` | Project name `ecom`, store name configurable in Settings |
| Market | Market-agnostic; currency/locale/tax/shipping are settings |
| Target users | Back-office staff (4 roles) and storefront shoppers |
| `[CORE MODULE 1-3]` | Catalog, Orders, Customers (plus Inventory and Discounts) |

---

## Quick start

**Prerequisites:** Node 20.11+ (24 recommended), Docker (or a PostgreSQL 15+
server), npm 10+.

```bash
# 1. Install
npm install

# npm 11+ blocks lifecycle scripts by default. Prisma and esbuild need theirs:
npm install-scripts approve prisma @prisma/engines esbuild

# 2. Configure
cp .env.example .env

# Generate a real secret and a seed password:
node -e "console.log('AUTH_SECRET=' + require('crypto').randomBytes(32).toString('base64'))"
node -e "console.log('SEED_SUPER_ADMIN_PASSWORD=' + require('crypto').randomBytes(12).toString('base64url'))"
# Paste both into .env.

# 3. Database
docker compose up -d db          # PostgreSQL on localhost:5435
npm run db:migrate               # apply migrations
npm run db:seed                  # permissions, roles, settings, owner + demo data

# 4. Run
npm run dev                      # http://localhost:3000
```

Then:

- **Storefront** — <http://localhost:3000>
- **Back office** — <http://localhost:3000/login>, using
  `SEED_SUPER_ADMIN_EMAIL` / `SEED_SUPER_ADMIN_PASSWORD`. You are asked to set
  your own password on first sign-in.

> **Port note.** `APP_URL` must match the origin you browse. The API rejects a
> mutating request whose `Origin` does not match `APP_URL` — that is the CSRF
> defence. If Next picks another port because 3000 is busy, update `APP_URL`
> and restart.

### Demo data

`SEED_DEMO_DATA=true` adds 24 products across 20 categories, 6 brands, 12
customers, ~36 orders spread over 90 days, 4 discount codes and product
reviews — enough for the dashboard, reports and low-stock alerts to show
something real. The seed refuses to create demo data when
`NODE_ENV=production`.

The seed is **idempotent**: it matches on natural keys and tops up to a target
rather than appending, so running it twice does not double anything. It never
overwrites a password or a setting an administrator has already changed.

Product imagery is locally generated SVG (`public/demo/`) — no external
requests, and it works offline.

---

## Configuration

Every variable is documented in `.env.example`. The ones that matter:

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `AUTH_SECRET` | 32+ random bytes. Signs CSRF tokens and the SSO transaction cookie |
| `APP_URL` | Public origin. **Must** match the browser origin or mutations are rejected |
| `SESSION_IDLE_TIMEOUT_SECONDS` | Sliding expiry (default 30 days) |
| `SESSION_ABSOLUTE_TIMEOUT_SECONDS` | Hard ceiling, never extended (default 90 days) |
| `PASSWORD_MIN_LENGTH` / `BCRYPT_COST` | Password policy and hashing cost |
| `LOGIN_MAX_ATTEMPTS` / `LOGIN_LOCKOUT_SECONDS` | Account lockout |
| `MAIL_TRANSPORT` | `smtp` or `log`. Production refuses `log` |
| `AUTH_ENTRA_ENABLED` + `ENTRA_*` | Optional Microsoft Entra ID SSO |
| `SEED_SUPER_ADMIN_*` | First owner account. The seed refuses to run without them |

Configuration is validated by Zod at startup (`src/lib/env.ts`), so a
misconfigured deployment fails loudly at boot rather than producing confusing
errors later. Production-only rules (HTTPS, real SMTP) are checked at runtime,
not during `next build`, so the artefact can still be built in CI.

Application settings — store name, currency, locale, tax, shipping thresholds,
stock policy, review moderation — live in the database and are edited at
`/settings`. They are declared once in `src/lib/settings-registry.ts`, which
drives the seed, the server-side validation and the settings form together.

---

## Commands

```bash
npm run dev               # development server
npm run build             # prisma generate + production build
npm start                 # run the production build

npm run typecheck         # tsc --noEmit
npm run lint              # eslint
npm run format            # prettier --write
npm run verify            # typecheck + lint + tests

npm run db:migrate        # create and apply a migration (dev)
npm run db:migrate:deploy # apply migrations (production)
npm run db:seed           # idempotent seed
npm run db:studio         # Prisma Studio
npm run db:reset          # DESTRUCTIVE: drop, re-migrate, re-seed

npm run test              # all three test projects
npm run test:unit         # pure logic, no database
npm run test:components   # React components in jsdom
npm run test:db:setup     # migrate the integration-test database
npm run test:integration  # services against real PostgreSQL
npm run e2e               # Playwright journeys
```

---

## Project layout

```
prisma/
  schema.prisma        30 models; money as integer minor units
  migrations/
  seed.ts              idempotent seed
src/
  app/
    (auth)/            login, forgot-password, reset-password
    (admin)/           back office; layout is the auth boundary
    (shop)/            storefront
    api/
      auth/            sign-in, sign-out, password flows, Entra ID
      v1/              REST resources (users, orders, products, ...)
      shop/            cart and checkout
  components/
    ui/                buttons, forms, tables, dialogs, feedback
    layout/            admin shell, navigation, theme
    data/              DataTable, filters, export
    shop/              storefront components
    charts/            Recharts wrappers
  lib/
    api/               handler, errors, responses, query parsing, CRUD factory
    auth/              password, sessions, current user, Entra ID
    rbac/              permission catalogue and pure guards
    db.ts, env.ts, money.ts, audit.ts, rate-limit.ts, csrf.ts, export.ts
  server/              service layer; all business logic
  validation/          Zod schemas shared by API and forms
  proxy.ts             edge proxy: CSP, route gating
tests/
  unit/ components/ integration/ e2e/
```

---

## Architecture

### Layers

```
Route handler / Server component   authorize, parse, respond
        |
Service  (src/server/*)            business rules, transactions, audit
        |
Prisma                             database access
```

Services never read cookies or requests. The route resolves the principal and
passes a `ServiceActor` down. That keeps business logic free of transport
concerns and directly testable — a test constructs an actor rather than faking
a session.

Server components call services **directly** rather than fetching their own
API. A server component is already inside the trust boundary, so an HTTP round
trip would add latency and a second serialisation for nothing. The same
permission check runs either way.

### Money

Every monetary value is an **integer number of minor units** (cents, kobo,
pence) with an ISO-4217 code beside it. No floats, no `Decimal`
serialisation differences across the HTTP boundary. `src/lib/money.ts` is the
only place that converts, and it shifts the decimal point textually rather than
multiplying — `1.005 * 100` is `100.4999…` in IEEE-754 and would round the
wrong way.

### Inventory

`inventory_items` holds current figures; `stock_movements` is an append-only
ledger, so any level is explainable from history. Availability is
`onHand - reserved`. Decrements use a conditional `updateMany` guarded on
quantity — a compare-and-set — so two concurrent checkouts cannot both take the
last unit. There is a test for exactly that race.

### Orders

Totals are computed server-side from the catalogue; the client never sends a
price. Line prices are snapshotted at the point of sale. Status moves through an
explicit state machine, and cancellation and refunds have their own endpoints
because they have side effects on stock and money that a generic status update
would hide.

---

## Security

| Control | Implementation |
| --- | --- |
| Password hashing | bcrypt, cost 12, SHA-256 pre-hash so long passphrases are not truncated at 72 bytes |
| Sessions | Opaque random tokens; only the SHA-256 hash is stored, so a database leak cannot be replayed. Idle + absolute expiry, server-side revocation |
| Session scopes | Staff and shopper sessions use separate cookies; a customer session can never reach the back office |
| CSRF | Origin check **and** double-submit token on every mutation, plus `SameSite=Lax` cookies |
| Authorization | 55 permissions, 4 roles, checked server-side on every route. Hiding UI is cosmetic only |
| Privilege escalation | You cannot act on, create or grant a role above your own authority; you cannot change your own roles or status; the last Super Admin cannot be removed |
| Rate limiting | Per-account and per-IP, atomic `INSERT … ON CONFLICT` in Postgres so it holds across instances |
| Account lockout | After `LOGIN_MAX_ATTEMPTS`, for `LOGIN_LOCKOUT_SECONDS` |
| Enumeration | Sign-in and password-reset responses are identical for known and unknown addresses, and an unknown email still pays the bcrypt cost so timing does not leak |
| Input validation | Zod at every boundary; sort fields are allow-listed before reaching `orderBy` |
| SQL injection | Prisma parameterises everything; the few raw queries use tagged templates |
| XSS | React escapes by default; a nonce-based CSP is set per request |
| Audit trail | Append-only, field-level diffs, actor, IP and request id. No endpoint edits or deletes an entry |
| Secrets | Environment only; logs redact passwords, tokens and hashes |
| CSV injection | Cells starting `= + - @` are neutralised, so an export cannot run a formula on a colleague's machine |

Both CSRF layers are verified working:

```
POST with mismatched Origin   -> 403 unrecognised origin
POST without x-csrf-token     -> 403 token missing
GET  /api/v1/users anonymous  -> 401 unauthenticated
```

### Entra ID SSO (optional)

Authorization-code flow with PKCE. `state` is bound to a signed, short-lived
cookie; `nonce` is echoed and compared; the id_token's signature, issuer and
audience are verified against the tenant JWKS. A first-time SSO user is
provisioned **with no roles** and lands on `/no-access` until an administrator
grants access — a valid tenant account is not automatically a back-office
account.

---

## Testing

162 automated tests across three projects, plus Playwright journeys.

```bash
npm run test:unit          # 88 tests: money, RBAC, order state machine, policy, CSV, settings
npm run test:components    # 18 tests: accessibility contracts of the UI primitives
npm run test:db:setup      # once, to create the schema in ecom_test
npm run test:integration   # 56 tests: real PostgreSQL
npm run e2e                # browser journeys
```

Integration tests run against a **separate database** and refuse to start
unless its name ends in `_test` — without that guard, a stray `DATABASE_URL`
would point the truncation step at real data.

They cover the things unit tests cannot prove: that an Admin cannot grant Super
Admin, that the last Super Admin cannot be removed, that two concurrent orders
cannot oversell one unit, that a shipped order cannot be cancelled and
restocked, that a discount is counted once, and that no password or hash ever
reaches the audit trail.

Tests are included for unauthorized and invalid requests, not only successful
ones.

---

## Production deployment

### Docker

```bash
cp .env.example .env     # set AUTH_SECRET, APP_URL (https), SMTP
docker compose --profile full up -d --build
docker compose exec app npx prisma migrate deploy
docker compose exec app npm run db:seed
```

The image is a multi-stage build on `node:24-alpine`, runs as a non-root user,
uses Next's standalone output, and has a health check against `/api/health`.

### Any Node host

```bash
npm ci
npm run build
npm run db:migrate:deploy
npm run db:seed          # first deploy only
npm start
```

### Checklist

- `AUTH_SECRET` is 32+ random bytes and unique to the environment
- `APP_URL` is the exact public **https** origin
- `MAIL_TRANSPORT=smtp` with working credentials
- `SEED_DEMO_DATA` unset or `false`
- Database backups and PITR configured
- TLS terminated upstream; the app sets HSTS, CSP and frame-ancestors itself
- `/api/health` wired to your uptime monitor

---

## Known limitations

Honest notes on what is deliberately not finished:

- **Payments are recorded, not captured.** Checkout creates an unpaid order and
  a staff member records payment. There is no gateway integration; `Payment`
  carries the provider, reference and status a real integration would fill in.
- **Email needs SMTP.** With `MAIL_TRANSPORT=log` (development), messages are
  written to the server log — that is how you retrieve a reset link locally.
- **`react-hooks/incompatible-library` warnings (9).** The React Compiler notes
  that react-hook-form is not compiler-compatible. The brief specified RHF;
  these are warnings, not errors, and nothing is broken.
- **Guest order lookup is by order number.** A guest can view their own
  confirmation without an account. The page shows no payment details and
  nothing actionable, but a signed-in shopper is restricted to their own orders.
- **Tax is a flat rate** per product or store-wide. No jurisdiction rules.
- **No background job runner.** `pruneExpiredSessions`, `pruneRateLimits` and
  `markAbandonedCarts` exist and are safe to call from cron, but nothing
  schedules them.
- **Single currency per store.** Multi-currency would need per-currency pricing
  and an FX source; the schema already carries a currency on every order.
