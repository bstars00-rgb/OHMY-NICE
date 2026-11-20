#!/usr/bin/env python3
"""대표님 대시보드(선급금/하드 심사/관리) + 「SG 전환」 탭 -> 대시보드 HTML 한 파일.

기본 틀은 대표님이 공유한 대시보드(v21) 그대로이고, 그 위에 엑셀 양식(①지급목록, ②프리바이목록)을 읽어 보여 주는 「SG 전환」 탭을 더한다.

사용법
  # 내부용(실제 자료): 대표님 원본 코드와 원본 처음 자료 + 회신 엑셀
  python tools/build_ceo.py --sg-in 회신1.xlsx 회신2.xlsx --out private/선급금_대시보드_내부용.html
  # 대표님 CSV 3종(① 호텔 ② 입금·반환 ③ 소진)으로 처음 자료를 바꿀 때
  python tools/build_ceo.py --hotels-csv h.csv --deposits-csv d.csv --usage-csv u.csv --sg-in x.xlsx --out private/...html
  # 공개용(가상 샘플)
  python tools/build_ceo.py --public --sg-in sample/SG지급_자료수집_샘플.xlsx --out index.html

준비(한 번): node tools/ceo_split.js "<대표님 대시보드.html>"  -> private/base/ 와 src/template_public.html 이 만들어진다.
실제 자료가 든 결과는 private/ 안에만 쓴다(--public이 아니면 다른 곳에 쓰려는 것을 막는다)."""
import argparse, csv, datetime as dt, importlib.util, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
spec = importlib.util.spec_from_file_location('sgbuild', os.path.join(HERE, 'build.py')); sgb = importlib.util.module_from_spec(spec); spec.loader.exec_module(sgb)

NUM_KEYS = ['amt', 'limit', 'planMonthly', 'hotelBal', 'onbook', 'rooms', 'rn', 'sales', 'margin', 'topupMin']
KIND_MAP = {'new': '신규', 'topup': '충전', 'top-up': '충전', 'refund': '반환', 'carry-over': '이월', 'carry': '이월'}


def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read().replace('\r\n', '\n')


def once(text, anchor, new, label):
    n = text.count(anchor)
    if n != 1:
        raise SystemExit('틀에서 %s 위치를 찾지 못했습니다(%d곳). 대표님 대시보드 버전이 바뀌었는지 확인하세요.' % (label, n))
    return text.replace(anchor, new)


def read_csv_objects(path):
    with open(path, encoding='utf-8-sig', newline='') as f:
        rows = [r for r in csv.reader(f) if any(c.strip() for c in r)]
    hdr = [h.strip() for h in rows[0]]
    out = []
    for r in rows[1:]:
        o = {h: (r[i].strip() if i < len(r) else '') for i, h in enumerate(hdr)}
        for k in NUM_KEYS:
            if o.get(k, '') != '':
                try:
                    o[k] = float(o[k].replace(',', '').replace(' ', '')); o[k] = int(o[k]) if o[k].is_integer() else o[k]
                except ValueError:
                    pass
        if o.get('kind') and o['kind'].lower() in KIND_MAP:
            o['kind'] = KIND_MAP[o['kind'].lower()]
        out.append(o)
    return out


def merge_csv(seed, key, path):
    """대표님 데이터 탭과 같은 규칙: 올린 파일에 든 법인의 줄을 바꿔 넣는다."""
    objs = read_csv_objects(path); corps = {o.get('corp') for o in objs}
    if key == 'hotels':
        seed['hotels'] = [x for x in seed['hotels'] if x.get('corp') not in corps] + objs
    else:
        codes = {h['code'] for h in seed['hotels'] if h.get('corp') in corps}
        seed[key] = [x for x in seed[key] if x.get('corp') not in corps and not (x.get('code') in codes)] + objs
    return len(objs), sorted(c for c in corps if c)


def inject_sg(tpl, sg_data):
    css = 'button.pill{border:0;cursor:pointer;font:inherit}\n.hrow.detail td{cursor:default}\n' + read(os.path.join(ROOT, 'src', 'layout.css'))
    # 저장된 다크/화이트 선택을 첫 화면 그리기 전에 적용한다(깜빡임 방지)
    theme_boot = "<script>try{var t=localStorage.getItem('omh_theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}</script>"
    tpl = once(tpl, '</style>', css + '</style>\n' + theme_boot, '</style>')
    # 현황판 위 카드: 색 이름만 있으면 다른 담당자가 무엇을 센 숫자인지 모른다. 뜻을 붙이고 크게, 누르면 그 색만 거른다(대표님 코드 블록을 통째로 바꾼다).
    start_a = "document.getElementById('tiles').innerHTML = `"
    end_a = "`;\n  // filters"
    if tpl.count(start_a) != 1 or tpl.count(end_a) != 1:
        raise SystemExit('틀에서 현황판 카드 블록 위치를 찾지 못했습니다. 대표님 대시보드 버전이 바뀌었는지 확인하세요.')
    i0 = tpl.index(start_a); i1 = tpl.index(end_a) + 2
    tpl = tpl[:i0] + read(os.path.join(ROOT, 'src', 'tiles.js')).rstrip('\n') + tpl[i1:]
    tpl = once(tpl, '<button role="tab" data-v="data" aria-selected="false" data-i="tData">데이터</button>', '<button role="tab" data-v="sg" aria-selected="false">SG 전환</button>\n  <button role="tab" data-v="data" aria-selected="false" data-i="tData">데이터</button>', '데이터 탭 단추')
    tpl = once(tpl, '<!-- ===== 데이터 ===== -->', '<!-- ===== SG 전환 ===== -->\n<section class="view" id="v-sg"></section>\n\n<!-- ===== 데이터 ===== -->', '데이터 탭 구역')
    old_tabs = "['board','credit','check','monitor','deposit','data','rule','hard']"
    if tpl.count(old_tabs) != 2:
        raise SystemExit('틀의 탭 목록 위치를 찾지 못했습니다')
    tpl = tpl.replace(old_tabs, "['board','credit','check','monitor','deposit','sg','data','rule','hard']")
    tpl = once(tpl, 'renderCheck();renderMonitor();renderData();renderCase()}', "renderCheck();renderMonitor();renderData();renderCase();if(typeof renderSG==='function')renderSG()}", 'renderAll')
    tpl = once(tpl, 'renderCorpBar();renderBoard();renderMonitor();renderDeposit()});', "renderCorpBar();renderBoard();renderMonitor();renderDeposit();if(typeof renderSG==='function')renderSG()});", '나라 단추')
    scripts = '\n'.join('<script>\n' + read(os.path.join(ROOT, 'src', n)) + '\n</script>' for n in ('calc.js', 'i18n.js', 'sg_import.js'))
    ui = read(os.path.join(ROOT, 'src', 'sg_ui.js'))
    payload = json.dumps(sg_data, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
    ui = once(ui, '/*__SGDATA__*/null', payload, 'sg_ui.js 자료 표시')
    tpl = once(tpl, '<script>\n/* ---------- 기준값', scripts + '\n<script>\n' + ui + '\n</script>\n<script>\n/* ---------- 기준값', '대표님 스크립트 시작')
    # 화면 배치는 대표님 스크립트가 끝난 뒤에 실어, 이미 있는 요소를 옮긴다
    layout = read(os.path.join(ROOT, 'src', 'layout.js'))
    pick = read(os.path.join(ROOT, 'src', 'hotel_pick.js'))   # 호텔명 칸에 후보를 띄우고 값을 채운다(대표님 칸을 그대로 쓴다)
    return once(tpl, '</script>\n</body>', '</script>\n<script>\n' + layout + '\n</script>\n<script>\n' + pick + '\n</script>\n</body>', '대표님 스크립트 끝')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--out', required=True)
    ap.add_argument('--public', action='store_true', help='공개용: 정리된 틀(src/template_public.html)과 가상 처음 자료(sample/seed_public.json)를 쓴다')
    ap.add_argument('--sg-in', nargs='*', default=[], help='SG 자료 수집 엑셀(여러 개 가능)')
    ap.add_argument('--no-sg', action='store_true', help='「SG 전환」 탭을 넣지 않는다(대표님 원본과 같은지 비교할 때)')
    ap.add_argument('--seed', help='처음 자료 JSON(기본: 내부용 private/base/seed.json, 공개용 sample/seed_public.json)')
    ap.add_argument('--hotels-csv'); ap.add_argument('--deposits-csv'); ap.add_argument('--usage-csv')
    ap.add_argument('--json', help='SG 정규화 자료(JSON)도 저장')
    ap.add_argument('--today', default=dt.date.today().isoformat())
    a = ap.parse_args()
    out = os.path.abspath(a.out); private = os.path.join(ROOT, 'private') + os.sep
    if not a.public and not out.startswith(private):
        sys.exit('실제 자료로 만든 파일은 %s 안에 써야 합니다. 가상 샘플이면 --public을 붙이세요.' % private)
    tpl_path = os.path.join(ROOT, 'src', 'template_public.html') if a.public else os.path.join(ROOT, 'private', 'base', 'template_internal.html')
    seed_path = a.seed or (os.path.join(ROOT, 'sample', 'seed_public.json') if a.public else os.path.join(ROOT, 'private', 'base', 'seed.json'))
    for p in (tpl_path, seed_path):
        if not os.path.exists(p):
            sys.exit('없는 파일: %s\n먼저 node tools/ceo_split.js "<대표님 대시보드.html>" (공개용 자료는 python tools/make_seed_public.py)를 실행하세요.' % p)
    tpl = read(tpl_path)
    with open(seed_path, encoding='utf-8') as f:
        seed = json.load(f)
    notes = []
    for key, path in (('hotels', a.hotels_csv), ('deposits', a.deposits_csv), ('usage', a.usage_csv)):
        if path:
            n, corps = merge_csv(seed, key, path); notes.append('%s CSV %d행 (법인 %s)' % (key, n, ','.join(corps)))
    tpl = once(tpl, 'const SEED = /*__SEED__*/{};', 'const SEED = ' + json.dumps(seed, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/') + ';', 'SEED')
    if a.public:  # 가상 샘플은 기준일에 고정한다: 보는 날이 바뀌어도 가상 호텔의 신호 색이 그대로다
        tpl = once(tpl, "const today = new Date(); today.setHours(0,0,0,0);", "const today = new Date('%sT00:00:00');" % a.today, '오늘 날짜')
    sg = {'meta': {'synthetic': bool(a.public), 'today': a.today, 'sources': [], 'asOfMin': None, 'asOfMax': None, 'config': {}, 'parseIssues': []}, 'payments': [], 'prebuy': []}
    if a.sg_in:
        d = sgb.build_data(a.sg_in, a.public, a.today); sg = {'meta': d['meta'], 'payments': d['payments'], 'prebuy': d['prebuy']}
        sg['meta']['synthetic'] = bool(a.public)
        if a.public:
            sg['meta']['builtAt'] = a.today + 'T00:00:00'
    if not a.no_sg:
        tpl = inject_sg(tpl, sg)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'w', encoding='utf-8', newline='\n') as f:
        f.write(tpl)
    if a.json:
        with open(a.json, 'w', encoding='utf-8', newline='\n') as f:
            json.dump(sg, f, ensure_ascii=False)
    print('만들었습니다:', out)
    print('  대표님 대시보드: 호텔 %d · 입금·반환 %d · 소진 %d%s' % (len(seed['hotels']), len(seed['deposits']), len(seed['usage']), (' · ' + ' · '.join(notes)) if notes else ''))
    if not a.no_sg:
        print('  SG 전환: ①지급 %d행 · ②프리바이 %d행' % (len(sg['payments']), len(sg['prebuy'])))
    print('  자료 구분:', '가상 샘플(공개 가능)' if a.public else '실제 자료(내부용, 깃허브·공개 페이지에 올리지 말 것)')


if __name__ == '__main__':
    main()
