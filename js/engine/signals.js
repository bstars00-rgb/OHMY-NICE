/* Weekly hotel signals S1-S8 (신호) — the CEO's traffic-light rules of 2026-11-13.
   PURE: numbers in, colours out. green 'ok' / yellow 'warn' / red 'bad' / 'na' (waiting for data: never guessed) / 'off' (deposits, buyouts, monthly-settlement blocks and closed accounts have no signals).
   The hotel colour is the worst signal. Red blocks the top-up request (and asks for a refund or transfer proposal within 24 hours), yellow holds it (cause check within one week).
   Every threshold lives in cfg.review.signals (approved by the CEO). The program never decides: it shows and holds; the CEO decides.                                              */
(function (root, factory) {
  const NS = root.OMH || (root.OMH = {});
  const api = factory(typeof require === 'function' ? { Dates: require('../core/dates.js') } : { Dates: NS.Dates });
  NS.Signals = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis, function (dep) {
  'use strict';
  const { Dates } = dep; const B = (ko, en) => ({ ko, en });
  const RANK = { ok: 0, warn: 1, bad: 2 };
  const NAMES = {
    S1: B('소진 개월(잔액 ÷ 최근 3개월 월평균 소진)', 'Months of cover (balance / 3-month average usage)'), S2: B('소진 급감(지난달 ÷ 그 전 3개월 평균)', 'Usage drop (last month / prior 3-month average)'), S3: B('계획 대비(누적 소진 ÷ 계약 때 예상 누적)', 'Against plan (cumulative usage / planned)'),
    S4: B('소진 공백(마지막 소진 후 경과 일)', 'Usage gap (days since the last usage)'), S5: B('만료 잔액(종료일 예상 잔액 ÷ 예치 총액)', 'Balance at expiry (expected balance at the end / total deposited)'), S6: B('잔액 대사(호텔 확인 잔액과 장부)', 'Balance match (hotel-confirmed balance and the books)'),
    S7: B('한도 대비(잔액 ÷ 한도)', 'Against the limit (balance / limit)'), S8: B('위험 신호(계약·현장 위험 코드)', 'Risk flags (contract and site codes)'),
  };
  /** Risk codes: C = severe, G = general. Typed in by the SCM; the same codes as the CEO's dashboard. */
  const FLAGS = {
    C1: { sev: 'C', name: B('소유주·운영사 변경, 승계·명도', 'Owner or operator change, succession or eviction') }, C2: { sev: 'C', name: B('가압류·압류·체납', 'Attachment, seizure or tax arrears') }, C3: { sev: 'C', name: B('휴·폐업, 운영 중단, 연락 두절', 'Suspended or closed, unreachable') },
    C4: { sev: 'C', name: B('매각·폐업 소문, 임금·거래처 미지급', 'Sale or closure rumours, unpaid wages or vendors') }, C5: { sev: 'C', name: B('입금 계좌 명의가 계약 사업자와 다름', 'Payee account differs from the contracting business') },
    G1: { sev: 'G', name: B('임차 운영·분양형 위탁', 'Leased or condo-hotel managed operation') }, G2: { sev: 'G', name: B('같은 건물에 다른 호텔·운영사', 'Another hotel or operator in the same building') }, G3: { sev: 'G', name: B('직접 거래 3개월 미만·총판 해지 직후', 'Direct trade under 3 months, or a general agent just ended') },
    G4: { sev: 'G', name: B('호텔이 선급을 먼저 요청', 'The hotel asked for prepayment first') }, G5: { sev: 'G', name: B('급격한 가격 인하·큰 할인 조건', 'Sharp price cuts or deep discount terms') }, G6: { sev: 'G', name: B('다른 OTA 선급 집중', 'Large prepayments from other OTAs') },
    G7: { sev: 'G', name: B('리뷰 급락·직원 이탈·응답 지연', 'Review drop, staff loss, slow replies') }, G8: { sev: 'G', name: B('세금계산서·잔액 확인서 거부·지연', 'Refuses or delays the tax invoice or balance letter') },
  };
  const high = (v, p) => v > p[1] ? 'bad' : v > p[0] ? 'warn' : 'ok';           // larger is worse (S1, S4, S7)
  const low = (v, p) => v < p[1] ? 'bad' : v < p[0] ? 'warn' : 'ok';            // smaller is worse (S2, S3)
  const worst = list => { const l = list.filter(c => c in RANK); return l.length ? l.reduce((w, c) => RANK[c] > RANK[w] ? c : w, 'ok') : 'na'; };
  const monthEnd = key => Dates.addDays(Dates.addMonths(key, 1) + '-01', -1);

  /**
   * input: { off, hasData, closed, balanceMinor, depositTotalMinor, avgMinor (last 3 months, null = unknown), consByMonth {'YYYY-MM': minor}, firstMonth (first month with recorded usage), startDate, planFrom (where the plan comparison starts: the later of the start date and the first usage record), endDate, planMonthlyMinor,
   *          recon { status, confirmedAt, diffMinor } (status UNCONFIRMED = none), limitMinor, riskFlags [codes], grade, prevGrade, asOf, cfg }
   * -> { off, color, sig: { S1..S8: { c, v } }, naCount, reasons: [] }
   */
  function compute(input) {
    const { asOf, cfg } = input; const sg = cfg.review.signals; const out = { off: false, color: 'na', sig: {}, naCount: 0, reasons: [] };
    if (input.off) { out.off = true; out.color = 'off'; return out; }
    if (!input.hasData) { for (const k of Object.keys(NAMES)) out.sig[k] = { c: 'na', v: null }; out.naCount = 8; return out; }
    const bal = input.balanceMinor, avg = input.avgMinor, by = input.consByMonth || {}; const lastDone = Dates.prevMonths(asOf, 1)[0];
    // S1 months of cover
    if (bal <= 0) out.sig.S1 = { c: 'ok', v: null }; else if (avg == null) out.sig.S1 = { c: 'na', v: null }; else if (avg <= 0) out.sig.S1 = { c: 'bad', v: null }; else { const m = bal / avg; out.sig.S1 = { c: high(m, sg.S1), v: Math.round(m * 10) / 10 }; }
    // S2 the last completed month against the three months before it
    const prev = Dates.prevMonths(lastDone + '-15', 3).filter(k => (input.firstMonth == null || k >= input.firstMonth)); const hasLast = input.firstMonth != null && lastDone >= input.firstMonth;
    if (hasLast && prev.length) { const pa = prev.reduce((s, k) => s + (by[k] || 0), 0) / prev.length; out.sig.S2 = pa > 0 ? (() => { const r = (by[lastDone] || 0) / pa; return { c: low(r, sg.S2), v: Math.round(r * 100) / 100 }; })() : { c: 'na', v: null }; } else out.sig.S2 = { c: 'na', v: null };
    // S3 cumulative usage against the plan
    if (input.planMonthlyMinor > 0 && (input.planFrom || input.startDate)) { const el = Math.max(0, Dates.diffDays(input.planFrom || input.startDate, monthEnd(lastDone)) / 30.4); const used = Object.keys(by).filter(k => k <= lastDone).reduce((s, k) => s + by[k], 0); const plan = input.planMonthlyMinor * el; out.sig.S3 = plan > 0 ? (() => { const r = used / plan; return { c: low(r, sg.S3), v: Math.round(r * 100) / 100 }; })() : { c: 'na', v: null }; } else out.sig.S3 = { c: 'na', v: null };
    // S4 days since the last usage. Usage is recorded by month, so a month with usage counts as fresh until the month is over; after that the gap runs from the end of the last month that had usage (before any usage: from the start)
    const usedMonths = Object.keys(by).filter(k => by[k] > 0).sort(); const lastUsed = usedMonths.length ? usedMonths[usedMonths.length - 1] : null; const ref = lastUsed ? (lastUsed >= lastDone ? asOf : monthEnd(lastUsed)) : (input.startDate || null);
    out.sig.S4 = ref ? (() => { const gap = Math.max(0, Dates.diffDays(ref, asOf)); return { c: high(gap, sg.S4), v: gap }; })() : { c: 'na', v: null };
    // S5 what is expected to be left when the contract ends, as a share of everything deposited
    if (input.endDate && avg != null && input.depositTotalMinor > 0) { const left = Math.max(0, Dates.diffDays(asOf, input.endDate) / 30.4); const proj = Math.max(0, bal - avg * left); const r = proj / input.depositTotalMinor; out.sig.S5 = { c: proj <= 0 ? 'ok' : r < sg.S5[1] ? 'warn' : 'bad', v: Math.round(r * 100) / 100 }; } else out.sig.S5 = { c: 'na', v: null };
    // S6 the hotel's own balance letter against our books, and how old it is
    const rc = input.recon; if (rc && rc.status !== 'UNCONFIRMED' && rc.confirmedAt) {
      const age = Dates.diffDays(rc.confirmedAt, asOf); const match = rc.status === 'MATCH';
      out.sig.S6 = { c: match ? (age <= sg.confirmFreshDays ? 'ok' : age <= sg.confirmStaleDays ? 'warn' : 'bad') : (age > sg.confirmGapDays ? 'bad' : 'warn'), v: rc.diffMinor == null ? null : Math.abs(rc.diffMinor), age };
    } else out.sig.S6 = { c: 'na', v: null };
    // S7 balance against the limit
    out.sig.S7 = input.limitMinor > 0 ? (() => { const r = Math.max(0, bal) / input.limitMinor; return { c: high(r, sg.S7), v: Math.round(r * 100) / 100 }; })() : { c: 'na', v: null };
    // S8 risk codes: one severe or three general = red, one or two general = yellow
    const codes = (input.riskFlags || []).filter(x => FLAGS[x]); const nc = codes.filter(x => FLAGS[x].sev === 'C').length, ng = codes.filter(x => FLAGS[x].sev === 'G').length;
    out.sig.S8 = { c: nc > 0 || ng >= 3 ? 'bad' : ng >= 1 ? 'warn' : 'ok', v: codes };
    let color = worst(Object.values(out.sig).map(s => s.c));
    if (input.closed) { color = 'bad'; out.reasons.push('CLOSED'); }
    if (input.prevGrade && input.grade && 'ABCD'.indexOf(input.grade) - 'ABCD'.indexOf(input.prevGrade) >= 2) { color = 'bad'; out.reasons.push('GRADE_DROP_2'); }       // two grades down: stop top-ups and tell the CEO at once
    if (bal < 0 && color !== 'bad') { color = 'warn'; out.reasons.push('NEGATIVE_BALANCE'); }
    out.color = color; out.naCount = Object.values(out.sig).filter(s => s.c === 'na').length; return out;
  }
  return { NAMES, FLAGS, compute, worst };
});
