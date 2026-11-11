/* Integration adapters. EVERY adapter in this prototype is a MOCK / file-based stand-in with the interface the real one must honour.
   No network I/O, no API keys, no real approvals, no money movement.                                                                   */
(function (root, factory) {
  const NS = root.OMH || (root.OMH = {});
  const api = factory(typeof require === 'function' ? { Money: require('../core/money.js'), Rating: require('../engine/rating.js') } : { Money: NS.Money, Rating: NS.Rating });
  NS.Adapters = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis, function (dep) {
  'use strict';
  const { Money } = dep;

  /** non-cryptographic 53-bit hash (cyrb53) — packet fingerprint / audit chain in the prototype */
  function hash53(str, seed) {
    let h1 = 0xdeadbeef ^ (seed || 0), h2 = 0x41c6ce57 ^ (seed || 0);
    for (let i = 0, ch; i < str.length; i++) { ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
  }

  /* ---------- approval-portal approval (2027 portal) — MOCK ---------- */
  const Portal = {
    id: 'PORTAL', mode: 'MOCK', realExecution: false,
    /** Assemble everything the hotel-prepayment approval in the approval portal must carry. Pure; no side effects. */
    buildPacket(view, sim, ctx) {
      const v = view, c = v.contract, h = v.hotel;
      const packet = {
        form: 'PORTAL-HOTEL-PREPAYMENT', mock: true, createdAt: ctx.asOf,
        hotel: { hotelId: h.hotelId, ellisHotelId: h.ellisHotelId, name: h.name, country: h.country, city: h.city },
        contract: { contractId: c.contractId, omhEntity: c.omhEntity, counterparty: c.counterparty, prepaymentType: c.prepaymentType, currency: c.currency, endDate: c.endDate,
          topUpCondition: c.topUp ? c.topUp.conditionText : null, minTopUpMinor: c.topUp ? c.topUp.minAmountMinor : null, plannedTopUp: c.plannedTopUp || null, allotment: c.allotment || null },
        rating: { grade: v.rating.grade, score: v.rating.score, confidencePct: v.rating.confidence.pct, flags: v.rating.flags.map(f => f.id), provisional: v.rating.provisional },
        balance: { currency: c.currency, currentMinor: v.balance.closingMinor },
        avgMonthlyConsumptionMinor: v.forecast.avgMinor, dataQuality: v.forecast.quality,
        recommendedLimitMinor: v.limit.recommendedLimitMinor,
        request: { requestedMinor: sim.requestedMinor, projectedExposureMinor: sim.projectedMinor, limitExceeded: sim.limitExceeded, excessMinor: sim.excessMinor, approvalReasons: sim.approvalReasons, risk: sim.risk },
        alerts: v.liveAlerts.filter(a => a.severity !== 'MEDIUM').map(a => ({ ruleId: a.ruleId, severity: a.severity, action: a.action })),
        dismissedAlerts: v.alerts.filter(a => a.status === 'DISMISSED').map(a => ({ ruleId: a.ruleId, severity: a.severity })),
        scmOpinion: ctx.scmOpinion || null, ceoStatus: 'PENDING',
        disclaimer: 'PROTOTYPE — no real approval, no fund movement.',
      };
      packet.fingerprint = hash53(JSON.stringify(packet));
      return packet;
    },
    /** Mock submit: returns an acknowledgement only. Does NOT touch the ledger. */
    submit(packet) { return { mock: true, status: 'MOCK_ACCEPTED', ref: 'MOCK-PORTAL-' + packet.fingerprint.slice(0, 8), at: packet.createdAt }; },
    execute() { const e = new Error('E_EXECUTION_DISABLED: prototype cannot execute payments or real approvals'); e.code = 'E_EXECUTION_DISABLED'; throw e; },
  };

  /* ---------- AI analysis — MOCK adapter ---------- */
  const AI = {
    id: 'AI', mode: 'MOCK', label: { ko: '모의 AI 결과(실제 AI 호출 아님)', en: 'MOCK AI output (no real model called)' },
    /** Deterministic canned analysis derived from rule-engine facts — never an independent source of amounts or grades. */
    analyzeHotel(view, asOf) {
      const v = view; const sig = v.rating.unverifiedSignals;
      const factors = [];
      if (v.hotel.facts && v.hotel.facts.ownershipChange === 'PENDING') factors.push({ ko: '운영사 변경 진행 정황(모의)', en: 'Operator change in progress (mock)', args: [], source: 'MOCK:company-registry', asOf, confidence: 'LOW', verified: false });
      for (const s of sig) factors.push({ ko: '미검증 신호: {0} ({1})', en: 'Unverified signal: {0} ({1})', args: [s.id, s.source], source: 'MOCK:' + s.source, asOf, confidence: 'LOW', verified: false });
      if (v.forecast.velocity.status === 'DOWN') factors.push({ ko: '소진 속도 하락 {0}% (규칙엔진 값 인용)', en: 'Consumption down {0}% (quoted from rule engine)', args: [v.forecast.velocity.pct], source: 'RULE_ENGINE', asOf, confidence: 'HIGH', verified: true });
      return { mock: true, hotelId: v.hotelId, contractId: v.contractId, asOf, label: AI.label, riskFactors: factors,
        summary: { ko: '모의 요약: 등급 {0}, 평가 신뢰도 {1}%. 금액·한도는 규칙엔진 결과이며 AI 산출이 아님.', en: 'Mock summary: grade {0}, confidence {1}%. Amounts/limits come from the rule engine, not AI.', args: [v.rating.grade, v.rating.confidence.pct] },
        canSetFacts: false };
    },
    /** Keyword (not semantic) extraction from pasted contract text — labelled heuristic; every hit needs human confirmation. */
    extractContractTerms(text, asOf) {
      const t = String(text || ''); const hits = [];
      const pats = [['REFUND', /(refund|반환|환불|返金)/i], ['TERMINATION', /(terminat|해지|解約)/i], ['TRANSFER', /(assign|transfer|양도|이전|譲渡)/i], ['NOTICE_DAYS', /(\d{1,3})\s*(days?|일|日)/i]];
      for (const [k, re] of pats) { const m = re.exec(t); if (m) hits.push({ clause: k, snippet: t.slice(Math.max(0, m.index - 30), m.index + 60).replace(/\s+/g, ' '), confidence: 'LOW', needsHumanConfirmation: true }); }
      return { mock: true, heuristic: true, asOf, hits };
    },
  };

  /* ---------- Data-source adapters (status only in the prototype) ---------- */
  const B2 = (ko, en) => ({ ko, en });
  const INTEGRATIONS = [
    { id: 'ELLIS', name: B2('ELLIS (판매·예약·소진)', 'ELLIS (sales / bookings / consumption)'), mode: 'SNAPSHOT (MCP)', note: B2('스냅샷 가져오기·대조 구현, 합성 데이터로만 검증. 실제 MCP 호출은 Claude 또는 서버측 클라이언트가 수행', 'Snapshot import and comparison implemented, verified with synthetic data only. Live MCP calls are made by Claude or a server-side client'), verified: false },
    { id: 'SCM_LEDGER', name: B2('SCM 대장 업로드', 'SCM ledger import'), mode: 'FILE (CSV)', note: B2('CSV 업로드 구현·테스트 완료. 자동 수집은 국가별 SCM 데이터 확정 후', 'CSV upload implemented & tested; automated sync pending country SCM data'), verified: true },
    { id: 'PORTAL', name: B2('결재 포털 — 호텔 선급 결재(2027)', 'Approval portal — hotel prepayment approval (2027)'), mode: 'MOCK', note: B2('패킷 조립과 모의 확인응답만 구현. 포털 API 미정', 'Packet builder + mock ack; portal API not defined'), verified: false },
    { id: 'AI', name: B2('AI 분석', 'AI analysis'), mode: 'MOCK', note: B2('결정적 모의 분석. API 키 없음', 'Deterministic stub; no API key configured'), verified: false },
    { id: 'AUTH', name: B2('인증 / 권한(RBAC)', 'Authentication / RBAC'), mode: 'PROTOTYPE', note: B2('화면의 역할 전환뿐이며 보안 통제가 아님', 'Client-side role switcher only — NOT a security control'), verified: false },
    { id: 'DB', name: B2('중앙 데이터베이스', 'Central database'), mode: 'BROWSER localStorage', note: B2('브라우저 한 곳에만 저장. 중앙 DB는 P2 항목', 'Single-browser storage; central DB is a P2 item'), verified: false },
  ];
  return { hash53, Portal, AI, INTEGRATIONS, Money };
});
