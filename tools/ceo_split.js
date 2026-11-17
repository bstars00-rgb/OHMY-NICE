'use strict';
// 대표님 대시보드(팀 공유본, 한 파일)를 기본으로 삼기 위해 코드와 자료를 나눈다.
//   node tools/ceo_split.js "<대표님 대시보드.html>"
// 만드는 것
//   private/base/ceo_original.html      원본 그대로(실제 자료가 들어 있어 내부용)
//   private/base/seed.json              원본의 처음 자료(SEED)를 JSON으로 꺼낸 것(실제 자료, 내부용)
//   private/base/template_internal.html 원본 코드. SEED 자리만 표시(/*__SEED__*/)로 바꿈. 내용(기준 탭 글 포함)은 그대로(내부용)
//   src/template_public.html            공개용 정리본: 사람 이름·내부 메모가 든 글을 뺌. SEED 자리만 표시
// 원본 코드는 한 글자도 고치지 않는다. 바꾸는 것은 SEED 자리 표시와 (공개용에서) 내부 메모를 뺀 것뿐이다.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const src = process.argv[2]; if (!src) { console.error('사용법: node tools/ceo_split.js "<대표님 대시보드.html>"'); process.exit(1); }
const raw = fs.readFileSync(src, 'utf8').replace(/\r\n/g, '\n'); const lines = raw.split('\n');

// ---- 1) SEED 찾기 ----
const sStart = lines.findIndex(l => l.startsWith('const SEED = {')); const sEnd = lines.findIndex(l => l.startsWith('let DATA = JSON.parse(JSON.stringify(SEED))'));
if (sStart < 0 || sEnd < 0 || sEnd <= sStart) { console.error('SEED 위치를 찾지 못했습니다'); process.exit(2); }
const seedText = lines.slice(sStart, sEnd).join('\n').replace(/^const SEED = /, '').replace(/;\s*$/, '');
const seed = vm.runInNewContext('(' + seedText + ')', {}, { timeout: 5000 });
for (const k of ['hotels', 'deposits', 'usage']) if (!Array.isArray(seed[k])) { console.error('SEED.' + k + ' 가 배열이 아닙니다'); process.exit(3); }
const MARK = 'const SEED = /*__SEED__*/{};';
const internal = lines.slice(0, sStart).concat([MARK]).concat(lines.slice(sEnd)).join('\n');

fs.mkdirSync(path.join(ROOT, 'private/base'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'private/base/ceo_original.html'), raw);
fs.writeFileSync(path.join(ROOT, 'private/base/seed.json'), JSON.stringify(seed));
fs.writeFileSync(path.join(ROOT, 'private/base/template_internal.html'), internal);
console.log('SEED: 호텔 ' + seed.hotels.length + ' · 입금·반환 ' + seed.deposits.length + ' · 소진 ' + seed.usage.length + ' · 심사 대기 ' + (seed.pending || []).length + ' (private/base/seed.json)');

// ---- 2) 공개용 정리본 ----
const SENSITIVE = /\bSang\b|Aerum|Sophia|원지연|Global SCM Director|JP 경리|Maple|Comfort|JP 11\/15|Teams|Kakao|eCount|Chichaya|Anna|Hanny|Bew|김도연|김영섭|임정빈/;
let pub = internal;
// (가) 국가 리드 이름
pub = pub.split('(KR Sophia·JP 원지연·VN 생)').join('(국가 리드)');
// (나-1) 코드 안의 거래처별 임시 경보(JP Comfort 후불 전환, JP 11/15 지급분)는 공개용에서 끈다
pub = pub.split("h.corp==='JP'&&/^Comfort (Hotel|Suites)\\b/.test(h.name||'')").join('false');
pub = pub.split('\n').filter(l => !(/^\s*if\(post\.length\)\{/.test(l) && /Comfort/.test(l)) && !(/^\s*if\(TODAY_S<='2026-11-12'/.test(l) && /JP 11\/15/.test(l))).join('\n');
// (나) I18N·L10N 사전: 이름·내부 메모가 든 항목을 뺀다(값으로 다시 써 넣는다)
function replaceObject(text, declStart, name) {
  const i = text.indexOf(declStart); if (i < 0) throw new Error(name + ' 선언을 찾지 못했습니다');
  let depth = 0, j = text.indexOf('{', i), k = j, inStr = null, esc = false;
  for (; k < text.length; k++) { const c = text[k]; if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === inStr) inStr = null; continue; } if (c === '"' || c === "'" || c === '`') { inStr = c; continue; } if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) break; } }
  const obj = vm.runInNewContext('(' + text.slice(j, k + 1) + ')', {}, { timeout: 5000 }); return { i, j, k, obj };
}
function scrub(o) { let n = 0; for (const lang of Object.keys(o)) { const d = o[lang]; for (const key of Object.keys(d)) { if (SENSITIVE.test(key) || SENSITIVE.test(String(d[key]))) { delete d[key]; n++; } } } return n; }
let removed = 0;
for (const [decl, nm] of [['const I18N = {', 'I18N'], ['const L10N={', 'L10N']]) {
  const r = replaceObject(pub, decl, nm); removed += scrub(r.obj);
  pub = pub.slice(0, r.i) + decl.replace(/\{$/, '') + JSON.stringify(r.obj) + pub.slice(r.k + 1);
}
// (다) HTML 본문: 이름·메모가 든 항목(li, p, 표 줄)을 뺀다. 코드 줄은 건드리지 않는다.
const out = []; let htmlRemoved = 0; const pl = pub.split('\n'); const scriptStart = pl.findIndex(l => l.trim() === '<script>');
pl.forEach((l, idx) => { if (idx < scriptStart && SENSITIVE.test(l) && /^\s*<(li|p|tr)\b/.test(l)) { htmlRemoved++; return; } out.push(l); });
pub = out.join('\n');
// (라) 점검: 남은 것이 있으면 멈춘다
const rest = pub.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => SENSITIVE.test(l));
if (rest.length) { console.error('공개용에 남은 민감한 글:\n' + rest.map(([n, l]) => '  ' + n + ': ' + l.slice(0, 140)).join('\n')); process.exit(4); }
fs.writeFileSync(path.join(ROOT, 'src/template_public.html'), pub);
console.log('공개용 정리본: 사전 항목 ' + removed + '개, HTML 항목 ' + htmlRemoved + '개를 뺐습니다(src/template_public.html)');
