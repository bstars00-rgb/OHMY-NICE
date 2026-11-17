'use strict';
// 정규화한 자료(JSON)의 요약을 글로 찍는다. Claude가 갱신 결과를 보고할 때 쓴다.
// 사용법: node tools/summary.js private/data.json
const fs = require('fs'), path = require('path');
const C = require(path.join(__dirname, '../src/calc.js'));
const file = process.argv[2]; if (!file) { console.error('사용법: node tools/summary.js <data.json>'); process.exit(1); }
const d = JSON.parse(fs.readFileSync(file, 'utf8')); const cfg = C.cfgOf(d); const today = d.meta.today;
const pay = C.paymentStats(d.payments), pre = C.prebuyStats(d.prebuy, cfg), prog = C.progress(d, today), iss = C.validate(d), pk = C.approvalPacket(d);
const fmt = (n, c) => n === null || n === undefined ? '-' : Math.round(n).toLocaleString('ko-KR') + ' ' + c;
console.log('자료: ' + (d.meta.synthetic ? '가상 샘플' : '실제 자료(내부용)') + ' · 파일 ' + d.meta.sources.map(s => s.name).join(', ') + ' · 기준일 ' + d.meta.asOfMin + ' ~ ' + d.meta.asOfMax);
console.log('\n[① 후불 지급] ' + (pay.total.n - pay.total.PRE) + '곳 · A1 ' + pay.total.A1 + ' · A2 ' + pay.total.A2 + ' · 예외 검토 ' + pay.total.EXC + ' · 확인 필요 ' + pay.total.TBD + ' · 선불 ' + pay.total.PRE);
console.log('  답한 곳 ' + prog.payments.done + ' · 미확인 ' + prog.payments.unknown + ' · 계좌 칸 비음 ' + prog.payments.partial + ' · 비어 있음 ' + prog.payments.empty);
for (const c of Object.keys(prog.payments.byCountry).sort()) { const x = prog.payments.byCountry[c]; console.log('   ' + c + ': 대상 ' + x.due + ' / 답함 ' + (x.done + x.unknown) + ' / 비어 있음 ' + x.empty); }
console.log('\n[② 프리바이] ' + pre.count + '곳 · 재무 입력 ' + prog.prebuy.finance + '/' + prog.prebuy.n + ' · SCM 답변 ' + prog.prebuy.scmAnswered + '/' + prog.prebuy.n);
for (const l of pk.lines) console.log('  ' + C.labelOf(l.cls) + ' ' + l.ccy + ': ' + l.n + '곳 · 대장 ' + fmt(l.ledger, l.ccy) + ' · 12/31 예상 ' + (l.estKnown ? fmt(l.est, l.ccy) : '-'));
console.log('  신호: 위험 ' + pre.signals.bad + ' · 주의 ' + pre.signals.warn + ' · 정상 ' + pre.signals.ok + ' · 자료 대기 ' + pre.signals.na);
const cnt = {}; for (const i of iss) { const k = i.sev + ' ' + i.code; cnt[k] = (cnt[k] || 0) + 1; }
console.log('\n[점검] 오류 ' + iss.filter(i => i.sev === 'error').length + ' · 확인 ' + iss.filter(i => i.sev === 'warn').length + ' · 참고 ' + iss.filter(i => i.sev === 'info').length); for (const k of Object.keys(cnt)) console.log('  ' + k + ' × ' + cnt[k]);
if (d.meta.parseIssues.length) console.log('\n[엑셀에서 읽지 못한 칸] ' + d.meta.parseIssues.length + '건'); 
const dl = prog.deadlines; console.log('\n마감: 재무 ' + dl.finance.date + '(' + dl.finance.daysLeft + '일) · SCM ' + dl.scm.date + '(' + dl.scm.daysLeft + '일) · 결재 ' + dl.approval.date + '(' + dl.approval.daysLeft + '일)  (음수 = 지남)');
