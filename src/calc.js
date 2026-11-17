/* OMH-NICE 2.0 — 선급·SG 지급 대시보드 계산부.
   엑셀(재무·SCM 작성 양식)에서 읽어 낸 정규화 자료를 받아 분류·소진 계산·신호·수집 현황·점검 결과를 만든다.
   화면(app.js)과 시험(tests/)이 같은 이 파일을 쓴다. 상태나 시계를 갖지 않는다(오늘 날짜는 인자로 받는다).
   양식의 엑셀 수식(분류 K열, 소진 L·M·U열, 분류 R열)과 같은 결과가 나오게 쓰고, 값은 통화 그대로 다룬다(환산·통화 간 합산 없음). */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CALC = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';
  const DAY = 86400000;
  const blank = v => v === null || v === undefined || v === '';
  const toDay = s => { if (blank(s)) return null; const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s)); if (!m) return null; return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY); };
  const daysBetween = (from, to) => { const a = toDay(from), b = toDay(to); return a === null || b === null ? null : b - a; };
  const addDays = (s, n) => { const d = toDay(s); if (d === null) return null; return new Date((d + n) * DAY).toISOString().slice(0, 10); };
  const round1 = x => Math.round(x * 10) / 10;

  /** 나라별 통화(양식의 나라·통화 선택지와 같은 범위). */
  const CCY_BY_COUNTRY = { KR: 'KRW', JP: 'JPY', VN: 'VND', TH: 'THB', SG: 'SGD', TW: 'TWD', HK: 'HKD', MY: 'MYR', MO: 'MOP' };
  const CCY_DECIMALS = { KRW: 0, JPY: 0, VND: 0, THB: 2, SGD: 2, TWD: 0, HKD: 2, MYR: 2, MOP: 2, USD: 2 };

  /** 설정: 대표 확정 기준(2026-11-13)과 양식의 약속. 값은 build가 meta로 덮어쓸 수 있다. */
  const DEFAULTS = {
    yearEnd: '2026-12-31', staleAsOfDays: 30, signalS1: [2, 4],                    // 소진 개월: 2 초과 노랑, 4 초과 빨강(대표 S1)
    diffMatchPct: 0.1, diffMinorPct: 2,                                              // 잔액 차이: 0.1% 이내 일치, 2% 이내 경미, 넘으면 큰 차이
    deadlines: { finance: '2026-11-16', scm: '2026-11-17', approval: '2026-11-20' },
    criticalWords: ['운영 중단', '폐업', '가압류', '휴업', '압류', '부도', '회생', '파산'],
  };
  const cfgOf = data => Object.assign({}, DEFAULTS, (data && data.meta && data.meta.config) || {});

  /* ================= ① 후불 지급 목록 ================= */
  /** 분류(자동): 양식 K열과 같다. PRE = 선불이라 ②로, A1 = 카드 수용, A2 = 카드 미수용·법인 계좌 등록, EXC = 예외 목록 검토(개인 계좌·현금·미등록·미확인 계좌), TBD = 확인 필요. */
  function payClass(p) {
    if (blank(p.hotel)) return 'NONE';
    if (p.kind === '선불') return 'PRE';
    if (p.card === 'O') return 'A1';
    if (p.card === 'X') return p.account === '법인 계좌 등록' ? 'A2' : 'EXC';
    return 'TBD';
  }
  /** 작성 상태: DONE 답이 끝남, UNKNOWN 미확인으로 답함, PARTIAL 카드 미수용인데 계좌 칸이 비었음, EMPTY 비었음. */
  function payFill(p) {
    if (p.card === 'O') return 'DONE';
    if (p.card === 'X') return blank(p.account) ? 'PARTIAL' : (p.account === '미확인' ? 'UNKNOWN' : 'DONE');
    if (p.card === '미확인') return 'UNKNOWN';
    return 'EMPTY';
  }

  /* ================= ② 프리바이 목록 ================= */
  /** 12/31까지 남은 일수(기준일부터). 기준일이 없으면 null. */
  const daysToYearEnd = (asOf, cfg) => { const d = daysBetween(asOf, cfg.yearEnd); return d === null ? null : Math.max(0, d); };
  /** 소진 예상 개월(L열): 잔액 ÷ 월평균 소진액, 소수 첫째 자리. 소진액이 0이거나 비면 없음. */
  const monthsOfCover = h => (blank(h.ledger) || blank(h.avg) || h.avg === 0) ? null : round1(h.ledger / h.avg);
  /** 12/31 소진 가능(M열): 남은 일수 ÷ 30 개월 동안의 예상 소진액이 잔액 이상이면 '가능'. 잔액·소진액·기준일이 모두 있어야 판정한다. */
  function canUseByYearEnd(h, cfg) {
    if (blank(h.ledger) || blank(h.avg) || blank(h.asOf)) return null;
    const d = daysToYearEnd(h.asOf, cfg); if (d === null) return null;
    return h.ledger <= h.avg * d / 30 ? '가능' : '불가';
  }
  /** 12/31 예상 잔액(U열). */
  function estYearEnd(h, cfg) {
    if (blank(h.ledger) || blank(h.avg) || blank(h.asOf)) return null;
    const d = daysToYearEnd(h.asOf, cfg); if (d === null) return null;
    return Math.max(0, h.ledger - h.avg * d / 30);
  }
  /** 참고 분류(R열): B1 이관, B2 소진, B2 반환, B2 협의 필요, 확인 필요(TBD). 이관 칸이 비었거나 미확인이면 확인 필요. */
  function prebuyClass(h, cfg) {
    if (blank(h.hotel)) return 'NONE';
    if (blank(h.transfer) || h.transfer === '미확인') return 'TBD';
    if (h.transfer === 'O') return 'B1';
    const m = canUseByYearEnd(h, cfg);
    if (m === '가능') return 'B2_USE';
    if (m === '불가') return h.refund === 'O' ? 'B2_REFUND' : 'B2_TALK';
    return 'TBD';
  }
  const gap = h => (blank(h.ledger) || blank(h.hotelBal)) ? null : h.ledger - h.hotelBal;
  const gapPct = h => { const g = gap(h); return g === null || !h.ledger ? null : Math.abs(g) / Math.abs(h.ledger) * 100; };
  /** 잔액 대조: MATCH 일치, MINOR 경미, MAJOR 큰 차이, NONE 호텔 확인 없음. */
  function reconOf(h, cfg) {
    const p = gapPct(h); if (p === null) return 'NONE';
    return p <= cfg.diffMatchPct ? 'MATCH' : p <= cfg.diffMinorPct ? 'MINOR' : 'MAJOR';
  }
  const critical = (h, cfg) => cfg.criticalWords.some(w => String(h.note || '').includes(w));
  /** 신호: S1(소진 개월) · 잔액 대조 · 중대 메모 중 가장 나쁜 색. ok / warn / bad / na. 자료가 없으면 na(초록으로 치지 않는다). */
  function prebuySignal(h, cfg) {
    const out = { s1: 'na', recon: 'na', critical: false, color: 'na' };
    const isDeposit = h.type === '보증금' || h.type === 'Deposit';
    if (!blank(h.ledger) && h.ledger > 0 && !blank(h.avg)) {
      if (isDeposit) out.s1 = 'na';
      else if (h.avg === 0) out.s1 = 'bad';
      else { const m = h.ledger / h.avg; out.s1 = m > cfg.signalS1[1] ? 'bad' : m > cfg.signalS1[0] ? 'warn' : 'ok'; }
    } else if (!blank(h.ledger) && h.ledger <= 0) out.s1 = 'ok';
    const r = reconOf(h, cfg); out.recon = r === 'NONE' ? 'na' : r === 'MATCH' ? 'ok' : r === 'MINOR' ? 'warn' : 'bad';
    out.critical = critical(h, cfg);
    const rank = { ok: 0, warn: 1, bad: 2 }; const list = [out.s1, out.recon].filter(c => c in rank);
    let color = list.length ? list.reduce((w, c) => rank[c] > rank[w] ? c : w, 'ok') : 'na';
    if (out.critical) color = 'bad'; out.color = color; return out;
  }
  /** 한 호텔의 계산 결과를 한 번에. */
  function prebuyView(h, cfg) {
    return Object.assign({}, h, { cover: monthsOfCover(h), canUse: canUseByYearEnd(h, cfg), est: estYearEnd(h, cfg), gap: gap(h), gapPct: gapPct(h), recon: reconOf(h, cfg), cls: prebuyClass(h, cfg), sig: prebuySignal(h, cfg), daysLeft: daysToYearEnd(h.asOf, cfg) });
  }
  /** 호텔별 처리 안(대표 결재 자료): 분류에 따른 권장 조치. 결정은 대표가 한다. */
  const ACTION = { B1: 'TRANSFER', B2_USE: 'CONSUME', B2_REFUND: 'REFUND', B2_TALK: 'NEGOTIATE', TBD: 'CONFIRM' };

  /* ================= 집계 ================= */
  const inc = (o, k, n) => { o[k] = (o[k] || 0) + n; };
  function paymentStats(payments) {
    const rows = payments.map(p => Object.assign({}, p, { cls: payClass(p), fill: payFill(p) }));
    const byCountry = {}, byMethod = {}; const total = { n: 0, A1: 0, A2: 0, EXC: 0, TBD: 0, PRE: 0 };
    for (const r of rows) {
      if (r.cls === 'NONE') continue; total.n++; total[r.cls]++;
      const c = byCountry[r.country] || (byCountry[r.country] = { n: 0, A1: 0, A2: 0, EXC: 0, TBD: 0, PRE: 0, avgByCcy: {} }); c.n++; c[r.cls]++; if (!blank(r.avg)) inc(c.avgByCcy, r.ccy, r.avg);
      inc(byMethod, r.method || '—', 1);
    }
    const done = rows.filter(r => r.cls !== 'NONE' && r.cls !== 'PRE' && r.fill === 'DONE').length, due = rows.filter(r => r.cls !== 'NONE' && r.cls !== 'PRE').length;
    return { rows, total, byCountry, byMethod, answered: done, due };
  }
  /** 12월 SG 직접 지급 테스트 후보: A1·A2로 확정된 호텔을 월평균 지급액이 큰 순서로. (선정 기준은 대표 결정, 여기서는 정렬만 한다.) */
  function testCandidates(rows, country, limit) {
    return rows.filter(r => (r.cls === 'A1' || r.cls === 'A2') && (!country || r.country === country) && !blank(r.avg)).sort((a, b) => b.avg - a.avg).slice(0, limit || 20);
  }
  function prebuyStats(prebuy, cfg) {
    const rows = prebuy.map(h => prebuyView(h, cfg)).filter(r => r.cls !== 'NONE');
    const byClass = {}, byCcy = {}, signals = { ok: 0, warn: 0, bad: 0, na: 0 };
    for (const r of rows) {
      const c = byClass[r.cls] || (byClass[r.cls] = { n: 0, byCcy: {} }); c.n++;
      const cc = c.byCcy[r.ccy] || (c.byCcy[r.ccy] = { n: 0, ledger: 0, hotel: 0, est: 0, estKnown: 0 }); cc.n++; cc.ledger += r.ledger || 0; cc.hotel += r.hotelBal || 0; if (r.est !== null) { cc.est += r.est; cc.estKnown++; }
      const t = byCcy[r.ccy] || (byCcy[r.ccy] = { n: 0, ledger: 0, hotel: 0, est: 0, estKnown: 0, avg: 0 }); t.n++; t.ledger += r.ledger || 0; t.hotel += r.hotelBal || 0; t.avg += r.avg || 0; if (r.est !== null) { t.est += r.est; t.estKnown++; }
      signals[r.sig.color]++;
    }
    return { rows, byClass, byCcy, signals, count: rows.length };
  }

  /* ================= 수집 현황 ================= */
  /** 재무가 써야 하는 칸(②): 대장 상 잔액, 기준일, 월평균 소진액. 한 행이 끝났으면 true. */
  const financeDone = h => !blank(h.ledger) && !blank(h.asOf) && !blank(h.avg);
  /** SCM이 써야 하는 칸(②): 호텔 확인 잔액, 이관 가능, 반환 가능(이관 불가일 때 반환을 묻는다). 미확인은 '답은 했지만 확인 못 함'. */
  function scmFill(h) {
    const miss = []; if (blank(h.hotelBal)) miss.push('hotelBal'); if (blank(h.transfer)) miss.push('transfer'); if (blank(h.refund)) miss.push('refund');
    const unknown = ['transfer', 'refund'].filter(k => h[k] === '미확인');
    return { missing: miss, unknown, done: miss.length === 0 && unknown.length === 0, answered: miss.length === 0 };
  }
  /** 조건 칸: 이관 O면 이관 조건, 반환 O면 반환 조건이 있어야 한다. */
  const conditionMissing = h => { const m = []; if (h.transfer === 'O' && blank(h.transferNote)) m.push('transferNote'); if (h.refund === 'O' && blank(h.refundNote)) m.push('refundNote'); return m; };

  function progress(data, today) {
    const cfg = cfgOf(data); const pay = paymentStats(data.payments); const pre = (data.prebuy || []).filter(h => !blank(h.hotel));
    const payDue = pay.rows.filter(r => r.cls !== 'NONE' && r.cls !== 'PRE');
    const byCountry = {}; for (const r of payDue) { const c = byCountry[r.country] || (byCountry[r.country] = { due: 0, done: 0, unknown: 0, empty: 0, partial: 0 }); c.due++; if (r.fill === 'DONE') c.done++; else if (r.fill === 'UNKNOWN') c.unknown++; else if (r.fill === 'PARTIAL') c.partial++; else c.empty++; }
    const preByCountry = {}; for (const h of pre) { const c = preByCountry[h.country] || (preByCountry[h.country] = { n: 0, finance: 0, scm: 0, scmAnswered: 0, ownerSet: 0 }); c.n++; if (financeDone(h)) c.finance++; const s = scmFill(h); if (s.done) c.scm++; if (s.answered) c.scmAnswered++; if (!blank(h.owner)) c.ownerSet++; }
    const tot = (o, k) => Object.values(o).reduce((s, c) => s + c[k], 0);
    const dl = cfg.deadlines; const left = k => (today ? daysBetween(today, dl[k]) : null);
    return {
      payments: { due: payDue.length, done: tot(byCountry, 'done'), unknown: tot(byCountry, 'unknown'), partial: tot(byCountry, 'partial'), empty: tot(byCountry, 'empty'), byCountry },
      prebuy: { n: pre.length, finance: tot(preByCountry, 'finance'), scm: tot(preByCountry, 'scm'), scmAnswered: tot(preByCountry, 'scmAnswered'), byCountry: preByCountry },
      deadlines: { finance: { date: dl.finance, daysLeft: left('finance') }, scm: { date: dl.scm, daysLeft: left('scm') }, approval: { date: dl.approval, daysLeft: left('approval') } },
    };
  }

  /* ================= 점검 ================= */
  /** 자료 점검. 각 항목은 { sev: 'error'|'warn'|'info', sheet: 'pay'|'pre', row, hotel, code, params }. 문장은 화면이 코드별로 만든다. */
  function validate(data) {
    const cfg = cfgOf(data); const out = []; const add = (sev, sheet, r, code, params) => out.push({ sev, sheet, row: r.sourceRow || r.row || null, hotel: r.hotel || '', code, params: params || {} });
    const seen = new Map();
    for (const p of data.payments || []) {
      if (blank(p.hotel)) continue;
      const exp = CCY_BY_COUNTRY[p.country]; if (exp && !blank(p.ccy) && p.ccy !== exp) add('warn', 'pay', p, 'PAY_CCY_MISMATCH', { country: p.country, ccy: p.ccy, expected: exp });
      if (p.card === 'X' && blank(p.account)) add('warn', 'pay', p, 'PAY_X_NO_ACCOUNT');
      if (p.card !== 'X' && !blank(p.account)) add('warn', 'pay', p, 'PAY_ACCOUNT_WITHOUT_CARD_X', { account: p.account });
      if (p.account === '개인 계좌' || p.account === '현금 수령') add('info', 'pay', p, 'PAY_EXCEPTION_ACCOUNT', { account: p.account });
      if (p.card === 'X' && p.account === '미등록') add('info', 'pay', p, 'PAY_ACCOUNT_NOT_REGISTERED');
      const key = [p.code, p.hotel, p.entity, p.method].join('|'); seen.set(key, (seen.get(key) || 0) + 1);
    }
    for (const [k, n] of seen) if (n > 1) { const [code, hotel] = k.split('|'); out.push({ sev: 'info', sheet: 'pay', row: null, hotel, code: 'PAY_DUPLICATE', params: { code, n } }); }
    const rowsPre = (data.prebuy || []).filter(h => !blank(h.hotel)); const asOfs = rowsPre.map(h => h.asOf).filter(a => !blank(a)).sort(); const maxAsOf = asOfs.length ? asOfs[asOfs.length - 1] : null;
    const ccyOfCountry = { KR: ['KRW'], JP: ['JPY'], VN: ['VND'], TH: ['THB'], SG: ['SGD', 'USD', 'JPY', 'KRW', 'VND', 'THB', 'TWD', 'HKD'] };
    for (const h of rowsPre) {
      const v = prebuyView(h, cfg);
      if (!blank(h.ledger) && h.ledger < 0) add('error', 'pre', h, 'PRE_NEG_BALANCE');
      if (!blank(h.ledger) && blank(h.asOf)) add('warn', 'pre', h, 'PRE_NO_ASOF');
      if (!blank(h.asOf) && maxAsOf && daysBetween(h.asOf, maxAsOf) > cfg.staleAsOfDays) add('info', 'pre', h, 'PRE_STALE_ASOF', { asOf: h.asOf, days: daysBetween(h.asOf, maxAsOf) });
      if (v.recon === 'MAJOR') add('warn', 'pre', h, 'PRE_DIFF_BIG', { pct: round1(v.gapPct) }); else if (v.recon === 'MINOR') add('info', 'pre', h, 'PRE_DIFF_MINOR', { pct: round1(v.gapPct) });
      const okCcy = ccyOfCountry[h.entity || h.country]; if (okCcy && !blank(h.ccy) && !okCcy.includes(h.ccy)) add('error', 'pre', h, 'PRE_CCY_ENTITY', { entity: h.entity || h.country, ccy: h.ccy });
      if (h.transfer === 'O' && blank(h.transferNote)) add('warn', 'pre', h, 'PRE_TRANSFER_NO_NOTE');
      if (h.refund === 'O' && blank(h.refundNote)) add('warn', 'pre', h, 'PRE_REFUND_NO_NOTE');
      const dep = h.type === '보증금' || h.type === 'Deposit';
      if (!dep && !blank(h.ledger) && h.ledger > 0 && h.avg === 0) add('warn', 'pre', h, 'PRE_ZERO_USAGE');
      if (h.type === 'Deposit' && h.country === 'VN' && h.ledger > 0) add('info', 'pre', h, 'PRE_VN_DEPOSIT_CARRY');
      if (v.cls === 'B2_TALK') add('warn', 'pre', h, 'PRE_NEEDS_TALK');
      if (!blank(h.sheetClass) && !blank(h.transfer) && h.transfer !== '미확인' && labelOf(v.cls) !== h.sheetClass && h.sheetClass !== '확인 필요') add('info', 'pre', h, 'PRE_SHEET_MISMATCH', { sheet: h.sheetClass, calc: labelOf(v.cls) });
      if (v.sig.critical) add('warn', 'pre', h, 'PRE_CRITICAL_NOTE');
    }
    const order = { error: 0, warn: 1, info: 2 }; return out.sort((a, b) => order[a.sev] - order[b.sev]);
  }
  /** 분류 이름(양식의 R열과 같은 글자). */
  const LABELS = { B1: 'B1 이관', B2_USE: 'B2 소진', B2_REFUND: 'B2 반환', B2_TALK: 'B2 협의 필요', TBD: '확인 필요' };
  const labelOf = c => LABELS[c] || '';

  /* ================= 결재 자료 ================= */
  /** 11/20 결재용 요약: 통화별로 분류마다 건수·대장 잔액·12/31 예상 잔액. 이관 B1은 금액 전체, B2 소진은 12/31까지 쓰고 남는 예상 잔액, 반환·협의는 12/31 예상 잔액만큼이 연말 정리 대상. */
  function approvalPacket(data) {
    const cfg = cfgOf(data); const st = prebuyStats(data.prebuy || [], cfg); const lines = [];
    for (const cls of ['B1', 'B2_USE', 'B2_REFUND', 'B2_TALK', 'TBD']) { const c = st.byClass[cls]; if (!c) continue; for (const ccy of Object.keys(c.byCcy).sort()) { const x = c.byCcy[ccy]; lines.push({ cls, ccy, n: x.n, ledger: x.ledger, hotel: x.hotel, est: x.est, estKnown: x.estKnown }); } }
    const pay = paymentStats(data.payments || []);
    return { lines, prebuy: st, payments: pay, asOf: data.meta && data.meta.asOfMax || null };
  }

  return { DAY, blank, toDay, daysBetween, addDays, round1, CCY_BY_COUNTRY, CCY_DECIMALS, DEFAULTS, cfgOf, payClass, payFill, monthsOfCover, canUseByYearEnd, estYearEnd, prebuyClass, gap, gapPct, reconOf, prebuySignal, prebuyView, ACTION, LABELS, labelOf, paymentStats, testCandidates, prebuyStats, financeDone, scmFill, conditionMissing, progress, validate, approvalPacket };
});
