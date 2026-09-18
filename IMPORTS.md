# Imports

How restaurant data gets into 86'd. CSV first, and probably CSV for a long
time.

## Why CSV before any POS API

Toast, Square and Lightspeed all have APIs. All of them need partner
registration, OAuth, per-merchant authorization and a review process, and the
restaurant has to be on a plan that includes API access. A CSV export is
something a manager can produce in thirty seconds from a POS they already have,
on any plan, without asking anyone's permission.

So: **the first integration is a file, not an API.** The data model is designed
so that the API version later is a different importer writing the same rows —
not a different application.

## The workflow

```
upload → detect columns → map columns → preview → validate → import → report
```

Each step exists because a real file fails at it.

### 1. Upload
A `.csv` the manager exported. Never fetched from anywhere; never requiring a
credential. Size and row caps apply (`SECURITY.md` #7).

### 2. Detect columns
`Csv.parseObjects()` reads the header row. Duplicate headers are suffixed
rather than silently overwriting each other — POS exports do produce two
columns called "Cost".

### 3. Map columns
`Csv.suggestMapping()` guesses from a list of aliases: "Item Name", "Product",
"Description" all mean `name`; "Case Price", "Unit Cost", "Cost" all mean
`purchaseCost`. The guess is a starting point and **the manager confirms it**.
Never import on a guess alone — a mis-mapped cost column silently corrupts
every recipe that uses the ingredient.

Mappings should eventually be saved per organization per source, because the
same restaurant re-imports the same report every week.

### 4. Preview
`Portability.analyze()` does everything except write: parse, map, validate,
dedupe. It returns the rows that would be created, the rows that would be
skipped and why, and a count of each. **Nothing is written until the manager
sees this.**

### 5. Validate
Per row, never fail-fast. A 400-row file with four bad rows should import 396
and hand back four line numbers.

Rules in `platform/csv.js`:
- required columns present, and non-empty per row
- numbers parse — including `$1,234.50` and `(12.00)` for negatives
- values within range (a yield of 300% is a typo)
- values within an allowed set where one exists
- **duplicates within the file are rejected**, matched on the key column

Every error carries the spreadsheet line number the manager sees, the column
name and a sentence they can act on.

### 6. Import
Match existing records **by name within the organization**, case-insensitively.
Three outcomes per row, and the manager chooses the policy before committing:

| | |
|---|---|
| **Create** | No match. Insert. |
| **Update** | Match. Update the mapped columns only — never blank a column the file did not contain. |
| **Skip** | Match, and the policy is create-only. |

Never blind-insert. The failure mode of a naive importer is a second copy of a
distributor's entire catalogue, which is worse than importing nothing.

Writes happen in one transaction: an import either lands or it does not.

### 7. Report
What was created, updated, skipped and rejected, with the rejected rows
downloadable as a CSV the manager can fix and re-upload. An `import.performed`
audit entry records who, when, which file and the counts.

## Supported sheets

Implemented in `platform/portability.js`:

| Sheet | Key | Maps to |
|---|---|---|
| `ingredients` | name | Ingredient (kitchen) |
| `beverages` | name | Ingredient (bar) |
| `sales` | itemName | SalesLine → MenuItem |

Recipes and menu items export today and will import once entity rows exist —
a recipe import has to resolve ingredient references, which is much safer
against real rows than against a JSON blob.

## POS sales imports specifically

A POS sales export reduces to four columns, whatever the vendor calls them:

| Field | Aliases seen in the wild |
|---|---|
| `itemName` | Item, Menu Item, Item Name, Product |
| `quantity` | Qty, Count, Items Sold, Sold |
| `netSales` | Net Sales, Sales, Revenue, Net Amount |
| `date` | Business Date, Order Date, Day |

**Nothing about this is Toast-specific**, and that is deliberate. `SalesImport`
carries a `source` field; Toast is one value of it. A Square export with
different headers is a new alias list, not new code.

### Matching sales to menu items

The hard part. POS item names do not match recipe names: "CHEESEBURGER" vs
"Classic Cheeseburger & Fries", plus modifiers, plus seasonal renames.

The model handles this with `MenuItem.pos_external_id` and `MenuItem.pos_name`
(`DATA_MODEL.md`). First import, most rows will not match; the unmatched list
is the useful output, and the manager links them once. After that the link
holds, because `pos_external_id` is stable even when the display name changes.

Unmatched sales lines are **kept, not discarded** — the revenue total must
still be right even when the item attribution is not.

### What sales data unlocks

This is why it is worth building: theoretical usage (sales × recipe) compared
against actual usage (counted inventory) gives **variance** — the number that
tells a restaurant where the money is going. That single report is the reason
this category of software gets paid for, and it needs exactly two things: an
accurate recipe and an accurate sales count.

## Exports

Same tables, out. `Portability.exportCsv(sheet)` and `exportBundle()` for the
full JSON backup. A customer can always take their data and leave — see
`README.md` § Data portability.

One thing to fix before export ships: a cell starting `=`, `+`, `-` or `@`
executes as a formula in Excel. Prefix those with `'`.
