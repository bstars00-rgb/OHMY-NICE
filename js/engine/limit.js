/* Floating credit-limit engine — deterministic rules only (no AI). All amounts in integer minor units of ONE currency.
   Recommended = min( Avg3M × GradeMultiplier , every safeguard cap ).  Safeguards can also place a top-up HOLD.            */
(function (root, factory) {
  const NS = root.OMH || (root.OMH = {});
  const api = factory(typeof require === 'function' ? { Money: require('../core/money.js') } : { Money: NS.Money });
  NS.Limit = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis, function (dep) {
  'use strict';
  const { Money } = dep;
  const multiplier = (grade, cfg) => (cfg.gradeMultipliers[grade] != null ? cfg.gradeMultipliers[grade] : 0);

  /**
   * input: { grade, forecast, outstandingMinor, contract, recoverability, alerts:[{severity,ruleId}], cfg }
   * -> { status:'OK'|'UNAVAILABLE', baseLimitMinor, recommendedLimitMinor, availableTopupMinor, overLimitMinor, guards:[], topupHold, holdReasons:[], dataQuality }
   */
  function compute(input) {
    const { grade, forecast: f, outstandingMinor, contract, recoverability, alerts, cfg } = input; const ratingFlags = input.ratingFlags || [];
    const mult = multiplier(grade, cfg); const out = { grade, multiplier: mult, outstandingMinor, currency: contract.currency, guards: [], holdReasons: [], notes: [], dataQuality: f.quality };
    if (contract.limitCap && Number.isSafeInteger(contract.limitCap.amountMinor) && contract.limitCap.amountMinor >= 0) out.manualCapMinor = contract.limitCap.amountMinor;   // hotel-level cap entered by a person
    if (f.status === 'NOT_APPLICABLE') return Object.assign(out, { status: 'UNAVAILABLE', baseLimitMinor: null, recommendedLimitMinor: null, availableTopupMinor: 0, overLimitMinor: null, topupHold: true, holdReasons: [contract.monthlySettlement === true ? 'NOT_APPLICABLE_MONTHLY' : 'NOT_APPLICABLE_DEPOSIT'], notes: ['보증금은 소진 대상이 아니라 한도 산정 제외 / Security deposit: no consumption-based limit'] });
    if (f.status === 'UNCERTAIN_ZERO') return Object.assign(out, { status: 'UNAVAILABLE', baseLimitMinor: null, recommendedLimitMinor: null, availableTopupMinor: 0, overLimitMinor: null, topupHold: true, holdReasons: ['PARTIAL_CONSUMPTION_DATA'], notes: ['일부 월만 확정이고 소진 0을 단정할 수 없어 한도 산정 불가 / Limit unavailable: only some months confirmed, zero not assertable'] });
    if (f.quality === 'NONE' || f.avgMinor == null) {
      return Object.assign(out, { status: 'UNAVAILABLE', baseLimitMinor: null, recommendedLimitMinor: null, availableTopupMinor: 0, overLimitMinor: null, topupHold: true,
        holdReasons: ['NO_CONSUMPTION_DATA'], notes: ['한도 산정 불가: 확정 소진 실적 없음 / Limit unavailable: no confirmed consumption'] });
    }
    const base = Money.avgMul(f.series.filter(s => s.amountMinor != null).reduce((a, s) => a + s.amountMinor, 0), f.confirmedMonths, mult);
    out.baseLimitMinor = base; out.avgMinor = f.avgMinor;
    let rec = base; const caps = out.guards;
    const cap = (id, capMinor, reason) => { caps.push({ id, capMinor, reason, binding: capMinor < base }); rec = Math.min(rec, capMinor); };

    // G1 contract end: cannot prepay more than can be consumed before expiry
    if (contract.endDate) {
      const dEnd = f.daysToEnd == null ? 0 : Math.max(0, f.daysToEnd);   // exact day arithmetic (no month rounding)
      cap('G_CONTRACT_END', f.expired ? 0 : Number((BigInt(f.avgMinor) * BigInt(dEnd)) / BigInt(cfg.forecast.daysPerMonth)), f.expired ? 'EXPIRED' : 'DAYS_TO_END=' + dEnd);
    }
    // G2 refundability
    const refundable = contract.refund ? contract.refund.refundable : null;
    if (refundable === false) cap('G_NON_REFUNDABLE', Money.mulFloor(f.avgMinor, cfg.guards.nonRefundableMonths), 'NON_REFUNDABLE');
    else if (refundable == null) cap('G_REFUND_UNKNOWN', Money.mulFloor(f.avgMinor, cfg.guards.unknownRefundMonths), 'REFUND_TERMS_UNKNOWN');
    // G3 low recoverability
    if (recoverability && recoverability.tier === 'LOW') cap('G_LOW_RECOVERY', Money.mulFloor(f.avgMinor, cfg.guards.lowRecoveryMonths), 'RECOVERABILITY_LOW');
    // G5 hotel-level cap entered by a person (the CEO's decision for this hotel). It can only lower the limit, never raise it.
    out.preCapLimitMinor = Math.max(0, rec);
    if (out.manualCapMinor != null) cap('G_MANUAL_CAP', out.manualCapMinor, 'MANUAL_CAP');
    // G4 holds
    if (f.velocity && f.velocity.pct != null && f.velocity.pct <= -cfg.guards.velocityHoldDropPct) out.holdReasons.push('CONSUMPTION_COLLAPSE');
    if ((alerts || []).some(a => a.severity === 'CRITICAL')) out.holdReasons.push('CRITICAL_ALERT_OPEN');
    if (ratingFlags.some(x => ['CLOSURE_CONFIRMED', 'REFUND_REFUSED', 'ENTITY_FAILED', 'LEGAL_RECOVERY_CRITICAL'].includes(x))) out.holdReasons.push('CRITICAL_FACT_ACTIVE');   // a verified fact keeps the hold even if its alert is dismissed
    if ((alerts || []).some(a => a.severity === 'HIGH')) out.holdReasons.push('HIGH_ALERT_OPEN');
    if (grade === 'D' || grade === 'NR') out.holdReasons.push(grade === 'D' ? 'GRADE_D_NO_PREPAY' : 'NOT_RATED');
    if (f.quality === 'PARTIAL') out.notes.push('PARTIAL_CONSUMPTION_DATA');

    out.recommendedLimitMinor = Math.max(0, rec); out.status = 'OK';
    out.topupHold = out.holdReasons.length > 0;
    out.availableTopupMinor = out.topupHold ? 0 : Math.max(0, out.recommendedLimitMinor - outstandingMinor);
    out.overLimitMinor = Math.max(0, outstandingMinor - out.recommendedLimitMinor);
    return out;
  }

  /** Pure what-if. Never writes anywhere. requestedMinor must be a positive integer in the contract currency. */
  function simulate(limit, forecast, requestedMinor, contract, opts) {
    const errors = [];
    if (!Number.isSafeInteger(requestedMinor) || requestedMinor <= 0) errors.push('E_AMOUNT_INVALID');
    if (errors.length) return { ok: false, errors };
    const projected = limit.outstandingMinor + requestedMinor; const reasons = [];
    const rec = limit.recommendedLimitMinor;                       // null when UNAVAILABLE
    const exceeded = rec == null ? true : projected > rec;
    const excessMinor = rec == null ? null : Math.max(0, projected - rec);
    if (rec == null) reasons.push('LIMIT_UNAVAILABLE');
    if (rec != null && exceeded) reasons.push('LIMIT_EXCEEDED');
    if (limit.topupHold) for (const r of limit.holdReasons) if (!reasons.includes(r)) reasons.push(r);
    if (limit.dataQuality === 'PARTIAL' && !reasons.includes('PARTIAL_CONSUMPTION_DATA')) reasons.push('PARTIAL_CONSUMPTION_DATA');
    const approvalRequired = reasons.length > 0;
    let postDepletion = null, postDays = null;
    if (forecast.avgMinor > 0) { postDays = Money.ceilDiv(BigInt(projected) * BigInt(opts.daysPerMonth), forecast.avgMinor); postDepletion = postDays > 36500 ? null : opts.addDays(opts.asOf, postDays); }
    const beyondEnd = !!(postDepletion && contract.endDate && postDepletion > contract.endDate);
    if (beyondEnd) reasons.push('EXCEEDS_CONTRACT_END_DEPLETION');
    // risk level
    let risk = 'LOW';
    if (limit.holdReasons.includes('CRITICAL_ALERT_OPEN') || limit.holdReasons.includes('GRADE_D_NO_PREPAY') || limit.holdReasons.includes('NOT_RATED')) risk = 'CRITICAL';
    else if (exceeded || limit.holdReasons.length || beyondEnd || rec == null) risk = 'HIGH';
    else if (limit.dataQuality === 'PARTIAL' || limit.grade === 'C' || (rec > 0 && projected * 10 >= rec * 9)) risk = 'MEDIUM';
    return { ok: true, currency: contract.currency, currentMinor: limit.outstandingMinor, requestedMinor, projectedMinor: projected, recommendedLimitMinor: rec, excessMinor, limitExceeded: exceeded,
      approvalRequired: approvalRequired || beyondEnd, approvalReasons: reasons, risk, postDepletionDate: postDepletion, postDaysToDepletion: postDays, beyondContractEnd: beyondEnd,
      writesLedger: false };
  }

  return { multiplier, compute, simulate };
});
