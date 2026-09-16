/* food/calc.js — pure calculation + unit conversion helpers for the food
   program. No DOM access here. */

const FoodCalc = (function () {
  // Base units every ingredient cost boils down to.
  const BASE_UNITS = {
    ozwt: { label: "oz", long: "Weight (ounces / pounds)" },
    floz: { label: "fl oz", long: "Volume (fluid ounces / liters)" },
    each: { label: "each", long: "Count (each / dozen)" },
  };

  // Purchase units a user can buy in, per base unit, with the multiplier that
  // converts that unit TO the base unit (base = qty * factor).
  const PURCHASE_UNITS = {
    ozwt: [
      { id: "ozwt", label: "oz", factor: 1 },
      { id: "lb", label: "lb", factor: 16 },
      { id: "g", label: "g", factor: 1 / 28.3495 },
      { id: "kg", label: "kg", factor: 35.274 },
    ],
    floz: [
      { id: "floz", label: "fl oz", factor: 1 },
      { id: "cup", label: "cup", factor: 8 },
      { id: "pint", label: "pint", factor: 16 },
      { id: "qt", label: "quart", factor: 32 },
      { id: "gal", label: "gallon", factor: 128 },
      { id: "ml", label: "mL", factor: 1 / 29.5735 },
      { id: "liter", label: "liter", factor: 33.814 },
      { id: "tbsp", label: "tbsp", factor: 0.5 },
      { id: "tsp", label: "tsp", factor: 1 / 6 },
    ],
    each: [
      { id: "each", label: "each", factor: 1 },
      { id: "dozen", label: "dozen", factor: 12 },
    ],
  };

  function purchaseUnitsFor(baseUnit) {
    return PURCHASE_UNITS[baseUnit] || PURCHASE_UNITS.each;
  }

  function purchaseUnit(baseUnit, purchaseUnitId) {
    const units = purchaseUnitsFor(baseUnit);
    return units.find((u) => u.id === purchaseUnitId) || units[0];
  }

  function toBaseQty(baseUnit, purchaseUnitId, qty) {
    return (Number(qty) || 0) * purchaseUnit(baseUnit, purchaseUnitId).factor;
  }

  function fromBaseQty(baseUnit, purchaseUnitId, baseQty) {
    const factor = purchaseUnit(baseUnit, purchaseUnitId).factor;
    if (!factor) return 0;
    return (Number(baseQty) || 0) / factor;
  }

  // How much base-unit quantity one purchase pack contains (one 40 lb bag = 640 oz).
  function packBaseQty(ingredient) {
    return toBaseQty(ingredient.baseUnit, ingredient.purchaseUnit, ingredient.purchaseQty);
  }

  // Cost per base unit as purchased (before trim/waste).
  function costPerBaseUnit(ingredient) {
    const baseQty = packBaseQty(ingredient);
    if (!baseQty) return 0;
    return (Number(ingredient.purchaseCost) || 0) / baseQty;
  }

  // Yield is the share of what you buy that actually makes it onto the plate:
  // 100% for a case of buns, ~80% for romaine you have to core and trim.
  function yieldFactor(ingredient) {
    const pct = ingredient && ingredient.yieldPct != null ? Number(ingredient.yieldPct) : 100;
    if (!pct || pct <= 0) return 1;
    return Math.min(pct, 100) / 100;
  }

  // Cost per USABLE base unit — what a recipe actually pays per oz on the plate.
  function costPerUsableUnit(ingredient) {
    if (!ingredient) return 0;
    return costPerBaseUnit(ingredient) / yieldFactor(ingredient);
  }

  // Recipe quantities are edible-portion quantities, so they price at the usable cost.
  function componentCost(ingredient, qty) {
    if (!ingredient) return 0;
    return costPerUsableUnit(ingredient) * (Number(qty) || 0);
  }

  // Total cost of one batch of a recipe. `resolveIngredient` maps ingredientId -> ingredient.
  function recipeBatchCost(recipe, resolveIngredient) {
    return (recipe.components || []).reduce((sum, c) => {
      return sum + componentCost(resolveIngredient(c.ingredientId), c.qty);
    }, 0);
  }

  function portionsPerBatch(recipe) {
    return Math.max(Number(recipe && recipe.portions) || 1, 0.0001);
  }

  // Plate cost — what one serving costs, which is what menu pricing works from.
  function recipeCost(recipe, resolveIngredient) {
    return recipeBatchCost(recipe, resolveIngredient) / portionsPerBatch(recipe);
  }

  // Edible-portion quantity of one component needed for a single serving.
  function componentQtyPerPortion(recipe, component) {
    return (Number(component.qty) || 0) / portionsPerBatch(recipe);
  }

  // ---- Food cost math ----
  function suggestedPrice(cost, targetFoodCostPct) {
    const pct = Number(targetFoodCostPct) || 0;
    if (!pct) return 0;
    return cost / (pct / 100);
  }

  function foodCostPct(cost, menuPrice) {
    const price = Number(menuPrice) || 0;
    if (!price) return 0;
    return (cost / price) * 100;
  }

  function grossProfit(cost, menuPrice) {
    return (Number(menuPrice) || 0) - cost;
  }

  function marginPct(cost, menuPrice) {
    const price = Number(menuPrice) || 0;
    if (!price) return 0;
    return (grossProfit(cost, menuPrice) / price) * 100;
  }

  // ---- Inventory ----
  // On-hand is recorded as purchased, so usable on-hand applies the yield.
  function usableOnHand(ingredient) {
    if (!ingredient) return 0;
    return (Number(ingredient.onHandQty) || 0) * yieldFactor(ingredient);
  }

  function inventoryValue(ingredient) {
    if (!ingredient) return 0;
    return (Number(ingredient.onHandQty) || 0) * costPerBaseUnit(ingredient);
  }

  function belowPar(ingredient) {
    const par = Number(ingredient.parQty) || 0;
    if (!par) return false;
    return (Number(ingredient.onHandQty) || 0) < par;
  }

  // How many servings of a recipe the current inventory can actually produce,
  // and which ingredient runs out first.
  function maxPortions(recipe, resolveIngredient) {
    const comps = (recipe.components || []).filter((c) => (Number(c.qty) || 0) > 0);
    if (!comps.length) return { portions: 0, limitedBy: null, unlimited: true };

    let best = Infinity;
    let limitedBy = null;
    comps.forEach((c) => {
      const ing = resolveIngredient(c.ingredientId);
      if (!ing) return;
      const per = componentQtyPerPortion(recipe, c);
      if (per <= 0) return;
      const possible = usableOnHand(ing) / per;
      if (possible < best) {
        best = possible;
        limitedBy = ing;
      }
    });

    if (best === Infinity) return { portions: 0, limitedBy: null, unlimited: true };
    return { portions: Math.floor(best), limitedBy, unlimited: false };
  }

  // Ingredient draw for a given number of servings of one recipe.
  // usable = what lands on the plate; asPurchased = what you have to buy/pull.
  function portionRequirements(recipe, servings, resolveIngredient) {
    const out = [];
    (recipe.components || []).forEach((c) => {
      const ing = resolveIngredient(c.ingredientId);
      if (!ing) return;
      const usable = componentQtyPerPortion(recipe, c) * (Number(servings) || 0);
      out.push({
        ingredient: ing,
        usableQty: usable,
        asPurchasedQty: usable / yieldFactor(ing),
        cost: componentCost(ing, usable),
      });
    });
    return out;
  }

  // Roll several recipes' requirements up into one per-ingredient list.
  function aggregateRequirements(requirementLists) {
    const byId = new Map();
    requirementLists.forEach((list) => {
      list.forEach((req) => {
        const existing = byId.get(req.ingredient.id);
        if (existing) {
          existing.usableQty += req.usableQty;
          existing.asPurchasedQty += req.asPurchasedQty;
          existing.cost += req.cost;
        } else {
          byId.set(req.ingredient.id, { ...req });
        }
      });
    });
    return Array.from(byId.values());
  }

  // What's missing for a requirement, and what buying it costs in whole packs.
  function shortfall(req) {
    const onHand = Number(req.ingredient.onHandQty) || 0;
    const short = Math.max(0, req.asPurchasedQty - onHand);
    const pack = packBaseQty(req.ingredient);
    const packs = short > 0 && pack > 0 ? Math.ceil(short / pack) : 0;
    return {
      onHandQty: onHand,
      shortQty: short,
      packs,
      buyCost: packs * (Number(req.ingredient.purchaseCost) || 0),
    };
  }

  // ---- Usage / projections ----
  function periodProjection(cost, menuPrice, servingsPerWeek) {
    const servings = Number(servingsPerWeek) || 0;
    const weeklyCost = cost * servings;
    const weeklyRevenue = (Number(menuPrice) || 0) * servings;
    const weeklyProfit = weeklyRevenue - weeklyCost;
    return {
      weekly: { servings, cost: weeklyCost, revenue: weeklyRevenue, profit: weeklyProfit },
      monthly: {
        servings: servings * 4.33,
        cost: weeklyCost * 4.33,
        revenue: weeklyRevenue * 4.33,
        profit: weeklyProfit * 4.33,
      },
      annual: {
        servings: servings * 52,
        cost: weeklyCost * 52,
        revenue: weeklyRevenue * 52,
        profit: weeklyProfit * 52,
      },
    };
  }

  // Days of cover: how long the servings on hand last at the projected run rate.
  function daysOfCover(portionsOnHand, servingsPerWeek) {
    const perDay = (Number(servingsPerWeek) || 0) / 7;
    if (!perDay) return null;
    return (Number(portionsOnHand) || 0) / perDay;
  }

  // ---- Event planning ----
  // Portions to prep for an event line, padded by an overage % so you don't run out.
  function eventPortions(guestCount, portionsPerGuest, overagePct) {
    const guests = Number(guestCount) || 0;
    const per = Number(portionsPerGuest) || 0;
    const over = Number(overagePct) || 0;
    return Math.ceil(guests * per * (1 + over / 100));
  }

  function eventLineProjection(cost, menuPrice, portions) {
    const p = Number(portions) || 0;
    const lineCost = cost * p;
    const lineRevenue = (Number(menuPrice) || 0) * p;
    return { portions: p, cost: lineCost, revenue: lineRevenue, profit: lineRevenue - lineCost };
  }


  // ---- Menu insights ----
  // The Insights tab answers four questions without making anyone open a
  // spreadsheet: what sells, what doesn't, what shares prep, and what stands
  // alone. Everything below is derived from data the app already collects —
  // servings/week is the popularity signal, and the component lists are the
  // cross-utilization signal.

  // Rank dishes by popularity, with the money each one actually contributes.
  // `share` is that dish's slice of all servings sold in a week.
  function popularityRanking(recipes, resolveIngredient) {
    const totalServings = recipes.reduce((sum, r) => sum + (Number(r.servingsPerWeek) || 0), 0);
    return recipes
      .map((r) => {
        const cost = recipeCost(r, resolveIngredient);
        const servings = Number(r.servingsPerWeek) || 0;
        const price = Number(r.menuPrice) || 0;
        const profitEach = price - cost;
        return {
          recipe: r,
          cost,
          servings,
          share: totalServings ? (servings / totalServings) * 100 : 0,
          profitEach,
          weeklyProfit: profitEach * servings,
          weeklyRevenue: price * servings,
          foodCostPct: price ? (cost / price) * 100 : null,
        };
      })
      .sort((a, b) => b.servings - a.servings);
  }

  // Menu engineering: split the menu on median popularity and median profit per
  // plate. The four boxes are the standard industry read, and each one implies a
  // different move, which is the whole point of looking.
  const MENU_CLASSES = {
    star: { label: "Star", blurb: "Popular and profitable — protect these. Don't touch the recipe or the price." },
    plowhorse: { label: "Plowhorse", blurb: "Sells well, earns little. Raise the price a little or cut the plate cost." },
    puzzle: { label: "Puzzle", blurb: "Profitable but nobody orders it. Move it up the menu, rename it, or have servers push it." },
    dog: { label: "Dog", blurb: "Neither popular nor profitable. Rework it or cut it." },
  };

  function median(nums) {
    if (!nums.length) return 0;
    const sorted = nums.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function menuEngineering(recipes, resolveIngredient) {
    const rows = popularityRanking(recipes, resolveIngredient).filter((r) => r.recipe.menuPrice);
    const medServings = median(rows.map((r) => r.servings));
    const medProfit = median(rows.map((r) => r.profitEach));
    rows.forEach((row) => {
      const popular = row.servings >= medServings;
      const profitable = row.profitEach >= medProfit;
      row.menuClass = popular ? (profitable ? "star" : "plowhorse") : profitable ? "puzzle" : "dog";
    });
    return { rows, medServings, medProfit };
  }

  // Which ingredients a dish draws on, as a set of ids.
  function ingredientIdSet(recipe) {
    return new Set((recipe.components || []).filter((c) => c.ingredientId).map((c) => c.ingredientId));
  }

  // Every pair of dishes that share ingredients, scored by overlap. Overlap is
  // the shared count over the smaller dish's ingredient count, so a 4-ingredient
  // app that sits entirely inside a 12-ingredient entrée reads as fully covered.
  function sharedIngredientPairs(recipes, resolveIngredient, minShared) {
    const min = minShared == null ? 2 : minShared;
    const sets = recipes.map((r) => ({ recipe: r, ids: ingredientIdSet(r) }));
    const pairs = [];
    for (let i = 0; i < sets.length; i++) {
      for (let j = i + 1; j < sets.length; j++) {
        const a = sets[i], b = sets[j];
        const shared = [...a.ids].filter((id) => b.ids.has(id));
        if (shared.length < min) continue;
        const smaller = Math.min(a.ids.size, b.ids.size) || 1;
        pairs.push({
          a: a.recipe,
          b: b.recipe,
          shared: shared.map(resolveIngredient).filter(Boolean),
          sharedCount: shared.length,
          overlapPct: (shared.length / smaller) * 100,
        });
      }
    }
    return pairs.sort((x, y) => y.overlapPct - x.overlapPct || y.sharedCount - x.sharedCount);
  }

  // How well each dish is cross-utilized: how many of its ingredients any other
  // dish also uses. A dish at 0% shares nothing — every ingredient on it exists
  // for that one dish, which is where waste and dead inventory come from.
  function crossUtilization(recipes, resolveIngredient) {
    const useCount = new Map();
    recipes.forEach((r) => ingredientIdSet(r).forEach((id) => useCount.set(id, (useCount.get(id) || 0) + 1)));
    return recipes
      .map((r) => {
        const ids = [...ingredientIdSet(r)];
        const exclusive = ids.filter((id) => (useCount.get(id) || 0) === 1);
        return {
          recipe: r,
          ingredientCount: ids.length,
          sharedCount: ids.length - exclusive.length,
          exclusive: exclusive.map(resolveIngredient).filter(Boolean),
          sharedPct: ids.length ? ((ids.length - exclusive.length) / ids.length) * 100 : 0,
        };
      })
      .sort((a, b) => a.sharedPct - b.sharedPct);
  }

  // Ingredients only one dish uses, with the money sitting on the shelf for
  // them. Drop that dish and this inventory has nowhere to go.
  function orphanIngredients(recipes, ingredients) {
    const users = new Map();
    recipes.forEach((r) => {
      ingredientIdSet(r).forEach((id) => {
        if (!users.has(id)) users.set(id, []);
        users.get(id).push(r);
      });
    });
    return ingredients
      .filter((ing) => (users.get(ing.id) || []).length === 1)
      .map((ing) => ({ ingredient: ing, usedBy: users.get(ing.id)[0], onHandValue: inventoryValue(ing) }))
      .sort((a, b) => b.onHandValue - a.onHandValue);
  }

  // The opposite end: ingredients carrying the most dishes. These are the ones
  // where a price increase from a supplier hits hardest.
  function workhorseIngredients(recipes, ingredients, limit) {
    const users = new Map();
    recipes.forEach((r) => {
      ingredientIdSet(r).forEach((id) => {
        if (!users.has(id)) users.set(id, []);
        users.get(id).push(r);
      });
    });
    return ingredients
      .map((ing) => ({ ingredient: ing, dishes: users.get(ing.id) || [] }))
      .filter((x) => x.dishes.length > 1)
      .sort((a, b) => b.dishes.length - a.dishes.length)
      .slice(0, limit == null ? 8 : limit);
  }

  // ---- Formatting ----
  function fmtMoney(n) {
    const v = Number(n) || 0;
    return v.toLocaleString(undefined, { style: "currency", currency: "USD" });
  }

  function fmtPct(n) {
    const v = Number(n) || 0;
    return v.toFixed(1) + "%";
  }

  function fmtNum(n, digits) {
    const v = Number(n) || 0;
    return v.toFixed(digits == null ? 2 : digits);
  }

  // Like fmtNum, but drops trailing zeros: 1.00 -> "1", 1.50 -> "1.5".
  function fmtQty(n, maxDigits) {
    const v = Number(n) || 0;
    return parseFloat(v.toFixed(maxDigits == null ? 2 : maxDigits)).toString();
  }

  function pluralize(word) {
    if (/[^aeiou]y$/i.test(word)) return word.slice(0, -1) + "ies";
    if (/(s|x|z|ch|sh)$/i.test(word)) return word + "es";
    return word + "s";
  }

  // Display noun for an ingredient's unit, matched to qty (1 bun, 3 buns) — a
  // custom singular unitNoun (e.g. "bun", "clove") if set, otherwise the generic
  // base-unit label (which doesn't pluralize: "oz", "fl oz").
  function unitLabel(ingredient, qty) {
    if (!ingredient) return "";
    if (ingredient.unitNoun) {
      return Number(qty) === 1 ? ingredient.unitNoun : pluralize(ingredient.unitNoun);
    }
    return BASE_UNITS[ingredient.baseUnit].label;
  }

  // Base-unit quantity shown in friendlier units where it helps: 640 oz -> "40 lb".
  function fmtBaseQty(ingredient, baseQty) {
    if (!ingredient) return fmtQty(baseQty);
    const qty = Number(baseQty) || 0;
    if (ingredient.baseUnit === "ozwt" && Math.abs(qty) >= 32) {
      return `${fmtQty(qty / 16)} lb`;
    }
    if (ingredient.baseUnit === "floz" && Math.abs(qty) >= 128) {
      return `${fmtQty(qty / 128)} gal`;
    }
    return `${fmtQty(qty)} ${unitLabel(ingredient, qty)}`;
  }

  function uid(prefix) {
    return (prefix || "id") + "_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  return {
    BASE_UNITS,
    purchaseUnitsFor,
    purchaseUnit,
    toBaseQty,
    fromBaseQty,
    packBaseQty,
    costPerBaseUnit,
    yieldFactor,
    costPerUsableUnit,
    componentCost,
    recipeBatchCost,
    portionsPerBatch,
    recipeCost,
    componentQtyPerPortion,
    suggestedPrice,
    foodCostPct,
    grossProfit,
    marginPct,
    usableOnHand,
    inventoryValue,
    belowPar,
    maxPortions,
    portionRequirements,
    aggregateRequirements,
    shortfall,
    periodProjection,
    daysOfCover,
    eventPortions,
    eventLineProjection,
    MENU_CLASSES,
    median,
    popularityRanking,
    menuEngineering,
    ingredientIdSet,
    sharedIngredientPairs,
    crossUtilization,
    orphanIngredients,
    workhorseIngredients,
    fmtMoney,
    fmtPct,
    fmtNum,
    fmtQty,
    unitLabel,
    fmtBaseQty,
    uid,
  };
})();
