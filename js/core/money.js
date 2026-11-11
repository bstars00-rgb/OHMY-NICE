/* Money helpers — integer minor units only (no floats in balances). Currencies are never mixed implicitly. */
(function (root, factory) {
  const NS = root.OMH || (root.OMH = {});
  const api = factory();
  NS.Money = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';
  const CURRENCIES = { KRW: { decimals: 0 }, JPY: { decimals: 0 }, VND: { decimals: 0 }, USD: { decimals: 2 }, SGD: { decimals: 2 } };
  const isSupported = c => Object.prototype.hasOwnProperty.call(CURRENCIES, c);
  const decimals = c => CURRENCIES[c].decimals;
  /** Major-unit string/number -> integer minor units. Rejects NaN, thousands separators, excess precision. */
  function parseAmount(input, cur) {
    if (!isSupported(cur)) return { ok: false, error: 'E_CURRENCY_UNSUPPORTED' };
    const s = String(input == null ? '' : input).trim();
    if (!/^-?\d+(\.\d+)?$/.test(s)) return { ok: false, error: 'E_AMOUNT_INVALID' };
    const neg = s[0] === '-';
    const [ip, fp = ''] = s.replace('-', '').split('.');
    if (fp.length > decimals(cur)) return { ok: false, error: 'E_AMOUNT_PRECISION' };
    const minor = Number(ip) * Math.pow(10, decimals(cur)) + (fp ? Number(fp.padEnd(decimals(cur), '0')) : 0);
    if (!Number.isSafeInteger(minor)) return { ok: false, error: 'E_AMOUNT_INVALID' };
    return { ok: true, minor: neg ? -minor : minor };
  }
  function group(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  /** Deterministic formatter (no Intl dependence): 1,234,000 KRW / 1,234.50 USD. Currency code is always shown. */
  function format(minor, cur, opts) {
    if (minor == null || Number.isNaN(minor)) return '—';
    const d = isSupported(cur) ? decimals(cur) : 0; const neg = minor < 0; const a = Math.abs(minor);
    const ip = Math.floor(a / Math.pow(10, d)); const fp = d ? String(a % Math.pow(10, d)).padStart(d, '0') : '';
    const body = group(ip) + (d ? '.' + fp : '');
    return (neg ? '-' : '') + body + ((opts && opts.noCode) ? '' : ' ' + cur);
  }
  function assertSame(a, b) { if (a !== b) { const e = new Error('CURRENCY_MISMATCH ' + a + ' vs ' + b); e.code = 'E_CURRENCY_MISMATCH'; throw e; } }
  /** floor(minor * mult) with mult a decimal (<=2 dp) — exact via BigInt, never float rounding. */
  function mulFloor(minor, mult) { const s = Math.round(mult * 100); return Number((BigInt(minor) * BigInt(s)) / 100n); }
  /** floor(sum * mult / n) in one step (no double flooring). */
  function avgMul(sum, n, mult) { if (!n) return 0; const s = Math.round(mult * 100); return Number((BigInt(sum) * BigInt(s)) / (100n * BigInt(n))); }
  function ceilDiv(a, b) { return Number((BigInt(a) + BigInt(b) - 1n) / BigInt(b)); }
  /** Sum a list of {currency, minor} into {CUR: minor}. Never merges different currencies. */
  function sumByCurrency(items) { const o = {}; for (const it of items) { if (it.minor == null) continue; o[it.currency] = (o[it.currency] || 0) + it.minor; } return o; }
  function formatMap(map) { const k = Object.keys(map).sort(); return k.length ? k.map(c => format(map[c], c)).join(' · ') : '—'; }
  return { CURRENCIES, isSupported, decimals, parseAmount, format, assertSame, mulFloor, avgMul, ceilDiv, sumByCurrency, formatMap };
});
