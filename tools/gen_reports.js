'use strict';
// Builds the Requirements Traceability Matrix and tests/results/summary.json from REAL test results (no hand-entered pass marks).
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'); const out = path.join(root, '..');
const rd = p => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const reqs = rd('tools/requirements.json'), node = rd('tests/results/node_results.json'), ui = rd('tests/results/ui_results.json');
let mut = null; try { mut = rd('tests/results/mutation_results.json'); } catch (e) { /* optional */ }
const all = node.results.map(r => Object.assign({ suite: 'node' }, r)).concat(ui.results.map(r => Object.assign({ suite: 'ui' }, r)));
const rows = reqs.map(q => {
  const tests = all.filter(t => (t.reqs || []).includes(q.id)); const fail = tests.filter(t => t.status !== 'PASS');
  let status;
  if (q.external) status = tests.length ? 'MOCK-ONLY' : 'NOT-IMPLEMENTED (외부 의존)';
  else if (!tests.length) status = 'UNTESTED'; else status = fail.length ? 'FAIL' : 'PASS';
  return Object.assign({}, q, { tests: tests.map(t => t.id), status, failing: fail.map(t => t.id) });
});
const internal = rows.filter(r => !r.external); const mvp = rows.filter(r => /^T\d\d$/.test(r.id));
const summary = {
  generatedFrom: { node: node.ranAt, ui: ui.ranAt, mutation: mut && mut.ranAt },
  nodeTests: { total: node.total, passed: node.passed, failed: node.failed }, uiTests: { total: ui.total, passed: ui.passed, failed: ui.failed },
  totalTests: node.total + ui.total, totalPassed: node.passed + ui.passed,
  requirements: { total: rows.length, internal: internal.length, pass: internal.filter(r => r.status === 'PASS').length, untested: internal.filter(r => r.status === 'UNTESTED').length, fail: internal.filter(r => r.status === 'FAIL').length, external: rows.filter(r => r.external).length },
  mvp15: { total: mvp.length, pass: mvp.filter(r => r.status === 'PASS').length, passRatePct: mvp.length ? Math.round(1000 * mvp.filter(r => r.status === 'PASS').length / mvp.length) / 10 : 0 },
  mutation: mut ? { applied: mut.applied, killed: mut.killed } : null,
};
fs.writeFileSync(path.join(root, 'tests/results/summary.json'), JSON.stringify(summary, null, 2));
const esc = s => String(s).replace(/\|/g, '\\|');
const md = ['# 11. 요구사항 추적 매트릭스 (Requirements Traceability Matrix)', '',
  '이 표는 `prototype/tools/gen_reports.js`가 `tools/requirements.json`과 실제 테스트 실행 결과(`tests/results/*.json`)를 합쳐 생성한다. 검증 결과 열은 사람이 입력하지 않는다.', '',
  '- 생성 기준: Node 테스트 ' + node.ranAt + ' · 브라우저 UI 테스트 ' + ui.ranAt, '- 요구사항 ' + summary.requirements.total + '건 중 내부 구현 ' + summary.requirements.internal + '건: PASS ' + summary.requirements.pass + ', FAIL ' + summary.requirements.fail + ', UNTESTED ' + summary.requirements.untested + '. 외부 의존 ' + summary.requirements.external + '건은 별도 표기.',
  '- 필수 MVP 테스트(§9의 15종, T01~T15): ' + summary.mvp15.pass + '/' + summary.mvp15.total + ' PASS', '',
  '| 요구사항 ID | 요구사항 | 우선순위 | 설계 문서 | 구현 모듈 | 테스트 케이스 | 검증 결과 |', '|---|---|---|---|---|---|---|']
  .concat(rows.map(r => '| ' + [r.id, esc(r.title), r.pri, esc(r.design), esc(r.impl), r.tests.length ? r.tests.join(', ') : '—', r.status + (r.failing.length ? ' (' + r.failing.join(',') + ')' : '')].join(' | ') + ' |'));
md.push('', '## 판정 규칙', '', '- PASS: 연결된 테스트가 1건 이상이고 모두 통과.', '- UNTESTED: 연결된 테스트가 없다. 통과로 세지 않는다.', '- MOCK-ONLY / NOT-IMPLEMENTED: 외부 시스템(ELLIS, 결재 포털, 중앙 DB, 환율 정책, AI API)이 필요해 실검증이 불가능하다. Mock 검증과 실운영 검증을 분리해 기록한다.', '');
fs.writeFileSync(path.join(out, '11_Requirements_Traceability_Matrix.md'), md.join('\n'));
console.log(JSON.stringify(summary, null, 1));

// ---- 08_Test_Cases_And_QA_Report.md from tools/qa_report_template.md
{
  let t = fs.readFileSync(path.join(root, 'tools/qa_report_template.md'), 'utf8');
  const cat = ['| ID | 구분 | 테스트 | 연결 요구사항 | 결과 |', '|---|---|---|---|---|'].concat(all.map(x => '| ' + [x.id, x.suite === 'ui' ? '브라우저' : 'Node', esc(x.name), (x.reqs || []).join(', '), x.status].join(' | ') + ' |')).join('\n');
  const sum = ['- Node 테스트: ' + node.passed + '/' + node.total + ' 통과 (' + node.ranAt + ', Node ' + node.node + ')', '- 브라우저 UI 테스트: ' + ui.passed + '/' + ui.total + ' 통과 (' + ui.ranAt + ')',
    '- 결함 주입 검사: ' + (mut ? mut.killed + '/' + mut.applied + ' 검출 (' + mut.ranAt + ')' : '미실행'), '- 요구사항 추적: 내부 구현 ' + summary.requirements.internal + '건 중 PASS ' + summary.requirements.pass + ', FAIL ' + summary.requirements.fail + ', UNTESTED ' + summary.requirements.untested,
    '- 필수 MVP 15종: ' + summary.mvp15.pass + '/' + summary.mvp15.total + ' (' + summary.mvp15.passRatePct + '%)'].join('\n');
  t = t.split('{{SUMMARY}}').join(sum).split('{{CATALOGUE}}').join(cat).split('{{NODE_N}}').join(String(node.total)).split('{{UI_N}}').join(String(ui.total)).split('{{MUT}}').join(mut ? mut.killed + '/' + mut.applied : '미실행').split('{{MARKS}}').join('표시');
  fs.writeFileSync(path.join(out, '08_Test_Cases_And_QA_Report.md'), t);
}
