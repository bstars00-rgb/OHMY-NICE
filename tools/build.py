#!/usr/bin/env python3
"""엑셀(재무·SCM 작성 양식) -> 대시보드(HTML 한 파일).

사용법
  python tools/build.py --in 양식.xlsx [더 많은 .xlsx ...] --out private/대시보드.html
  python tools/build.py --in sample/SG지급_자료수집_샘플.xlsx --synthetic --out out/index.html     (가상 샘플, 공개 가능)

- 실제 자료로 만든 파일은 private/ 폴더에만 쓴다(--synthetic 없이 다른 폴더에 쓰려면 --allow-outside-private).
- 이 스크립트는 엑셀을 읽어 값만 꺼낸다. 분류·소진 계산·신호·점검은 src/calc.js가 화면에서 한다(엑셀의 수식 결과는 쓰지 않는다).
- 시트는 이름으로 찾는다: '①' 또는 '지급목록'이 든 시트, '②' 또는 '프리바이'가 든 시트. 열은 머리글 글자로 찾으므로 열 순서가 바뀌어도 된다.
"""
import argparse, datetime as dt, json, os, re, sys

try:
    import openpyxl
except ImportError:
    sys.exit('openpyxl이 필요합니다: pip install openpyxl')

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# 머리글(공백·줄바꿈 제거) -> 항목. (키, 머리글 시작 글자, 정확히 같아야 하면 True)
PAY_COLS = [
    ('country', '나라', False), ('code', 'ELLIS거래처코드', False), ('hotel', '호텔명', False), ('kind', '지급구분', False), ('entity', '현재지급법인', False),
    ('method', '현재지급방식', False), ('ccy', '지급통화', False), ('avg', '최근3개월월평균지급액', False), ('card', 'A1카드수용여부', False), ('account', 'A2수취계좌', False),
    ('sheetClass', '분류', False), ('note', '비고', False), ('owner', '작성담당', False), ('filledAt', '작성일', False),
]
PRE_COLS = [
    ('entity', '법인', True), ('country', '나라', True), ('hotel', '호텔명', False), ('code', 'ELLIS호텔코드', False), ('type', '프리바이종류', False), ('ccy', '통화', True),
    ('ledger', '대장상잔액', False), ('hotelBal', '호텔확인잔액', False), ('asOf', '기준일', False), ('gap', '잔액차이', False), ('avg', '최근3개월월평균소진액', False),
    ('months', '소진예상개월', False), ('canUse', '12/31까지소진가능', False), ('transfer', '이관가능', False), ('transferNote', '이관조건', False), ('refund', '반환가능', False),
    ('refundNote', '반환조건', False), ('sheetClass', '참고분류', False), ('note', '비고', False), ('owner', '작성담당', False), ('est', '12/31예상잔액', False),
]
PAY_REQUIRED = {'country', 'hotel', 'kind', 'ccy', 'avg', 'card', 'account'}
PRE_REQUIRED = {'country', 'hotel', 'type', 'ccy', 'ledger', 'hotelBal', 'asOf', 'avg', 'transfer', 'refund'}
NUMERIC_PAY = {'avg'}
NUMERIC_PRE = {'ledger', 'hotelBal', 'gap', 'avg', 'months', 'est'}
DATE_PRE = {'asOf'}
DATE_PAY = {'filledAt'}
YES = {'O', '○', '◯', 'Y', 'YES', '가능', '예', '수용'}
NO = {'X', '×', '✕', 'N', 'NO', '불가', '아니오', '미수용'}
UNKNOWN = {'미확인', '?', '모름'}


def norm_header(v):
    return re.sub(r'\s+', '', str(v or ''))


def find_header_row(ws, first_key):
    for i, row in enumerate(ws.iter_rows(min_row=1, max_row=15, values_only=True), start=1):
        if row and any(norm_header(c) == first_key for c in row):
            return i
    return None


def map_columns(header_cells, spec):
    """spec: [(key, 시작글자, 정확히)] -> {key: 열 번호(0부터)}. 먼저 오는 규칙이 우선, 같은 열을 두 번 쓰지 않는다."""
    heads = [norm_header(c) for c in header_cells]
    out, used = {}, set()
    for key, prefix, exact in spec:
        for idx, h in enumerate(heads):
            if idx in used or not h:
                continue
            if (h == prefix) if exact else h.startswith(prefix):
                out[key] = idx; used.add(idx); break
    return out


def to_number(v):
    if v is None or v == '':
        return None
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return int(v) if float(v).is_integer() else float(v)
    s = str(v).strip().replace(',', '').replace('₩', '').replace('¥', '').replace('₫', '')
    if s in ('', '-', '—'):
        return None
    try:
        f = float(s)
        return int(f) if f.is_integer() else f
    except ValueError:
        return 'ERR:' + str(v)


def to_date(v):
    if v is None or v == '':
        return None
    if isinstance(v, dt.datetime):
        return v.date().isoformat()
    if isinstance(v, dt.date):
        return v.isoformat()
    s = str(v).strip()
    m = re.match(r'^(\d{4})[-./](\d{1,2})[-./](\d{1,2})', s)
    if m:
        return '%04d-%02d-%02d' % tuple(int(x) for x in m.groups())
    return 'ERR:' + s


def to_yn(v):
    if v is None or str(v).strip() == '':
        return None
    s = str(v).strip().upper()
    if s in {x.upper() for x in YES}:
        return 'O'
    if s in {x.upper() for x in NO}:
        return 'X'
    if s in UNKNOWN:
        return '미확인'
    return 'ERR:' + str(v).strip()


def to_text(v):
    if v is None:
        return None
    s = str(v).strip()
    return s if s else None


def read_sheet(ws, spec, first_key, required, numeric, dates, yn_keys, issues, sheet_label):
    hrow = find_header_row(ws, first_key)
    if hrow is None:
        issues.append({'sheet': sheet_label, 'msg': '머리글 줄(첫 칸 "%s")을 찾지 못했습니다' % first_key})
        return []
    header = [c.value for c in ws[hrow]]
    cols = map_columns(header, spec)
    missing = sorted(required - set(cols))
    if missing:
        raise SystemExit('[%s] 필요한 열을 찾지 못했습니다: %s\n  머리글: %s' % (sheet_label, ', '.join(missing), [norm_header(h) for h in header if h]))
    rows = []
    for r in range(hrow + 1, ws.max_row + 1):
        vals = [c.value for c in ws[r]]
        get = lambda k: vals[cols[k]] if k in cols and cols[k] < len(vals) else None
        if all(get(k) in (None, '') for k in ('hotel', 'country', 'ledger', 'avg')):
            continue
        rec = {'sourceRow': r}
        for key, _, _ in spec:
            if key not in cols:
                rec[key] = None; continue
            raw = get(key)
            if key in numeric:
                val = to_number(raw)
            elif key in dates:
                val = to_date(raw)
            elif key in yn_keys:
                val = to_yn(raw)
            else:
                val = to_text(raw)
            if isinstance(val, str) and val.startswith('ERR:'):
                issues.append({'sheet': sheet_label, 'row': r, 'field': key, 'raw': val[4:], 'msg': '값을 해석하지 못했습니다'})
                val = None
            rec[key] = val
        rows.append(rec)
    return rows


def find_sheet(wb, *needles):
    for ws in wb.worksheets:
        if any(n in ws.title for n in needles):
            return ws
    return None


def guide_dates(wb, year):
    """작성안내 시트에서 마감일(재무·SCM)과 결재일을 찾는다. 없으면 None."""
    ws = find_sheet(wb, '안내')
    text = ''
    if ws is not None:
        text = ' '.join(str(c.value) for row in ws.iter_rows() for c in row if c.value)
    out = {}
    for key, pat in (('finance', r'재무\s*(\d{1,2})/(\d{1,2})'), ('scm', r'SCM\s*(\d{1,2})/(\d{1,2})'), ('approval', r'(\d{1,2})/(\d{1,2})\s*대표\s*결재')):
        m = re.search(pat, text)
        if m:
            out[key] = '%04d-%02d-%02d' % (year, int(m.group(1)), int(m.group(2)))
    return out


def parse_workbook(path, issues):
    wb = openpyxl.load_workbook(path, data_only=True)
    ws1 = find_sheet(wb, '①', '지급목록'); ws2 = find_sheet(wb, '②', '프리바이')
    if ws1 is None and ws2 is None:
        raise SystemExit('시트를 찾지 못했습니다(①지급목록 또는 ②프리바이목록): %s' % [w.title for w in wb.worksheets])
    pay = read_sheet(ws1, PAY_COLS, '나라', PAY_REQUIRED, NUMERIC_PAY, DATE_PAY, {'card'}, issues, '①지급목록') if ws1 is not None else []
    pre = read_sheet(ws2, PRE_COLS, '법인', PRE_REQUIRED, NUMERIC_PRE, DATE_PRE, {'transfer', 'refund'}, issues, '②프리바이목록') if ws2 is not None else []
    for r in pay:
        r['file'] = os.path.basename(path)
    for r in pre:
        r['file'] = os.path.basename(path)
    return wb, pay, pre


def build_data(paths, synthetic, today):
    issues, pays, pres, sources, deadlines = [], [], [], [], {}
    for p in paths:
        wb, pay, pre = parse_workbook(p, issues)
        sources.append({'name': os.path.basename(p), 'payRows': len(pay), 'preRows': len(pre)})
        year = max([int(r['asOf'][:4]) for r in pre if r.get('asOf')] or [int(today[:4])])
        deadlines.update(guide_dates(wb, year))
        pays += pay; pres += pre
    as_ofs = sorted(r['asOf'] for r in pres if r.get('asOf'))
    year = int(as_ofs[-1][:4]) if as_ofs else int(today[:4])
    config = {'yearEnd': '%04d-12-31' % year}
    if deadlines:
        config['deadlines'] = {**{'finance': None, 'scm': None, 'approval': None}, **deadlines}
        config['deadlines'] = {k: v for k, v in config['deadlines'].items() if v}
    meta = {'schema': 1, 'synthetic': bool(synthetic), 'builtAt': dt.datetime.now().isoformat(timespec='seconds'), 'today': today, 'sources': sources,
            'asOfMin': as_ofs[0] if as_ofs else None, 'asOfMax': as_ofs[-1] if as_ofs else None, 'config': config, 'parseIssues': issues}
    return {'meta': meta, 'payments': pays, 'prebuy': pres}


def assemble(data):
    def read(n):
        with open(os.path.join(ROOT, 'src', n), encoding='utf-8') as f:
            return f.read()
    html = read('template.html')
    js = '\n'.join(read(n) for n in ('calc.js', 'i18n.js', 'app.js'))
    payload = json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
    for marker, value in (('/*__STYLE__*/', read('style.css')), ('/*__SCRIPT__*/', js), ('/*__DATA__*/', payload)):
        if marker not in html:
            raise SystemExit('template.html에 %s 표시가 없습니다' % marker)
        html = html.replace(marker, value)
    return html


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--in', dest='inputs', nargs='+', required=True, help='엑셀 파일(여러 개 가능)')
    ap.add_argument('--out', required=True, help='만들 HTML 경로')
    ap.add_argument('--json', help='정규화한 자료(JSON)도 저장')
    ap.add_argument('--synthetic', action='store_true', help='가상 샘플 자료(공개 가능)로 표시')
    ap.add_argument('--allow-outside-private', action='store_true', help='실제 자료 결과를 private/ 밖에 쓰는 것을 허용(공개 저장소에 올리지 말 것)')
    ap.add_argument('--today', default=dt.date.today().isoformat(), help='오늘 날짜(마감까지 남은 일수 계산용)')
    a = ap.parse_args()
    out = os.path.abspath(a.out)
    private = os.path.join(ROOT, 'private') + os.sep
    if not a.synthetic and not out.startswith(private) and not a.allow_outside_private:
        sys.exit('실제 자료로 만든 파일은 %s 안에 써야 합니다(공개 저장소에 올라가지 않게). 가상 샘플이면 --synthetic을 붙이세요.' % private)
    data = build_data(a.inputs, a.synthetic, a.today)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'w', encoding='utf-8', newline='\n') as f:
        f.write(assemble(data))
    if a.json:
        with open(a.json, 'w', encoding='utf-8', newline='\n') as f:
            json.dump(data, f, ensure_ascii=False)
    m = data['meta']
    print('만들었습니다:', out)
    print('  ①지급 %d행 · ②프리바이 %d행 · 기준일 %s ~ %s · 해석 못 한 칸 %d' % (len(data['payments']), len(data['prebuy']), m['asOfMin'], m['asOfMax'], len(m['parseIssues'])))
    print('  자료 구분:', '가상 샘플(공개 가능)' if a.synthetic else '실제 자료(내부용, 깃허브·공개 페이지에 올리지 말 것)')


if __name__ == '__main__':
    main()
