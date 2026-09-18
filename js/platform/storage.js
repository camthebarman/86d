/* platform/storage.js — the seam between this app and its database.

   Modules do not talk to localStorage. They talk to Store, which talks to an
   adapter. Swapping LocalStorageAdapter for SupabaseAdapter is meant to be the
   whole of the migration — no business logic should have to change.

   Two shapes, deliberately:

   - The ADAPTER interface is async (read/write/remove/keys), because every
     real backend is. Nothing may assume a write completes synchronously.

   - Module reads are synchronous, served from a cache hydrated once at boot.
     The app is a shift tool: a host tapping a table cannot await a round trip,
     and rewriting every render path to be async would be the rewrite this
     refactor exists to avoid. So: read from cache, write through the async
     adapter, surface write failures rather than silently dropping them.

   Records are stored as an envelope, not a bare blob:

     { v, org, collection, updatedAt, data }

   which is the same shape a database row will have — one table of documents
   keyed by (organization_id, collection), or one table per collection with the
   same columns. Either way the payload does not have to change shape again. */

const Store = (function () {
  const ENVELOPE_VERSION = 1;
  const PREFIX = "86d";

  // Keys written before the organization concept existed. Read once, rewritten
  // into the namespaced key, then left alone — never deleted, so a downgrade
  // doesn't destroy anyone's counts.
  const LEGACY_KEYS = { food: "gbg.food.v1", bev: "gbg.bev.v1", floor: "gbg.floor.v1" };

  // ---------- adapters ----------
  const LocalStorageAdapter = {
    name: "localStorage",
    available() {
      try {
        const probe = PREFIX + ":probe";
        localStorage.setItem(probe, "1");
        localStorage.removeItem(probe);
        return true;
      } catch (e) {
        return false;
      }
    },
    async read(key) {
      try {
        return localStorage.getItem(key);
      } catch (e) {
        throw AppErrors.storage("Could not read from this browser's storage.", { key, cause: e });
      }
    },
    async write(key, text) {
      try {
        localStorage.setItem(key, text);
      } catch (e) {
        // Quota is the common one, and it is worth saying so: the user can act
        // on "this device is full" but not on a silent no-op.
        const quota = e && (e.name === "QuotaExceededError" || e.code === 22);
        throw AppErrors.storage(
          quota ? "This browser is out of storage space, so the change wasn't saved." : "Could not save to this browser's storage.",
          { key, quota, cause: e }
        );
      }
    },
    async remove(key) {
      try {
        localStorage.removeItem(key);
      } catch (e) {
        throw AppErrors.storage("Could not clear this browser's storage.", { key, cause: e });
      }
    },
    async keys(prefix) {
      try {
        const out = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (!prefix || (k && k.indexOf(prefix) === 0)) out.push(k);
        }
        return out;
      } catch (e) {
        return [];
      }
    },
  };

  // Used by tests and by any environment without localStorage, so the app
  // degrades to in-memory rather than throwing on every keystroke.
  function MemoryAdapter(seed) {
    const map = new Map(Object.entries(seed || {}));
    return {
      name: "memory",
      available: () => true,
      async read(key) { return map.has(key) ? map.get(key) : null; },
      async write(key, text) { map.set(key, text); },
      async remove(key) { map.delete(key); },
      async keys(prefix) { return Array.from(map.keys()).filter((k) => !prefix || k.indexOf(prefix) === 0); },
    };
  }

  let adapter = null;
  const cache = new Map();          // collection -> data (hydrated, synchronous)
  const listeners = new Set();
  let hydrated = false;
  let lastWriteError = null;

  function use(next) {
    adapter = next;
    cache.clear();
    hydrated = false;
    return adapter;
  }

  function currentAdapter() {
    if (!adapter) {
      adapter = LocalStorageAdapter.available() ? LocalStorageAdapter : MemoryAdapter();
    }
    return adapter;
  }

  // ---------- keys ----------
  // Every key carries the organization. Two restaurants on one device never
  // collide, and the key maps directly onto a WHERE organization_id clause.
  function keyFor(collection, orgId) {
    return `${PREFIX}:${orgId || Org.id()}:${collection}`;
  }

  function envelope(collection, data) {
    return {
      v: ENVELOPE_VERSION,
      org: Org.id(),
      collection,
      updatedAt: Time.now(),
      data,
    };
  }

  function unwrap(text, collection) {
    if (!text) return undefined;
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw AppErrors.storage(`Saved ${collection} data is not readable and was ignored.`, { collection, cause: e });
    }
    // An envelope, or a bare payload from before envelopes existed.
    if (parsed && typeof parsed === "object" && parsed.v && "data" in parsed) return parsed.data;
    return parsed;
  }

  // ---------- hydrate ----------
  // Called once at boot, before any module reads. Everything after this is
  // served from memory; this is the only place a read can be slow.
  async function hydrate(collections) {
    const a = currentAdapter();
    const names = collections || Object.keys(LEGACY_KEYS);
    for (const collection of names) {
      let data;
      try {
        data = unwrap(await a.read(keyFor(collection)), collection);
      } catch (e) {
        // A corrupt payload must not stop the other modules from booting.
        console.warn(AppErrors.message(e));
        data = undefined;
      }
      if (data === undefined && LEGACY_KEYS[collection]) {
        data = await adoptLegacy(collection, a);
      }
      if (data !== undefined) cache.set(collection, data);
    }
    hydrated = true;
    return cache;
  }

  // One-time move from the pre-organization key into the namespaced one.
  async function adoptLegacy(collection, a) {
    let legacy;
    try {
      legacy = unwrap(await a.read(LEGACY_KEYS[collection]), collection);
    } catch (e) {
      return undefined;
    }
    if (legacy === undefined) return undefined;
    try {
      await a.write(keyFor(collection), JSON.stringify(envelope(collection, legacy)));
    } catch (e) {
      console.warn(AppErrors.message(e));
    }
    return legacy;
  }

  // ---------- the API modules use ----------
  function get(collection, fallback) {
    if (!hydrated) {
      // A programming error, not a user error: something read before boot.
      console.warn(`Store.get("${collection}") ran before hydrate(); returning the fallback.`);
    }
    return cache.has(collection) ? cache.get(collection) : fallback;
  }

  // Writes through to the adapter. Returns a promise so callers CAN wait, but
  // the app deliberately doesn't: the cache is already correct, and a failed
  // write is reported rather than blocking the interaction that caused it.
  function set(collection, data) {
    cache.set(collection, data);
    notify(collection, data);
    const text = JSON.stringify(envelope(collection, data));
    return currentAdapter()
      .write(keyFor(collection), text)
      .then(() => { lastWriteError = null; return data; })
      .catch((err) => {
        lastWriteError = err;
        onWriteError(err, collection);
        throw err;
      });
  }

  function update(collection, fn, fallback) {
    const next = fn(get(collection, fallback));
    return set(collection, next);
  }

  function remove(collection) {
    cache.delete(collection);
    notify(collection, undefined);
    return currentAdapter().remove(keyFor(collection));
  }

  function list() {
    return Array.from(cache.keys());
  }

  async function clear(orgId) {
    const a = currentAdapter();
    const prefix = `${PREFIX}:${orgId || Org.id()}:`;
    const keys = await a.keys(prefix);
    for (const k of keys) await a.remove(k);
    cache.clear();
    hydrated = false;
  }

  // ---------- change notification ----------
  // How the dashboard and the Ask tab will learn that something moved without
  // polling, and how a future realtime subscription will deliver server pushes.
  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }
  function notify(collection, data) {
    listeners.forEach((fn) => {
      try { fn(collection, data); } catch (e) { console.warn(e); }
    });
  }

  let writeErrorHandler = (err) => console.warn(AppErrors.message(err));
  function onWriteErrorUse(fn) { writeErrorHandler = fn; }
  function onWriteError(err, collection) { writeErrorHandler(err, collection); }

  return {
    use, currentAdapter, LocalStorageAdapter, MemoryAdapter,
    hydrate, get, set, update, remove, list, clear,
    subscribe, onWriteErrorUse,
    keyFor, envelope,
    isHydrated: () => hydrated,
    lastError: () => lastWriteError,
    ENVELOPE_VERSION, LEGACY_KEYS,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = { Store };
