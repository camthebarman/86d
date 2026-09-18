# Architecture

How 86'd is built today, what will break when more than one restaurant uses
it, and what it should become. This is an audit, not a tour of the files.

---

## Current architecture

```
index.html  (25 <script> tags, no build step, no dependencies)
  │
  ├── js/platform/     organization, storage, ids, time, errors, audit, csv, export
  ├── js/core.js       DOM builder, the one modal, the one toast
  ├── js/shell.js      section tabs + the combined dashboard
  ├── js/food/         calc (pure) · storage (state+seed) · app (render)
  ├── js/bev/          calc (pure) · storage (state+seed) · app (render)
  ├── js/floor/        geometry (pure) · storage · demo · app (render)
  └── js/agent/        engine (offline answers) · context · service · provider · app
```

Every module is an IIFE assigned to one global. There is no bundler, no
framework and no package.json, which is a feature: the whole product is static
files that a restaurant can open from a URL and that cost nothing to host.

**Module boundaries.** Each tool scopes its DOM lookups to its own `#mod-*`
subtree, so all three reuse `.tab-btn` and `.panel` without colliding. No tool
reads another tool's state. The dashboard and the Ask tab consume `summary()`
and `snapshot()` — read-only, pre-computed views each tool exposes about
itself. **That pattern is sound and should survive into the SaaS version**: it
is already the shape of an API response.

**Layering, after this refactor.**

| Layer | Where | Depends on |
|---|---|---|
| Persistence | `platform/storage.js` + adapter | nothing above it |
| Data + seeds | `*/storage.js` | platform |
| Business logic | `food/calc.js`, `bev/calc.js`, `floor/geometry.js` | nothing — pure functions |
| UI | `*/app.js`, `shell.js` | all of the above |

The pure layer is the important one: recipe costing, pour costing, prep
expansion, inventory availability, par levels and table-join geometry are all
plain functions over plain objects. They do not touch the DOM or storage, which
is why they can be tested in Node (`node tests/run.js`) and why they will move
to a server unchanged.

---

## Architectural problems that matter at more than one restaurant

These are the findings of the audit, ordered by how much they would hurt.

### 1. The API key is in the browser — production blocker

`agent/provider-browser.js` calls Anthropic directly with a key pasted into
`localStorage`. Any customer's staff, or anyone with access to that browser
profile, can read it. It is billed to whoever owns the key. This cannot ship as
a paid feature. See `SECURITY.md` and `AI_ARCHITECTURE.md`.

### 2. Writes assumed to always succeed

Before this refactor, every save was `localStorage.setItem` inside a
`try {} catch { console.warn }`. A full device silently discarded counts. Now
`Store` surfaces write failures through a handler the shell wires to a toast.
Against a real backend this becomes the difference between "saved" and "we
think it saved", and the UI will eventually need a pending/failed indicator
rather than a transient toast.

### 3. Reads were synchronous all the way down

Each module did `let state = Storage.load()` at script-parse time. Every render
path assumed data was already in memory. A database is asynchronous, so this
was *the* structural blocker.

Fixed by splitting the two: the **adapter is async**, and the app hydrates once
at boot (`await Store.hydrate()`) into a cache that modules read synchronously.
Module state now loads in `init()`, not at parse time. A host tapping a table
still cannot await a round trip — and now does not have to.

### 4. One browser owned the data

Storage keys were `gbg.food.v1` — no organization, no user, no device. Two
managers on two devices had two divergent copies with no reconciliation, and
clearing site data was permanent deletion with no backup.

Keys are now `86d:{organization}:{collection}` and payloads are wrapped in a
row-shaped envelope (`{v, org, collection, updatedAt, data}`). Pre-existing
keys are adopted on first load. This does not make the data multi-device — only
a server does that — but nothing now assumes single-tenancy.

### 5. Last-write-wins, with no conflict story

Two devices editing the same count will silently clobber each other. The
envelope carries `updatedAt`, which is the minimum needed to detect it, but
there is no merge policy. **This needs a decision before multi-device ships** —
see "Decisions to make" below.

### 6. No actor on any change

Nothing records who did anything. "Who set the par to 4?" is unanswerable.
`platform/audit.js` now emits correctly-shaped entries with `actorId: null`, so
the field exists and fills itself in when sessions arrive.

### 7. Seed data and customer data were the same thing

The demo kitchen was merged into whatever a user had, keyed by `sinceVersion`.
For a real customer, shipped sample data appearing in their inventory is a bug.
`Org.isDemo` now distinguishes them; the seeding mechanism still needs an
"empty restaurant" path (see `DATA_MODEL.md` § Seeding).

### 8. Identity was inconsistent

Ids came from three different generators (`Math.random` + timestamp, in three
places). Now one: `platform/ids.js`, UUID v4 for records, stable slugs for
seeds. No business logic uses array position as identity — verified, and the
relationships between entities are already explicit id references
(`component.ingredientId`, `line.recipeId`, `table.party`).

### 9. Time was stored in three formats

Epoch milliseconds (`addedAt`, `seatedAt`), a date-only string (`event.date`),
and durations (`lastTurnMs`). Stored instants are now ISO 8601 UTC, written
back on first load; durations stay numbers and are named `*Ms`; date-only
values stay date-only. See `platform/time.js`.

### 10. The whole application state went to the LLM

Every question sent ~40 KB of JSON — every ingredient, recipe and table —
regardless of what was asked. `agent/context.js` now builds context *from the
question*: typical contexts are **88% smaller**, and the model never receives
data the question did not need. This is also what makes server-side permission
scoping possible later.

### 11. `innerHTML` escape hatch

`Core.el` accepted `html:` to set `innerHTML`. Nothing used it, and a guest
name or an imported product description flowing through it would be stored XSS.
Removed; every value now enters the DOM as a text node.

### 12. Brand and locale hard-coded

"Generic Bar & Grill", USD and the browser's locale were baked into the
dashboard, the AI prompt and the page title. Now read from `Org`. The one
remaining hard-coded string is `<title>` in `index.html`, which is static HTML
and needs the shell to set it at boot for a real tenant.

---

## Target architecture

```
Browser (this app, mostly unchanged)
  │  same modules, same calc layer, same summary()/snapshot() contract
  │
  ├── Store.use(SupabaseAdapter)          ← the only persistence change
  │        │
  │        └── PostgREST / Supabase client
  │                 │
  │                 └── Postgres + Row Level Security
  │                        organization_id on every row
  │                        policy: member of organization AND role permits
  │
  └── AgentService.use(ServerProvider)    ← the only AI change
           │
           └── POST /api/ask  (authenticated)
                    ├── interpret intent
                    ├── retrieve org-scoped data, filtered by the caller's role
                    ├── build bounded context (the same builder, run server-side)
                    └── call the model with the key that only exists there
```

The two `use()` calls are deliberate. They are the entire seam: one line each
in `shell.js`, with no business-logic change behind either.

**What stays on the client:** rendering, the offline answer engine, and the
pure calculation layer (so the UI stays instant and works on a flaky
restaurant wifi connection).

**What must move to the server:** the AI key and the AI context build,
permission enforcement, the audit log of record, and eventually conflict
resolution.

**Authorization is server-side or it does not exist.** RLS on
`organization_id` plus role checks is the enforcement; hiding a button is a
courtesy to the user, not a control. See `PERMISSIONS.md`.

---

## Decisions to make before Supabase

1. **Conflict policy.** Last-write-wins per collection is what exists. Options:
   keep it and accept clobbering; move to per-entity rows so two people editing
   different ingredients never collide (recommended); or add optimistic
   concurrency on `updatedAt`. This choice determines the table layout, so it
   comes first.

2. **Document rows or entity rows.** Today a collection is one JSON blob. One
   row per collection is a two-hour migration and keeps everything working; one
   row per entity is the real answer for concurrency, querying and RLS, and is
   more work. **Recommendation: entity rows for ingredients, recipes, tables and
   waitlist entries; a settings document for the rest.**

3. **Offline posture.** The app currently works fully offline. Against a
   database that becomes "reads work from cache, writes queue or fail". Decide
   whether offline writes are a feature (a queue and a sync log) or not (a
   read-only banner). A restaurant floor with bad wifi makes this a real
   product question, not a technical one.

4. **Where the calc layer runs.** It is pure, so it can run in both places.
   Running it server-side too means reports and the AI agree with the UI to the
   penny; duplicating it in another language would guarantee they eventually
   don't.
