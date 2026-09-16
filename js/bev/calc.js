/* bev/calc.js — pure calculation + unit conversion helpers for the beverage
   program. No DOM access here. */

const BevCalc = (function () {
  // Base units every ingredient cost boils down to.
  const BASE_UNITS = {
    floz: { label: "fl oz", long: "Fluid Ounce (volume)" },
    ozwt: { label: "oz wt", long: "Weight Ounce (mass)" },
    each: { label: "each", long: "Each (count)" },
  };

  // Purchase units a user can buy in, per base unit, and their conversion factor TO the base unit.
  const PURCHASE_UNITS = {
    floz: [
      { id: "floz", label: "fl oz", toBase: (q) => q },
      { id: "ml", label: "mL", toBase: (q) => q / 29.5735 },
      { id: "liter", label: "Liter", toBase: (q) => q * 33.814 },
      { id: "gal", label: "Gallon", toBase: (q) => q * 128 },
      // Bottle counts: what a bar actually writes on a count sheet.
      { id: "bottle750", label: "750 mL bottle", toBase: (q) => q * 25.3605 },
      { id: "bottle1l", label: "1 L bottle", toBase: (q) => q * 33.814 },
    ],
    ozwt: [
      { id: "ozwt", label: "oz (weight)", toBase: (q) => q },
      { id: "lb", label: "lb", toBase: (q) => q * 16 },
      { id: "kg", label: "kg", toBase: (q) => q * 35.274 },
    ],
    each: [{ id: "each", label: "each", toBase: (q) => q }],
  };

  function purchaseUnitsFor(baseUnit) {
    return PURCHASE_UNITS[baseUnit] || PURCHASE_UNITS.each;
  }

  function toBaseQty(baseUnit, purchaseUnitId, qty) {
    const units = purchaseUnitsFor(baseUnit);
    const u = units.find((u) => u.id === purchaseUnitId) || units[0];
    return u.toBase(Number(qty) || 0);
  }

  function purchaseUnit(baseUnit, purchaseUnitId) {
    const units = purchaseUnitsFor(baseUnit);
    return units.find((u) => u.id === purchaseUnitId) || units[0];
  }

  // Every conversion here is linear, so one unit's worth of base quantity is
  // the factor we divide by to go the other way.
  function unitFactor(baseUnit, purchaseUnitId) {
    return purchaseUnit(baseUnit, purchaseUnitId).toBase(1);
  }

  function fromBaseQty(baseUnit, purchaseUnitId, baseQty) {
    const factor = unitFactor(baseUnit, purchaseUnitId);
    if (!factor) return 0;
    return (Number(baseQty) || 0) / factor;
  }

  // How much base-unit quantity one purchase pack holds (one 40 lb bag = 640 oz).
  function packBaseQty(ingredient) {
    return toBaseQty(ingredient.baseUnit, ingredient.purchaseUnit, ingredient.purchaseQty);
  }

  // Cost per base unit given how the ingredient was purchased.
  function costPerBaseUnit(ingredient) {
    const baseQty = toBaseQty(ingredient.baseUnit, ingredient.purchaseUnit, ingredient.purchaseQty);
    if (!baseQty) return 0;
    return (Number(ingredient.purchaseCost) || 0) / baseQty;
  }

  // Total cost of a single recipe component (qty is already expressed in the ingredient's base unit).
  function componentCost(ingredient, qty) {
    if (!ingredient) return 0;
    return costPerBaseUnit(ingredient) * (Number(qty) || 0);
  }

  // Sum of all components in a recipe. `resolveIngredient` maps ingredientId -> ingredient object.
  function recipeCost(recipe, resolveIngredient) {
    return (recipe.components || []).reduce((sum, c) => {
      const ing = resolveIngredient(c.ingredientId);
      return sum + componentCost(ing, c.qty);
    }, 0);
  }

  // A "prep" (house-made syrup, concentrate, infusion) has its own sub-recipe of
  // raw ingredients plus a batch yield — cost per unit is the batch cost spread
  // across the yield. `resolveIngredient` must resolve RAW ingredients only.
  function prepBatchCost(prep, resolveIngredient) {
    return (prep.components || []).reduce((sum, c) => {
      const ing = resolveIngredient(c.ingredientId);
      return sum + componentCost(ing, c.qty);
    }, 0);
  }

  function prepCostPerUnit(prep, resolveIngredient) {
    const yieldQty = Number(prep.yieldQty) || 0;
    if (!yieldQty) return 0;
    return prepBatchCost(prep, resolveIngredient) / yieldQty;
  }

  // Presents a prep as an ingredient-like object so it can be used anywhere a
  // recipe component resolves against `costPerBaseUnit` / `componentCost` —
  // "purchased" in its own base unit, at its own yield quantity and batch cost.
  function prepAsIngredient(prep, resolveIngredient) {
    return {
      id: prep.id,
      name: prep.name,
      category: prep.category,
      baseUnit: prep.baseUnit,
      unitNoun: prep.unitNoun,
      purchaseUnit: prep.baseUnit,
      purchaseQty: prep.yieldQty,
      purchaseCost: prepBatchCost(prep, resolveIngredient),
      isPrep: true,
    };
  }

  // Pour-cost math.
  function suggestedPrice(cost, targetPourCostPct) {
    const pct = Number(targetPourCostPct) || 0;
    if (!pct) return 0;
    return cost / (pct / 100);
  }

  function pourCostPct(cost, menuPrice) {
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

  // Usage / event projections.
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

  function eventServings(guestCount, avgDrinksPerGuest, mixPct) {
    const guests = Number(guestCount) || 0;
    const perGuest = Number(avgDrinksPerGuest) || 0;
    const mix = Number(mixPct) || 0;
    return guests * perGuest * (mix / 100);
  }

  function eventProjection(cost, menuPrice, servings) {
    const s = Number(servings) || 0;
    const eventCost = cost * s;
    const eventRevenue = (Number(menuPrice) || 0) * s;
    return { servings: s, cost: eventCost, revenue: eventRevenue, profit: eventRevenue - eventCost };
  }

  // ---- Inventory ----
  // onHandQty / parQty are stored in the item's BASE unit (fl oz, oz wt, each);
  // the count sheet converts into whatever unit the bar actually counts in.
  function inventoryValue(item) {
    if (!item) return 0;
    return (Number(item.onHandQty) || 0) * costPerBaseUnit(item);
  }

  function belowPar(item) {
    const par = Number(item.parQty) || 0;
    if (!par) return false;
    return (Number(item.onHandQty) || 0) < par;
  }

  // Break a drink down to the RAW ingredients behind it: a component that
  // points at a house-made prep is expanded into the prep's own components,
  // scaled by how much of that prep the drink uses. A syrup you can still
  // batch shouldn't read as 86'd just because the bottle is empty.
  function rawRequirements(recipe, resolveIngredient, resolvePrep) {
    const totals = new Map();
    function add(ingredientId, qty) {
      const ing = resolveIngredient(ingredientId);
      if (!ing || !(qty > 0)) return;
      const existing = totals.get(ing.id);
      if (existing) existing.qty += qty;
      else totals.set(ing.id, { ingredient: ing, qty });
    }
    (recipe.components || []).forEach((c) => {
      const qty = Number(c.qty) || 0;
      if (!(qty > 0)) return;
      if (resolveIngredient(c.ingredientId)) { add(c.ingredientId, qty); return; }
      const prep = resolvePrep(c.ingredientId);
      if (!prep) return;
      const yieldQty = Number(prep.yieldQty) || 0;
      if (!yieldQty) return;
      const batches = qty / yieldQty;
      (prep.components || []).forEach((pc) => add(pc.ingredientId, (Number(pc.qty) || 0) * batches));
    });
    return Array.from(totals.values());
  }

  // How many of this drink the bar could pour right now, and what runs out first.
  function maxServings(recipe, resolveIngredient, resolvePrep) {
    const reqs = rawRequirements(recipe, resolveIngredient, resolvePrep);
    if (!reqs.length) return { servings: 0, limitedBy: null, unlimited: true };
    let best = Infinity;
    let limitedBy = null;
    reqs.forEach((req) => {
      const possible = (Number(req.ingredient.onHandQty) || 0) / req.qty;
      if (possible < best) { best = possible; limitedBy = req.ingredient; }
    });
    if (best === Infinity) return { servings: 0, limitedBy: null, unlimited: true };
    return { servings: Math.floor(best), limitedBy, unlimited: false };
  }

  // Nights of cover: how long what's on hand lasts at the drink's run rate.
  function nightsOfCover(servingsOnHand, servingsPerNight) {
    const perNight = Number(servingsPerNight) || 0;
    if (!perNight) return null;
    return (Number(servingsOnHand) || 0) / perNight;
  }

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

  // Display noun for an ingredient's unit, matched to qty (1 wedge, 3 wedges) — a
  // custom singular unitNoun (e.g. "dash", "wedge") if set, otherwise the generic
  // base-unit label (which doesn't pluralize: "fl oz", "oz wt").
  function unitLabel(ingredient, qty) {
    if (!ingredient) return "";
    if (ingredient.unitNoun) {
      return Number(qty) === 1 ? ingredient.unitNoun : pluralize(ingredient.unitNoun);
    }
    return BASE_UNITS[ingredient.baseUnit].label;
  }

  // Base-unit quantity shown in units a human would say out loud:
  // 152 fl oz of gin -> "6 btl", 640 oz of ice -> "40 lb".
  function fmtBaseQty(item, baseQty) {
    if (!item) return fmtQty(baseQty);
    const qty = Number(baseQty) || 0;
    if (item.baseUnit === "floz" && item.countUnit === "bottle750") return `${fmtQty(qty / 25.3605, 1)} btl`;
    if (item.baseUnit === "floz" && item.countUnit === "bottle1l") return `${fmtQty(qty / 33.814, 1)} btl`;
    if (item.baseUnit === "floz" && Math.abs(qty) >= 128) return `${fmtQty(qty / 128)} gal`;
    if (item.baseUnit === "ozwt" && Math.abs(qty) >= 32) return `${fmtQty(qty / 16)} lb`;
    return `${fmtQty(qty)} ${unitLabel(item, qty)}`;
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
    componentCost,
    recipeCost,
    prepBatchCost,
    prepCostPerUnit,
    prepAsIngredient,
    suggestedPrice,
    pourCostPct,
    grossProfit,
    marginPct,
    periodProjection,
    eventServings,
    eventProjection,
    inventoryValue,
    belowPar,
    rawRequirements,
    maxServings,
    nightsOfCover,
    fmtMoney,
    fmtPct,
    fmtNum,
    fmtQty,
    unitLabel,
    fmtBaseQty,
    uid,
  };
})();
