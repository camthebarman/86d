/* platform/audit.js — what happened, who did it, when.

   Not a log file and not analytics. This is the record a manager needs when
   the walk-in count is wrong on Tuesday and nobody remembers touching it, and
   it is the record a support conversation needs when a customer says data
   disappeared.

   Nothing is sent anywhere yet. Entries accumulate in a capped local ring and
   are shaped exactly like the future `audit_log` rows, so wiring a server sink
   later is a change to `sink` and nothing else. Writes are deliberately
   fire-and-forget: an audit failure must never fail the action it describes. */

const Audit = (function () {
  const COLLECTION = "audit";
  const MAX_ENTRIES = 500;   // a ring, because this is a device buffer, not the record

  // The actions worth reconstructing later. Anything not on this list is a
  // detail; anything on it changes money, stock, access or history.
  const ACTIONS = {
    INVENTORY_COUNTED: "inventory.counted",
    INVENTORY_FILLED_TO_PAR: "inventory.filled_to_par",
    RECIPE_CHANGED: "recipe.changed",
    RECIPE_DELETED: "recipe.deleted",
    INGREDIENT_CHANGED: "ingredient.changed",
    INGREDIENT_DELETED: "ingredient.deleted",
    PREP_CHANGED: "prep.changed",
    ITEM_86D: "item.86d",
    WASTE_RECORDED: "waste.recorded",
    PURCHASE_RECORDED: "purchase.recorded",
    EVENT_CHANGED: "event.changed",
    EVENT_CONSUMED: "event.consumed",
    TABLE_STATUS_CHANGED: "table.status_changed",
    WAITLIST_ADDED: "waitlist.added",
    WAITLIST_EDITED: "waitlist.edited",
    WAITLIST_SEATED: "waitlist.seated",
    WAITLIST_REMOVED: "waitlist.removed",
    SHIFT_CLEARED: "shift.cleared",
    DATA_RESET: "data.reset",
    DATA_IMPORTED: "data.imported",
    DATA_EXPORTED: "data.exported",
    SETTINGS_CHANGED: "settings.changed",
    USER_INVITED: "user.invited",
    USER_REMOVED: "user.removed",
    AI_ASKED: "ai.asked",
  };

  let sink = null;   // set to a server writer later; null means local only

  function entry(action, detail) {
    return {
      id: Ids.uuid(),
      organizationId: Org.id(),
      // No session yet, so no real actor. Named rather than left undefined so
      // the shape never changes when authentication arrives.
      actorId: null,
      actorRole: "owner",
      action,
      entity: (detail && detail.entity) || null,
      entityId: (detail && detail.entityId) || null,
      summary: (detail && detail.summary) || null,
      // Before/after are for small scalar changes (a count, a price). Whole
      // records are deliberately not captured — that is a diffing feature, and
      // storing a copy of everything on every keystroke fills the device.
      before: detail && "before" in detail ? detail.before : undefined,
      after: detail && "after" in detail ? detail.after : undefined,
      at: Time.now(),
    };
  }

  function record(action, detail) {
    const row = entry(action, detail);
    try {
      const log = Store.get(COLLECTION, []);
      log.push(row);
      if (log.length > MAX_ENTRIES) log.splice(0, log.length - MAX_ENTRIES);
      Store.set(COLLECTION, log).catch(() => { /* an audit write must not break the action */ });
    } catch (e) {
      /* same */
    }
    if (sink) {
      try { sink(row); } catch (e) { /* same */ }
    }
    return row;
  }

  function list(opts) {
    const o = opts || {};
    let rows = Store.get(COLLECTION, []).slice().reverse();
    if (o.action) rows = rows.filter((r) => r.action === o.action);
    if (o.entityId) rows = rows.filter((r) => r.entityId === o.entityId);
    if (o.limit) rows = rows.slice(0, o.limit);
    return rows;
  }

  function clear() { return Store.set(COLLECTION, []); }
  function useSink(fn) { sink = fn; }

  return { record, list, clear, useSink, ACTIONS, COLLECTION };
})();

if (typeof module !== "undefined" && module.exports) module.exports = { Audit };
