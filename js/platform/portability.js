/* platform/portability.js — the customer's data is the customer's.

   A restaurant paying $59 a month must be able to leave with everything they
   typed in, in a format a spreadsheet can open. Nothing here is behind a
   plan, a flag or a support ticket.

   Two shapes:
   - a full JSON bundle, which is a backup and can be restored
   - per-entity CSV, which is what a human actually opens and edits

   The importer is conservative on purpose: it matches existing records by
   name, reports every problem with a line number, and previews before it
   writes. An import that silently duplicates a supplier's whole catalogue is
   worse than one that refuses. */

const Portability = (function () {
  const BUNDLE_VERSION = 1;

  // ---------- export ----------
  // Modules register a reader so the export reflects what the app currently
  // holds, not just what has been written back. A restaurant that has never
  // edited its seeded menu must still be able to export that menu — reading
  // the store alone would hand them an empty file.
  const sources = new Map();
  function registerSource(collection, read) { sources.set(collection, read); }

  function collections() {
    const names = new Set(Store.list().concat(Array.from(sources.keys())));
    const out = {};
    names.forEach((name) => {
      const read = sources.get(name);
      let value = null;
      if (read) {
        try { value = read(); } catch (e) { value = null; }
      }
      out[name] = value == null ? Store.get(name, null) : value;
    });
    return out;
  }

  function bundle() {
    return {
      format: "86d.export",
      version: BUNDLE_VERSION,
      exportedAt: Time.now(),
      organization: { id: Org.id(), name: Org.name(), currency: Org.currency(), isDemo: Org.isDemo() },
      collections: collections(),
    };
  }

  function exportBundle() {
    Audit.record(Audit.ACTIONS.DATA_EXPORTED, { entity: "organization", entityId: Org.id(), summary: "Full data export" });
    return JSON.stringify(bundle(), null, 2);
  }

  // The CSV views. Each is a flat table a human can read, edit and hand back.
  const SHEETS = {
    ingredients: {
      label: "Food ingredients",
      columns: ["name", "category", "purchaseQty", "purchaseUnit", "purchaseCost", "yieldPct", "onHandQty", "parQty", "countUnit"],
      rows: () => (read("food", { ingredients: [] }).ingredients || []).map((i) => ({
        name: i.name, category: i.category,
        purchaseQty: i.purchaseQty, purchaseUnit: i.purchaseUnit, purchaseCost: i.purchaseCost,
        yieldPct: i.yieldPct, onHandQty: i.onHandQty, parQty: i.parQty, countUnit: i.countUnit || i.purchaseUnit,
      })),
    },
    beverages: {
      label: "Bar ingredients",
      columns: ["name", "category", "purchaseQty", "purchaseUnit", "purchaseCost", "onHandQty", "parQty", "countUnit"],
      rows: () => (read("bev", { ingredients: [] }).ingredients || []).map((i) => ({
        name: i.name, category: i.category,
        purchaseQty: i.purchaseQty, purchaseUnit: i.purchaseUnit, purchaseCost: i.purchaseCost,
        onHandQty: i.onHandQty, parQty: i.parQty, countUnit: i.countUnit || i.purchaseUnit,
      })),
    },
    recipes: {
      label: "Food recipes",
      columns: ["name", "menu", "portions", "menuPrice", "targetFoodCostPct", "servingsPerWeek", "components"],
      rows: () => (read("food", { recipes: [] }).recipes || []).map((r) => ({
        name: r.name, menu: r.menu, portions: r.portions, menuPrice: r.menuPrice,
        targetFoodCostPct: r.targetFoodCostPct, servingsPerWeek: r.servingsPerWeek,
        // One cell, because a recipe is one row to a human. Parsed back on import.
        components: (r.components || []).map((c) => `${c.ingredientId}:${c.qty}`).join("; "),
      })),
    },
    drinks: {
      label: "Drink recipes",
      columns: ["name", "category", "glassId", "menuPrice", "targetPourCostPct", "servingsPerNight", "components"],
      rows: () => (read("bev", { recipes: [] }).recipes || []).map((r) => ({
        name: r.name, category: r.category, glassId: r.glassId, menuPrice: r.menuPrice,
        targetPourCostPct: r.targetPourCostPct, servingsPerNight: r.servingsPerNight,
        components: (r.components || []).map((c) => `${c.ingredientId}:${c.qty}`).join("; "),
      })),
    },
  };

  function read(collection, fallback) {
    const source = sources.get(collection);
    if (source) {
      try {
        const value = source();
        if (value != null) return value;
      } catch (e) { /* fall through to the store */ }
    }
    return Store.get(collection, fallback);
  }

  function exportCsv(sheetName) {
    const sheet = SHEETS[sheetName];
    if (!sheet) throw AppErrors.validation(`There is no "${sheetName}" export.`, { sheetName, available: Object.keys(SHEETS) });
    Audit.record(Audit.ACTIONS.DATA_EXPORTED, { entity: sheetName, summary: `${sheet.label} exported as CSV` });
    return Csv.format(sheet.rows(), sheet.columns);
  }

  function sheets() {
    return Object.keys(SHEETS).map((k) => ({ id: k, label: SHEETS[k].label, columns: SHEETS[k].columns }));
  }

  // ---------- import ----------
  // Column specs per sheet. `aliases` is what other people's exports call the
  // same thing, which is most of the work in any real import.
  const IMPORT_FIELDS = {
    ingredients: [
      { name: "name", aliases: ["item", "product", "description", "ingredient"], required: true },
      { name: "category", aliases: ["type", "group"] },
      { name: "purchaseQty", aliases: ["pack size", "packsize", "qty", "quantity", "case size"], type: "number" },
      { name: "purchaseUnit", aliases: ["unit", "uom", "pack uom"] },
      { name: "purchaseCost", aliases: ["cost", "price", "case price", "unit cost"], type: "money" },
      { name: "yieldPct", aliases: ["yield", "yield %", "usable %"], type: "number" },
      { name: "onHandQty", aliases: ["on hand", "count", "qty on hand"], type: "number" },
      { name: "parQty", aliases: ["par", "par level"], type: "number" },
    ],
    beverages: [
      { name: "name", aliases: ["item", "product", "description"], required: true },
      { name: "category", aliases: ["type", "group"] },
      { name: "purchaseQty", aliases: ["pack size", "size", "qty"], type: "number" },
      { name: "purchaseUnit", aliases: ["unit", "uom"] },
      { name: "purchaseCost", aliases: ["cost", "price", "bottle cost"], type: "money" },
      { name: "onHandQty", aliases: ["on hand", "count"], type: "number" },
      { name: "parQty", aliases: ["par", "par level"], type: "number" },
    ],
    // The shape a Toast-style sales export reduces to. Nothing here is
    // Toast-specific: it is menu item, quantity, money, over a date range.
    sales: [
      { name: "itemName", aliases: ["item", "menu item", "item name", "product"], required: true },
      { name: "quantity", aliases: ["qty", "count", "items sold", "sold"], type: "number", required: true },
      { name: "netSales", aliases: ["net sales", "sales", "revenue", "net amount"], type: "money" },
      { name: "date", aliases: ["business date", "order date", "day"] },
    ],
  };

  function specFor(sheetName, mapping) {
    const fields = IMPORT_FIELDS[sheetName];
    if (!fields) throw AppErrors.validation(`There is no "${sheetName}" importer.`, { sheetName });
    const spec = {};
    fields.forEach((f) => {
      const column = (mapping && mapping[f.name]) || f.name;
      spec[column] = { as: f.name, required: !!f.required, type: f.type };
    });
    return spec;
  }

  // Parse + map + validate, WITHOUT writing. This is the preview step: the
  // caller shows the rows and the errors and only then decides to commit.
  function analyze(sheetName, text, mapping) {
    const fields = IMPORT_FIELDS[sheetName];
    if (!fields) throw AppErrors.validation(`There is no "${sheetName}" importer.`, { sheetName });
    const { headers, records } = Csv.parseObjects(text);
    if (!headers.length) throw AppErrors.validation("That file has no header row.", { sheetName });

    const resolved = mapping || Csv.suggestMapping(headers, fields);
    const missingRequired = fields
      .filter((f) => f.required && !resolved[f.name])
      .map((f) => f.name);

    const result = Csv.validate(records, specFor(sheetName, resolved), { dedupeOn: fields[0].name });
    return {
      sheet: sheetName,
      headers,
      mapping: resolved,
      missingRequired,
      rows: result.rows,
      errors: missingRequired
        .map((f) => ({ line: 1, column: f, kind: "missing_column", message: `No column is mapped to "${f}".` }))
        .concat(result.errors),
      ok: result.ok && !missingRequired.length,
      counts: { parsed: records.length, valid: result.rows.length, rejected: records.length - result.rows.length },
    };
  }

  return { bundle, exportBundle, exportCsv, sheets, analyze, specFor, registerSource, collections, IMPORT_FIELDS, SHEETS, BUNDLE_VERSION };
})();

if (typeof module !== "undefined" && module.exports) module.exports = { Portability };
