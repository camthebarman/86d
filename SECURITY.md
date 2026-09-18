# Security

An audit of the current build, and the list that has to be cleared before
anyone pays for this.

The app is static files with no server and no accounts. That makes some
categories (SQL injection, session fixation, SSRF) not yet applicable, and
makes one category — client-side credentials — much worse than usual.

---

## PRODUCTION BLOCKERS

Ship none of this to a paying customer.

### 1. The Anthropic API key lives in the browser · **BLOCKER**

`js/agent/provider-browser.js` reads a key from `localStorage` and sends it to
`api.anthropic.com` from the page, using the header Anthropic requires for
direct browser access — a header whose name
(`anthropic-dangerous-direct-browser-access`) is itself the warning.

**Why it is a blocker.** Anyone who can use that browser profile can read the
key from the console in one line. It is billed to whoever owns it, with no
per-restaurant limit and no revocation short of rotating the key everywhere.
On a shared back-office terminal — which is where this software lives — the
threat model is not hypothetical.

**Required fix.** The key exists only server-side. The browser calls an
authenticated endpoint; the server resolves the organization from the session,
builds the context and calls the model. `AgentService.use(ServerProvider)` is
the whole client change — see `AI_ARCHITECTURE.md`.

**Interim mitigation, while it remains a dev shim:** it is opt-in, it is off by
default, the built-in engine answers the common questions with no key at all,
the dialog states the risk before accepting a key, and the key is stored under
`86d:credential:*` so it is excluded from every export and backup by
construction.

### 2. No authentication · **BLOCKER**

There are no users, no sessions and no access control. Anyone who can open the
URL has full control of the data. Acceptable for a single-operator prototype,
not for a product.

### 3. No authorization · **BLOCKER**

Every role in `PERMISSIONS.md` is unimplemented. When it is implemented it must
be server-side: RLS policies on `organization_id` plus role checks. **UI hiding
is not a control.**

### 4. Data lives only in one browser · **BLOCKER (data loss)**

Clearing site data deletes a restaurant's inventory permanently. There is no
server copy and no automatic backup. This is a data-durability blocker even
before it is a security one.

---

## Current risks (lower severity)

### 5. No transport or storage encryption for business data
`localStorage` is plaintext, readable by any script on the origin and by anyone
with the device. Cost structures and supplier pricing are commercially
sensitive. Resolved by moving to a database over TLS with encryption at rest.

### 6. Prompt injection · **partially mitigated**
Restaurant data contains free text an untrusted party can influence: a guest
name on the waitlist, a table note, an imported product description. That text
is sent to a model.

Mitigations in place: the system prompt states the data is records and never
instructions, and tells the model not to follow instructions inside it; the
data is fenced as JSON; and the context is scoped, so the reachable surface is
much smaller than it was.

Remaining risk: prompt-level defences are not guarantees. The real control is
that the model has **no tools and no write path** — it produces text. Keep it
that way. If the AI is ever given the ability to change data, injection stops
being a nuisance and becomes remote code execution by another name.

### 7. Imported CSV is untrusted input
Files come from a POS, a distributor or a customer's own spreadsheet.
`platform/csv.js` parses defensively and validates per row. Two things still
need attention before import ships:
- **CSV injection on export** — a field beginning `=`, `+`, `-` or `@` executes
  as a formula when opened in Excel. Exports must prefix those with `'`.
- **Size limits** — an unbounded file parsed in the browser is a denial of
  service against the user's own tab. Cap rows and bytes.

### 8. XSS — currently clean, needs to stay that way
Every value reaches the DOM as a text node. The `html:` escape hatch in
`Core.el` has been removed. There is no `eval`, no `new Function`, no
`innerHTML` with interpolated data (verified by grep, and worth a CI check).
`innerHTML = ""` for clearing is safe.

When a server arrives, add a Content-Security-Policy. It cannot be tightened
fully today because the AI provider needs `connect-src api.anthropic.com` —
which disappears with blocker #1.

### 9. No rate limiting anywhere
A stuck loop or a bored user can spend real money on AI calls. Needs per-
organization limits server-side, and a visible spend indicator.

### 10. Audit log is client-side and editable
`platform/audit.js` writes to the same store the user controls, capped at 500
entries. Fine as a device buffer; it is not evidence. The server log must be
append-only with no client insert policy.

### 11. Third-party exposure: none
No CDN, no analytics, no fonts, no trackers, no dependencies. The only outbound
request is the AI call. This is worth protecting — it is unusual and it makes
everything above easier to reason about.

---

## Not applicable yet

SQL injection (no database), CSRF (no cookies, no server), session management,
password storage, OAuth flows, file upload handling, server-side SSRF. All
become relevant in the next phase.

---

## Required before production — checklist

| | Item |
|---|---|
| ☐ | AI key removed from the client; server-side endpoint only |
| ☐ | Authentication implemented |
| ☐ | RLS on `organization_id` for every restaurant-owned table |
| ☐ | Role checks enforced server-side, tested cross-tenant |
| ☐ | Server-side durable storage, so a cleared browser is not data loss |
| ☐ | Append-only audit log the client cannot write |
| ☐ | Per-organization AI rate limits and spend visibility |
| ☐ | CSV formula-injection escaping on export |
| ☐ | Import size and row caps |
| ☐ | Content-Security-Policy header |
| ☐ | Backup and restore proven by an actual restore, not by the existence of a backup |
| ☐ | A written answer to "a customer asks us to delete their data" |
