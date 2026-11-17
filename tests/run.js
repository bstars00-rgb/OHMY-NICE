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
function test(id, name, fn) { try { fn(); pass++; } catch (e) { fail++; failures.push(id + ' ' + name + '\n     ' + e.message); } }
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
test('C16', '글: ko·en 열쇠가 같고, 코드로 만든 문장이 모두 번역돼 있다', () => {
  const kk = Object.keys(I.ko).sort(), ke = Object.keys(I.en).sort(); eq(kk.filter(k => !(k in I.en)), [], 'en에 없는 열쇠'); eq(ke.filter(k => !(k in I.ko)), [], 'ko에 없는 열쇠');
  const calc = fs.readFileSync(path.join(ROOT, 'src/calc.js'), 'utf8'); const codes = [...new Set([...calc.matchAll(/'((?:PAY|PRE)_[A-Z0-9_]+)'/g)].map(m => m[1]))]; ok(codes.length >= 15, 'code count ' + codes.length); for (const c of codes) ok(c in I.ko && c in I.en, c);
  const app = fs.readFileSync(path.join(ROOT, 'src/app.js'), 'utf8'); const used = [...new Set([...app.matchAll(/\bt\('([A-Za-z0-9_]+)'\s*[,)]/g)].map(m => m[1]))]; for (const k of used) ok(k in I.ko && k in I.en, 'app.js 열쇠 ' + k);
  for (const c of ['A1', 'A2', 'EXC', 'TBD', 'B1', 'B2_USE', 'B2_REFUND', 'B2_TALK']) ok(I.ko[c + 'd'] && I.en[c + 'd'], c + 'd');
  for (const a of ['TRANSFER', 'CONSUME', 'REFUND', 'NEGOTIATE', 'CONFIRM']) ok(I.ko['act' + a] && I.en['act' + a], a);
});

/* ---- 화면 그리기 점검: 가짜 DOM으로 app.js를 돌려 모든 탭을 두 언어로 그린다 ---- */
function runApp(data, lang, tab) {
  const els = {}; const listeners = {};
  const mk = id => els[id] || (els[id] = { id, innerHTML: '', textContent: '', dataset: {}, style: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; }, addEventListener() { }, focus() { }, querySelectorAll() { return []; } });
  const doc = { getElementById: id => id === 'data' ? { textContent: JSON.stringify(data) } : mk(id), documentElement: { lang: 'ko', setAttribute() { }, getAttribute() { return null; } }, querySelectorAll: () => [], addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); }, createElement: () => ({ click() { }, remove() { }, select() { } }), body: { appendChild() { } } };
  const store = { omh_lang: lang };
  const ctx = { document: doc, location: { hash: '#' + tab }, history: { replaceState() { } }, localStorage: { getItem: k => store[k] || null, setItem: (k, v) => { store[k] = v; } }, navigator: {}, URL: { createObjectURL: () => '', revokeObjectURL() { } }, Blob: function () { }, setTimeout, console, Intl, JSON, Math, Object, String, Number, Array, Set, Date };
  ctx.window = { scrollTo() { }, __OMH: null }; ctx.self = ctx; ctx.globalThis = ctx; vm.createContext(ctx);
  const code = ['calc.js', 'i18n.js', 'app.js'].map(f => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8')).join('\n'); vm.runInContext(code, ctx);
  return { view: els.view.innerHTML, tabs: els.tabs.innerHTML, app: ctx.window.__OMH, els };
}
test('C17', '화면: 모든 탭이 두 언어로 그려지고 undefined·NaN·[object가 없다', () => {
  for (const lang of ['ko', 'en']) for (const tab of ['board', 'pay', 'pre', 'approval', 'collect', 'rules']) {
    const r = runApp(SAMPLE, lang, tab); ok(r.view.length > 500, lang + '/' + tab + ' length ' + r.view.length); ok(!/undefined|NaN|\[object|Infinity/.test(r.view), lang + '/' + tab + ' -> ' + (r.view.match(/.{20}(undefined|NaN|\[object|Infinity).{20}/) || [''])[0]);
    ok(r.tabs.includes('data-tab="board"'), 'tabs');
  }
});
test('C18', '화면: 이스케이프(호텔 이름의 꺾쇠가 그대로 나오지 않는다)', () => {
  const evil = JSON.parse(JSON.stringify(SAMPLE)); evil.payments[0].hotel = '<img src=x onerror=alert(1)>'; evil.prebuy[0].hotel = '"><script>alert(2)</script>'; evil.prebuy[0].note = '<b>x</b>';
  for (const tab of ['pay', 'pre', 'board', 'approval', 'collect']) { const r = runApp(evil, 'ko', tab); ok(!/<img src=x|<script>alert|<b>x<\/b>/.test(r.view), tab); }
});
test('C19', '화면: 가상 샘플과 내부 자료 표시, 실제 자료 파일 이름이 샘플 화면에 없다', () => {
  const real = JSON.parse(JSON.stringify(SAMPLE)); real.meta.synthetic = false; const a = runApp(SAMPLE, 'ko', 'board'), b = runApp(real, 'ko', 'board'); ok(a.view.includes('가상 샘플') && !a.view.includes('내부 자료'), 'synthetic'); ok(b.view.includes('내부 자료') && b.view.includes('올리지 마세요'), 'internal');
  ok(!JSON.stringify(SAMPLE.meta.sources).includes('Downloads') && !JSON.stringify(SAMPLE).includes('ELLIS와 원장'), 'no path');
});
test('C20', '화면: 빈 자료(행 0)에서도 깨지지 않는다', () => {
  const empty = { meta: { schema: 1, synthetic: true, builtAt: '2026-11-17T00:00:00', today: '2026-11-17', sources: [], asOfMin: null, asOfMax: null, config: {}, parseIssues: [] }, payments: [], prebuy: [] };
  for (const tab of ['board', 'pay', 'pre', 'approval', 'collect', 'rules']) { const r = runApp(empty, 'en', tab); ok(r.view.length > 100 && !/undefined|NaN/.test(r.view), tab); }
});

test('C21', '배포 파일: index.html이 src/와 샘플 자료에서 만든 것과 같다(고치고 다시 만들지 않은 채 올리는 일을 막는다)', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'); const read = n => fs.readFileSync(path.join(ROOT, 'src', n), 'utf8').replace(/\r\n/g, '\n');
  const style = /<style>([\s\S]*?)<\/style>/.exec(html)[1]; eq(style, read('style.css'), 'style');
  const data = /<script id="data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1].split('<\/').join('</'); eq(JSON.parse(data), SAMPLE, 'data');
  const code = html.slice(html.indexOf('</script>', html.indexOf('id="data"')) + 9); ok(code.includes(read('calc.js')) && code.includes(read('i18n.js')) && code.includes(read('app.js')), 'script');
  ok(SAMPLE.meta.synthetic === true, '샘플은 가상 자료');
});
test('C22', '실제 자료 보호: private/의 호텔 이름·거래처코드가 공개 대상 파일에 없다(내 컴퓨터에서만 검사)', () => {
  const pd = path.join(ROOT, 'private/data.json'); if (!fs.existsSync(pd)) return;
  const real = JSON.parse(fs.readFileSync(pd, 'utf8')); const needles = new Set();
  for (const r of real.payments.concat(real.prebuy)) { if (r.hotel && r.hotel.length >= 8) needles.add(r.hotel); if (r.code && String(r.code).length >= 5) needles.add(String(r.code)); }
  const targets = ['index.html', 'README.md', 'CLAUDE.md', 'src', 'tests/run.js', 'tests/test_build.py', 'tools', 'sample/sample_data.json'];
  const files = []; (function walk(p) { const f = path.join(ROOT, p); if (!fs.existsSync(f)) return; if (fs.statSync(f).isDirectory()) fs.readdirSync(f).forEach(n => walk(path.join(p, n))); else files.push(f); })('.');
  const hit = []; for (const f of files) { const rel = path.relative(ROOT, f).split(path.sep).join('/'); if (rel.startsWith('private/') || rel.startsWith('out/') || rel.endsWith('.xlsx')) continue; if (!targets.some(t => rel === t || rel.startsWith(t + '/'))) continue; const txt = fs.readFileSync(f, 'utf8'); for (const n of needles) if (txt.includes(n)) hit.push(rel + ' <- ' + n.slice(0, 12) + '…'); }
  eq(hit, [], '실제 자료가 공개 대상 파일에 들어감');
});

console.log('dashboard tests: ' + pass + '/' + (pass + fail) + ' passed');
if (fail) { console.log(failures.join('\n')); process.exit(1); }
