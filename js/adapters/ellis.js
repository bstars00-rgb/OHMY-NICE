/* ELLIS MCP integration core (read-only).
   The browser app cannot call an MCP server (CSP connect-src 'none', no secrets in the client). Data therefore travels as a SNAPSHOT:

     MCP tool calls (Claude today / server-side MCP client later)  ->  buildFromCalls()  ->  snapshot JSON (aggregates only, no guest data)
       -> validateSnapshot() -> matchHotels() -> Store.importEllisSnapshot() -> compare() against the ledger

   Rules this module enforces (they come from the ELLIS tool contract, see 14_ELLIS_MCP_Integration.md):
   - get_hotel_bookings: window <= 30 days, page size <= 1000; a result that is not fully paged is TRUNCATED and is never totalled.
   - Money stays in the booking's own currency; currencies are never summed together.
   - Only aggregates are kept (hotel x month x currency). Guest names, booking codes and seller references are refused.
   - ELLIS never writes into the ledger. It feeds a comparison only.                                                              */
(function (root, factory) {
  const NS = root.OMH || (root.OMH = {});
  const api = factory(typeof require === 'function'
    ? { Money: require('../core/money.js'), Dates: require('../core/dates.js'), Forecast: require('../engine/forecast.js'), Adapters: require('./adapters.js') }
    : { Money: NS.Money, Dates: NS.Dates, Forecast: NS.Forecast, Adapters: NS.Adapters });
  NS.Ellis = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis, function (dep) {
  'use strict';
  const { Money, Dates, Forecast, Adapters } = dep;
  const SCHEMA = 'omh-ellis-snapshot', VERSION = 3, VERSIONS = [2, 3];   // v2 added the KRW equivalent per currency (booking-time rate snapshot); v3 adds the month basis (check-in or check-out) and the optional since-contract-start aggregate of a month. v2 files still validate.
  const BASES = ['CHECK_IN_DATE', 'CHECK_OUT_DATE'];                    // which stay date puts a booking into a month; one basis per snapshot
  const COLLECTORS = ['CLAUDE_MCP', 'SERVER_MCP_CLIENT', 'FIXTURE'];
  const MAX_PAGE = 1000, MAX_SPAN_DAYS = 30, MAX_PAGES = 200;
  const TOLERANCE_PCT = 30, STALE_DAYS = 7;                 // provisional comparison thresholds (not config-driven yet)
  const PII_KEYS = ['guestName', 'bookingItemCode', 'bookingCode', 'sellerBookingCode', 'cmsName', 'email', 'phone', 'passport'];

  /** What this integration uses from the ELLIS MCP server and what it must respect (documentation + test anchor). */
  const TOOL_CONTRACT = [
    { tool: 'get_hotel_bookings', use: 'per-hotel monthly billing/revenue/room-nights by check-in or check-out month (dateBasis), plus an optional since-date aggregate for the month a contract starts in (implemented)', limits: 'window <= 30 days; page <= 1000; finance-scoped fields may be null', status: 'IMPLEMENTED' },
    { tool: 'get_hotel_infos', use: 'hotelCode <-> legacyHotelCode mapping, hotel status (planned: master sync)', limits: 'hotel names are multilingual objects', status: 'PLANNED' },
    { tool: 'get_hotel_booking_stats', use: 'cross-check of country/seller totals (not per hotel)', limits: 'buckets are date x country x seller; no hotel dimension', status: 'PLANNED' },
    { tool: 'get_settlement', use: 'receivables per currency for a seller (planned: overdue signal)', limits: 'penaltyAmount is always null (not zero)', status: 'PLANNED' },
    { tool: 'get_hardblock_status', use: 'hard-blocked room-type x date coverage (planned: hard-block prepay sizing)', limits: 'window current month -3..+6; 92-day cap without hotelCode', status: 'PLANNED' },
  ];

  const isObj = x => x && typeof x === 'object' && !Array.isArray(x);
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const err = (code, msg) => { const e = new Error(code + (msg ? ': ' + msg : '')); e.code = code; return e; };

  /** ELLIS hotel code as a canonical digit string. Accepts 453378, "453378", "ELLIS-453378". */
  function hotelKey(v) {
    if (typeof v === 'number') return Number.isSafeInteger(v) && v > 0 && v < 1e12 ? String(v) : null;
    if (typeof v !== 'string') return null;
    const s = v.trim().replace(/^ELLIS-/i, '');
    return /^[1-9]\d{0,11}$/.test(s) ? s : null;
  }
  /** decimal amount from the API -> integer minor units; null when it cannot be represented exactly in that currency. */
  function toMinor(a, ccy) {
    if (typeof a !== 'number' || !isFinite(a) || !Money.isSupported(ccy)) return null;
    const x = a * Math.pow(10, Money.decimals(ccy)), r = Math.round(x);
    if (Math.abs(x - r) > 1e-6 * Math.max(1, Math.abs(x)) + 1e-6) return null;
    return Number.isSafeInteger(r) ? r : null;
  }
  const monthEnd = m => Dates.addDays(Dates.addMonths(m, 1) + '-01', -1);
  /** Calendar-month windows covering [from, to], clipped to it. Every window is <= 30 days after its start, as the tool requires. */
  function monthWindows(from, to) {
    const out = []; let m = Dates.monthKey(from);
    while (m <= Dates.monthKey(to) && out.length < 600) { const a = Dates.cmp(m + '-01', from) < 0 ? from : m + '-01', e = monthEnd(m), b = Dates.cmp(e, to) > 0 ? to : e; out.push({ from: a, to: b }); m = Dates.addMonths(m, 1); }
    return out;
  }

  /* ---------------- aggregation of raw booking rows ---------------- */
  function newAgg(basis, partialFrom) { return { basis, partialFrom: partialFrom || {}, hotels: {}, seen: new Set(), stats: { rows: 0, duplicates: 0, rejected: {} } }; }
  function rej(agg, reason) { agg.stats.rejected[reason] = (agg.stats.rejected[reason] || 0) + 1; }
  /** Adds one booking to a bucket { skipped, cur }. Returns the reject reason, or null when the row was counted (a cancelled stay is counted as cancelled, not rejected). */
  function addInto(t, row) {
    const ccy = row.currency;
    if (!Money.isSupported(ccy)) { t.skipped++; return 'CURRENCY_UNSUPPORTED'; }
    const a = t.cur[ccy] || (t.cur[ccy] = { bookings: 0, roomNights: 0, billingMinor: 0, revenueMinor: 0, revenueUnknown: false, cancelled: 0, krwB: 0, krwR: 0 });
    const cancelled = (row.cancelDate != null && row.cancelDate !== '') || /^\s*cancel(l?ed)?\b/i.test(String(row.bookingStatus || ''));
    if (cancelled) { a.cancelled++; return null; }                                  // cancel charges are not exposed per row; cancelled stays are not consumption
    const b = toMinor(row.billing, ccy); const rn = row.roomNights;
    if (b != null && b < 0) { t.skipped++; return 'AMOUNT_NEGATIVE'; }             // refunds / adjustments are not bookings; the month is flagged incomplete instead of netting silently
    if (b == null || !Number.isSafeInteger(rn) || rn < 0) { t.skipped++; return row.billing == null ? 'BILLING_RESTRICTED' : 'AMOUNT_UNUSABLE'; }
    const fx = ccy === 'KRW' ? 1 : row.fxRate; if (typeof fx !== 'number' || !isFinite(fx) || fx <= 0) { t.skipped++; return 'FX_MISSING'; }   // the booking-time rate to KRW is what lets other currencies be converted later
    const unit = Math.pow(10, Money.decimals(ccy));
    a.bookings++; a.roomNights += rn; a.billingMinor += b; a.krwB += b / unit * fx;
    const r = row.revenue == null ? null : toMinor(row.revenue, ccy); if (r == null) a.revenueUnknown = true; else { a.revenueMinor += r; a.krwR += r / unit * fx; }
    return null;
  }
  function addRow(agg, row, win, hotelFilter) {
    agg.stats.rows++;
    if (!isObj(row)) return rej(agg, 'ROW_NOT_OBJECT');
    const hk = hotelKey(row.hotelCode); if (!hk) return rej(agg, 'NO_HOTEL');
    if (hotelFilter && hk !== hotelFilter) return rej(agg, 'HOTEL_FILTER_MISMATCH');
    const out = agg.basis === 'CHECK_OUT_DATE', raw = out ? row.checkOutDate : row.checkInDate;
    const day = typeof raw === 'string' ? Dates.dayOf(raw) : ''; if (!Dates.isDate(day)) return rej(agg, out ? 'NO_CHECKOUT' : 'NO_CHECKIN');
    if (Dates.cmp(day, win.from) < 0 || Dates.cmp(day, win.to) > 0) return rej(agg, 'OUT_OF_WINDOW');
    const code = typeof row.bookingItemCode === 'string' ? row.bookingItemCode : null;
    if (!code) return rej(agg, 'NO_ROW_ID');                                       // without an id duplicates across pages cannot be detected
    if (agg.seen.has(code)) { agg.stats.duplicates++; return; }
    agg.seen.add(code);
    const h = agg.hotels[hk] || (agg.hotels[hk] = { legacy: null, country: null, months: {} });
    const lg = row.legacyHotelCode == null ? null : String(row.legacyHotelCode); if (lg && !h.legacy) h.legacy = lg;
    const mk = Dates.monthKey(day), cut = agg.partialFrom[hk];
    const mo = h.months[mk] || (h.months[mk] = { skipped: 0, cur: {}, partial: cut && Dates.monthKey(cut) === mk && Dates.cmp(cut, mk + '-01') > 0 ? { from: cut, skipped: 0, cur: {} } : null });   // a since-date aggregate only for the month that contains the hotel's cut-off date
    const reason = addInto(mo, row);
    if (mo.partial && Dates.cmp(day, mo.partial.from) >= 0) addInto(mo.partial, row);
    if (reason) rej(agg, reason);
  }

  /** Merge day intervals per hotel and return the months fully inside the merged coverage. */
  function coveredMonths(intervals) {
    const iv = intervals.slice().sort((x, y) => Dates.cmp(x.from, y.from)); const merged = [];
    for (const i of iv) { const last = merged[merged.length - 1]; if (last && Dates.cmp(i.from, Dates.addDays(last.to, 1)) <= 0) { if (Dates.cmp(i.to, last.to) > 0) last.to = i.to; } else merged.push({ from: i.from, to: i.to }); }
    const out = [];
    for (const m of merged) for (let k = Dates.monthKey(m.from); k <= Dates.monthKey(m.to); k = Dates.addMonths(k, 1)) if (Dates.cmp(k + '-01', m.from) >= 0 && Dates.cmp(monthEnd(k), m.to) <= 0) out.push(k);
    return out;
  }

  /** Content hash of a snapshot (everything except the hash field). */
  const canon = x => (Array.isArray(x) ? x.map(canon) : isObj(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canon(x[k])])) : x);   // key order must not change the fingerprint
  function hashOf(snap) { const { hash, ...rest } = snap; return Adapters.hash53(JSON.stringify(canon(rest))); }
  const MONTH_ATTRIBUTED = ['CURRENCY_UNSUPPORTED', 'BILLING_RESTRICTED', 'AMOUNT_UNUSABLE', 'AMOUNT_NEGATIVE', 'FX_MISSING'];   // these rows are counted in the month's skippedRows; every other rejection leaves the group's coverage unknown
  const REJECT_REASONS = ['ROW_NOT_OBJECT', 'NO_HOTEL', 'HOTEL_FILTER_MISMATCH', 'NO_CHECKIN', 'NO_CHECKOUT', 'OUT_OF_WINDOW', 'NO_ROW_ID', ...MONTH_ATTRIBUTED];

  /**
   * calls: [{ tool:'get_hotel_bookings', args:{dateBasis,fromDate,toDate,hotelCode?,countryCode?,limit,offset}, response:{list,totalCount,limit,offset,warnings?} | null, error? }]
   * meta : { collector, collectedBy, collectedAt, synthetic, partialFrom? }   partialFrom = { hotelCode: 'YYYY-MM-DD' }: for that hotel the month containing the date also gets the aggregate of its days from that date on (a contract that starts mid-month)
   * All calls of one snapshot use the same dateBasis (CHECK_IN_DATE or CHECK_OUT_DATE): it decides which month a booking belongs to.
   * Never totals a result that is not completely paged: such a group marks the whole snapshot truncated (validateSnapshot then refuses it).
   */
  function buildFromCalls(calls, meta) {
    meta = meta || {};
    if (!Array.isArray(calls) || !calls.length) throw err('E_ELLIS_NO_CALLS');
    const groups = new Map(); const warnings = new Set(); let truncated = false; const bases = new Set();
    const partialFrom = {}; for (const [k, d] of Object.entries(meta.partialFrom || {})) { const hk = hotelKey(k); if (!hk || !Dates.isDate(d)) throw err('E_ELLIS_PARTIAL', String(k)); partialFrom[hk] = d; }
    for (const c of calls) {
      if (!isObj(c) || c.tool !== 'get_hotel_bookings' || !isObj(c.args)) throw err('E_ELLIS_CALL_SHAPE', 'only get_hotel_bookings calls are supported');
      const a = c.args;
      if (!BASES.includes(a.dateBasis)) throw err('E_ELLIS_BASIS', 'consumption comparison requires CHECK_IN_DATE or CHECK_OUT_DATE'); bases.add(a.dateBasis);
      if (!Dates.isDate(a.fromDate) || !Dates.isDate(a.toDate) || Dates.cmp(a.fromDate, a.toDate) > 0) throw err('E_ELLIS_WINDOW');
      if (Dates.diffDays(a.fromDate, a.toDate) > MAX_SPAN_DAYS) throw err('E_ELLIS_WINDOW_TOO_LONG', a.fromDate + '..' + a.toDate);
      const hk = a.hotelCode == null ? null : hotelKey(a.hotelCode); if (a.hotelCode != null && !hk) throw err('E_ELLIS_HOTEL_CODE');
      const key = JSON.stringify([a.fromDate, a.toDate, hk, a.countryCode || null]);
      (groups.get(key) || groups.set(key, { from: a.fromDate, to: a.toDate, hotel: hk, country: a.countryCode || null, calls: [] }).get(key)).calls.push(c);
    }
    if (bases.size > 1) throw err('E_ELLIS_BASIS_MIXED', 'one snapshot, one date basis');
    const basis = [...bases][0]; const agg = newAgg(basis, partialFrom); const tools = []; const intervals = {}; const requested = new Set();
    for (const g of groups.values()) {
      g.calls.sort((x, y) => (x.args.offset || 0) - (y.args.offset || 0));
      let expect = 0, total = null, rows = 0, bad = false; const before = Object.entries(agg.stats.rejected).filter(([k]) => !MONTH_ATTRIBUTED.includes(k)).reduce((n, [, v]) => n + v, 0);
      for (const c of g.calls) {
        const r = c.response;
        if (c.error || !isObj(r) || !Array.isArray(r.list)) { bad = true; warnings.add('CALL_FAILED'); continue; }
        if ((c.args.offset || 0) !== expect) bad = true;                             // a gap or overlap in paging
        if (total != null && r.totalCount !== total) bad = true;                     // data moved between pages
        total = total == null ? r.totalCount : total; expect = (c.args.offset || 0) + r.list.length; rows += r.list.length;
        const wr = JSON.stringify(r.warnings || r.warning || ''); if (/TRUNC/i.test(wr)) { bad = true; warnings.add('ROWS_TRUNCATED'); }
        for (const row of r.list) addRow(agg, row, g, g.hotel);
      }
      if (!Number.isSafeInteger(total) || expect < total) bad = true;
      if (bad) { truncated = true; warnings.add('INCOMPLETE_PAGING'); }
      const dirty = Object.entries(agg.stats.rejected).filter(([k]) => !MONTH_ATTRIBUTED.includes(k)).reduce((n, [, v]) => n + v, 0) > before;   // a row was dropped before its month was known
      if (dirty) warnings.add('ROWS_REJECTED');
      tools.push({ tool: 'get_hotel_bookings', dateBasis: basis, fromDate: g.from, toDate: g.to, hotelCode: g.hotel, countryCode: g.country, pages: g.calls.length, rows, totalCount: total, complete: !bad });
      if (g.hotel) { requested.add(g.hotel); if (!bad && !dirty) (intervals[g.hotel] || (intervals[g.hotel] = [])).push({ from: g.from, to: g.to }); }   // such a window is not "covered": its months stay unknown
    }
    const froms = [...groups.values()].map(g => g.from).sort(), tos = [...groups.values()].map(g => g.to).sort();
    const hotelKeys = [...new Set([...Object.keys(agg.hotels), ...requested])].sort((a, b) => Number(a) - Number(b));
    const hotels = hotelKeys.map(hk => {
      const h = agg.hotels[hk] || { legacy: null, months: {} };
      const curList = cur => Object.keys(cur).sort().map(c => { const a = cur[c]; return { currency: c, bookings: a.bookings, roomNights: a.roomNights, billingMinor: a.billingMinor, revenueMinor: a.revenueUnknown ? null : a.revenueMinor, cancelledBookings: a.cancelled, krwBillingMinor: Math.round(a.krwB), krwRevenueMinor: a.revenueUnknown ? null : Math.round(a.krwR) }; });
      const months = Object.keys(h.months).sort().map(m => { const x = h.months[m]; const o = { month: m, skippedRows: x.skipped, byCurrency: curList(x.cur) }; if (x.partial) o.partial = { from: x.partial.from, skippedRows: x.partial.skipped, byCurrency: curList(x.partial.cur) }; return o; });
      return { hotelCode: hk, legacyHotelCode: h.legacy, coveredMonths: coveredMonths(intervals[hk] || []), months };
    });
    const snap = { schema: SCHEMA, version: VERSION,
      provenance: { source: 'ELLIS_MCP', collector: meta.collector || 'CLAUDE_MCP', collectedBy: meta.collectedBy || '', collectedAt: meta.collectedAt || new Date().toISOString(), synthetic: !!meta.synthetic,
        tools, rowStats: { rows: agg.stats.rows, duplicates: agg.stats.duplicates, rejected: agg.stats.rejected }, truncated, warnings: [...warnings].sort() },
      window: { basis, from: froms[0], to: tos[tos.length - 1] }, hotels };
    snap.hash = hashOf(snap);
    return snap;
  }

  /**
   * Pull bookings through any source implementing getBookings(args) -> response (an MCP client, or a fixture).
   * One request chain per hotel and calendar-month window, paged to completion. Returns { snapshot, calls }.
   */
  async function collect(o) {
    const { source, hotelCodes, from, to } = o; const pageSize = Math.min(o.pageSize || MAX_PAGE, MAX_PAGE);
    if (!source || typeof source.getBookings !== 'function') throw err('E_ELLIS_SOURCE');
    const codes = (hotelCodes || []).map(hotelKey); if (!codes.length || codes.some(c => !c)) throw err('E_ELLIS_HOTEL_CODE');
    if (!Dates.isDate(from) || !Dates.isDate(to) || Dates.cmp(from, to) > 0) throw err('E_ELLIS_WINDOW');
    const dateBasis = o.dateBasis == null ? 'CHECK_IN_DATE' : o.dateBasis; if (!BASES.includes(dateBasis)) throw err('E_ELLIS_BASIS', String(o.dateBasis));
    const calls = [];
    for (const hk of [...new Set(codes)]) for (const w of monthWindows(from, to)) {
      let offset = 0, total = Infinity, pages = 0;
      while (offset < total && pages < (o.maxPages || MAX_PAGES)) {
        const args = { dateBasis, fromDate: w.from, toDate: w.to, hotelCode: Number(hk), limit: pageSize, offset }; let response = null, error = null;
        try { response = await source.getBookings(args); } catch (e) { error = String(e && e.message || e); }
        calls.push({ tool: 'get_hotel_bookings', args, response, error }); pages++;
        if (error || !response || !Array.isArray(response.list) || !response.list.length) break;
        total = response.totalCount; offset += response.list.length;
      }
    }
    return { snapshot: buildFromCalls(calls, { collector: o.collector || 'SERVER_MCP_CLIENT', collectedBy: o.collectedBy, collectedAt: o.collectedAt, synthetic: o.synthetic, partialFrom: o.partialFrom }), calls };
  }

  /* ---------------- validation ---------------- */
  function scanPii(x, path, errors) {
    if (Array.isArray(x)) x.forEach((v, i) => scanPii(v, path + '[' + i + ']', errors));
    else if (isObj(x)) for (const k of Object.keys(x)) { if (PII_KEYS.includes(k)) errors.push('E_ELLIS_PII_FIELD:' + path + k); scanPii(x[k], path + k + '.', errors); }
  }
  const nn = v => Number.isSafeInteger(v) && v >= 0;
  /** Only the fields of the schema may exist: an unknown key (any spelling of a guest or booking reference, or __proto__) is refused instead of stored. */
  function only(o, keys, path, errors) { for (const k of Object.keys(o)) if (!keys.includes(k)) errors.push('E_ELLIS_UNKNOWN_FIELD:' + path + k); }
  /** Strict structural check. Returns { ok, errors[], warnings[] }; never throws. */
  function validateSnapshot(s, opts) {
    opts = opts || {}; const errors = [], warnings = [];
    try {
      if (!isObj(s)) return { ok: false, errors: ['E_ELLIS_NOT_OBJECT'], warnings };
      only(s, ['schema', 'version', 'provenance', 'window', 'hotels', 'hash'], '', errors);
      if (s.schema !== SCHEMA) errors.push('E_ELLIS_SCHEMA'); if (!VERSIONS.includes(s.version)) errors.push('E_ELLIS_VERSION');
      const v3 = s.version === 3;                                                  // v2 files stay valid but cannot carry the v3 fields
      scanPii(s, '', errors);
      const p = s.provenance; const w = s.window;
      if (!isObj(p)) errors.push('E_ELLIS_PROVENANCE');
      else {
        only(p, ['source', 'collector', 'collectedBy', 'collectedAt', 'synthetic', 'tools', 'rowStats', 'truncated', 'warnings', 'restrictedFrom'], 'provenance.', errors);
        if (p.source !== 'ELLIS_MCP') errors.push('E_ELLIS_SOURCE'); if (!COLLECTORS.includes(p.collector)) errors.push('E_ELLIS_COLLECTOR');
        if (typeof p.collectedAt !== 'string' || !Dates.isDateTime(p.collectedAt) || !/(Z|[+-]\d{2}:?\d{2})$/.test(p.collectedAt) || !Number.isFinite(Date.parse(p.collectedAt))) errors.push('E_ELLIS_COLLECTED_AT');   // a time zone is mandatory so snapshots order the same everywhere
        else if (opts.now && Dates.cmp(p.collectedAt, Dates.addDays(opts.now, 1)) > 0) errors.push('E_ELLIS_FUTURE');
        if (typeof p.synthetic !== 'boolean') errors.push('E_ELLIS_SYNTHETIC_FLAG');
        if (typeof p.collectedBy !== 'string' || p.collectedBy.length > 80 || (p.collector !== 'FIXTURE' && !p.collectedBy.trim())) errors.push('E_ELLIS_COLLECTED_BY');
        if (p.restrictedFrom !== undefined && !(typeof p.restrictedFrom === 'string' && /^[0-9a-f]{14}$/.test(p.restrictedFrom))) errors.push('E_ELLIS_PROVENANCE');
        if (p.truncated !== false) errors.push('E_ELLIS_TRUNCATED');              // an incomplete pull must never be totalled
        if (!Array.isArray(p.tools) || !p.tools.length || p.tools.some(t => !isObj(t) || t.complete !== true)) errors.push('E_ELLIS_TRUNCATED');
        else for (const t of p.tools) {
          only(t, v3 ? ['tool', 'dateBasis', 'fromDate', 'toDate', 'hotelCode', 'countryCode', 'pages', 'rows', 'totalCount', 'complete'] : ['tool', 'fromDate', 'toDate', 'hotelCode', 'countryCode', 'pages', 'rows', 'totalCount', 'complete'], 'provenance.tools.', errors);
          if (v3 && (!isObj(w) || t.dateBasis !== w.basis)) errors.push('E_ELLIS_BASIS');   // every pull must have used the basis the snapshot claims
          if (t.tool !== 'get_hotel_bookings' || !Dates.isDate(t.fromDate) || !Dates.isDate(t.toDate) || Dates.cmp(t.fromDate, t.toDate) > 0 || !(t.hotelCode === null || hotelKey(t.hotelCode) === t.hotelCode) || !(t.countryCode === null || /^[A-Z]{2}$/.test(t.countryCode)) || !nn(t.pages) || !nn(t.rows) || !nn(t.totalCount)) errors.push('E_ELLIS_TOOLS');
        }
        if (!Array.isArray(p.warnings) || p.warnings.some(x => typeof x !== 'string' || !/^[A-Z_]{1,40}$/.test(x))) errors.push('E_ELLIS_PROVENANCE'); else if (p.warnings.length) warnings.push(...p.warnings.map(x => 'W_ELLIS_' + x));
        if (!isObj(p.rowStats)) errors.push('E_ELLIS_PROVENANCE');
        else {
          only(p.rowStats, ['rows', 'duplicates', 'rejected'], 'provenance.rowStats.', errors);
          if (!nn(p.rowStats.rows) || !nn(p.rowStats.duplicates) || !isObj(p.rowStats.rejected) || Object.keys(p.rowStats.rejected).some(k => !REJECT_REASONS.includes(k) || !nn(p.rowStats.rejected[k]))) errors.push('E_ELLIS_PROVENANCE');
          else if (Object.keys(p.rowStats.rejected).length) warnings.push('W_ELLIS_ROWS_REJECTED');
        }
        if (p.synthetic === true) warnings.push('W_ELLIS_SYNTHETIC');
      }
      if (!isObj(w) || !(v3 ? BASES.includes(w.basis) : w.basis === 'CHECK_IN_DATE') || !Dates.isDate(w.from) || !Dates.isDate(w.to) || Dates.cmp(w.from, w.to) > 0) errors.push('E_ELLIS_WINDOW'); else only(w, ['basis', 'from', 'to'], 'window.', errors);
      if (!Array.isArray(s.hotels)) errors.push('E_ELLIS_HOTELS');
      else {
        const seen = new Set();
        for (const h of s.hotels) {
          if (!isObj(h) || !hotelKey(h.hotelCode) || hotelKey(h.hotelCode) !== h.hotelCode) { errors.push('E_ELLIS_HOTEL_CODE'); continue; }
          only(h, ['hotelCode', 'legacyHotelCode', 'coveredMonths', 'months'], 'hotels.', errors);
          if (!(h.legacyHotelCode === null || (typeof h.legacyHotelCode === 'string' && /^[A-Za-z0-9_-]{1,20}$/.test(h.legacyHotelCode)))) errors.push('E_ELLIS_HOTEL_CODE');
          if (seen.has(h.hotelCode)) errors.push('E_ELLIS_HOTEL_DUPLICATE:' + h.hotelCode); seen.add(h.hotelCode);
          if (!Array.isArray(h.coveredMonths) || !h.coveredMonths.every(Dates.isMonthKey)) errors.push('E_ELLIS_COVERED:' + h.hotelCode);
          else if (isObj(p) && Array.isArray(p.tools) && isObj(w) && Dates.isDate(w.from) && Dates.isDate(w.to)) {      // a month may only be called "covered" if complete hotel-level pulls inside the window prove it
            const proven = new Set(coveredMonths(p.tools.filter(t => isObj(t) && t.complete === true && t.hotelCode === h.hotelCode && Dates.isDate(t.fromDate) && Dates.isDate(t.toDate) && Dates.cmp(t.fromDate, w.from) >= 0 && Dates.cmp(t.toDate, w.to) <= 0).map(t => ({ from: t.fromDate, to: t.toDate }))));
            if (h.coveredMonths.some(m => !proven.has(m)) || new Set(h.coveredMonths).size !== h.coveredMonths.length) errors.push('E_ELLIS_COVERED:' + h.hotelCode);
          }
          if (!Array.isArray(h.months)) { errors.push('E_ELLIS_MONTHS:' + h.hotelCode); continue; }
          const checkCur = (list, mon) => {                                          // currency entries of a month (or of its since-date aggregate)
            const cs = new Set();
            for (const c of list) {
              if (!isObj(c) || !Money.isSupported(c.currency) || cs.has(c.currency)) { errors.push('E_ELLIS_CURRENCY:' + h.hotelCode + ':' + mon); continue; }
              only(c, ['currency', 'bookings', 'roomNights', 'billingMinor', 'revenueMinor', 'cancelledBookings', 'krwBillingMinor', 'krwRevenueMinor'], 'byCurrency.', errors);
              cs.add(c.currency);
              if (!nn(c.bookings) || !nn(c.roomNights) || !nn(c.billingMinor) || !nn(c.cancelledBookings) || !(c.revenueMinor === null || Number.isSafeInteger(c.revenueMinor)) || !nn(c.krwBillingMinor) || !(c.krwRevenueMinor === null || Number.isSafeInteger(c.krwRevenueMinor)) || (c.revenueMinor === null) !== (c.krwRevenueMinor === null)) errors.push('E_ELLIS_AMOUNT:' + h.hotelCode + ':' + mon + ':' + c.currency);
              else {
                const d = Money.decimals(c.currency), f = Math.pow(10, d);
                const rateOk = (krw, minor) => { const rate = krw / (minor / f); return rate >= 0.001 && rate <= 100000; };                  // KRW per one major unit must be plausible
                const tiny = minor => d === 0 && Math.abs(minor) < 100;                                                                        // a few dong or yen can round to 0 KRW
                const side = (krw, minor) => (minor === 0 ? krw === 0 : Math.sign(krw) === Math.sign(minor) ? rateOk(krw, minor) : krw === 0 && tiny(minor));   // the KRW figure follows the original one in sign and size
                const fxBad = c.currency === 'KRW' ? (c.krwBillingMinor !== c.billingMinor || c.krwRevenueMinor !== c.revenueMinor)
                  : !side(c.krwBillingMinor, c.billingMinor) || (c.revenueMinor !== null && !side(c.krwRevenueMinor, c.revenueMinor));
                if (fxBad) errors.push('E_ELLIS_FX:' + h.hotelCode + ':' + mon + ':' + c.currency);
              }
            }
          };
          const ms = new Set();
          for (const m of h.months) {
            if (!isObj(m) || !Dates.isMonthKey(m.month) || ms.has(m.month) || !nn(m.skippedRows) || !Array.isArray(m.byCurrency)) { errors.push('E_ELLIS_MONTH:' + h.hotelCode); continue; }
            only(m, v3 ? ['month', 'skippedRows', 'byCurrency', 'partial'] : ['month', 'skippedRows', 'byCurrency'], 'months.', errors);
            ms.add(m.month);
            if (isObj(w) && Dates.isDate(w.from) && Dates.isDate(w.to) && (m.month < Dates.monthKey(w.from) || m.month > Dates.monthKey(w.to))) errors.push('E_ELLIS_MONTH_OUTSIDE_WINDOW:' + h.hotelCode + ':' + m.month);
            checkCur(m.byCurrency, m.month);
            if (m.partial !== undefined) {                                           // since-date aggregate of this month (v3): a subset of the month, so it can never exceed it
              const q = m.partial;
              if (!v3 || !isObj(q) || !Dates.isDate(q.from) || Dates.monthKey(q.from) !== m.month || Dates.cmp(q.from, m.month + '-01') <= 0 || !nn(q.skippedRows) || q.skippedRows > m.skippedRows || !Array.isArray(q.byCurrency)) errors.push('E_ELLIS_PARTIAL:' + h.hotelCode + ':' + m.month);
              else {
                only(q, ['from', 'skippedRows', 'byCurrency'], 'partial.', errors); checkCur(q.byCurrency, m.month);
                for (const c of q.byCurrency) { const w0 = isObj(c) ? m.byCurrency.find(x => isObj(x) && x.currency === c.currency) : null; if (!w0 || !(c.bookings <= w0.bookings && c.roomNights <= w0.roomNights && c.billingMinor <= w0.billingMinor && c.cancelledBookings <= w0.cancelledBookings && c.krwBillingMinor <= w0.krwBillingMinor)) errors.push('E_ELLIS_PARTIAL:' + h.hotelCode + ':' + m.month); }
              }
            }
          }
        }
      }
      if (typeof s.hash !== 'string' || s.hash !== hashOf(s)) errors.push('E_ELLIS_HASH');
    } catch (e) { errors.push('E_ELLIS_MALFORMED'); }
    return { ok: errors.length === 0, errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
  }

  /* ---------------- mapping & comparison ---------------- */
  /** Link snapshot hotels to the hotel master by hotelCode (ellisHotelId). legacyHotelCode is used only when it is unambiguous. */
  function matchHotels(snap, hotels) {
    const byKey = new Map(), conflicts = [];
    for (const h of hotels || []) { const k = hotelKey(h.ellisHotelId); if (!k) continue; if (byKey.has(k)) conflicts.push(k); else byKey.set(k, h.hotelId); }
    const matched = [], unmatched = [];
    for (const sh of snap.hotels) { if (byKey.has(sh.hotelCode) && !conflicts.includes(sh.hotelCode)) matched.push({ hotelCode: sh.hotelCode, hotelId: byKey.get(sh.hotelCode) }); else unmatched.push(sh.hotelCode); }
    const hit = new Set(matched.map(m => m.hotelId));
    const unmapped = (hotels || []).filter(h => !hit.has(h.hotelId)).map(h => ({ hotelId: h.hotelId, ellisHotelId: h.ellisHotelId || null, reason: !hotelKey(h.ellisHotelId) ? 'NO_ELLIS_ID' : conflicts.includes(hotelKey(h.ellisHotelId)) ? 'DUPLICATE_ELLIS_ID' : 'NOT_IN_SNAPSHOT' }));
    return { matched, unmatched, unmapped, conflicts };
  }
  /** Keep only the hotels that exist in our master (data minimisation) and re-hash. */
  function restrictToMaster(snap, hotels) {
    const m = matchHotels(snap, hotels); const keep = new Set(m.matched.map(x => x.hotelCode));
    const out = JSON.parse(JSON.stringify(snap)); out.hotels = out.hotels.filter(h => keep.has(h.hotelCode));
    out.provenance.tools = out.provenance.tools.filter(t => t.hotelCode !== null && keep.has(t.hotelCode));            // pulls for other hotels (codes, counts) are not kept either
    out.provenance.rowStats = { rows: out.provenance.tools.reduce((n, t) => n + t.rows, 0), duplicates: 0, rejected: {} }; out.provenance.restrictedFrom = snap.hash;
    out.hash = hashOf(out); return { snapshot: out, match: m };
  }

  /** KRW per 1 major unit of a currency, from one snapshot entry (null when it has no billing to derive it from). */
  const rateOf = (e, ccy) => (ccy === 'KRW' ? 1 : e && e.billingMinor > 0 ? e.krwBillingMinor / (e.billingMinor / Math.pow(10, Money.decimals(ccy))) : null);
  /** The month's amounts of one hotel expressed in the contract currency. Same-currency rows are exact; other currencies go through the KRW rate of the booking-time snapshot. */
  function inContractCurrency(m, ccy, meanRate, convert) {
    const f = Math.pow(10, Money.decimals(ccy)); const own = m.byCurrency.find(x => x.currency === ccy);
    const R = rateOf(own, ccy) || meanRate(m.month, ccy); let bill = 0, net = 0, netKnown = true, conv = 0, unavailable = false;
    for (const e of m.byCurrency) {
      if (e.currency === ccy) { bill += e.billingMinor; if (e.revenueMinor == null) netKnown = false; else net += e.billingMinor - e.revenueMinor; continue; }
      if (!convert) continue;                                                       // several contracts at this hotel: another currency belongs to another contract
      if (!R) { if (e.billingMinor > 0) unavailable = true; continue; }
      const cb = Math.round(e.krwBillingMinor / R * f); bill += cb; conv += cb;
      if (e.krwRevenueMinor == null) netKnown = false; else net += Math.round((e.krwBillingMinor - e.krwRevenueMinor) / R * f);
    }
    return { billing: unavailable ? null : bill, net: unavailable || !netKnown ? null : net, convertedPct: bill > 0 ? Math.round(conv / bill * 1000) / 10 : 0, unavailable };
  }

  /**
   * Per contract: last N completed months of CONFIRMED ledger consumption vs ELLIS check-in-basis amounts in the contract currency.
   * - basis 'NET' (default) = billing minus revenue, the hotel-side amount. A reconciliation against 5-8 sample hotels agreed with the PIC tracker on this basis;
   *   'BILLING' is the gross booking amount. Both stay indicators until ELLIS confirms which one is deducted (OQ-ELLIS-1).
   * - months outside the contract period are not compared. A month that contains the contract END cannot be split. A month that contains the contract START is compared only when the snapshot carries the since-start aggregate for exactly that date (month.partial, collected with partialFrom); otherwise it stays CONTRACT_STARTS_IN_MONTH.
   * - the month of a booking follows the snapshot's date basis (window.basis, check-in or check-out): compare it with a ledger kept on the same basis.
   * - bookings in other currencies are converted with the booking-time rate to KRW and then to the contract currency (flagged converted / convertedPct).
   * - scope 'HOTEL' (opts.scope): the tracker's definition (all bookings of the hotel, any contract, no clipping to the contract period); default 'CONTRACT' is for the actual deduction.
   * opts: { basis:'NET'|'BILLING', scope:'CONTRACT'|'HOTEL', tolerancePct, staleDays }
   */
  /** |e/s - 1| * 100 <= tol, by exact integer arithmetic (the ratio shown in the table is rounded, the verdict is not). */
  function withinTolerance(e, s, tolPct) { const tol = BigInt(Math.round(tolPct * 1e6)), E = BigInt(e), S = BigInt(s); const d = E > S ? E - S : S - E, abs = S < 0n ? -S : S; return d * 100000000n <= tol * abs; }
  /** KRW per one unit of a currency in a month, weighted over every hotel of the snapshot (null when nothing in the snapshot can give it). */
  function rateFinder(snap) {
    const means = new Map();
    return (month, ccy) => {
      if (ccy === 'KRW') return 1; const key = month + '|' + ccy;
      if (!means.has(key) && snap) { let krw = 0, major = 0; for (const h of snap.hotels) for (const mo of h.months) if (mo.month === month) for (const e of mo.byCurrency) if (e.currency === ccy && e.billingMinor > 0) { krw += e.krwBillingMinor; major += e.billingMinor / Math.pow(10, Money.decimals(ccy)); } means.set(key, major > 0 ? krw / major : null); }
      return means.get(key) || null;
    };
  }
  function compare(state, opts) {
    opts = opts || {}; const tol = Number.isFinite(opts.tolerancePct) && opts.tolerancePct >= 0 ? opts.tolerancePct : TOLERANCE_PCT, basis = opts.basis === 'BILLING' ? 'BILLING' : 'NET', hotelScope = opts.scope === 'HOTEL';   // HOTEL = the PIC tracker's definition: every booking of the hotel, whatever the contract period or the number of contracts
    const snap = state.ellis && state.ellis.snapshot; const asOf = state.config.asOf, n = state.config.forecast.windowMonths;
    const hotelsById = Object.fromEntries(state.hotels.map(h => [h.hotelId, h]));
    const stale = snap ? Dates.diffDays(Dates.dayOf(snap.provenance.collectedAt), asOf) > (opts.staleDays == null ? STALE_DAYS : opts.staleDays) : false;
    const meanRate = rateFinder(snap);
    const byHotel = {}; for (const c of state.contracts) if (c.prepaymentType !== 'SECURITY_DEPOSIT') (byHotel[c.hotelId] || (byHotel[c.hotelId] = [])).push(c);   // contracts that share one ELLIS hotel
    const OUT = ['BEFORE_CONTRACT', 'AFTER_CONTRACT', 'CONTRACT_STARTS_IN_MONTH', 'CONTRACT_ENDS_IN_MONTH'];
    const byContract = {};
    for (const c of state.contracts) {
      const base = { contractId: c.contractId, currency: c.currency, basis, dateBasis: snap ? snap.window.basis : null, scope: hotelScope ? 'HOTEL' : 'CONTRACT', months: [], divergent: 0, stale };
      const hotel = hotelsById[c.hotelId]; const hk = hotel && hotelKey(hotel.ellisHotelId);
      if (c.prepaymentType === 'SECURITY_DEPOSIT') { byContract[c.contractId] = Object.assign(base, { status: 'NOT_APPLICABLE' }); continue; }
      if (!hk) { byContract[c.contractId] = Object.assign(base, { status: 'NOT_MAPPED' }); continue; }
      if (!snap) { byContract[c.contractId] = Object.assign(base, { status: 'NO_SNAPSHOT' }); continue; }
      const sh = snap.hotels.find(h => h.hotelCode === hk); if (!sh) { byContract[c.contractId] = Object.assign(base, { status: 'NOT_IN_SNAPSHOT' }); continue; }
      const sibs = (byHotel[c.hotelId] || []).filter(x => x.contractId !== c.contractId);
      const series = Forecast.consumptionSeries(state.ledger, c.contractId, asOf, n);
      const activeIn = (x, mf, me) => !(x.endDate && Dates.cmp(mf, x.endDate) > 0) && !(x.startDate && Dates.cmp(me, x.startDate) < 0);   // the sibling's period overlaps the month
      let anyCmp = false;
      for (const s of series) {
        const m = sh.months.find(x => x.month === s.month); const covered = sh.coveredMonths.includes(s.month);
        let usePartial = false; const row = { month: s.month, ledgerMinor: s.amountMinor, ellisBillingMinor: null, ellisNetMinor: null, ellisMinor: null, ellisBookings: null, sinceDate: null, otherCurrencies: [], converted: false, convertedPct: 0, ratioPct: null, status: null };
        const mf = s.month + '-01', me = monthEnd(s.month);
        if (hotelScope) { /* no clipping to the contract period */ } else if (c.startDate && Dates.cmp(me, c.startDate) < 0) row.status = 'BEFORE_CONTRACT';
        else if (c.endDate && Dates.cmp(mf, c.endDate) > 0) row.status = 'AFTER_CONTRACT';
        else if (c.startDate && Dates.cmp(mf, c.startDate) < 0) { if (m && m.partial && m.partial.from === c.startDate && !(c.endDate && Dates.cmp(me, c.endDate) > 0)) usePartial = true; else row.status = 'CONTRACT_STARTS_IN_MONTH'; }   // the contract starts mid-month: only a since-start aggregate for exactly that date can be compared
        else if (c.endDate && Dates.cmp(me, c.endDate) > 0) row.status = 'CONTRACT_ENDS_IN_MONTH';
        if (row.status) { base.months.push(row); continue; }
        const live = hotelScope ? [] : sibs.filter(x => activeIn(x, mf, me));                                                       // contracts that really share this ELLIS hotel in this month
        if (live.some(x => x.currency === c.currency)) { row.status = 'SHARED_HOTEL'; base.months.push(row); continue; }    // same currency, same hotel, same month: ELLIS cannot tell their bookings apart without a scope
        const convert = live.length === 0;                                                                        // another currency belongs to another contract while one is active
        if (!covered) { row.status = 'NOT_COVERED'; base.months.push(row); continue; }       // rows without full coverage describe part of a month only
        const src = usePartial ? { month: m.month, skippedRows: m.partial.skippedRows, byCurrency: m.partial.byCurrency } : m; row.sinceDate = usePartial ? m.partial.from : null;
        row.otherCurrencies = src ? src.byCurrency.filter(x => x.currency !== c.currency).map(x => x.currency) : [];
        if (src && src.byCurrency.length) {
          const x = inContractCurrency(src, c.currency, meanRate, convert);
          if (x.unavailable) { row.status = 'CURRENCY_MISMATCH'; base.months.push(row); continue; }
          row.ellisBillingMinor = x.billing; row.ellisNetMinor = x.net; row.ellisBookings = src.byCurrency.filter(e => convert || e.currency === c.currency).reduce((a, e) => a + e.bookings, 0); row.converted = x.convertedPct > 0; row.convertedPct = x.convertedPct;
        } else { row.ellisBillingMinor = 0; row.ellisNetMinor = 0; row.ellisBookings = 0; }    // fully covered month with no bookings = zero
        anyCmp = true;
        const e = basis === 'NET' ? row.ellisNetMinor : row.ellisBillingMinor; row.ellisMinor = e;
        if (src && src.skippedRows > 0) row.status = 'ELLIS_INCOMPLETE';
        else if (e == null) row.status = 'ELLIS_INCOMPLETE';
        else if (s.amountMinor == null) row.status = 'LEDGER_MISSING';
        else if (s.amountMinor === 0 && e === 0) { row.ratioPct = 100; row.status = 'MATCH'; }
        else if (s.amountMinor === 0) row.status = 'DIVERGENT';
        else { row.ratioPct = Math.round(e / s.amountMinor * 1000) / 10; row.status = withinTolerance(e, s.amountMinor, tol) ? 'MATCH' : 'DIVERGENT'; }
        if (row.status === 'DIVERGENT') base.divergent++;
        base.months.push(row);
      }
      const compared = base.months.filter(x => x.status === 'MATCH' || x.status === 'DIVERGENT').length, inPeriod = base.months.filter(x => !OUT.includes(x.status));
      base.status = base.divergent ? 'DIVERGENT' : compared ? 'OK'
        : anyCmp ? (base.months.some(x => x.status === 'ELLIS_INCOMPLETE') ? 'ELLIS_INCOMPLETE' : 'LEDGER_MISSING')           // months were looked at but none could be judged: not OK
        : base.months.some(x => x.status === 'CURRENCY_MISMATCH') ? 'CURRENCY_MISMATCH'
        : inPeriod.length && inPeriod.every(x => x.status === 'SHARED_HOTEL') ? 'SHARED_HOTEL'
        : base.months.length && base.months.every(x => OUT.includes(x.status)) ? 'OUT_OF_CONTRACT' : 'NO_DATA';
      byContract[c.contractId] = base;
    }
    return { basis, dateBasis: snap ? snap.window.basis : null, scope: hotelScope ? 'HOTEL' : 'CONTRACT', tolerancePct: tol, stale, collectedAt: snap ? snap.provenance.collectedAt : null, synthetic: snap ? snap.provenance.synthetic : null, byContract };
  }

  /**
   * What the ELLIS bookings say about the consumption speed of ONE contract, as a read-only indicator next to the ledger:
   *   past     the last N completed months exactly as compare() judged them (ledger amount, ELLIS amount, status)
   *   avgMinor the average ELLIS amount of the past months that could be judged (null when none could); complete = every month of the window was usable
   *   upcoming the current month and the later months that are in the snapshot: stays already on the books (they still grow or shrink until check-in/out)
   * It is never written into the ledger. opts: { basis, scope, cmp }  (cmp = a compare() result computed once for all contracts)
   */
  function outlook(state, contractId, opts) {
    opts = opts || {}; const basis = opts.basis === 'BILLING' ? 'BILLING' : 'NET', hotelScope = opts.scope === 'HOTEL';
    const cmp = opts.cmp || compare(state, { basis, scope: opts.scope }); const c = state.contracts.find(x => x.contractId === contractId); const cc = cmp.byContract[contractId];
    const out = { available: false, status: cc ? cc.status : 'NO_SNAPSHOT', basis, dateBasis: cmp.dateBasis || null, scope: cmp.scope, collectedAt: cmp.collectedAt, stale: !!cmp.stale, synthetic: cmp.synthetic, currency: c ? c.currency : null,
      past: [], avgMinor: null, avgMonths: 0, complete: false, upcoming: [] };
    const snap = state.ellis && state.ellis.snapshot; if (!c || !cc || !snap) return out;
    out.available = ['OK', 'DIVERGENT'].includes(cc.status) || cc.months.some(m => m.ellisMinor != null);
    out.past = cc.months.map(m => ({ month: m.month, ledgerMinor: m.ledgerMinor, ellisMinor: m.ellisMinor, ratioPct: m.ratioPct, status: m.status, converted: m.converted, sinceDate: m.sinceDate || null }));
    const usable = cc.months.filter(m => m.ellisMinor != null && ['MATCH', 'DIVERGENT', 'LEDGER_MISSING'].includes(m.status));   // the ELLIS side is complete in all three; a missing ledger month does not make the bookings unusable
    if (usable.length) { out.avgMinor = Number(usable.reduce((a, m) => a + BigInt(m.ellisMinor), 0n) / BigInt(usable.length)); out.avgMonths = usable.length; out.complete = usable.length === cc.months.length; }
    const hotel = state.hotels.find(h => h.hotelId === c.hotelId), hk = hotel && hotelKey(hotel.ellisHotelId), sh = hk && snap.hotels.find(h => h.hotelCode === hk); if (!sh) return out;
    const asOf = state.config.asOf, meanRate = rateFinder(snap), from = Dates.monthKey(asOf), last = Dates.monthKey(snap.window.to);
    const sibs = state.contracts.filter(x => x.hotelId === c.hotelId && x.contractId !== c.contractId && x.prepaymentType !== 'SECURITY_DEPOSIT');
    for (let mk = from; mk <= last && out.upcoming.length < 24; mk = Dates.addMonths(mk, 1)) {
      const mf = mk + '-01', me = monthEnd(mk), m = sh.months.find(x => x.month === mk); const e = { month: mk, current: mk === from, netMinor: null, billingMinor: null, bookings: null, converted: false, status: 'OK' };
      if (c.endDate && Dates.cmp(mf, c.endDate) > 0) { e.status = 'AFTER_CONTRACT'; out.upcoming.push(e); continue; }
      const live = hotelScope ? [] : sibs.filter(x => !(x.endDate && Dates.cmp(mf, x.endDate) > 0) && !(x.startDate && Dates.cmp(me, x.startDate) < 0));
      if (live.some(x => x.currency === c.currency)) { e.status = 'SHARED_HOTEL'; out.upcoming.push(e); continue; }
      if (!sh.coveredMonths.includes(mk)) { e.status = 'NOT_COVERED'; out.upcoming.push(e); continue; }
      if (m && m.byCurrency.length) {
        const x = inContractCurrency(m, c.currency, meanRate, live.length === 0);
        if (x.unavailable) e.status = 'CURRENCY_MISMATCH'; else { e.billingMinor = x.billing; e.netMinor = x.net; e.converted = x.convertedPct > 0; e.bookings = m.byCurrency.filter(y => live.length === 0 || y.currency === c.currency).reduce((a, y) => a + y.bookings, 0); if (m.skippedRows > 0 || (basis === 'NET' && x.net == null)) e.status = 'ELLIS_INCOMPLETE'; }
      } else { e.billingMinor = 0; e.netMinor = 0; e.bookings = 0; }
      out.upcoming.push(e);
    }
    return out;
  }

  return { SCHEMA, VERSION, COLLECTORS, TOOL_CONTRACT, TOLERANCE_PCT, STALE_DAYS, MAX_PAGE, MAX_SPAN_DAYS, hotelKey, toMinor, monthWindows, coveredMonths, buildFromCalls, collect, validateSnapshot, matchHotels, restrictToMaster, compare, outlook, hashOf };
});
