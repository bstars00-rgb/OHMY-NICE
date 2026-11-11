/* PIC tracker importer (the Vietnam "Prepayment Risk Tracker" layout) -> unified ledger format + an input check list.
   Input is the CSV text of each sheet (save the sheet as CSV UTF-8): Existing, Top-up Log, Risk Register. Columns are found by their header text, so hidden columns and
   column order do not matter. Pure functions: nothing is stored, nothing is sent anywhere.
   Output: normalised arrangements, contracts / ledger / confirmations rows in the system's import layout, and `issues` (ERROR cannot be converted, WARN look wrong, INFO note). */
(function (root, factory) {
  const NS = root.OMH || (root.OMH = {});
  const api = factory(typeof require === 'function' ? { Money: require('../core/money.js'), Dates: require('../core/dates.js'), Csv: require('./csv.js'), Ledger: require('./ledger.js') } : { Money: NS.Money, Dates: NS.Dates, Csv: NS.Csv, Ledger: NS.Ledger });
  NS.Tracker = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis, function (dep) {
  'use strict';
  const { Money, Dates, Csv, Ledger } = dep;
  const DEFAULTS = { currency: 'VND', country: 'VN', entity: 'OMH-VN', confirmStaleDays: 90, endingDays: 90, longUnusedDays: 60, noBookingDays: 30, overfundedDays: 90, discrepancyPct: 5, discrepancyAbsMinor: 10000000, declinePct: 50 };   // thresholds = the tracker's own Settings sheet
  const TYPE_MAP = [[/floating/i, 'FLOATING'], [/hard\s*-?\s*block/i, 'HARD_BLOCK_ADV'], [/deposit/i, 'SECURITY_DEPOSIT'], [/pre-?\s*pay/i, 'PREPAYMENT'], [/買取|buy\s*-?\s*out|buyout/i, 'BUYOUT']];   // Commit Rev / Commit RN / Hybrid have no counterpart yet (decision pending)
  const UNMAPPED_TYPES = /commit|hybrid/i;
  const norm = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const normId = s => String(s).replace(/^0+(?=\d)/, '');                        // "0101" and "101" are the same hotel
  const low = s => norm(s).toLowerCase();

  /* ---------- cell parsing ---------- */
  const PRODUCTION_NOTE = 'sales production (ELLIS vendor amount by stay month, whole hotel, cancelled excluded); not the deducted amount';     // what the tracker's Usage columns are (SCM director, 2026-11-10)
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const pad = n => String(n).padStart(2, '0');
  const ymd = (y, m, d) => { const s = y + '-' + pad(m) + '-' + pad(d); return Dates.isDate(s) ? s : null; };
  /** ISO, yyyy/mm/dd, dd/mm/yyyy (the tracker guide's format), dd-mm-yyyy, or an Excel serial number. Anything else -> undefined (= unreadable); empty -> null. */
  function parseDate(v) {
    const s = norm(v); if (!s) return null;
    let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/.exec(s); if (m) return ymd(+m[1], +m[2], +m[3]) || undefined;
    m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s); if (m) return ymd(+m[3], +m[2], +m[1]) || undefined;
    if (/^\d{5}(\.\d+)?$/.test(s) && +s > 20000 && +s < 80000) return Dates.addDays('1899-12-30', Math.floor(+s));
    return undefined;
  }
  /** Whole currency units; "500,000,000", "(1,000)", "-12.314.650" style separators are accepted. Empty -> null, unreadable -> undefined. */
  function parseAmount(v, ccy) {
    const s0 = norm(v).replace(/\b(VND|USD|KRW|JPY|SGD)\b|[₫đ]/gi, '').trim(); if (!s0) return null;      // only a currency tag is ignored; any other text makes the cell unreadable
    const paren = /^\(.*\)$/.test(s0); let body = paren ? s0.slice(1, -1) : s0; let neg = paren; if (/^-/.test(body)) { if (paren) return undefined; neg = true; body = body.slice(1); } let s = body.replace(/\s/g, '');   // a minus counts only at the front or inside brackets; "5,000-" or "1-000" are unreadable
    const d = Money.decimals(ccy);
    if (paren && /^-/.test(body)) return undefined;                              // "(-5)": two minus signs are not read
    if (/^\d{1,3}(,\d{3})+\.\d+$/.test(s)) s = s.replace(/,/g, '');             // 1,234.56
    else if (/^\d{1,3}(\.\d{3})+,\d+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');   // 1.234,56
    else if (d > 0 && /^\d{1,3}[.,]\d{3}$/.test(s)) return undefined;                  // "12.345" could be 12.345 or 12,345: with decimals in the currency it is not guessed
    else if (/^\d{1,3}([.,]\d{3})+$/.test(s)) s = s.replace(/[.,]/g, '');         // grouping separators only
    else if (/^\d+[.,]\d{1,2}$/.test(s) && d > 0) s = s.replace(',', '.');
    else if (!/^\d+(\.\d+)?$/.test(s)) { if (/^\d+,\d+$/.test(s)) s = s.replace(',', '.'); else return undefined; }
    const p = Money.parseAmount(s, ccy); if (!p.ok) return undefined;
    return neg ? -p.minor : p.minor;
  }
  const yesNo = v => { const s = low(v); if (!s) return null; if (/^(y|yes|có|co|1|true)$/.test(s)) return true; if (/^(n|no|không|khong|0|false)$/.test(s)) return false; return undefined; };
  const mapType = raw => { const s = norm(raw); if (!s) return { type: null, why: 'missing' }; for (const [re, t] of TYPE_MAP) if (re.test(s)) return { type: t }; return { type: null, why: UNMAPPED_TYPES.test(s) ? 'unmapped' : 'unknown' }; };
  const MON = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  const MON_YEAR = new RegExp('\\b' + MON + '\\b[\\s\\-/\'.]*(\\d{4}|\\d{2})\\b', 'i'), MON_ONLY = new RegExp('\\b' + MON + '\\b', 'i');
  /** "Usage Aug-26", "August 2026", "2026-08", "08/2026", "M-3" (relative to the as-of date) or a bare month name ("Oct": the latest completed month of that name). Anything else -> null. */
  const monthKeyOf = (label, asOf) => {
    const s = String(label).replace(/\([^)]*\)/g, ' ');
    const rel = /\bm\s*-\s*([1-3])\b/i.exec(s); if (rel && asOf) return Dates.prevMonths(asOf, 3)[3 - +rel[1]];
    const key = (y, mo) => { const k = y + '-' + pad(mo); return mo >= 1 && mo <= 12 && Dates.isMonthKey(k) ? k : null; };
    let m = MON_YEAR.exec(s); if (m) return key(m[2].length === 2 ? 2000 + +m[2] : +m[2], MONTHS[m[1].slice(0, 3).toLowerCase()]);
    m = /\b(\d{4})[-/](\d{1,2})\b/.exec(s); if (m) return key(+m[1], +m[2]);
    m = /\b(\d{1,2})[-/](\d{4})\b/.exec(s); if (m) return key(+m[2], +m[1]);
    if (/\d/.test(s)) return null;                                                // some other number: not guessed
    m = MON_ONLY.exec(s); if (m && asOf) { const mo = MONTHS[m[1].slice(0, 3).toLowerCase()]; return Dates.prevMonths(asOf, 12).slice().reverse().find(k => +k.slice(5) === mo) || null; }
    return null;
  };

  /* ---------- header detection ---------- */
  const COLS = [
    ['hotelId', /^(hotel id|hotel code)\b/], ['hotelName', /^hotel name/], ['pic', /^pic\b/], ['region', /^(region|city)\b/], ['arrangement', /^(arrangement|prepayment type|type)\b/],
    ['plannedAmount', /planned top-?up amount/], ['plannedDate', /planned top-?up date/], ['contractFrom', /^contract (from|start)/], ['contractTo', /^(contract (to|end)|contract$)/],
    ['initial', /^initial prepayment/], ['allotment', /^allotment/], ['balanceHotel', /^current balance.*(per hotel|hotel confirm)/], ['balanceOmh', /^current balance/], ['confirmDate', /^hotel confirmation date|^confirmation date/],
    ['usage', /^usage\b/], ['lastUsage', /^last usage/], ['lastBooking', /^last booking/], ['topUpCondition', /^top-?up condition/], ['minTopUp', /^minimum top-?up/], ['refundCondition', /^balance refund condition|^refund condition/],
    ['refundPossible', /^refund possible/], ['remark', /^remark/], ['totalTopUp', /^total top-?up/], ['totalRefund', /^total refund/],
  ];
  /** Finds the header row (the first of the top rows that holds a hotel id column and one more known column) and maps every known column. */
  function headerMap(grid, cols, need) {
    for (let r = 0; r < Math.min(grid.length, 12); r++) {
      const map = {}; const usage = [];
      grid[r].forEach((cell, c) => { const h = low(cell).replace(/\s*\(.*?\)\s*/g, ' ').trim() || low(cell); for (const [k, re] of cols) if (re.test(h) || re.test(low(cell))) { if (k === 'usage') usage.push({ c, label: norm(cell) }); else if (!(k in map)) map[k] = c; break; } });
      if (usage.length) map.usage = usage;
      if (need.every(k => k in map)) return { row: r, map };
    }
    return null;
  }
  const cellAt = (row, c) => (c == null ? '' : norm(row[c]));

  /* ---------- Existing sheet ---------- */
  function parseExisting(text, o) {
    o = Object.assign({}, DEFAULTS, o || {}); const out = { rows: [], issues: [], skipped: { guidance: 0, example: 0, blank: 0 }, usageMonths: [] };
    const add = (severity, code, rec, detail) => out.issues.push({ severity, code, sheet: 'Existing', rowNo: rec ? rec.rowNo : null, hotelId: rec ? rec.hotelId : null, hotelName: rec ? rec.hotelName : null, detail: detail || null });
    out.blocked = false;
    let grid; try { grid = Csv.parse(text); } catch (e) { add('ERROR', 'T_CSV_UNREADABLE'); out.blocked = true; return out; }
    const hm = headerMap(grid, COLS, ['hotelId', 'balanceOmh']); if (!hm) { add('ERROR', 'T_HEADER_MISSING', null, 'Hotel ID, Current Balance - per OMH books'); out.blocked = true; return out; }
    const { map, row: hr } = hm; const asOf = o.asOf;
    const usageCols = (map.usage || []).map(u => ({ c: u.c, month: monthKeyOf(u.label, asOf), label: u.label }));
    if (asOf && usageCols.length === 3 && usageCols.every(u => !u.month)) usageCols.forEach((u, i) => { u.month = Dates.prevMonths(asOf, 3)[i]; });      // by position only when NO heading can be read at all
    if (usageCols.some(u => !u.month)) { add('ERROR', 'T_USAGE_MONTH_UNKNOWN', null, usageCols.map(u => u.label).join(' | ')); out.blocked = true; }                   // a usage column of unknown month would put money in the opening that no row explains
    else {
      usageCols.sort((x, y) => (x.month < y.month ? -1 : x.month > y.month ? 1 : 0));                                                                              // oldest month first, whatever the column order is
      const ms = usageCols.map(u => u.month);
      if (new Set(ms).size !== ms.length) { add('ERROR', 'T_USAGE_MONTH_CONFLICT', null, ms.join(' | ')); out.blocked = true; }
      if (asOf && ms.some(m => m >= Dates.monthKey(asOf))) { add('ERROR', 'T_USAGE_MONTH_FUTURE', null, ms.join(' | ')); out.blocked = true; }                         // usage is for completed months only
      if (asOf && ms.some(m => m < Dates.prevMonths(asOf, 12)[0])) { add('ERROR', 'T_USAGE_MONTH_OLD', null, ms.join(' | ')); out.blocked = true; }                  // a sheet that is a year old, or a mistyped year
    }
    out.usageMonths = usageCols.map(u => u.month);
    for (let r = hr + 1; r < grid.length; r++) {
      const row = grid[r]; const idRaw = normId(cellAt(row, map.hotelId)), name = cellAt(row, map.hotelName);
      if (row.every(x => !norm(x))) { out.skipped.blank++; continue; }
      if (/^\d{3,12}$/.test(idRaw) && /^example/i.test(name)) { out.skipped.example++; continue; }              // the sample row of the template
      if (!/^\d{1,12}$/.test(idRaw)) { if (r === hr + 1 || (!idRaw && !name)) { out.skipped.guidance++; continue; } add('ERROR', 'T_ID_INVALID', { rowNo: r + 1, hotelId: idRaw, hotelName: name }); continue; }   // the row under the header is a guidance row
      const rec = { rowNo: r + 1, hotelId: idRaw, hotelName: name, pic: cellAt(row, map.pic) || null, region: cellAt(row, map.region) || null, arrangementRaw: cellAt(row, map.arrangement) };
      const num = (k) => { const v = parseAmount(row[map[k]], o.currency); if (v === undefined) add('ERROR', 'T_AMOUNT_INVALID', rec, k + ': ' + cellAt(row, map[k])); return v === undefined ? null : v; };
      const dat = (k) => { const v = parseDate(row[map[k]]); if (v === undefined) add('ERROR', 'T_DATE_INVALID', rec, k + ': ' + cellAt(row, map[k])); return v === undefined ? null : v; };
      Object.assign(rec, { contractFrom: dat('contractFrom'), contractTo: dat('contractTo'), initialMinor: num('initial'), allotment: cellAt(row, map.allotment) || null, balanceOmhMinor: num('balanceOmh'), balanceHotelMinor: num('balanceHotel'), confirmDate: dat('confirmDate'),
        lastUsageDate: dat('lastUsage'), lastBookingDate: dat('lastBooking'), topUpCondition: cellAt(row, map.topUpCondition) || null, minTopUpMinor: num('minTopUp'), plannedMinor: num('plannedAmount'), plannedDate: dat('plannedDate'),
        refundCondition: cellAt(row, map.refundCondition) || null, remark: cellAt(row, map.remark) || null });
      const rp = yesNo(row[map.refundPossible]); const rpRaw = low(row[map.refundPossible]); rec.refundPossible = rpRaw === 'conditional' ? 'CONDITIONAL' : rp === true ? 'YES' : rp === false ? 'NO' : null;
      if (rp === undefined && rpRaw !== 'conditional') add('WARN', 'T_REFUND_FLAG_UNREADABLE', rec, rpRaw);
      rec.usage = usageCols.map(u => { const v = parseAmount(row[u.c], o.currency); if (v === undefined || (v != null && v < 0)) { add('ERROR', 'T_AMOUNT_INVALID', rec, 'usage ' + u.label + (v < 0 ? ' is negative: ' : ': ') + cellAt(row, u.c)); return { month: u.month, amountMinor: null }; } return { month: u.month, amountMinor: v }; });
      const ty = mapType(rec.arrangementRaw); rec.prepaymentType = ty.type;
      if (ty.why === 'missing') add('ERROR', 'T_TYPE_MISSING', rec); else if (ty.why) add('WARN', 'T_TYPE_UNMAPPED', rec, rec.arrangementRaw);
      out.rows.push(rec);
    }
    // contract ids: one per arrangement row; a second arrangement at the same hotel gets a suffix
    const seen = {}; for (const rec of out.rows) { const n = seen[rec.hotelId] = (seen[rec.hotelId] || 0) + 1; rec.contractId = 'CT-' + o.country + '-' + rec.hotelId + (n > 1 ? '-' + n : ''); }
    return out;
  }

  /* ---------- Top-up Log sheet ---------- */
  const LOG_COLS = [['hotelId', /^hotel id/], ['hotelName', /^hotel name/], ['date', /^date\b|^transaction date/], ['type', /^type\b/], ['amount', /^amount/], ['ref', /^reference|^invoice/], ['note', /^note/]];
  const LOG_TYPES = { initial: 'TOPUP', 'top-up': 'TOPUP', topup: 'TOPUP', refund: 'REFUND', offset: 'OFFSET', adjustment: 'ADJUSTMENT' };
  function parseTopUpLog(text, o) {
    o = Object.assign({}, DEFAULTS, o || {}); const out = { rows: [], issues: [] };
    if (!norm(text)) return out;
    let grid; try { grid = Csv.parse(text); } catch (e) { out.issues.push({ severity: 'ERROR', code: 'T_CSV_UNREADABLE', sheet: 'TopUp', rowNo: null, detail: 'Top-up Log' }); return out; }
    const hm = headerMap(grid, LOG_COLS, ['hotelId', 'date', 'type', 'amount']); if (!hm) { out.issues.push({ severity: 'ERROR', code: 'T_HEADER_MISSING', sheet: 'TopUp', rowNo: null, detail: 'Top-up Log: Hotel ID, Date, Type, Amount' }); return out; }
    const { map, row: hr } = hm;
    for (let r = hr + 1; r < grid.length; r++) {
      const row = grid[r]; if (row.every(x => !norm(x))) continue; const id = normId(cellAt(row, map.hotelId));
      if (/^\d{3,12}$/.test(id) && /^(123456)$/.test(id) && !cellAt(row, map.hotelName)) { if (r === hr + 2 || r === hr + 1) continue; }   // template example row
      if (!/^\d{1,12}$/.test(id)) { if (r === hr + 1) continue; out.issues.push({ severity: 'ERROR', code: 'T_ID_INVALID', sheet: 'TopUp', rowNo: r + 1, hotelId: id, detail: 'Top-up Log' }); continue; }
      const date = parseDate(row[map.date]), type = LOG_TYPES[low(row[map.type]).replace(/[\s_]+/g, '-')], amt = parseAmount(row[map.amount], o.currency);
      const rec = { rowNo: r + 1, hotelId: id, date, ledgerType: type, rawType: cellAt(row, map.type), amountMinor: amt, ref: cellAt(row, map.ref) || null, note: cellAt(row, map.note) || null };
      if (!date) { out.issues.push({ severity: 'ERROR', code: 'T_DATE_INVALID', sheet: 'TopUp', rowNo: r + 1, hotelId: id, detail: 'Top-up Log date: ' + cellAt(row, map.date) }); continue; }
      if (!type) { out.issues.push({ severity: 'ERROR', code: 'T_LOG_TYPE_INVALID', sheet: 'TopUp', rowNo: r + 1, hotelId: id, detail: rec.rawType }); continue; }
      if (amt == null || amt === undefined || (amt <= 0 && type !== 'ADJUSTMENT') || amt === 0) { out.issues.push({ severity: 'ERROR', code: 'T_AMOUNT_INVALID', sheet: 'TopUp', rowNo: r + 1, hotelId: id, detail: 'Top-up Log amount: ' + cellAt(row, map.amount) }); continue; }
      if (rec.ref && rec.ref.length > 200) { out.issues.push({ severity: 'ERROR', code: 'T_LOG_FIELD_TOO_LONG', sheet: 'TopUp', rowNo: r + 1, hotelId: id, detail: 'reference over 200 characters' }); continue; }      // the import refuses longer fields
      out.rows.push(rec);
    }
    return out;
  }

  /* ---------- Risk Register sheet ---------- */
  const RISK_COLS = [['hotelId', /^hotel id/], ['pastDelay', /^past refund delay/], ['maxDelay', /^max delay/], ['disputed', /^amount disputed/], ['disputeStatus', /^dispute status/], ['delayDetail', /^refund delay \/ dispute detail|^refund delay/],
    ['closure', /^closure/], ['operatorChange', /^change of operator/], ['financial', /^financial instability/], ['detail', /^known issue detail/], ['source', /^source/], ['infoDate', /^info date/], ['unresponsive', /^hotel unresponsive/], ['contactLeft', /^key contact/], ['bookingDrop', /^booking drop/]];
  function parseRiskRegister(text, o) {
    o = Object.assign({}, DEFAULTS, o || {}); const out = { rows: [], issues: [] }; if (!norm(text)) return out;
    let grid; try { grid = Csv.parse(text); } catch (e) { out.issues.push({ severity: 'ERROR', code: 'T_CSV_UNREADABLE', sheet: 'Risk', rowNo: null, detail: 'Risk Register' }); return out; }
    const hm = headerMap(grid, RISK_COLS, ['hotelId', 'closure']); if (!hm) { out.issues.push({ severity: 'ERROR', code: 'T_HEADER_MISSING', sheet: 'Risk', rowNo: null, detail: 'Risk Register: Hotel ID, Closure' }); return out; }
    const { map, row: hr } = hm;
    for (let r = hr + 1; r < grid.length; r++) {
      const row = grid[r]; if (row.every(x => !norm(x))) continue; const id = normId(cellAt(row, map.hotelId));
      if (!/^\d{1,12}$/.test(id)) { if (r === hr + 1) continue; out.issues.push({ severity: 'ERROR', code: 'T_ID_INVALID', sheet: 'Risk', rowNo: r + 1, hotelId: id, detail: 'Risk Register' }); continue; }
      if (id === '123456' && (r === hr + 1 || r === hr + 2)) continue;                                        // the template example, only where the template puts it
      const yn = k => yesNo(row[map[k]]);
      const rec = { rowNo: r + 1, hotelId: id, pastDelay: yn('pastDelay'), maxDelayDays: parseAmount(row[map.maxDelay], 'KRW'), disputedMinor: parseAmount(row[map.disputed], o.currency), disputeStatus: cellAt(row, map.disputeStatus) || null, delayDetail: cellAt(row, map.delayDetail) || null,
        closure: yn('closure'), operatorChange: yn('operatorChange'), financial: yn('financial'), detail: cellAt(row, map.detail) || null, source: cellAt(row, map.source) || null, infoDate: parseDate(row[map.infoDate]) || null, unresponsive: yn('unresponsive'), contactLeft: yn('contactLeft'), bookingDrop: yn('bookingDrop') };
      out.rows.push(rec);
    }
    return out;
  }

  /* ---------- checks + conversion ---------- */
  const daysBetween = (a, b) => Dates.diffDays(a, b);
  const monthStart = m => m + '-01', monthEndOf = m => Dates.addDays(Dates.addMonths(m, 1) + '-01', -1);
  const sum = a => a.reduce((x, y) => x + y, 0);
  /**
   * texts: { existing, topUpLog?, risk? } (CSV text). o: { asOf (required), currency, country, entity, thresholds... }
   * -> { arrangements[], contracts[], ledger[], confirmations[], riskItems[], issues[], summary }
   */
  function convert(texts, o) {
    o = Object.assign({}, DEFAULTS, o || {}); if (!Dates.isDate(o.asOf)) throw new Error('E_ASOF_REQUIRED');
    const ex = parseExisting(texts.existing, o), log = parseTopUpLog(texts.topUpLog, o), rk = parseRiskRegister(texts.risk, o);
    const issues = [...ex.issues, ...log.issues, ...rk.issues];
    const add = (severity, code, rec, detail, sheet) => issues.push({ severity, code, sheet: sheet || 'Existing', rowNo: rec ? rec.rowNo : null, hotelId: rec ? rec.hotelId : null, hotelName: rec ? rec.hotelName : null, detail: detail || null });
    if (!ex.rows.length && !issues.some(i => i.severity === 'ERROR')) add('ERROR', 'T_NO_ROWS');
    const logRows = log.rows;
    if (ex.rows.length && !logRows.length && !(texts.topUpLog && norm(texts.topUpLog))) add('WARN', 'T_TOPUP_LOG_EMPTY', null, 'no Top-up Log given');
    else if (ex.rows.length && !logRows.length) add('WARN', 'T_TOPUP_LOG_EMPTY');
    const contracts = [], ledger = [], confirmations = [];
    const dec = Money.decimals(o.currency), maj = m => { if (!dec || m == null || m === '') return m; const a = Math.abs(m), f = Math.pow(10, dec); return (m < 0 ? '-' : '') + Math.floor(a / f) + '.' + String(a % f).padStart(dec, '0'); };    // the import files carry whole currency units
    const winStart = r => { const f = r.usage.find(u => u.month && u.amountMinor != null); return monthStart(f ? f.month : Dates.monthKey(o.asOf)); };   // first month with a known usage; without any, the as-of month
    for (const r of ex.rows) {
      const bal = r.balanceOmhMinor, usageKnown = r.usage.filter(u => u.amountMinor != null);
      const avg = usageKnown.length ? sum(usageKnown.map(u => u.amountMinor)) / usageKnown.length : null;
      // --- contract dates
      if (!r.contractFrom || !r.contractTo) add('WARN', 'T_CONTRACT_DATES_MISSING', r, (!r.contractFrom ? 'from ' : '') + (!r.contractTo ? 'to' : ''));
      if (r.contractFrom && r.contractTo && Dates.cmp(r.contractFrom, r.contractTo) >= 0) add('ERROR', 'T_CONTRACT_DATE_ORDER', r, r.contractFrom + ' >= ' + r.contractTo);
      if (r.contractTo && bal > 0) { const d = daysBetween(o.asOf, r.contractTo); if (d < 0) add('WARN', 'T_CONTRACT_EXPIRED_WITH_BALANCE', r, 'ended ' + (-d) + ' days ago'); else if (d <= o.endingDays) add('WARN', 'T_CONTRACT_ENDING_SOON', r, d + ' days left' + (r.refundPossible === 'NO' ? ', refund not possible' : '')); }
      // --- balances
      if (bal == null) { if (!issues.some(i => i.rowNo === r.rowNo && i.code === 'T_AMOUNT_INVALID' && /balanceOmh/.test(i.detail || ''))) add('ERROR', 'T_BALANCE_MISSING', r); }     // an unreadable balance was already reported as such
      else {
        if (bal < 0) add('WARN', 'T_BALANCE_NEGATIVE', r, String(bal));
        if (r.balanceHotelMinor != null && r.balanceHotelMinor === bal && !r.confirmDate) add('WARN', 'T_CONFIRM_COPY', r, 'hotel balance equals OMH balance and has no confirmation date');
        else if (bal > 0 && (r.balanceHotelMinor == null || !r.confirmDate)) add('WARN', 'T_CONFIRM_MISSING', r);
        if (r.confirmDate && daysBetween(r.confirmDate, o.asOf) > o.confirmStaleDays) add('WARN', 'T_CONFIRM_STALE', r, daysBetween(r.confirmDate, o.asOf) + ' days');
        if (r.balanceHotelMinor != null && r.confirmDate) { const diff = Math.abs(bal - r.balanceHotelMinor); if (diff * 100 >= o.discrepancyPct * Math.abs(bal) && diff > 0 || diff >= o.discrepancyAbsMinor) add('WARN', 'T_BALANCE_MISMATCH', r, 'diff ' + (bal - r.balanceHotelMinor)); }
      }
      if (r.initialMinor == null) add('WARN', 'T_INITIAL_MISSING', r);
      if (r.refundPossible == null) add('INFO', 'T_REFUND_FLAG_MISSING', r);
      // --- usage
      if (r.prepaymentType !== 'SECURITY_DEPOSIT') {
        if (!usageKnown.length && bal > 0) add('WARN', 'T_USAGE_MISSING', r);
        const before = r.usage.filter(u => u.month && u.amountMinor > 0 && r.contractFrom && Dates.cmp(monthEndOf(u.month), r.contractFrom) < 0).map(u => u.month);
        if (before.length) add('WARN', 'T_USAGE_BEFORE_CONTRACT', r, before.join(', ') + ' before ' + r.contractFrom);
        const u = r.usage; if (u.length === 3 && u.every(x => x.amountMinor != null) && (u[0].amountMinor + u[1].amountMinor) > 0) { const base = (u[0].amountMinor + u[1].amountMinor) / 2; const pct = (u[2].amountMinor - base) / base * 100; if (pct <= -o.declinePct) add('INFO', 'T_USAGE_DECLINE', r, Math.round(pct) + '%'); }
        if (bal > 0 && avg > 0 && bal / (avg / 30) > o.overfundedDays) add('WARN', 'T_OVERFUNDED', r, Math.round(bal / (avg / 30)) + ' days of cover');
        if (bal > 0 && r.lastUsageDate && daysBetween(r.lastUsageDate, o.asOf) > o.longUnusedDays) add('WARN', 'T_LONG_UNUSED', r, daysBetween(r.lastUsageDate, o.asOf) + ' days');
        if (bal > 0 && r.lastBookingDate && daysBetween(r.lastBookingDate, o.asOf) > o.noBookingDays) add('WARN', 'T_NO_RECENT_BOOKING', r, daysBetween(r.lastBookingDate, o.asOf) + ' days');
        const mine = logRows.filter(x => x.hotelId === r.hotelId);
        if (logRows.length && usageKnown.length && sum(usageKnown.map(x => x.amountMinor)) > (r.initialMinor || 0) + sum(mine.filter(x => x.ledgerType === 'TOPUP').map(x => x.amountMinor))) add('WARN', 'T_USAGE_EXCEEDS_FUNDS', r, 'usage of the last months is larger than initial prepayment + logged top-ups');
      }
      // --- planned top-up
      if (r.plannedMinor != null && !r.plannedDate) add('INFO', 'T_PLANNED_TOPUP_NO_DATE', r);
      if (r.plannedMinor == null && r.plannedDate) add('INFO', 'T_PLANNED_TOPUP_NO_AMOUNT', r);
      if (r.plannedDate) { if (Dates.cmp(r.plannedDate, o.asOf) < 0) add('WARN', 'T_PLANNED_TOPUP_PAST', r, r.plannedDate); if (r.contractTo && Dates.cmp(r.plannedDate, r.contractTo) >= 0) add('WARN', 'T_PLANNED_TOPUP_AT_OR_AFTER_END', r, r.plannedDate + ' vs end ' + r.contractTo); }
      if (r.plannedMinor != null && r.minTopUpMinor != null && r.plannedMinor < r.minTopUpMinor) add('WARN', 'T_PLANNED_TOPUP_BELOW_MIN', r, r.plannedMinor + ' < ' + r.minTopUpMinor);
    }
    // duplicate arrangements (same hotel, type and start)
    const keys = {}; for (const r of ex.rows) { const k = [r.hotelId, r.prepaymentType || r.arrangementRaw, r.contractFrom].join('|'); if (keys[k]) add('WARN', 'T_DUPLICATE_ROW', r, 'same as row ' + keys[k]); else keys[k] = r.rowNo; }
    // top-up log rows for hotels that are not in Existing
    const known = new Set(ex.rows.map(r => r.hotelId)); for (const x of logRows) if (!known.has(x.hotelId)) add('WARN', 'T_LOG_UNKNOWN_HOTEL', { rowNo: x.rowNo, hotelId: x.hotelId }, 'Top-up Log', 'TopUp');
    for (const x of logRows) if (Dates.cmp(x.date, o.asOf) > 0) add('ERROR', 'T_LOG_FUTURE', { rowNo: x.rowNo, hotelId: x.hotelId }, x.date, 'TopUp');
    const arrCount = {}; for (const r of ex.rows) arrCount[r.hotelId] = (arrCount[r.hotelId] || 0) + 1;
    const hotelWin = {}; for (const r of ex.rows) { const w = winStart(r); if (!hotelWin[r.hotelId] || w < hotelWin[r.hotelId]) hotelWin[r.hotelId] = w; }
    for (const x of logRows) if (arrCount[x.hotelId] > 1 && Dates.cmp(x.date, hotelWin[x.hotelId]) >= 0 && Dates.cmp(x.date, o.asOf) <= 0) add('ERROR', 'T_LOG_AMBIGUOUS_CONTRACT', { rowNo: x.rowNo, hotelId: x.hotelId }, arrCount[x.hotelId] + ' arrangements at this hotel', 'TopUp');      // the log has no contract column: it cannot be split between two arrangements of one hotel
    // risk register: a "Yes" without a source cannot become a verified fact
    for (const x of rk.rows) { const yes = x.closure || x.operatorChange || x.financial || x.pastDelay || x.unresponsive || x.contactLeft || x.bookingDrop; if (!known.has(x.hotelId)) add('WARN', 'T_RISK_UNKNOWN_HOTEL', x, null, 'Risk'); if (yes && !x.source) add('WARN', 'T_RISK_NO_EVIDENCE', x, null, 'Risk'); if (x.disputeStatus && /^open$/i.test(x.disputeStatus)) add('INFO', 'T_RISK_DISPUTE_OPEN', x, null, 'Risk'); }

    // --- unified rows. An arrangement is converted only if nothing blocks it: an error on its own row (not on a row of another sheet), an unusable usage column,
    //     an unreadable / future / ambiguous Top-up Log row of the same hotel, a missing type or balance, or an opening balance that would have to be negative.
    const blocked = new Set(issues.filter(i => i.severity === 'ERROR' && i.rowNo != null && i.sheet === 'Existing').map(i => i.rowNo));
    const logBad = new Set(issues.filter(i => i.severity === 'ERROR' && i.sheet === 'TopUp' && i.hotelId).map(i => i.hotelId));
    for (const r of ex.rows) {
      if (ex.blocked || blocked.has(r.rowNo) || !r.prepaymentType || r.balanceOmhMinor == null) continue;
      if (logBad.has(r.hotelId)) { add('ERROR', 'T_LOG_ROW_REJECTED', r); continue; }
      const wStart = winStart(r), hasUsage = r.usage.some(u => u.month && u.amountMinor != null);
      const mine = logRows.filter(x => x.hotelId === r.hotelId && Dates.cmp(x.date, wStart) >= 0 && Dates.cmp(x.date, o.asOf) <= 0);
      const usageSum = sum(r.usage.filter(u => u.amountMinor != null).map(u => u.amountMinor));
      const inW = ty => sum(mine.filter(x => x.ledgerType === ty).map(x => x.amountMinor));
      const opening = r.balanceOmhMinor - inW('TOPUP') + usageSum + inW('REFUND') + inW('OFFSET') - inW('ADJUSTMENT');   // balance at the start of the window, derived so the ledger ends on the tracker balance
      if (opening < 0) { add('ERROR', 'T_OPENING_NEGATIVE', r, 'derived opening balance ' + opening); continue; }      // no money is invented: nothing of this arrangement is converted
      // the rows of this arrangement, in the order the import will see them
      const rows = [{ type: 'OPENING', minor: opening, at: wStart + 'T09:00:00+09:00', period: '', status: '', reason: 'derived from tracker', ref: 'TRK-OPEN-' + r.hotelId + '-' + r.contractId }];
      for (const u of r.usage) if (u.amountMinor != null && u.month) rows.push({ type: 'CONSUMPTION', minor: u.amountMinor, at: monthEndOf(u.month) + 'T23:00:00+09:00', period: u.month, status: 'confirmed', reason: PRODUCTION_NOTE, ref: 'TRK-' + r.contractId + '-' + u.month });
      for (const x of mine) rows.push({ type: x.ledgerType, minor: x.amountMinor, at: x.date + 'T10:00:00+09:00', period: '', status: '', reason: String(x.note || (x.ledgerType === 'OFFSET' || x.ledgerType === 'ADJUSTMENT' ? x.rawType : '')).slice(0, 200), ref: x.ref || 'TRK-LOG-' + r.contractId + '-' + x.date + '-' + x.rawType + '-' + x.amountMinor + '-r' + x.rowNo });
      rows.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));                                                      // time order: a refund must see the top-up that came before it
      if (!Number.isSafeInteger(usageSum) || rows.some(x => !Number.isSafeInteger(x.minor) || Math.abs(x.minor) > 1e15)) { add('ERROR', 'T_AMOUNT_TOO_LARGE', r); continue; }
      let run = 0, bad = null; for (const x of rows) { if ((x.type === 'REFUND' || x.type === 'OFFSET') && run < x.minor) { bad = x; break; } run += x.type === 'CONSUMPTION' || x.type === 'REFUND' || x.type === 'OFFSET' ? -x.minor : x.minor; }
      if (bad) { add('ERROR', 'T_LOG_ORDER_INVALID', r, bad.type + ' of ' + bad.minor + ' on ' + bad.at.slice(0, 10) + ' exceeds the balance at that date'); continue; }
      const seenTx = []; let dup = null; for (const x of rows) { const tx = { contractId: r.contractId, type: x.type, currency: o.currency, amountMinor: x.minor, occurredAt: x.at, externalRef: x.ref, period: x.period }; if (Ledger.isDuplicate(tx, { txs: seenTx })) { dup = x; break; } seenTx.push(tx); }
      if (dup) { add('ERROR', 'T_LOG_DUPLICATE', r, dup.type + ' ' + dup.ref); continue; }                                  // the import would drop this row and the balance would no longer close
      contracts.push({ contractId: r.contractId, hotelId: r.hotelId, hotelName: r.hotelName, country: o.country, region: r.region || '', pic: r.pic || '', omhEntity: o.entity, prepaymentType: r.prepaymentType, currency: o.currency, startDate: r.contractFrom || '', endDate: r.contractTo || '',
        initialPrepayment: r.initialMinor == null ? '' : maj(r.initialMinor), allotment: r.allotment || '', refundable: r.refundPossible || '', refundCondition: r.refundCondition || '', topUpCondition: r.topUpCondition || '', minTopUp: r.minTopUpMinor == null ? '' : maj(r.minTopUpMinor),
        plannedTopUp: r.plannedMinor == null ? '' : maj(r.plannedMinor), plannedTopUpDate: r.plannedDate || '', remark: r.remark || '' });
      for (const x of rows) ledger.push({ contractId: r.contractId, type: x.type, amount: maj(x.minor), currency: o.currency, occurredAt: x.at, period: x.period, status: x.status, reason: x.reason, externalRef: x.ref });
      if (!hasUsage) add('WARN', 'T_NO_USAGE_MONTHS', r);
      else if (!logRows.length && opening > (r.initialMinor || 0) * 3 && opening > 0) add('WARN', 'T_OPENING_INFLATED', r, 'derived opening ' + opening + ' is far above the initial prepayment: top-ups are missing from the log');
      if (r.balanceHotelMinor != null && r.confirmDate) confirmations.push({ contractId: r.contractId, amount: maj(r.balanceHotelMinor), currency: o.currency, confirmedAt: r.confirmDate });
    }
    if (ledger.some(x => x.type === 'CONSUMPTION')) add('INFO', 'T_USAGE_IS_PRODUCTION');
    const sev = s => issues.filter(i => i.severity === s).length;
    return { arrangements: ex.rows, contracts, ledger, confirmations, riskItems: rk.rows, topUpRows: logRows, issues, usageMonths: ex.usageMonths, skipped: ex.skipped,
      summary: { rows: ex.rows.length, converted: contracts.length, ledgerRows: ledger.length, errors: sev('ERROR'), warnings: sev('WARN'), info: sev('INFO') } };
  }

  const CONTRACT_COLUMNS = ['contractId', 'hotelId', 'hotelName', 'country', 'region', 'pic', 'omhEntity', 'prepaymentType', 'currency', 'startDate', 'endDate', 'initialPrepayment', 'allotment', 'refundable', 'refundCondition', 'topUpCondition', 'minTopUp', 'plannedTopUp', 'plannedTopUpDate', 'remark'];
  const LEDGER_COLUMNS = ['contractId', 'type', 'amount', 'currency', 'occurredAt', 'period', 'status', 'reason', 'externalRef'];      // the layout of the existing ledger CSV import
  const CONFIRMATION_COLUMNS = ['contractId', 'amount', 'currency', 'confirmedAt'];
  const ISSUE_COLUMNS = ['severity', 'code', 'sheet', 'rowNo', 'hotelId', 'hotelName', 'detail'];
  const unifiedCsv = r => ({ 'contracts.csv': Csv.toCSV(CONTRACT_COLUMNS, r.contracts), 'ledger.csv': Csv.toCSV(LEDGER_COLUMNS, r.ledger), 'confirmations.csv': Csv.toCSV(CONFIRMATION_COLUMNS, r.confirmations), 'issues.csv': Csv.toCSV(ISSUE_COLUMNS, r.issues) });

  return { DEFAULTS, COLS, CONTRACT_COLUMNS, LEDGER_COLUMNS, CONFIRMATION_COLUMNS, ISSUE_COLUMNS, parseDate, parseAmount, mapType, parseExisting, parseTopUpLog, parseRiskRegister, convert, unifiedCsv };
});
