/* platform/org.js — which restaurant this data belongs to.

   Today there is exactly one organization and it is called "demo". That is
   deliberate: every storage key, every exported file and every AI request
   already carries an organization id, so the day a real one arrives from a
   session there is nothing to thread through — only this module changes.

   There is no authentication here and no membership check. This is the seam
   where both will attach:

     User -> OrganizationMember -> Organization -> this module -> Store

   Nothing else in the app may hard-code a venue name, a currency or a
   timezone. Ask the organization. */

const Org = (function () {
  const DEMO = {
    id: "demo",
    name: "Generic Bar & Grill",
    shortName: "GB&G",
    // ISO 4217 / IANA. The app formats money and dates through these rather
    // than assuming the browser's locale is the restaurant's.
    currency: "USD",
    timezone: "America/New_York",
    locations: 1,
    // Marks this as the shipped demo tenant. Real organizations created later
    // must have isDemo false, so demo data can never be mistaken for a
    // customer's operational data (and vice versa).
    isDemo: true,
    plan: "demo",
  };

  let current = DEMO;

  function get() { return current; }
  function id() { return current.id; }
  function name() { return current.name; }
  function currency() { return current.currency; }

  // Swapped wholesale when a session resolves a real organization. Modules
  // must re-read their data after this: the storage namespace has changed.
  function set(org) {
    if (!org || !org.id) throw AppErrors.validation("An organization needs an id.", { org });
    current = Object.assign({}, DEMO, org);
    return current;
  }

  function isDemo() { return !!current.isDemo; }

  function money(n) {
    const v = Number(n) || 0;
    return v.toLocaleString(undefined, { style: "currency", currency: current.currency });
  }

  return { get, id, name, currency, set, isDemo, money, DEMO };
})();

if (typeof module !== "undefined" && module.exports) module.exports = { Org };
