# Permissions

Three roles. Nothing in this document is implemented yet — it is the
specification the next phase builds against, and the audit of which existing UI
actions will need a check.

## The rule that matters

**Permissions are enforced server-side or they are not enforced.**

Everything in this app today runs in the browser, where the user controls the
runtime. Hiding a button stops an honest person from making a mistake; it does
not stop anyone from opening the console. When Supabase arrives, every rule
below must exist as a Row Level Security policy or a server-side check. The UI
rules are a courtesy on top.

Corollary: the client may not decide its own role. The role comes from
`organization_members`, read server-side from the session.

## Roles

| | Owner | Manager | Staff / Host |
|---|---|---|---|
| Billing and subscription | ✅ | — | — |
| Organization settings (name, currency, timezone) | ✅ | — | — |
| Invite / remove users, change roles | ✅ | — | — |
| Delete the organization or its data | ✅ | — | — |
| Export all data | ✅ | ✅ | — |
| Import CSV / POS data | ✅ | ✅ | — |
| Ingredients, recipes, preps, glassware | ✅ | ✅ | read-only |
| Costing and menu pricing | ✅ | ✅ | — |
| Inventory counts, par levels | ✅ | ✅ | count only |
| Waste entries | ✅ | ✅ | ✅ |
| Purchases and vendors | ✅ | ✅ | — |
| Events | ✅ | ✅ | read-only |
| Reports and the full dashboard | ✅ | ✅ | limited |
| Floor plan — table status, seating | ✅ | ✅ | ✅ |
| Floor plan — arranging (moving tables) | ✅ | ✅ | — |
| Waitlist | ✅ | ✅ | ✅ |
| Ask / AI | ✅ | ✅ | limited scope |
| View the audit log | ✅ | ✅ | — |

An Owner is a Manager plus billing, people and destruction. There is no
separate admin.

### What "limited" means for Staff

- **Dashboard** — the room and the waitlist. Not food cost, not pour cost, not
  inventory value, not profit. A host does not need to know the margin on the
  ribeye, and on a shared terminal that is a real disclosure.
- **Ask / AI** — the same restriction, enforced by the context builder, not by
  filtering the answer. A Staff question retrieves only floor-scoped data, so
  the model is never given the costing figures in the first place. This is the
  reason `agent/context.js` builds context from a scope rather than dumping
  state, and the reason that build has to move server-side.

## Actions in the current UI that will need authorization

Audited against the code as it stands. Each will need a server-side check and,
secondarily, UI hiding.

### Owner only
| Where | Action |
|---|---|
| Food tab → Reset Data | Destroys the food program |
| Beverage tab → Reset Data | Destroys the beverage program |
| Ask tab → Connect / Remove key | A credential and a spend commitment |
| (future) Settings | Organization name, currency, timezone |
| (future) Members | Invite, remove, change role |
| (future) Billing | Plan, payment method, cancellation |

### Manager and above
| Where | Action |
|---|---|
| Food/Bev → Add, Edit, Delete ingredient | Changes costing everywhere |
| Food/Bev → Add, Edit, Delete recipe | Same |
| Beverage → Add, Edit, Delete prep, glassware | Same |
| Inventory → Par level fields | Par drives ordering |
| Inventory → Fill All To Par | Mass inventory write |
| Usage → servings per week/night | Drives every projection |
| Events → create, edit, duplicate, delete | Money commitments |
| Events → Deduct From Inventory | Mass inventory write |
| Events → Download prep sheet | Contains costing |
| Floor → Arrange Tables, Reset Positions | Changes the room for everyone |
| Floor → Friday Night (demo data) | Overwrites live service state |
| Floor → Clear All | Ends the shift for everyone |
| (future) Import | Can create or overwrite many records |
| (future) Export | Removes data from the system |

### Any role, including Staff
| Where | Action |
|---|---|
| Floor → tap a table, set status, set guests | The job |
| Floor → table note | The job |
| Waitlist → add, edit, seat, remove a party | The job |
| Ask → ask a question | Within the role's scope |
| (future) Record waste | Deliberately open: the alternative is unrecorded waste |

### Notable: two destructive actions are currently one tap from a host

`Friday Night` overwrites the live floor with demo data, and `Clear All` ends
the shift — both sit in the Front of House header, which is exactly where a
host works. Under the table above both are Manager-only. Until roles exist,
they are guarded only by a confirm dialog. **This is the most likely
real-world accident in the current build.**

## Mapping to Postgres

Sketch, to be firmed up with the schema:

```sql
-- every restaurant-owned table
alter table ingredients enable row level security;

create policy ingredients_read on ingredients for select
  using (organization_id in (
    select organization_id from organization_members
    where user_id = auth.uid() and accepted_at is not null and deleted_at is null
  ));

create policy ingredients_write on ingredients for all
  using (organization_id in (
    select organization_id from organization_members
    where user_id = auth.uid() and role in ('owner','manager')
      and accepted_at is not null and deleted_at is null
  ));
```

Tables staff may write (`tables`, `waitlist_entries`, `waste_entries`) get a
third policy including `'staff'`. `audit_log` gets select-only for
owner/manager and no client insert at all.

A helper (`auth_role_in(org, roles[])`) is worth writing once rather than
repeating the subquery on every table — it is the kind of thing that silently
drifts and leaves one table readable by everyone.

## Test before launch

Not optional, and cheap to write once the schema exists:

1. A member of org A cannot read, write or delete a single row of org B —
   tested per table, not per feature.
2. A Staff session cannot read costing columns or write an ingredient.
3. A removed member loses access immediately, not at their next login.
4. An invite that was never accepted grants nothing.
5. The audit log cannot be written or altered from a client session.
