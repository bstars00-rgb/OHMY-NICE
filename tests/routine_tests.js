'use strict';
// Regular management (정기 관리) of the CEO standard: the six settlement steps, the monthly close on the first business day, settlement lag, the two-month balance letter, the reminder list.
const env = require('./helpers/env');
const { Routine, Config, Store } = env;

module.exports = function register(h) {
  const { test: t } = h; const cfg = Config.defaults(); const fresh = role => env.as(env.newStore(), role || 'SCM');

  t('RT01', 'Business days and the close date: the first Monday-to-Friday of a month, the close of a month falls on the first business day after it, across year ends', ['SET-1'], a => {
    a.eq(Routine.firstBusinessDay('2026-11'), '2026-11-02'); a.eq(Routine.firstBusinessDay('2026-08'), '2026-08-03', '1 Aug 2026 is a Saturday'); a.eq(Routine.firstBusinessDay('2026-02'), '2026-02-02', '1 Feb 2026 is a Sunday'); a.eq(Routine.firstBusinessDay('2026-12'), '2026-12-01'); a.eq(Routine.firstBusinessDay('2027-05'), '2027-05-03');
    a.eq(Routine.closeDate('2026-10'), '2026-11-02'); a.eq(Routine.closeDate('2026-12'), '2027-01-01', 'across the year end'); a.eq(Routine.closeDate('2026-07'), '2026-08-03');
    a.eq(Routine.lastMonthOf('2026-11-06'), '2026-10'); a.eq(Routine.lastMonthOf('2027-01-05'), '2026-12'); a.eq(Routine.monthEnd('2026-02'), '2026-02-28'); a.eq(Routine.monthEnd('2028-02'), '2028-02-29');
    a.eq(Routine.STEPS.length, 6); a.deepEq(Routine.STEPS.map(s => s.owner), ['SCM', 'SCM', 'SUPPORT', 'SUPPORT', 'SCM', 'SUPPORT'], 'who does which step (CEO standard)'); for (const s of Routine.STEPS) a.ok(s.name.ko && s.name.en);
  });

  t('RT02', 'Settlement lag: the last month with usage is before last month; no usage yet is not a lag; zero usage does not count', ['SET-2'], a => {
    const lag = (by, asOf) => Routine.lag(by, asOf || '2026-11-06');
    a.eq(lag({ '2026-10': 5 }).lagging, false); a.eq(lag({ '2026-09': 5, '2026-10': 0 }).lagging, true, 'a month with zero usage is not usage'); const l1 = lag({ '2026-09': 5 }); a.eq(l1.monthsBehind, 1); a.eq(l1.lastConsMonth, '2026-09'); a.eq(lag({ '2026-07': 5 }).monthsBehind, 3);
    a.deepEq(lag({}), { lagging: false, lastConsMonth: null, monthsBehind: 0 }); a.eq(lag({ '2026-11': 5 }).lagging, false, 'usage already in the current month'); const y = lag({ '2026-11': 1 }, '2027-01-10'); a.eq(y.lagging, true); a.eq(y.monthsBehind, 1, 'across the year end');
  });

  t('RT03', 'Hotel balance letter unanswered for two months: an old letter or none at all stops top-ups; no balance, no stop', ['SET-3'], a => {
    const od = (recon, start, bal, asOf) => Routine.letterOverdue(recon, start, bal, asOf || '2026-11-06', cfg); const m = d => ({ status: 'MATCH', confirmedAt: d });
    a.eq(od(m('2026-09-05'), '2025-01-01', true), false, '62 days'); a.eq(od(m('2026-09-04'), '2025-01-01', true), true, '63 days'); a.eq(od(m('2026-11-01'), '2025-01-01', true), false);
    a.eq(od({ status: 'UNCONFIRMED', confirmedAt: null }, '2026-09-05', true), false, 'started 62 days ago, no letter yet'); a.eq(od({ status: 'UNCONFIRMED', confirmedAt: null }, '2026-09-04', true), true, 'started 63 days ago, never answered'); a.eq(od(null, '2026-01-01', true), true);
    a.eq(od(m('2026-01-01'), '2025-01-01', false), false, 'no balance, nothing to confirm'); a.eq(od(null, null, true), false, 'no start date and no letter: nothing to measure from');
  });

  t('RT04', 'The six steps of one month: each step follows the one before it, a difference sends the month to the hotel check, and the month counts as settled only with steps 1-4 done', ['SET-4'], a => {
    const inv = { no: 'INV-1', receivedAt: '2026-11-02', amountMinor: 100 }; const st = (rec, cons, recon, closed) => Routine.steps({ rec, consMinor: cons, recon: recon || { status: 'UNCONFIRMED', confirmedAt: null }, period: '2026-10', closed: closed || null });
    const s0 = st(null, 0); a.deepEq(s0.map(x => x.status), ['OPEN', 'WAIT', 'WAIT', 'WAIT', 'NA', 'WAIT']); a.ok(!Routine.settled(s0));
    const s1 = st({ invoice: inv }, 0); a.deepEq(s1.map(x => x.status), ['DONE', 'OPEN', 'WAIT', 'WAIT', 'NA', 'WAIT']); a.eq(s1[0].detail.no, 'INV-1');
    const s2 = st({ invoice: inv, ellis: { result: 'MATCH' } }, 0); a.deepEq(s2.map(x => x.status), ['DONE', 'DONE', 'OPEN', 'WAIT', 'NA', 'WAIT']);
    const s3 = st({ invoice: inv, ellis: { result: 'MATCH' }, settled: { settledAt: '2026-11-04' } }, 0); a.deepEq(s3.map(x => x.status), ['DONE', 'DONE', 'DONE', 'OPEN', 'NA', 'WAIT'], 'the ledger still has to be updated'); a.ok(!Routine.settled(s3));
    const s4 = st({ invoice: inv, ellis: { result: 'MATCH' }, settled: { settledAt: '2026-11-04' } }, 100); a.deepEq(s4.map(x => x.status), ['DONE', 'DONE', 'DONE', 'DONE', 'NA', 'WAIT']); a.ok(Routine.settled(s4)); a.eq(s4[3].detail.same, true);
    const s5 = st({ invoice: inv, ellis: { result: 'MATCH' }, settled: { settledAt: '2026-11-04' } }, 90); a.eq(s5[3].detail.same, false); a.eq(s5[4].status, 'ATTN', 'invoice and ledger differ: ask the hotel'); a.ok(!Routine.settled(s5));
    const s6 = st({ invoice: inv, ellis: { result: 'MATCH' }, settled: { settledAt: '2026-11-04' } }, 90, { status: 'MATCH', confirmedAt: '2026-10-31' }); a.eq(s6[4].status, 'DONE', 'a matching letter dated at the month end clears the difference'); a.ok(Routine.settled(s6));
    a.eq(st({ invoice: inv, ellis: { result: 'MATCH' }, settled: { settledAt: '2026-11-04' } }, 90, { status: 'MATCH', confirmedAt: '2026-10-30' })[4].status, 'ATTN', 'a letter from before the month end does not count');
    const d = st({ invoice: inv, ellis: { result: 'DIFF', note: 'x' } }, 0); a.eq(d[1].status, 'ATTN'); a.eq(d[2].status, 'WAIT', 'a difference does not settle'); a.eq(d[4].status, 'ATTN');
    const c = st({ invoice: inv, ellis: { result: 'MATCH' }, settled: { settledAt: '2026-11-04' } }, 100, null, { closedAt: '2026-11-02', closedBy: 'x' }); a.eq(c[5].status, 'DONE');
  });

  t('RT05', 'Reminder list: who is told what, per the CEO table; contracts without a routine have none', ['SET-5'], a => {
    const base = { off: false, hasBalance: true, lag: { lagging: false }, letterOverdue: false, daysToEnd: 300, expiryNoticeDays: 60, signals: { color: 'ok', sig: {}, reasons: [] }, holds: [], riskFlags: [], notes: [] };
    const codes = o => Routine.reminders(Object.assign({}, base, o)).map(r => r.code); const to = (o, c) => Routine.reminders(Object.assign({}, base, o)).find(r => r.code === c).to;
    a.deepEq(codes({}), []); a.deepEq(codes({ off: true, letterOverdue: true }), []);
    a.deepEq(codes({ signals: { color: 'bad', sig: {}, reasons: [] } }), ['SIGNAL_RED']); a.deepEq(to({ signals: { color: 'bad', sig: {}, reasons: [] } }, 'SIGNAL_RED'), ['CEO', 'SCM', 'SUPPORT']); a.deepEq(codes({ signals: { color: 'warn', sig: {}, reasons: [] } }), ['SIGNAL_YELLOW']);
    a.deepEq(codes({ signals: { color: 'warn', sig: { S1: { c: 'warn' } }, reasons: [] } }), ['SIGNAL_YELLOW', 'SLOW_USAGE']); a.deepEq(to({ signals: { color: 'ok', sig: { S1: { c: 'bad' } }, reasons: [] } }, 'SLOW_USAGE'), ['SCM', 'CEO']); a.deepEq(codes({ notes: ['YEAR_END_UNUSED'] }), ['SLOW_USAGE']);
    a.deepEq(codes({ lag: { lagging: true } }), ['SETTLEMENT_LAG']); a.deepEq(to({ lag: { lagging: true } }, 'SETTLEMENT_LAG'), ['SUPPORT']); a.deepEq(codes({ holds: ['OVER_HOTEL_MAX'] }), ['OVER_HOTEL_MAX']); a.deepEq(to({ holds: ['OVER_HOTEL_MAX'] }, 'OVER_HOTEL_MAX'), ['SCM', 'SUPPORT']);
    a.deepEq(codes({ riskFlags: ['C3'] }), ['DROP_OR_CLOSURE']); a.deepEq(codes({ riskFlags: ['C2'] }), ['DROP_OR_CLOSURE']); a.deepEq(codes({ riskFlags: ['C1'] }), [], 'only C2 and C3 are in this row'); a.deepEq(to({ signals: { color: 'bad', sig: {}, reasons: ['GRADE_DROP_2'] } }, 'DROP_OR_CLOSURE'), ['CEO']);
    a.deepEq(codes({ letterOverdue: true }), ['LETTER_OVERDUE']); a.deepEq(to({ letterOverdue: true }, 'LETTER_OVERDUE'), ['SUPPORT']);
    a.deepEq(codes({ daysToEnd: 60 }), ['EXPIRY_SOON']); a.deepEq(codes({ daysToEnd: 61 }), []); a.deepEq(codes({ daysToEnd: 0 }), ['EXPIRY_SOON']); a.deepEq(codes({ daysToEnd: -1 }), [], 'already ended'); a.deepEq(to({ daysToEnd: 10 }, 'EXPIRY_SOON'), ['SCM', 'CEO']);
    for (const k of Object.keys(Routine.ACTIONS)) a.ok(Routine.ACTIONS[k].ko && Routine.ACTIONS[k].en && Routine.CONDITIONS[k].ko && Routine.CONDITIONS[k].en, k);
  });

  t('RT06', 'Routine in the model: the sample settlements show their steps, deposits and buyouts have no routine, an overdue balance letter holds top-ups, and the reminder list reaches the contract view', ['SET-4', 'SET-3', 'SET-5'], a => {
    const m = fresh('SCM').model(); const v = id => m.byContract[id];
    a.eq(v('CT-KR-001').routine.period, '2026-10'); a.deepEq(v('CT-KR-001').routine.steps.map(x => x.status), ['DONE', 'DONE', 'DONE', 'DONE', 'NA', 'WAIT']); a.ok(v('CT-KR-001').routine.settled);
    a.deepEq(v('CT-KR-002').routine.steps.slice(0, 3).map(x => x.status), ['DONE', 'OPEN', 'WAIT']); a.ok(!v('CT-KR-002').routine.settled); a.eq(v('CT-JP-001').routine.steps[1].status, 'ATTN'); a.eq(v('CT-JP-001').routine.steps[1].detail.result, 'DIFF');
    for (const id of ['CT-VN-003', 'CT-JP-008', 'CT-JP-005']) { a.eq(v(id).routine.applicable, false, id); a.deepEq(v(id).routine.steps, [], id); a.deepEq(v(id).routine.reminders, [], id); }
    a.eq(v('CT-KR-001').routine.closeDate, '2026-11-02'); for (const x of m.views) { a.ok(x.routine && Array.isArray(x.routine.reminders), x.contractId); a.ok(x.consByMonth && typeof x.consByMonth === 'object', x.contractId); }
    const over = m.views.filter(x => x.limit.holdReasons.includes('BALANCE_LETTER_OVERDUE')); a.ok(over.length > 0 && over.every(x => x.routine.letterOverdue && x.limit.availableTopupMinor === 0), 'overdue letter: hold, nothing available'); a.ok(over.every(x => x.routine.reminders.some(r => r.code === 'LETTER_OVERDUE')));
    for (const x of m.views.filter(y => y.routine.letterOverdue)) a.ok(x.limit.topupHold, x.contractId);
    const k = v('CT-KR-004'); a.ok(!k.limit.holdReasons.includes('BALANCE_LETTER_OVERDUE'), 'a recent letter');
  });

  t('RT07', 'Settlement commands: step 1 and 2 by the SCM, step 3 and the close by finance support, steps in order, checked inputs, history, locked once settled, and the ledger never changes', ['SET-4', 'SET-6', 'D-4'], a => {
    const st = fresh('SCM'); const c = st.commands; const ledger = JSON.stringify(st.state.ledger); const rec = () => (st.state.settlements['CT-KR-004'] || {})['2026-10']; const inv = o => Object.assign({ no: 'INV-9', receivedAt: '2026-11-02', amountMinor: 9766666 }, o || {});
    a.eq(c.recordInvoice('NOPE', '2026-10', inv()).errors[0], 'E_CONTRACT_UNKNOWN'); a.eq(c.recordInvoice('CT-KR-004', '2026-13', inv()).errors[0], 'E_MONTH_INVALID'); a.eq(c.recordInvoice('CT-KR-004', '2026-11', inv()).errors[0], 'E_PERIOD_FUTURE', 'November is not over'); a.eq(c.recordInvoice('CT-VN-003', '2026-10', inv()).errors[0], 'E_SETTLE_NOT_APPLICABLE');
    a.eq(c.recordInvoice('CT-KR-004', '2026-10', inv({ no: '' })).errors[0], 'E_INVOICE_NO'); a.eq(c.recordInvoice('CT-KR-004', '2026-10', inv({ no: 'x'.repeat(41) })).errors[0], 'E_INVOICE_NO'); a.eq(c.recordInvoice('CT-KR-004', '2026-10', inv({ receivedAt: '2026-11-07' })).errors[0], 'E_INVOICE_DATE', 'after the as-of date'); a.eq(c.recordInvoice('CT-KR-004', '2026-10', inv({ receivedAt: '2026-09-30' })).errors[0], 'E_INVOICE_DATE', 'before the month starts');
    a.eq(c.recordInvoice('CT-KR-004', '2026-10', inv({ amountMinor: 0 })).errors[0], 'E_AMOUNT_INVALID'); a.eq(c.recordInvoice('CT-KR-004', '2026-10', inv({ amountMinor: 1.5 })).errors[0], 'E_AMOUNT_INVALID'); a.ok(!rec(), 'nothing stored by a rejected try');
    a.eq(c.recordEllisCheck('CT-KR-004', '2026-10', { result: 'MATCH' }).errors[0], 'E_STEP_ORDER', 'invoice first'); a.ok(!rec(), 'a rejected step does not leave an empty record');
    a.ok(c.recordInvoice('CT-KR-004', '2026-10', inv()).ok); a.eq(rec().invoice.no, 'INV-9'); a.eq(rec().invoice.by, 'test.scm');
    a.eq(c.recordEllisCheck('CT-KR-004', '2026-10', { result: 'MAYBE' }).errors[0], 'E_SETTLE_RESULT'); a.eq(c.recordEllisCheck('CT-KR-004', '2026-10', { result: 'DIFF', note: '' }).errors[0], 'E_DIFF_NOTE_REQUIRED'); a.eq(c.recordEllisCheck('CT-KR-004', '2026-10', { result: 'MATCH', ellisMinor: -1 }).errors[0], 'E_AMOUNT_INVALID');
    a.throws(() => c.recordSettlement('CT-KR-004', '2026-10', '2026-11-04'), 'E_FORBIDDEN', 'the SCM does not settle');
    a.ok(c.recordEllisCheck('CT-KR-004', '2026-10', { result: 'DIFF', note: 'nights differ' }).ok); env.as(st, 'SUPPORT'); a.eq(c.recordSettlement('CT-KR-004', '2026-10', '2026-11-04').errors[0], 'E_STEP_ORDER', 'a difference cannot be settled');
    env.as(st, 'SCM'); a.ok(c.recordInvoice('CT-KR-004', '2026-10', inv({ no: 'INV-9B' })).ok); a.eq(rec().history.length, 1, 'the earlier invoice stays in the history'); a.eq(rec().ellis, null, 'a new invoice needs a new comparison');
    a.ok(c.recordEllisCheck('CT-KR-004', '2026-10', { result: 'MATCH', ellisMinor: 9766666 }).ok); env.as(st, 'SUPPORT'); a.eq(c.recordSettlement('CT-KR-004', '2026-10', '2026-09-30').errors[0], 'E_INVOICE_DATE'); a.ok(c.recordSettlement('CT-KR-004', '2026-10', '2026-11-04').ok); a.eq(rec().settled.by, 'test.support');
    a.eq(c.recordInvoice('CT-KR-004', '2026-10', inv({ no: 'LATE' })).errors[0], 'E_SETTLED_LOCKED'); a.eq(c.recordEllisCheck('CT-KR-004', '2026-10', { result: 'MATCH' }).errors[0], 'E_SETTLED_LOCKED');
    for (const role of ['VIEWER', 'CEO']) { env.as(st, role); a.throws(() => c.recordInvoice('CT-KR-004', '2026-09', inv({ receivedAt: '2026-10-02' })), 'E_FORBIDDEN', role); a.throws(() => c.closeMonth('2026-10'), 'E_FORBIDDEN', role); }
    a.eq(JSON.stringify(st.state.ledger), ledger, 'settlement records never write the ledger'); const au = st.state.audit.filter(e => /^SETTLE_/.test(e.action)); a.ok(au.some(e => e.outcome === 'OK') && au.some(e => e.outcome === 'REJECTED') && au.some(e => e.outcome === 'DENIED'));
  });

  t('RT08', 'Monthly close: from the first business day, once per month, never for a month that is not over, it lists what was still open, and a close or a settlement edited by hand is caught on load', ['SET-6', 'D-3', 'D-5'], a => {
    const stg = Store.memoryStorage(); const st = env.as(env.newStore({ storage: stg }), 'SUPPORT'); const c = st.commands;
    a.eq(c.closeMonth('2026-13').errors[0], 'E_MONTH_INVALID'); a.eq(c.closeMonth('2026-11').errors[0], 'E_PERIOD_FUTURE'); a.eq(c.closeMonth('2027-01').errors[0], 'E_PERIOD_FUTURE');
    const early = env.as(env.newStore(), 'SUPPORT'); early.state.config.asOf = '2026-11-01'; a.eq(early.commands.closeMonth('2026-10').errors[0], 'E_CLOSE_TOO_EARLY', 'Sunday 1 November: the first business day is the 2nd'); early.state.config.asOf = '2026-11-02'; a.ok(early.commands.closeMonth('2026-10').ok, 'the first business day itself');
    const r = c.closeMonth('2026-10'); a.ok(r.ok); const cl = st.state.monthCloses['2026-10']; a.eq(cl.closedBy, 'test.support'); a.eq(cl.closedAt, '2026-11-06'); a.ok(cl.settledCount >= 1 && cl.openContracts.length > 0 && !cl.openContracts.includes('CT-KR-001') && cl.openContracts.includes('CT-KR-002'), 'KR-001 is settled, KR-002 is still open');
    a.ok(!cl.openContracts.some(id => ['CT-VN-003', 'CT-JP-008', 'CT-JP-005'].includes(id)), 'deposits and buyouts are not counted'); a.eq(c.closeMonth('2026-10').errors[0], 'E_MONTH_CLOSED'); const v = st.model().byContract['CT-KR-001']; a.eq(v.routine.steps[5].status, 'DONE'); a.eq(st.model().byContract['CT-KR-002'].routine.steps[5].status, 'DONE', 'the close is recorded for the month');
    env.as(st, 'SCM'); a.eq(c.recordInvoice('CT-KR-004', '2026-10', { no: 'I', receivedAt: '2026-11-02', amountMinor: 5 }).errors[0], 'E_MONTH_CLOSED', 'a closed month takes no more records'); env.as(st, 'SUPPORT'); a.throws(() => env.as(st, 'SCM').commands.closeMonth('2026-09'), 'E_FORBIDDEN');
    const back = env.newStore({ storage: stg }); a.eq(back.loadStatus, 'OK'); a.deepEq(back.state.monthCloses, st.state.monthCloses, 'identical after a reload');
    const raw = JSON.parse(stg.getItem('omh_hfr_v1')); const load = mut => { const s = env.clone(raw); mut(s); const g = Store.memoryStorage(); g.setItem('omh_hfr_v1', JSON.stringify(s)); return env.newStore({ storage: g }).loadStatus; };
    a.eq(load(() => {}), 'OK'); a.eq(load(s => { s.monthCloses['2026-10'].closedBy = 'someone.else'; }), 'AUDIT_BROKEN', 'a close edited by hand'); a.eq(load(s => { s.monthCloses['2026-09'] = { closedAt: '2026-10-01', closedBy: 'x', settledCount: 0, openContracts: [] }; }), 'AUDIT_BROKEN', 'a close without its audit entry');
    a.eq(load(s => { s.settlements['CT-KR-001']['2026-10'].invoice.amountMinor = 1; }), 'AUDIT_BROKEN', 'a settlement edited by hand'); a.eq(load(s => { delete s.settlements['CT-KR-002']; }), 'AUDIT_BROKEN', 'a settlement removed');
  });

  t('RT10', 'A month close forged together with the state hash, the audit chain and the anchor is still caught: the close has no audit entry of its own', ['SET-6', 'D-3'], a => {
    const stg = Store.memoryStorage(); const st = env.as(env.newStore({ storage: stg }), 'SUPPORT'); a.ok(st.commands.closeMonth('2026-10').ok); const blob = JSON.parse(stg.getItem(Store.DEFAULT_KEY));
    blob.monthCloses['2026-09'] = { closedAt: '2026-10-01', closedBy: 'forger', settledCount: 0, openContracts: [] };
    const parts = [blob.ledger, blob.hotels, blob.contracts, blob.ratings, blob.confirmations, blob.config, blob.sales, blob.reviews || {}, blob.settlements || {}, blob.monthCloses]; const last = blob.audit[blob.audit.length - 1]; a.eq(last.action, 'MONTH_CLOSE');
    last.detail.coreHash = env.Adapters.hash53(JSON.stringify(parts)); last.hash = env.Adapters.hash53(last.prevHash + JSON.stringify([last.seq, last.at, last.actor, last.role, last.action, last.entity, last.outcome, last.detail]));
    const g = Store.memoryStorage(); g.setItem(Store.DEFAULT_KEY, JSON.stringify(blob)); g.setItem(Store.DEFAULT_KEY + '.anchor', JSON.stringify({ seq: last.seq, hash: last.hash })); a.eq(env.newStore({ storage: g }).loadStatus, 'AUDIT_BROKEN', 'a close without its own audit entry');
  });

  t('RT09', 'Settings of the routine are checked: the letter limit and the expiry notice have ranges', ['CFG-1', 'SET-3'], a => {
    const bad = mut => { const c2 = env.clone(cfg); mut(c2.review.routine); return Config.validate(c2); };
    a.deepEq(cfg.review.routine, { letterOverdueDays: 62, expiryNoticeDays: 60 }); a.deepEq(Config.validate(cfg), []); a.ok(bad(r => { r.letterOverdueDays = 10; }).some(e => /routine/.test(e))); a.ok(bad(r => { r.letterOverdueDays = 201; }).some(e => /routine/.test(e))); a.ok(bad(r => { r.letterOverdueDays = 62.5; }).some(e => /routine/.test(e)));
    a.ok(bad(r => { r.expiryNoticeDays = 0; }).some(e => /routine/.test(e))); a.ok(bad(r => { r.expiryNoticeDays = 366; }).some(e => /routine/.test(e))); a.ok(Config.validate(Object.assign(env.clone(cfg), { review: Object.assign(env.clone(cfg.review), { routine: null }) })).some(e => /routine/.test(e)));
  });
};
