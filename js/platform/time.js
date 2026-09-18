/* platform/time.js — one way to stamp and read a moment.

   The rule: STORED time is ISO 8601 in UTC ("2026-09-18T08:30:00.000Z").
   DISPLAYED time is whatever reads well to a human, produced at render time
   and never written back. A display string must never become the stored value
   — that is how a timezone bug becomes a data-loss bug.

   Durations are a different thing and stay as plain milliseconds: a table's
   `lastTurnMs` is "how long that turn took", not "when". Durations get an
   explicit `Ms` suffix so the two can't be confused.

   `ms()` accepts either form so data written before this module existed keeps
   working; everything written from here on is ISO. */

const Time = (function () {
  function now() { return new Date().toISOString(); }

  // Epoch milliseconds for arithmetic. Accepts ISO strings, epoch numbers and
  // Date objects, so a half-migrated store still computes correctly.
  function ms(value) {
    if (value == null) return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (value instanceof Date) return value.getTime();
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }

  function iso(value) {
    const t = ms(value);
    return t == null ? null : new Date(t).toISOString();
  }

  function isIso(value) {
    return typeof value === "string" && !Number.isNaN(Date.parse(value)) && /\d{4}-\d{2}-\d{2}T/.test(value);
  }

  function since(value, from) {
    const t = ms(value);
    if (t == null) return 0;
    return (from == null ? Date.now() : ms(from)) - t;
  }

  // A calendar day with no time and no zone — for an event date, where
  // "2026-10-11" is the fact and midnight-in-some-zone is not.
  function today() { return new Date().toISOString().slice(0, 10); }
  function isDateOnly(v) { return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v); }

  // Stamps a record on the way into storage. createdAt is written once.
  function touch(record) {
    if (!record.createdAt) record.createdAt = now();
    record.updatedAt = now();
    return record;
  }

  return { now, ms, iso, isIso, since, today, isDateOnly, touch };
})();

if (typeof module !== "undefined" && module.exports) module.exports = { Time };
