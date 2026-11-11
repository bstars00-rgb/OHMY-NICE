/* Date helpers — all arithmetic in UTC on YYYY-MM-DD strings so results never depend on the browser time zone. */
(function (root, factory) {
  const NS = root.OMH || (root.OMH = {});
  const api = factory();
  NS.Dates = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';
  const D_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  const DT_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;
  function validYMD(y, m, d) { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; }
  function isDate(s) { const m = D_RE.exec(String(s)); return !!m && validYMD(+m[1], +m[2], +m[3]); }
  function isDateTime(s) {
    const m = DT_RE.exec(String(s)); if (!m || !validYMD(+m[1], +m[2], +m[3]) || +m[4] >= 24 || +m[5] >= 60) return false;
    if (m[6] && +m[6].slice(1, 3) >= 60) return false;                                                          // seconds 00-59
    if (m[8] && m[8] !== 'Z') { const d = m[8].replace(':', ''); if (+d.slice(1, 3) > 14 || +d.slice(3, 5) >= 60) return false; }   // offset within ±14:59
    return true;
  }
  function isDateOrDateTime(s) { return isDate(s) || isDateTime(s); }
  /** 'YYYY-MM-DD' part of a date or datetime string (no tz conversion: the business date as written). */
  function dayOf(s) { return String(s).slice(0, 10); }
  function toUTC(s) { const m = D_RE.exec(dayOf(s)); return Date.UTC(+m[1], +m[2] - 1, +m[3]); }
  function fromUTC(ms) { const d = new Date(ms); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0'); }
  function addDays(s, n) { return fromUTC(toUTC(s) + n * 86400000); }
  function diffDays(a, b) { return Math.round((toUTC(b) - toUTC(a)) / 86400000); } // b - a
  function monthKey(s) { return dayOf(s).slice(0, 7); }
  function addMonths(key, n) { const y = +key.slice(0, 4), m = +key.slice(5, 7) - 1 + n; const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12; return yy + '-' + String(mm + 1).padStart(2, '0'); }
  /** The n fully completed calendar months before asOf's month, oldest first. */
  function prevMonths(asOf, n) { const cur = monthKey(asOf); const out = []; for (let i = n; i >= 1; i--) out.push(addMonths(cur, -i)); return out; }
  function isMonthKey(s) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s)); }
  function cmp(a, b) { return dayOf(a) < dayOf(b) ? -1 : dayOf(a) > dayOf(b) ? 1 : 0; }
  return { isDate, isDateTime, isDateOrDateTime, dayOf, addDays, diffDays, monthKey, addMonths, prevMonths, isMonthKey, cmp };
});
