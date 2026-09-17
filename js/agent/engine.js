/* agent/engine.js — the built-in answer engine.

   This is the part that works with no API key, no network and no account: it
   reads the same live snapshot the three tools expose and answers the
   questions a manager actually asks on shift. It is not a language model —
   it matches intent, then computes the answer from the real data, so the
   numbers it gives are the numbers in the app. It says so when it can't
   match a question, rather than guessing.

   Everything here is pure: question in, { text, table } out. */

const AgentEngine = (function () {
  // ---------- snapshot ----------
  function snapshot() {
    return {
      food: FoodApp.snapshot(),
      bev: BevApp.snapshot(),
      floor: FloorApp.snapshot(),
      foodSummary: FoodApp.summary(),
      bevSummary: BevApp.summary(),
      floorSummary: FloorApp.summary(),
    };
  }

  // ---------- small helpers ----------
  function money(n) {
    return (Number(n) || 0).toLocaleString(undefined, { style: "currency", currency: "USD" });
  }
  function pct(n) {
    return (Number(n) || 0).toFixed(1) + "%";
  }
  function plural(n, one, many) {
    return `${n} ${n === 1 ? one : many || one + "s"}`;
  }
  function norm(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  }
  function has(q, ...words) {
    return words.some((w) => q.includes(w));
  }
  function list(names, limit) {
    const n = limit == null ? 6 : limit;
    if (!names.length) return "none";
    if (names.length <= n) return names.join(", ");
    return names.slice(0, n).join(", ") + ` and ${names.length - n} more`;
  }

  // Find the dish, drink, ingredient or prep a question is about by matching
  // the longest item name that appears in it. Longest wins so "shrimp scampi"
  // beats "shrimp".
  function findEntity(q, snap) {
    const pool = [];
    snap.food.dishes.forEach((d) => pool.push({ kind: "dish", name: d.name, item: d }));
    snap.bev.drinks.forEach((d) => pool.push({ kind: "drink", name: d.name, item: d }));
    snap.food.ingredients.forEach((i) => pool.push({ kind: "ingredient", name: i.name, item: i, side: "kitchen" }));
    snap.bev.ingredients.forEach((i) => pool.push({ kind: "ingredient", name: i.name, item: i, side: "bar" }));
    snap.bev.preps.forEach((p) => pool.push({ kind: "prep", name: p.name, item: p }));

    let best = null;
    pool.forEach((entry) => {
      const n = norm(entry.name);
      if (!n) return;
      if (q.includes(n) && (!best || n.length > norm(best.name).length)) best = entry;
    });
    if (best) return best;

    // Nothing matched whole; try the most distinctive word of each name.
    let partial = null;
    pool.forEach((entry) => {
      norm(entry.name)
        .split(" ")
        .filter((w) => w.length >= 5)
        .forEach((w) => {
          if (q.includes(w) && (!partial || w.length > partial._w.length)) partial = { ...entry, _w: w };
        });
    });
    return partial;
  }

  // Which side of the house is the question about? null means both.
  function sideOf(q) {
    const bar = has(q, "bar", "drink", "cocktail", "liquor", "booze", "beverage", "pour", "spirit", "bottle", "wine", "beer");
    const kitchen = has(q, "kitchen", "food", "dish", "menu item", "plate", "cook", "prep cook", "walk-in", "line");
    if (bar && !kitchen) return "bar";
    if (kitchen && !bar) return "kitchen";
    return null;
  }

  // ---------- intents ----------
  // Each returns { text, table } or null if it doesn't apply. Order matters:
  // the first match wins, so put specific intents before general ones.
  const INTENTS = [
    // ---- what do I need to order ----
    function belowPar(q, snap) {
      if (!has(q, "below par", "under par", "order", "reorder", "restock", "running low", "low on", "need to buy", "shopping")) return null;
      const side = sideOf(q);
      const rows = [];
      if (side !== "bar") {
        snap.food.ingredients.filter((i) => i.belowPar).forEach((i) =>
          rows.push(["Kitchen", i.name, i.onHand, i.par, money(i.onHandValue)])
        );
      }
      if (side !== "kitchen") {
        snap.bev.ingredients.filter((i) => i.belowPar).forEach((i) =>
          rows.push(["Bar", i.name, i.onHand, i.par, money(i.onHandValue)])
        );
        snap.bev.preps.filter((p) => p.belowPar).forEach((p) =>
          rows.push(["Bar (prep)", p.name, p.onHand, p.par, "batch more"])
        );
      }
      const where = side === "bar" ? "the bar" : side === "kitchen" ? "the kitchen" : "the house";
      if (!rows.length) return { text: `Nothing in ${where} is below par right now.` };
      return {
        text: `${plural(rows.length, "item")} in ${where} ${rows.length === 1 ? "is" : "are"} below par.`,
        table: { head: ["Where", "Item", "On Hand", "Par", "Value"], rows },
      };
    },

    // ---- what's 86'd ----
    function eightySix(q, snap) {
      if (!has(q, "86", "eighty six", "eighty-six", "cant make", "can t make", "cannot make", "out of stock", "sold out", "cant pour", "can t pour")) return null;
      const side = sideOf(q);
      const rows = [];
      if (side !== "bar") {
        snap.food.dishes.filter((d) => d.servingsAvailableNow <= 0).forEach((d) =>
          rows.push(["Kitchen", d.name, "0", d.firstToRunOut || "—"])
        );
      }
      if (side !== "kitchen") {
        snap.bev.drinks.filter((d) => d.servingsAvailableNow <= 0).forEach((d) =>
          rows.push(["Bar", d.name, "0", d.firstToRunOut || "—"])
        );
      }
      if (!rows.length) {
        return { text: "Nothing is 86'd — every dish and every drink can still be made with what's counted in." };
      }
      return {
        text: `${plural(rows.length, "item")} can't be made right now.`,
        table: { head: ["Where", "Item", "Available", "Out Of"], rows },
      };
    },

    // ---- how many of X can I make ----
    function howMany(q, snap) {
      if (!has(q, "how many", "how much")) return null;
      if (!has(q, "make", "pour", "sell", "left", "available", "can i", "do i have")) return null;
      const found = findEntity(q, snap);
      if (found && (found.kind === "dish" || found.kind === "drink")) {
        const it = found.item;
        const n = it.servingsAvailableNow;
        const verb = found.kind === "drink" ? "pour" : "make";
        return {
          text:
            n <= 0
              ? `None — ${it.name} is 86'd. ${it.firstToRunOut} is what ran out.`
              : `You can ${verb} ${n} ${it.name}${found.kind === "drink" ? (n === 1 ? "" : "s") : ` ${n === 1 ? "serving" : "servings"}`} with what's counted in. ${it.firstToRunOut} runs out first.`,
        };
      }
      if (found && (found.kind === "ingredient" || found.kind === "prep")) {
        const it = found.item;
        return {
          text: `${it.name}: ${it.onHand} on hand, par is ${it.par}.${it.belowPar ? " That's below par." : ""}`,
        };
      }
      return null;
    },

    // ---- what does X cost / what's the food cost on X ----
    function itemCost(q, snap) {
      if (!has(q, "cost", "price", "margin", "profit", "make on", "charge")) return null;
      const found = findEntity(q, snap);
      if (!found) return null;
      if (found.kind === "dish") {
        const d = found.item;
        return {
          text:
            `${d.name} costs ${money(d.plateCost)} a plate` +
            (d.menuPrice
              ? ` and sells for ${money(d.menuPrice)} — a ${pct(d.foodCostPct)} food cost, ${money(d.profitPerServing)} profit a serving. At ${d.servingsPerWeek} a week that's ${money(d.profitPerServing * d.servingsPerWeek)} a week.`
              : ", and has no menu price set yet."),
          table: { head: ["Builds from"], rows: d.buildsFrom.map((b) => [b]) },
        };
      }
      if (found.kind === "drink") {
        const d = found.item;
        return {
          text:
            `${d.name} costs ${money(d.pourCost)} to pour` +
            (d.menuPrice
              ? ` and sells for ${money(d.menuPrice)} — a ${pct(d.pourCostPct)} pour cost, ${money(d.profitPerDrink)} profit a drink. At ${d.servingsPerNight} a night that's ${money(d.profitPerDrink * d.servingsPerNight)} a night.`
              : ", and has no menu price set yet."),
          table: { head: ["Builds from"], rows: d.buildsFrom.map((b) => [b]) },
        };
      }
      if (found.kind === "ingredient") {
        const i = found.item;
        const per = i.costPerUsableUnit != null ? i.costPerUsableUnit : i.costPerUnit;
        return {
          text: `${i.name} is bought as ${i.purchase} — ${money(per)} per ${i.unit}${i.yieldPct && i.yieldPct < 100 ? ` usable, after a ${i.yieldPct}% yield` : ""}. ${i.onHand} on hand, worth ${money(i.onHandValue)}.`,
        };
      }
      if (found.kind === "prep") {
        const p = found.item;
        return {
          text: `${p.name} yields ${p.batchYield} a batch at ${money(p.batchCost)} in ingredients. ${p.onHand} on hand against a ${p.par} par.`,
          table: { head: ["Built from"], rows: p.builtFrom.map((b) => [b]) },
        };
      }
      return null;
    },

    // ---- what's in X ----
    function recipeBuild(q, snap) {
      if (!has(q, "what s in", "whats in", "what is in", "recipe for", "build for", "how do i make", "ingredients in", "ingredients for")) return null;
      const found = findEntity(q, snap);
      if (!found) return null;
      if (found.kind === "dish" || found.kind === "drink") {
        const it = found.item;
        return {
          text: `${it.name}${it.glass ? ` — served in a ${it.glass}` : ""}:`,
          table: { head: ["Per serving"], rows: it.buildsFrom.map((b) => [b]) },
        };
      }
      if (found.kind === "prep") {
        return {
          text: `${found.item.name} — ${found.item.batchYield} a batch:`,
          table: { head: ["Per batch"], rows: found.item.builtFrom.map((b) => [b]) },
        };
      }
      return null;
    },

    // ---- best / worst by money ----
    function ranking(q, snap) {
      const wantsTop = has(q, "most profitable", "best seller", "biggest", "top", "highest", "most popular", "best");
      const wantsBottom = has(q, "least profitable", "worst", "lowest", "least popular", "slowest", "cut");
      if (!wantsTop && !wantsBottom) return null;
      const side = sideOf(q);
      const byCostPct = has(q, "food cost", "pour cost", "cost %", "cost percent", "costliest");
      const byPopularity = has(q, "popular", "seller", "sells", "selling");

      if (side === "bar") {
        const rows = snap.bev.drinks.filter((d) => d.menuPrice);
        if (byCostPct) {
          rows.sort((a, b) => (wantsTop ? b.pourCostPct - a.pourCostPct : a.pourCostPct - b.pourCostPct));
          return {
            text: `${wantsTop ? "Highest" : "Lowest"} pour cost on the bar menu:`,
            table: {
              head: ["Drink", "Pour Cost", "Price", "Pour Cost %"],
              rows: rows.slice(0, 5).map((d) => [d.name, money(d.pourCost), money(d.menuPrice), pct(d.pourCostPct)]),
            },
          };
        }
        const keyed = rows.map((d) => ({ ...d, nightly: d.profitPerDrink * d.servingsPerNight }));
        keyed.sort((a, b) =>
          byPopularity
            ? (wantsTop ? b.servingsPerNight - a.servingsPerNight : a.servingsPerNight - b.servingsPerNight)
            : (wantsTop ? b.nightly - a.nightly : a.nightly - b.nightly)
        );
        return {
          text: `${wantsTop ? "Top" : "Bottom"} drinks by ${byPopularity ? "how many you pour a night" : "profit a night"}:`,
          table: {
            head: ["Drink", "Per Night", "Profit Each", "Profit / Night"],
            rows: keyed.slice(0, 5).map((d) => [d.name, String(d.servingsPerNight), money(d.profitPerDrink), money(d.nightly)]),
          },
        };
      }

      const dishes = snap.food.dishes.filter((d) => d.menuPrice);
      if (byCostPct) {
        dishes.sort((a, b) => (wantsTop ? b.foodCostPct - a.foodCostPct : a.foodCostPct - b.foodCostPct));
        return {
          text: `${wantsTop ? "Highest" : "Lowest"} food cost on the menu:`,
          table: {
            head: ["Dish", "Plate Cost", "Price", "Food Cost %"],
            rows: dishes.slice(0, 5).map((d) => [d.name, money(d.plateCost), money(d.menuPrice), pct(d.foodCostPct)]),
          },
        };
      }
      const keyed = dishes.map((d) => ({ ...d, weekly: d.profitPerServing * d.servingsPerWeek }));
      keyed.sort((a, b) =>
        byPopularity
          ? (wantsTop ? b.servingsPerWeek - a.servingsPerWeek : a.servingsPerWeek - b.servingsPerWeek)
          : (wantsTop ? b.weekly - a.weekly : a.weekly - b.weekly)
      );
      return {
        text: `${wantsTop ? "Top" : "Bottom"} dishes by ${byPopularity ? "how many you sell a week" : "profit a week"}:`,
        table: {
          head: ["Dish", "Per Week", "Profit Each", "Profit / Week"],
          rows: keyed.slice(0, 5).map((d) => [d.name, String(d.servingsPerWeek), money(d.profitPerServing), money(d.weekly)]),
        },
      };
    },

    // ---- the room right now ----
    function floorStatus(q, snap) {
      if (!has(q, "floor", "table", "room", "busy", "seated", "dirty", "covers", "occupancy", "how full", "turn")) return null;
      const f = snap.floorSummary;
      const dirty = [];
      snap.floor.layouts.forEach((l) =>
        l.tables.filter((t) => t.status === "Dirty").forEach((t) => dirty.push([l.layout, t.table, String(t.seats), t.lastTurn || "—"]))
      );
      const text =
        `${f.seated} of ${f.tables} tables are seated with ${plural(f.guests, "guest")} in — ${pct(f.seats ? (f.guests / f.seats) * 100 : 0)} of ${f.seats} seats. ` +
        `${f.clean} clean, ${f.dirty} dirty. ${f.waiting ? `${plural(f.waiting, "party", "parties")} waiting, longest ${Math.floor(f.longestWaitMs / 60000)} min.` : "Nobody waiting."}`;
      if (has(q, "dirty", "bus", "reset") && dirty.length) {
        return { text, table: { head: ["Layout", "Table", "Seats", "Last Turn"], rows: dirty } };
      }
      return { text };
    },

    // ---- the waitlist ----
    function waitlist(q, snap) {
      if (!has(q, "wait", "waiting", "quote", "next up", "party", "parties")) return null;
      const w = snap.floor.waitlist;
      if (!w.length) return { text: "Nobody is on the waitlist." };
      return {
        text: `${plural(w.length, "party", "parties")} waiting, ${w.reduce((s, x) => s + x.party, 0)} guests in total. ${w[0].name} has been waiting longest at ${w[0].waiting}.`,
        table: {
          head: ["#", "Name", "Party", "Waiting", "Notes"],
          rows: w.map((x) => [String(x.position), x.name, String(x.party), x.waiting, x.notes || "—"]),
        },
      };
    },

    // ---- money on the shelf ----
    function inventoryValue(q, snap) {
      if (!has(q, "inventory", "on hand", "worth", "value", "tied up", "shelf")) return null;
      const side = sideOf(q);
      const f = snap.foodSummary, b = snap.bevSummary;
      if (side === "bar") return { text: `The bar is holding ${money(b.inventoryValue)} in inventory, with ${b.belowPar.length} items below par.` };
      if (side === "kitchen") return { text: `The kitchen is holding ${money(f.inventoryValue)} in inventory, with ${f.belowPar.length} items below par.` };
      return {
        text: `The house is holding ${money(f.inventoryValue + b.inventoryValue)} in inventory — ${money(f.inventoryValue)} in the kitchen and ${money(b.inventoryValue)} behind the bar. ${f.belowPar.length + b.belowPar.length} items are below par.`,
      };
    },

    // ---- catch-all overview ----
    function overview(q, snap) {
      if (!has(q, "how are we", "how s the night", "hows the night", "summary", "overview", "everything", "status", "brief", "doing")) return null;
      const f = snap.foodSummary, b = snap.bevSummary, fl = snap.floorSummary;
      return {
        text:
          `${fl.seated} of ${fl.tables} tables seated, ${plural(fl.guests, "guest")} in, ${fl.waiting} waiting. ` +
          `Kitchen is running a ${pct(f.avgFoodCostPct)} average food cost across ${f.dishes} dishes; the bar a ${pct(b.avgPourCostPct)} pour cost across ${b.drinks} drinks. ` +
          `${money(f.inventoryValue + b.inventoryValue)} on the shelf. ` +
          (f.eightySixed.length || b.eightySixed.length
            ? `86'd: ${list(f.eightySixed.concat(b.eightySixed))}. `
            : "Nothing 86'd. ") +
          `${f.belowPar.length + b.belowPar.length} items below par.`,
      };
    },
  ];

  // ---------- public ----------
  function answer(question) {
    const q = norm(question);
    if (!q) return { text: "Ask me something about tonight — the floor, the counts, what things cost." };
    const snap = snapshot();
    for (const intent of INTENTS) {
      const res = intent(q, snap);
      if (res) return res;
    }
    return {
      text:
        "I couldn't match that one. I can answer questions about what's below par, what's 86'd, how many of something you can make, what a dish or drink costs and earns, what's in a recipe, your best and worst sellers, what inventory is worth, and the state of the floor and the waitlist.",
      unmatched: true,
    };
  }

  const SUGGESTIONS = [
    "What do I need to order?",
    "What's 86'd right now?",
    "How's the night going?",
    "What's my most profitable dish?",
    "Which drink has the highest pour cost?",
    "How many margaritas can I pour?",
    "How long is the wait?",
    "What's my inventory worth?",
  ];

  return { answer, snapshot, SUGGESTIONS };
})();
