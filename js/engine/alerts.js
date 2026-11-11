/* Risk alert engine. Rules are config-driven (severity / enabled / params). Detection is deterministic and evidence-carrying.
   Unverified news / AI signals can NEVER raise a CRITICAL closure alert — they raise MEDIUM UNVERIFIED_SIGNAL only.        */
(function (root, factory) {
  const NS = root.OMH || (root.OMH = {});
  const api = factory(typeof require === 'function' ? { Dates: require('../core/dates.js') } : { Dates: NS.Dates });
  NS.Alerts = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis, function (dep) {
  'use strict';
  const { Dates } = dep;
  const SEV_RANK = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 };
  const STATUSES = ['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'DISMISSED'];
  const B = (ko, en) => ({ ko, en });
  const RULE_TEXT = {
    CLOSURE_CONFIRMED: B('호텔 휴·폐업·압류·부도 확인', 'Hotel suspension / closure / seizure / insolvency confirmed'),
    LEGAL_RECOVERY_CRITICAL: B('중대한 법적 회수 위험', 'Critical legal recovery risk'),
    REFUND_REFUSED: B('선급금 반환 거절', 'Refund refused'),
    ENTITY_FAILED: B('계약 상대방 법적 실체 확인 실패', 'Counterparty legal-entity verification failed'),
    RATING_DROP: B('신용등급 급락', 'Rating drop'),
    CONSUMPTION_COLLAPSE: B('소진 속도 급감', 'Consumption velocity collapse'),
    RECON_MAJOR_MISMATCH: B('중대한 선급금 잔액 불일치', 'Major balance mismatch'),
    EXPIRY_BEFORE_DEPLETION: B('계약 만기 전 소진 불가능', 'Cannot deplete before contract expiry'),
    REFUND_OVERDUE: B('반환 기한 경과', 'Refund overdue'),
    NEGATIVE_BALANCE: B('원장 잔액 음수', 'Negative ledger balance'),
    LONG_UNCONSUMED: B('장기 미소진 잔액', 'Long-unconsumed balance'),
    RECON_UNCONFIRMED: B('잔액 확인 미완료', 'Balance confirmation incomplete'),
    SALES_DECLINE: B('판매 감소 추세', 'Sales decline trend'),
    RENEWAL_DELAY: B('계약 갱신 지연', 'Contract renewal delay'),
    ENTITY_UNKNOWN: B('계약 상대방 실체 미확인', 'Counterparty entity unverified'),
    UNVERIFIED_SIGNAL: B('미검증 위험 신호(확정 아님)', 'Unverified adverse signal (not confirmed)'),
  };
  const ACTION_TEXT = {
    HOLD_TOPUP: B('추가 충전 보류', 'Hold further top-ups'), VERIFY_CONTRACT: B('계약 확인', 'Verify contract'),
    RECONFIRM_BALANCE: B('호텔 잔액 재확인', 'Re-confirm balance with hotel'), REVIEW_REFUND: B('반환 요청 검토', 'Review refund request'),
  };

  /**
   * ctx (per contract): { hotel, contract, balance, recon, forecast, rating, ratingHistory, derived, asOf, cfg, signals:[] }
   * returns detected alerts (array). alertId is deterministic per rule+contract so re-detection never duplicates.
   */
  function detect(ctx) {
    const { hotel, contract, balance, recon, forecast: f, rating, derived, asOf, cfg } = ctx;
    const rules = cfg.alertRules; const out = [];
    const base = { hotelId: hotel.hotelId, contractId: contract.contractId, assignedScm: contract.assignedScm || hotel.assignedScm || null, detectedAt: asOf, source: 'AUTO' };
    const push = (ruleId, evidence) => {
      const r = rules[ruleId]; if (!r || !r.enabled) return;
      out.push(Object.assign({}, base, { alertId: ruleId + ':' + contract.contractId, ruleId, severity: r.severity, action: r.action, title: RULE_TEXT[ruleId], evidence }));
    };
    const flagIds = rating.flags.map(x => x.id);
    if (flagIds.includes('CLOSURE_CONFIRMED')) push('CLOSURE_CONFIRMED', [{ k: 'verifiedBy', v: hotel.facts.closure.verified.by }, { k: 'evidenceRef', v: hotel.facts.closure.verified.evidenceRef }]);
    if (flagIds.includes('LEGAL_RECOVERY_CRITICAL')) push('LEGAL_RECOVERY_CRITICAL', [{ k: 'evidenceRef', v: contract.facts.legalRecoveryCritical.verified.evidenceRef }]);
    if (flagIds.includes('REFUND_REFUSED')) push('REFUND_REFUSED', [{ k: 'evidenceRef', v: contract.facts.refundRefused.verified.evidenceRef }]);
    if (flagIds.includes('ENTITY_FAILED')) push('ENTITY_FAILED', [{ k: 'counterpartyVerification', v: 'FAILED' }]);
    if (flagIds.includes('ENTITY_UNKNOWN')) push('ENTITY_UNKNOWN', [{ k: 'counterpartyVerification', v: (contract.facts && contract.facts.counterpartyVerification) || 'UNKNOWN' }]);

    const dropRule = rules.RATING_DROP;
    if (dropRule && dropRule.enabled) {
      const n = ctx.ratingDrop || 0;
      if (n >= dropRule.params.notches) push('RATING_DROP', [{ k: 'notches', v: n }, { k: 'currentGrade', v: rating.grade }, { k: 'windowDays', v: dropRule.params.windowDays }]);
    }
    const cc = rules.CONSUMPTION_COLLAPSE;
    if (cc && cc.enabled && f.velocity && f.velocity.pct != null && f.velocity.pct <= -cc.params.dropPct)
      push('CONSUMPTION_COLLAPSE', [{ k: 'changePct', v: f.velocity.pct }, { k: 'latestMonth', v: f.series[f.series.length - 1].month }, { k: 'basis', v: 'CHECKIN/confirmed' }]);
    if (recon.status === 'MAJOR' || recon.status === 'CURRENCY_MISMATCH')
      push('RECON_MAJOR_MISMATCH', [{ k: 'ledgerAtConfirmDate', v: recon.ledgerAtMinor }, { k: 'hotelConfirmed', v: recon.confirmedMinor }, { k: 'diff', v: recon.diffMinor }, { k: 'pctBp', v: recon.pctBp }]);
    if (f.depletesBeforeEnd === false && balance.closingMinor > 0 && contract.endDate)
      push('EXPIRY_BEFORE_DEPLETION', [{ k: 'contractEnd', v: contract.endDate }, { k: 'projectedDepletion', v: f.depletionDate || (f.status === 'NO_CONSUMPTION' ? 'NO_CONSUMPTION' : 'n/a') }, { k: 'unusedAtEnd', v: f.estimatedUnusedAtEndMinor }]);
    if (derived.refundOverdue) push('REFUND_OVERDUE', [{ k: 'dueDate', v: contract.refund.dueDate }, { k: 'outstandingRefund', v: derived.refundOutstandingMinor }]);
    if (balance.closingMinor < 0) push('NEGATIVE_BALANCE', [{ k: 'balance', v: balance.closingMinor }]);
    if (f.longUnconsumed && balance.closingMinor > 0) push('LONG_UNCONSUMED', [{ k: 'monthsOfCover', v: f.monthsOfCover }, { k: 'status', v: f.status }, { k: 'balance', v: balance.closingMinor }]);
    if (recon.status === 'UNCONFIRMED' || recon.stale) push('RECON_UNCONFIRMED', [{ k: 'status', v: recon.status }, { k: 'lastConfirmedAt', v: recon.confirmedAt || 'never' }]);
    const sd = rules.SALES_DECLINE;
    if (sd && sd.enabled && f.salesTrend.pct != null && f.salesTrend.pct <= -sd.params.dropPct) push('SALES_DECLINE', [{ k: 'changePct', v: f.salesTrend.pct }, { k: 'basis', v: 'BOOKING_DATE' }]);
    const rd = rules.RENEWAL_DELAY;
    if (rd && rd.enabled && contract.endDate && !contract.renewal) {
      const days = Dates.diffDays(asOf, contract.endDate);
      if (days >= 0 && days <= rd.params.withinDays) push('RENEWAL_DELAY', [{ k: 'daysToEnd', v: days }, { k: 'renewal', v: 'none recorded' }]);
    }
    if (rating.unverifiedSignals.length) push('UNVERIFIED_SIGNAL', rating.unverifiedSignals.map(s => ({ k: s.id, v: 'source=' + s.source + (s.note ? ' · ' + s.note : '') })));
    out.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);
    return out;
  }

  /** Merge freshly detected alerts into persisted state. States survive; cleared auto-alerts get clearedAt; history is kept. */
  function merge(persisted, detected, asOf) {
    const byId = {}; for (const p of persisted) byId[p.alertId] = p;
    const seen = new Set();
    for (const d of detected) {
      seen.add(d.alertId); const p = byId[d.alertId];
      if (!p) { const row = Object.assign({}, d, { status: 'OPEN', firstDetectedAt: asOf, lastDetectedAt: asOf, clearedAt: null, notes: [] }); persisted.push(row); byId[d.alertId] = row; }
      else {
        Object.assign(p, { severity: d.severity, action: d.action, title: d.title, evidence: d.evidence, lastDetectedAt: asOf, assignedScm: p.assignedScm || d.assignedScm });
        if (p.clearedAt) {                                                                          // re-occurrence after a clear reopens (even if it was dismissed)
          p.clearedAt = null; delete p.autoCleared;
          if (p.status === 'RESOLVED' || p.status === 'DISMISSED') { p.status = 'OPEN'; (p.notes = p.notes || []).push({ at: asOf, by: 'SYSTEM', text: 'reopened: condition re-occurred after clearing' }); }
        } else if (p.status === 'RESOLVED') {                                                       // manual RESOLVED while the condition persists is not accepted
          p.status = 'OPEN'; (p.notes = p.notes || []).push({ at: asOf, by: 'SYSTEM', text: 'reopened: marked resolved but the condition is still present' });
        }
      }
    }
    for (const p of persisted) if (p.source === 'AUTO' && !seen.has(p.alertId) && !p.clearedAt) { p.clearedAt = asOf; if (p.status !== 'DISMISSED') p.status = 'RESOLVED'; p.autoCleared = true; }
    return persisted;
  }
  const isActive = a => !a.clearedAt && a.status !== 'RESOLVED' && a.status !== 'DISMISSED';
  return { SEV_RANK, STATUSES, RULE_TEXT, ACTION_TEXT, detect, merge, isActive };
});
