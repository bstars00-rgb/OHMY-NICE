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
   * The CEO's limit (선급금 한도): the smallest of four values.
   *   ① the average monthly purchases of the last three months x the months the grade allows (A 2, B 1, C and D 0; direct trade under three months: at most half a month)
   *   ② the room-count cap (Korea, KRW)   ③ 10% of the hotel's monthly room revenue   ④ the most one hotel may hold (by currency; a currency the CEO has not set is left out and marked pending)
   * A hotel-level cap typed in by a person can only lower it. The first deposit is at most half of the limit.
   * input: { grade, forecast, outstandingMinor, contract, hotel, directMonths, recoverability, alerts:[{severity,ruleId}], cfg, ratingFlags }
   * -> { status:'OK'|'UNAVAILABLE', baseLimitMinor, recommendedLimitMinor, availableTopupMinor, overLimitMinor, guards:[], topupHold, holdReasons:[], notes:[], dataQuality }
   */
  function compute(input) {
    const { grade, forecast: f, outstandingMinor, contract, alerts, cfg } = input; const ratingFlags = input.ratingFlags || []; const hotel = input.hotel || {}; const rv = cfg.review;
    const months0 = rv.gradeMonths[grade] != null ? rv.gradeMonths[grade] : 0; const short = input.directMonths != null && input.directMonths < rv.shortHistoryMonths; const mult = short ? Math.min(months0, rv.shortHistoryFactor) : months0;
    const out = { grade, multiplier: mult, gradeMonths: months0, shortHistory: short, directMonths: input.directMonths == null ? null : input.directMonths, outstandingMinor, currency: contract.currency, guards: [], holdReasons: [], notes: [], dataQuality: f.quality };
    if (contract.limitCap && Number.isSafeInteger(contract.limitCap.amountMinor) && contract.limitCap.amountMinor >= 0) out.manualCapMinor = contract.limitCap.amountMinor;   // hotel-level cap entered by a person
    const hmax = rv.hotelMax[contract.currency]; if (Number.isSafeInteger(hmax)) out.hotelMaxMinor = hmax; else { out.hotelMaxPending = true; out.notes.push('HOTEL_MAX_PENDING'); }
    if (f.status === 'NOT_APPLICABLE') return Object.assign(out, { status: 'UNAVAILABLE', baseLimitMinor: null, recommendedLimitMinor: null, availableTopupMinor: 0, overLimitMinor: null, topupHold: true, holdReasons: [contract.monthlySettlement === true ? 'NOT_APPLICABLE_MONTHLY' : 'NOT_APPLICABLE_DEPOSIT'], notes: ['보증금은 소진 대상이 아니라 한도 산정 제외 / Security deposit: no consumption-based limit'] });
    if (f.status === 'UNCERTAIN_ZERO') return Object.assign(out, { status: 'UNAVAILABLE', baseLimitMinor: null, recommendedLimitMinor: null, availableTopupMinor: 0, overLimitMinor: null, topupHold: true, holdReasons: ['PARTIAL_CONSUMPTION_DATA'], notes: ['일부 월만 확정이고 소진 0을 단정할 수 없어 한도 산정 불가 / Limit unavailable: only some months confirmed, zero not assertable'] });
    if (f.quality === 'NONE' || f.avgMinor == null) {
      return Object.assign(out, { status: 'UNAVAILABLE', baseLimitMinor: null, recommendedLimitMinor: null, availableTopupMinor: 0, overLimitMinor: null, topupHold: true,
        holdReasons: ['NO_CONSUMPTION_DATA'], notes: ['한도 산정 불가: 확정 소진 실적 없음 / Limit unavailable: no confirmed consumption'] });
    }
    const base = Money.avgMul(f.series.filter(s => s.amountMinor != null).reduce((a, s) => a + s.amountMinor, 0), f.confirmedMonths, mult);   // ①
    out.baseLimitMinor = base; out.avgMinor = f.avgMinor;
    let rec = base; const caps = out.guards;
    const cap = (id, capMinor, reason) => { caps.push({ id, capMinor, reason, binding: capMinor < base }); rec = Math.min(rec, capMinor); };
    if (contract.currency === 'KRW') {                                                                                                          // ② Korea only
      if (Number.isInteger(hotel.rooms) && hotel.rooms > 0) { const row = rv.roomCaps.find(r => hotel.rooms <= r[0]); if (row) cap('L2_ROOMS', row[1], 'ROOMS=' + hotel.rooms); else out.notes.push('ROOMS_ABOVE_TABLE'); } else out.notes.push('ROOMS_UNKNOWN');
    }
    if (Number.isSafeInteger(hotel.monthlyRoomRevenueMinor) && hotel.monthlyRoomRevenueMinor > 0) cap('L3_REVENUE', Money.mulFloor(hotel.monthlyRoomRevenueMinor, rv.revenueShare), 'REVENUE'); else out.notes.push('REVENUE_UNKNOWN');   // ③
    if (Number.isSafeInteger(hmax)) cap('L4_HOTEL_MAX', hmax, 'HOTEL_MAX');                                                                    // ④
    if (out.manualCapMinor != null) cap('G_MANUAL_CAP', out.manualCapMinor, 'MANUAL_CAP');
    out.preCapLimitMinor = Math.max(0, caps.filter(c => c.id !== 'G_MANUAL_CAP').reduce((m, c) => Math.min(m, c.capMinor), base));
    // holds
    if (f.velocity && f.velocity.pct != null && f.velocity.pct <= -cfg.guards.velocityHoldDropPct) out.holdReasons.push('CONSUMPTION_COLLAPSE');
    if ((alerts || []).some(a => a.severity === 'CRITICAL')) out.holdReasons.push('CRITICAL_ALERT_OPEN');
    if (ratingFlags.some(x => ['CLOSURE_CONFIRMED', 'REFUND_REFUSED', 'ENTITY_FAILED', 'LEGAL_RECOVERY_CRITICAL'].includes(x))) out.holdReasons.push('CRITICAL_FACT_ACTIVE');   // a verified fact keeps the hold even if its alert is dismissed
    if ((alerts || []).some(a => a.severity === 'HIGH')) out.holdReasons.push('HIGH_ALERT_OPEN');
    if (grade === 'D' || grade === 'NR' || grade === 'C') out.holdReasons.push(grade === 'D' ? 'GRADE_D_NO_PREPAY' : grade === 'C' ? 'GRADE_C_NO_PREPAY' : 'NOT_RATED');
    if (Number.isSafeInteger(hmax) && outstandingMinor > hmax) out.holdReasons.push('OVER_HOTEL_MAX');
    if (f.quality === 'PARTIAL') out.notes.push('PARTIAL_CONSUMPTION_DATA');
    out.recommendedLimitMinor = Math.max(0, rec); out.status = 'OK'; out.firstDepositMaxMinor = Math.floor(out.recommendedLimitMinor * rv.firstDepositShare);
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

  /** Adds hold reasons that come from outside the limit itself (the signal colour, the year-end rule). A hold zeroes the available top-up; the limit itself does not change. */
  function applyHolds(limit, reasons) { for (const r of reasons) if (!limit.holdReasons.includes(r)) limit.holdReasons.push(r); limit.topupHold = limit.holdReasons.length > 0; if (limit.topupHold) limit.availableTopupMinor = 0; return limit; }

  return { multiplier, compute, simulate, applyHolds };
});
