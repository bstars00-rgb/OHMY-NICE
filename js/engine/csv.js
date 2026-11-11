/* CSV parsing / ledger import validation / safe export. Import is two-step: validate (dry-run) -> commit accepted rows. */
(function (root, factory) {
  const NS = root.OMH || (root.OMH = {});
  const api = factory(typeof require === 'function' ? { Money: require('../core/money.js'), Ledger: require('./ledger.js') } : { Money: NS.Money, Ledger: NS.Ledger });
  NS.Csv = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis, function (dep) {
  'use strict';
  const { Money, Ledger } = dep;
  const REQUIRED = ['contractId', 'type', 'amount', 'currency', 'occurredAt'];
  const OPTIONAL = ['txId', 'period', 'status', 'reason', 'externalRef'];
  const MAX_ROWS = 5000, MAX_TEXT = 200;

  /** RFC-4180-ish parser: quotes, escaped quotes, CRLF/LF, BOM. Returns array of string arrays. */
  function parse(text) {
    text = String(text || '').replace(/^﻿/, '');
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some(x => x !== '')) rows.push(row); row = []; }
      else cur += c;
    }
    if (q) { const e = new Error('CSV_UNTERMINATED_QUOTE'); e.code = 'E_CSV_QUOTE'; throw e; }
    row.push(cur); if (row.some(x => x !== '')) rows.push(row);
    return rows;
  }
  const clean = s => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();

  /** Dry-run validation. ctx: { contractsById, txs, asOf }.  Does not modify ctx.txs. */
  function validateLedgerCsv(text, ctx) {
    const out = { fatal: [], rows: [], summary: { total: 0, accept: 0, reject: 0, duplicate: 0 } };
    let grid;
    try { grid = parse(text); } catch (e) { out.fatal.push(e.code || 'E_CSV'); return out; }
    if (!grid.length) { out.fatal.push('E_CSV_EMPTY'); return out; }
    const header = grid[0].map(h => clean(h));
    const missing = REQUIRED.filter(h => !header.includes(h));
    if (missing.length) { out.fatal.push('E_CSV_HEADER_MISSING:' + missing.join('|')); return out; }
    const unknown = header.filter(h => ![...REQUIRED, ...OPTIONAL].includes(h));
    if (unknown.length) out.warnings = ['W_CSV_UNKNOWN_COLUMNS:' + unknown.join('|')];
    if (grid.length - 1 > MAX_ROWS) { out.fatal.push('E_CSV_TOO_MANY_ROWS'); return out; }
    const staged = ctx.txs.slice(); const index = Ledger.makeIndex(staged);          // local copy so in-file duplicates are caught
    for (let i = 1; i < grid.length; i++) {
      const line = i + 1; const rec = {}; header.forEach((h, j) => { rec[h] = clean(grid[i][j]); });
      const errors = [];
      if (grid[i].length !== header.length) errors.push('E_CSV_FIELD_COUNT');
      for (const k of Object.keys(rec)) if (rec[k].length > MAX_TEXT) errors.push('E_FIELD_TOO_LONG:' + k);
      const cur = rec.currency.toUpperCase(); const p = Money.parseAmount(rec.amount, cur);
      if (!p.ok) errors.push(p.error);
      const tx = { txId: rec.txId || undefined, contractId: rec.contractId, type: rec.type.toUpperCase(), amountMinor: p.ok ? p.minor : NaN, currency: cur, occurredAt: rec.occurredAt,
        period: rec.period || undefined, status: rec.status ? rec.status.toLowerCase() : (rec.type.toUpperCase() === 'CONSUMPTION' ? 'confirmed' : undefined),
        reason: rec.reason || undefined, externalRef: rec.externalRef || undefined, source: 'CSV' };
      let status = 'REJECT';
      const verdict = errors.length === 0 ? Ledger.validate(tx, { contractsById: ctx.contractsById, txs: staged, asOf: ctx.asOf, index }) : { ok: false, errors, warnings: [] };
      if (verdict.ok) { status = 'ACCEPT'; staged.push(tx); Ledger.indexAdd(index, tx); }
      else if (verdict.errors.includes('E_DUPLICATE_KEY') || verdict.errors.includes('E_DUPLICATE_ID')) status = 'DUPLICATE';
      out.rows.push({ line, status, errors: verdict.errors, warnings: verdict.warnings || [], tx });
      out.summary.total++; out.summary[status === 'ACCEPT' ? 'accept' : status === 'DUPLICATE' ? 'duplicate' : 'reject']++;
    }
    return out;
  }

  /** Spreadsheet-formula-injection-safe cell. */
  function cell(v) {
    let s = v == null ? '' : String(v);
    if (typeof v === 'string' && /^[\s\u3000]*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]|^[\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCSV(columns, rows) { return '﻿' + [columns.join(',')].concat(rows.map(r => columns.map(c => cell(r[c])).join(','))).join('\r\n') + '\r\n'; }

  return { REQUIRED, OPTIONAL, MAX_ROWS, parse, validateLedgerCsv, cell, toCSV };
});
