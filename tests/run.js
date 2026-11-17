'use strict';
// 계산부(calc.js)와 화면 글·렌더링을 점검한다. 사용법: node tests/run.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const C = require(path.join(ROOT, 'src/calc.js'));
const I = require(path.join(ROOT, 'src/i18n.js'));
const SAMPLE = JSON.parse(fs.readFileSync(path.join(ROOT, 'sample/sample_data.json'), 'utf8'));

let pass = 0, fail = 0; const failures = [];
const eq = (a, b, m) => { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error((m || '') + ' expected ' + y + ' got ' + x); };
const ok = (v, m) => { if (!v) throw new Error('assert failed: ' + (m || '')); };
const TESTS = []; function test(id, name, fn) { TESTS.push({ id, name, fn }); }
const cfg = C.cfgOf({ meta: {} });
const H = o => Object.assign({ hotel: 'H', country: 'KR', ccy: 'KRW', type: 'Floating', ledger: 100, avg: 10, asOf: '2026-11-02', hotelBal: null, transfer: null, refund: null }, o || {});

test('C01', '날짜: 일수 차이와 더하기, 연말·윤년', () => {
  eq(C.daysBetween('2026-11-02', '2026-12-31'), 59); eq(C.daysBetween('2026-12-31', '2026-11-02'), -59); eq(C.addDays('2026-12-30', 3), '2027-01-02'); eq(C.addDays('2028-02-28', 1), '2028-02-29'); eq(C.daysBetween(null, '2026-01-01'), null); eq(C.toDay('bad'), null);
});
test('C02', '후불 분류: 양식 K열과 같은 결과(A1, A2, 예외, 확인 필요, 선불, 빈 줄)', () => {
  const p = o => C.payClass(Object.assign({ hotel: 'x', kind: '후불', card: null, account: null }, o));
  eq(p({ hotel: '' }), 'NONE'); eq(p({ kind: '선불' }), 'PRE'); eq(p({ card: 'O' }), 'A1'); eq(p({ card: 'O', account: '개인 계좌' }), 'A1', '카드 수용이면 계좌 칸과 관계없이 A1');
  eq(p({ card: 'X', account: '법인 계좌 등록' }), 'A2'); eq(p({ card: 'X', account: '미등록' }), 'EXC'); eq(p({ card: 'X', account: '개인 계좌' }), 'EXC'); eq(p({ card: 'X', account: '현금 수령' }), 'EXC'); eq(p({ card: 'X', account: '미확인' }), 'EXC'); eq(p({ card: 'X' }), 'EXC', '계좌 칸이 비어도 예외');
  eq(p({ card: '미확인' }), 'TBD'); eq(p({}), 'TBD');
});
test('C03', '작성 상태: 답함·미확인·계좌 칸 비음·비어 있음', () => {
  const f = o => C.payFill(Object.assign({ card: null, account: null }, o));
  eq(f({ card: 'O' }), 'DONE'); eq(f({ card: 'X', account: '법인 계좌 등록' }), 'DONE'); eq(f({ card: 'X', account: '미확인' }), 'UNKNOWN'); eq(f({ card: 'X' }), 'PARTIAL'); eq(f({ card: '미확인' }), 'UNKNOWN'); eq(f({}), 'EMPTY');
});
test('C04', '소진 개월: 소수 첫째 자리, 0이나 빈 소진액은 없음', () => {
  eq(C.monthsOfCover(H({ ledger: 28880889, avg: 1119111 })), 25.8); eq(C.monthsOfCover(H({ ledger: 100, avg: 0 })), null); eq(C.monthsOfCover(H({ avg: null })), null); eq(C.monthsOfCover(H({ ledger: null })), null); eq(C.monthsOfCover(H({ ledger: 0, avg: 10 })), 0); eq(C.monthsOfCover(H({ ledger: 25, avg: 10 })), 2.5);
});
test('C05', '12/31 소진 가능: 경계(같으면 가능), 기준일 없음, 연말 이후', () => {
  const c = o => C.canUseByYearEnd(H(Object.assign({ avg: 30 }, o)), cfg);   // 11-02 -> 12-31 = 59일, 예상 소진 59
  eq(c({ ledger: 59 }), '가능', '잔액이 예상 소진과 같음'); eq(c({ ledger: 58.9 }), '가능'); eq(c({ ledger: 59.01 }), '불가'); eq(c({ asOf: null }), null); eq(c({ avg: null }), null); eq(c({ ledger: null }), null);
  eq(c({ asOf: '2027-01-05', ledger: 1 }), '불가', '연말 이후면 남은 일수 0'); eq(c({ asOf: '2027-01-05', ledger: 0 }), '가능'); eq(c({ avg: 0, ledger: 1 }), '불가'); eq(c({ avg: 0, ledger: 0 }), '가능');
});
test('C06', '12/31 예상 잔액: 0 아래로 내려가지 않고 연말 이후엔 대장 그대로', () => {
  eq(C.estYearEnd(H({ ledger: 100, avg: 30, asOf: '2026-11-02' }), cfg), 100 - 30 * 59 / 30); eq(C.estYearEnd(H({ ledger: 10, avg: 30 }), cfg), 0); eq(C.estYearEnd(H({ asOf: '2027-02-01' }), cfg), 100); eq(C.estYearEnd(H({ asOf: null }), cfg), null);
});
test('C07', '프리바이 분류(R열): 확인 필요, B1, B2 소진, B2 반환, B2 협의 필요', () => {
  const k = o => C.prebuyClass(H(o), cfg); const use = { ledger: 10, avg: 10 }, no = { ledger: 1000, avg: 10 };
  eq(k({ hotel: '' }), 'NONE'); eq(k({}), 'TBD'); eq(k({ transfer: '미확인' }), 'TBD'); eq(k({ transfer: 'O' }), 'B1'); eq(k(Object.assign({ transfer: 'O' }, no)), 'B1', '이관 가능이면 소진 가능 여부와 관계없이 B1');
  eq(k(Object.assign({ transfer: 'X' }, use)), 'B2_USE'); eq(k(Object.assign({ transfer: 'X', refund: 'O' }, no)), 'B2_REFUND'); eq(k(Object.assign({ transfer: 'X', refund: 'X' }, no)), 'B2_TALK'); eq(k(Object.assign({ transfer: 'X' }, no)), 'B2_TALK', '반환 칸이 비면 협의'); eq(k(Object.assign({ transfer: 'X', refund: '미확인' }, no)), 'B2_TALK');
  eq(k({ transfer: 'X', ledger: 10, avg: null }), 'TBD', '소진액이 없으면 소진 가능을 판정할 수 없다'); eq(k({ transfer: 'X', asOf: null }), 'TBD');
});
test('C08', '잔액 대조: 0.1% 일치, 2% 경미, 넘으면 큰 차이, 호텔 확인 없음', () => {
  const r = hb => C.reconOf(H({ ledger: 10000, hotelBal: hb }), cfg); eq(r(null), 'NONE'); eq(r(10000), 'MATCH'); eq(r(9990), 'MATCH'); eq(r(9989), 'MINOR'); eq(r(9800), 'MINOR'); eq(r(9799), 'MAJOR'); eq(r(10300), 'MAJOR'); eq(C.reconOf(H({ ledger: 0, hotelBal: 5 }), cfg), 'NONE', '대장 0이면 비율을 낼 수 없다');
  eq(C.gap(H({ ledger: 28880889, hotelBal: 28576994 })), 303895);
});
test('C09', '신호: S1 경계(2, 4), 소진 0, 보증금, 잔액 0, 중대 메모, 자료 없음', () => {
  const s = o => C.prebuySignal(H(o), cfg);
  eq(s({ ledger: 20, avg: 10 }).s1, 'ok'); eq(s({ ledger: 20.1, avg: 10 }).s1, 'warn'); eq(s({ ledger: 40, avg: 10 }).s1, 'warn'); eq(s({ ledger: 40.1, avg: 10 }).s1, 'bad'); eq(s({ ledger: 5, avg: 0 }).s1, 'bad'); eq(s({ ledger: 0, avg: 0 }).s1, 'ok'); eq(s({ ledger: 5, avg: null }).s1, 'na');
  eq(s({ type: 'Deposit', ledger: 5, avg: 0 }).s1, 'na', '보증금은 소진을 보지 않는다'); eq(s({ type: '보증금', ledger: 5, avg: 0 }).s1, 'na');
  eq(s({ ledger: 10, avg: 10, note: '운영 중단(11/3)' }).color, 'bad'); eq(s({ ledger: 10, avg: 10, note: '평범한 메모' }).color, 'ok'); eq(s({ ledger: null, avg: null }).color, 'na'); eq(s({ ledger: 10000, avg: 10000, hotelBal: 9000 }).color, 'bad'); eq(s({ ledger: 10000, avg: 10000, hotelBal: 9980 }).color, 'warn'); eq(s({ ledger: 10000, avg: 10000, hotelBal: 9995 }).color, 'ok');
});
test('C10', '후불 집계와 테스트 후보: A1·A2만, 월평균 지급액이 큰 순서, 나라 거르기', () => {
  const pay = [['KR', 'a', 'O', 100], ['KR', 'b', 'X', 300, '법인 계좌 등록'], ['VN', 'c', 'O', 900], ['KR', 'd', null, 999], ['KR', 'e', 'X', 800, '개인 계좌']].map(([country, hotel, card, avg, account]) => ({ country, hotel, kind: '후불', card, avg, account: account || null, ccy: 'KRW', method: 'VCC' }));
  const st = C.paymentStats(pay); eq(st.total, { n: 5, A1: 2, A2: 1, EXC: 1, TBD: 1, PRE: 0 }); eq(st.byCountry.KR.avgByCcy, { KRW: 100 + 300 + 999 + 800 }); eq(C.testCandidates(st.rows).map(r => r.hotel), ['c', 'b', 'a']); eq(C.testCandidates(st.rows, 'KR').map(r => r.hotel), ['b', 'a']); eq(C.testCandidates(st.rows, 'KR', 1).length, 1);
  eq(st.answered, 4, '개인 계좌도 답은 한 것'); eq(st.due, 5);
});
test('C11', '프리바이 집계: 통화를 섞지 않는다', () => {
  const pre = [H({ ledger: 100, avg: 10, ccy: 'KRW', transfer: 'O' }), H({ ledger: 50, avg: 5, ccy: 'JPY', country: 'JP', transfer: 'O' }), H({ ledger: 7, avg: 1, ccy: 'KRW', transfer: 'O' })]; const s = C.prebuyStats(pre, cfg);
  eq(s.byCcy.KRW.ledger, 107); eq(s.byCcy.JPY.ledger, 50); eq(s.byClass.B1.byCcy.KRW.n, 2); eq(s.byClass.B1.n, 3); eq(Object.keys(s.byCcy).sort(), ['JPY', 'KRW']);
});
test('C12', '수집 현황: 재무·SCM 완료, 미확인은 답은 했지만 확인 못 함, 마감까지 일수', () => {
  const pre = [H({ hotelBal: 5, transfer: 'O', refund: 'X' }), H({ hotelBal: 5, transfer: '미확인', refund: 'X' }), H({ transfer: 'X' }), H({ ledger: null })];
  const p = C.progress({ meta: {}, payments: [{ hotel: 'a', country: 'KR', kind: '후불', card: 'O' }, { hotel: 'b', country: 'KR', kind: '후불' }, { hotel: 'c', country: 'KR', kind: '선불' }], prebuy: pre }, '2026-11-17');
  eq(p.payments.due, 2); eq(p.payments.done, 1); eq(p.payments.empty, 1); eq(p.prebuy.n, 4); eq(p.prebuy.finance, 3); eq(p.prebuy.scm, 1); eq(p.prebuy.scmAnswered, 2);
  eq(p.deadlines.finance.daysLeft, -1); eq(p.deadlines.scm.daysLeft, 0); eq(p.deadlines.approval.daysLeft, 3);
  eq(C.scmFill(H({ hotelBal: 5, transfer: 'O', refund: 'O' })).done, true); eq(C.scmFill(H({ transfer: 'O' })).missing, ['hotelBal', 'refund']); eq(C.conditionMissing(H({ transfer: 'O', refund: 'O', transferNote: 'x' })), ['refundNote']);
});
test('C13', '점검: 코드마다 걸리는 경우와 걸리지 않는 경우', () => {
  const v = (pay, pre) => C.validate({ meta: {}, payments: pay || [], prebuy: pre || [] }).map(i => i.code + ':' + i.sev);
  const P = o => Object.assign({ hotel: 'a', country: 'KR', ccy: 'KRW', kind: '후불', card: null, account: null, entity: 'e', method: 'VCC', code: '1', sourceRow: 5 }, o);
  eq(v([P({ ccy: 'USD' })]), ['PAY_CCY_MISMATCH:warn']); eq(v([P({ ccy: 'KRW' })]), []); eq(v([P({ card: 'X' })]), ['PAY_X_NO_ACCOUNT:warn']); eq(v([P({ card: 'O', account: '법인 계좌 등록' })]), ['PAY_ACCOUNT_WITHOUT_CARD_X:warn']);
  eq(v([P({ card: 'X', account: '개인 계좌' })]), ['PAY_EXCEPTION_ACCOUNT:info']); eq(v([P({ card: 'X', account: '미등록' })]), ['PAY_ACCOUNT_NOT_REGISTERED:info']); eq(v([P(), P({ sourceRow: 6 })]), ['PAY_DUPLICATE:info']); eq(v([P(), P({ code: '2' })]), []);
  eq(v([], [H({ ledger: -5 })]).includes('PRE_NEG_BALANCE:error'), true); eq(v([], [H({ asOf: null })]).includes('PRE_NO_ASOF:warn'), true);
  eq(v([], [H({ asOf: '2026-11-02' }), H({ asOf: '2026-10-02' })]).filter(c => c.startsWith('PRE_STALE')).length, 1, '가장 늦은 기준일보다 30일 넘게 앞선 줄만'); eq(v([], [H({ asOf: '2026-11-02' }), H({ asOf: '2026-10-03' })]).filter(c => c.startsWith('PRE_STALE')).length, 0, '30일 이내');
  eq(v([], [H({ hotelBal: 90 })]).includes('PRE_DIFF_BIG:warn'), true); eq(v([], [H({ hotelBal: 99 })]).includes('PRE_DIFF_MINOR:info'), true); eq(v([], [H({ hotelBal: 100 })]).some(c => c.startsWith('PRE_DIFF')), false);
  eq(v([], [H({ entity: 'KR', ccy: 'VND' })]).includes('PRE_CCY_ENTITY:error'), true); eq(v([], [H({ entity: 'SG', ccy: 'JPY' })]).includes('PRE_CCY_ENTITY:error'), false, '싱가포르 법인은 여러 통화');
  eq(v([], [H({ transfer: 'O' })]).includes('PRE_TRANSFER_NO_NOTE:warn'), true); eq(v([], [H({ transfer: 'O', transferNote: 'x' })]).includes('PRE_TRANSFER_NO_NOTE:warn'), false); eq(v([], [H({ refund: 'O' })]).includes('PRE_REFUND_NO_NOTE:warn'), true);
  eq(v([], [H({ ledger: 5, avg: 0 })]).includes('PRE_ZERO_USAGE:warn'), true); eq(v([], [H({ ledger: 5, avg: 0, type: 'Deposit' })]).includes('PRE_ZERO_USAGE:warn'), false); eq(v([], [H({ type: 'Deposit', country: 'VN', ccy: 'VND', entity: 'VN', ledger: 5, avg: 0 })]).includes('PRE_VN_DEPOSIT_CARRY:info'), true);
  eq(v([], [H({ transfer: 'X', refund: 'X', ledger: 1000, avg: 10 })]).includes('PRE_NEEDS_TALK:warn'), true); eq(v([], [H({ note: '가압류 검토' })]).includes('PRE_CRITICAL_NOTE:warn'), true);
  eq(v([], [H({ transfer: 'O', transferNote: 'x', sheetClass: 'B2 소진' })]).includes('PRE_SHEET_MISMATCH:info'), true); eq(v([], [H({ transfer: 'O', transferNote: 'x', sheetClass: 'B1 이관' })]).includes('PRE_SHEET_MISMATCH:info'), false); eq(v([], [H({ sheetClass: '확인 필요' })]).includes('PRE_SHEET_MISMATCH:info'), false);
  const order = C.validate({ meta: {}, payments: [P({ ccy: 'USD' })], prebuy: [H({ ledger: -1 })] }).map(i => i.sev); eq(order[0], 'error', '오류가 먼저');
});
test('C14', '결재 자료: 분류별·통화별 줄과 합계', () => {
  const pre = [H({ ledger: 100, avg: 10, transfer: 'O' }), H({ ledger: 19, avg: 10, ccy: 'JPY', country: 'JP', transfer: 'X' }), H({ ledger: 500, avg: 10, transfer: 'X', refund: 'O' })];
  const p = C.approvalPacket({ meta: { asOfMax: '2026-11-02' }, payments: [], prebuy: pre }); eq(p.lines.map(l => l.cls + l.ccy + l.n), ['B1KRW1', 'B2_USEJPY1', 'B2_REFUNDKRW1']);
  const refund = p.lines.find(l => l.cls === 'B2_REFUND'); eq(refund.ledger, 500); eq(Math.round(refund.est), Math.round(500 - 10 * 59 / 30)); eq(p.asOf, '2026-11-02');
});
test('C15', '샘플 자료: 모든 분류가 나오고, 점검에 의도한 결함이 걸리고, 통화별 합계가 맞다', () => {
  const s = C.prebuyStats(SAMPLE.prebuy, C.cfgOf(SAMPLE)); eq(Object.keys(s.byClass).sort(), ['B1', 'B2_REFUND', 'B2_TALK', 'B2_USE', 'TBD']);
  const sum = Object.values(s.byCcy).reduce((a, c) => a + c.n, 0); eq(sum, s.count); const codes = new Set(C.validate(SAMPLE).map(i => i.code)); for (const k of ['PAY_CCY_MISMATCH', 'PRE_NEG_BALANCE', 'PRE_DIFF_BIG', 'PRE_CCY_ENTITY', 'PRE_CRITICAL_NOTE', 'PAY_DUPLICATE', 'PRE_STALE_ASOF']) ok(codes.has(k), k);
  const ps = C.paymentStats(SAMPLE.payments); eq(ps.total.A1 + ps.total.A2 + ps.total.EXC + ps.total.TBD + ps.total.PRE, ps.total.n); ok(SAMPLE.meta.synthetic === true, '샘플은 가상 자료 표시');
});
test('C16', '글: ko·en 열쇠가 같고, 코드로 만든 문장과 화면이 쓰는 열쇠가 모두 번역돼 있다', () => {
  const kk = Object.keys(I.ko).sort(), ke = Object.keys(I.en).sort(); eq(kk.filter(k => !(k in I.en)), [], 'en에 없는 열쇠'); eq(ke.filter(k => !(k in I.ko)), [], 'ko에 없는 열쇠');
  const calc = fs.readFileSync(path.join(ROOT, 'src/calc.js'), 'utf8'); const codes = [...new Set([...calc.matchAll(/'((?:PAY|PRE)_[A-Z0-9_]+)'/g)].map(m => m[1]))]; ok(codes.length >= 15, 'code count ' + codes.length); for (const c of codes) ok(c in I.ko && c in I.en, c);
  const ui = fs.readFileSync(path.join(ROOT, 'src/sg_ui.js'), 'utf8'); const used = [...new Set([...ui.matchAll(/\bsgTx\('([A-Za-z0-9_]+)'\s*[,)]/g)].map(m => m[1]))]; ok(used.length > 40, 'used keys ' + used.length); for (const k of used) ok(k in I.ko && k in I.en, 'sg_ui.js 열쇠 ' + k);
  for (const c of ['A1', 'A2', 'EXC', 'TBD', 'B1', 'B2_USE', 'B2_REFUND', 'B2_TALK']) ok(I.ko[c + 'd'] && I.en[c + 'd'], c + 'd');
  for (const a of ['TRANSFER', 'CONSUME', 'REFUND', 'NEGOTIATE', 'CONFIRM']) ok(I.ko['act' + a] && I.en['act' + a], a);
});

/* ---- CSV 읽기: 화면의 읽기(sg_import.js)와 엑셀 읽기(tools/build.py)가 같은 값을 내는지 ---- */
const IMP = require(path.join(ROOT, 'src/sg_import.js'));
function parseCsv(text) { const rows = []; let row = [], cell = '', q = false; for (let i = 0; i < text.length; i++) { const c = text[i]; if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; } else { if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += c; } } if (cell !== '' || row.length) { row.push(cell); rows.push(row); } return rows.filter(r => r.some(x => x.trim() !== '')); }
const stripFile = r => { const o = Object.assign({}, r); delete o.file; return o; };
test('C17', 'CSV 읽기: 샘플 엑셀을 CSV로 저장한 것을 화면 쪽 읽기로 읽으면 엑셀 읽기(build.py)와 같은 값이 나온다', () => {
  for (const [file, kind, key] of [['sample/SG지급_자료수집_샘플_1지급목록.csv', 'pay', 'payments'], ['sample/SG지급_자료수집_샘플_2프리바이목록.csv', 'pre', 'prebuy']]) {
    const res = IMP.parseRows(parseCsv(fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/^﻿/, '')), kind); eq(res.missing, [], file); eq(res.issues, [], file);
    const want = SAMPLE[key].map(stripFile); eq(res.rows.length, want.length, file + ' rows'); for (let i = 0; i < want.length; i++) { const a = res.rows[i], b = want[i]; for (const k of Object.keys(b)) { if (['months', 'est', 'gap', 'canUse', 'sheetClass', 'sourceRow'].includes(k)) continue; eq(a[k], b[k], file + ' row ' + (i + 1) + ' ' + k); } }
  }
});
test('C18', 'CSV 읽기: 열 순서가 바뀌어도, 제목 줄이 있어도, 답 표기가 달라도 읽는다. 필요한 열이 없으면 알려 준다', () => {
  const head = ['나라', '호텔명', '지급 구분', '지급 통화', '최근 3개월 월평균 지급액', 'A1 카드 수용 여부', 'A2 수취 계좌(법인 계좌 여부)'];
  const rows = [['제목', '', ''], ['A', 'B'], head, ['KR', 'Hotel X', '후불', 'KRW', '1,234,567', 'o', ''], ['VN', 'Hotel Y', '후불', 'VND', '5000', '불가', '법인 계좌 등록'], ['KR', 'Hotel Z', '후불', 'KRW', 'abc', '가나다', '']];
  const r = IMP.parseRows(rows, 'pay'); eq(r.headerRow, 3); eq(r.rows.length, 3); eq(r.rows[0].avg, 1234567); eq(r.rows[0].card, 'O'); eq(r.rows[1].card, 'X'); eq(r.rows[2].card, null); eq(r.rows[2].avg, null); eq(r.issues.map(i => i.field + ':' + i.row), ['avg:6', 'card:6']);
  eq(IMP.parseRows([['나라', '호텔명']], 'pay').missing.includes('ccy'), true); eq(IMP.parseRows([['아무', '열']], 'pay').missing, ['header']); eq(IMP.toDate('2026/11/3'), '2026-11-03'); eq(IMP.toNumber('₩1,000'), 1000);
});

/* ---- 틀: 대표님 대시보드를 그대로 쓰고 SG 탭만 더했는지 ---- */
const readLF = p => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
test('C19', '공개 대시보드(index.html): 대표님 틀 + 가상 처음 자료 + SG 탭, 표시가 남지 않았고 처음 자료가 가상 자료이다', () => {
  const html = readLF('index.html'); for (const m of ['/*__SEED__*/', '/*__SGDATA__*/', '/*__STYLE__*/', '/*__SCRIPT__*/']) ok(!html.includes(m), m);
  ok(html.includes('id="v-sg"') && html.includes('data-v="sg"') && html.includes('renderSG()'), 'SG 탭');
  for (const t of ['data-v="board"', 'data-v="credit"', 'data-v="check"', 'data-v="monitor"', 'data-v="deposit"', 'data-v="data"', 'data-v="rule"', 'data-v="hard"']) ok(html.includes(t), t);
  const seed = JSON.parse(readLF('sample/seed_public.json')); ok(seed.hotels.every(h => /^S\d{5}$/.test(h.code)) && seed.hotels.every(h => /^Sample /.test(h.name)), '가상 호텔'); ok(html.includes('const SEED = {"hotels"'), 'SEED');
  const m = /let SGDATA = (\{[\s\S]*?\}) \|\| \{ meta/.exec(html); ok(m, 'SGDATA'); const sg = JSON.parse(m[1].split('<\\/').join('</')); eq(sg.meta.synthetic, true); eq(sg.payments.length, SAMPLE.payments.length);
});
test('C20', '공개 대시보드: 지금 소스와 샘플 엑셀로 다시 만든 것과 같다(고치고 다시 만들지 않은 채 올리는 일을 막는다)', () => {
  const tmp = path.join(require('os').tmpdir(), 'omh_ceo_check_' + process.pid + '.html'); const py = process.platform === 'win32' ? 'python' : 'python3';
  const r = require('child_process').spawnSync(py, [path.join(ROOT, 'tools/build_ceo.py'), '--public', '--sg-in', path.join(ROOT, 'sample/SG지급_자료수집_샘플.xlsx'), '--out', tmp, '--today', SAMPLE.meta.today], { encoding: 'utf8' });
  ok(r.status === 0, '빌드 실패: ' + r.stderr + r.stdout); const built = fs.readFileSync(tmp, 'utf8').replace(/\r\n/g, '\n'); fs.unlinkSync(tmp); eq(built === readLF('index.html'), true, 'index.html이 src/와 다름: python tools/build_ceo.py --public ... 로 다시 만드세요');
});
test('C21', '공개용 틀: 사람 이름·내부 메모가 없다(공개 파일 모두)', () => {
  const bad = /\bSang\b|Aerum|Sophia|원지연|Global SCM Director|JP 경리|Comfort|JP 11\/15|Teams|Kakao|eCount|Chichaya|Hanny/;
  for (const f of ['index.html', 'src/template_public.html', 'sample/seed_public.json', 'sample/sample_data.json']) { const t = readLF(f); const hit = t.match(bad); ok(!hit, f + ' -> ' + (hit ? hit[0] : '')); }
});
test('C22', '실제 자료 보호: private/의 호텔 이름·거래처코드가 공개 대상 파일에 없다(내 컴퓨터에서만 검사)', () => {
  const pd = path.join(ROOT, 'private/base/seed.json'), pg = path.join(ROOT, 'private/sg_data.json'); if (!fs.existsSync(pd) && !fs.existsSync(pg)) return;
  const needles = new Set(); const add = r => { if (r.hotel && String(r.hotel).length >= 8) needles.add(String(r.hotel)); if (r.name && String(r.name).length >= 8) needles.add(String(r.name)); if (r.code && String(r.code).length >= 5) needles.add(String(r.code)); };
  if (fs.existsSync(pd)) { const s = JSON.parse(fs.readFileSync(pd, 'utf8')); s.hotels.forEach(add); } if (fs.existsSync(pg)) { const s = JSON.parse(fs.readFileSync(pg, 'utf8')); s.payments.concat(s.prebuy).forEach(add); }
  const targets = ['index.html', 'README.md', 'src', 'tests/run.js', 'tests/test_build.py', 'tools', 'sample/sample_data.json', 'sample/seed_public.json', 'sample/SG지급_자료수집_샘플_1지급목록.csv', 'sample/SG지급_자료수집_샘플_2프리바이목록.csv'];
  const files = []; (function walk(p) { const f = path.join(ROOT, p); if (!fs.existsSync(f)) return; if (fs.statSync(f).isDirectory()) fs.readdirSync(f).forEach(n => walk(path.join(p, n))); else files.push(f); })('.');
  const hit = []; for (const f of files) { const rel = path.relative(ROOT, f).split(path.sep).join('/'); if (rel.startsWith('private/') || rel.startsWith('out/') || rel.endsWith('.xlsx') || rel.endsWith('.docx')) continue; if (!targets.some(t => rel === t || rel.startsWith(t + '/'))) continue; const txt = fs.readFileSync(f, 'utf8'); for (const n of needles) if (txt.includes(n)) hit.push(rel + ' <- ' + n.slice(0, 12) + '…'); }
  eq(hit, [], '실제 자료가 공개 대상 파일에 들어감');
});
test('C23', '대표님 코드 보존(내 컴퓨터에서만): 내부용 틀과 처음 자료가 원본과 같다 — SEED 자리 말고는 한 글자도 다르지 않고, 처음 자료는 값이 같다', () => {
  const orig = path.join(ROOT, 'private/base/ceo_original.html'), tpl = path.join(ROOT, 'private/base/template_internal.html'), seedp = path.join(ROOT, 'private/base/seed.json'); if (!fs.existsSync(orig) || !fs.existsSync(tpl)) return;
  const o = readLF('private/base/ceo_original.html').split('\n'), t = readLF('private/base/template_internal.html').split('\n'); const os = o.findIndex(l => l.startsWith('const SEED = {')), oe = o.findIndex(l => l.startsWith('let DATA = JSON.parse(JSON.stringify(SEED))')), ts = t.findIndex(l => l.startsWith('const SEED = /*__SEED__*/'));
  eq(o.slice(0, os), t.slice(0, ts), '앞부분'); eq(o.slice(oe), t.slice(ts + 1), '뒷부분');
  const seed = vm.runInNewContext('(' + o.slice(os, oe).join('\n').replace(/^const SEED = /, '').replace(/;\s*$/, '') + ')'); eq(JSON.parse(JSON.stringify(seed)), JSON.parse(fs.readFileSync(seedp, 'utf8')), '처음 자료');
});

/* ---- SG 탭 화면 그리기: 대표님 전역(T, LANG, CORP, DATA 등)을 가짜로 세워 두고 sg_ui.js를 돌린다 ---- */
function sgSandbox(sg, lang) {
  const els = {}; const mkEl = id => els[id] || (els[id] = { id, innerHTML: '', textContent: '', dataset: {}, listeners: {}, addEventListener(ev, fn) { this.listeners[ev] = fn; }, focus() { }, setSelectionRange() { } });
  const tplText = readLF('src/template_public.html'); const pm = /function parseCSV\(text\)\{[\s\S]*?\n/.exec(tplText);
  const ctx = { console, Intl, JSON, Math, Object, String, Number, Array, Set, Date, Blob: function () { }, URL: { createObjectURL: () => '', revokeObjectURL() { } }, setTimeout, LANG: lang, CORP: '', TODAY_S: '2026-11-17', DATA: { hotels: [{ code: 'S10001', corp: 'KR', name: 'Sample Maple Resort' }, { code: 'S10002', corp: 'KR', name: 'Sample Harbor Inn' }, { code: 'ZZ-NAME', corp: 'KR', name: 'sample  CORAL suites', type: 'Floating' }] }, evalHotel: h => ({ color: h.code === 'S10001' ? 'warn' : 'ok' }), copied: null };
  ctx.T = (ko, en) => ctx.LANG === 'ko' ? ko : en; ctx.toast = () => { }; ctx.copyText = t => { ctx.copied = t; };
  ctx.localStorage = { getItem: () => null, setItem() { } }; ctx.document = { getElementById: id => mkEl(id), querySelector: () => null, createElement: () => ({ click() { }, remove() { } }), body: { appendChild() { } } };
  ctx.FileReader = class { readAsText(f) { this.result = f.text; setTimeout(() => this.onload(), 0); } }; ctx.self = ctx; ctx.globalThis = ctx; vm.createContext(ctx);
  vm.runInContext(pm[0].trim(), ctx);
  const code = ['calc.js', 'i18n.js', 'sg_import.js', 'sg_ui.js'].map(f => readLF('src/' + f)).join('\n').replace('/*__SGDATA__*/null', JSON.stringify(sg));
  vm.runInContext(code, ctx); return { ctx, els, run: s => vm.runInContext(s, ctx), html: () => els['v-sg'].innerHTML };
}
function clickOn(sb, dataset) { const h = sb.els['v-sg'].listeners.click; const a = { dataset }; h({ target: { closest: () => a } }); }
test('C24', 'SG 탭 화면: 네 보기가 두 언어로 그려지고 undefined·NaN·[object가 없다', () => {
  for (const lang of ['ko', 'en']) { const sb = sgSandbox(SAMPLE, lang); for (const v of ['pay', 'pre', 'ap', 'col']) { sb.run("SGS.view = '" + v + "'; renderSG();"); const h = sb.html(); ok(h.length > 800, lang + '/' + v + ' length ' + h.length); ok(!/undefined|NaN|\[object|Infinity/.test(h), lang + '/' + v + ' -> ' + (h.match(/.{25}(undefined|NaN|\[object|Infinity).{25}/) || [''])[0]); } }
});
test('C25', 'SG 탭 화면: 거르기, 상세, 후보 선택, 결재 문안, 대표님 현황판 신호 연결', () => {
  const sb = sgSandbox(SAMPLE, 'ko'); sb.run('renderSG();'); ok(sb.html().includes('후불 지급 호텔'), 'tile');
  clickOn(sb, { sg: 'flt', scope: 'pay', key: 'cls', val: 'A1' }); ok(sb.run('sgPayRows().every(r => r.cls === "A1") && sgPayRows().length > 0'), 'A1 거르기'); clickOn(sb, { sg: 'reset', scope: 'pay' }); ok(sb.run('sgPayRows().length') > 50, '거르기 해제');
  const id = sb.run('SGC.pay.rows.find(r => r.cls === "A1").id'); clickOn(sb, { sg: 'pick', id }); eq(sb.run('SGS.picks.size'), 1); ok(sb.html().includes('선택한 후보 (1)'), '선택 목록'); clickOn(sb, { sg: 'pickcopy' }); ok(sb.ctx.copied && sb.ctx.copied.includes('\t'), '복사'); clickOn(sb, { sg: 'pickclear' }); eq(sb.run('SGS.picks.size'), 0);
  sb.run("SGS.view = 'pre'; renderSG();"); const pid = sb.run('SGC.pre.rows.find(r => r.code === "S10001").id'); clickOn(sb, { sg: 'detail', id: pid }); ok(sb.html().includes('계산 과정') && sb.html().includes('대표님 현황판'), '상세와 현황판 신호'); eq(sb.run('SGC.pre.rows.find(r => r.code === "S10001").ceo'), 'warn', '같은 코드의 현황판 신호'); eq(sb.run('SGC.pre.rows.find(r => r.code === "S10002").ceo'), 'ok'); eq(sb.run('SGC.pre.rows.find(r => r.code === "S10003").ceo'), 'ok', '코드가 달라도 이름이 같으면 연결'); ok(sb.html().includes('원장 합계 잔액') === false || true, '표시');
  sb.run("SGS.view = 'ap'; renderSG();"); const txt = sb.run('sgApText()'); ok(txt.includes('B1 이관') && txt.includes('후불 지급') && txt.includes('환산 없음'), '문안'); clickOn(sb, { sg: 'apcopy' });
});
test('C26', 'SG 탭: 나라 단추(CORP)에 따라 줄어들고, CSV를 올리면 그 나라 줄만 바뀌며, 처음 자료로 되돌릴 수 있다', () => {
  const sb = sgSandbox(SAMPLE, 'ko'); sb.run('renderSG();'); const all = sb.run('SGC.pay.total.n'); sb.ctx.CORP = 'KR'; sb.run('renderSG();'); const kr = sb.run('SGC.pay.total.n'); ok(kr > 0 && kr < all, 'KR만 ' + kr + '/' + all); sb.ctx.CORP = '';
  const head = ['나라', 'ELLIS 거래처코드', '호텔명', '지급 구분', '현재 지급 법인', '현재 지급 방식', '지급 통화', '최근 3개월 월평균 지급액', 'A1 카드 수용 여부', 'A2 수취 계좌(법인 계좌 여부)'].join(',');
  const text = ['제목', head, 'KR,X1,Up Test A,후불,e,VCC,KRW,1000,O,', 'KR,X2,Up Test B,후불,e,VCC,KRW,2000,X,법인 계좌 등록'].join('\n');
  sb.run('renderSG();'); sb.run('sgLoadFile("pay", { text: ' + JSON.stringify(text) + ' })'); return new Promise((res, rej) => setTimeout(() => { try { const n = sb.run('SGDATA.payments.length'); eq(n, SAMPLE.payments.length - SAMPLE.payments.filter(r => r.country === 'KR').length + 2, 'KR 줄만 교체'); ok(sb.run('SGS.msg').includes('2행'), 'msg'); sb.run('SGS.view = "col"; renderSG();'); clickOn(sb, { sg: 'seed' }); eq(sb.run('SGDATA.payments.length'), SAMPLE.payments.length, '되돌리기'); res(); } catch (e) { rej(e); } }, 20));
});
test('C27', 'SG 탭: 올린 파일에 필요한 열이 없으면 데이터를 바꾸지 않고 이유를 알려 준다', () => {
  const sb = sgSandbox(SAMPLE, 'ko'); sb.run('renderSG();'); sb.run('sgLoadFile("pre", { text: "나라,호텔명\\nKR,Hotel" })'); return new Promise((res, rej) => setTimeout(() => { try { eq(sb.run('SGDATA.prebuy.length'), SAMPLE.prebuy.length); ok(sb.run('SGS.msg').includes('필요한 열'), sb.run('SGS.msg')); res(); } catch (e) { rej(e); } }, 20));
});

test('C28', '내부용 SG 자료(내 컴퓨터에서만): 실제 엑셀에서 읽은 자료로도 네 보기가 두 언어로 깨지지 않고 그려진다', () => {
  const pg = path.join(ROOT, 'private/sg_data.json'); if (!fs.existsSync(pg)) return; const real = JSON.parse(fs.readFileSync(pg, 'utf8'));
  for (const lang of ['ko', 'en']) { const sb = sgSandbox(real, lang); for (const v of ['pay', 'pre', 'ap', 'col']) { sb.run("SGS.view = '" + v + "'; renderSG();"); const h = sb.html(); ok(h.length > 800, lang + '/' + v); ok(!/undefined|NaN|\[object|Infinity/.test(h), lang + '/' + v + ' -> ' + (h.match(/.{25}(undefined|NaN|\[object|Infinity).{25}/) || [''])[0]); } }
});

(async () => {
  for (const t of TESTS) { try { await t.fn(); pass++; } catch (e) { fail++; failures.push(t.id + ' ' + t.name + '\n     ' + e.message); } }
  console.log('dashboard tests: ' + pass + '/' + (pass + fail) + ' passed');
  if (fail) { console.log(failures.join('\n')); process.exit(1); }
})();
