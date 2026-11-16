/* Deposit ledger (보증금 원장) — security deposits and buyout deposits: what was placed, what came back, what is left, how long it has been held and where a refund stands.
   PURE: ledger rows and dates in, figures out. Nothing here moves money or writes the ledger; the rows are entered in the floating ledger and refunds are recorded there when the money arrives.          */
(function (root, factory) {
  const NS = root.OMH || (root.OMH = {});
  const api = factory(typeof require === 'function' ? { Dates: require('../core/dates.js'), Ledger: require('./ledger.js') } : { Dates: NS.Dates, Ledger: NS.Ledger });
  NS.Deposits = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis, function (dep) {
  'use strict';
  const { Dates, Ledger } = dep;
  const TYPES = ['SECURITY_DEPOSIT', 'BUYOUT'];
  /** Deposits and buyouts are held, not consumed: they live on this ledger tab. */
  const applicable = contract => TYPES.includes(contract.prepaymentType);

  /** Days, whole years (365 days each, the same count the long-held alert uses) and whole calendar months between two dates. */
  function span(from, to) {
    if (!from || Dates.cmp(from, to) > 0) return { days: null, years: null, months: null };
    const days = Dates.diffDays(from, to); let months = (+to.slice(0, 4) - +from.slice(0, 4)) * 12 + (+to.slice(5, 7) - +from.slice(5, 7)); if (+to.slice(8, 10) < +from.slice(8, 10)) months--;
    return { days, years: Math.floor(days / 365), months: Math.max(0, months) };
  }

  /**
   * input: { contract, rows (the ledger rows of this contract), asOf, cfg, refund: { requested, requestedAt, requestedMinor, dueDate, receivedMinor, outstandingMinor, overdue }, recon }
   * refund.status: NONE | REQUESTED | OVERDUE | DONE.   -> the figures of one deposit
   */
  function summarize(input) {
    const { contract, rows, asOf, cfg, recon } = input; const own = rows.filter(t => t.contractId === contract.contractId);
    const bal = Ledger.balance(own, contract.contractId); const placed = own.filter(t => t.type === 'OPENING' || t.type === 'TOPUP').map(t => String(t.occurredAt).slice(0, 10)).sort();
    // a deposit carried into the ledger by an opening row was placed when the contract started, not when the row was entered
    const firstAt = contract.startDate || (placed.length ? placed[0] : null); const held = span(firstAt, asOf);
    const rule = (cfg.alertRules || {}).LONG_HELD_DEPOSIT; const yearsLimit = rule && rule.params ? rule.params.years : 5;
    const rf = input.refund || {}; const status = !rf.requested ? 'NONE' : rf.outstandingMinor > 0 ? (rf.overdue ? 'OVERDUE' : 'REQUESTED') : 'DONE';
    const letterAge = recon && recon.confirmedAt ? Dates.diffDays(recon.confirmedAt, asOf) : null;
    return {
      placedMinor: bal.openingMinor + bal.topupsMinor, refundedMinor: bal.refundsMinor, offsetMinor: bal.offsetsMinor, adjustmentMinor: bal.adjustmentsMinor, balanceMinor: bal.closingMinor,
      firstDepositAt: firstAt, heldDays: held.days, heldYears: held.years, heldMonths: held.months, longHeld: bal.closingMinor > 0 && held.days != null && held.days >= Math.round(yearsLimit * 365), longHeldYears: yearsLimit,
      refundable: contract.refund ? contract.refund.refundable : null, refund: { status, requestedAt: rf.requestedAt || null, requestedMinor: rf.requestedMinor || 0, dueDate: rf.dueDate || null, receivedMinor: rf.receivedMinor || 0, outstandingMinor: rf.outstandingMinor || 0 },
      letter: { confirmedAt: recon && recon.confirmedAt ? recon.confirmedAt : null, ageDays: letterAge, status: recon ? recon.status : 'UNCONFIRMED', diffMinor: recon ? recon.diffMinor : null },
      timeline: Ledger.statement(own, contract.contractId), rowCount: own.length,
    };
  }
  /** Totals per currency for a list of summaries { currency, s }: placed, refunded, balance. Currencies are never added together. */
  function totals(items) {
    const out = {}; for (const { currency, s } of items) { const t = out[currency] || (out[currency] = { placedMinor: 0, refundedMinor: 0, balanceMinor: 0, count: 0 }); t.placedMinor += s.placedMinor; t.refundedMinor += s.refundedMinor; t.balanceMinor += s.balanceMinor; t.count++; }
    return out;
  }
  return { TYPES, applicable, span, summarize, totals };
});
