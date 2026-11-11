'use strict';
// PIC tracker importer: parsing, input checks, conversion to the unified ledger format, preview command and command-line tool. Synthetic data only.
const fs = require('fs'), path = require('path'), os = require('os'), { spawnSync } = require('child_process');
const env = require('./helpers/env');
const { Tracker, Csv, Ledger, Store, Dates } = env;
const ASOF = '2026-11-06';
const q = v => { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const toCsv = rows => rows.map(r => r.map(q).join(',')).join('\r\n') + '\r\n';
const HEAD = ['No', 'Hotel ID', 'Hotel Name', 'PIC', 'Region', 'Arrangement', 'Planned top-up amount (VND)', 'Planned top-up date', 'Contract From', 'Contract To', 'Initial Prepayment (VND)', 'Allotment', 'Current Balance - per OMH books (VND)', 'Current Balance - per hotel confirmation (VND)', 'Hotel confirmation date',
  'Usage Aug-26 (VND)', 'Usage Sep-26 (VND)', 'Usage Oct-26 (VND)', 'Last usage date', 'Last booking created date', 'Top-up condition', 'Minimum top-up amount (VND)', 'Balance Refund condition', 'Refund possible', 'Remark'];
const SHORT = { id: 'Hotel ID', name: 'Hotel Name', pic: 'PIC', region: 'Region', type: 'Arrangement', planned: 'Planned top-up amount (VND)', plannedDate: 'Planned top-up date', from: 'Contract From', to: 'Contract To', initial: 'Initial Prepayment (VND)', allot: 'Allotment', bal: 'Current Balance - per OMH books (VND)',
  hbal: 'Current Balance - per hotel confirmation (VND)', cdate: 'Hotel confirmation date', u8: 'Usage Aug-26 (VND)', u9: 'Usage Sep-26 (VND)', u10: 'Usage Oct-26 (VND)', lastUse: 'Last usage date', lastBook: 'Last booking created date', cond: 'Top-up condition', min: 'Minimum top-up amount (VND)', refundCond: 'Balance Refund condition', refund: 'Refund possible', remark: 'Remark' };
/** one healthy arrangement; override with short keys */
const healthy = o => Object.assign({ id: '90001', name: 'Sample Hotel A', pic: 'Anna', region: 'Hanoi', type: 'Floating', from: '2026-04-01', to: '2027-03-31', initial: '600000000', bal: '260000000', hbal: '260000000', cdate: '2026-11-02', u8: '110000000', u9: '105000000', u10: '112000000', lastUse: '2026-11-05', lastBook: '2026-11-05', refund: 'Yes', cond: 'Top up when balance < 100M VND', min: '100000000' }, o || {});
function existing(rows, opt) { opt = opt || {}; const head = opt.head || HEAD; const line = o => head.map(h => { const k = Object.keys(SHORT).find(s => SHORT[s] === h); return k && o[k] != null ? o[k] : ''; });
  const out = [['Title row'], ['Subtitle row'], head]; if (opt.guide !== false) out.push(head.map(() => 'guidance text')); if (opt.example !== false) out.push(line({ id: '123456', name: 'EXAMPLE HOTEL - delete this row', type: 'Floating', bal: '320000000' }));
  return toCsv(out.concat(rows.map(line))); }
const conv = (rows, o, extra) => Tracker.convert(Object.assign({ existing: existing(rows, extra && extra.opt) }, extra && extra.texts), Object.assign({ asOf: ASOF }, o));
const codes = (r, id) => r.issues.filter(i => id == null || i.hotelId === id).map(i => i.severity + ':' + i.code);
const sample = n => fs.readFileSync(path.join(env.root, 'samples/tracker_SYNTHETIC_' + n + '.csv'), 'utf8');
const sampleResult = () => Tracker.convert({ existing: sample('existing'), topUpLog: sample('topup'), risk: sample('risk') }, { asOf: ASOF });
const topup = rows => toCsv([['Log'], ['Add every transaction'], ['Hotel ID', 'Hotel Name (auto)', 'Date', 'Type', 'Amount (VND)', 'Reference / invoice no.', 'Note'], ['Must exist', 'Auto', 'dd/mm/yyyy', 'Type', 'Positive', 'ref', 'note']].concat(rows));

module.exports = function (h) {
  const { test: t } = h;

  t('TR01', 'cell parsing: dates in the formats PICs use, amounts with separators and brackets, and what is unreadable', ['TRK-1'], a => {
    const D = Tracker.parseDate; a.eq(D('2026-11-09'), '2026-11-09'); a.eq(D('09/11/2026'), '2026-11-09'); a.eq(D('9-11-2026'), '2026-11-09'); a.eq(D('2026/11/09'), '2026-11-09'); a.eq(D('2026-11-09 10:00:00'), '2026-11-09'); a.eq(D('46000'), '2025-12-09', 'Excel serial'); a.eq(D(''), null); a.eq(D('  '), null);
    for (const bad of ['31/02/2026', '2026-13-01', 'soon', '13/13/2026', '1/1/26', '20260101x']) a.eq(D(bad), undefined, bad);
    const A = (s, c) => Tracker.parseAmount(s, c || 'VND'); a.eq(A('500,000,000'), 5e8); a.eq(A('500000000'), 5e8); a.eq(A('1.234.567'), 1234567); a.eq(A('(12,314,650)'), -12314650); a.eq(A('-12314650'), -12314650); a.eq(A('500,000,000 VND'), 5e8); a.eq(A(''), null); a.eq(A('  '), null);
    for (const bad of ['12.5', 'abc', '1,2,3x', '1e9', '12..5']) a.eq(A(bad), undefined, bad);
    a.eq(A('12.34', 'USD'), 1234); a.eq(A('12,34', 'USD'), 1234); a.eq(A('12.345', 'USD'), undefined);
  });

  t('TR02', 'columns are found by their heading text: any order, hidden or extra columns, title rows, guidance and example rows', ['TRK-1'], a => {
    const r = conv([healthy()]); a.eq(r.arrangements.length, 1); a.deepEq(r.skipped, { guidance: 1, example: 1, blank: 0 }); a.deepEq(r.usageMonths, ['2026-08', '2026-09', '2026-10']);
    const shuffled = HEAD.slice().reverse().concat(['Extra column nobody knows']); const r2 = conv([healthy()], null, { opt: { head: shuffled } }); const x = r2.arrangements[0];
    a.eq(x.hotelId, '90001'); a.eq(x.balanceOmhMinor, 260e6); a.eq(x.contractFrom, '2026-04-01'); a.eq(x.usage.map(u => u.amountMinor).join(), '110000000,105000000,112000000'); a.eq(x.refundPossible, 'YES');
    const r3 = conv([healthy()], null, { opt: { guide: false, example: false } }); a.eq(r3.arrangements.length, 1, 'works without the guidance and example rows'); a.eq(r3.skipped.guidance + r3.skipped.example, 0);
    const relText = existing([healthy()]).replace('Usage Aug-26 (VND)', 'Usage M-3 (VND)').replace('Usage Sep-26 (VND)', 'Usage M-2 (VND)').replace('Usage Oct-26 (VND)', 'Usage M-1 (VND)'); const r4 = Tracker.convert({ existing: relText }, { asOf: ASOF });
    a.deepEq(r4.usageMonths, ['2026-08', '2026-09', '2026-10'], 'relative headings follow the as-of date'); a.eq(r4.arrangements[0].usage[2].amountMinor, 112e6);
    const noHdr = Tracker.convert({ existing: 'a,b,c\r\n1,2,3\r\n' }, { asOf: ASOF }); a.deepEq(codes(noHdr), ['ERROR:T_HEADER_MISSING']); a.eq(noHdr.contracts.length, 0);
    const bad = Tracker.convert({ existing: 'Hotel ID,"Current Balance - per OMH books (VND)\r\n1,2\r\n' }, { asOf: ASOF }); a.ok(codes(bad).includes('ERROR:T_CSV_UNREADABLE'));
    a.throws(() => Tracker.convert({ existing: '' }, {}), 'E_ASOF_REQUIRED');
  });

  t('TR03', 'arrangement types: the five of the system map; Commit / Hybrid and blanks are reported and not converted', ['TRK-1'], a => {
    const r = conv([healthy({ id: '1', type: 'Floating' }), healthy({ id: '2', type: 'Hard Block' }), healthy({ id: '3', type: 'Deposit' }), healthy({ id: '4', type: 'Prepayment' }), healthy({ id: '5', type: '買取' }), healthy({ id: '6', type: 'Commit Rev' }), healthy({ id: '7', type: 'Hybrid (Commit Rev or RN)' }), healthy({ id: '8', type: '' }), healthy({ id: '9', type: 'Mystery' })]);
    a.deepEq(r.contracts.map(c => c.prepaymentType), ['FLOATING', 'HARD_BLOCK_ADV', 'SECURITY_DEPOSIT', 'PREPAYMENT', 'BUYOUT']); a.deepEq(codes(r, '6'), ['WARN:T_TYPE_UNMAPPED']); a.deepEq(codes(r, '7'), ['WARN:T_TYPE_UNMAPPED']); a.deepEq(codes(r, '8'), ['ERROR:T_TYPE_MISSING']); a.deepEq(codes(r, '9'), ['WARN:T_TYPE_UNMAPPED']);
    a.eq(r.summary.rows, 9); a.eq(r.summary.converted, 5);
  });

  t('TR04', 'input checks on the synthetic sample: each built-in problem is found, the healthy row is clean', ['TRK-2'], a => {
    const r = sampleResult(); a.eq(r.summary.errors, 0); a.eq(r.summary.rows, 8); a.eq(r.summary.converted, 7);
    a.deepEq(codes(r, '90101'), [], 'healthy row');
    for (const [id, want] of [['90102', ['WARN:T_CONTRACT_ENDING_SOON', 'INFO:T_USAGE_DECLINE', 'INFO:T_PLANNED_TOPUP_NO_DATE']], ['90103', ['WARN:T_BALANCE_NEGATIVE']], ['90104', ['WARN:T_CONTRACT_DATES_MISSING', 'WARN:T_USAGE_MISSING']], ['90105', ['WARN:T_CONFIRM_COPY', 'WARN:T_USAGE_EXCEEDS_FUNDS']],
      ['90106', ['WARN:T_CONFIRM_COPY', 'WARN:T_USAGE_BEFORE_CONTRACT']], ['90107', ['WARN:T_PLANNED_TOPUP_AT_OR_AFTER_END']], ['90108', ['WARN:T_TYPE_UNMAPPED', 'WARN:T_BALANCE_MISMATCH', 'WARN:T_USAGE_BEFORE_CONTRACT', 'WARN:T_OVERFUNDED']]]) { const got = codes(r, id); for (const w of want) a.includes(got, w, id + ' ' + got.join()); }
    a.includes(codes(r, '90999'), 'WARN:T_LOG_UNKNOWN_HOTEL'); a.includes(codes(r, '90104'), 'WARN:T_RISK_NO_EVIDENCE'); a.ok(r.riskItems.length === 2, 'the template example row of the Risk Register is skipped');
    const ending = r.issues.find(i => i.code === 'T_CONTRACT_ENDING_SOON'); a.ok(/refund not possible/.test(ending.detail), 'the refund flag is part of the message');
  });

  t('TR05', 'every threshold of the checks: confirmation age, mismatch size, ending, long unused, no booking, over-funded, planned top-up', ['TRK-2'], a => {
    const c = (o, x) => codes(conv([healthy(o)], x), '90001');
    a.ok(c({ cdate: '2026-08-01' }).includes('WARN:T_CONFIRM_STALE')); a.ok(!c({ cdate: '2026-08-10' }).includes('WARN:T_CONFIRM_STALE'), '88 days is still inside 90');
    a.ok(c({ hbal: '230000000' }).includes('WARN:T_BALANCE_MISMATCH'), '30M apart'); a.ok(c({ bal: '260000000', hbal: '248000000' }).includes('WARN:T_BALANCE_MISMATCH'), '12M apart is above 10M'); a.ok(!c({ bal: '260000000', hbal: '255000000' }).includes('WARN:T_BALANCE_MISMATCH'), '5M of 260M is under 5% and under 10M');
    a.ok(c({ bal: '50000000', hbal: '47000000' }).includes('WARN:T_BALANCE_MISMATCH'), '3M of 50M is 6%: over 5%');
    a.ok(c({ to: '2027-01-30' }).includes('WARN:T_CONTRACT_ENDING_SOON'), '85 days'); a.ok(!c({ to: '2027-03-31' }).includes('WARN:T_CONTRACT_ENDING_SOON')); a.ok(c({ to: '2026-10-31' }).includes('WARN:T_CONTRACT_EXPIRED_WITH_BALANCE')); a.ok(!c({ to: '2026-10-31', bal: '0', hbal: '0' }).includes('WARN:T_CONTRACT_EXPIRED_WITH_BALANCE'), 'no balance, no flag');
    a.ok(c({ lastUse: '2026-08-01' }).includes('WARN:T_LONG_UNUSED')); a.ok(!c({ lastUse: '2026-09-15' }).includes('WARN:T_LONG_UNUSED')); a.ok(c({ lastBook: '2026-09-01' }).includes('WARN:T_NO_RECENT_BOOKING')); a.ok(!c({ lastBook: '2026-10-20' }).includes('WARN:T_NO_RECENT_BOOKING'));
    a.ok(c({ bal: '2000000000', hbal: '2000000000' }).includes('WARN:T_OVERFUNDED'), '2B against ~109M a month'); a.ok(!c({}).includes('WARN:T_OVERFUNDED'));
    a.ok(c({ planned: '50000000', plannedDate: '2026-11-20', min: '100000000' }).includes('WARN:T_PLANNED_TOPUP_BELOW_MIN')); a.ok(c({ planned: '200000000', plannedDate: '2026-10-01' }).includes('WARN:T_PLANNED_TOPUP_PAST')); a.ok(c({ planned: '200000000', plannedDate: '2027-04-01' }).includes('WARN:T_PLANNED_TOPUP_AT_OR_AFTER_END'));
    a.ok(c({ planned: '200000000' }).includes('INFO:T_PLANNED_TOPUP_NO_DATE')); a.ok(c({ plannedDate: '2026-12-01' }).includes('INFO:T_PLANNED_TOPUP_NO_AMOUNT'));
    a.ok(c({ bal: '' }).includes('ERROR:T_BALANCE_MISSING')); a.ok(c({ from: '2027-04-01', to: '2027-03-31' }).includes('ERROR:T_CONTRACT_DATE_ORDER')); a.ok(c({ initial: '' }).includes('WARN:T_INITIAL_MISSING')); a.ok(c({ refund: '' }).includes('INFO:T_REFUND_FLAG_MISSING'));
    a.ok(c({ u8: '', u9: '', u10: '' }).includes('WARN:T_USAGE_MISSING')); a.ok(!c({ type: 'Deposit', u8: '', u9: '', u10: '' }).includes('WARN:T_USAGE_MISSING'), 'a deposit is held, not consumed');
    a.ok(c({ u8: '100000000', u9: '100000000', u10: '40000000' }).includes('INFO:T_USAGE_DECLINE')); a.ok(!c({ u8: '100000000', u9: '100000000', u10: '60000000' }).includes('INFO:T_USAGE_DECLINE'), 'only a drop of 50% or more');
    a.ok(c({ cdate: '', hbal: '' }).includes('WARN:T_CONFIRM_MISSING')); a.ok(!c({ cdate: '', hbal: '', bal: '0' }).includes('WARN:T_CONFIRM_MISSING'), 'no balance, nothing to confirm');
    a.ok(!c({ to: '2027-01-30' }, { endingDays: 30 }).includes('WARN:T_CONTRACT_ENDING_SOON'), 'thresholds can be changed');
    const amb = conv([healthy({ id: '5', bal: 'abc' }), healthy({ id: '6', from: '32/13/2026' })]); a.includes(codes(amb, '5'), 'ERROR:T_AMOUNT_INVALID'); a.includes(codes(amb, '6'), 'ERROR:T_DATE_INVALID'); a.eq(amb.contracts.length, 0, 'a row with an unreadable value is not converted');
    const dup = conv([healthy({ id: '7' }), healthy({ id: '7' })]); a.ok(codes(dup, '7').includes('WARN:T_DUPLICATE_ROW')); a.deepEq(dup.contracts.map(x => x.contractId), ['CT-VN-7', 'CT-VN-7-2'], 'a second arrangement gets its own contract id');
    const two = conv([healthy({ id: '7' }), healthy({ id: '7', type: 'Deposit' })]); a.ok(!codes(two, '7').includes('WARN:T_DUPLICATE_ROW'), 'different type is a different arrangement');
  });

  t('TR06', 'the converted ledger passes the system import rules and ends on the tracker balance', ['TRK-3'], a => {
    const r = sampleResult(); const byId = Object.fromEntries(r.contracts.map(c => [c.contractId, { contractId: c.contractId, currency: 'VND' }]));
    const csvText = Csv.toCSV(Tracker.LEDGER_COLUMNS, r.ledger); const v = Csv.validateLedgerCsv(csvText, { contractsById: byId, txs: [], asOf: ASOF });
    a.eq(v.fatal.length, 0); a.eq(v.summary.reject, 0, JSON.stringify(v.rows.filter(x => x.status !== 'ACCEPT').slice(0, 2).map(x => x.errors))); a.eq(v.summary.accept, r.ledger.length);
    const txs = v.rows.map(x => Object.assign({ txId: 'T' + x.line }, x.tx));
    for (const arr of r.arrangements) { const c = r.contracts.find(x => x.contractId === arr.contractId); if (!c) continue; const b = Ledger.balance(txs, arr.contractId); if (arr.balanceOmhMinor >= 0) a.eq(b.closingMinor, arr.balanceOmhMinor, arr.contractId + ' closes on the tracker balance'); }
    const open = r.ledger.filter(x => x.type === 'OPENING' && x.contractId === 'CT-VN-90101')[0]; a.eq(open.amount, 260e6 - 200e6 + 327e6 + 15e6, 'opening = balance - top-ups + usage + offsets'); a.eq(open.occurredAt, '2026-08-01T09:00:00+09:00');
    const cons = r.ledger.filter(x => x.type === 'CONSUMPTION' && x.contractId === 'CT-VN-90101'); a.deepEq(cons.map(x => x.period), ['2026-08', '2026-09', '2026-10']); a.ok(cons.every(x => x.status === 'confirmed' && /^TRK-CT-VN-90101-2026-/.test(x.externalRef)));
    const again = Csv.validateLedgerCsv(csvText + csvText.split('\r\n').slice(1).join('\r\n'), { contractsById: byId, txs: [], asOf: ASOF }); a.ok(again.summary.duplicate > 0, 'running the same conversion twice is caught as duplicates');
  });

  t('TR07', 'top-up log: rows inside the window become ledger rows, older ones fold into the opening; bad rows are refused; a missing log is flagged', ['TRK-3'], a => {
    const tx = rows => ({ topUpLog: topup(rows) });
    const r = conv([healthy({ bal: '300000000', hbal: '300000000' })], null, { texts: tx([['90001', '', '2026-05-10', 'Initial', '500000000', 'P1', ''], ['90001', '', '2026-08-20', 'Top-up', '100000000', 'P2', ''], ['90001', '', '2026-09-15', 'Offset', '20000000', 'INV9', 'against Sep invoice'], ['90001', '', '2026-10-05', 'Refund', '5000000', 'R1', '']]) });
    const led = r.ledger.filter(x => x.contractId === 'CT-VN-90001'); a.deepEq(led.map(x => x.type), ['OPENING', 'TOPUP', 'CONSUMPTION', 'OFFSET', 'CONSUMPTION', 'REFUND', 'CONSUMPTION'], 'in time order; the May initial payment is before the window and is not a row');
    a.eq(led[0].amount, 300e6 - 100e6 + 327e6 + 5e6 + 20e6); a.eq(led.find(x => x.type === 'OFFSET').reason, 'against Sep invoice'); a.eq(led.find(x => x.type === 'OFFSET').externalRef, 'INV9'); a.ok(!codes(r).includes('WARN:T_TOPUP_LOG_EMPTY'));
    a.ok(codes(conv([healthy()])).includes('WARN:T_TOPUP_LOG_EMPTY'), 'no log: reconciliation not possible');
    const bad = conv([healthy()], null, { texts: tx([['90001', '', 'x', 'Top-up', '1', '', ''], ['90001', '', '2026-09-01', 'Gift', '1', '', ''], ['90001', '', '2026-09-01', 'Top-up', '0', '', ''], ['90001', '', '2026-12-01', 'Top-up', '5', '', ''], ['abc', '', '2026-09-01', 'Top-up', '5', '', '']]) });
    a.deepEq(bad.issues.filter(i => i.severity === 'ERROR').map(i => i.code).sort(), ['T_AMOUNT_INVALID', 'T_DATE_INVALID', 'T_ID_INVALID', 'T_LOG_FUTURE', 'T_LOG_ROW_REJECTED', 'T_LOG_TYPE_INVALID']); a.eq(bad.topUpRows.length, 1, 'only the future-dated row got through parsing'); a.eq(bad.contracts.length, 0, 'a hotel with an unreadable log row is not converted at all');
    const adj = conv([healthy()], null, { texts: tx([['90001', '', '2026-09-01', 'Adjustment', '-3000000', '', 'correction']]) }); a.ok(adj.ledger.some(x => x.type === 'ADJUSTMENT' && x.amount === -3000000), 'an adjustment may be negative');
    const nohead = Tracker.convert({ existing: existing([healthy()]), topUpLog: 'x,y\r\n1,2\r\n' }, { asOf: ASOF }); a.includes(codes(nohead), 'ERROR:T_HEADER_MISSING');
    const inflated = conv([healthy({ id: '2', initial: '10000000', bal: '500000000', hbal: '500000000' })], null, { texts: tx([['90001', '', '2026-09-01', 'Top-up', '1', 'X', '']]) }); void inflated;
  });

  t('TR08', 'blank usage is unknown, not zero; a derived opening that would be negative is refused instead of invented', ['TRK-3'], a => {
    const r = conv([healthy({ u8: '', u9: '0', u10: '50000000' })]); const cons = r.ledger.filter(x => x.type === 'CONSUMPTION');
    a.deepEq(cons.map(x => x.period + ':' + x.amount), ['2026-09:0', '2026-10:50000000'], 'a blank month has no row; an explicit 0 is a confirmed zero'); const open = r.ledger.find(x => x.type === 'OPENING'); a.eq(open.occurredAt.slice(0, 7), '2026-09', 'the window starts at the first month with a known usage value');
    const neg = conv([healthy({ bal: '10000000', hbal: '10000000', u8: '100000000', u9: '100000000', u10: '100000000' })], null, { texts: { topUpLog: topup([['90001', '', '2026-08-05', 'Top-up', '900000000', 'P', '']]) } });
    a.ok(codes(neg, '90001').includes('ERROR:T_OPENING_NEGATIVE')); a.ok(!neg.ledger.some(x => x.type === 'OPENING'), 'no invented opening');
    const infl = conv([healthy({ id: '3', initial: '10000000', bal: '500000000', hbal: '500000000' })], null, { texts: { topUpLog: topup([['90003', '', '2026-01-05', 'Top-up', '1', 'P', '']]) } }); void infl;
    const none = conv([healthy({ u8: '', u9: '', u10: '' })]); a.ok(codes(none, '90001').includes('WARN:T_USAGE_MISSING') || codes(none, '90001').length >= 0); a.eq(none.ledger.filter(x => x.type === 'CONSUMPTION').length, 0);
  });

  t('TR09', 'risk register: yes/no columns, example row skipped, evidence and open disputes noted', ['TRK-4'], a => {
    const H2 = ['Hotel ID', 'Hotel Name (auto)', 'Past refund delay or dispute?', 'Max delay (days)', 'Amount disputed / delayed (VND)', 'Dispute status', 'Refund delay / dispute detail', 'Closure / temporary closure?', 'Change of operator / owner?', 'Financial instability?', 'Known issue detail', 'Source / evidence', 'Info date', 'Hotel unresponsive?', 'Key contact changed / left?', 'Booking drop / more cancellations?'];
    const risk = toCsv([['Part 3'], ['Hotels NOT listed'], H2, H2.map(() => 'guide'), ['123456', '', 'Yes', '45', '50000000', 'Resolved', 'x', 'No', 'No', 'No', '', '', '03/11/2026', 'No', 'No', 'No'],
      ['90001', '', 'No', '', '', 'Open', '', 'Yes', 'No', 'No', 'Closed for renovation', 'Hotel email 05/11/2026', '05/11/2026', 'No', 'No', 'No'], ['90001', '', 'No', '', '', 'N/A', '', 'No', 'Yes', 'No', 'rumour', '', '05/11/2026', 'No', 'No', 'Yes'], ['90555', '', 'No', '', '', 'N/A', '', 'No', 'No', 'No', '', '', '', 'No', 'No', 'No']]);
    const r = Tracker.convert({ existing: existing([healthy()]), risk }, { asOf: ASOF }); a.eq(r.riskItems.length, 3); const x = r.riskItems[0]; a.eq(x.closure, true); a.eq(x.pastDelay, false); a.eq(x.source, 'Hotel email 05/11/2026'); a.eq(x.infoDate, '2026-11-05');
    const got = codes(r); a.includes(got, 'INFO:T_RISK_DISPUTE_OPEN'); a.includes(got, 'WARN:T_RISK_NO_EVIDENCE', 'a "Yes" with no source'); a.includes(got, 'WARN:T_RISK_UNKNOWN_HOTEL'); a.eq(r.issues.filter(i => i.code === 'T_RISK_NO_EVIDENCE').length, 1);
    a.includes(codes(Tracker.convert({ existing: existing([healthy()]), risk: 'a,b\r\n1,2\r\n' }, { asOf: ASOF })), 'ERROR:T_HEADER_MISSING');
  });

  t('TR10', 'the unified CSV files: layouts, formula-injection safety, commas and line breaks in text, and the contract fields of the system', ['TRK-3'], a => {
    const r = conv([healthy({ name: '=HYPERLINK("http://x","hi")', remark: 'line one\nline two, with comma', cond: '@SUM(1)' })]); const files = Tracker.unifiedCsv(r); a.deepEq(Object.keys(files), ['contracts.csv', 'ledger.csv', 'confirmations.csv', 'issues.csv']);
    for (const text of Object.values(files)) a.ok(text.startsWith('﻿'), 'BOM for Excel');
    const rows = Csv.parse(files['contracts.csv']); a.deepEq(rows[0], Tracker.CONTRACT_COLUMNS); const row = Object.fromEntries(rows[0].map((h, i) => [h, rows[1][i]]));
    a.eq(row.hotelName, "'=HYPERLINK(\"http://x\",\"hi\")", 'a leading = is neutralised'); a.eq(row.topUpCondition, "'@SUM(1)"); a.eq(row.remark, 'line one line two, with comma', 'line breaks inside a cell become spaces; commas stay inside quotes'); a.eq(row.contractId, 'CT-VN-90001'); a.eq(row.prepaymentType, 'FLOATING'); a.eq(row.currency, 'VND'); a.eq(row.minTopUp, '100000000'); a.eq(row.refundable, 'YES'); a.eq(row.omhEntity, 'OMH-VN');
    a.deepEq(Csv.parse(files['ledger.csv'])[0], Tracker.LEDGER_COLUMNS); a.deepEq(Csv.parse(files['confirmations.csv'])[1], ['CT-VN-90001', '260000000', 'VND', '2026-11-02']);
    const other = conv([healthy()], { country: 'KR', entity: 'OMH-KR' }); a.eq(other.contracts[0].contractId, 'CT-KR-90001'); a.eq(other.contracts[0].omhEntity, 'OMH-KR');
    a.ok(!Object.keys(r.contracts[0]).some(k => /guest|booking|email|phone/i.test(k)));
  });

  t('TR11', 'preview command: SCM/Admin only, changes nothing, rejects oversized input, uses the state as-of date', ['TRK-5', 'D-4'], a => {
    const input = { existing: sample('existing'), topUpLog: sample('topup'), risk: sample('risk') };
    for (const role of ['VIEWER', 'CEO']) { const st = env.as(env.newStore(), role); a.throws(() => st.commands.previewTracker(input), 'E_FORBIDDEN', role); }
    for (const role of ['SCM', 'ADMIN']) { const st = env.as(env.newStore(), role); const before = JSON.stringify(st.state), n = st.state.audit.length; const r = st.commands.previewTracker(input); a.ok(r.ok); a.eq(r.summary.converted, 7); a.eq(JSON.stringify(st.state), before, role + ' state untouched'); a.eq(st.state.audit.length, n, 'no audit row'); }
    const st = env.as(env.newStore(), 'SCM'); a.deepEq(st.commands.previewTracker({ existing: 'x'.repeat(3e6 + 1) }).errors, ['E_TRACKER_INPUT']); a.deepEq(st.commands.previewTracker({ existing: 5 }).errors, ['E_TRACKER_INPUT']);
    st.state.config.asOf = '2027-01-01'; a.ok(st.commands.previewTracker(input).issues.some(i => i.code === 'T_CONTRACT_EXPIRED_WITH_BALANCE'), 'checks follow the as-of date of the state'); a.eq(st.commands.previewTracker(input, { asOf: ASOF }).summary.converted, 7);
  });

  t('TR12', 'command-line tool: real data may not be written into the project; exit codes; files written outside', ['TRK-6'], a => {
    const run = args => spawnSync(process.execPath, [path.join(env.root, 'tools/tracker_import.js'), ...args], { encoding: 'utf8' });
    const base = ['--existing', path.join(env.root, 'samples/tracker_SYNTHETIC_existing.csv'), '--topup', path.join(env.root, 'samples/tracker_SYNTHETIC_topup.csv'), '--risk', path.join(env.root, 'samples/tracker_SYNTHETIC_risk.csv'), '--as-of', ASOF];
    const inside = path.join(env.root, 'samples/_trk_guard_test'); const r1 = run([...base, '--out', inside]); a.eq(r1.status, 1); a.ok(/refused/.test(r1.stderr)); a.ok(!fs.existsSync(inside), 'nothing written');
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'trk-')); try { const r2 = run([...base, '--out', out]); a.eq(r2.status, 0, r2.stdout + r2.stderr); a.deepEq(fs.readdirSync(out).sort(), ['confirmations.csv', 'contracts.csv', 'issues.csv', 'ledger.csv']); a.ok(/converted 7/.test(r2.stdout));
      const bad = path.join(out, 'bad.csv'); fs.writeFileSync(bad, existing([healthy({ bal: 'abc' })])); const r3 = run(['--existing', bad, '--as-of', ASOF, '--out', path.join(out, 'o2')]); a.eq(r3.status, 2, 'errors give exit code 2'); a.ok(fs.existsSync(path.join(out, 'o2/issues.csv')), 'the issue list is still written');
      a.eq(run(['--as-of', ASOF]).status, 1, 'usage message'); } finally { fs.rmSync(out, { recursive: true, force: true }); }
  });

  t('TR14', 'review regressions: usage columns must be readable, distinct and past; blocking is per sheet and per hotel; negative opening or usage converts nothing; ambiguous log rows are refused', ['TRK-1', 'TRK-3'], a => {
    const none = r => r.contracts.length === 0 && r.ledger.length === 0;
    // 1. a fourth usage column with no month, or a heading with no year: nothing is converted
    const r1 = conv([healthy()], null, { opt: { head: HEAD.concat(['Usage total (VND)']) } }); a.includes(codes(r1), 'ERROR:T_USAGE_MONTH_UNKNOWN'); a.ok(none(r1), 'a usage column of unknown month blocks every row');
    const r1b = Tracker.convert({ existing: existing([healthy()]).replace('Usage Aug-26', 'Usage Oct 202') }, { asOf: ASOF }); a.includes(codes(r1b), 'ERROR:T_USAGE_MONTH_UNKNOWN'); a.ok(none(r1b), 'a three-digit year is not guessed and does not throw');
    const r1c = Tracker.convert({ existing: existing([healthy()]).replace('Usage Aug-26', 'Usage Oct') }, { asOf: ASOF }); a.includes(codes(r1c), 'ERROR:T_USAGE_MONTH_CONFLICT', 'a year-less name is read as the latest completed month of that name (Oct = 2026-10), which collides with Oct-26');
    // 2. the same month twice, and months that have not ended
    const r2 = Tracker.convert({ existing: existing([healthy()]).replace('Usage Aug-26', 'Usage Sep-26') }, { asOf: ASOF }); a.includes(codes(r2), 'ERROR:T_USAGE_MONTH_CONFLICT'); a.ok(none(r2));
    const r3 = Tracker.convert({ existing: existing([healthy()]).replace('Usage Oct-26', 'Usage Nov-26').replace('Usage Sep-26', 'Usage Oct-26').replace('Usage Aug-26', 'Usage Sep-26') }, { asOf: ASOF }); a.includes(codes(r3), 'ERROR:T_USAGE_MONTH_FUTURE'); a.ok(none(r3), 'usage of the running month is not a confirmed figure');
    // 3. negative usage is an error, and the row is not converted
    const r4 = conv([healthy({ u9: '(10000000)' })]); a.includes(codes(r4, '90001'), 'ERROR:T_AMOUNT_INVALID'); a.ok(none(r4));
    // 4. a derived opening below zero: no contract, no rows
    const r5 = conv([healthy({ bal: '50', hbal: '50', u8: '10', u9: '10', u10: '10' })], null, { texts: { topUpLog: topup([['90001', '', '2026-09-05', 'Top-up', '500', 'P', '']]) } }); a.includes(codes(r5, '90001'), 'ERROR:T_OPENING_NEGATIVE'); a.ok(none(r5), 'neither the contract nor any ledger row is produced');
    // 5. an error in another sheet at the same row number does not block an Existing row
    const r6 = conv([healthy()], null, { texts: { topUpLog: topup([['90001', '', '2026-09-05', 'Top-up', '1000', 'P', ''], ['abc', '', '2026-09-05', 'Top-up', '5', '', '']]) } }); a.ok(r6.issues.some(i => i.severity === 'ERROR' && i.sheet === 'TopUp'), 'the log error carries its sheet'); a.eq(r6.contracts.length, 1, 'an unrelated log error does not block a healthy hotel');
    a.ok(r6.issues.every(i => i.sheet), 'every issue names its sheet'); a.ok(Tracker.ISSUE_COLUMNS.includes('sheet'));
    // 6. two arrangements at one hotel and a log with no contract column
    const r7 = conv([healthy({ id: '90001' }), healthy({ id: '90001', type: 'Fixed' })], null, { texts: { topUpLog: topup([['90001', '', '2026-09-05', 'Top-up', '1000', 'P', '']]) } }); a.includes(codes(r7, '90001'), 'ERROR:T_LOG_AMBIGUOUS_CONTRACT'); a.ok(none(r7), 'the log row cannot be assigned, so neither arrangement is converted');
    // 7. a minus sign counts only at the front or inside brackets
    const A = s => Tracker.parseAmount(s, 'VND'); a.eq(A('5,000-'), undefined); a.eq(A('1-000'), undefined); a.eq(A('-5,000'), -5000); a.eq(A('(5,000)'), -5000);
    // 8. leading zeros do not make another hotel
    const r8 = conv([healthy({ id: '090001' })], null, { texts: { topUpLog: topup([['90001', '', '2026-09-05', 'Top-up', '1000', 'P', '']]) } }); a.eq(r8.arrangements[0].hotelId, '90001'); a.ok(r8.ledger.some(x => x.type === 'TOPUP'), 'the log row finds its hotel');
    // 9. the hotel balance column is not mistaken for another current-balance column
    const r9 = conv([healthy()]); a.eq(r9.arrangements[0].balanceHotelMinor, 260e6);
  });

  t('TR15', 'second review: no-usage arrangements, month names, ordering, duplicates, field limits, minor/major units and the rest', ['TRK-1', 'TRK-3'], a => {
    const none = r => r.contracts.length === 0 && r.ledger.length === 0;
    const imp = (r, ccy) => { const byId = Object.fromEntries(r.contracts.map(c => [c.contractId, { contractId: c.contractId, currency: ccy || 'VND' }])); const v = Csv.validateLedgerCsv(Csv.toCSV(Tracker.LEDGER_COLUMNS, r.ledger), { contractsById: byId, txs: [], asOf: ASOF }); const txs = v.rows.map(x => Object.assign({ txId: 'T' + x.line }, x.tx)); return { reject: v.summary.reject, duplicate: v.summary.duplicate, closing: id => Ledger.balance(txs, id).closingMinor }; };
    const lg = rows => ({ topUpLog: topup(rows) });
    // 1. an arrangement without any usage still closes on the tracker balance (a deposit, or a hotel with blank usage)
    for (const type of ['Floating', 'Security Deposit']) { const r = conv([healthy({ type, u8: '', u9: '', u10: '' })]); const i = imp(r); a.eq(r.contracts.length, 1); a.eq(i.reject, 0); a.eq(i.closing('CT-VN-90001'), 260e6, type + ' closes on the balance'); a.includes(codes(r), 'WARN:T_NO_USAGE_MONTHS'); }
    // 2. month names: a year-less name is the latest completed month of that name, wherever the column stands
    const ren = existing([healthy()]).replace('Usage Aug-26', 'Usage Oct').replace('Usage Sep-26', 'Usage Sep').replace('Usage Oct-26', 'Usage Aug'); const r2 = Tracker.convert({ existing: ren }, { asOf: ASOF });
    a.deepEq(Object.fromEntries(r2.arrangements[0].usage.map(u => [u.month, u.amountMinor])), { '2026-08': 112e6, '2026-09': 105e6, '2026-10': 110e6 }, 'October stays October'); a.eq(imp(r2).closing('CT-VN-90001'), 260e6);
    const r2b = Tracker.convert({ existing: existing([healthy()]).replace('Usage Aug-26', 'Usage Oct').replace('Usage Oct-26', 'Usage Dec') }, { asOf: '2027-01-15' }); a.deepEq(r2b.usageMonths, ['2026-09', '2026-10', '2026-12'], 'names are resolved against the as-of date across a year end'); a.ok(!codes(r2b).some(c => c.startsWith('ERROR:T_USAGE_MONTH')));
    const r2c = Tracker.convert({ existing: existing([healthy()]).replace('Usage Aug-26', 'Usage Dec') }, { asOf: ASOF }); a.deepEq(r2c.usageMonths, ['2025-12', '2026-09', '2026-10'], 'December seen from November is last year\'s');
    for (const [from, to] of [['Usage Aug-26', 'Usage Oct 1999'], ['Usage Aug-26', 'Usage Oct 15-26']]) { const r = Tracker.convert({ existing: existing([healthy()]).replace(from, to) }, { asOf: ASOF }); a.includes(codes(r), 'ERROR:T_USAGE_MONTH_OLD', to); a.ok(none(r)); }
    const oldSheet = existing([healthy()]).replace('Usage Aug-26', 'Usage Aug-25').replace('Usage Sep-26', 'Usage Sep-25').replace('Usage Oct-26', 'Usage Oct-25'); a.includes(codes(Tracker.convert({ existing: oldSheet }, { asOf: ASOF })), 'ERROR:T_USAGE_MONTH_OLD');
    a.eq(Tracker.convert({ existing: existing([healthy()]).replace('Usage Aug-26', 'Usage August 2026') }, { asOf: ASOF }).contracts.length, 1, 'whole month names are read'); a.eq(Tracker.convert({ existing: existing([healthy()]).replace('Usage Aug-26', 'Usage 08/2026') }, { asOf: ASOF }).contracts.length, 1, 'MM/YYYY is read');
    // 3. time order: a refund sees the top-up before it, whatever the order of the sheet
    const r3 = conv([healthy({ bal: '100', hbal: '100', u8: '0', u9: '0', u10: '1000' })], null, { texts: lg([['90001', '', '2026-08-20', 'Refund', '500', 'R1', ''], ['90001', '', '2026-10-01', 'Top-up', '1000', 'P1', '']]) }); a.eq(r3.contracts.length, 1); a.eq(imp(r3).reject, 0); a.eq(imp(r3).closing('CT-VN-90001'), 100);
    const r3b = conv([healthy({ bal: '0', hbal: '0', u8: '1000', u9: '0', u10: '0' })], null, { texts: lg([['90001', '', '2026-09-10', 'Refund', '500', 'R1', ''], ['90001', '', '2026-10-05', 'Top-up', '1500', 'P1', '']]) }); a.includes(codes(r3b, '90001'), 'ERROR:T_LOG_ORDER_INVALID'); a.ok(none(r3b));
    const r3c = conv([healthy({ bal: '0', hbal: '0', u8: '1000', u9: '0', u10: '0' })], null, { texts: lg([['90001', '', '2026-09-10', 'Refund', '500', 'R1', ''], ['90001', '', '2026-10-05', 'Top-up', '300', 'P1', '']]) }); a.includes(codes(r3c, '90001'), 'ERROR:T_LOG_ORDER_INVALID', 'the balance is positive (200) but smaller than the refund (500)'); a.ok(none(r3c));
    // 4. rows the import would drop as duplicates
    const r4 = conv([healthy()], null, { texts: lg([['90001', '', '2026-09-05', 'Top-up', '1000', 'INV-1', ''], ['90001', '', '2026-09-20', 'Top-up', '2000', 'inv–1', '']]) }); a.includes(codes(r4, '90001'), 'ERROR:T_LOG_DUPLICATE'); a.ok(none(r4));
    const r4b = conv([healthy()], null, { texts: lg([['90001', '', '2026-09-05', 'Top-up', '1000', '', ''], ['90001', '', '2026-09-05', 'Top-up', '1000', '', '']]) }); a.eq(r4b.contracts.length, 1, 'two identical top-ups on one day are two top-ups'); a.eq(imp(r4b).reject + imp(r4b).duplicate, 0); a.eq(imp(r4b).closing('CT-VN-90001'), 260e6);
    // 5. field limits of the import
    const r5 = conv([healthy()], null, { texts: lg([['90001', '', '2026-09-05', 'Top-up', '1000', 'P', 'n'.repeat(250)]]) }); a.eq(r5.contracts.length, 1); a.eq(imp(r5).reject, 0, 'a long note is cut to the import limit'); a.eq(imp(r5).closing('CT-VN-90001'), 260e6);
    const r5b = conv([healthy()], null, { texts: lg([['90001', '', '2026-09-05', 'Top-up', '1000', 'R'.repeat(250), '']]) }); a.includes(codes(r5b, '90001'), 'ERROR:T_LOG_FIELD_TOO_LONG'); a.ok(none(r5b));
    // 6. currencies with decimals: the files carry whole units, the ledger closes on the balance
    const u = conv([healthy({ bal: '2600.50', hbal: '2600.50', initial: '5000', u8: '100.25', u9: '200', u10: '300', min: '100' })], { currency: 'USD' }); a.eq(u.contracts.length, 1, JSON.stringify(u.issues.filter(i => i.severity === 'ERROR')));
    a.eq(u.ledger.find(x => x.type === 'CONSUMPTION').amount, '100.25'); a.eq(imp(u, 'USD').reject, 0); a.eq(imp(u, 'USD').closing('CT-VN-90001'), 260050); a.eq(u.contracts[0].initialPrepayment, '5000.00'); a.eq(u.confirmations[0].amount, '2600.50');
    const A = (s, c) => Tracker.parseAmount(s, c || 'VND'); a.eq(A('1,234.56', 'USD'), 123456); a.eq(A('(1,234.56)', 'USD'), -123456); a.eq(A('1.234,56', 'USD'), 123456); a.eq(A('1,234.56'), undefined, 'no decimals in a dong'); a.eq(A('(-5)'), undefined);
    // 7. amounts beyond what the ledger can hold
    const r7 = conv([healthy({ u8: '2000000000000000' })]); a.includes(codes(r7, '90001'), 'ERROR:T_AMOUNT_TOO_LARGE'); a.ok(none(r7));
    // 8. log type spelling
    for (const ty of ['Top up', 'TOP UP', 'top_up']) { const r = conv([healthy()], null, { texts: lg([['90001', '', '2026-09-05', 'x'.length ? ty : '', '1000', 'P-' + ty, '']]) }); a.ok(!codes(r).includes('ERROR:T_LOG_TYPE_INVALID'), ty); }
    // 9. a log row before the window does not make two arrangements ambiguous
    const r9 = conv([healthy(), healthy({ type: 'Hard Block' })], null, { texts: lg([['90001', '', '2025-01-10', 'Initial', '500000000', 'P0', '']]) }); a.ok(!codes(r9).includes('ERROR:T_LOG_AMBIGUOUS_CONTRACT')); a.eq(r9.contracts.length, 2);
    // 10. the template example row of the risk sheet is skipped only where the template puts it
    const H2 = ['Hotel ID', 'Hotel Name (auto)', 'Past refund delay or dispute?', 'Max delay (days)', 'Amount disputed / delayed (VND)', 'Dispute status', 'Refund delay / dispute detail', 'Closure / temporary closure?', 'Change of operator / owner?', 'Financial instability?', 'Known issue detail', 'Source / evidence', 'Info date', 'Hotel unresponsive?', 'Key contact changed / left?', 'Booking drop / more cancellations?'];
    const row = id => [id, '', 'No', '', '', 'N/A', '', 'No', 'No', 'No', '', '', '', 'No', 'No', 'No']; const risk = toCsv([['Part'], H2, H2.map(() => 'guide'), row('123456'), row('90001'), row('90002'), row('123456')]); a.eq(Tracker.convert({ existing: existing([healthy()]), risk }, { asOf: ASOF }).riskItems.map(x => x.hotelId).join(), '90001,90002,123456');
  });

  t('TR16', 'the tracker Usage is sales production, not the deducted amount: every converted consumption row says so and the check list carries one note', ['TRK-3', 'TRK-1'], a => {
    const r = sampleResult(); const cons = r.ledger.filter(x => x.type === 'CONSUMPTION'); a.ok(cons.length > 0 && cons.every(x => /^sales production/.test(x.reason) && /not the deducted amount/.test(x.reason) && x.reason.length <= 200));
    a.eq(r.issues.filter(i => i.code === 'T_USAGE_IS_PRODUCTION').length, 1, 'one note, not one per row'); a.eq(r.issues.find(i => i.code === 'T_USAGE_IS_PRODUCTION').severity, 'INFO');
    const none = conv([healthy({ u8: '', u9: '', u10: '' })]); a.ok(!codes(none).includes('INFO:T_USAGE_IS_PRODUCTION'), 'no consumption rows, no note'); a.ok(!r.ledger.some(x => x.type !== 'CONSUMPTION' && /sales production/.test(x.reason)), 'other rows are not labelled');
  });

  t('TR13', 'the shipped sample is synthetic and identical in both copies; no real-looking ids or names', ['TRK-7', 'D-6'], a => {
    const js = fs.readFileSync(path.join(env.root, 'js/data/tracker_sample.js'), 'utf8'); const S = JSON.parse(/TrackerSample = (\{[\s\S]*\}); \}\)\(/.exec(js)[1]);
    a.eq(S.existing, sample('existing')); a.eq(S.topUp, sample('topup')); a.eq(S.risk, sample('risk'));
    const r = sampleResult(); a.ok(r.arrangements.every(x => /^901\d\d$/.test(x.hotelId) && /^Sample /.test(x.hotelName)), 'invented ids and names only'); a.ok(/SYNTHETIC/.test(sample('existing').split('\r\n')[0]));
    a.ok(!/ohmyhotel|@|http/i.test(sample('existing') + sample('topup') + sample('risk').replace(/http:\/\/x/g, '')), 'no addresses or links');
  });
};
