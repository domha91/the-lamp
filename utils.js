(function () {
  "use strict";

  window.Memorial = window.Memorial || {};

  // Generic deterministic helpers shared across the app.
  // Keep these small, dependency-free, and stable across browsers.

  const Utils = {};

  Utils.clamp = function clamp(x, lo, hi) {
    x = Number(x);
    if (Number.isNaN(x)) return lo;
    return Math.max(lo, Math.min(hi, x));
  };

  Utils.clamp01 = function clamp01(x) {
    return Utils.clamp(x, 0, 1);
  };

  // FNV-1a 32-bit hash (fast, stable, non-cryptographic).
  Utils.fnv1a32 = function fnv1a32(str) {
    str = String(str ?? "");
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  };

  // Stable "YYYY-MM-DD" computed in a specific IANA timezone.
  // This avoids local-machine timezone differences impacting deterministic selection.
  Utils.isoDateInTimeZone = function isoDateInTimeZone(opts = {}) {
    const date = opts.date ? new Date(opts.date) : new Date();
    const timeZone = opts.timeZone || "Europe/London";

    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date);

    const get = (type) => parts.find(p => p.type === type)?.value || "";
    const y = get("year");
    const m = get("month");
    const d = get("day");
    if (!y || !m || !d) return "";

    return `${y}-${m}-${d}`;
  };

  window.Memorial.Utils = Utils;
})();