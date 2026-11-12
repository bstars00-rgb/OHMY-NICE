/* Forward-looking judgement material for one hotel contract: when the next top-up has to be requested, and whether the relationship should go on.
   PURE and read-only: it only reads numbers the other engines already produced (forecast, limit, rating, alerts, ELLIS outlook). It never writes to the ledger and never decides:
   the CEO decides every top-up, limit and relationship (결재 포털). All thresholds below are provisional until the CEO confirms them.                                                 */
(function (root, factory) {
  const NS = root.OMH || (root.OMH = {});
  const api = factory(typeof require === 'function' ? { Dates: require('../core/dates.js') } : { Dates: NS.Dates });
  NS.Outlook = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis, function (dep) {
  'use strict';
  const { Dates } = dep;
  const LEAD_DAYS = 7;            // days between a top-up request and the money reaching the hotel (provisional)
  const SOON_DAYS = 14;           // a top-up due within this many days is "soon"
  const CRITICAL_FLAGS = ['CLOSURE_CONFIRMED', 'REFUND_REFUSED', 'ENTITY_FAILED', 'LEGAL_RECOVERY_CRITICAL'];
  const ceilDiv = (a, b) => Number((BigInt(a) + BigInt(b) - 1n) / BigInt(b));

  /**
   * Section "7. How fast must the next top-up be made?"
   * v: a contract view (forecast, limit, balance, contract); ell: the ELLIS outlook of that contract (may be unavailable); cfg: the config (forecast.daysPerMonth); asOf: 'YYYY-MM-DD'.
   * The speed is the confirmed ledger average when there is one; otherwise the ELLIS booking average, and the source is always named.
   * status: PLAN | HOLD (a top-up would be needed but the limit logic holds it) | NOT_NEEDED | NO_CONSUMPTION | NO_DATA | DEPLETED | NOT_APPLICABLE
   */
  function topupPlan(v, ell, cfg, asOf) {
    const f = v.forecast, lim = v.limit, c = v.contract, bal = v.balance.closingMinor, dpm = cfg.forecast.daysPerMonth;
    ell = ell || { avgMinor: null, upcoming: [] };
    const out = { status: null, speedSource: null, monthlyMinor: null, ledgerMonthlyMinor: f.avgMinor == null ? null : f.avgMinor, ellisMonthlyMinor: ell.avgMinor == null ? null : ell.avgMinor, speedGapPct: null,
      balanceMinor: bal, depletionDate: null, topUpByDate: null, daysUntilTopUp: null, urgency: null, leadDays: LEAD_DAYS, availableMinor: lim.availableTopupMinor || 0, holdReasons: lim.holdReasons || [],
      minTopUpMinor: c.topUp && c.topUp.minAmountMinor ? c.topUp.minAmountMinor : null, upcoming: ell.upcoming || [], reasons: [] };
    if (out.ledgerMonthlyMinor != null && out.ellisMonthlyMinor != null && out.ledgerMonthlyMinor > 0) out.speedGapPct = Math.round((out.ellisMonthlyMinor - out.ledgerMonthlyMinor) / out.ledgerMonthlyMinor * 1000) / 10;
    if (f.status === 'NOT_APPLICABLE') return Object.assign(out, { status: 'NOT_APPLICABLE' });
    if (bal <= 0) return Object.assign(out, { status: 'DEPLETED', urgency: 'NOW', depletionDate: asOf, topUpByDate: asOf, daysUntilTopUp: 0 });
    const ledgerOk = f.avgMinor != null && f.quality !== 'NONE' && f.status !== 'UNCERTAIN_ZERO';
    const speed = ledgerOk ? f.avgMinor : (out.ellisMonthlyMinor != null ? out.ellisMonthlyMinor : null);
    if (speed == null) return Object.assign(out, { status: 'NO_DATA' });
    out.speedSource = ledgerOk ? 'LEDGER' : 'ELLIS'; out.monthlyMinor = speed;
    if (speed === 0) return Object.assign(out, { status: 'NO_CONSUMPTION' });
    const days = ceilDiv(BigInt(bal) * BigInt(dpm), speed);
    if (days > 36500) return Object.assign(out, { status: 'NO_CONSUMPTION' });
    out.depletionDate = Dates.addDays(asOf, days); out.topUpByDate = Dates.addDays(out.depletionDate, -LEAD_DAYS); out.daysUntilTopUp = Dates.diffDays(asOf, out.topUpByDate);
    out.urgency = out.daysUntilTopUp <= 0 ? 'NOW' : out.daysUntilTopUp <= SOON_DAYS ? 'SOON' : 'LATER';
    if (c.endDate && Dates.cmp(out.depletionDate, c.endDate) > 0) { out.reasons.push('BEYOND_CONTRACT_END'); return Object.assign(out, { status: 'NOT_NEEDED' }); }   // the balance outlasts the contract: more money would only be unused
    return Object.assign(out, { status: lim.topupHold ? 'HOLD' : 'PLAN' });
  }

  /**
   * Section "8. Should the cooperation with this hotel go on?" A rule-based recommendation for the CEO, never a decision.
   * verdict: WIND_DOWN (stop adding, plan the return) | CONDITIONS (go on with limits) | REVIEW (not enough evidence) | CONTINUE
   * reasons: [{ code, ... }] in the order of the rules that fired.
   */
  function relationship(v) {
    const r = v.rating, f = v.forecast, lim = v.limit, c = v.contract, bal = v.balance.closingMinor, d = v.derived || {};
    const flags = r.flags.map(x => x.id).filter(x => CRITICAL_FLAGS.includes(x));
    const stop = [], cond = [], review = [];
    for (const fl of flags) stop.push({ code: 'CRITICAL_FACT', flag: fl });
    if (r.grade === 'D') stop.push({ code: 'GRADE_D' });
    if (d.refundOverdue) stop.push({ code: 'REFUND_OVERDUE' });
    else if (d.refundPending) stop.push({ code: 'REFUND_IN_PROGRESS' });
    if (f.expired && bal > 0) stop.push({ code: 'EXPIRED_WITH_BALANCE' });
    if (r.grade === 'C') cond.push({ code: 'GRADE_C' });
    for (const h of lim.holdReasons || []) if (!['GRADE_D_NO_PREPAY', 'NOT_RATED', 'CRITICAL_FACT_ACTIVE', 'NOT_APPLICABLE_DEPOSIT', 'NOT_APPLICABLE_MONTHLY', 'NO_CONSUMPTION_DATA', 'PARTIAL_CONSUMPTION_DATA'].includes(h)) cond.push({ code: 'HOLD', reason: h });
    if (d.consumptionCollapse && !cond.some(x => x.reason === 'CONSUMPTION_COLLAPSE')) cond.push({ code: 'HOLD', reason: 'CONSUMPTION_COLLAPSE' });
    if (lim.overLimitMinor > 0 && r.grade !== 'NR' && r.grade !== 'D') cond.push({ code: 'OVER_LIMIT' });   // for D and NR the limit is 0 by rule, so 'over the limit' says nothing new
    if (d.expiryBeforeDepletion) cond.push({ code: 'EXPIRY_BEFORE_DEPLETION' });
    if (d.reconMajor) cond.push({ code: 'RECON_MAJOR' });
    if (f.longUnconsumed) cond.push({ code: 'LONG_UNCONSUMED' });
    if (r.grade === 'NR') review.push({ code: 'NOT_RATED' });
    if (r.confidence && r.confidence.level === 'LOW') review.push({ code: 'LOW_CONFIDENCE', pct: r.confidence.pct });
    if (f.status === 'NO_DATA' && c.prepaymentType !== 'SECURITY_DEPOSIT') review.push({ code: 'NO_CONSUMPTION_DATA' });
    const verdict = stop.length ? 'WIND_DOWN' : cond.length ? 'CONDITIONS' : review.length ? 'REVIEW' : 'CONTINUE';
    return { verdict, reasons: [...stop, ...cond, ...review] };
  }

  return { LEAD_DAYS, SOON_DAYS, topupPlan, relationship };
});
