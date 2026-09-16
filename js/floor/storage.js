/* floor/storage.js — state shape, seed layouts, localStorage persistence.

   State holds only what a host actually changes during service: each table's
   position, status, guest count, notes and seat-timer. Room fixtures (walls,
   bar rail, kitchen pass) are static scenery, so they live here as constants
   rather than in saved state — nothing to migrate when they change.

   Seed tables carry fixed ids so that saved layouts can be merged forward:
   tables added to a seed later show up for existing users without clobbering
   the positions they've already dragged into place. */

const FloorStorage = (function () {
  const KEY = "gbg.floor.v1";
  const SEED_VERSION = 1;

  const STATUSES = ["clean", "seated", "dirty"];
  const STATUS_LABELS = { clean: "Clean", seated: "Seated", dirty: "Dirty" };

  // x / y are percentages of the floor, measured to the CENTER of the shape.
  // w is a percentage of the floor's width; the shape class fixes the aspect
  // ratio, so tables keep their proportions at every screen size.
  function t(id, label, shape, seats, w, x, y) {
    return { id, label, shape, seats, w, x, y, status: "clean", guests: 0, notes: "", party: null, seatedAt: null, lastTurnMs: null };
  }

  // Dining room: harbor-view windows across the top, booths down the left
  // wall, four-tops through the middle, large rounds by the service side.
  function seedDining() {
    return [
      t("d_w1", "W1", "round", 2, 7, 13, 14),
      t("d_w2", "W2", "round", 2, 7, 26, 14),
      t("d_w3", "W3", "round", 2, 7, 39, 14),
      t("d_w4", "W4", "round", 2, 7, 52, 14),
      t("d_w5", "W5", "round", 2, 7, 65, 14),

      t("d_b1", "B1", "booth", 4, 13, 10, 34),
      t("d_b2", "B2", "booth", 4, 13, 10, 52),
      t("d_b3", "B3", "booth", 4, 13, 10, 70),
      t("d_b4", "B4", "booth", 6, 13, 10, 88),

      t("d_10", "10", "square", 4, 9, 32, 37),
      t("d_11", "11", "square", 4, 9, 46, 37),
      t("d_12", "12", "square", 4, 9, 32, 58),
      t("d_13", "13", "square", 4, 9, 46, 58),
      t("d_14", "14", "square", 4, 9, 32, 79),
      t("d_15", "15", "square", 4, 9, 46, 79),

      t("d_20", "20", "round", 6, 11, 65, 40),
      t("d_21", "21", "round", 6, 11, 65, 62),
      t("d_22", "22", "round", 8, 11, 65, 84),
    ];
  }

  // Bar: rail seats under the counter, high-tops behind them, low lounge
  // tables along the patio side and one communal table at the back.
  function seedBar() {
    const stools = [];
    for (let i = 0; i < 10; i++) {
      stools.push(t("b_s" + (i + 1), "S" + (i + 1), "stool", 1, 4.5, 15 + i * 5.6, 30));
    }
    return stools.concat([
      t("b_h1", "H1", "round", 4, 8, 14, 52),
      t("b_h2", "H2", "round", 4, 8, 30, 52),
      t("b_h3", "H3", "round", 4, 8, 46, 52),
      t("b_h4", "H4", "round", 4, 8, 62, 52),

      t("b_l1", "L1", "square", 2, 7, 14, 74),
      t("b_l2", "L2", "square", 2, 7, 29, 74),
      t("b_l3", "L3", "square", 4, 7, 44, 74),
      t("b_l4", "L4", "square", 4, 7, 59, 74),

      t("b_c1", "Communal", "communal", 10, 26, 40, 92),
    ]);
  }

  // Static scenery. w / h are percentages of the floor's width / height.
  const FIXTURES = {
    dining: [
      { label: "Harbor Windows", x: 48, y: 3, w: 58, h: 5 },
      { label: "Kitchen / Pass", x: 88, y: 24, w: 20, h: 36 },
      { label: "Service Bar", x: 88, y: 68, w: 20, h: 26 },
      { label: "Host Stand", x: 9, y: 4, w: 16, h: 6 },
      { label: "Entrance", x: 40, y: 97, w: 20, h: 5 },
    ],
    bar: [
      { label: "Back Bar", x: 42, y: 5, w: 60, h: 7 },
      { label: "Bar Rail", x: 42, y: 17, w: 60, h: 11 },
      { label: "Harbor Patio", x: 88, y: 58, w: 20, h: 66 },
      { label: "Entrance", x: 12, y: 96, w: 20, h: 6 },
    ],
  };

  const LAYOUTS = [
    { id: "dining", label: "Dining Room", seed: seedDining },
    { id: "bar", label: "Bar", seed: seedBar },
  ];

  // A first visit opens on a busy Friday night rather than an empty room, so
  // the app shows what it does before anyone has touched it. Clear All is the
  // one tap to an empty floor for a real shift.
  function defaultState() {
    const state = {
      version: SEED_VERSION,
      activeLayout: "dining",
      layouts: { dining: seedDining(), bar: seedBar() },
      waitlist: [],
    };
    if (typeof FloorDemo !== "undefined") FloorDemo.apply(state);
    return state;
  }

  function fixtures(layoutId) {
    return FIXTURES[layoutId] || [];
  }

  function seedFor(layoutId) {
    const layout = LAYOUTS.find((l) => l.id === layoutId);
    return layout ? layout.seed() : [];
  }

  // Pull in seed tables the saved state doesn't have yet, and backfill any
  // field a saved table is missing — keeps old saves working as the app grows.
  function applySeedUpdates(state) {
    LAYOUTS.forEach((layout) => {
      const saved = Array.isArray(state.layouts[layout.id]) ? state.layouts[layout.id] : [];
      const seeds = layout.seed();
      seeds.forEach((seed) => {
        const match = saved.find((s) => s.id === seed.id);
        if (!match) saved.push(seed);
        else Object.keys(seed).forEach((k) => { if (match[k] === undefined) match[k] = seed[k]; });
      });
      state.layouts[layout.id] = saved;
    });
    state.version = SEED_VERSION;
    return state;
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.layouts || !Array.isArray(parsed.waitlist)) return defaultState();
      if (!LAYOUTS.some((l) => l.id === parsed.activeLayout)) parsed.activeLayout = "dining";
      return applySeedUpdates(parsed);
    } catch (e) {
      console.warn("Failed to load saved data, using defaults.", e);
      return defaultState();
    }
  }

  function save(state) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("Failed to save data.", e);
    }
  }

  // End of shift: empty the waitlist and hand every table back clean, notes
  // included — "Birthday at 9" must not greet tomorrow's host. A single table
  // flipping back to clean mid-service keeps its note, since that one is
  // usually about the table itself ("wobbly leg"); this is the full reset.
  // Positions are the exception: the room was arranged once to match the real
  // floor and shouldn't have to be rebuilt tomorrow.
  function clearShift(state) {
    state.waitlist = [];
    LAYOUTS.forEach((layout) => {
      (state.layouts[layout.id] || []).forEach((table) => {
        table.status = "clean";
        table.guests = 0;
        table.notes = "";
        table.party = null;
        table.seatedAt = null;
        table.lastTurnMs = null;
      });
    });
    return state;
  }

  // Snap tables back to their seeded spots without touching live service data.
  function resetPositions(state, layoutId) {
    const seeds = seedFor(layoutId);
    const tables = state.layouts[layoutId] || [];
    seeds.forEach((seed) => {
      const table = tables.find((t) => t.id === seed.id);
      if (table) { table.x = seed.x; table.y = seed.y; table.w = seed.w; table.shape = seed.shape; }
      else tables.push(seed);
    });
    return state;
  }

  return { load, save, defaultState, clearShift, resetPositions, fixtures, LAYOUTS, STATUSES, STATUS_LABELS, KEY };
})();
