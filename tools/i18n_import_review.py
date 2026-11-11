# -*- coding: utf-8 -*-
"""Reads a reviewed translation workbook (OMH-NICE_Translation_Review_JA.xlsx / _VI.xlsx) and writes a chunk file for tools/i18n_build.js.
Usage: python tools/i18n_import_review.py <reviewed.xlsx> [out.json]
Then:  node tools/i18n_build.js out.json   and   node tests/run_all.js
Rejects the file (writes nothing) if any row has no result, a correction drops/changes {n} placeholders, or leaves Korean text."""
import json, os, re, sys
from openpyxl import load_workbook

if len(sys.argv) < 2:
    sys.exit(__doc__)
path = sys.argv[1]
m = re.search(r'_(JA|VI)\.xlsx$', os.path.basename(path), re.I)
if not m:
    sys.exit('file name must end with _JA.xlsx or _VI.xlsx')
lg = m.group(1).lower()
out = sys.argv[2] if len(sys.argv) > 2 else os.path.splitext(path)[0] + '_corrections.json'
wb = load_workbook(path, data_only=True)
HANGUL = re.compile(r'[가-힣]')
tok = lambda s: sorted(re.findall(r'\{\d+\}', s or ''))
errors, fixes, questions, ok = [], {}, [], 0
ws = wb['검수']
hdr = [c.value for c in ws[1]]
col = {h: i for i, h in enumerate(hdr)}
for r in ws.iter_rows(min_row=2, values_only=True):
    if r[col['No']] is None:
        continue
    ko, cur = r[col['한국어 원문']], r[[i for i, h in enumerate(hdr) if str(h).startswith('현재 번역')][0]]
    res, fix, note = (r[col['검수 결과']] or '').strip(), r[col['수정안']], r[col['코멘트']]
    no = r[col['No']]
    if res not in ('OK', '수정', '질문'):
        errors.append('No %s: 검수 결과가 비어 있거나 올바르지 않음 (%r)' % (no, res)); continue
    if res == 'OK':
        ok += 1
    elif res == '질문':
        questions.append((no, ko, note))
    else:
        if not fix or not str(fix).strip():
            errors.append('No %s: "수정"인데 수정안이 비어 있음' % no); continue
        fix = str(fix)
        if tok(fix) != tok(ko):
            errors.append('No %s: 자리표시가 원문과 다름 %s -> %s' % (no, tok(ko), tok(fix)))
        elif HANGUL.search(fix):
            errors.append('No %s: 수정안에 한국어가 남아 있음' % no)
        else:
            fixes[ko] = {lg: fix}
# glossary sheet corrections (applied to that exact key only)
if '용어집' in wb.sheetnames:
    for r in wb['용어집'].iter_rows(min_row=2, values_only=True):
        if r[0] and r[3] and str(r[3]).strip():
            if tok(str(r[3])) != tok(r[0]) or HANGUL.search(str(r[3])):
                errors.append('용어집 %s: 수정안 형식 오류' % r[0])
            else:
                fixes.setdefault(r[0], {})[lg] = str(r[3]); print('용어집 수정:', r[0], '->', r[3], '(다른 문구에 같은 용어가 있으면 별도 확인 필요)')
if errors:
    print('가져오기 중단 — %d건 오류:' % len(errors)); [print('  ' + e) for e in errors[:50]]; sys.exit(1)
json.dump(fixes, open(out, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
print('언어 %s: OK %d건, 수정 %d건, 질문 %d건 -> %s' % (lg, ok, len(fixes), len(questions), out))
for no, ko, note in questions:
    print('  질문 No %s: %s | %s' % (no, ko, note))
