/* Hotel prepayment credit rating: 12 criteria, Unknown-aware, flag caps, confidence, recoverability (separate axis). */
(function (root, factory) {
  const NS = root.OMH || (root.OMH = {});
  const api = factory(typeof require === 'function' ? { W: require('./weighted.js') } : { W: NS.Weighted });
  NS.Rating = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis, function (dep) {
  'use strict';
  const { W } = dep;
  const B = (ko, en) => ({ ko, en });
  const CRITERIA = [
    { id: 'legalEntity', name: B('계약 상대방의 법적 실체', 'Counterparty legal substance'), why: B('반환 청구의 상대가 실존·유효한가가 모든 회수의 전제', 'Recovery presupposes a real, valid counterparty') },
    { id: 'operatingStability', name: B('호텔·운영사 영업 안정성', 'Hotel / operator operating stability'), why: B('현재 영업 실적과 운영 연속성', 'Current trading performance and operator continuity') },
    { id: 'financialHealth', name: B('재무 건전성', 'Financial health'), why: B('호텔·운영사의 지급 능력', 'Ability of hotel/operator to repay') },
    { id: 'ownershipChange', name: B('운영사·소유주 변경 위험', 'Operator / owner change risk'), why: B('변경 시 선급금 채무 승계가 불명확해짐', 'Prepayment liability succession becomes unclear') },
    { id: 'settlementHistory', name: B('과거 정산·반환 이력', 'Settlement & refund track record'), why: B('과거 행동이 가장 좋은 선행 지표', 'Past behaviour is the strongest predictor') },
    { id: 'consumptionVsPrepay', name: B('선급금 대비 판매·소진 수준', 'Consumption vs prepaid balance'), why: B('소진되지 않는 선급은 곧 대손 노출', 'Unconsumed prepayment is unrecovered exposure') },
    { id: 'refundability', name: B('계약상 선급금 반환 가능성', 'Contractual refundability'), why: B('반환 조항이 없으면 미소진 잔액 회수 근거가 없음', 'No refund clause = no basis to recover unused balance') },
    { id: 'collateral', name: B('보증·담보 확보 수준', 'Guarantee / collateral'), why: B('무담보 노출을 직접 줄임', 'Directly reduces unsecured exposure') },
    { id: 'reconAccuracy', name: B('잔액 대사 정확성', 'Balance reconciliation accuracy'), why: B('양측 장부 불일치는 분쟁·통제 약점의 신호', 'Book mismatch signals dispute / control weakness') },
    { id: 'continuity', name: B('영업 지속 가능성', 'Business continuity outlook'), why: B('리노베이션·매각·임차 만료 등 전망', 'Renovation, sale, lease expiry outlook') },
    { id: 'scmOps', name: B('SCM 운영 평가', 'SCM operations assessment'), why: B('현장 담당자의 정성 판단. 주관이라 점수에서 뺐고 SCM 의견란에만 적는다', 'Field judgement. Subjective, so kept out of the score; written only in the SCM opinion') },
    { id: 'countryLegal', name: B('국가·법적 회수 위험', 'Country / legal recovery risk'), why: B('관할별 채권 회수 난이도', 'Jurisdictional collection difficulty') },
  ];
  const CRITERIA_IDS = CRITERIA.map(c => c.id);
  const ORDER = ['A', 'B', 'C', 'D'];
  const FLAG_META = {
    CLOSURE_CONFIRMED: B('휴·폐업·압류·부도 확인(검증됨)', 'Suspension / closure / seizure / insolvency confirmed (verified)'),
    REFUND_REFUSED: B('선급금 반환 거절(검증됨)', 'Refund refusal (verified)'),
    ENTITY_FAILED: B('계약 상대방 법적 실체 확인 실패', 'Counterparty legal-entity verification failed'),
    LEGAL_RECOVERY_CRITICAL: B('중대한 법적 회수 위험(검증됨)', 'Critical legal recovery risk (verified)'),
    REFUND_OVERDUE: B('반환 기한 경과', 'Refund overdue'),
    RECON_MAJOR_MISMATCH: B('중대한 잔액 불일치', 'Major balance mismatch'),
    OWNERSHIP_CHANGE_UNRESOLVED: B('운영사·소유주 변경 미정리', 'Operator/owner change unresolved'),
    ENTITY_UNKNOWN: B('계약 상대방 실체 미확인', 'Counterparty entity unverified'),
    CONSUMPTION_COLLAPSE: B('소진 속도 급감', 'Consumption collapse'),
    EXPIRY_BEFORE_DEPLETION: B('만기 전 소진 불가', 'Cannot deplete before expiry'),
    LOW_CONFIDENCE: B('평가 근거 부족(신뢰도 낮음)', 'Low evidence confidence'),
  };
  // Heuristic only (real control = account type from the identity provider): leading token of a service-style name, or well-known compound names.
  const NOT_HUMAN = /^(ai|mock|bot|auto|system|service|svc|script|agent|gpt|llm|claude|robot|cron|batch)(?![a-z])|^(automation|autobot|aibot|chatbot|autoimport)/i;     // leading token only: 'AI-bot' blocked, 'Aiden' / 'Automotive Lee' allowed
  /** A claim becomes a FACT only with a named human verifier AND an evidence reference. AI / news alone never does. */
  function isVerified(claim) {
    return !!(claim && claim.claimed && hasEvidence(claim.verified));
  }
  function hasEvidence(v) {
    return !!(v && typeof v.by === 'string' && v.by.trim() && !NOT_HUMAN.test(v.by.trim()) && typeof v.evidenceRef === 'string' && v.evidenceRef.trim().length >= 4);
  }
  /** Resolve raw facts + derived metrics into active flags and unverified signals. */
  function resolveFlags(hotel, contract, derived) {
    const flags = [], unverified = [];
    const add = id => flags.push(id);
    const hf = (hotel && hotel.facts) || {}, cf = (contract && contract.facts) || {};
    const claim = (id, c) => { if (!c || !c.claimed) return; if (isVerified(c)) add(id); else unverified.push({ id, source: c.source || 'UNKNOWN', note: c.note || '' }); };
    claim('CLOSURE_CONFIRMED', hf.closure); claim('REFUND_REFUSED', cf.refundRefused); claim('LEGAL_RECOVERY_CRITICAL', cf.legalRecoveryCritical);
    // VERIFIED / FAILED count only with a named human verifier and an evidence reference; otherwise the entity stays unverified.
    const cv = cf.counterpartyVerification, cvOk = hasEvidence(cf.counterpartyEvidence);
    if (cv === 'FAILED' && cvOk) add('ENTITY_FAILED');
    else if (cv === 'VERIFIED' && cvOk) { /* verified */ }
    else { add('ENTITY_UNKNOWN'); if (cv === 'FAILED') unverified.push({ id: 'ENTITY_FAILED', source: 'UNEVIDENCED', note: 'failed status without evidence' }); }
    if (hf.ownershipChange === 'PENDING' || hf.ownershipChange === 'COMPLETED_UNRESOLVED') add('OWNERSHIP_CHANGE_UNRESOLVED');
    const d = derived || {};
    if (d.refundOverdue) add('REFUND_OVERDUE');
    if (d.reconMajor) add('RECON_MAJOR_MISMATCH');
    if (d.consumptionCollapse) add('CONSUMPTION_COLLAPSE');
    if (d.expiryBeforeDepletion) add('EXPIRY_BEFORE_DEPLETION');
    return { flags, unverified };
  }
  function validateScores(scores) {
    const errs = [];
    for (const k of Object.keys(scores || {})) {
      if (!CRITERIA_IDS.includes(k)) errs.push('E_CRITERION_UNKNOWN:' + k);
      else { const v = scores[k]; if (v != null && !(Number.isInteger(v) && v >= 1 && v <= 5)) errs.push('E_SCORE_RANGE:' + k); }
    }
    return errs;
  }
  /** Scores that follow from the data alone: nobody picks them, so the same data always gives the same score.
   *  Returns { scores: {criterionId: 1..5 | null}, basis: {criterionId: {code, args, need}} }. A null score = Unknown: the data needed to compute it is missing,
   *  and `need` names what would settle it. Rules and cut-offs live in cfg.scoring (provisional). */
  function autoScores(input) {
    const { contract, hotel, balance, forecast: f, recon, derived, cfg } = input; const sc = cfg.scoring; const scores = {}, basis = {};
    const set = (id, score, code, args, need) => { scores[id] = score; basis[id] = { code, args: args || [], need: need || null }; };
    const bal = Math.max(0, (balance && balance.closingMinor) || 0); const cf = (contract && contract.facts) || {}; const hf = (hotel && hotel.facts) || {};
    // consumption against the prepaid balance
    if (f.status === 'NOT_APPLICABLE') set('consumptionVsPrepay', null, 'NOT_APPLICABLE');
    else if (bal === 0) set('consumptionVsPrepay', 5, 'NO_BALANCE');
    else if (f.status === 'NO_CONSUMPTION') set('consumptionVsPrepay', 1, 'NO_CONSUMPTION');
    else if (f.monthsOfCover == null) set('consumptionVsPrepay', null, 'NO_DATA', [], 'CONSUMPTION_DATA');
    else {
      let s = 1; for (let i = 0; i < sc.coverMonths.length; i++) if (f.monthsOfCover <= sc.coverMonths[i]) { s = 5 - i; break; }
      const short = f.depletesBeforeEnd === false && !!contract.endDate; if (short) s = Math.max(1, s - sc.endShortfallPenalty);
      set('consumptionVsPrepay', s, short ? 'COVER_END' : 'COVER', [f.monthsOfCover]);
    }
    // refund clause in the contract
    const rt = contract.refund ? contract.refund.refundable : null;
    if (rt === true) set('refundability', 5, 'REFUND_YES'); else if (rt === false) set('refundability', 1, 'REFUND_NO'); else set('refundability', null, 'REFUND_UNKNOWN', [], 'REFUND_TERMS');
    // collateral against the balance
    const col = contract.collateral;
    if (bal === 0) set('collateral', 5, 'NO_BALANCE');
    else if (!col) set('collateral', 1, 'NO_COLLATERAL', [], 'COLLATERAL_DOC');
    else if (!col.verified || col.currency !== contract.currency) set('collateral', null, 'COLLATERAL_UNVERIFIED', [], 'COLLATERAL_DOC');
    else { const r = (col.amountMinor || 0) / bal, cr = sc.collateralRatios; set('collateral', r >= cr[0] ? 5 : r >= cr[1] ? 4 : r >= cr[2] ? 3 : r > 0 ? 2 : 1, 'COLLATERAL_RATIO', [Math.round(r * 100)]); }
    // balance reconciliation with the hotel
    if (recon.status === 'UNCONFIRMED') set('reconAccuracy', null, 'RECON_NONE', [], 'HOTEL_CONFIRMATION');
    else if (recon.stale) set('reconAccuracy', null, 'RECON_STALE', [recon.confirmedAt], 'HOTEL_CONFIRMATION');
    else { const k = recon.status === 'CURRENCY_MISMATCH' ? 'MAJOR' : recon.status; set('reconAccuracy', sc.reconScores[k], 'RECON_' + k, [recon.pctBp == null ? 0 : recon.pctBp / 100]); }
    // refund / settlement track record: only what the refund tracking of this contract shows
    const rf = contract.refund || {};
    if (rf.requested) { if (derived.refundOverdue) set('settlementHistory', 1, 'REFUND_LATE'); else if (derived.refundOutstandingMinor > 0) set('settlementHistory', 3, 'REFUND_PENDING'); else set('settlementHistory', 5, 'REFUND_DONE'); }
    else set('settlementHistory', null, 'SETTLE_NONE', [], 'SETTLEMENT_RECORD');
    // legal recovery by country (fixed table)
    const cs = hotel && Object.prototype.hasOwnProperty.call(sc.countryLegal, hotel.country) ? sc.countryLegal[hotel.country] : null;
    if (Number.isInteger(cs)) set('countryLegal', cs, 'COUNTRY', [hotel.country]); else set('countryLegal', null, 'COUNTRY_NONE', [], 'COUNTRY_TABLE');
    // counterparty entity: only a verified status with a named verifier and evidence counts
    const evOk = hasEvidence(cf.counterpartyEvidence);
    if (cf.counterpartyVerification === 'VERIFIED' && evOk) set('legalEntity', 5, 'ENTITY_OK'); else if (cf.counterpartyVerification === 'FAILED' && evOk) set('legalEntity', 1, 'ENTITY_FAILED'); else set('legalEntity', null, 'ENTITY_NONE', [], 'ENTITY_EVIDENCE');
    // operator / owner change: a recorded status only
    const OWN = { NONE: 5, COMPLETED_RESOLVED: 4, PENDING: 2, COMPLETED_UNRESOLVED: 1 };
    if (Object.prototype.hasOwnProperty.call(OWN, hf.ownershipChange)) set('ownershipChange', OWN[hf.ownershipChange], 'OWNER_' + hf.ownershipChange); else set('ownershipChange', null, 'OWNER_UNKNOWN', [], 'OWNERSHIP_CHECK');
    // needs outside information that the program does not have yet
    for (const id of ['operatingStability', 'financialHealth', 'continuity']) set(id, null, 'EXTERNAL', [], 'EXTERNAL_INFO');
    set('scmOps', null, 'SCM_EXCLUDED');
    return { scores, basis };
  }
  /** Core evaluation. scores: {criterionId: 1..5 | null/missing = Unknown}. */
  function evaluate(input) {
    const cfg = input.cfg; const scores = input.scores || {};
    const items = CRITERIA.map(c => ({ id: c.id, score: scores[c.id] == null ? null : scores[c.id], weight: cfg.weights[c.id] }));
    const ws = W.weightedScore(items, 5);
    const th = [['A', cfg.ratingThresholds.A], ['B', cfg.ratingThresholds.B], ['C', cfg.ratingThresholds.C]];
    const scoreGrade = W.gradeFor(ws.score == null ? null : Math.round(ws.score * 1e9) / 1e9, th, 'D'); // 1e-9 guard: float noise must not flip a boundary grade                   // grade by score alone (null when nothing known)
    const { flags: resolved, unverified } = resolveFlags(input.hotel, input.contract, input.derived);
    const flags = resolved.slice();
    if (ws.coverage < cfg.lowConfidenceCoverage) flags.push('LOW_CONFIDENCE');
    const flagDetail = flags.map(id => ({ id, cap: cfg.flagCaps[id] || null }));
    let grade = scoreGrade; const reasons = [];
    const notRated = ws.coverage < cfg.minCoverage;
    for (const f of flagDetail) if (f.cap && grade && W.worse(grade, f.cap, ORDER) !== grade) { grade = f.cap; reasons.push('CAP:' + f.id); }
    const hasDCap = flagDetail.some(f => f.cap === 'D');
    if (notRated && !hasDCap) { grade = 'NR'; reasons.push('NOT_RATED_LOW_COVERAGE'); }
    if (grade == null) grade = hasDCap ? 'D' : 'NR';
    const unknownIds = items.filter(i => i.score == null && i.weight > 0).map(i => i.id);
    const level = ws.coverage >= 0.85 ? 'HIGH' : ws.coverage >= cfg.lowConfidenceCoverage ? 'MEDIUM' : 'LOW';
    return {
      score: ws.score == null ? null : Math.round(ws.score * 10) / 10, rawScore: ws.score, scoreGrade, grade, capped: grade !== scoreGrade && grade !== 'NR',
      flags: flagDetail, unverifiedSignals: unverified, reasons,
      confidence: { coverage: ws.coverage, pct: Math.round(ws.coverage * 100), level, knownWeight: ws.knownWeight, totalWeight: ws.totalWeight, unknownIds },
      provisional: !!cfg.provisional,
    };
  }
  const gradeIndex = g => (g === 'NR' ? 3 : ORDER.indexOf(g));
  /** Rating-drop notches versus the best grade committed inside the window (NR counts as D). */
  function dropNotches(history, liveGrade, asOf, windowDays, Dates) {
    const recent = (history || []).filter(h => { const d = Dates.diffDays(h.at, asOf); return d >= 0 && d <= windowDays; });
    if (!recent.length || liveGrade == null) return 0;
    const best = Math.min(...recent.map(h => gradeIndex(h.grade)));
    return Math.max(0, gradeIndex(liveGrade) - best);
  }
  /** Recoverability — a SEPARATE axis from credit grade. */
  function recoverability(contract, balanceMinor, ratingResult, scores) {
    const why = []; const flagIds = ratingResult.flags.map(f => f.id);
    const bal = Math.max(0, balanceMinor || 0);
    const c = contract.collateral;
    const coll = c && c.verified && c.currency === contract.currency ? c.amountMinor || 0 : 0;
    const unsecured = Math.max(0, bal - coll);
    const refundable = contract.refund ? contract.refund.refundable : null;
    let tier;
    if (flagIds.some(f => ['CLOSURE_CONFIRMED', 'REFUND_REFUSED', 'ENTITY_FAILED', 'LEGAL_RECOVERY_CRITICAL'].includes(f))) { tier = 'LOW'; why.push('CRITICAL_FLAG'); }
    else if (bal > 0 && coll >= bal) { tier = 'HIGH'; why.push('FULLY_COLLATERALISED'); }
    else if (refundable === false) { tier = 'LOW'; why.push('NON_REFUNDABLE'); }
    else if (refundable == null) { tier = 'UNKNOWN'; why.push('REFUND_TERMS_UNKNOWN'); }
    else if ((scores && scores.countryLegal) >= 3) { tier = 'MEDIUM'; why.push('REFUNDABLE_UNSECURED'); }
    else { tier = 'UNKNOWN'; why.push('LEGAL_RECOVERY_UNASSESSED'); }
    return { tier, unsecuredMinor: unsecured, collateralMinor: coll, refundable, why };
  }
  return { CRITERIA, CRITERIA_IDS, ORDER, FLAG_META, isVerified, hasEvidence, resolveFlags, validateScores, autoScores, evaluate, dropNotches, recoverability, gradeIndex };
});
