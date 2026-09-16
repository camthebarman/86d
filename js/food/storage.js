/* food/storage.js — state shape, localStorage persistence, versioned seed data.
   Seed items use fixed ids and a `sinceVersion` tag so that when new
   ingredients/recipes/events are added later, anyone with existing saved
   data automatically gets the new ones merged in (without touching what
   they've already edited) instead of only new visitors seeing them. */

const FoodStorage = (function () {
  const KEY = "gbg.food.v1";
  const SEED_VERSION = 2;

  // ---- Ingredients ----
  // Purchase packs and prices below are real quotes captured on 2026-09-15 from:
  //   [W] WebstaurantStore product listings (foodservice list price; non-member
  //       price where both were shown) — center-of-plate, dry goods, pantry,
  //       bakery, disposables.
  //   [T] USDA AMS Specialty Crops terminal market reports, 2026-09-08 to 09-14
  //       (New York NX_FV010/NX_FV020, Atlanta AJ_FV020, Baltimore, Miami) —
  //       fresh produce, at the wholesale level a distributor sells to a kitchen.
  //   [E] USDA ERS retail price spreads, August 2026 — shell eggs.
  // Produce and proteins move constantly and pricing is regional, so treat these
  // as a starting point: overwrite them with your own invoices.
  //
  // onHandQty and parQty are stored in the ingredient's BASE unit (oz, fl oz, each).
  function seedIngredients() {
    return [
      // Protein
      { id: "ing_chicken_breast", sinceVersion: 1, name: "Chicken Breast", category: "Protein", baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 10, purchaseCost: 45.39, yieldPct: 95, onHandQty: 320, parQty: 160 }, // [W] 4 oz B/S fillet, 2x5 lb
      { id: "ing_ground_beef", sinceVersion: 1, name: "Ground Beef 80/20", category: "Protein", baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 20, purchaseCost: 136.92, yieldPct: 100, onHandQty: 160, parQty: 96 }, // [W] 4x5 lb frozen
      { id: "ing_salmon_fillet", sinceVersion: 1, name: "Salmon Fillet", category: "Protein", baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 10, purchaseCost: 119.85, yieldPct: 88, onHandQty: 40, parQty: 48 }, // [W] Atlantic, 6 oz portions
      { id: "ing_bacon", sinceVersion: 1, name: "Applewood Bacon", category: "Protein", baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 15, purchaseCost: 79.59, yieldPct: 100, onHandQty: 96, parQty: 48 }, // [W] 18-22 ct sliced

      // Produce — [T] terminal market wholesale
      { id: "ing_romaine", sinceVersion: 1, name: "Romaine Hearts", category: "Produce", baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 21, purchaseCost: 25.5, yieldPct: 80, onHandQty: 192, parQty: 96 }, // Atlanta 9/14, 12x3ct
      { id: "ing_roma_tomato", sinceVersion: 1, name: "Roma Tomatoes", category: "Produce", baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 25, purchaseCost: 31, yieldPct: 90, onHandQty: 160, parQty: 80 }, // NY 9/14, 25 lb carton
      { id: "ing_yellow_onion", sinceVersion: 1, name: "Yellow Onion", category: "Produce", baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 50, purchaseCost: 25.5, yieldPct: 85, onHandQty: 320, parQty: 160 }, // Baltimore 9/9, 50 lb sack
      { id: "ing_garlic", sinceVersion: 1, name: "Peeled Garlic", category: "Produce", baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 5, purchaseCost: 11.25, yieldPct: 97, onHandQty: 32, parQty: 16 }, // NY 9/14, 5 lb jar
      { id: "ing_russet_potato", sinceVersion: 1, name: "Russet Potatoes", category: "Produce", baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 50, purchaseCost: 32.5, yieldPct: 82, onHandQty: 480, parQty: 240 }, // Baltimore 9/9, 50 lb 80s
      { id: "ing_carrot", sinceVersion: 1, name: "Carrots", category: "Produce", baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 50, purchaseCost: 21.5, yieldPct: 80, onHandQty: 120, parQty: 48 }, // NY 9/14, 10x5 lb
      { id: "ing_mushroom", sinceVersion: 1, name: "Cremini Mushrooms", category: "Produce", baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 5, purchaseCost: 15, yieldPct: 95, onHandQty: 64, parQty: 32 }, // Atlanta 9/14, 5 lb carton
      { id: "ing_basil", sinceVersion: 1, name: "Fresh Basil", category: "Produce", baseUnit: "ozwt", purchaseUnit: "kg", purchaseQty: 1, purchaseCost: 12.5, yieldPct: 70, countUnit: "ozwt", onHandQty: 3, parQty: 4 }, // NY 9/14, 1 kg bunched
      { id: "ing_lemon", sinceVersion: 1, name: "Lemon", category: "Produce", baseUnit: "each", unitNoun: "lemon", purchaseUnit: "each", purchaseQty: 140, purchaseCost: 24, yieldPct: 100, onHandQty: 60, parQty: 36 }, // NY 9/14, 17 kg 140s

      // Dairy
      { id: "ing_butter", sinceVersion: 1, name: "Unsalted Butter", category: "Dairy", baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 36, purchaseCost: 116.42, yieldPct: 100, onHandQty: 160, parQty: 64 }, // [W] 36x1 lb
      { id: "ing_heavy_cream", sinceVersion: 1, name: "Heavy Cream", category: "Dairy", baseUnit: "floz", purchaseUnit: "qt", purchaseQty: 12, purchaseCost: 72.49, yieldPct: 100, onHandQty: 128, parQty: 64 }, // [W] 12x32 fl oz, 40%
      { id: "ing_parmesan", sinceVersion: 1, name: "Parmesan", category: "Dairy", baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 10, purchaseCost: 79.99, yieldPct: 92, onHandQty: 12, parQty: 16 }, // [W] half wheel
      { id: "ing_mozzarella", sinceVersion: 1, name: "Fresh Mozzarella", category: "Dairy", baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 6, purchaseCost: 33.39, yieldPct: 100, onHandQty: 18, parQty: 24 }, // [W] ovoline, 2x3 lb tub
      { id: "ing_cheddar", sinceVersion: 1, name: "Sharp Cheddar", category: "Dairy", baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 10, purchaseCost: 54.49, yieldPct: 100, onHandQty: 40, parQty: 16 }, // [W] 2x5 lb block
      { id: "ing_egg", sinceVersion: 1, name: "Large Egg", category: "Dairy", baseUnit: "each", unitNoun: "egg", purchaseUnit: "dozen", purchaseQty: 15, purchaseCost: 34.08, yieldPct: 100, onHandQty: 120, parQty: 60 }, // [E] $2.272/doz retail

      // Dry goods
      { id: "ing_spaghetti", sinceVersion: 1, name: "Spaghetti (dry)", category: "Dry Goods", baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 20, purchaseCost: 15.49, yieldPct: 100, onHandQty: 160, parQty: 80 }, // [W] 20 lb bag
      { id: "ing_jasmine_rice", sinceVersion: 1, name: "Jasmine Rice (dry)", category: "Dry Goods", baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 25, purchaseCost: 33.7, yieldPct: 100, onHandQty: 200, parQty: 100 }, // [W] Thai Hom Mali 25 lb
      { id: "ing_ap_flour", sinceVersion: 1, name: "All-Purpose Flour", category: "Dry Goods", baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 50, purchaseCost: 28.99, yieldPct: 100, onHandQty: 400, parQty: 160 }, // [W] 50 lb bag

      // Bakery
      { id: "ing_brioche_bun", sinceVersion: 1, name: "Brioche Bun", category: "Bakery", baseUnit: "each", unitNoun: "bun", purchaseUnit: "each", purchaseQty: 96, purchaseCost: 104.99, yieldPct: 100, onHandQty: 72, parQty: 48 }, // [W] 4" sliced, 96 ct
      { id: "ing_flatbread_dough", sinceVersion: 1, name: "Flatbread Dough Ball", category: "Bakery", baseUnit: "each", unitNoun: "dough ball", purchaseUnit: "each", purchaseQty: 30, purchaseCost: 71.29, yieldPct: 100, onHandQty: 10, parQty: 16 }, // [W] 16 oz, 30 ct
      { id: "ing_crouton", sinceVersion: 1, name: "Garlic Croutons", category: "Bakery", baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 10, purchaseCost: 30.99, yieldPct: 100, onHandQty: 40, parQty: 16 }, // [W] 4x2.5 lb

      // Pantry
      { id: "ing_olive_oil", sinceVersion: 1, name: "Olive Oil", category: "Pantry", baseUnit: "floz", purchaseUnit: "liter", purchaseQty: 12, purchaseCost: 102.99, yieldPct: 100, onHandQty: 101.4, parQty: 34 }, // [W] EVOO 4x3 L
      { id: "ing_fryer_oil", sinceVersion: 1, name: "Fryer Oil", category: "Pantry", baseUnit: "floz", purchaseUnit: "gal", purchaseQty: 6, purchaseCost: 63.49, yieldPct: 100, onHandQty: 608, parQty: 128 }, // [W] veg oil 6x1 gal
      { id: "ing_crushed_tomato", sinceVersion: 1, name: "Crushed Tomatoes (#10 can)", category: "Pantry", baseUnit: "ozwt", purchaseUnit: "ozwt", purchaseQty: 102, purchaseCost: 4.92, yieldPct: 100, onHandQty: 306, parQty: 102 }, // [W] $29.49/6 cans
      { id: "ing_caesar_dressing", sinceVersion: 1, name: "Caesar Dressing", category: "Pantry", baseUnit: "floz", purchaseUnit: "gal", purchaseQty: 4, purchaseCost: 92.49, yieldPct: 100, onHandQty: 128, parQty: 64 }, // [W] 4x1 gal
      { id: "ing_chicken_stock", sinceVersion: 1, name: "Chicken Stock", category: "Pantry", baseUnit: "floz", purchaseUnit: "floz", purchaseQty: 576, purchaseCost: 48.49, yieldPct: 100, countUnit: "gal", onHandQty: 384, parQty: 128 }, // [W] 12x48 oz broth
      { id: "ing_soy_sauce", sinceVersion: 1, name: "Soy Sauce", category: "Pantry", baseUnit: "floz", purchaseUnit: "gal", purchaseQty: 4, purchaseCost: 59.99, yieldPct: 100, onHandQty: 128, parQty: 32 }, // [W] Kikkoman 4x1 gal

      // Spice
      { id: "ing_kosher_salt", sinceVersion: 1, name: "Kosher Salt", category: "Spice", baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 50, purchaseCost: 49.49, yieldPct: 100, onHandQty: 96, parQty: 48 }, // [W] Morton coarse 50 lb
      { id: "ing_black_pepper", sinceVersion: 1, name: "Ground Black Pepper", category: "Spice", baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 25, purchaseCost: 148.99, yieldPct: 100, onHandQty: 16, parQty: 8 }, // [W] table grind 25 lb

      // Disposables — the line items that quietly wreck a catering quote
      { id: "ing_togo_container", sinceVersion: 1, name: "To-Go Container", category: "Disposables", baseUnit: "each", unitNoun: "container", purchaseUnit: "each", purchaseQty: 200, purchaseCost: 25.49, yieldPct: 100, onHandQty: 150, parQty: 100 }, // [W] 9x6x3 hinged
      { id: "ing_cutlery_kit", sinceVersion: 1, name: "Cutlery Kit", category: "Disposables", baseUnit: "each", unitNoun: "kit", purchaseUnit: "each", purchaseQty: 500, purchaseCost: 22.99, yieldPct: 100, onHandQty: 200, parQty: 100 }, // [W] wrapped, w/ napkin
      { id: "ing_napkin", sinceVersion: 1, name: "Dinner Napkin", category: "Disposables", baseUnit: "each", unitNoun: "napkin", purchaseUnit: "each", purchaseQty: 3000, purchaseCost: 32.99, yieldPct: 100, onHandQty: 800, parQty: 400 }, // [W] 2-ply 17x15
      { id: "ing_chafing_fuel", sinceVersion: 1, name: "Chafing Fuel Can", category: "Disposables", baseUnit: "each", unitNoun: "can", purchaseUnit: "each", purchaseQty: 24, purchaseCost: 27.99, yieldPct: 100, onHandQty: 24, parQty: 12 }, // [W] 4 hr wick

      // ===== v2: full restaurant menu build-out =====
      // Protein
      { id: "ing_chicken_wings", sinceVersion: 2, name: "Chicken Wings (jumbo cut)", category: "Protein", baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 40, purchaseCost: 79.99, yieldPct: 100, onHandQty: 320, parQty: 240 }, // [W] uncooked frozen 40 lb
      { id: "ing_shrimp", sinceVersion: 2, name: "Raw Shrimp 16/20 P&D", category: "Protein", baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 20, purchaseCost: 194.99, yieldPct: 95, onHandQty: 96, parQty: 80 }, // [W] 10x2 lb split/deveined
      { id: "ing_cod_portion", sinceVersion: 2, name: "Beer-Battered Cod Portions", category: "Protein", baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 10, purchaseCost: 128.75, yieldPct: 100, onHandQty: 80, parQty: 64 }, // [W] 10 oz portions, 10 lb
      { id: "ing_ribeye", sinceVersion: 2, name: "Bone-In Ribeye (14 oz)", category: "Protein", baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 10.5, purchaseCost: 242.49, yieldPct: 100, onHandQty: 112, parQty: 84 }, // [W] 12x14 oz frozen
      { id: "ing_turkey_breast", sinceVersion: 2, name: "Sliced Turkey Breast", category: "Protein", baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 18, purchaseCost: 129.99, yieldPct: 100, onHandQty: 144, parQty: 96 }, // [W] oil browned, 2x9 lb

      // Produce — [T] terminal market wholesale
      { id: "ing_celery", sinceVersion: 2, name: "Celery", category: "Produce", baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 50, purchaseCost: 27, yieldPct: 75, onHandQty: 240, parQty: 160 }, // NY 9/14, 2.5 dz carton
      { id: "ing_jalapeno", sinceVersion: 2, name: "Jalapeño Peppers", category: "Produce", baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 28, purchaseCost: 28.5, yieldPct: 85, onHandQty: 64, parQty: 48 }, // NY 9/14, 1 1/9 bu carton
      { id: "ing_green_onion", sinceVersion: 2, name: "Green Onion", category: "Produce", baseUnit: "each", unitNoun: "bunch", purchaseUnit: "each", purchaseQty: 48, purchaseCost: 27, yieldPct: 80, onHandQty: 24, parQty: 24 }, // NY 9/14, bunched 48s
      { id: "ing_spinach", sinceVersion: 2, name: "Baby Spinach", category: "Produce", baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 10, purchaseCost: 19, yieldPct: 90, onHandQty: 48, parQty: 40 }, // NY 9/14, 4x2.5 lb bags
      { id: "ing_asparagus", sinceVersion: 2, name: "Asparagus", category: "Produce", baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 11, purchaseCost: 61, yieldPct: 65, onHandQty: 44, parQty: 44 }, // NY 9/14, 11 lb bunched
      { id: "ing_eggplant", sinceVersion: 2, name: "Eggplant", category: "Produce", baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 30, purchaseCost: 15, yieldPct: 80, onHandQty: 96, parQty: 64 }, // NY 9/14, 1 1/9 bu carton
      { id: "ing_avocado", sinceVersion: 2, name: "Avocado", category: "Produce", baseUnit: "each", unitNoun: "avocado", purchaseUnit: "each", purchaseQty: 18, purchaseCost: 36.5, yieldPct: 70, onHandQty: 18, parQty: 18 }, // NY 9/14, 2 layer 18s

      // Dairy
      { id: "ing_cream_cheese", sinceVersion: 2, name: "Cream Cheese", category: "Dairy", baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 18, purchaseCost: 88.74, yieldPct: 100, onHandQty: 144, parQty: 96 }, // [W] 6x3 lb block
      { id: "ing_sour_cream", sinceVersion: 2, name: "Sour Cream", category: "Dairy", baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 20, purchaseCost: 58.99, yieldPct: 100, onHandQty: 160, parQty: 96 }, // [W] 4x5 lb tub

      // Bakery
      { id: "ing_tortilla_chip", sinceVersion: 2, name: "Tortilla Chips", category: "Bakery", baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 12, purchaseCost: 46.49, yieldPct: 100, onHandQty: 96, parQty: 96 }, // [W] 6x2 lb round
      { id: "ing_flour_tortilla", sinceVersion: 2, name: 'Flour Tortilla (12")', category: "Bakery", baseUnit: "each", unitNoun: "tortilla", purchaseUnit: "each", purchaseQty: 72, purchaseCost: 33.49, yieldPct: 100, onHandQty: 60, parQty: 48 }, // [W] 72 ct
      { id: "ing_baguette", sinceVersion: 2, name: "Par-Baked Baguette", category: "Bakery", baseUnit: "each", unitNoun: "baguette", purchaseUnit: "each", purchaseQty: 32, purchaseCost: 41.99, yieldPct: 100, onHandQty: 24, parQty: 24 }, // [W] 12" half, 32 ct
      { id: "ing_mozz_sticks", sinceVersion: 2, name: "Breaded Mozzarella Sticks", category: "Prep / Sub-Recipe", baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 12, purchaseCost: 72.49, yieldPct: 100, onHandQty: 96, parQty: 96 }, // [W] 3", 12 lb case

      // Pantry
      { id: "ing_hot_sauce", sinceVersion: 2, name: "Buffalo Wing Sauce", category: "Pantry", baseUnit: "floz", purchaseUnit: "gal", purchaseQty: 4, purchaseCost: 65.99, yieldPct: 100, onHandQty: 256, parQty: 256 }, // [W] Frank's RedHot 4x1 gal
      { id: "ing_mayo", sinceVersion: 2, name: "Mayonnaise", category: "Pantry", baseUnit: "floz", purchaseUnit: "gal", purchaseQty: 4, purchaseCost: 96.99, yieldPct: 100, onHandQty: 256, parQty: 128 }, // [W] Hellmann's Real 4x1 gal
      { id: "ing_ranch", sinceVersion: 2, name: "Ranch Dressing", category: "Pantry", baseUnit: "floz", purchaseUnit: "gal", purchaseQty: 4, purchaseCost: 86.99, yieldPct: 100, onHandQty: 256, parQty: 256 }, // [W] Hidden Valley 4x1 gal
      { id: "ing_cocktail_sauce", sinceVersion: 2, name: "Cocktail Sauce", category: "Pantry", baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 32, purchaseCost: 50.49, yieldPct: 100, onHandQty: 128, parQty: 96 }, // [W] Tulkoff 4x8 lb
      { id: "ing_tartar_sauce", sinceVersion: 2, name: "Tartar Sauce", category: "Pantry", baseUnit: "floz", purchaseUnit: "gal", purchaseQty: 4, purchaseCost: 76.49, yieldPct: 100, onHandQty: 256, parQty: 128 }, // [W] Ken's 4x1 gal
      { id: "ing_salsa", sinceVersion: 2, name: "Salsa (#10 can)", category: "Pantry", baseUnit: "ozwt", purchaseUnit: "ozwt", purchaseQty: 102, purchaseCost: 5.67, yieldPct: 100, onHandQty: 204, parQty: 204 }, // [W] Del Sol $33.99/6 cans
      { id: "ing_artichoke", sinceVersion: 2, name: "Artichoke Hearts (#10 can)", category: "Pantry", baseUnit: "ozwt", purchaseUnit: "ozwt", purchaseQty: 102, purchaseCost: 10.58, yieldPct: 100, onHandQty: 204, parQty: 102 }, // [W] whole, $63.49/6 cans
    ];
  }

  // ---- Recipes ----
  // `portions` is the batch yield: component quantities are per BATCH, so a
  // portions: 8 sauce recipe divides its cost by 8 to get the plate cost.
  function seedRecipes() {
    const g = FoodCalc.uid;
    return [
      {
        id: "rec_classic_burger", sinceVersion: 1, name: "Classic Cheeseburger & Fries", category: "Sandwiches", menu: "Lunch",
        portions: 1, menuPrice: 16, targetFoodCostPct: 30, servingsPerWeek: 210,
        notes: "6 oz patty, smashed. Fries salted to order.",
        components: [
          { id: g("comp"), ingredientId: "ing_ground_beef", qty: 6 },
          { id: g("comp"), ingredientId: "ing_brioche_bun", qty: 1 },
          { id: g("comp"), ingredientId: "ing_cheddar", qty: 0.8 },
          { id: g("comp"), ingredientId: "ing_romaine", qty: 0.5 },
          { id: g("comp"), ingredientId: "ing_roma_tomato", qty: 1 },
          { id: g("comp"), ingredientId: "ing_yellow_onion", qty: 0.5 },
          { id: g("comp"), ingredientId: "ing_russet_potato", qty: 6 },
          { id: g("comp"), ingredientId: "ing_fryer_oil", qty: 0.5 },
          { id: g("comp"), ingredientId: "ing_kosher_salt", qty: 0.1 },
          { id: g("comp"), ingredientId: "ing_napkin", qty: 1 },
        ],
      },
      {
        id: "rec_chicken_caesar", sinceVersion: 1, name: "Chicken Caesar Salad", category: "Salads", menu: "Lunch",
        portions: 1, menuPrice: 14, targetFoodCostPct: 28, servingsPerWeek: 140,
        notes: "Grilled chicken, sliced on the bias.",
        components: [
          { id: g("comp"), ingredientId: "ing_chicken_breast", qty: 5 },
          { id: g("comp"), ingredientId: "ing_romaine", qty: 5 },
          { id: g("comp"), ingredientId: "ing_parmesan", qty: 0.6 },
          { id: g("comp"), ingredientId: "ing_crouton", qty: 1 },
          { id: g("comp"), ingredientId: "ing_caesar_dressing", qty: 2 },
          { id: g("comp"), ingredientId: "ing_lemon", qty: 0.1 },
          { id: g("comp"), ingredientId: "ing_black_pepper", qty: 0.02 },
          { id: g("comp"), ingredientId: "ing_napkin", qty: 1 },
        ],
      },
      {
        id: "rec_spaghetti_bolognese", sinceVersion: 1, name: "Spaghetti Bolognese", category: "Pasta", menu: "Dinner",
        portions: 8, menuPrice: 18, targetFoodCostPct: 26, servingsPerWeek: 120,
        notes: "Batch recipe — sauce yields 8 plates. Quantities below are per batch.",
        components: [
          { id: g("comp"), ingredientId: "ing_spaghetti", qty: 32 },
          { id: g("comp"), ingredientId: "ing_ground_beef", qty: 32 },
          { id: g("comp"), ingredientId: "ing_crushed_tomato", qty: 60 },
          { id: g("comp"), ingredientId: "ing_yellow_onion", qty: 12 },
          { id: g("comp"), ingredientId: "ing_carrot", qty: 8 },
          { id: g("comp"), ingredientId: "ing_garlic", qty: 1.5 },
          { id: g("comp"), ingredientId: "ing_olive_oil", qty: 4 },
          { id: g("comp"), ingredientId: "ing_parmesan", qty: 4 },
          { id: g("comp"), ingredientId: "ing_basil", qty: 0.5 },
          { id: g("comp"), ingredientId: "ing_kosher_salt", qty: 0.5 },
          { id: g("comp"), ingredientId: "ing_black_pepper", qty: 0.15 },
        ],
      },
      {
        id: "rec_grilled_salmon", sinceVersion: 1, name: "Grilled Salmon & Jasmine Rice", category: "Entrées", menu: "Dinner",
        portions: 1, menuPrice: 26, targetFoodCostPct: 30, servingsPerWeek: 95,
        notes: "6 oz fillet, skin on. Rice steamed in stock.",
        components: [
          { id: g("comp"), ingredientId: "ing_salmon_fillet", qty: 6 },
          { id: g("comp"), ingredientId: "ing_jasmine_rice", qty: 3 },
          { id: g("comp"), ingredientId: "ing_chicken_stock", qty: 6 },
          { id: g("comp"), ingredientId: "ing_carrot", qty: 2 },
          { id: g("comp"), ingredientId: "ing_butter", qty: 0.5 },
          { id: g("comp"), ingredientId: "ing_olive_oil", qty: 0.5 },
          { id: g("comp"), ingredientId: "ing_soy_sauce", qty: 0.5 },
          { id: g("comp"), ingredientId: "ing_lemon", qty: 0.25 },
          { id: g("comp"), ingredientId: "ing_kosher_salt", qty: 0.1 },
        ],
      },
      {
        id: "rec_margherita_flatbread", sinceVersion: 1, name: "Margherita Flatbread", category: "Flatbreads", menu: "Lunch",
        portions: 1, menuPrice: 15, targetFoodCostPct: 24, servingsPerWeek: 130,
        notes: "Deck oven, 6 minutes. Basil after the bake.",
        components: [
          { id: g("comp"), ingredientId: "ing_flatbread_dough", qty: 1 },
          { id: g("comp"), ingredientId: "ing_crushed_tomato", qty: 4 },
          { id: g("comp"), ingredientId: "ing_mozzarella", qty: 4 },
          { id: g("comp"), ingredientId: "ing_basil", qty: 0.15 },
          { id: g("comp"), ingredientId: "ing_olive_oil", qty: 0.5 },
          { id: g("comp"), ingredientId: "ing_kosher_salt", qty: 0.05 },
        ],
      },
      {
        id: "rec_chicken_alfredo", sinceVersion: 1, name: "Chicken Alfredo", category: "Pasta", menu: "Dinner",
        portions: 1, menuPrice: 19, targetFoodCostPct: 28, servingsPerWeek: 110,
        notes: "Sauce mounted to order.",
        components: [
          { id: g("comp"), ingredientId: "ing_spaghetti", qty: 4 },
          { id: g("comp"), ingredientId: "ing_chicken_breast", qty: 5 },
          { id: g("comp"), ingredientId: "ing_heavy_cream", qty: 4 },
          { id: g("comp"), ingredientId: "ing_parmesan", qty: 1.5 },
          { id: g("comp"), ingredientId: "ing_butter", qty: 1 },
          { id: g("comp"), ingredientId: "ing_mushroom", qty: 1.5 },
          { id: g("comp"), ingredientId: "ing_garlic", qty: 0.2 },
          { id: g("comp"), ingredientId: "ing_black_pepper", qty: 0.03 },
        ],
      },
      {
        id: "rec_herb_potatoes", sinceVersion: 1, name: "Herb Roasted Potatoes", category: "Sides", menu: "Dinner",
        portions: 12, menuPrice: 6, targetFoodCostPct: 18, servingsPerWeek: 90,
        notes: "Batch recipe — one full sheet pan yields 12 sides.",
        components: [
          { id: g("comp"), ingredientId: "ing_russet_potato", qty: 96 },
          { id: g("comp"), ingredientId: "ing_olive_oil", qty: 6 },
          { id: g("comp"), ingredientId: "ing_butter", qty: 3 },
          { id: g("comp"), ingredientId: "ing_garlic", qty: 1 },
          { id: g("comp"), ingredientId: "ing_kosher_salt", qty: 0.6 },
          { id: g("comp"), ingredientId: "ing_black_pepper", qty: 0.2 },
        ],
      },

      // ===== v2: Appetizers =====
      {
        id: "rec_wings", sinceVersion: 2, name: "Crispy Buffalo Wings", category: "Shareable", menu: "Appetizers",
        portions: 1, menuPrice: 15, targetFoodCostPct: 30, servingsPerWeek: 185,
        notes: "10 oz jumbo cut, fried twice. Sauce tossed to order.",
        components: [
          { id: g("comp"), ingredientId: "ing_chicken_wings", qty: 10 },
          { id: g("comp"), ingredientId: "ing_hot_sauce", qty: 2 },
          { id: g("comp"), ingredientId: "ing_butter", qty: 0.5 },
          { id: g("comp"), ingredientId: "ing_ranch", qty: 2 },
          { id: g("comp"), ingredientId: "ing_celery", qty: 1.5 },
          { id: g("comp"), ingredientId: "ing_fryer_oil", qty: 0.5 },
          { id: g("comp"), ingredientId: "ing_napkin", qty: 2 },
        ],
      },
      {
        id: "rec_nachos", sinceVersion: 2, name: "Loaded Nachos", category: "Shareable", menu: "Appetizers",
        portions: 1, menuPrice: 14, targetFoodCostPct: 28, servingsPerWeek: 150,
        notes: "Built in layers so the chips on the bottom still get cheese.",
        components: [
          { id: g("comp"), ingredientId: "ing_tortilla_chip", qty: 5 },
          { id: g("comp"), ingredientId: "ing_cheddar", qty: 3 },
          { id: g("comp"), ingredientId: "ing_ground_beef", qty: 3 },
          { id: g("comp"), ingredientId: "ing_salsa", qty: 3 },
          { id: g("comp"), ingredientId: "ing_sour_cream", qty: 2 },
          { id: g("comp"), ingredientId: "ing_jalapeno", qty: 0.5 },
          { id: g("comp"), ingredientId: "ing_green_onion", qty: 0.1 },
          { id: g("comp"), ingredientId: "ing_napkin", qty: 2 },
        ],
      },
      {
        id: "rec_mozz_sticks", sinceVersion: 2, name: "Fried Mozzarella Sticks", category: "Shareable", menu: "Appetizers",
        portions: 1, menuPrice: 11, targetFoodCostPct: 26, servingsPerWeek: 120,
        notes: "Six per order. Marinara warmed, not hot.",
        components: [
          { id: g("comp"), ingredientId: "ing_mozz_sticks", qty: 6 },
          { id: g("comp"), ingredientId: "ing_crushed_tomato", qty: 3 },
          { id: g("comp"), ingredientId: "ing_parmesan", qty: 0.3 },
          { id: g("comp"), ingredientId: "ing_basil", qty: 0.05 },
          { id: g("comp"), ingredientId: "ing_fryer_oil", qty: 0.4 },
          { id: g("comp"), ingredientId: "ing_napkin", qty: 1 },
        ],
      },
      {
        id: "rec_spinach_dip", sinceVersion: 2, name: "Spinach & Artichoke Dip", category: "Shareable", menu: "Appetizers",
        portions: 1, menuPrice: 13, targetFoodCostPct: 25, servingsPerWeek: 110,
        notes: "Baked to order in a cast iron crock.",
        components: [
          { id: g("comp"), ingredientId: "ing_spinach", qty: 2 },
          { id: g("comp"), ingredientId: "ing_artichoke", qty: 2.5 },
          { id: g("comp"), ingredientId: "ing_cream_cheese", qty: 3 },
          { id: g("comp"), ingredientId: "ing_parmesan", qty: 1 },
          { id: g("comp"), ingredientId: "ing_mozzarella", qty: 1.5 },
          { id: g("comp"), ingredientId: "ing_garlic", qty: 0.15 },
          { id: g("comp"), ingredientId: "ing_tortilla_chip", qty: 3 },
        ],
      },
      {
        id: "rec_garlic_bread", sinceVersion: 2, name: "Parmesan Garlic Bread", category: "Shareable", menu: "Appetizers",
        portions: 1, menuPrice: 8, targetFoodCostPct: 20, servingsPerWeek: 95,
        notes: "Half baguette, split and broiled.",
        components: [
          { id: g("comp"), ingredientId: "ing_baguette", qty: 1 },
          { id: g("comp"), ingredientId: "ing_butter", qty: 1.5 },
          { id: g("comp"), ingredientId: "ing_garlic", qty: 0.3 },
          { id: g("comp"), ingredientId: "ing_parmesan", qty: 0.5 },
          { id: g("comp"), ingredientId: "ing_olive_oil", qty: 0.25 },
          { id: g("comp"), ingredientId: "ing_basil", qty: 0.05 },
        ],
      },
      {
        id: "rec_tomato_bisque", sinceVersion: 2, name: "Tomato Basil Bisque", category: "Soup", menu: "Appetizers",
        portions: 8, menuPrice: 8, targetFoodCostPct: 18, servingsPerWeek: 85,
        notes: "Batch recipe — one batch yields 8 cups. Quantities below are per batch.",
        components: [
          { id: g("comp"), ingredientId: "ing_crushed_tomato", qty: 80 },
          { id: g("comp"), ingredientId: "ing_heavy_cream", qty: 24 },
          { id: g("comp"), ingredientId: "ing_chicken_stock", qty: 40 },
          { id: g("comp"), ingredientId: "ing_yellow_onion", qty: 10 },
          { id: g("comp"), ingredientId: "ing_butter", qty: 6 },
          { id: g("comp"), ingredientId: "ing_garlic", qty: 1 },
          { id: g("comp"), ingredientId: "ing_basil", qty: 0.75 },
          { id: g("comp"), ingredientId: "ing_kosher_salt", qty: 0.4 },
          { id: g("comp"), ingredientId: "ing_black_pepper", qty: 0.1 },
        ],
      },
      {
        id: "rec_shrimp_cocktail", sinceVersion: 2, name: "Chilled Shrimp Cocktail", category: "Shareable", menu: "Appetizers",
        portions: 1, menuPrice: 17, targetFoodCostPct: 32, servingsPerWeek: 70,
        notes: "Five 16/20 shrimp, poached and shocked.",
        components: [
          { id: g("comp"), ingredientId: "ing_shrimp", qty: 5 },
          { id: g("comp"), ingredientId: "ing_cocktail_sauce", qty: 2 },
          { id: g("comp"), ingredientId: "ing_lemon", qty: 0.25 },
          { id: g("comp"), ingredientId: "ing_romaine", qty: 1 },
        ],
      },

      // ===== v2: Lunch =====
      {
        id: "rec_turkey_club", sinceVersion: 2, name: "Turkey Club on Brioche", category: "Sandwiches", menu: "Lunch",
        portions: 1, menuPrice: 15, targetFoodCostPct: 30, servingsPerWeek: 125,
        notes: "Double stacked, cut on the diagonal. Fries to the side.",
        components: [
          { id: g("comp"), ingredientId: "ing_turkey_breast", qty: 5 },
          { id: g("comp"), ingredientId: "ing_bacon", qty: 1.5 },
          { id: g("comp"), ingredientId: "ing_brioche_bun", qty: 1 },
          { id: g("comp"), ingredientId: "ing_romaine", qty: 0.5 },
          { id: g("comp"), ingredientId: "ing_roma_tomato", qty: 1.5 },
          { id: g("comp"), ingredientId: "ing_mayo", qty: 1 },
          { id: g("comp"), ingredientId: "ing_russet_potato", qty: 6 },
          { id: g("comp"), ingredientId: "ing_fryer_oil", qty: 0.5 },
          { id: g("comp"), ingredientId: "ing_kosher_salt", qty: 0.1 },
          { id: g("comp"), ingredientId: "ing_napkin", qty: 1 },
        ],
      },
      {
        id: "rec_chicken_wrap", sinceVersion: 2, name: "Grilled Chicken Wrap", category: "Sandwiches", menu: "Lunch",
        portions: 1, menuPrice: 13, targetFoodCostPct: 28, servingsPerWeek: 115,
        notes: "Griddled seam-side down to seal.",
        components: [
          { id: g("comp"), ingredientId: "ing_flour_tortilla", qty: 1 },
          { id: g("comp"), ingredientId: "ing_chicken_breast", qty: 5 },
          { id: g("comp"), ingredientId: "ing_romaine", qty: 2 },
          { id: g("comp"), ingredientId: "ing_roma_tomato", qty: 1 },
          { id: g("comp"), ingredientId: "ing_cheddar", qty: 1 },
          { id: g("comp"), ingredientId: "ing_ranch", qty: 1.5 },
          { id: g("comp"), ingredientId: "ing_russet_potato", qty: 4 },
          { id: g("comp"), ingredientId: "ing_fryer_oil", qty: 0.3 },
        ],
      },
      {
        id: "rec_fish_chips", sinceVersion: 2, name: "Beer-Battered Fish & Chips", category: "Entrées", menu: "Lunch",
        portions: 1, menuPrice: 19, targetFoodCostPct: 32, servingsPerWeek: 105,
        notes: "Two pieces. Chips salted the second they leave the fryer.",
        components: [
          { id: g("comp"), ingredientId: "ing_cod_portion", qty: 8 },
          { id: g("comp"), ingredientId: "ing_russet_potato", qty: 8 },
          { id: g("comp"), ingredientId: "ing_tartar_sauce", qty: 2 },
          { id: g("comp"), ingredientId: "ing_lemon", qty: 0.25 },
          { id: g("comp"), ingredientId: "ing_fryer_oil", qty: 1 },
          { id: g("comp"), ingredientId: "ing_kosher_salt", qty: 0.15 },
          { id: g("comp"), ingredientId: "ing_napkin", qty: 1 },
        ],
      },
      {
        id: "rec_cobb_salad", sinceVersion: 2, name: "Chopped Cobb Salad", category: "Salads", menu: "Lunch",
        portions: 1, menuPrice: 16, targetFoodCostPct: 30, servingsPerWeek: 80,
        notes: "Chopped fine, dressed in the bowl, rows broken on the pass.",
        components: [
          { id: g("comp"), ingredientId: "ing_romaine", qty: 5 },
          { id: g("comp"), ingredientId: "ing_chicken_breast", qty: 4 },
          { id: g("comp"), ingredientId: "ing_bacon", qty: 1.5 },
          { id: g("comp"), ingredientId: "ing_egg", qty: 1 },
          { id: g("comp"), ingredientId: "ing_avocado", qty: 0.25 },
          { id: g("comp"), ingredientId: "ing_roma_tomato", qty: 1.5 },
          { id: g("comp"), ingredientId: "ing_cheddar", qty: 1 },
          { id: g("comp"), ingredientId: "ing_ranch", qty: 2 },
        ],
      },

      // ===== v2: Dinner =====
      {
        id: "rec_ribeye", sinceVersion: 2, name: "Bone-In Ribeye & Asparagus", category: "Entrées", menu: "Dinner",
        portions: 1, menuPrice: 58, targetFoodCostPct: 32, servingsPerWeek: 65,
        notes: "14 oz, grilled over hardwood, rested 6 minutes, butter basted.",
        components: [
          { id: g("comp"), ingredientId: "ing_ribeye", qty: 14 },
          { id: g("comp"), ingredientId: "ing_asparagus", qty: 4 },
          { id: g("comp"), ingredientId: "ing_russet_potato", qty: 8 },
          { id: g("comp"), ingredientId: "ing_butter", qty: 1 },
          { id: g("comp"), ingredientId: "ing_garlic", qty: 0.2 },
          { id: g("comp"), ingredientId: "ing_olive_oil", qty: 0.5 },
          { id: g("comp"), ingredientId: "ing_kosher_salt", qty: 0.15 },
          { id: g("comp"), ingredientId: "ing_black_pepper", qty: 0.05 },
        ],
      },
      {
        id: "rec_shrimp_scampi", sinceVersion: 2, name: "Shrimp Scampi", category: "Pasta", menu: "Dinner",
        portions: 1, menuPrice: 24, targetFoodCostPct: 30, servingsPerWeek: 75,
        notes: "Six shrimp. Pan sauce mounted with cold butter off the heat.",
        components: [
          { id: g("comp"), ingredientId: "ing_shrimp", qty: 6 },
          { id: g("comp"), ingredientId: "ing_spaghetti", qty: 4 },
          { id: g("comp"), ingredientId: "ing_butter", qty: 2 },
          { id: g("comp"), ingredientId: "ing_heavy_cream", qty: 2 },
          { id: g("comp"), ingredientId: "ing_garlic", qty: 0.4 },
          { id: g("comp"), ingredientId: "ing_lemon", qty: 0.3 },
          { id: g("comp"), ingredientId: "ing_parmesan", qty: 0.5 },
          { id: g("comp"), ingredientId: "ing_basil", qty: 0.1 },
          { id: g("comp"), ingredientId: "ing_black_pepper", qty: 0.03 },
        ],
      },
      {
        id: "rec_roast_chicken", sinceVersion: 2, name: "Herb Roasted Chicken", category: "Entrées", menu: "Dinner",
        portions: 1, menuPrice: 22, targetFoodCostPct: 28, servingsPerWeek: 90,
        notes: "Brined 8 hours, roasted on the bone side first.",
        components: [
          { id: g("comp"), ingredientId: "ing_chicken_breast", qty: 8 },
          { id: g("comp"), ingredientId: "ing_russet_potato", qty: 6 },
          { id: g("comp"), ingredientId: "ing_carrot", qty: 3 },
          { id: g("comp"), ingredientId: "ing_chicken_stock", qty: 4 },
          { id: g("comp"), ingredientId: "ing_butter", qty: 1.5 },
          { id: g("comp"), ingredientId: "ing_garlic", qty: 0.3 },
          { id: g("comp"), ingredientId: "ing_kosher_salt", qty: 0.15 },
          { id: g("comp"), ingredientId: "ing_black_pepper", qty: 0.04 },
        ],
      },
      {
        id: "rec_eggplant_parm", sinceVersion: 2, name: "Eggplant Parmesan", category: "Entrées", menu: "Dinner",
        portions: 1, menuPrice: 19, targetFoodCostPct: 24, servingsPerWeek: 55,
        notes: "Salted and pressed an hour before it gets breaded.",
        components: [
          { id: g("comp"), ingredientId: "ing_eggplant", qty: 8 },
          { id: g("comp"), ingredientId: "ing_crushed_tomato", qty: 6 },
          { id: g("comp"), ingredientId: "ing_mozzarella", qty: 3 },
          { id: g("comp"), ingredientId: "ing_spaghetti", qty: 3 },
          { id: g("comp"), ingredientId: "ing_ap_flour", qty: 1 },
          { id: g("comp"), ingredientId: "ing_egg", qty: 1 },
          { id: g("comp"), ingredientId: "ing_parmesan", qty: 1 },
          { id: g("comp"), ingredientId: "ing_olive_oil", qty: 1 },
          { id: g("comp"), ingredientId: "ing_basil", qty: 0.1 },
        ],
      },
    ];
  }

  // ---- Events ----
  // An event is a guest count plus the dishes you're serving it, each with a
  // portions-per-guest take rate and an overage % so the pass never runs dry.
  function seedEvents() {
    const g = FoodCalc.uid;
    return [
      {
        id: "ev_smith_wedding", sinceVersion: 1, name: "Smith Wedding Reception", date: "2026-10-11",
        guestCount: 120, pricingMode: "perGuest", pricePerGuest: 68,
        notes: "Plated dinner, guests pre-select one of two entrées. Sides served family style. Package price covers service and rentals, so food cost runs low as a % of it.",
        lines: [
          { id: g("ln"), recipeId: "rec_grilled_salmon", portionsPerGuest: 0.45, overagePct: 8 },
          { id: g("ln"), recipeId: "rec_chicken_alfredo", portionsPerGuest: 0.55, overagePct: 8 },
          { id: g("ln"), recipeId: "rec_herb_potatoes", portionsPerGuest: 1, overagePct: 10 },
        ],
        supplies: [
          { id: g("sup"), ingredientId: "ing_cutlery_kit", qtyPerGuest: 1 },
          { id: g("sup"), ingredientId: "ing_napkin", qtyPerGuest: 2 },
          { id: g("sup"), ingredientId: "ing_chafing_fuel", qtyPerGuest: 0.1 },
        ],
      },
      {
        id: "ev_corporate_lunch", sinceVersion: 1, name: "Northside Corporate Lunch", date: "2026-09-24",
        guestCount: 40, pricingMode: "menu", pricePerGuest: 0,
        notes: "Drop-off buffet, boxed individual portions. Billed at menu price per item.",
        lines: [
          { id: g("ln"), recipeId: "rec_chicken_caesar", portionsPerGuest: 0.5, overagePct: 10 },
          { id: g("ln"), recipeId: "rec_margherita_flatbread", portionsPerGuest: 0.75, overagePct: 10 },
          { id: g("ln"), recipeId: "rec_spaghetti_bolognese", portionsPerGuest: 0.4, overagePct: 10 },
        ],
        supplies: [
          { id: g("sup"), ingredientId: "ing_togo_container", qtyPerGuest: 1 },
          { id: g("sup"), ingredientId: "ing_cutlery_kit", qtyPerGuest: 1 },
          { id: g("sup"), ingredientId: "ing_napkin", qtyPerGuest: 2 },
        ],
      },
    ];
  }

  function defaultState() {
    return {
      ingredients: seedIngredients(),
      recipes: seedRecipes(),
      events: seedEvents(),
      settings: {
        defaultTargetFoodCostPct: 30,
        defaultOveragePct: 10,
      },
      seedVersion: SEED_VERSION,
    };
  }

  // Merge in any seed ingredients/recipes/events added since the state was last
  // saved, without touching anything the user has already edited or added.
  function applySeedUpdates(state) {
    const fromVersion = state.seedVersion || 1;
    if (fromVersion >= SEED_VERSION) return state;

    const mergeNew = (list, seeds) => {
      const existing = new Set(list.map((x) => x.id));
      seeds.forEach((item) => {
        if (item.sinceVersion > fromVersion && !existing.has(item.id)) list.push(item);
      });
    };

    mergeNew(state.ingredients, seedIngredients());
    mergeNew(state.recipes, seedRecipes());
    mergeNew(state.events, seedEvents());

    // v2 introduced menus. Backfill the menu onto seeded dishes the user already
    // has, so their existing recipes land on the right menu instead of a default.
    const seedMenus = new Map(seedRecipes().map((r) => [r.id, r.menu]));
    state.recipes.forEach((r) => {
      if (!r.menu && seedMenus.has(r.id)) r.menu = seedMenus.get(r.id);
    });

    state.seedVersion = SEED_VERSION;
    save(state);
    return state;
  }

  // Fill in fields that older saved data (or a hand-edited import) may be missing.
  function normalize(state) {
    state.settings = state.settings || {};
    if (state.settings.defaultTargetFoodCostPct == null) state.settings.defaultTargetFoodCostPct = 30;
    if (state.settings.defaultOveragePct == null) state.settings.defaultOveragePct = 10;
    state.events = state.events || [];

    state.ingredients.forEach((i) => {
      if (i.yieldPct == null) i.yieldPct = 100;
      if (i.onHandQty == null) i.onHandQty = 0;
      if (i.parQty == null) i.parQty = 0;
    });
    state.recipes.forEach((r) => {
      if (!r.portions) r.portions = 1;
      if (r.targetFoodCostPct == null) r.targetFoodCostPct = state.settings.defaultTargetFoodCostPct;
      if (r.servingsPerWeek == null) r.servingsPerWeek = 0;
      if (!r.menu) r.menu = "Dinner";
      r.components = r.components || [];
    });
    state.events.forEach((e) => {
      e.lines = e.lines || [];
      e.supplies = e.supplies || [];
      if (!e.pricingMode) e.pricingMode = "perGuest";
      if (e.pricePerGuest == null) e.pricePerGuest = 0;
    });
    return state;
  }

  function isValid(parsed) {
    return !!(parsed && Array.isArray(parsed.ingredients) && Array.isArray(parsed.recipes));
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      if (!isValid(parsed)) return defaultState();
      return normalize(applySeedUpdates(parsed));
    } catch (e) {
      console.warn("Failed to load saved data, using defaults.", e);
      return defaultState();
    }
  }

  function save(state) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("Could not save data.", e);
    }
  }

  function resetToDefaults() {
    const state = defaultState();
    save(state);
    return state;
  }

  return { load, save, resetToDefaults, defaultState, normalize, isValid, KEY };
})();
