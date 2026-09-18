/* agent/context.js — what the model is allowed to see.

   The prototype sent the entire application state with every question: every
   ingredient, every recipe, every table, about 40 KB of JSON, whether the
   question was "how long is the wait" or not. That is wrong three ways. It
   costs tokens on data nobody asked about; it is a blast radius if a prompt
   injection ever lands; and it hard-codes the assumption that the client can
   read everything, which stops being true the moment a server enforces what a
   Staff role may see.

   So context is built FROM the question: work out what is being asked, select
   only the slices that answer it, cap every slice, and hand over a small
   object with a declared scope. When this moves server-side the same function
   runs there against the database, and the cap becomes a query LIMIT.

   Nothing here talks to a model. It only decides what a model would be given. */

const AgentContext = (function () {
  // Hard ceilings. A context that grows with a customer's catalogue is a
  // context that eventually breaks, so the limit is the limit.
  const LIMITS = { ingredients: 40, dishes: 40, drinks: 40, preps: 20, tables: 60, waitlist: 20 };

  const SCOPES = {
    INVENTORY: "inventory",
    FOOD_MENU: "food_menu",
    BAR_MENU: "bar_menu",
    FLOOR: "floor",
    OVERVIEW: "overview",
  };

  function norm(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  }

  // Whole words only. A substring match sends "eggplant PARmesan" to the
  // inventory scope because it contains "par", and matches "Cream CHEESE"
  // against "cheeseburger" — both of which happened before this was fixed.
  // Multi-word terms ("on hand") match as an adjacent run of words.
  // A trailing "s" is not a different word: people ask for "margaritas" and
  // "wedges", the menu says "Margarita" and "Lime Wedge".
  function singular(w) { return w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w; }

  function hasWords(q, phrase) {
    const words = q.split(" ").map(singular);
    const target = phrase.split(" ").map(singular);
    for (let i = 0; i + target.length <= words.length; i++) {
      let all = true;
      for (let j = 0; j < target.length; j++) {
        if (words[i + j] !== target[j]) { all = false; break; }
      }
      if (all) return true;
    }
    return false;
  }
  function hits(q, phrases) { return phrases.some((w) => hasWords(q, w)); }

  // Which parts of the business the question is about. More than one is fine —
  // "what should I 86 tonight" is inventory and both menus.
  function scopesFor(question) {
    const q = norm(question);
    const scopes = new Set();
    if (hits(q, ["par", "pars", "order", "reorder", "restock", "stock", "count", "counts", "inventory", "on hand", "86", "run out", "low", "short", "how much", "we have", "left"])) scopes.add(SCOPES.INVENTORY);
    if (hits(q, ["dish", "food", "plate", "menu", "kitchen", "cook", "entree", "appetizer", "food cost"])) scopes.add(SCOPES.FOOD_MENU);
    if (hits(q, ["drink", "cocktail", "bar", "pour", "liquor", "spirit", "wine", "beer", "prep", "syrup"])) scopes.add(SCOPES.BAR_MENU);
    if (hits(q, ["table", "floor", "seat", "wait", "guest", "cover", "host", "party", "busy", "room"])) scopes.add(SCOPES.FLOOR);
    if (hits(q, ["price", "cost", "profit", "margin", "sell", "popular", "revenue"])) {
      scopes.add(SCOPES.FOOD_MENU);
      scopes.add(SCOPES.BAR_MENU);
    }
    // A question we can't place gets the summaries and nothing else — small,
    // and usually enough to answer or to say what's missing.
    if (!scopes.size) scopes.add(SCOPES.OVERVIEW);
    return Array.from(scopes);
  }

  // Item names mentioned by the question, so a question about one dish gets
  // that dish in full rather than the whole menu truncated.
  //
  // Matches a whole name first, then falls back to any distinctive word in it,
  // because nobody types "Classic Cheeseburger & Fries" — they type
  // "cheeseburger". Short words are ignored so "ice" doesn't match "Iced Tea"
  // and "rum" doesn't match every drink containing it.
  function namedItems(question, snapshot) {
    const q = norm(question);
    const names = [];
    const seen = new Set();
    const add = (kind, name) => {
      if (seen.has(name)) return;
      seen.add(name);
      names.push({ kind, name });
    };
    const consider = (list, kind) =>
      (list || []).forEach((item) => {
        const n = norm(item.name);
        if (!n || n.length <= 2) return;
        if (hasWords(q, n)) { add(kind, item.name); return; }
        const words = n.split(" ");
        // One distinctive word ("cheeseburger"), or an adjacent pair of
        // ordinary ones ("lime juice" inside "Fresh Lime Juice"). A single
        // short word is too loose — "juice" alone would match half the bar.
        if (words.filter((w) => w.length >= 6).some((w) => hasWords(q, w))) { add(kind, item.name); return; }
        for (let i = 0; i + 1 < words.length; i++) {
          if (words[i].length >= 4 && words[i + 1].length >= 4 && hasWords(q, words[i] + " " + words[i + 1])) {
            add(kind, item.name);
            return;
          }
        }
      });
    consider(snapshot.food.dishes, "dish");
    consider(snapshot.bev.drinks, "drink");
    consider(snapshot.food.ingredients, "ingredient");
    consider(snapshot.bev.ingredients, "ingredient");
    consider(snapshot.bev.preps, "prep");
    return names;
  }

  function cap(list, n) { return (list || []).slice(0, n); }

  // Builds the context for one question. `snapshot` is the same read-only view
  // the tools already expose — this function selects from it, it does not
  // reach into any module's state.
  function forQuestion(question, snapshot) {
    const snap = snapshot || {
      food: FoodApp.snapshot(), bev: BevApp.snapshot(), floor: FloorApp.snapshot(),
      foodSummary: FoodApp.summary(), bevSummary: BevApp.summary(), floorSummary: FloorApp.summary(),
    };
    let scopes = scopesFor(question);
    const named = namedItems(question, snap);
    const namedSet = new Set(named.map((n) => n.name));

    // Naming something is itself a scope signal: "should I cut the eggplant
    // parmesan" mentions no costing word at all, but the answer plainly needs
    // that dish's numbers.
    const kinds = new Set(named.map((n) => n.kind));
    if (kinds.has("dish") && scopes.indexOf(SCOPES.FOOD_MENU) === -1) scopes.push(SCOPES.FOOD_MENU);
    if ((kinds.has("drink") || kinds.has("prep")) && scopes.indexOf(SCOPES.BAR_MENU) === -1) scopes.push(SCOPES.BAR_MENU);
    if (kinds.has("ingredient") && scopes.indexOf(SCOPES.INVENTORY) === -1) scopes.push(SCOPES.INVENTORY);
    if (scopes.length > 1) scopes = scopes.filter((s) => s !== SCOPES.OVERVIEW);

    // "What does the cheeseburger cost?" is a costing question, which reads as
    // both menus — but the question named a dish, so the bar menu is dead
    // weight. When everything named sits on one side, keep that side.
    if (kinds.size && !kinds.has("drink") && !kinds.has("prep") && scopes.indexOf(SCOPES.FOOD_MENU) !== -1) {
      scopes = scopes.filter((s) => s !== SCOPES.BAR_MENU);
    } else if (kinds.size && !kinds.has("dish") && scopes.indexOf(SCOPES.BAR_MENU) !== -1) {
      scopes = scopes.filter((s) => s !== SCOPES.FOOD_MENU);
    }

    // Always included: the numbers a manager would want in any answer. This is
    // small, bounded and derived, so it is cheap to send every time.
    const context = {
      organization: { id: Org.id(), name: Org.name(), currency: Org.currency() },
      askedAt: Time.now(),
      scopes,
      summary: {
        kitchen: {
          dishes: snap.foodSummary.dishes,
          avgFoodCostPct: round(snap.foodSummary.avgFoodCostPct),
          inventoryValue: round(snap.foodSummary.inventoryValue),
          belowParCount: snap.foodSummary.belowPar.length,
          eightySixed: snap.foodSummary.eightySixed,
        },
        bar: {
          drinks: snap.bevSummary.drinks,
          avgPourCostPct: round(snap.bevSummary.avgPourCostPct),
          inventoryValue: round(snap.bevSummary.inventoryValue),
          belowParCount: snap.bevSummary.belowPar.length,
          eightySixed: snap.bevSummary.eightySixed,
          nightlySales: round(snap.bevSummary.nightlySales),
        },
        floor: {
          tables: snap.floorSummary.tables,
          seated: snap.floorSummary.seated,
          clean: snap.floorSummary.clean,
          dirty: snap.floorSummary.dirty,
          guests: snap.floorSummary.guests,
          seats: snap.floorSummary.seats,
          waiting: snap.floorSummary.waiting,
          longestWaitMinutes: Math.round((snap.floorSummary.longestWaitMs || 0) / 60000),
        },
      },
    };

    // An item the question named is worth its full record wherever it lives.
    const keep = (item) => namedSet.has(item.name);

    if (scopes.indexOf(SCOPES.INVENTORY) !== -1) {
      // Below par first: that is what an inventory question is nearly always
      // about, and it keeps a 400-ingredient catalogue from filling the cap.
      const foodIng = snap.food.ingredients.filter((i) => i.belowPar || keep(i));
      const bevIng = snap.bev.ingredients.filter((i) => i.belowPar || keep(i));
      context.inventory = {
        kitchenBelowPar: cap(foodIng, LIMITS.ingredients),
        barBelowPar: cap(bevIng, LIMITS.ingredients),
        prepsBelowPar: cap(snap.bev.preps.filter((p) => p.belowPar || keep(p)), LIMITS.preps),
        note: "Only items below par, plus anything the question named. Full counts are in the Inventory tabs.",
      };
    }
    if (scopes.indexOf(SCOPES.FOOD_MENU) !== -1) {
      context.foodMenu = cap(
        snap.food.dishes.slice().sort((a, b) => (keep(b) ? 1 : 0) - (keep(a) ? 1 : 0)),
        LIMITS.dishes
      );
    }
    if (scopes.indexOf(SCOPES.BAR_MENU) !== -1) {
      context.barMenu = cap(
        snap.bev.drinks.slice().sort((a, b) => (keep(b) ? 1 : 0) - (keep(a) ? 1 : 0)),
        LIMITS.drinks
      );
      if (named.some((n) => n.kind === "prep")) context.preps = cap(snap.bev.preps, LIMITS.preps);
    }
    if (scopes.indexOf(SCOPES.FLOOR) !== -1) {
      context.floor = {
        activeLayout: snap.floor.activeLayout,
        layouts: snap.floor.layouts.map((l) => ({ layout: l.layout, tables: cap(l.tables, LIMITS.tables) })),
        waitlist: cap(snap.floor.waitlist, LIMITS.waitlist),
      };
    }

    context.namedItems = named;
    return context;
  }

  function round(n) { return Math.round((Number(n) || 0) * 100) / 100; }

  // For the settings screen and for tests: how big did that get?
  function measure(context) {
    const json = JSON.stringify(context);
    return { bytes: json.length, approxTokens: Math.ceil(json.length / 4), scopes: context.scopes };
  }

  return { forQuestion, scopesFor, namedItems, measure, SCOPES, LIMITS };
})();

if (typeof module !== "undefined" && module.exports) module.exports = { AgentContext };
