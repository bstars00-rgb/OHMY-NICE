/* Append-only prepayment ledger. Corrections are made with ADJUSTMENT rows, never by overwriting.
   Closing = Opening + Top-ups − Consumption(confirmed) − Refunds + Adjustments                       */
(function (root, factory) {
  const NS = root.OMH || (root.OMH = {});
  const api = factory(typeof require === 'function' ? { Money: require('../core/money.js'), Dates: require('../core/dates.js') } : { Money: NS.Money, Dates: NS.Dates });
  NS.Ledger = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis, function (dep) {
  'use strict';
  const { Money, Dates } = dep;
  const TYPES = ['OPENING', 'TOPUP', 'CONSUMPTION', 'REFUND', 'ADJUSTMENT', 'OFFSET'];
  const STATUSES = ['confirmed', 'pending'];

  /** Duplicate-detection key. An external reference (bank ref / ELLIS settlement id) wins; otherwise the full content. */
  /** Reference normalisation: NFKC, every dash variant -> '-', strip format/control characters (zero-width, soft hyphen, bidi marks) and whitespace, upper-case. */
  function normRef(r) { return String(r == null ? '' : r).normalize('NFKC').replace(/[\p{Pd}\u2212\u02D7\u2796]/gu, '-').replace(/[\p{Cf}\p{Cc}\p{Default_Ignorable_Code_Point}\s\u034F\uFE00-\uFE0F\u115F\u1160\u3164\uFFA0\u17B4\u17B5\u2800]+/gu, '').toUpperCase(); }
  /** Same instant => same key, whatever the written offset (10:00+09:00 == 01:00Z). */
  function instant(s) { const ms = Date.parse(String(s)); return Number.isNaN(ms) ? String(s) : new Date(ms).toISOString(); }
  const HAS_TZ = /(Z|[+-]\d{2}:?\d{2})$/;
  const MAX_TX = 1e15;
  const BUSINESS_OFFSET = '+09:00';                                    // business day = KST in the prototype; a transaction's day is judged by its instant, not by how its offset was written
  const endOfDayMs = (ymd, off) => Date.parse(String(ymd).slice(0, 10) + 'T23:59:59.999' + (off || BUSINESS_OFFSET));
  const refOf = tx => normRef(tx.externalRef);
  function contentKey(tx) { return [tx.contractId, tx.type, String(tx.currency).toUpperCase(), tx.amountMinor, instant(tx.occurredAt), tx.type === 'CONSUMPTION' ? (tx.period || '') : ''].join('|'); }   // period only identifies consumption rows
  /** Primary key: normalised external reference when present, otherwise the content. */
  function dedupKey(tx) { const ref = refOf(tx); return ref ? [tx.contractId, tx.type, 'REF', ref].join('|') : contentKey(tx); }
  /** Duplicate if the reference key matches, or the same content exists and either side has no reference (a manual post and a CSV import of one transaction).
      Two rows with the same content but DIFFERENT non-empty references are distinct (e.g. two identical bank transfers). */
  function isDuplicate(tx, ctx) {
    const key = dedupKey(tx), ck = contentKey(tx), ref = refOf(tx), ix = ctx.index;
    if (ix) { if (ix.keys.has(key)) return true; const e = ix.content.get(ck); return !!e && (!ref || e.hasNoRef); }
    return ctx.txs.some(t => { if (dedupKey(t) === key) return true; return contentKey(t) === ck && (!ref || !refOf(t)); });
  }

  /** ctx: { contractsById, txs (existing), asOf } -> { ok, errors:[code], warnings:[code] } */
  function validate(tx, ctx) {
    const errors = [], warnings = [];
    const contract = ctx.contractsById[tx.contractId];
    if (!contract) errors.push('E_CONTRACT_UNKNOWN');
    if (!TYPES.includes(tx.type)) errors.push('E_TYPE_INVALID');
    if (!Money.isSupported(tx.currency)) errors.push('E_CURRENCY_UNSUPPORTED');
    else if (contract && tx.currency !== contract.currency) errors.push('E_CURRENCY_MISMATCH');
    if (!Number.isSafeInteger(tx.amountMinor)) errors.push('E_AMOUNT_INVALID');
    else if (Math.abs(tx.amountMinor) > MAX_TX) errors.push('E_AMOUNT_TOO_LARGE');
    else if (tx.type === 'ADJUSTMENT') { if (tx.amountMinor === 0) errors.push('E_AMOUNT_INVALID'); }
    else if (tx.type === 'OPENING') { if (tx.amountMinor < 0) errors.push('E_AMOUNT_NEGATIVE'); }
    else if (tx.amountMinor < 0) errors.push('E_AMOUNT_NEGATIVE');
    else if (tx.amountMinor === 0 && !(tx.type === 'CONSUMPTION' && tx.status === 'confirmed')) errors.push('E_AMOUNT_INVALID'); // only an explicit confirmed-zero consumption may be 0
    if (!Dates.isDateTime(tx.occurredAt) || Number.isNaN(Date.parse(String(tx.occurredAt)))) errors.push('E_DATETIME_INVALID');
    else if (!HAS_TZ.test(String(tx.occurredAt))) errors.push('E_TIMEZONE_REQUIRED');
    else if (ctx.asOf && Date.parse(String(tx.occurredAt)) > endOfDayMs(ctx.asOf)) errors.push('E_FUTURE_DATE');
    if (tx.type === 'CONSUMPTION') {
      if (!Dates.isMonthKey(tx.period)) errors.push('E_PERIOD_REQUIRED');
      else if ((ctx.asOf && tx.period > Dates.monthKey(ctx.asOf)) || tx.period < '2000-01' || (Dates.isDateTime(tx.occurredAt) && tx.period > Dates.monthKey(new Date(Date.parse(String(tx.occurredAt)) + 9 * 3600000).toISOString()))) errors.push('E_PERIOD_OUT_OF_RANGE');
      if (!STATUSES.includes(tx.status)) errors.push('E_STATUS_INVALID');
    }
    if (tx.type === 'ADJUSTMENT' && !(tx.reason && String(tx.reason).trim())) errors.push('E_ADJUSTMENT_REASON_REQUIRED');
    if (tx.type === 'OFFSET' && !(tx.reason && String(tx.reason).trim())) errors.push('E_OFFSET_REASON_REQUIRED');            // an offset must say what it was deducted against
    if (errors.length === 0) {
      const ix = ctx.index;                                        // optional prebuilt index keeps bulk imports O(n)
      if (isDuplicate(tx, ctx)) errors.push('E_DUPLICATE_KEY');
      if (tx.txId && (ix ? ix.ids.has(tx.txId) : ctx.txs.some(t => t.txId === tx.txId))) errors.push('E_DUPLICATE_ID');
      if (tx.type === 'OPENING' && (ix ? ix.openings.has(tx.contractId) : ctx.txs.some(t => t.contractId === tx.contractId && t.type === 'OPENING'))) errors.push('E_OPENING_EXISTS');
      const closing = () => (ix ? (ix.bal.get(tx.contractId) || 0) : balance(ctx.txs, tx.contractId).closingMinor);
      if (tx.type === 'REFUND' && tx.amountMinor > closing()) errors.push('E_REFUND_EXCEEDS_BALANCE');
      if (tx.type === 'OFFSET' && tx.amountMinor > closing()) errors.push('E_OFFSET_EXCEEDS_BALANCE');
      if (tx.type === 'CONSUMPTION' && tx.status === 'confirmed' && tx.amountMinor > closing()) warnings.push('W_NEGATIVE_BALANCE');
    }
    return { ok: errors.length === 0, errors, warnings };
  }

  /** Effect of one row on the closing balance (pending consumption is not deducted). */
  function delta(t) { return t.type === 'OPENING' || t.type === 'TOPUP' || t.type === 'ADJUSTMENT' ? t.amountMinor : (t.type === 'REFUND' || t.type === 'OFFSET') ? -t.amountMinor : (t.type === 'CONSUMPTION' && t.status === 'confirmed') ? -t.amountMinor : 0; }
  function makeIndex(txs) { const ix = { keys: new Set(), ids: new Set(), openings: new Set(), content: new Map(), bal: new Map(), count: new Map() }; for (const t of txs) indexAdd(ix, t); return ix; }
  function indexAdd(ix, t) {
    ix.bal.set(t.contractId, (ix.bal.get(t.contractId) || 0) + delta(t)); ix.count.set(t.contractId, (ix.count.get(t.contractId) || 0) + 1);
    ix.keys.add(dedupKey(t)); if (t.txId) ix.ids.add(t.txId); if (t.type === 'OPENING') ix.openings.add(t.contractId);
    const ck = contentKey(t), e = ix.content.get(ck); ix.content.set(ck, { hasNoRef: (e && e.hasNoRef) || !refOf(t) });
  }

  /** Append (never mutate existing rows). Returns the validation result plus the stored row. */
  function append(txs, tx, ctx) {
    const row = Object.assign({}, tx);
    if (row.type !== 'CONSUMPTION') { delete row.period; delete row.status; }          // period/status are meaningful only for consumption rows
    const res = validate(row, Object.assign({}, ctx, { txs }));
    if (!res.ok) return Object.assign({ tx: null }, res);
    if (!row.txId) { let n = (ctx.index ? (ctx.index.count.get(row.contractId) || 0) : txs.filter(t => t.contractId === row.contractId).length) + 1; const taken = ctx.index ? ctx.index.ids : null; do { row.txId = 'TX-' + row.contractId + '-' + String(n++).padStart(5, '0'); } while (taken ? taken.has(row.txId) : txs.some(t => t.txId === row.txId)); }
    const next = (ctx.index ? (ctx.index.bal.get(row.contractId) || 0) : balance(txs, row.contractId).closingMinor) + delta(row);
    if (!Number.isSafeInteger(next)) return { tx: null, ok: false, errors: ['E_BALANCE_OVERFLOW'], warnings: [] };
    txs.push(Object.freeze(row));
    if (ctx.index) indexAdd(ctx.index, row);
    return Object.assign({ tx: row }, res);
  }

  /** Closing balance for one contract, optionally as of a date (inclusive). Pending consumption is reported, not deducted. */
  function balance(txs, contractId, upToDate) {
    const r = { openingMinor: 0, topupsMinor: 0, consumptionMinor: 0, refundsMinor: 0, offsetsMinor: 0, adjustmentsMinor: 0, pendingConsumptionMinor: 0, count: 0, closingMinor: 0 };
    for (const t of txs) {
      if (t.contractId !== contractId) continue;
      if (upToDate && Date.parse(String(t.occurredAt)) > endOfDayMs(upToDate)) continue;
      r.count++;
      if (t.type === 'OPENING') r.openingMinor += t.amountMinor;
      else if (t.type === 'TOPUP') r.topupsMinor += t.amountMinor;
      else if (t.type === 'CONSUMPTION') { if (t.status === 'confirmed') r.consumptionMinor += t.amountMinor; else r.pendingConsumptionMinor += t.amountMinor; }
      else if (t.type === 'REFUND') r.refundsMinor += t.amountMinor;
      else if (t.type === 'ADJUSTMENT') r.adjustmentsMinor += t.amountMinor;
      else if (t.type === 'OFFSET') r.offsetsMinor += t.amountMinor;
    }
    r.closingMinor = r.openingMinor + r.topupsMinor - r.consumptionMinor - r.refundsMinor - r.offsetsMinor + r.adjustmentsMinor;
    return r;
  }

  /** Chronological statement with running balance (pending consumption shown, running balance unchanged). */
  function statement(txs, contractId) {
    const rows = txs.filter(t => t.contractId === contractId).sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : a.txId < b.txId ? -1 : 1));
    let run = 0;
    return rows.map(t => {
      let delta = 0;
      if (t.type === 'OPENING' || t.type === 'TOPUP' || t.type === 'ADJUSTMENT') delta = t.amountMinor;
      else if (t.type === 'REFUND' || t.type === 'OFFSET') delta = -t.amountMinor;
      else if (t.type === 'CONSUMPTION' && t.status === 'confirmed') delta = -t.amountMinor;
      run += delta; return Object.assign({}, t, { deltaMinor: delta, runningMinor: run });
    });
  }

  /** Balance recomputed from scratch vs a stored/claimed closing — used by integrity checks. */
  function verifyIdentity(txs, contractId) {
    const b = balance(txs, contractId); const st = statement(txs, contractId);
    const last = st.length ? st[st.length - 1].runningMinor : 0;
    return { ok: last === b.closingMinor, closingMinor: b.closingMinor, runningMinor: last };
  }

  /** Compare OMH ledger with the hotel-confirmed balance. diff = ledger − hotel. */
  function reconcile(ledgerMinor, ledgerCurrency, conf, cfg, asOf) {
    if (!conf) return { status: 'UNCONFIRMED', diffMinor: null, pctBp: null, stale: false, confirmedAt: null };
    if (conf.currency !== ledgerCurrency) return { status: 'CURRENCY_MISMATCH', diffMinor: null, pctBp: null, stale: false, confirmedAt: conf.confirmedAt };
    const diff = ledgerMinor - conf.amountMinor; const base = Math.max(Math.abs(ledgerMinor), Math.abs(conf.amountMinor), 1);
    const bp = Number((BigInt(Math.abs(diff)) * 10000n) / BigInt(base));            // display only (floored)
    const within = lim => BigInt(Math.abs(diff)) * 1000000n <= BigInt(Math.round(lim * 100)) * BigInt(base);   // exact: |diff|/base*10000 <= lim (bp), no rounding
    const stale = Dates.diffDays(conf.confirmedAt, asOf) > cfg.recon.staleDays;
    const status = diff === 0 || within(cfg.recon.matchBp) ? 'MATCH' : within(cfg.recon.minorBp) ? 'MINOR' : 'MAJOR';
    return { status, diffMinor: diff, pctBp: bp, stale, confirmedAt: conf.confirmedAt, confirmedMinor: conf.amountMinor };
  }

  return { TYPES, STATUSES, BUSINESS_OFFSET, normRef, instant, contentKey, dedupKey, isDuplicate, validate, append, makeIndex, indexAdd, balance, statement, verifyIdentity, reconcile };
});
