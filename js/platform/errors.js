/* platform/errors.js — the failure vocabulary.

   Six kinds of failure, because they want six different responses: a
   validation error is the user's to fix, a storage error is the device's, a
   network error is worth retrying, and a calculation error is a bug. Code that
   catches everything as one kind cannot react usefully to any of them.

   `AppError.kind` is what callers branch on. `details` carries whatever the
   handler needs (a field name, a row number, an HTTP status) without anyone
   having to parse a message string. */

const AppErrors = (function () {
  const KINDS = ["validation", "not_found", "storage", "calculation", "network", "ai", "permission"];

  class AppError extends Error {
    constructor(kind, message, details) {
      super(message);
      this.name = "AppError";
      this.kind = KINDS.indexOf(kind) === -1 ? "calculation" : kind;
      this.details = details || {};
    }
  }

  const make = (kind) => (message, details) => new AppError(kind, message, details);

  return {
    AppError,
    KINDS,
    validation: make("validation"),
    notFound: make("not_found"),
    storage: make("storage"),
    calculation: make("calculation"),
    network: make("network"),
    ai: make("ai"),
    permission: make("permission"),
    is(err, kind) { return err instanceof AppError && (kind == null || err.kind === kind); },
    // What a user should see. Anything unrecognised is reported as itself
    // rather than swallowed into a generic "something went wrong".
    message(err) {
      if (err instanceof AppError) return err.message;
      return (err && err.message) || String(err);
    },
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = { AppErrors };
