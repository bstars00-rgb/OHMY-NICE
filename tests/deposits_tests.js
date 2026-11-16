'use strict';
// Deposit ledger (보증금 원장): the figures of a deposit, the holding time, the refund request and how it is closed. Deposits and buyouts are held, not consumed.
const env = require('./helpers/env');
const { Deposits, Config } = env;

module.exports = function register(h) {
  const { test: t } = h; const cfg = Config.defaults(); const fresh = role => env.as(env.newStore(), role || 'SCM');

  t('DP01', 'Holding time: whole years and calendar months between two dates; an earlier day of the month does not count a month; no date or a future date gives nothing', ['DEP-1'], a => {
    const s = Deposits.span; a.deepEq(s('2018-06-01', '2026-11-06'), { days: 3080, years: 8, months: 101 }); a.eq(s('2026-03-01', '2026-11-06').months, 8); a.eq(s('2026-03-01', '2026-11-06').years, 0);
    a.eq(s('2026-01-31', '2026-02-28').months, 0, '28 < 31: the month is not complete'); a.eq(s('2026-01-15', '2026-02-15').months, 1); a.eq(s('2021-11-07', '2026-11-06').years, 5, '1825 days'); a.eq(s('2021-11-08', '2026-11-06').years, 4, '1824 days: one day short of five years of 365 days');
    a.deepEq(s(null, '2026-11-06'), { days: null, years: null, months: null }); a.deepEq(s('2027-01-01', '2026-11-06'), { days: null, years: null, months: null }); a.eq(s('2026-11-06', '2026-11-06').days, 0);
    a.ok(Deposits.applicable({ prepaymentType: 'SECURITY_DEPOSIT' }) && Deposits.applicable({ prepaymentType: 'BUYOUT' }) && !Deposits.applicable({ prepaymentType: 'FLOATING' }) && !Deposits.applicable({ prepaymentType: 'HARD_BLOCK_ADV' }));
  });

  t('DP02', 'Figures of a deposit: placed, refunded, balance, a timeline with a running balance, long-held at five years, the hotel letter; totals per currency are never added across currencies', ['DEP-1', 'DEP-2'], a => {
    const m = fresh('SCM').model(); const j = m.byContract['CT-JP-008'].deposit, v = m.byContract['CT-VN-003'].deposit, b = m.byContract['CT-JP-005'].deposit;
    a.eq(j.placedMinor, 10e6); a.eq(j.refundedMinor, 0); a.eq(j.balanceMinor, 10e6); a.eq(j.firstDepositAt, '2018-06-01', 'held since the contract start, not since the opening row was entered'); a.eq(j.heldYears, 8); a.ok(j.longHeld); a.eq(j.longHeldYears, 5); a.eq(j.letter.confirmedAt, null); a.eq(j.refund.status, 'NONE');
    a.ok(!v.longHeld && v.heldYears === 0 && v.letter.confirmedAt === '2026-09-15' && v.letter.ageDays === 52, 'a new deposit with a recent letter'); a.eq(b.timeline.length, 4); let run = 0; for (const r of b.timeline) { run += r.deltaMinor; a.eq(r.runningMinor, run, 'running balance'); } a.eq(b.timeline[b.timeline.length - 1].runningMinor, b.balanceMinor, 'the book ends at the balance');
    for (const x of m.views) a.eq(!!x.deposit, ['SECURITY_DEPOSIT', 'BUYOUT'].includes(x.contract.prepaymentType), x.contractId);
    const tot = Deposits.totals(m.views.filter(x => x.deposit).map(x => ({ currency: x.currency, s: x.deposit }))); const lh = (start) => Deposits.summarize({ contract: { contractId: 'X', startDate: start, refund: {} }, rows: [{ contractId: 'X', type: 'OPENING', amountMinor: 100, occurredAt: start + 'T00:00:00+09:00', txId: 'a' }], asOf: '2026-11-06', cfg, recon: null }).longHeld; a.eq(lh('2021-11-07'), true, 'exactly 1825 days'); a.eq(lh('2021-11-08'), false, '1824 days'); a.deepEq(Object.keys(tot).sort(), ['JPY', 'VND']); a.eq(tot.JPY.count, 2); a.eq(tot.JPY.balanceMinor, 10e6 + b.balanceMinor); a.eq(tot.VND.balanceMinor, 500e6); a.eq(tot.JPY.placedMinor, tot.JPY.balanceMinor + tot.JPY.refundedMinor);
    const mix = Deposits.totals([{ currency: 'JPY', s: { placedMinor: 100, refundedMinor: 40, balanceMinor: 60 } }, { currency: 'JPY', s: { placedMinor: 50, refundedMinor: 0, balanceMinor: 50 } }, { currency: 'KRW', s: { placedMinor: 7, refundedMinor: 7, balanceMinor: 0 } }]); a.deepEq(mix.JPY, { placedMinor: 150, refundedMinor: 40, balanceMinor: 110, count: 2 }); a.deepEq(mix.KRW, { placedMinor: 7, refundedMinor: 7, balanceMinor: 0, count: 1 }); const gone = Deposits.summarize({ contract: { contractId: 'X', startDate: '2018-01-01', refund: {} }, rows: [{ contractId: 'X', type: 'OPENING', amountMinor: 100, occurredAt: '2018-01-01T00:00:00+09:00', txId: 'a' }, { contractId: 'X', type: 'REFUND', amountMinor: 100, occurredAt: '2026-01-01T00:00:00+09:00', txId: 'b' }], asOf: '2026-11-06', cfg, recon: null }); a.eq(gone.balanceMinor, 0); a.ok(!gone.longHeld, 'nothing is left, so nothing is held'); a.eq(gone.refundedMinor, 100); a.eq(gone.letter.ageDays, null);
  });

  t('DP03', 'Refund request status: none, requested, overdue and received', ['DEP-3'], a => {
    const st = (rf) => Deposits.summarize({ contract: { contractId: 'X', startDate: '2026-01-01', refund: {} }, rows: [], asOf: '2026-11-06', cfg, recon: null, refund: rf }).refund.status;
    a.eq(st(undefined), 'NONE'); a.eq(st({ requested: false }), 'NONE'); a.eq(st({ requested: true, outstandingMinor: 5, overdue: false }), 'REQUESTED'); a.eq(st({ requested: true, outstandingMinor: 5, overdue: true }), 'OVERDUE'); a.eq(st({ requested: true, outstandingMinor: 0, overdue: false }), 'DONE', 'received in full');
  });

  t('DP04', 'Refund request commands: amount and dates are checked, one open request at a time, never above the balance, a closing reason is required, the history keeps both, the ledger is not touched', ['DEP-3', 'D-4'], a => {
    const st = fresh('SCM'); const c = st.commands; const ledger = JSON.stringify(st.state.ledger); const v = () => st.model().byContract['CT-JP-008']; const req = o => Object.assign({ amountMinor: 4e6, requestedAt: '2026-11-02', dueDate: '2026-12-02', note: 'asked by mail' }, o || {});
    a.eq(c.recordRefundRequest('NOPE', req()).errors[0], 'E_CONTRACT_UNKNOWN'); a.eq(c.recordRefundRequest('CT-JP-008', req({ amountMinor: 0 })).errors[0], 'E_AMOUNT_INVALID'); a.eq(c.recordRefundRequest('CT-JP-008', req({ amountMinor: 1.5 })).errors[0], 'E_AMOUNT_INVALID');
    a.eq(c.recordRefundRequest('CT-JP-008', req({ requestedAt: '2026-11-07' })).errors[0], 'E_REFUND_DATES', 'asked after the as-of date'); a.eq(c.recordRefundRequest('CT-JP-008', req({ dueDate: '2026-11-01' })).errors[0], 'E_REFUND_DATES', 'due before it was asked'); a.eq(c.recordRefundRequest('CT-JP-008', req({ requestedAt: '2026-13-01' })).errors[0], 'E_REFUND_DATES');
    a.eq(c.recordRefundRequest('CT-JP-008', req({ amountMinor: 10e6 + 1 })).errors[0], 'E_REFUND_EXCEEDS_BALANCE'); a.eq(v().deposit.refund.status, 'NONE', 'rejected tries leave nothing');
    a.ok(c.recordRefundRequest('CT-JP-008', req()).ok); a.eq(v().deposit.refund.status, 'REQUESTED'); a.eq(v().deposit.refund.requestedMinor, 4e6); a.eq(v().deposit.refund.outstandingMinor, 4e6); a.eq(v().contract.refund.requested, true); a.eq(v().contract.refundHistory.length, 1);
    a.eq(c.recordRefundRequest('CT-JP-008', req()).errors[0], 'E_REFUND_OPEN', 'one open request at a time'); a.eq(c.closeRefundRequest('CT-JP-008', '').errors[0], 'E_REASON_REQUIRED'); a.eq(c.closeRefundRequest('CT-JP-009', 'x'.repeat(5)).errors[0], 'E_CONTRACT_UNKNOWN'); a.eq(c.closeRefundRequest('CT-JP-005', 'withdrawn').errors[0], 'E_REFUND_NONE');
    st.state.config.asOf = '2026-12-10'; a.eq(v().deposit.refund.status, 'OVERDUE', 'past the due date with money outstanding'); st.state.config.asOf = '2026-11-06';
    a.ok(c.closeRefundRequest('CT-JP-008', 'withdrawn, asked again later').ok); a.eq(v().deposit.refund.status, 'NONE'); a.eq(v().contract.refund.requested, false); a.eq(v().contract.refundHistory.length, 2); a.eq(v().contract.refundHistory[1].event, 'CLOSED'); a.eq(v().contract.refundHistory[0].amountMinor, 4e6, 'the closed request stays in the history');
    a.ok(c.recordRefundRequest('CT-JP-008', req({ amountMinor: 10e6 })).ok, 'a new request after closing'); for (const role of ['VIEWER', 'CEO']) { env.as(st, role); a.throws(() => c.recordRefundRequest('CT-JP-005', req({ amountMinor: 1e6 })), 'E_FORBIDDEN', role); a.throws(() => c.closeRefundRequest('CT-JP-008', 'because'), 'E_FORBIDDEN', role); }
    env.as(st, 'SUPPORT'); a.ok(c.closeRefundRequest('CT-JP-008', 'received in full').ok, 'finance support may close'); a.eq(JSON.stringify(st.state.ledger), ledger, 'a refund request never writes the ledger'); const au = st.state.audit.filter(e => /^REFUND_/.test(e.action)); a.ok(au.some(e => e.outcome === 'OK') && au.some(e => e.outcome === 'REJECTED') && au.some(e => e.outcome === 'DENIED'));
  });

  t('DP05', 'A refund row in the ledger is what counts as received: partly received stays open, fully received turns the request into received; the request survives a reload and tampering is caught', ['DEP-3', 'D-3', 'D-5'], a => {
    const stg = env.Store.memoryStorage(); const st = env.as(env.newStore({ storage: stg }), 'SCM'); const c = st.commands; const d = () => st.model().byContract['CT-JP-008'].deposit;
    a.ok(c.recordRefundRequest('CT-JP-008', { amountMinor: 6e6, requestedAt: '2026-11-02', dueDate: '2026-12-02', note: '' }).ok);
    const post = (amt, ref) => c.addTx({ contractId: 'CT-JP-008', currency: 'JPY', type: 'REFUND', amountMinor: amt, occurredAt: '2026-11-04T10:00:00+09:00', externalRef: ref });
    const r1 = post(2e6, 'RF-1'); a.ok(r1 && r1.ok, JSON.stringify(r1)); a.eq(d().refund.receivedMinor, 2e6); a.eq(d().refund.outstandingMinor, 4e6); a.eq(d().refund.status, 'REQUESTED'); a.eq(d().balanceMinor, 8e6); a.eq(d().refundedMinor, 2e6);
    a.ok(post(4e6, 'RF-2').ok); a.eq(d().refund.status, 'DONE'); a.eq(d().balanceMinor, 4e6); a.eq(d().timeline.length, 3, 'opening and two refunds');
    const back = env.newStore({ storage: stg }); a.eq(back.loadStatus, 'OK'); a.eq(back.model().byContract['CT-JP-008'].deposit.refund.status, 'DONE');
    const raw = JSON.parse(stg.getItem('omh_hfr_v1')); const load = mut => { const s = env.clone(raw); mut(s); const g = env.Store.memoryStorage(); g.setItem('omh_hfr_v1', JSON.stringify(s)); return env.newStore({ storage: g }).loadStatus; };
    a.eq(load(() => {}), 'OK'); a.eq(load(s => { s.contracts.find(x => x.contractId === 'CT-JP-008').refund.requestedAmountMinor = 1; }), 'AUDIT_BROKEN', 'the request edited by hand'); a.eq(load(s => { delete s.contracts.find(x => x.contractId === 'CT-JP-008').refundHistory; }), 'AUDIT_BROKEN', 'the history removed');
  });
};
