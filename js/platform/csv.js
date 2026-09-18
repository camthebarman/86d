/* platform/csv.js — CSV in, CSV out, and an honest account of what went wrong.

   Restaurant data arrives as a spreadsheet somebody exported from a POS, a
   distributor portal or a countsheet they keep themselves. It is never clean:
   columns are named differently every time, rows are half-filled, prices have
   dollar signs in them and somebody's product name contains a comma.

   So this parses properly (quotes, escaped quotes, embedded newlines, CRLF,
   BOM) rather than splitting on commas, and validation reports every bad row
   with its line number instead of failing on the first one. A partial import
   that tells you which four rows to fix is useful; an exception is not. */

const Csv = (function () {
  // ---------- parsing ----------
  function parse(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    let started = false;   // distinguishes an empty trailing line from a real empty field

    const src = String(text || "").replace(/^﻿/, "");   // strip BOM

    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (inQuotes) {
        if (ch === '"') {
          if (src[i + 1] === '"') { field += '"'; i++; }     // "" is a literal quote
          else inQuotes = false;
        } else field += ch;
        continue;
      }
      if (ch === '"') { inQuotes = true; started = true; continue; }
      if (ch === ",") { row.push(field); field = ""; started = true; continue; }
      if (ch === "\r") continue;                              // CRLF
      if (ch === "\n") {
        row.push(field);
        if (started || row.length > 1 || row[0] !== "") rows.push(row);
        row = []; field = ""; started = false;
        continue;
      }
      field += ch;
      started = true;
    }
    row.push(field);
    if (started || row.length > 1 || row[0] !== "") rows.push(row);
    return rows;
  }

  // Header row plus objects keyed by header. Duplicate headers are suffixed
  // rather than silently overwriting each other.
  function parseObjects(text) {
    const rows = parse(text);
    if (!rows.length) return { headers: [], records: [] };
    const seen = new Map();
    const headers = rows[0].map((h) => {
      const name = String(h).trim();
      const n = (seen.get(name) || 0) + 1;
      seen.set(name, n);
      return n === 1 ? name : `${name} (${n})`;
    });
    const records = rows.slice(1).map((cells, i) => {
      const obj = {};
      headers.forEach((h, c) => (obj[h] = (cells[c] == null ? "" : cells[c]).trim()));
      // Line number as the human sees it in a spreadsheet: header is line 1.
      Object.defineProperty(obj, "__line", { value: i + 2, enumerable: false });
      return obj;
    });
    return { headers, records };
  }

  // ---------- writing ----------
  function escape(value) {
    const s = value == null ? "" : String(value);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function format(records, columns) {
    const cols = columns || (records.length ? Object.keys(records[0]) : []);
    const lines = [cols.map(escape).join(",")];
    records.forEach((r) => lines.push(cols.map((c) => escape(r[c])).join(",")));
    return lines.join("\r\n");
  }

  // ---------- value coercion ----------
  // Spreadsheet money: "$1,234.50", "(12.00)" for negatives, stray spaces.
  function toNumber(value) {
    if (value == null || value === "") return null;
    const negative = /^\(.*\)$/.test(String(value).trim());
    const cleaned = String(value).replace(/[$£€,\s()]/g, "");
    if (cleaned === "" || Number.isNaN(Number(cleaned))) return NaN;
    const n = Number(cleaned);
    return negative ? -n : n;
  }

  function toBool(value) {
    const s = String(value == null ? "" : value).trim().toLowerCase();
    if (["1", "true", "yes", "y"].indexOf(s) !== -1) return true;
    if (["0", "false", "no", "n", ""].indexOf(s) !== -1) return false;
    return null;
  }

  // ---------- validation ----------
  // A spec is { column: {as, required, min, max, oneOf, map} }. Returns every
  // valid row AND every problem, because the caller wants to show both.
  function validate(records, spec, opts) {
    const options = opts || {};
    const rows = [];
    const errors = [];
    const seenKeys = new Set();
    const keyOf = options.dedupeOn ? (r) => String(r[options.dedupeOn] || "").toLowerCase() : null;

    records.forEach((raw) => {
      const line = raw.__line;
      const out = {};
      let rowOk = true;

      Object.keys(spec).forEach((column) => {
        const rule = spec[column];
        const target = rule.as || column;
        const present = Object.prototype.hasOwnProperty.call(raw, column);
        let value = present ? raw[column] : "";

        if (!present && rule.required) {
          errors.push({ line, column, kind: "missing_column", message: `Column "${column}" is missing.` });
          rowOk = false;
          return;
        }
        if ((value === "" || value == null) && rule.required) {
          errors.push({ line, column, kind: "required", message: `"${column}" is empty.` });
          rowOk = false;
          return;
        }
        if (value === "" || value == null) {
          if ("default" in rule) out[target] = rule.default;
          return;
        }

        if (rule.type === "number" || rule.type === "money") {
          const n = toNumber(value);
          if (n == null || Number.isNaN(n)) {
            errors.push({ line, column, kind: "not_a_number", message: `"${value}" in "${column}" is not a number.` });
            rowOk = false;
            return;
          }
          if (rule.min != null && n < rule.min) {
            errors.push({ line, column, kind: "out_of_range", message: `"${column}" must be at least ${rule.min}.` });
            rowOk = false;
            return;
          }
          if (rule.max != null && n > rule.max) {
            errors.push({ line, column, kind: "out_of_range", message: `"${column}" must be at most ${rule.max}.` });
            rowOk = false;
            return;
          }
          value = n;
        } else if (rule.type === "boolean") {
          const b = toBool(value);
          if (b == null) {
            errors.push({ line, column, kind: "not_a_boolean", message: `"${value}" in "${column}" is not yes/no.` });
            rowOk = false;
            return;
          }
          value = b;
        } else {
          value = String(value).trim();
          if (rule.oneOf && rule.oneOf.indexOf(value) === -1) {
            errors.push({
              line, column, kind: "not_allowed",
              message: `"${value}" is not one of: ${rule.oneOf.join(", ")}.`,
            });
            rowOk = false;
            return;
          }
        }
        out[target] = rule.map ? rule.map(value, raw) : value;
      });

      if (!rowOk) return;

      // Never import the same thing twice because the sheet listed it twice.
      if (keyOf) {
        const key = keyOf(out);
        if (!key) {
          errors.push({ line, column: options.dedupeOn, kind: "required", message: "Nothing to match this row on." });
          return;
        }
        if (seenKeys.has(key)) {
          errors.push({ line, column: options.dedupeOn, kind: "duplicate", message: `"${out[options.dedupeOn]}" appears more than once in this file.` });
          return;
        }
        seenKeys.add(key);
      }
      out.__line = line;
      rows.push(out);
    });

    return { rows, errors, ok: errors.length === 0 };
  }

  // Best guess at which column is which, so the mapping step starts filled in.
  function suggestMapping(headers, fields) {
    const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
    const mapping = {};
    fields.forEach((field) => {
      const wanted = [field.name].concat(field.aliases || []).map(norm);
      const hit = headers.find((h) => wanted.indexOf(norm(h)) !== -1);
      mapping[field.name] = hit || null;
    });
    return mapping;
  }

  return { parse, parseObjects, format, escape, toNumber, toBool, validate, suggestMapping };
})();

if (typeof module !== "undefined" && module.exports) module.exports = { Csv };
