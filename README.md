# 86'd — Generic Bar & Grill

One browser page for the whole back of house. No build step, no server, no
account: open `index.html` and it runs. Everything is saved in the browser's
own `localStorage`, so each device keeps its own copy of the numbers.

Four sections across the top:

| Section | What it does |
| --- | --- |
| **Dashboard** | The house at a glance — the room right now, both inventories, and everything that needs attention, pulled live from the three tools below it. |
| **Food** | Ingredient costing, recipes and plate costs, the kitchen count sheet, menu engineering, usage projections and catering events. |
| **Beverage** | Ingredient costing, house-made preps, glassware, drink recipes and pour costs, the bar count sheet, usage projections and events. |
| **Front of House** | The host stand: a draggable floor plan for the dining room and the bar, table timers, and the waitlist. |
| **Ask** | A question box over everything above — what's below par, what's 86'd, what a dish earns, who's waiting. |

## The dashboard

The first page is a combined read of all three tools — tables seated, guests
in, the waitlist and its longest wait, the money sitting in both inventories,
and a single **Needs Attention** list that mixes 86'd dishes, 86'd drinks,
dirty tables, long waits and below-par counts into one place.

It never reads another tool's state directly. Each tool exposes a `summary()`
of its own numbers and that is the only thing the dashboard touches, so a tool
can change how it stores anything without breaking the front page.

## Food

- **Ingredients** — what you pay, how you buy it, and how much survives
  trimming. Everything prices down to a cost per *usable* unit.
- **Recipes** — batch yields, plate costs, target food cost %, suggested price.
- **Inventory** — the count sheet first, in whatever unit you count in, with
  par levels; below it, how many servings of each dish the shelf can produce.
- **Usage** — weekly / monthly / annual cost, revenue and profit projections.
- **Events** — catering builds with overage, a supplies list, a shopping list
  against inventory on hand, and a printable prep sheet.

## Beverage

Same shape, in a bar's units.

- **Ingredients** — spirits, mixers, juice, ice, garnish and service items.
- **Preps** — house-made syrups, concentrates and infusions, costed live from
  the raw ingredients in the batch.
- **Glassware** — glass volumes with default ice and straw.
- **Recipes** — build, glass, pour cost %, target and suggested price.
- **Inventory** — the bar count sheet first, counted in bottles, liters, pounds
  or each, then batches of house-made prep on hand, then what can be poured.
- **Usage / Events** — nightly and program-wide projections, and one-off events.

### How "Drinks Available Now" reads a prep

A drink that calls for Ginger Syrup isn't limited by the bottle of syrup —
it's limited by the ginger and sugar the next batch needs. So the availability
math expands every prep component into the raw ingredients behind it. A syrup
you can still make never reads as 86'd. The prep's own batch count lives in its
own section of the count sheet, where "below par" means *batch more*.

## Front of House

Tap a table to open it; tap it again to cycle clean → seated → dirty. Seat
timers run while a table is seated and the last turn time is kept when it
flips. **Arrange Tables** unlocks dragging so the plan can be made to match the
real room — positions save as you go and survive a shift reset.

### Pushing tables together

Drag two tables until they touch and they become one table: one unit on the
stat strip, one entry in the seating picker, one combined seat count, and a
band drawn around the run. Tapping any table in a run opens the whole run, and
a status change moves all of it — you cannot seat a new party at half a join.
Seating a party spreads it across the run, filling each table to its own seat
count before spilling into the next. Dragging them apart splits the run again.

Nothing is stored for a join. It is read from where the tables sit, so there is
no join to get out of step with the floor, and a shift reset leaves the room
arranged exactly as it was. The waitlist
stamps a quote time when a party is added and colours the wait as it runs long;
seating a party from the waitlist picks a table that actually fits it. A party
already on the list can be edited — two more showed up, a better phone number,
a different request — without restarting its quote clock.

**Friday Night** reloads a busy service worth of demo data. **Clear All** ends
the shift: empty waitlist, every table clean, notes wiped, positions kept.

## Ask

One input box, two answer sources.

**The built-in engine** needs no key, no network and no account. It matches the
question against the things a manager actually asks on shift, then computes the
answer from the same live data the tabs are showing — so its numbers are the
numbers on screen, and it cannot invent one. It handles: what's below par and
needs ordering, what's 86'd, how many of something you can still make or pour,
what a dish or drink costs and earns, what's in a recipe, best and worst
sellers by profit or popularity, what inventory is worth, the state of the
room, and the waitlist. Ask it something outside that and it says so rather
than guessing.

**Claude** picks up everything else — open-ended questions the engine has no
rule for ("what should I cut from the menu", "write the staff a note about
tonight"). It is off until someone connects a key under **Connect Claude**, and
the engine still answers first on anything it recognises, so a connected key
costs nothing on the common questions.

### About the API key

This site is static files on GitHub Pages. There is no server to keep a secret
in, so a connected key is stored in that browser's `localStorage` and sent
directly from the page to `api.anthropic.com` — the path Anthropic gates behind
an explicit `anthropic-dangerous-direct-browser-access` header. Anyone who can
use that browser profile, or run script on this origin, can read the key.

That is a reasonable trade for a back-of-house tool on the manager's own
device, and a bad one for a page the public can reach. Use a key you are
willing to rotate, put it only on the devices your managers use, and remove it
from the same dialog when a device changes hands. If you would rather no key
existed anywhere, the built-in engine alone is a complete, useful tab.

Answers use `claude-opus-5`, streamed so they appear as they are written. Each
question sends a snapshot of the current food, beverage and floor data along
with it; nothing is stored anywhere but the browser, and the transcript is
deliberately not persisted — yesterday's answers about yesterday's counts would
only mislead.

## Data

Data is reached through `platform/storage.js`, never through `localStorage`
directly, so the adapter underneath can be swapped for a real database without
touching any business logic. Keys are namespaced by organization from the
start:

| Tool | Key |
| --- | --- |
| Food | `86d:{organization}:food` |
| Beverage | `86d:{organization}:bev` |
| Front of House | `86d:{organization}:floor` |
| Audit trail | `86d:{organization}:audit` |

The organization is `demo` until authentication exists. Data written under the
older un-namespaced keys is adopted automatically on first load.

Each ships with a seeded starting set — real foodservice and wholesale pricing
for the kitchen, a working cocktail program for the bar, and a busy Friday
night for the floor — so the page shows what it does before anyone has typed
anything. Seed items carry fixed ids and a `sinceVersion` tag, so items added
in a later version merge into saved data without clobbering edits.

Each tool's **Reset Data** button puts that one tool back to its seed.

## Layout

```
index.html            the shell: masthead, section bar, every panel's container
css/styles.css        one design system; each tool restates --brand on its wrapper

js/platform/          the seam between this app and its eventual backend
  storage.js            Store + adapters — modules never touch localStorage
  org.js                which restaurant this data belongs to
  ids.js                UUIDs for records, stable slugs for seeds
  time.js               ISO 8601 UTC stored, human formatting at render
  errors.js             validation / storage / network / calculation / ai
  audit.js              who changed what, shaped like the future audit_log
  csv.js                parsing, writing and per-row validation
  portability.js        export everything; analyse an import before writing

js/core.js            DOM building, the one modal, the one toast
js/shell.js           section switching, boot, and the combined dashboard
js/food/              calc.js (pure) · storage.js (state + seed) · app.js (render)
js/bev/               same three
js/floor/             geometry.js (pure) · storage.js · demo.js · app.js
js/agent/             engine.js (offline) · context.js · service.js ·
                      provider-browser.js · app.js
tests/                node tests/run.js — no dependencies
```

Each tool's `app.js` scopes every DOM lookup to its own `#mod-*` subtree, so
all three can use the same class names without colliding. The modal and the
toast are the house's, borrowed from `Core`.

The calculation layer — `food/calc.js`, `bev/calc.js`, `floor/geometry.js` — is
pure functions over plain objects, with no DOM and no storage. That is what
makes it testable in Node, and what will let it move to a server unchanged.

## Running the tests

```
node tests/run.js
```

75 tests over the logic worth protecting: recipe and pour costing, recursive
prep expansion, inventory availability and par levels, table-join geometry and
seating, CSV parsing and validation, IDs, timestamps, the storage abstraction
and AI context scoping. No dependencies, no build step — the harness evaluates
the same source files the browser loads.

## Data portability

Nothing here holds a restaurant's data hostage.

```js
Portability.exportBundle()        // the whole organization as JSON
Portability.exportCsv("recipes")  // one sheet a spreadsheet can open
Portability.sheets()              // what can be exported
```

`Portability.analyze(sheet, csvText)` parses, maps and validates an import
without writing anything, so a file can be previewed before it lands. See
`IMPORTS.md`.

## Architecture documents

This prototype is being prepared to become a small commercial product. The
plan, and the honest account of what is not ready, live in:

| | |
|---|---|
| `ARCHITECTURE.md` | How it is built, what breaks with more than one restaurant, and the target |
| `DATA_MODEL.md` | The entities the SaaS version needs, with ownership and relationships |
| `PERMISSIONS.md` | Owner / Manager / Staff, and which existing actions need a check |
| `SECURITY.md` | Current risks and the production blockers |
| `AI_ARCHITECTURE.md` | How Ask works and where the API key has to move |
| `IMPORTS.md` | The CSV-first import workflow, and why not a POS API yet |
