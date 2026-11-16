/* Prepayment credit review (선급금 신용 심사) — the CEO's 100-point standard of 2026-11-13.
   PURE: no state, no clock. Two reviewers (sales = SCM, finance = 경영지원) answer every item with GOOD (1) / CAUTION (0.5) / ISSUE (0) / UNCHECKED (0);
   the lower of the two scores decides the grade; a knock-out item answered ISSUE makes the grade D; the same person on both sides gives no judgement;
   only a lower score at or above the submit line goes to the CEO's approval. Every value below the item list lives in cfg.review (approved by the CEO). */
(function (root, factory) {
  const NS = root.OMH || (root.OMH = {});
  const api = factory();
  NS.Review = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';
  const B = (ko, en) => ({ ko, en });
  /** Areas and items in the order of the CEO's table. w = points (the five areas add up to 100); knock-out items carry no points. */
  const AREAS = [
    { id: 'LEGAL', name: B('법적 상태', 'Legal status'), items: [
      { id: 'L1', w: 8, name: B('사업자 상태(계속·휴업·폐업)', 'Business status (operating, suspended, closed)'), src: B('국가별 공공 조회(국세청·法人番号·기업등록포털·DBD·ACRA)', 'Public registry of the country') },
      { id: 'L2', w: 6, name: B('대표·임원·상호 변경 없음(6개월)', 'No change of representative, officers or name (6 months)'), src: B('법인등기', 'Corporate registry') },
      { id: 'L3', w: 6, name: B('소송·회생·파산 없음', 'No litigation, rehabilitation or bankruptcy'), src: B('법인등기, 신용평가사 공공정보', 'Registry, credit-bureau public data') }] },
    { id: 'FIN', name: B('재무·신용', 'Finance and credit'), items: [
      { id: 'F1', w: 12, name: B('신용평가 등급', 'Credit rating'), src: B('신용평가사(유료)', 'Credit bureau (paid)') },
      { id: 'F2', w: 8, name: B('국세·지방세 체납 없음', 'No tax arrears'), src: B('완납증명서(호텔 제출)', 'Tax clearance (submitted by the hotel)') },
      { id: 'F3', w: 5, name: B('재무제표 2년(적자·자본잠식 없음)', 'Two years of financials (no loss, no capital impairment)'), src: B('공시 또는 호텔 제출', 'Public filing or hotel submission') }] },
    { id: 'OWN', name: B('소유·담보', 'Ownership and security'), items: [
      { id: 'O1', w: 6, name: B('건물 소유 운영(임차면 주의, 분쟁이면 문제)', 'Operates its own building (lease = caution, dispute = issue)'), src: B('등기부 갑구, 임대차계약서', 'Land registry, lease') },
      { id: 'O2', w: 6, name: B('근저당 과다·가압류·경매 없음', 'No excessive mortgage, attachment or auction'), src: B('등기부 갑·을구, 법원경매정보', 'Land registry, court auction data') },
      { id: 'O3', w: 3, name: B('같은 건물에 다른 호텔·운영사 없음', 'No other hotel or operator in the same building'), src: B('주소 검색, OTA 리스팅', 'Address search, OTA listings') }] },
    { id: 'HIST', name: B('거래 이력', 'Our trading history'), items: [
      { id: 'H1', w: 7, name: B('직접 거래 기간(12개월 이상 양호, 3개월 미만 문제)', 'Direct trading length (12+ months good, under 3 months issue)'), src: B('ELLIS 예약 기록', 'ELLIS booking records') },
      { id: 'H2', w: 6, name: B('월 판매 추이(3개월)', 'Monthly sales trend (3 months)'), src: B('ELLIS 체크아웃', 'ELLIS check-outs') },
      { id: 'H3', w: 6, name: B('선급 소진·반환 이력', 'Prepayment usage and refund record'), src: B('선급 원장', 'Prepayment ledger') },
      { id: 'H4', w: 6, name: B('미지급·미수·청구 오류·잔액 차이 없음', 'No unpaid, unreceived, invoice errors or balance gaps'), src: B('경영지원 정산·지급 기록', 'Finance settlement and payment records') }] },
    { id: 'REP', name: B('평판', 'Reputation'), items: [
      { id: 'R1', w: 5, name: B('OTA 리뷰 점수 유지', 'OTA review score holds'), src: B('OTA 리뷰', 'OTA reviews') },
      { id: 'R2', w: 5, name: B('폐업·임금 체불·매각 소문 없음', 'No closure, unpaid wages or sale rumours'), src: B('뉴스, 현지 SCM', 'News, local SCM') },
      { id: 'R3', w: 5, name: B('다른 OTA 선급·급격한 가격 인하 없음', 'No other-OTA prepayment or sharp price cuts'), src: B('현지 SCM, 요금 이력', 'Local SCM, rate history') }] },
    { id: 'KO', name: B('탈락 확인', 'Knock-out checks'), items: [
      { id: 'K1', w: 0, name: B('입금 계좌 명의 = 계약 사업자', 'Payee name equals the contracting business'), src: B('통장 사본(계좌번호는 저장하지 않음), 사업자등록증', 'Bank-book copy (the account number is not stored), business registration') },
      { id: 'K2', w: 0, name: B('승계·명도 분쟁 없음', 'No succession or eviction dispute'), src: B('등기부, 임대차, 호텔 확인서', 'Registry, lease, hotel letter') },
      { id: 'K3', w: 0, name: B('운영 정상·연락 가능', 'Operating and reachable'), src: B('현장·전화', 'Site visit, phone') }] },
  ];
  const ITEMS = []; for (const a of AREAS) for (const it of a.items) ITEMS.push(Object.assign({ area: a.id }, it));
  const ITEM_IDS = ITEMS.map(i => i.id);
  const ANSWERS = ['GOOD', 'CAUTION', 'ISSUE', 'UNCHECKED'];
  const SIDES = ['SALES', 'SUPPORT'];

  const round1 = x => Math.round(x * 10) / 10;
  const gradeOf = (score, knockout, cfg) => knockout ? 'D' : score >= cfg.gradeBands.A ? 'A' : score >= cfg.gradeBands.B ? 'B' : score >= cfg.gradeBands.C ? 'C' : 'D';

  /** Errors for a set of answers: unknown item ids or values outside GOOD / CAUTION / ISSUE / UNCHECKED. */
  function validateAnswers(answers) {
    const errs = []; if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return ['E_ARGUMENT'];
    for (const k of Object.keys(answers)) { if (!ITEM_IDS.includes(k)) errs.push('E_REVIEW_ITEM_UNKNOWN:' + k); else if (!ANSWERS.includes(answers[k])) errs.push('E_REVIEW_ANSWER_INVALID:' + k); }
    return errs;
  }

  /** One reviewer's score. An item that was not answered counts as UNCHECKED (0 points). */
  function sideScore(answers, cfg) {
    const f = cfg.answerFactor; const ko = new Set(cfg.knockout); let points = 0, uncheckedW = 0, unchecked = 0, answered = 0; const issues = []; let knockout = false;
    for (const it of ITEMS) {
      const a = (answers && answers[it.id]) || 'UNCHECKED'; points += it.w * f[a]; if (a === 'UNCHECKED') { unchecked++; uncheckedW += it.w; } else answered++;
      if (a === 'ISSUE') { issues.push(it.id); if (ko.has(it.id)) knockout = true; }
    }
    const score = round1(points); return { score, grade: gradeOf(score, knockout, cfg), knockout, issues, unchecked, uncheckedWeight: uncheckedW, answered, total: ITEMS.length };
  }

  const same = (a, b) => String(a == null ? '' : a).trim().toLowerCase() === String(b == null ? '' : b).trim().toLowerCase();
  /**
   * rec = { sales: { reviewer, answers }, support: { reviewer, answers } } (either side may be missing).
   * status: NOT_STARTED | WAITING (only one side done) | REVIEWER_MISSING | SAME_REVIEWER | DECIDED. Only DECIDED has a grade; the others are 'NR' (not reviewed yet).
   */
  function decide(rec, cfg) {
    const r = rec || {}; const have = s => !!(s && s.answers && typeof s.answers === 'object'); const hasS = have(r.sales), hasF = have(r.support);
    const out = { status: 'NOT_STARTED', sales: hasS ? sideScore(r.sales.answers, cfg) : null, support: hasF ? sideScore(r.support.answers, cfg) : null, lowerScore: null, grade: 'NR', knockout: false, submit: false, reasons: [], lowerSide: null };
    if (!hasS && !hasF) return out;
    if (!hasS || !hasF) { out.status = 'WAITING'; return out; }
    if (!String(r.sales.reviewer || '').trim() || !String(r.support.reviewer || '').trim()) { out.status = 'REVIEWER_MISSING'; out.reasons.push('REVIEWER_MISSING'); return out; }
    if (same(r.sales.reviewer, r.support.reviewer)) { out.status = 'SAME_REVIEWER'; out.reasons.push('SAME_REVIEWER'); return out; }
    out.status = 'DECIDED'; out.lowerSide = out.sales.score <= out.support.score ? 'SALES' : 'SUPPORT'; out.lowerScore = Math.min(out.sales.score, out.support.score); out.knockout = out.sales.knockout || out.support.knockout;
    out.grade = gradeOf(out.lowerScore, out.knockout, cfg); if (out.knockout) out.reasons.push('KNOCKOUT');
    if (out.lowerScore < cfg.submitMin) out.reasons.push('BELOW_SUBMIT_MIN');
    out.submit = !out.knockout && out.lowerScore >= cfg.submitMin; return out;
  }

  return { AREAS, ITEMS, ITEM_IDS, ANSWERS, SIDES, validateAnswers, sideScore, decide, gradeOf };
});
