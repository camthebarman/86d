/* tests/run.js — everything worth protecting before storage moves to a database.

   These cover calculations, not pixels. A UI snapshot test would break every
   time someone adjusts a margin; these break only when the business logic is
   wrong, which is the thing that must survive the SaaS migration intact.

   Run with:  node tests/run.js */

const { createSandbox, load, describe, it, expect, run } = require("./harness");

// The platform and the pure calculation modules, in index.html's order.
const sandbox = createSandbox();
load(sandbox, [
  "js/platform/errors.js",
  "js/platform/ids.js",
  "js/platform/time.js",
  "js/platform/org.js",
  "js/platform/storage.js",
  "js/platform/csv.js",
  "js/food/calc.js",
  "js/bev/calc.js",
  "js/floor/geometry.js",
  "js/agent/context.js",
]);
const { Ids, Time, Org, Store, Csv, FoodCalc, BevCalc, FloorGeometry, AgentContext, AppErrors } = sandbox;

// ---------------------------------------------------------------- ids
describe("identifiers", () => {
  it("mints RFC 4122 v4 uuids", () => {
    const id = Ids.uuid();
    expect(Ids.isUuid(id)).toBeTruthy();
    expect(id[14]).toBe("4");
  });
  it("never repeats", () => {
    const seen = new Set();
    for (let i = 0; i < 2000; i++) seen.add(Ids.uuid());
    expect(seen.size).toBe(2000);
  });
  it("keeps a readable prefix without breaking uniqueness", () => {
    const id = Ids.prefixed("rec");
    expect(id.slice(0, 4)).toBe("rec_");
    expect(Ids.isUuid(id.slice(4))).toBeTruthy();
  });
  it("builds stable seed keys from names", () => {
    expect(Ids.seedKey("ing", "Chicken Breast")).toBe("ing_chicken_breast");
    expect(Ids.seedKey("ing", "Flour Tortilla (12\")")).toBe("ing_flour_tortilla_12");
  });
});

// ---------------------------------------------------------------- time
describe("timestamps", () => {
  it("stamps in ISO 8601 UTC", () => {
    const t = Time.now();
    expect(Time.isIso(t)).toBeTruthy();
    expect(t.endsWith("Z")).toBeTruthy();
  });
  it("reads epoch milliseconds and ISO alike, so a half-migrated store works", () => {
    const epoch = 1789000000000;
    expect(Time.ms(epoch)).toBe(epoch);
    expect(Time.ms(new Date(epoch).toISOString())).toBe(epoch);
  });
  it("survives a round trip", () => {
    const iso = Time.now();
    expect(Time.iso(Time.ms(iso))).toBe(iso);
  });
  it("returns null for nonsense rather than NaN", () => {
    expect(Time.ms(null)).toBeNull();
    expect(Time.ms("not a date")).toBeNull();
  });
  it("measures elapsed time from either format", () => {
    const tenMinutesAgo = Date.now() - 600000;
    expect(Time.since(tenMinutesAgo)).toBeCloseTo(600000, -4);
    expect(Time.since(new Date(tenMinutesAgo).toISOString())).toBeCloseTo(600000, -4);
  });
  it("keeps a date-only value date-only", () => {
    expect(Time.isDateOnly("2026-10-11")).toBeTruthy();
    expect(Time.isDateOnly(Time.now())).toBeFalsy();
  });
});

// ---------------------------------------------------------------- storage
describe("storage abstraction", () => {
  it("namespaces every key by organization", () => {
    expect(Store.keyFor("food")).toBe("86d:demo:food");
    expect(Store.keyFor("food", "acme")).toBe("86d:demo:food".replace("demo", "acme"));
  });
  it("round-trips through an adapter without the app knowing which one", async () => {
    Store.use(Store.MemoryAdapter());
    await Store.hydrate(["food"]);
    await Store.set("food", { ingredients: [{ id: "a" }] });
    expect(Store.get("food").ingredients).toHaveLength(1);
  });
  it("wraps payloads in a row-shaped envelope", () => {
    const env = Store.envelope("food", { x: 1 });
    expect(env.org).toBe("demo");
    expect(env.collection).toBe("food");
    expect(Time.isIso(env.updatedAt)).toBeTruthy();
    expect(env.data).toEqual({ x: 1 });
  });
  it("adopts data written before organizations existed", async () => {
    const legacy = Store.MemoryAdapter({ "gbg.food.v1": JSON.stringify({ ingredients: ["old"] }) });
    Store.use(legacy);
    await Store.hydrate(["food"]);
    expect(Store.get("food").ingredients).toEqual(["old"]);
    // and rewrites it into the namespaced key
    const moved = JSON.parse(await legacy.read("86d:demo:food"));
    expect(moved.data.ingredients).toEqual(["old"]);
  });
  it("reports a failed write instead of losing it silently", async () => {
    const broken = Store.MemoryAdapter();
    broken.write = async () => { throw AppErrors.storage("disk full"); };
    Store.use(broken);
    await Store.hydrate([]);
    let caught = null;
    Store.onWriteErrorUse((e) => { caught = e; });
    await Store.set("food", { a: 1 }).catch(() => {});
    expect(AppErrors.is(caught, "storage")).toBeTruthy();
  });
  it("keeps two organizations apart on one device", async () => {
    const shared = Store.MemoryAdapter();
    Store.use(shared);
    await Store.hydrate([]);
    await Store.set("food", { who: "demo" });
    Org.set({ id: "acme", name: "Acme Tavern" });
    Store.use(shared);
    await Store.hydrate([]);
    await Store.set("food", { who: "acme" });
    expect(JSON.parse(await shared.read("86d:demo:food")).data.who).toBe("demo");
    expect(JSON.parse(await shared.read("86d:acme:food")).data.who).toBe("acme");
    Org.set(Org.DEMO);
  });
});

// ---------------------------------------------------------------- food costing
describe("recipe costing", () => {
  const flour = { id: "f", name: "Flour", baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 50, purchaseCost: 25, yieldPct: 100 };
  const romaine = { id: "r", name: "Romaine", baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 20, purchaseCost: 40, yieldPct: 80 };
  const resolve = (id) => ({ f: flour, r: romaine }[id]);

  it("prices a purchase pack down to the base unit", () => {
    // 50 lb = 800 oz for $25
    expect(FoodCalc.costPerBaseUnit(flour)).toBeCloseTo(25 / 800, 6);
  });
  it("charges the yield loss to the plate, not the invoice", () => {
    // $2/lb = $0.125/oz as purchased; at 80% usable that is $0.15625 per usable oz
    expect(FoodCalc.costPerBaseUnit(romaine)).toBeCloseTo(0.125, 5);
    expect(FoodCalc.costPerUsableUnit(romaine)).toBeCloseTo(0.15625, 5);
  });
  it("divides a batch by its yield to get a plate cost", () => {
    const recipe = { portions: 8, components: [{ ingredientId: "f", qty: 160 }] };
    expect(FoodCalc.recipeBatchCost(recipe, resolve)).toBeCloseTo(5, 5);
    expect(FoodCalc.recipeCost(recipe, resolve)).toBeCloseTo(0.625, 5);
  });
  it("treats a missing portions count as one rather than dividing by zero", () => {
    const recipe = { components: [{ ingredientId: "f", qty: 160 }] };
    expect(FoodCalc.recipeCost(recipe, resolve)).toBeCloseTo(5, 5);
  });
  it("derives price, food cost % and margin consistently", () => {
    expect(FoodCalc.suggestedPrice(5, 25)).toBeCloseTo(20, 5);
    expect(FoodCalc.foodCostPct(5, 20)).toBeCloseTo(25, 5);
    expect(FoodCalc.grossProfit(5, 20)).toBeCloseTo(15, 5);
    expect(FoodCalc.marginPct(5, 20)).toBeCloseTo(75, 5);
  });
  it("does not divide by a zero price", () => {
    expect(FoodCalc.foodCostPct(5, 0)).toBe(0);
    expect(FoodCalc.suggestedPrice(5, 0)).toBe(0);
  });
});

// ---------------------------------------------------------------- inventory
describe("inventory availability and par", () => {
  const beef = { id: "b", name: "Beef", baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 10, purchaseCost: 60, yieldPct: 100, onHandQty: 160, parQty: 96 };
  const bun = { id: "n", name: "Bun", baseUnit: "each", purchaseUnit: "each", purchaseQty: 96, purchaseCost: 96, yieldPct: 100, onHandQty: 20, parQty: 48 };
  const resolve = (id) => ({ b: beef, n: bun }[id]);
  const burger = { portions: 1, components: [{ ingredientId: "b", qty: 6 }, { ingredientId: "n", qty: 1 }] };

  it("flags an item under par and only under par", () => {
    expect(FoodCalc.belowPar(bun)).toBeTruthy();
    expect(FoodCalc.belowPar(beef)).toBeFalsy();
  });
  it("treats a zero par as 'not tracked' rather than 'always short'", () => {
    expect(FoodCalc.belowPar({ onHandQty: 0, parQty: 0 })).toBeFalsy();
  });
  it("values what is on the shelf at what it cost", () => {
    expect(FoodCalc.inventoryValue(beef)).toBeCloseTo(160 * (60 / 160), 5);
  });
  it("finds the ingredient that runs out first", () => {
    const avail = FoodCalc.maxPortions(burger, resolve);
    expect(avail.portions).toBe(20);          // 20 buns, though beef covers 26
    expect(avail.limitedBy.name).toBe("Bun");
  });
  it("counts an unmakeable dish as zero, not as infinite", () => {
    const empty = { portions: 1, components: [{ ingredientId: "n", qty: 1 }] };
    const avail = FoodCalc.maxPortions(empty, (id) => ({ ...bun, onHandQty: 0 }));
    expect(avail.portions).toBe(0);
  });
  it("applies yield to what the shelf can actually produce", () => {
    const trimmed = { id: "t", baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 1, purchaseCost: 1, yieldPct: 50, onHandQty: 100 };
    expect(FoodCalc.usableOnHand(trimmed)).toBeCloseTo(50, 5);
  });
  it("turns a shortfall into whole purchase packs", () => {
    const short = FoodCalc.shortfall({ ingredient: bun, asPurchasedQty: 200 });
    expect(short.shortQty).toBeCloseTo(180, 5);
    expect(short.packs).toBe(2);              // 96 to a case, so two cases
    expect(short.buyCost).toBeCloseTo(192, 5);
  });
  it("reports days of cover against the run rate", () => {
    expect(FoodCalc.daysOfCover(70, 70)).toBeCloseTo(7, 5);
    expect(FoodCalc.daysOfCover(10, 0)).toBeNull();
  });
});

// ---------------------------------------------------------------- beverage + preps
describe("beverage costing and recursive preps", () => {
  const sugar = { id: "sugar", name: "Sugar", baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 1, purchaseCost: 2, onHandQty: 160, parQty: 16 };
  const ginger = { id: "ginger", name: "Ginger", baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 1, purchaseCost: 8, onHandQty: 32, parQty: 16 };
  const vodka = { id: "vodka", name: "Vodka", baseUnit: "floz", purchaseUnit: "ml", purchaseQty: 750, purchaseCost: 12, onHandQty: 100, parQty: 25 };
  const ingredients = { sugar, ginger, vodka };
  const getIngredient = (id) => ingredients[id] || null;

  // 32 fl oz of syrup from 16 oz sugar + 8 oz ginger
  const syrup = {
    id: "prep_ginger", name: "Ginger Syrup", baseUnit: "floz", yieldQty: 32,
    components: [{ ingredientId: "sugar", qty: 16 }, { ingredientId: "ginger", qty: 8 }],
  };
  const getPrep = (id) => (id === "prep_ginger" ? syrup : null);
  const mule = { components: [{ ingredientId: "vodka", qty: 2 }, { ingredientId: "prep_ginger", qty: 1 }] };

  it("costs a prep batch from its raw ingredients", () => {
    // 16 oz sugar at $2/lb = $2.00; 8 oz ginger at $8/lb = $4.00
    expect(BevCalc.prepBatchCost(syrup, getIngredient)).toBeCloseTo(6, 5);
    expect(BevCalc.prepCostPerUnit(syrup, getIngredient)).toBeCloseTo(6 / 32, 5);
  });
  it("prices a drink that uses a prep as if the prep were an ingredient", () => {
    const resolve = (id) => getIngredient(id) || BevCalc.prepAsIngredient(getPrep(id), getIngredient);
    // 2 fl oz vodka (750ml = 25.36 fl oz for $12) + 1 fl oz syrup at $0.1875
    expect(BevCalc.recipeCost(mule, resolve)).toBeCloseTo(2 * (12 / 25.3605) + 0.1875, 3);
  });
  it("expands a prep back into raw ingredients for availability", () => {
    const reqs = BevCalc.rawRequirements(mule, getIngredient, getPrep);
    const byName = {};
    reqs.forEach((r) => (byName[r.ingredient.name] = r.qty));
    expect(byName.Vodka).toBeCloseTo(2, 5);
    expect(byName.Sugar).toBeCloseTo(0.5, 5);    // 16 oz per 32 fl oz batch
    expect(byName.Ginger).toBeCloseTo(0.25, 5);  // 8 oz per 32 fl oz batch
  });
  it("limits a drink by the raw ingredient behind its prep, not the bottle", () => {
    const avail = BevCalc.maxServings(mule, getIngredient, getPrep);
    // ginger: 32 oz on hand / 0.25 per drink = 128; vodka: 100 / 2 = 50
    expect(avail.servings).toBe(50);
    expect(avail.limitedBy.name).toBe("Vodka");
  });
  it("expands a prep exactly one level, so a self-referential prep can't loop", () => {
    // Preps are built from raw ingredients only, never from other preps. That
    // rule is what makes the expansion terminate: a prep inside a prep simply
    // resolves to nothing rather than recursing.
    const loop = { id: "p", baseUnit: "floz", yieldQty: 10, components: [{ ingredientId: "p", qty: 1 }] };
    const reqs = BevCalc.rawRequirements({ components: [{ ingredientId: "p", qty: 1 }] }, getIngredient, () => loop);
    expect(reqs).toHaveLength(0);
  });
  it("converts bottles to fluid ounces both ways", () => {
    expect(BevCalc.toBaseQty("floz", "bottle750", 1)).toBeCloseTo(25.3605, 3);
    expect(BevCalc.fromBaseQty("floz", "bottle750", 25.3605)).toBeCloseTo(1, 3);
  });
});

// ---------------------------------------------------------------- floor
describe("floor geometry, table joins and seating", () => {
  const sq = (id, label, x, y, seats) => ({ id, label, shape: "square", seats: seats || 4, w: 8, x, y, status: "clean", guests: 0 });

  it("joins two tables that touch", () => {
    const groups = FloorGeometry.groups([sq("a", "10", 20, 50), sq("b", "11", 28, 50)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].seats).toBe(8);
    expect(groups[0].label).toBe("10 + 11");
  });
  it("leaves tables apart alone", () => {
    expect(FloorGeometry.groups([sq("a", "10", 20, 50), sq("b", "11", 60, 50)])).toHaveLength(0);
  });
  it("respects the touch tolerance at both ends", () => {
    expect(FloorGeometry.groups([sq("a", "10", 20, 50), sq("b", "11", 28.9, 50)])).toHaveLength(1);
    expect(FloorGeometry.groups([sq("a", "10", 20, 50), sq("b", "11", 31.5, 50)])).toHaveLength(0);
  });
  it("converts both axes to the same unit before comparing", () => {
    // 12.8% of height is the same distance as 8% of width on a 16:10 floor
    expect(FloorGeometry.groups([sq("a", "10", 20, 40), sq("b", "11", 20, 52.8)])).toHaveLength(1);
    expect(FloorGeometry.groups([sq("a", "10", 20, 20), sq("b", "11", 20, 80)])).toHaveLength(0);
  });
  it("chains a run of three through connected components", () => {
    const g = FloorGeometry.groups([sq("a", "10", 20, 50), sq("b", "11", 28, 50), sq("c", "12", 36, 50)]);
    expect(g).toHaveLength(1);
    expect(g[0].seats).toBe(12);
  });
  it("keeps two separate runs separate", () => {
    const g = FloorGeometry.groups([sq("a", "10", 15, 50), sq("b", "11", 23, 50), sq("c", "12", 60, 50), sq("d", "13", 68, 50)]);
    expect(g).toHaveLength(2);
  });
  it("handles mixed shapes, where height differs from width", () => {
    const booth = { id: "x", label: "B1", shape: "booth", seats: 6, w: 13, x: 20, y: 50, status: "clean", guests: 0 };
    expect(FloorGeometry.groups([booth, sq("b", "11", 30, 50)])).toHaveLength(1);
  });
  it("counts the floor in units, so a joined run is one table", () => {
    const units = FloorGeometry.units([sq("a", "10", 20, 50), sq("b", "11", 28, 50), sq("c", "12", 70, 50)]);
    expect(units).toHaveLength(2);
    expect(units.filter((u) => u.joined)).toHaveLength(1);
  });
  it("rolls a run's status up from its tables", () => {
    expect(FloorGeometry.rollUpStatus([{ status: "clean" }, { status: "seated" }])).toBe("seated");
    expect(FloorGeometry.rollUpStatus([{ status: "clean" }, { status: "dirty" }])).toBe("dirty");
    expect(FloorGeometry.rollUpStatus([{ status: "clean" }, { status: "clean" }])).toBe("clean");
  });
  it("fills each table to its own seats before spilling into the next", () => {
    const tables = [{ seats: 6 }, { seats: 4 }];
    expect(FloorGeometry.distributeGuests(tables, 5)).toEqual([5, 0]);
    expect(FloorGeometry.distributeGuests(tables, 8)).toEqual([6, 2]);
    expect(FloorGeometry.distributeGuests(tables, 10)).toEqual([6, 4]);
  });
  it("never invents guests — the split always sums to the party", () => {
    // the bug that shipped once: a party of 11 landing as 19
    const tables = [{ seats: 4 }, { seats: 4 }, { seats: 4 }];
    const split = FloorGeometry.distributeGuests(tables, 11);
    expect(split.reduce((a, b) => a + b, 0)).toBe(11);
  });
  it("puts overflow beyond capacity on the last table rather than dropping it", () => {
    const split = FloorGeometry.distributeGuests([{ seats: 2 }, { seats: 2 }], 7);
    expect(split.reduce((a, b) => a + b, 0)).toBe(7);
  });
  it("ranks seating by tightest fit, then biggest of the too-small", () => {
    const units = [{ seats: 2 }, { seats: 8 }, { seats: 4 }, { seats: 6 }];
    const ranked = FloorGeometry.rankForParty(units, 4);
    expect(ranked.map((u) => u.seats)).toEqual([4, 6, 8, 2]);
  });
  it("takes the earliest seat time for a run's clock", () => {
    const early = "2026-09-18T18:00:00.000Z";
    const late = "2026-09-18T19:00:00.000Z";
    const g = FloorGeometry.groups([
      { ...sq("a", "10", 20, 50), status: "seated", seatedAt: late },
      { ...sq("b", "11", 28, 50), status: "seated", seatedAt: early },
    ]);
    expect(g[0].seatedAt).toBe(early);
  });
});

// ---------------------------------------------------------------- csv
describe("CSV parsing and validation", () => {
  it("parses quoted fields containing commas", () => {
    const rows = Csv.parse('name,qty\n"Tomatoes, Roma",5');
    expect(rows[1]).toEqual(["Tomatoes, Roma", "5"]);
  });
  it("parses escaped quotes", () => {
    expect(Csv.parse('a\n"12"" pan"')[1]).toEqual(['12" pan']);
  });
  it("parses newlines inside quoted fields", () => {
    const rows = Csv.parse('note\n"line one\nline two"');
    expect(rows[1][0]).toBe("line one\nline two");
  });
  it("handles CRLF and a BOM", () => {
    const rows = Csv.parse("﻿a,b\r\n1,2\r\n");
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual(["1", "2"]);
  });
  it("keeps the spreadsheet line number for error reporting", () => {
    const { records } = Csv.parseObjects("name\nA\nB");
    expect(records[0].__line).toBe(2);
    expect(records[1].__line).toBe(3);
  });
  it("disambiguates duplicate headers instead of overwriting", () => {
    const { headers } = Csv.parseObjects("cost,cost\n1,2");
    expect(headers).toEqual(["cost", "cost (2)"]);
  });
  it("reads money the way spreadsheets write it", () => {
    expect(Csv.toNumber("$1,234.50")).toBeCloseTo(1234.5, 5);
    expect(Csv.toNumber("(12.00)")).toBeCloseTo(-12, 5);
    expect(Csv.toNumber("")).toBeNull();
    expect(Number.isNaN(Csv.toNumber("abc"))).toBeTruthy();
  });
  it("reports a missing required column without throwing", () => {
    const { records } = Csv.parseObjects("qty\n5");
    const res = Csv.validate(records, { name: { required: true }, qty: { type: "number" } });
    expect(res.ok).toBeFalsy();
    expect(res.errors[0].kind).toBe("missing_column");
  });
  it("rejects only the bad rows and keeps the good ones", () => {
    const { records } = Csv.parseObjects("name,cost\nGood,5\nBad,abc\nAlsoGood,7");
    const res = Csv.validate(records, { name: { required: true }, cost: { type: "money" } });
    expect(res.rows).toHaveLength(2);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].line).toBe(3);
  });
  it("refuses to import the same row twice", () => {
    const { records } = Csv.parseObjects("name\nSalt\nsalt");
    const res = Csv.validate(records, { name: { required: true } }, { dedupeOn: "name" });
    expect(res.rows).toHaveLength(1);
    expect(res.errors[0].kind).toBe("duplicate");
  });
  it("round-trips through format and parse", () => {
    const rows = [{ name: 'Say "hi", now', qty: 3 }];
    const back = Csv.parseObjects(Csv.format(rows, ["name", "qty"])).records[0];
    expect(back.name).toBe('Say "hi", now');
    expect(back.qty).toBe("3");
  });
  it("guesses which column is which from common aliases", () => {
    const mapping = Csv.suggestMapping(["Item Name", "Case Price"], [
      { name: "name", aliases: ["item name"] },
      { name: "purchaseCost", aliases: ["case price"] },
    ]);
    expect(mapping.name).toBe("Item Name");
    expect(mapping.purchaseCost).toBe("Case Price");
  });
});

// ---------------------------------------------------------------- errors
describe("error vocabulary", () => {
  it("distinguishes the kinds a caller reacts to differently", () => {
    expect(AppErrors.is(AppErrors.validation("bad"), "validation")).toBeTruthy();
    expect(AppErrors.is(AppErrors.storage("full"), "validation")).toBeFalsy();
  });
  it("carries details the handler needs without parsing a message", () => {
    const err = AppErrors.validation("Row 4 is wrong", { line: 4, column: "cost" });
    expect(err.details.line).toBe(4);
  });
  it("reports an unknown error as itself rather than swallowing it", () => {
    expect(AppErrors.message(new Error("boom"))).toBe("boom");
  });
});


// ---------------------------------------------------------------- ai context
describe("AI context scoping", () => {
  // A stand-in for what the three tools expose, small enough to reason about.
  const snap = {
    food: {
      ingredients: [
        { name: "Fresh Lime Juice", belowPar: true }, { name: "Brioche Bun", belowPar: false },
      ],
      dishes: [{ name: "Classic Cheeseburger & Fries", plateCost: 4.44 }, { name: "Eggplant Parmesan", plateCost: 2.86 }],
    },
    bev: {
      ingredients: [{ name: "Tequila Blanco", belowPar: true }],
      drinks: [{ name: "Margarita", pourCost: 1.99 }, { name: "Old Fashioned", pourCost: 1.43 }],
      preps: [{ name: "Ginger Syrup", belowPar: false }],
    },
    floor: { activeLayout: "Dining Room", layouts: [{ layout: "Dining Room", tables: [{ table: "10" }] }], waitlist: [{ name: "Delgado" }] },
    foodSummary: { dishes: 2, avgFoodCostPct: 23.4, inventoryValue: 1678, belowPar: ["Fresh Lime Juice"], eightySixed: [] },
    bevSummary: { drinks: 2, avgPourCostPct: 15.3, inventoryValue: 1500, belowPar: ["Tequila Blanco"], eightySixed: [], nightlySales: 3044 },
    floorSummary: { tables: 18, seated: 13, clean: 2, dirty: 3, guests: 52, seats: 120, waiting: 7, longestWaitMs: 2280000 },
  };

  it("never sends the whole application state", () => {
    const ctx = AgentContext.forQuestion("How long is the wait?", snap);
    expect(ctx.foodMenu).toBe(undefined);
    expect(ctx.inventory).toBe(undefined);
    expect(ctx.floor).toBeTruthy();
  });
  it("always carries the organization, so a server can check it", () => {
    const ctx = AgentContext.forQuestion("anything", snap);
    expect(ctx.organization.id).toBe("demo");
  });
  it("sends only below-par items for an inventory question", () => {
    const ctx = AgentContext.forQuestion("what do I need to order", snap);
    expect(ctx.inventory.kitchenBelowPar).toHaveLength(1);
    expect(ctx.inventory.kitchenBelowPar[0].name).toBe("Fresh Lime Juice");
  });
  it("matches an item by a distinctive word, not just its full name", () => {
    const ctx = AgentContext.forQuestion("what does the cheeseburger cost", snap);
    expect(ctx.namedItems.map((n) => n.name)).toContain("Classic Cheeseburger & Fries");
  });
  it("matches an adjacent word pair for names made of short words", () => {
    const ctx = AgentContext.forQuestion("how much lime juice do we have", snap);
    expect(ctx.namedItems.map((n) => n.name)).toContain("Fresh Lime Juice");
  });
  it("tolerates plurals", () => {
    const ctx = AgentContext.forQuestion("how many margaritas can I pour", snap);
    expect(ctx.namedItems.map((n) => n.name)).toContain("Margarita");
  });
  it("does not match a word inside a longer one", () => {
    // "eggplant PARmesan" must not read as an inventory par question
    const ctx = AgentContext.forQuestion("should I cut the eggplant parmesan", snap);
    expect(ctx.scopes).toContain("food_menu");
  });
  it("drops the other side's menu when everything named is on one side", () => {
    const ctx = AgentContext.forQuestion("what does the cheeseburger cost", snap);
    expect(ctx.scopes).toContain("food_menu");
    expect(ctx.scopes.indexOf("bar_menu")).toBe(-1);
  });
  it("falls back to summaries alone for a question it cannot place", () => {
    const ctx = AgentContext.forQuestion("write a note for staff about tonight", snap);
    expect(ctx.scopes).toEqual(["overview"]);
    expect(ctx.summary.kitchen.dishes).toBe(2);
  });
  it("caps every slice so a large catalogue cannot blow the context", () => {
    const big = JSON.parse(JSON.stringify(snap));
    big.food.dishes = Array.from({ length: 500 }, (_, i) => ({ name: "Dish " + i }));
    const ctx = AgentContext.forQuestion("what is my food cost", big);
    expect(ctx.foodMenu.length).toBe(AgentContext.LIMITS.dishes);
  });
});

run().then((failed) => process.exit(failed ? 1 : 0));
