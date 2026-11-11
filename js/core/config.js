/* Default configuration. EVERY value here is PROVISIONAL (대표 승인 전 확정값 아님) and editable in Administration. */
(function (root, factory) {
  const NS = root.OMH || (root.OMH = {});
  const api = factory();
  NS.Config = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';
  function defaults() {
    return {
      version: 1,
      provisional: true,                 // 대표 승인 전까지 true
      asOf: '2026-11-06',                // evaluation date (prototype: fixed for reproducibility; adapters supply real date later)
      ratingThresholds: { A: 80, B: 65, C: 50 },        // score >= -> grade, else D
      minCoverage: 0.5,                  // known-weight share below this -> NR (not rated)
      lowConfidenceCoverage: 0.7,        // below this -> grade capped (flag LOW_CONFIDENCE)
      weights: { legalEntity: 10, operatingStability: 8, financialHealth: 8, ownershipChange: 8, settlementHistory: 10, consumptionVsPrepay: 15,
                 refundability: 10, collateral: 8, reconAccuracy: 9, continuity: 6, scmOps: 0, countryLegal: 8 },   // scmOps is a person's judgement: kept out of the score (weight 0), its 6 points went to the two data-driven items
      scoring: {                         // how the data-driven scores are read off the data (provisional, CEO decides)
        coverMonths: [2, 4, 6, 12],      // balance ÷ monthly consumption: up to the 1st value 5 points, 2nd 4, 3rd 3, 4th 2, above 1
        endShortfallPenalty: 1,          // points taken off when the balance cannot be used up before the contract ends
        collateralRatios: [1, 0.5, 0.25],// verified collateral ÷ balance: at least the 1st 5 points, 2nd 4, 3rd 3; some collateral 2; none 1
        reconScores: { MATCH: 5, MINOR: 3, MAJOR: 1 },
        countryLegal: { KR: 4, JP: 4, VN: 3 },   // legal recovery difficulty by country (placeholder until the CEO fixes the table)
      },
      flagCaps: { CLOSURE_CONFIRMED: 'D', REFUND_REFUSED: 'D', ENTITY_FAILED: 'D', LEGAL_RECOVERY_CRITICAL: 'D', REFUND_OVERDUE: 'C',
                  RECON_MAJOR_MISMATCH: 'C', OWNERSHIP_CHANGE_UNRESOLVED: 'C', ENTITY_UNKNOWN: 'C', CONSUMPTION_COLLAPSE: 'B',
                  EXPIRY_BEFORE_DEPLETION: 'B', LOW_CONFIDENCE: 'B' },
      gradeMultipliers: { A: 2, B: 1, C: 0.5, D: 0, NR: 0 },     // months of average consumption (CEO provisional table)
      guards: { nonRefundableMonths: 1, unknownRefundMonths: 1, lowRecoveryMonths: 0.5, velocityHoldDropPct: 50 },
      forecast: { windowMonths: 3, longUnconsumedMonths: 6, daysPerMonth: 30 },
      recon: { matchBp: 10, minorBp: 200, staleDays: 45 },       // basis points of the larger balance
      alertRules: {
        CLOSURE_CONFIRMED:       { enabled: true, severity: 'CRITICAL', action: 'HOLD_TOPUP' },
        LEGAL_RECOVERY_CRITICAL: { enabled: true, severity: 'CRITICAL', action: 'REVIEW_REFUND' },
        REFUND_REFUSED:          { enabled: true, severity: 'CRITICAL', action: 'REVIEW_REFUND' },
        ENTITY_FAILED:           { enabled: true, severity: 'CRITICAL', action: 'VERIFY_CONTRACT' },
        RATING_DROP:             { enabled: true, severity: 'HIGH', action: 'HOLD_TOPUP', params: { notches: 2, windowDays: 90 } },
        CONSUMPTION_COLLAPSE:    { enabled: true, severity: 'HIGH', action: 'HOLD_TOPUP', params: { dropPct: 50 } },
        RECON_MAJOR_MISMATCH:    { enabled: true, severity: 'HIGH', action: 'RECONFIRM_BALANCE' },
        EXPIRY_BEFORE_DEPLETION: { enabled: true, severity: 'HIGH', action: 'REVIEW_REFUND' },
        REFUND_OVERDUE:          { enabled: true, severity: 'HIGH', action: 'REVIEW_REFUND' },
        NEGATIVE_BALANCE:        { enabled: true, severity: 'HIGH', action: 'RECONFIRM_BALANCE' },
        LONG_UNCONSUMED:         { enabled: true, severity: 'MEDIUM', action: 'HOLD_TOPUP' },
        RECON_UNCONFIRMED:       { enabled: true, severity: 'MEDIUM', action: 'RECONFIRM_BALANCE' },
        SALES_DECLINE:           { enabled: true, severity: 'MEDIUM', action: 'HOLD_TOPUP', params: { dropPct: 20 } },
        RENEWAL_DELAY:           { enabled: true, severity: 'MEDIUM', action: 'VERIFY_CONTRACT', params: { withinDays: 60 } },
        ENTITY_UNKNOWN:          { enabled: true, severity: 'MEDIUM', action: 'VERIFY_CONTRACT' },
        UNVERIFIED_SIGNAL:       { enabled: true, severity: 'MEDIUM', action: 'VERIFY_CONTRACT' },
      },
    };
  }
  const GRADES = ['A', 'B', 'C', 'D'];            // hotel prepayment grades (NOT the partner A–E scale)
  const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM'];
  const ACTIONS = ['HOLD_TOPUP', 'VERIFY_CONTRACT', 'RECONFIRM_BALANCE', 'REVIEW_REFUND'];
  const CRITERIA_IDS = ['legalEntity', 'operatingStability', 'financialHealth', 'ownershipChange', 'settlementHistory', 'consumptionVsPrepay', 'refundability', 'collateral', 'reconAccuracy', 'continuity', 'scmOps', 'countryLegal'];
  const isNum = v => typeof v === 'number' && Number.isFinite(v);
  const isRealDate = v => { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return false; const [y, m, d] = String(v).split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; };
  function hasProtoKey(o, depth) { if (!o || typeof o !== 'object' || depth > 6) return false; for (const k of Object.keys(o)) { if (k === '__proto__' || k === 'constructor' || k === 'prototype') return true; if (hasProtoKey(o[k], depth + 1)) return true; } return false; }
  /** Returns a list of error codes (empty = valid). Guards the CEO's hard rules (D = no prepay, weights sum to 100) and every section the engines read. */
  function validate(c) {
    const e = []; const D = defaults();
    if (!c || typeof c !== 'object' || Array.isArray(c)) return ['E_CONFIG_SHAPE'];
    if (hasProtoKey(c, 0)) return ['E_CONFIG_SECTION:prototype-key'];
    let sum = 0; for (const id of CRITERIA_IDS) { const w = c.weights && c.weights[id]; if (!isNum(w) || w < 0 || w > 100) e.push('E_WEIGHT_RANGE:' + id); else sum += w; }
    if (Math.abs(sum - 100) > 1e-9) e.push('E_WEIGHT_SUM_NOT_100');
    const t = c.ratingThresholds || {};
    if (![t.A, t.B, t.C].every(isNum) || !(t.A > t.B && t.B > t.C && t.C > 0 && t.A <= 100)) e.push('E_THRESHOLD_ORDER');
    const m = c.gradeMultipliers || {};
    for (const g of ['A', 'B', 'C', 'D', 'NR']) if (!isNum(m[g]) || m[g] < 0 || m[g] > 12 || Math.abs(m[g] * 100 - Math.round(m[g] * 100)) > 1e-6) e.push('E_MULTIPLIER_RANGE:' + g);
    if (m.D !== 0) e.push('E_D_MUST_BE_ZERO');
    if (m.NR !== 0) e.push('E_NR_MUST_BE_ZERO');
    if (isNum(m.A) && isNum(m.B) && isNum(m.C) && !(m.A >= m.B && m.B >= m.C)) e.push('E_MULTIPLIER_NOT_MONOTONE');
    if (!(isNum(c.minCoverage) && isNum(c.lowConfidenceCoverage) && c.minCoverage > 0 && c.minCoverage < c.lowConfidenceCoverage && c.lowConfidenceCoverage <= 1)) e.push('E_COVERAGE_RANGE');
    // alert rules: every default rule must exist, with valid severity/action/enabled and every numeric parameter
    const ar = c.alertRules;
    if (!ar || typeof ar !== 'object') e.push('E_CONFIG_SECTION:alertRules');
    else for (const k of Object.keys(D.alertRules)) {
      const r = ar[k], d = D.alertRules[k];
      if (!r || typeof r !== 'object') { e.push('E_CONFIG_SECTION:alertRules.' + k); continue; }
      if (!SEVERITIES.includes(r.severity)) e.push('E_SEVERITY:' + k);
      if (!ACTIONS.includes(r.action)) e.push('E_ACTION:' + k);
      if (typeof r.enabled !== 'boolean') e.push('E_CONFIG_SECTION:alertRules.' + k + '.enabled');
      if (d.params) for (const pk of Object.keys(d.params)) {
        const v = r.params && r.params[pk]; const intOnly = pk === 'notches' || pk === 'windowDays' || pk === 'withinDays';
        if (!isNum(v) || v <= 0 || (pk === 'dropPct' && v > 100) || (intOnly && !Number.isInteger(v))) e.push('E_CONFIG_SECTION:alertRules.' + k + '.' + pk);
      }
    }
    const fc = c.flagCaps; if (!fc || typeof fc !== 'object') e.push('E_CONFIG_SECTION:flagCaps'); else for (const k of Object.keys(D.flagCaps)) if (!GRADES.includes(fc[k])) e.push('E_FLAGCAP:' + k);
    const g = c.guards; if (!g || typeof g !== 'object') e.push('E_CONFIG_SECTION:guards'); else for (const k of Object.keys(D.guards)) if (!isNum(g[k]) || g[k] < 0 || (k === 'velocityHoldDropPct' && (g[k] <= 0 || g[k] > 100))) e.push('E_CONFIG_SECTION:guards.' + k);
    if (!(c.recon && isNum(c.recon.matchBp) && isNum(c.recon.minorBp) && c.recon.matchBp >= 0 && c.recon.matchBp < c.recon.minorBp && isNum(c.recon.staleDays) && c.recon.staleDays > 0)) e.push('E_RECON_RANGE');
    const f = c.forecast;
    if (!(f && Number.isInteger(f.windowMonths) && f.windowMonths >= 1 && f.windowMonths <= 12 && Number.isInteger(f.daysPerMonth) && f.daysPerMonth >= 1 && f.daysPerMonth <= 31 && isNum(f.longUnconsumedMonths) && f.longUnconsumedMonths > 0)) e.push('E_FORECAST_RANGE');
    if (!isRealDate(c.asOf)) e.push('E_ASOF');
    const D2 = defaults(); for (const k of Object.keys(c)) if (!(k in D2)) e.push('E_CONFIG_SECTION:unknown-key:' + k);
    if (!Number.isInteger(c.version) || c.version < 1) e.push('E_CONFIG_SECTION:version');
    const sc = c.scoring; if (!sc || typeof sc !== 'object') e.push('E_CONFIG_SECTION:scoring');
    else {
      const asc = (a, n) => Array.isArray(a) && a.length === n && a.every(x => isNum(x) && x > 0) && a.every((x, i) => i === 0 || x > a[i - 1]);
      if (!asc(sc.coverMonths, 4) || sc.coverMonths[3] > 120) e.push('E_RANGE:scoring.coverMonths');
      if (!(Number.isInteger(sc.endShortfallPenalty) && sc.endShortfallPenalty >= 0 && sc.endShortfallPenalty <= 4)) e.push('E_RANGE:scoring.endShortfallPenalty');
      const cr = sc.collateralRatios; if (!(Array.isArray(cr) && cr.length === 3 && cr.every(x => isNum(x) && x > 0 && x <= 1) && cr[0] > cr[1] && cr[1] > cr[2])) e.push('E_RANGE:scoring.collateralRatios');
      const rs = sc.reconScores; const pt = x => Number.isInteger(x) && x >= 1 && x <= 5; if (!(rs && pt(rs.MATCH) && pt(rs.MINOR) && pt(rs.MAJOR) && rs.MATCH >= rs.MINOR && rs.MINOR >= rs.MAJOR)) e.push('E_RANGE:scoring.reconScores');
      const cl = sc.countryLegal; if (!(cl && typeof cl === 'object' && Object.keys(D.scoring.countryLegal).every(k => pt(cl[k])) && Object.keys(cl).every(k => k in D.scoring.countryLegal))) e.push('E_RANGE:scoring.countryLegal');
    }
    const range = (v, lo, hi, int, tag) => { if (!isNum(v) || v < lo || v > hi || (int && !Number.isInteger(v))) e.push('E_RANGE:' + tag); };
    if (c.guards) for (const k of ['nonRefundableMonths', 'unknownRefundMonths', 'lowRecoveryMonths']) range(c.guards[k], 0, 24, false, 'guards.' + k);
    if (c.recon) { range(c.recon.staleDays, 1, 365, true, 'recon.staleDays'); range(c.recon.matchBp, 0, 10000, false, 'recon.matchBp'); range(c.recon.minorBp, 0, 10000, false, 'recon.minorBp'); }
    if (c.forecast) range(c.forecast.longUnconsumedMonths, 0.1, 60, false, 'forecast.longUnconsumedMonths');
    if (c.alertRules) { const rd = c.alertRules.RATING_DROP, rr = c.alertRules.RENEWAL_DELAY; if (rd && rd.params) { range(rd.params.notches, 1, 3, true, 'RATING_DROP.notches'); range(rd.params.windowDays, 1, 365, true, 'RATING_DROP.windowDays'); } if (rr && rr.params) range(rr.params.withinDays, 1, 365, true, 'RENEWAL_DELAY.withinDays');
      for (const k of Object.keys(c.alertRules)) if (!(k in D2.alertRules)) e.push('E_CONFIG_SECTION:unknown-rule:' + k); }
    if (typeof c.provisional !== 'boolean') e.push('E_CONFIG_SECTION:provisional');
    return e;
  }
  return { defaults, validate, GRADES, SEVERITIES, ACTIONS, CRITERIA_IDS };
});
