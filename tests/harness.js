/* tests/harness.js — a test runner in a hundred lines, and no dependencies.

   The app ships as plain <script> files that assign to globals. To test them
   in Node we evaluate those files into one shared sandbox, in the same order
   index.html loads them, with just enough of a browser stubbed for the modules
   that touch one. That keeps the tests honest: they run the SAME source the
   browser runs, not a parallel copy. */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");

function createSandbox() {
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    key: (i) => Array.from(store.keys())[i],
    get length() { return store.size; },
    clear: () => store.clear(),
  };
  const sandbox = {
    console,
    localStorage,
    crypto: require("crypto").webcrypto,
    TextDecoder,
    setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Math, JSON, Object, Array, String, Number, Boolean, Error, Map, Set, Promise, RegExp,
    Intl, isNaN, parseInt, parseFloat, URL,
    __store: store,
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  return vm.createContext(sandbox);
}

// Loads app source into the sandbox. Only files that are genuinely free of the
// DOM can be loaded — which is itself the architectural point being tested.
//
// One transform is needed: the app declares its modules as `const Foo = ...`,
// and a top-level const inside vm.runInContext lands in that script's lexical
// scope rather than on the shared global, so the next file could not see it.
// Rewriting the declaration to an assignment reproduces what a browser does
// with separate <script> tags, which is the environment being emulated.
const MODULE_DECL = /^const ([A-Z][A-Za-z0-9_]*) = \(function/m;

function load(sandbox, files) {
  files.forEach((rel) => {
    let code = fs.readFileSync(path.join(ROOT, rel), "utf8");
    const match = code.match(MODULE_DECL);
    if (match) {
      code = code.replace(MODULE_DECL, `globalThis.${match[1]} = (function`);
    }
    vm.runInContext(code, sandbox, { filename: rel });
  });
  return sandbox;
}

// ---------- assertions ----------
let suites = [];
let current = null;

function describe(name, fn) {
  current = { name, tests: [] };
  suites.push(current);
  fn();
  current = null;
}

function it(name, fn) {
  if (!current) throw new Error("it() outside describe()");
  current.tests.push({ name, fn });
}

function fail(message, actual, expected) {
  const err = new Error(message);
  err.actual = actual;
  err.expected = expected;
  throw err;
}

const expect = (actual) => ({
  toBe(expected) {
    if (actual !== expected) fail(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`, actual, expected);
  },
  toEqual(expected) {
    const a = JSON.stringify(actual), b = JSON.stringify(expected);
    if (a !== b) fail(`expected ${b}, got ${a}`, actual, expected);
  },
  toBeCloseTo(expected, digits) {
    const tolerance = Math.pow(10, -(digits == null ? 2 : digits)) / 2;
    if (Math.abs(actual - expected) > tolerance) fail(`expected ~${expected}, got ${actual}`, actual, expected);
  },
  toBeTruthy() { if (!actual) fail(`expected truthy, got ${JSON.stringify(actual)}`); },
  toBeFalsy() { if (actual) fail(`expected falsy, got ${JSON.stringify(actual)}`); },
  toBeNull() { if (actual !== null) fail(`expected null, got ${JSON.stringify(actual)}`); },
  toContain(needle) {
    const ok = Array.isArray(actual) ? actual.indexOf(needle) !== -1 : String(actual).indexOf(needle) !== -1;
    if (!ok) fail(`expected ${JSON.stringify(actual)} to contain ${JSON.stringify(needle)}`);
  },
  toHaveLength(n) {
    if (!actual || actual.length !== n) fail(`expected length ${n}, got ${actual ? actual.length : "none"}`);
  },
  toThrow(kind) {
    let threw = null;
    try { actual(); } catch (e) { threw = e; }
    if (!threw) fail("expected it to throw, but it didn't");
    if (kind && threw.kind !== kind) fail(`expected a "${kind}" error, got "${threw.kind}"`);
  },
});

async function run() {
  let passed = 0;
  const failures = [];
  for (const suite of suites) {
    for (const test of suite.tests) {
      try {
        await test.fn();
        passed++;
      } catch (err) {
        failures.push({ suite: suite.name, test: test.name, err });
      }
    }
    const suiteFailures = failures.filter((f) => f.suite === suite.name).length;
    const mark = suiteFailures ? "FAIL" : "ok  ";
    console.log(`${mark} ${suite.name} (${suite.tests.length - suiteFailures}/${suite.tests.length})`);
  }
  if (failures.length) {
    console.log("");
    failures.forEach((f) => {
      console.log(`  FAIL ${f.suite} › ${f.test}`);
      console.log(`       ${f.err.message}`);
    });
  }
  console.log(`\n${passed} passed, ${failures.length} failed`);
  return failures.length;
}

module.exports = { createSandbox, load, describe, it, expect, run, ROOT };
