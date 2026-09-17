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
- **Insights** — popularity, menu engineering quadrants, cross-utilization,
  orphan ingredients and workhorse ingredients.
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
real room — positions save as you go and survive a shift reset. The waitlist
stamps a quote time when a party is added and colours the wait as it runs long;
seating a party from the waitlist picks a table that actually fits it. A party
already on the list can be edited — two more showed up, a better phone number,
a different request — without restarting its quote clock.

**Friday Night** reloads a busy service worth of demo data. **Clear All** ends
the shift: empty waitlist, every table clean, notes wiped, positions kept.

## Data

Each tool keeps its own key, so resetting one never touches another:

| Tool | localStorage key |
| --- | --- |
| Food | `gbg.food.v1` |
| Beverage | `gbg.bev.v1` |
| Front of House | `gbg.floor.v1` |

Each ships with a seeded starting set — real foodservice and wholesale pricing
for the kitchen, a working cocktail program for the bar, and a busy Friday
night for the floor — so the page shows what it does before anyone has typed
anything. Seed items carry fixed ids and a `sinceVersion` tag, so items added
in a later version merge into saved data without clobbering edits.

Each tool's **Reset Data** button puts that one tool back to its seed.

## Layout

```
index.html          the shell: masthead, section bar, every panel's container
css/styles.css      one design system; each tool restates --brand on its wrapper
js/core.js          shared helpers: DOM building, the one modal, the one toast
js/shell.js         section switching and the combined dashboard
js/food/            calc.js (pure math) · storage.js (state + seed) · app.js (render)
js/bev/             same three
js/floor/           demo.js (Friday night) · storage.js · app.js
```

Each tool's `app.js` scopes every DOM lookup to its own `#mod-*` subtree, so
all three can use the same class names without colliding. The modal and the
toast are the house's, borrowed from `Core`.
