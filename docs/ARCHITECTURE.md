# Architecture

Written for engineers joining this codebase. It covers the decisions that are
not obvious from reading the files, and the reasoning behind them.

---

## 1. One application, two audiences

The storefront and the back office are route groups in a single Next.js app:

| Group | Routes | Boundary |
| --- | --- | --- |
| `(shop)` | `/`, `/c/[slug]`, `/p/[slug]`, `/cart`, `/checkout`, `/account/*` | Public; shopper session for `/account` |
| `(admin)` | `/dashboard`, `/orders`, `/users`, `/settings`, … | Staff session, enforced in the layout |
| `(auth)` | `/login`, `/forgot-password`, `/reset-password` | Public |

They share one database, one service layer and one permission model. Splitting
them into separate deployments would duplicate the catalogue, pricing and stock
logic — which is exactly the code that must not diverge.

**Staff and shoppers are different principals**, with separate tables
(`users` / `customers`) and separate session cookies (`ecom_session` /
`ecom_shop_session`). A customer session can never satisfy a staff check, even
in the same browser.

---

## 2. Layering

```
proxy.ts            CSP, cheap route gating (NOT an authorization boundary)
      |
Route handler       authorize -> parse -> call service -> respond
or Server component
      |
Service             business rules, transactions, audit writes
(src/server/*)
      |
Prisma              database
```

### Services never see the request

A service takes a `ServiceActor` — id, email, permissions, role keys, authority
level, and request metadata for the audit trail. It never reads cookies or
headers.

The payoff is testability. An integration test constructs an actor and calls
`assignRoles(...)` directly; there is no session to fake and no HTTP to mock,
and the test exercises the same code the API does.

### Server components call services directly

A server component is already inside the trust boundary. Fetching its own REST
API would add a network round trip and a second serialisation for no benefit.
`requirePermission()` runs either way, so the authorization is identical.

The REST API under `/api/v1` exists for the browser (forms, tables, actions)
and for any external integration.

---

## 3. The authorization model

Three concepts, deliberately separate so roles can be reshaped without a
deployment:

- **Permission** — a capability such as `order.refund`. Declared in
  `src/lib/rbac/permissions.ts` (55 of them) and seeded into the database.
  Adding a capability is the only change that needs code.
- **Role** — a named bundle of permissions with an **authority level**. Lower
  outranks higher; 0 is reserved for Super Admin.
- **User** — holds roles. Effective authority is the lowest level held.

### Guards are pure

`src/lib/rbac/guard.ts` has no database or request access. It operates on an
already-loaded principal, so the same functions enforce on the server and hide
controls in the UI. **Hiding UI is cosmetic**; every mutation re-checks.

### Super Admin bypasses at runtime

Super Admin holds every permission row *and* short-circuits `can()`. The
bypass means shipping a new permission can never lock the owner out of their
own installation.

### Three escalation guards

These are the rules that stop a legitimate user acquiring more access than they
were granted. All are integration-tested.

1. **Authority** — you cannot act on, create, or grant a role above your own
   level. This is what stops an Admin promoting themselves to Super Admin.
2. **Self-modification** — you cannot change your own roles or status, which is
   how an administrator usually locks themselves out.
3. **Last Super Admin** — the only active Super Admin cannot be archived,
   suspended or demoted, which would leave the installation unfixable.

---

## 4. Money

Every monetary value is an **integer of minor units** plus an ISO-4217 code.

Floats cannot represent `0.1`, and `Decimal` types serialise inconsistently
across an HTTP boundary. Integers do neither. The cost is remembering that
`1999` means `19.99` — which the schema comment, the type name and
`src/lib/money.ts` all state.

`toMinorUnits` shifts the decimal point **textually**:

```
"1.005" -> whole "1", kept "00", next digit "5" -> round up -> 101
```

Multiplying would give `100.4999…` and round down to `100`, charging a penny
less than the label. A unit test pins this.

### Discount allocation

An order-level discount is allocated across lines in proportion to line value,
as integers that sum **exactly** to the order discount, with the remainder
going to the heaviest line. Two invariants hold:

- no line's share exceeds the line's own value (which would make it negative)
- the parts always sum back to the whole

If asked to allocate more than the lines are worth, it caps rather than
silently under-allocating.

---

## 5. Inventory and overselling

Two tables:

- `inventory_items` — current `quantityOnHand` and `quantityReserved`
- `stock_movements` — append-only ledger with a signed quantity, the balance
  after, a reason and a reference

**Available = onHand − reserved.** Stock promised to an unpaid order is not
sellable; showing on-hand alone is how a shop oversells.

Decrements use a conditional update rather than read-then-write:

```ts
await client.inventoryItem.updateMany({
  where: { variantId, quantityOnHand: { gte: quantity + item.quantityReserved } },
  data: { quantityOnHand: { decrement: quantity } },
});
// result.count === 0 means someone else took it first
```

A read-then-write would let two concurrent checkouts both pass the check. The
integration suite fires two simultaneous orders at a single unit and asserts
that exactly one succeeds.

Order lifecycle: **place** reserves → **fulfil** converts the reservation into
a `SALE` movement → **cancel** releases it → **refund with restock** returns it.

---

## 6. Orders

- Totals are computed server-side from the catalogue. The request body carries
  variant ids and quantities, never prices.
- Line prices are snapshotted at the point of sale; a later price change never
  rewrites a placed order. Addresses are snapshotted for the same reason.
- Order numbers come from an atomic `INSERT … ON CONFLICT` counter, so
  concurrent checkouts cannot be handed the same number.
- Status follows an explicit state machine. Cancellation and refunds have
  dedicated endpoints because they move stock and money — effects a generic
  status update would hide.
- **A shipped order cannot be cancelled.** Goods that have left cannot be
  un-sent, and releasing their stock would overstate availability. This is
  checked against fulfilled quantities, independently of status.

---

## 7. Validation

One Zod schema per operation, in `src/validation/`, used by **both** the API
and the form:

```
Form (react-hook-form + zodResolver) ─┐
                                      ├─ same schema
API route (parseBody)  ───────────────┘
```

The rules cannot drift, and error messages are written for end users because
they are rendered verbatim beside the field.

### `Optionalise`

Zod's `.optional().transform()` produces `{ phone: string | undefined }` — a
*required key* that may hold undefined. Correct, but hostile: every caller must
write `phone: undefined` for fields they do not care about.

`src/types/util.ts` turns those into genuinely optional keys. A parsed Zod
object still satisfies the type (every key present) while hand-written callers
state only what they mean.

---

## 8. The API contract

Two envelopes, so clients never guess:

```jsonc
{ "data": {}, "meta": { "page": 1, "total": 42 } }   // success
{ "error": { "code": "VALIDATION_ERROR", "message": "...",
             "fieldErrors": [{ "path": "email", "message": "..." }],
             "requestId": "..." } }                   // failure
```

`withApi` in `src/lib/api/handler.ts` is the single entry point for every
route. It collects request metadata, enforces CSRF on mutations, runs the
handler, and maps any thrown error to the failure envelope — logging 5xx with
full context and never leaking a stack trace to the client. No route can forget
these.

Collection and item endpoints are generated by factories in
`src/lib/api/crud.ts`, so a new module cannot ship without an authorization
check and so pagination, sorting and error shapes stay identical. Anything with
genuinely bespoke behaviour (auth, checkout, order actions) is written longhand.

Sort fields are **allow-listed per resource** before reaching Prisma's
`orderBy`, so a caller cannot probe arbitrary columns through the query string.

---

## 9. The UI layer

### Tokens, not hex

`globals.css` defines semantic tokens (`--color-surface`, `--color-fg-muted`,
…) once for light and once for dark. Components reference only semantic names,
so re-theming is a single-file change. Every pair meets WCAG AA in both themes.

### Theme without a flash

The preference is a **cookie**, not localStorage, so the server reads it and
renders the right class in the first byte of HTML. There is no inline
detection script — which also means no dependency on the CSP nonce and nothing
for React to warn about. With no cookie, a `prefers-color-scheme` block follows
the operating system.

> This replaced an inline script that the application's own CSP was silently
> blocking. The symptom was dark mode appearing to do nothing.

### Responsive tables

One column definition renders two presentations: a real `<table>` from `md` up,
and a **card list** below it. Nothing is hidden from phone users; the card shows
the same values with labels. The table scrolls inside a bounded container, so
the page itself never scrolls sideways.

> Cards do **not** wrap the title in a link. Title columns already render their
> own `<Link>`, and wrapping produced `<a>` inside `<a>` — invalid HTML that
> made React discard and re-render the whole list on hydration.

### State that follows the server

`useSyncedState` adjusts state **during render** when an external value changes,
rather than the `useEffect(() => setState(prop), [prop])` antipattern, which
renders once with a stale value and which React's compiler lint rejects.

---

## 10. Observability

- **Audit log** — append-only, with actor, action, entity, field-level diff, IP,
  user agent and request id. Written in the same transaction as the mutation
  where atomicity matters. Values are redacted before storage, so a password
  hash cannot reach the trail through a careless payload.
- **Structured logging** — JSON in production, readable in development, with
  sensitive keys redacted at every depth.
- **Request ids** — generated per request, returned on every response, included
  in error envelopes and audit entries. The one handle that lets a user and an
  engineer talk about the same failure.
- **Health** — `/api/health` reports process and database reachability, and
  nothing about versions or configuration.

---

## 11. Decisions worth knowing

| Decision | Why |
| --- | --- |
| Integer minor units | No float drift, no Decimal serialisation surprises |
| Hand-rolled auth | DB-backed revocable sessions and audit hooks; Auth.js credentials do not model this well |
| Opaque session tokens, hash at rest | A database leak cannot be replayed as a login |
| Separate staff/shopper sessions | A shopper session must never reach the back office |
| Permissions in code, roles in the database | New roles need no deployment; new capabilities are reviewed |
| Services take an actor, not a request | Directly testable, transport-agnostic |
| Server components call services | Avoids a pointless HTTP hop inside the trust boundary |
| URL holds table state | Shareable, bookmarkable, works before hydration |
| Prisma 7 + driver adapter | Required by Prisma 7 |
| TypeScript 5.9, not 7 | Widest ESLint/Prisma support today |
| Stock reserved, not deducted, on order | Cancellation is a release, not a correction |
| CSV formula neutralisation | An export must not execute on a colleague's machine |

---

## 12. Where to change things

| Task | File |
| --- | --- |
| Add a permission | `src/lib/rbac/permissions.ts`, then `npm run db:seed` |
| Add a setting | `src/lib/settings-registry.ts` — drives seed, validation and form |
| Add a business rule | the relevant `src/server/*-service.ts` |
| Change a validation rule | `src/validation/*` — applies to API and form at once |
| Add an API resource | `src/lib/api/crud.ts` factories + a route file |
| Restyle | `src/app/globals.css` tokens |
| Add a navigation item | `src/components/layout/nav-config.ts` |
