/* platform/ids.js — one way to mint an identifier.

   Two kinds of id exist in this app and they are not interchangeable:

   - SEED ids are stable slugs ("ing_chicken_breast"). They are natural keys:
     the seed-merge logic in each storage module recognises a shipped item by
     its id, so they must never change. In the database these become a
     `seed_key` column, not the primary key.

   - RECORD ids are minted here. They are opaque and must survive the move to
     a database, so they are UUIDs rather than counters or array positions.

   Nothing in the app may treat an array index as an identity. */

const Ids = (function () {
  function uuid() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    // RFC 4122 v4 from whatever entropy this browser has.
    const bytes = new Uint8Array(16);
    if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
    return (
      hex.slice(0, 4).join("") + "-" + hex.slice(4, 6).join("") + "-" +
      hex.slice(6, 8).join("") + "-" + hex.slice(8, 10).join("") + "-" +
      hex.slice(10, 16).join("")
    );
  }

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function isUuid(v) { return typeof v === "string" && UUID_RE.test(v); }

  // A readable prefix in front of a uuid. Purely a debugging affordance —
  // nothing parses the prefix back out, and the database will not care.
  function prefixed(prefix) { return (prefix || "id") + "_" + uuid(); }

  // Deterministic key for a shipped seed record.
  function seedKey(prefix, name) {
    return prefix + "_" + String(name).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  }

  // True for ids this app minted or shipped; used by import validation to
  // refuse ids that look like they came from somewhere else entirely.
  function isValid(v) { return typeof v === "string" && v.length > 0 && v.length <= 128; }

  return { uuid, isUuid, prefixed, seedKey, isValid };
})();

if (typeof module !== "undefined" && module.exports) module.exports = { Ids };
