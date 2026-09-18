/* bev/storage.js — state shape, persistence via platform/storage, and
   versioned seed data.
   Seed items use fixed ids and a `sinceVersion` tag so that when new
   ingredients/recipes/glasses/preps are added later, anyone with existing
   saved data automatically gets the new ones merged in (without touching
   what they've already edited) instead of only new visitors seeing them.
   seedPriceUpdates() does the same for ingredient repricing: it only
   overwrites a price the user hasn't customized away from our default. */

const BevStorage = (function () {
  const COLLECTION = "bev";
  const SEED_VERSION = 5;


  // ---- Inventory levels (v5) ----
  // On hand and par are stored in each item's BASE unit; the numbers below are
  // written in the unit a bar actually counts in and converted here, so the
  // count sheet reads "6 btl" and "40 lb" rather than fluid ounces.
  // Levels are a plausible Thursday-morning count for a room pouring roughly
  // $3k of cocktails on a busy night — several items deliberately sit under
  // par, because a count sheet where everything is fine teaches nobody
  // anything.
  const BTL750 = 25.3605;   // fl oz in a 750 mL bottle
  const BTL1L = 33.814;     // fl oz in a 1 L bottle
  const LITER = 33.814;     // fl oz in a liter
  const LB = 16;            // oz (weight) in a pound

  const INVENTORY = {
    // Spirits and liqueurs, counted in bottles
    ing_well_vodka:        { countUnit: "bottle750", onHandQty: 9 * BTL750,  parQty: 6 * BTL750 },
    ing_tequila_blanco:    { countUnit: "bottle750", onHandQty: 4 * BTL750,  parQty: 6 * BTL750 },
    ing_gin:               { countUnit: "bottle750", onHandQty: 5 * BTL750,  parQty: 4 * BTL750 },
    ing_bourbon:           { countUnit: "bottle750", onHandQty: 7 * BTL750,  parQty: 6 * BTL750 },
    ing_triple_sec:        { countUnit: "bottle750", onHandQty: 4 * BTL750,  parQty: 3 * BTL750 },
    ing_orange_curacao:    { countUnit: "bottle750", onHandQty: 1.5 * BTL750, parQty: 2 * BTL750 },
    ing_aperol:            { countUnit: "bottle750", onHandQty: 2 * BTL750,  parQty: 3 * BTL750 },
    ing_coffee_liqueur:    { countUnit: "bottle750", onHandQty: 4 * BTL750,  parQty: 3 * BTL750 },
    ing_prosecco:          { countUnit: "bottle750", onHandQty: 15 * BTL750, parQty: 12 * BTL750 },
    ing_white_rum:         { countUnit: "bottle1l",  onHandQty: 5 * BTL1L,   parQty: 4 * BTL1L },
    ing_dark_rum:          { countUnit: "bottle1l",  onHandQty: 3 * BTL1L,   parQty: 3 * BTL1L },

    // Juice, syrup and egg white, counted in fluid ounces
    ing_lime_juice:        { countUnit: "floz", onHandQty: 96,  parQty: 128 },
    ing_lemon_juice:       { countUnit: "floz", onHandQty: 112, parQty: 96 },
    ing_grapefruit_juice:  { countUnit: "floz", onHandQty: 32,  parQty: 64 },
    ing_simple_syrup:      { countUnit: "floz", onHandQty: 128, parQty: 96 },
    ing_orgeat_syrup:      { countUnit: "floz", onHandQty: 24,  parQty: 32 },
    ing_egg_white:         { countUnit: "floz", onHandQty: 32,  parQty: 32 },

    // Mixers, counted in liters
    ing_tonic_water:       { countUnit: "liter", onHandQty: 18 * LITER, parQty: 12 * LITER },
    ing_club_soda:         { countUnit: "liter", onHandQty: 24 * LITER, parQty: 18 * LITER },
    ing_cola:              { countUnit: "liter", onHandQty: 10 * LITER, parQty: 12 * LITER },

    // Dry goods and ice, counted in pounds
    ing_ice:               { countUnit: "lb", onHandQty: 520 * LB, parQty: 400 * LB },
    ing_salt_rim:          { countUnit: "lb", onHandQty: 3 * LB,   parQty: 2 * LB },
    ing_sugar_rim:         { countUnit: "lb", onHandQty: 2.5 * LB, parQty: 2 * LB },
    ing_ginger_root:       { countUnit: "lb", onHandQty: 2 * LB,   parQty: 3 * LB },
    ing_jalapeno:          { countUnit: "lb", onHandQty: 3 * LB,   parQty: 2 * LB },
    ing_brown_sugar:       { countUnit: "lb", onHandQty: 8 * LB,   parQty: 5 * LB },
    ing_granulated_sugar:  { countUnit: "lb", onHandQty: 14 * LB,  parQty: 10 * LB },
    ing_ground_coffee:     { countUnit: "lb", onHandQty: 4 * LB,   parQty: 3 * LB },

    // Garnish and service items, counted each
    ing_lime_wedge:        { onHandQty: 520, parQty: 400 },
    ing_lemon_twist:       { onHandQty: 90,  parQty: 150 },
    ing_orange_peel:       { onHandQty: 210, parQty: 150 },
    ing_orange_wheel:      { onHandQty: 120, parQty: 100 },
    ing_grapefruit_wedge:  { onHandQty: 60,  parQty: 100 },
    ing_cherry:            { onHandQty: 260, parQty: 200 },
    ing_mint_sprig:        { onHandQty: 140, parQty: 100 },
    ing_coffee_beans:      { onHandQty: 300, parQty: 300 },
    ing_straw:             { onHandQty: 1500, parQty: 1000 },
    ing_angostura_bitters: { onHandQty: 320, parQty: 200 },
  };

  // Batches of house-made prep sitting in the walk-in, in each prep's base unit.
  const PREP_INVENTORY = {
    prep_brown_sugar_syrup:     { onHandQty: 96, parQty: 64 },
    prep_cold_brew_concentrate: { onHandQty: 32, parQty: 64 },
    prep_jalapeno_lime_syrup:   { onHandQty: 48, parQty: 32 },
    prep_ginger_syrup:          { onHandQty: 24, parQty: 32 },
  };

  // Applied to seeds on the way out, and backfilled onto saved data in
  // migrateSchema — one table, one source of truth.
  function withInventory(item, table) {
    // Only ever fills a gap: a count the user has already taken outranks the
    // shipped starting level, so this is safe to run on every load.
    const levels = table[item.id];
    if (levels && item.onHandQty == null && item.parQty == null) Object.assign(item, levels);
    if (item.onHandQty == null) item.onHandQty = 0;
    if (item.parQty == null) item.parQty = 0;
    return item;
  }

  // ---- Glassware presets ----
  function seedGlasses() {
    return [
      { id: "glass_rocks", sinceVersion: 1, name: "Rocks", volumeOz: 8, defaultIceOz: 4, defaultStraw: false, notes: "Old fashioned / rocks glass" },
      { id: "glass_highball", sinceVersion: 1, name: "Highball", volumeOz: 12, defaultIceOz: 5, defaultStraw: true, notes: "Highball / collins-lite" },
      { id: "glass_collins", sinceVersion: 1, name: "Collins", volumeOz: 14, defaultIceOz: 6, defaultStraw: true, notes: "Tall collins glass" },
      { id: "glass_coupe", sinceVersion: 1, name: "Coupe / Martini", volumeOz: 6, defaultIceOz: 0, defaultStraw: false, notes: "Up, served without ice" },
      { id: "glass_pint", sinceVersion: 1, name: "Pint", volumeOz: 16, defaultIceOz: 0, defaultStraw: false, notes: "Beer pint" },
      { id: "glass_shot", sinceVersion: 1, name: "Shot", volumeOz: 2, defaultIceOz: 0, defaultStraw: false, notes: "Neat shot / shooter" },
      { id: "glass_copper_mug", sinceVersion: 4, name: "Copper Mug", volumeOz: 12, defaultIceOz: 5, defaultStraw: false, notes: "Moscow Mule mug" },
      { id: "glass_wine", sinceVersion: 4, name: "Wine / Spritz Glass", volumeOz: 12, defaultIceOz: 3, defaultStraw: false, notes: "Stemmed glass, used for spritzes" },
    ];
  }

  // ---- Ingredients ----
  function seedIngredients() {
    return seedIngredientList().map((i) => withInventory(i, INVENTORY));
  }

  function seedIngredientList() {
    return [
      // v1 — pricing current as of Sept 2026 (see seedPriceUpdates() for the v1/v2 -> v3 repricing)
      { id: "ing_well_vodka", sinceVersion: 1, name: "Well Vodka", category: "Spirit", baseUnit: "floz", purchaseUnit: "ml", purchaseQty: 750, purchaseCost: 11.00 },
      { id: "ing_tequila_blanco", sinceVersion: 1, name: "Tequila Blanco", category: "Spirit", baseUnit: "floz", purchaseUnit: "ml", purchaseQty: 750, purchaseCost: 20.00 },
      { id: "ing_white_rum", sinceVersion: 1, name: "White Rum", category: "Spirit", baseUnit: "floz", purchaseUnit: "ml", purchaseQty: 1000, purchaseCost: 19.99 },
      { id: "ing_gin", sinceVersion: 1, name: "London Dry Gin", category: "Spirit", baseUnit: "floz", purchaseUnit: "ml", purchaseQty: 750, purchaseCost: 14.00 },
      { id: "ing_triple_sec", sinceVersion: 1, name: "Triple Sec", category: "Liqueur", baseUnit: "floz", purchaseUnit: "ml", purchaseQty: 750, purchaseCost: 10.00 },
      { id: "ing_lime_juice", sinceVersion: 1, name: "Fresh Lime Juice", category: "Juice", baseUnit: "floz", purchaseUnit: "floz", purchaseQty: 32, purchaseCost: 11.00 },
      { id: "ing_simple_syrup", sinceVersion: 1, name: "Simple Syrup", category: "Syrup", baseUnit: "floz", purchaseUnit: "floz", purchaseQty: 32, purchaseCost: 4 },
      { id: "ing_tonic_water", sinceVersion: 1, name: "Tonic Water", category: "Mixer", baseUnit: "floz", purchaseUnit: "liter", purchaseQty: 1, purchaseCost: 1.99 },
      { id: "ing_club_soda", sinceVersion: 1, name: "Club Soda", category: "Mixer", baseUnit: "floz", purchaseUnit: "liter", purchaseQty: 1, purchaseCost: 2.75 },
      { id: "ing_cola", sinceVersion: 1, name: "Cola", category: "Mixer", baseUnit: "floz", purchaseUnit: "liter", purchaseQty: 2, purchaseCost: 2.5 },
      { id: "ing_ice", sinceVersion: 1, name: "Bagged Ice", category: "Ice", baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 40, purchaseCost: 7.00 },
      { id: "ing_straw", sinceVersion: 1, name: "Straw", category: "Straw", baseUnit: "each", unitNoun: "straw", purchaseUnit: "each", purchaseQty: 500, purchaseCost: 6.00 },
      { id: "ing_lime_wedge", sinceVersion: 1, name: "Lime Wedge", category: "Garnish", baseUnit: "each", unitNoun: "wedge", purchaseUnit: "each", purchaseQty: 200, purchaseCost: 14.00 },
      { id: "ing_cherry", sinceVersion: 1, name: "Cocktail Cherry", category: "Garnish", baseUnit: "each", unitNoun: "cherry", purchaseUnit: "each", purchaseQty: 100, purchaseCost: 8.00 },
      { id: "ing_salt_rim", sinceVersion: 1, name: "Rimming Salt", category: "Garnish", baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 1, purchaseCost: 1.50 },

      // v2 — added for Old Fashioned, Mai Tai, Lemon Drop Martini
      { id: "ing_bourbon", sinceVersion: 2, name: "Bourbon Whiskey", category: "Spirit", baseUnit: "floz", purchaseUnit: "ml", purchaseQty: 750, purchaseCost: 14.00 },
      { id: "ing_dark_rum", sinceVersion: 2, name: "Dark Rum", category: "Spirit", baseUnit: "floz", purchaseUnit: "ml", purchaseQty: 1000, purchaseCost: 24.00 },
      { id: "ing_orange_curacao", sinceVersion: 2, name: "Orange Curaçao", category: "Liqueur", baseUnit: "floz", purchaseUnit: "ml", purchaseQty: 750, purchaseCost: 13.00 },
      { id: "ing_orgeat_syrup", sinceVersion: 2, name: "Orgeat Syrup", category: "Syrup", baseUnit: "floz", purchaseUnit: "floz", purchaseQty: 32, purchaseCost: 11.00 },
      { id: "ing_lemon_juice", sinceVersion: 2, name: "Fresh Lemon Juice", category: "Juice", baseUnit: "floz", purchaseUnit: "floz", purchaseQty: 32, purchaseCost: 10.00 },
      { id: "ing_sugar_rim", sinceVersion: 2, name: "Rimming Sugar", category: "Garnish", baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 1, purchaseCost: 1.25 },
      { id: "ing_lemon_twist", sinceVersion: 2, name: "Lemon Twist", category: "Garnish", baseUnit: "each", unitNoun: "twist", purchaseUnit: "each", purchaseQty: 150, purchaseCost: 15.00 },
      { id: "ing_mint_sprig", sinceVersion: 2, name: "Mint Sprig", category: "Garnish", baseUnit: "each", unitNoun: "sprig", purchaseUnit: "each", purchaseQty: 100, purchaseCost: 13.00 },
      { id: "ing_orange_peel", sinceVersion: 2, name: "Orange Peel", category: "Garnish", baseUnit: "each", unitNoun: "peel", purchaseUnit: "each", purchaseQty: 150, purchaseCost: 17.00 },
      { id: "ing_angostura_bitters", sinceVersion: 2, name: "Angostura Bitters", category: "Dry Goods", baseUnit: "each", unitNoun: "dash", purchaseUnit: "each", purchaseQty: 200, purchaseCost: 9 },

      // v4 — added for Whiskey Smash, Espresso Martini, Spicy Paloma, Moscow Mule, Aperol Spritz, Whiskey Sour
      { id: "ing_aperol", sinceVersion: 4, name: "Aperol", category: "Liqueur", baseUnit: "floz", purchaseUnit: "ml", purchaseQty: 750, purchaseCost: 22.00 },
      { id: "ing_prosecco", sinceVersion: 4, name: "Prosecco", category: "Wine", baseUnit: "floz", purchaseUnit: "ml", purchaseQty: 750, purchaseCost: 14.00 },
      { id: "ing_coffee_liqueur", sinceVersion: 4, name: "Coffee Liqueur", category: "Liqueur", baseUnit: "floz", purchaseUnit: "ml", purchaseQty: 750, purchaseCost: 22.00 },
      { id: "ing_grapefruit_juice", sinceVersion: 4, name: "Fresh Grapefruit Juice", category: "Juice", baseUnit: "floz", purchaseUnit: "floz", purchaseQty: 32, purchaseCost: 8.00 },
      { id: "ing_egg_white", sinceVersion: 4, name: "Egg White (Pasteurized)", category: "Dry Goods", baseUnit: "floz", purchaseUnit: "floz", purchaseQty: 32, purchaseCost: 5.50 },
      { id: "ing_ginger_root", sinceVersion: 4, name: "Fresh Ginger Root", category: "Dry Goods", baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 1, purchaseCost: 2.50 },
      { id: "ing_jalapeno", sinceVersion: 4, name: "Fresh Jalapeño", category: "Dry Goods", baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 1, purchaseCost: 1.50 },
      { id: "ing_brown_sugar", sinceVersion: 4, name: "Brown Sugar", category: "Dry Goods", baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 1, purchaseCost: 1.50 },
      { id: "ing_granulated_sugar", sinceVersion: 4, name: "Granulated Sugar", category: "Dry Goods", baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 1, purchaseCost: 1.10 },
      { id: "ing_ground_coffee", sinceVersion: 4, name: "Ground Coffee", category: "Dry Goods", baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 1, purchaseCost: 9.50 },
      { id: "ing_coffee_beans", sinceVersion: 4, name: "Coffee Beans (garnish)", category: "Garnish", baseUnit: "each", unitNoun: "bean", purchaseUnit: "each", purchaseQty: 300, purchaseCost: 3.00 },
      { id: "ing_grapefruit_wedge", sinceVersion: 4, name: "Grapefruit Wedge", category: "Garnish", baseUnit: "each", unitNoun: "wedge", purchaseUnit: "each", purchaseQty: 100, purchaseCost: 17.00 },
      { id: "ing_orange_wheel", sinceVersion: 4, name: "Orange Wheel", category: "Garnish", baseUnit: "each", unitNoun: "wheel", purchaseUnit: "each", purchaseQty: 100, purchaseCost: 15.50 },
    ];
  }

  // Ingredient pricing corrections to bring the seed data in line with current
  // real-world market prices. Each entry only overwrites an ingredient if its
  // purchase fields still exactly match what we originally shipped — so a
  // price the user has since edited themselves is left untouched.
  function seedPriceUpdates() {
    return [
      { id: "ing_well_vodka", sinceVersion: 3, match: { purchaseUnit: "ml", purchaseQty: 750, purchaseCost: 18 }, set: { purchaseCost: 11.00 } },
      { id: "ing_tequila_blanco", sinceVersion: 3, match: { purchaseUnit: "ml", purchaseQty: 1000, purchaseCost: 24 }, set: { purchaseQty: 750, purchaseCost: 20.00 } },
      { id: "ing_white_rum", sinceVersion: 3, match: { purchaseUnit: "ml", purchaseQty: 1000, purchaseCost: 20 }, set: { purchaseCost: 19.99 } },
      { id: "ing_gin", sinceVersion: 3, match: { purchaseUnit: "ml", purchaseQty: 750, purchaseCost: 22 }, set: { purchaseCost: 14.00 } },
      { id: "ing_triple_sec", sinceVersion: 3, match: { purchaseUnit: "ml", purchaseQty: 750, purchaseCost: 14 }, set: { purchaseCost: 10.00 } },
      { id: "ing_lime_juice", sinceVersion: 3, match: { purchaseUnit: "floz", purchaseQty: 32, purchaseCost: 6 }, set: { purchaseCost: 11.00 } },
      { id: "ing_tonic_water", sinceVersion: 3, match: { purchaseUnit: "liter", purchaseQty: 1, purchaseCost: 2.5 }, set: { purchaseCost: 1.99 } },
      { id: "ing_club_soda", sinceVersion: 3, match: { purchaseUnit: "liter", purchaseQty: 1, purchaseCost: 1.75 }, set: { purchaseCost: 2.75 } },
      { id: "ing_ice", sinceVersion: 3, match: { purchaseUnit: "lb", purchaseQty: 40, purchaseCost: 6 }, set: { purchaseCost: 7.00 } },
      { id: "ing_straw", sinceVersion: 3, match: { purchaseUnit: "each", purchaseQty: 500, purchaseCost: 5 }, set: { purchaseCost: 6.00 } },
      { id: "ing_lime_wedge", sinceVersion: 3, match: { purchaseUnit: "each", purchaseQty: 200, purchaseCost: 8 }, set: { purchaseCost: 14.00 } },
      { id: "ing_cherry", sinceVersion: 3, match: { purchaseUnit: "each", purchaseQty: 100, purchaseCost: 7 }, set: { purchaseCost: 8.00 } },
      { id: "ing_salt_rim", sinceVersion: 3, match: { purchaseUnit: "lb", purchaseQty: 1, purchaseCost: 3 }, set: { purchaseCost: 1.50 } },
      { id: "ing_bourbon", sinceVersion: 3, match: { purchaseUnit: "ml", purchaseQty: 750, purchaseCost: 22 }, set: { purchaseCost: 14.00 } },
      { id: "ing_dark_rum", sinceVersion: 3, match: { purchaseUnit: "ml", purchaseQty: 1000, purchaseCost: 26 }, set: { purchaseCost: 24.00 } },
      { id: "ing_orange_curacao", sinceVersion: 3, match: { purchaseUnit: "ml", purchaseQty: 750, purchaseCost: 18 }, set: { purchaseCost: 13.00 } },
      { id: "ing_orgeat_syrup", sinceVersion: 3, match: { purchaseUnit: "floz", purchaseQty: 32, purchaseCost: 12 }, set: { purchaseCost: 11.00 } },
      { id: "ing_lemon_juice", sinceVersion: 3, match: { purchaseUnit: "floz", purchaseQty: 32, purchaseCost: 6 }, set: { purchaseCost: 10.00 } },
      { id: "ing_sugar_rim", sinceVersion: 3, match: { purchaseUnit: "lb", purchaseQty: 1, purchaseCost: 3 }, set: { purchaseCost: 1.25 } },
      { id: "ing_lemon_twist", sinceVersion: 3, match: { purchaseUnit: "each", purchaseQty: 150, purchaseCost: 6 }, set: { purchaseCost: 15.00 } },
      { id: "ing_mint_sprig", sinceVersion: 3, match: { purchaseUnit: "each", purchaseQty: 100, purchaseCost: 5 }, set: { purchaseCost: 13.00 } },
      { id: "ing_orange_peel", sinceVersion: 3, match: { purchaseUnit: "each", purchaseQty: 150, purchaseCost: 9 }, set: { purchaseCost: 17.00 } },
    ];
  }

  // ---- Preps (house-made syrups / concentrates / infusions) ----
  // Each prep is built from raw ingredients (never from another prep) plus a
  // batch yield; its cost per unit is computed live from those ingredients'
  // current prices — see BevCalc.prepBatchCost / prepCostPerUnit.
  function seedPreps() {
    return seedPrepList().map((p) => withInventory(p, PREP_INVENTORY));
  }

  function seedPrepList() {
    const g = BevCalc.uid;
    return [
      {
        id: "prep_brown_sugar_syrup", sinceVersion: 4, name: "Brown Sugar Syrup", category: "Syrup",
        baseUnit: "floz", yieldQty: 32,
        instructions: "Combine equal parts brown sugar and hot water, stir until fully dissolved, cool, and bottle. Keeps refrigerated about 2 weeks.",
        components: [{ id: g("pcomp"), ingredientId: "ing_brown_sugar", qty: 16 }],
      },
      {
        id: "prep_cold_brew_concentrate", sinceVersion: 4, name: "Cold Brew Coffee Concentrate", category: "Concentrate",
        baseUnit: "floz", yieldQty: 32,
        instructions: "Combine coarse ground coffee with cold water at a 1:4 ratio, steep 16-18 hours refrigerated, then strain through a fine mesh or cheesecloth. Keeps refrigerated about 1 week.",
        components: [{ id: g("pcomp"), ingredientId: "ing_ground_coffee", qty: 8 }],
      },
      {
        id: "prep_jalapeno_lime_syrup", sinceVersion: 4, name: "Jalapeño-Lime Syrup", category: "Syrup",
        baseUnit: "floz", yieldQty: 32,
        instructions: "Simmer sliced jalapeño with sugar and water for 5 minutes, remove from heat, stir in fresh lime juice, steep 20 minutes, then strain.",
        components: [
          { id: g("pcomp"), ingredientId: "ing_granulated_sugar", qty: 12 },
          { id: g("pcomp"), ingredientId: "ing_jalapeno", qty: 3 },
          { id: g("pcomp"), ingredientId: "ing_lime_juice", qty: 2 },
        ],
      },
      {
        id: "prep_ginger_syrup", sinceVersion: 4, name: "Ginger Syrup", category: "Syrup",
        baseUnit: "floz", yieldQty: 32,
        instructions: "Simmer grated fresh ginger with sugar and water for 15 minutes, steep 30 minutes off heat, then strain through a fine mesh.",
        components: [
          { id: g("pcomp"), ingredientId: "ing_ginger_root", qty: 8 },
          { id: g("pcomp"), ingredientId: "ing_granulated_sugar", qty: 16 },
        ],
      },
    ];
  }

  // ---- Recipes ----
  // servingsPerNight x settings.operatingNightsPerWeek drives the Usage tab's
  // weekly/monthly/annual projections. Numbers below are calibrated so the
  // full 12-drink menu totals roughly $3,000 in cocktail sales on a busy
  // night for a small bar, with a realistic popular/slow-mover spread.
  function seedRecipes() {
    const g = BevCalc.uid;
    return [
      // v1
      {
        id: "rec_margarita", sinceVersion: 1, name: "Margarita", category: "Classic", glassId: "glass_rocks",
        menuPrice: 12, targetPourCostPct: 20, servingsPerNight: 32,
        eventGuestCount: 100, eventDrinksPerGuest: 2, eventMixPct: 13,
        components: [
          { id: g("comp"), ingredientId: "ing_tequila_blanco", qty: 1.5, label: "Tequila" },
          { id: g("comp"), ingredientId: "ing_triple_sec", qty: 1, label: "Triple sec" },
          { id: g("comp"), ingredientId: "ing_lime_juice", qty: 0.75, label: "Fresh lime juice" },
          { id: g("comp"), ingredientId: "ing_simple_syrup", qty: 0.25, label: "Simple syrup" },
          { id: g("comp"), ingredientId: "ing_ice", qty: 4, label: "Ice (shaken + served)" },
          { id: g("comp"), ingredientId: "ing_salt_rim", qty: 0.15, label: "Salt rim" },
          { id: g("comp"), ingredientId: "ing_lime_wedge", qty: 1, label: "Lime wedge garnish" },
        ],
      },
      {
        id: "rec_gin_tonic", sinceVersion: 1, name: "Gin & Tonic", category: "Highball", glassId: "glass_highball",
        menuPrice: 10, targetPourCostPct: 20, servingsPerNight: 22,
        eventGuestCount: 100, eventDrinksPerGuest: 2, eventMixPct: 9,
        components: [
          { id: g("comp"), ingredientId: "ing_gin", qty: 1.5, label: "Gin" },
          { id: g("comp"), ingredientId: "ing_tonic_water", qty: 5, label: "Tonic water" },
          { id: g("comp"), ingredientId: "ing_ice", qty: 5, label: "Ice" },
          { id: g("comp"), ingredientId: "ing_lime_wedge", qty: 1, label: "Lime wedge garnish" },
          { id: g("comp"), ingredientId: "ing_straw", qty: 1, label: "Straw" },
        ],
      },
      {
        id: "rec_rum_cola", sinceVersion: 1, name: "Rum & Coke", category: "Highball", glassId: "glass_highball",
        menuPrice: 9, targetPourCostPct: 20, servingsPerNight: 19,
        eventGuestCount: 100, eventDrinksPerGuest: 2, eventMixPct: 7,
        components: [
          { id: g("comp"), ingredientId: "ing_white_rum", qty: 1.5, label: "White rum" },
          { id: g("comp"), ingredientId: "ing_cola", qty: 5, label: "Cola" },
          { id: g("comp"), ingredientId: "ing_ice", qty: 5, label: "Ice" },
          { id: g("comp"), ingredientId: "ing_straw", qty: 1, label: "Straw" },
        ],
      },

      // v2
      {
        id: "rec_old_fashioned", sinceVersion: 2, name: "Old Fashioned", category: "Classic", glassId: "glass_rocks",
        menuPrice: 13, targetPourCostPct: 20, servingsPerNight: 27,
        eventGuestCount: 100, eventDrinksPerGuest: 2, eventMixPct: 11,
        components: [
          { id: g("comp"), ingredientId: "ing_bourbon", qty: 2, label: "Bourbon whiskey" },
          { id: g("comp"), ingredientId: "ing_simple_syrup", qty: 0.25, label: "Simple syrup" },
          { id: g("comp"), ingredientId: "ing_angostura_bitters", qty: 3, label: "Angostura bitters" },
          { id: g("comp"), ingredientId: "ing_ice", qty: 4, label: "Ice (large cube)" },
          { id: g("comp"), ingredientId: "ing_orange_peel", qty: 1, label: "Orange peel garnish" },
        ],
      },
      {
        id: "rec_mai_tai", sinceVersion: 2, name: "Mai Tai", category: "Tiki", glassId: "glass_rocks",
        menuPrice: 14, targetPourCostPct: 20, servingsPerNight: 11,
        eventGuestCount: 100, eventDrinksPerGuest: 2, eventMixPct: 4,
        components: [
          { id: g("comp"), ingredientId: "ing_white_rum", qty: 1, label: "White rum" },
          { id: g("comp"), ingredientId: "ing_dark_rum", qty: 1, label: "Dark rum (float)" },
          { id: g("comp"), ingredientId: "ing_orange_curacao", qty: 0.5, label: "Orange curaçao" },
          { id: g("comp"), ingredientId: "ing_orgeat_syrup", qty: 0.5, label: "Orgeat syrup" },
          { id: g("comp"), ingredientId: "ing_lime_juice", qty: 0.75, label: "Fresh lime juice" },
          { id: g("comp"), ingredientId: "ing_ice", qty: 5, label: "Ice" },
          { id: g("comp"), ingredientId: "ing_mint_sprig", qty: 1, label: "Mint sprig garnish" },
          { id: g("comp"), ingredientId: "ing_lime_wedge", qty: 1, label: "Lime wedge garnish" },
        ],
      },
      {
        id: "rec_lemon_drop", sinceVersion: 2, name: "Lemon Drop Martini", category: "Martini", glassId: "glass_coupe",
        menuPrice: 13, targetPourCostPct: 20, servingsPerNight: 14,
        eventGuestCount: 100, eventDrinksPerGuest: 2, eventMixPct: 5,
        components: [
          { id: g("comp"), ingredientId: "ing_well_vodka", qty: 1.5, label: "Vodka" },
          { id: g("comp"), ingredientId: "ing_triple_sec", qty: 0.5, label: "Triple sec" },
          { id: g("comp"), ingredientId: "ing_lemon_juice", qty: 0.75, label: "Fresh lemon juice" },
          { id: g("comp"), ingredientId: "ing_simple_syrup", qty: 0.5, label: "Simple syrup" },
          { id: g("comp"), ingredientId: "ing_sugar_rim", qty: 0.15, label: "Sugar rim" },
          { id: g("comp"), ingredientId: "ing_ice", qty: 3, label: "Ice (shaken)" },
          { id: g("comp"), ingredientId: "ing_lemon_twist", qty: 1, label: "Lemon twist garnish" },
        ],
      },

      // v4
      {
        id: "rec_whiskey_smash", sinceVersion: 4, name: "Whiskey Smash", category: "Whiskey", glassId: "glass_rocks",
        menuPrice: 13, targetPourCostPct: 20, servingsPerNight: 14,
        eventGuestCount: 100, eventDrinksPerGuest: 2, eventMixPct: 5,
        components: [
          { id: g("comp"), ingredientId: "ing_bourbon", qty: 2, label: "Bourbon whiskey" },
          { id: g("comp"), ingredientId: "ing_lemon_juice", qty: 0.75, label: "Fresh lemon juice" },
          { id: g("comp"), ingredientId: "prep_brown_sugar_syrup", qty: 0.5, label: "Brown sugar syrup" },
          { id: g("comp"), ingredientId: "ing_mint_sprig", qty: 2, label: "Mint (muddled + garnish)" },
          { id: g("comp"), ingredientId: "ing_ice", qty: 4, label: "Ice" },
        ],
      },
      {
        id: "rec_espresso_martini", sinceVersion: 4, name: "Espresso Martini", category: "Martini", glassId: "glass_coupe",
        menuPrice: 14, targetPourCostPct: 20, servingsPerNight: 8,
        eventGuestCount: 100, eventDrinksPerGuest: 2, eventMixPct: 3,
        components: [
          { id: g("comp"), ingredientId: "ing_well_vodka", qty: 1.5, label: "Vodka" },
          { id: g("comp"), ingredientId: "ing_coffee_liqueur", qty: 0.5, label: "Coffee liqueur" },
          { id: g("comp"), ingredientId: "prep_cold_brew_concentrate", qty: 1, label: "Cold brew concentrate" },
          { id: g("comp"), ingredientId: "ing_simple_syrup", qty: 0.25, label: "Simple syrup" },
          { id: g("comp"), ingredientId: "ing_coffee_beans", qty: 3, label: "Coffee bean garnish" },
        ],
      },
      {
        id: "rec_spicy_paloma", sinceVersion: 4, name: "Spicy Paloma", category: "Highball", glassId: "glass_highball",
        menuPrice: 12, targetPourCostPct: 20, servingsPerNight: 16,
        eventGuestCount: 100, eventDrinksPerGuest: 2, eventMixPct: 6,
        components: [
          { id: g("comp"), ingredientId: "ing_tequila_blanco", qty: 1.5, label: "Tequila" },
          { id: g("comp"), ingredientId: "ing_grapefruit_juice", qty: 2, label: "Fresh grapefruit juice" },
          { id: g("comp"), ingredientId: "ing_lime_juice", qty: 0.5, label: "Fresh lime juice" },
          { id: g("comp"), ingredientId: "prep_jalapeno_lime_syrup", qty: 0.5, label: "Jalapeño-lime syrup" },
          { id: g("comp"), ingredientId: "ing_club_soda", qty: 3, label: "Club soda (top)" },
          { id: g("comp"), ingredientId: "ing_salt_rim", qty: 0.15, label: "Salt rim" },
          { id: g("comp"), ingredientId: "ing_grapefruit_wedge", qty: 1, label: "Grapefruit wedge garnish" },
          { id: g("comp"), ingredientId: "ing_ice", qty: 5, label: "Ice" },
        ],
      },
      {
        id: "rec_moscow_mule", sinceVersion: 4, name: "Moscow Mule", category: "Highball", glassId: "glass_copper_mug",
        menuPrice: 11, targetPourCostPct: 20, servingsPerNight: 38,
        eventGuestCount: 100, eventDrinksPerGuest: 2, eventMixPct: 15,
        components: [
          { id: g("comp"), ingredientId: "ing_well_vodka", qty: 2, label: "Vodka" },
          { id: g("comp"), ingredientId: "prep_ginger_syrup", qty: 0.75, label: "Ginger syrup" },
          { id: g("comp"), ingredientId: "ing_lime_juice", qty: 0.5, label: "Fresh lime juice" },
          { id: g("comp"), ingredientId: "ing_club_soda", qty: 4, label: "Club soda (top)" },
          { id: g("comp"), ingredientId: "ing_ice", qty: 5, label: "Ice" },
          { id: g("comp"), ingredientId: "ing_lime_wedge", qty: 1, label: "Lime wedge garnish" },
        ],
      },
      {
        id: "rec_aperol_spritz", sinceVersion: 4, name: "Aperol Spritz", category: "Spritz", glassId: "glass_wine",
        menuPrice: 13, targetPourCostPct: 20, servingsPerNight: 30,
        eventGuestCount: 100, eventDrinksPerGuest: 2, eventMixPct: 12,
        components: [
          { id: g("comp"), ingredientId: "ing_aperol", qty: 3, label: "Aperol" },
          { id: g("comp"), ingredientId: "ing_prosecco", qty: 3, label: "Prosecco" },
          { id: g("comp"), ingredientId: "ing_club_soda", qty: 1, label: "Club soda (splash)" },
          { id: g("comp"), ingredientId: "ing_orange_wheel", qty: 1, label: "Orange wheel garnish" },
          { id: g("comp"), ingredientId: "ing_ice", qty: 4, label: "Ice" },
        ],
      },
      {
        id: "rec_whiskey_sour", sinceVersion: 4, name: "Whiskey Sour", category: "Whiskey", glassId: "glass_coupe",
        menuPrice: 12, targetPourCostPct: 20, servingsPerNight: 24,
        eventGuestCount: 100, eventDrinksPerGuest: 2, eventMixPct: 9,
        components: [
          { id: g("comp"), ingredientId: "ing_bourbon", qty: 2, label: "Bourbon whiskey" },
          { id: g("comp"), ingredientId: "ing_lemon_juice", qty: 0.75, label: "Fresh lemon juice" },
          { id: g("comp"), ingredientId: "ing_simple_syrup", qty: 0.5, label: "Simple syrup" },
          { id: g("comp"), ingredientId: "ing_egg_white", qty: 0.5, label: "Egg white" },
          { id: g("comp"), ingredientId: "ing_angostura_bitters", qty: 2, label: "Angostura bitters (float)" },
          { id: g("comp"), ingredientId: "ing_cherry", qty: 1, label: "Cherry garnish" },
        ],
      },
    ];
  }

  function defaultState() {
    return {
      ingredients: seedIngredients(),
      glassSizes: seedGlasses(),
      recipes: seedRecipes(),
      preps: seedPreps(),
      settings: {
        defaultTargetPourCostPct: 20,
        defaultIceIngredientId: "ing_ice",
        defaultStrawIngredientId: "ing_straw",
        operatingNightsPerWeek: 6,
      },
      seedVersion: SEED_VERSION,
    };
  }

  // One-time structural fixes applied to ANY loaded state, regardless of
  // seedVersion — these touch every recipe (seeded or user-created), not
  // just ones matching a shipped default, because they're schema fixes
  // rather than content updates.
  function migrateSchema(state) {
    if (!state.settings) state.settings = {};
    if (state.settings.operatingNightsPerWeek == null) state.settings.operatingNightsPerWeek = 6;
    const nights = state.settings.operatingNightsPerWeek || 6;

    (state.recipes || []).forEach((r) => {
      if (r.servingsPerNight == null) {
        r.servingsPerNight = r.servingsPerWeek != null ? Math.round(r.servingsPerWeek / nights) : 0;
      }
      delete r.servingsPerWeek;
    });

    if (!state.preps) state.preps = [];

    // v5 added inventory. Seeded items get the shipped starting levels;
    // anything the user created themselves starts at zero, ready to count.
    (state.ingredients || []).forEach((i) => withInventory(i, INVENTORY));
    state.preps.forEach((p) => withInventory(p, PREP_INVENTORY));
  }

  // Merge in any seed ingredients/glasses/recipes/preps added since the state was
  // last saved, without touching anything the user has already edited or added themselves.
  function applySeedUpdates(state) {
    const fromVersion = state.seedVersion || 1;
    if (fromVersion >= SEED_VERSION) return state;

    const existingIngredientIds = new Set(state.ingredients.map((i) => i.id));
    seedIngredients().forEach((ing) => {
      if (ing.sinceVersion > fromVersion && !existingIngredientIds.has(ing.id)) {
        state.ingredients.push(ing);
      }
    });

    const existingGlassIds = new Set(state.glassSizes.map((g) => g.id));
    seedGlasses().forEach((glass) => {
      if (glass.sinceVersion > fromVersion && !existingGlassIds.has(glass.id)) {
        state.glassSizes.push(glass);
      }
    });

    const existingRecipeIds = new Set(state.recipes.map((r) => r.id));
    seedRecipes().forEach((rec) => {
      if (rec.sinceVersion > fromVersion && !existingRecipeIds.has(rec.id)) {
        state.recipes.push(rec);
      }
    });

    if (!state.preps) state.preps = [];
    const existingPrepIds = new Set(state.preps.map((p) => p.id));
    seedPreps().forEach((prep) => {
      if (prep.sinceVersion > fromVersion && !existingPrepIds.has(prep.id)) {
        state.preps.push(prep);
      }
    });

    seedPriceUpdates().forEach((update) => {
      if (update.sinceVersion <= fromVersion) return;
      const ing = state.ingredients.find((i) => i.id === update.id);
      if (!ing) return;
      const stillDefault = Object.keys(update.match).every((key) => ing[key] === update.match[key]);
      if (stillDefault) Object.assign(ing, update.set);
    });

    state.seedVersion = SEED_VERSION;
    save(state);
    return state;
  }

  // Reads the hydrated cache rather than the device directly.
  function load() {
    const saved = Store.get(COLLECTION, undefined);
    if (!isValid(saved)) return defaultState();
    migrateSchema(saved);
    return applySeedUpdates(saved);
  }

  function isValid(parsed) {
    return !!(parsed && parsed.ingredients && parsed.glassSizes && parsed.recipes);
  }

  function save(state) {
    return Store.set(COLLECTION, state);
  }

  function resetToDefaults() {
    const state = defaultState();
    save(state);
    return state;
  }

  return { load, save, resetToDefaults, defaultState, COLLECTION };
})();
