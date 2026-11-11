# -*- coding: utf-8 -*-
"""Builds the translation review workbooks (Japanese, Vietnamese) for native-speaker reviewers.
Usage: python tools/i18n_review_pack.py            -> ../i18n_review/OMH-NICE_Translation_Review_{JA,VI}.xlsx
Reads the live source strings (node tools/i18n_extract.js) and the current packs in js/i18n/*.js."""
import json, os, re, subprocess, sys
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(os.path.dirname(ROOT), 'i18n_review')
os.makedirs(OUT, exist_ok=True)
subprocess.run(['node', os.path.join(ROOT, 'tools', 'i18n_extract.js')], check=True, stdout=subprocess.DEVNULL)
SRC = json.load(open(os.path.join(ROOT, 'tools', 'i18n_source.json'), encoding='utf8'))

def read_pack(lg):
    t = open(os.path.join(ROOT, 'js', 'i18n', lg + '.js'), encoding='utf8').read()
    return json.loads(re.search(r"\['" + lg + r"'\] = (\{[\s\S]*?\});\s*\n\s*if \(typeof module", t).group(1))

# where each string appears (extract tool records the first source file)
WHERE = json.loads(subprocess.run(['node', '-e', "const {extract}=require('./tools/i18n_extract');const o={};for(const [k,v] of extract().pairs)o[k]=v.where;console.log(JSON.stringify(o))"], cwd=ROOT, capture_output=True, text=True, encoding='utf8', check=True).stdout)
AREA = {'js/ui/common.js': '공통 라벨(등급·경보·오류·상태)', 'js/ui/views_a.js': '대시보드·호텔 신용 카드', 'js/ui/views_b.js': '원장·충전 시뮬레이터', 'js/ui/views_c.js': '위험 센터·선급 결재 자료·관리',
        'js/app.js': '메뉴·상단 제목', 'js/adapters/adapters.js': '연동 상태·AI 모의', 'js/engine/rating.js': '평가 항목·위험 신호 이름', 'js/engine/alerts.js': '경보 규칙·권고 조치 이름', 'js/data/seed.js': '샘플 호텔·도시 이름'}
# strings the translators flagged as uncertain (review first)
PRIORITY = ['대표 승인', '대표 반려', '오탐 기각', '호텔 확인', '보통', '중간', '여유', '적용됨', '개월분', '개월', '확신', '반영', '조치', '해소', '필요', '호텔 신용 카드', '실검증', '지문/참조',
            '낮은 신뢰도 상한 B 기준', '결정적 모의 분석. API 키 없음', 'SCM 대장 업로드', '반환 가능', '금액이 한도 초과', '샘플 다낭 리버사이드', '개 계약 · ', '개 호텔']
GLOSSARY = ['선급금', '플로팅', '보증금', '하드블록 선급', '권장 한도', '원장', '잔액', '호텔 확인 잔액', '충전', '반환', '조정', '기초잔액', '등급', '신뢰도', '미평가', '회수 가능성', '경보', '치명', '높음', '중간',
            '권고 조치', '담당 SCM', '결재', '대표이사', '이관', '계약 법인', '통화', '기준일', '잠정', '샘플', '시뮬레이션', '감사 로그', '열람자', '관리자', '가중치']

LANGS = {'ja': ('JA', '日本語', '일본어', 'ja'), 'vi': ('VI', 'Tiếng Việt', '베트남어', 'vi')}
INTRO = {
 'ja': ['この資料は、OHMYHOTELのホテル前払金リスク管理システム(OMH-NICE 2.0)の日本語画面文言の確認依頼です。',
        '「現在の翻訳」を読み、不自然・不正確な箇所を「修正案」に書いてください。問題なければ「OK」を選んでください。',
        '例文・用語は金融/リスク管理の業務文書として自然な表現にしてください。ボタンや表の見出しは短く保ってください。'],
 'vi': ['Tài liệu này đề nghị rà soát bản dịch tiếng Việt cho giao diện hệ thống quản lý rủi ro tiền ứng trước khách sạn của OHMYHOTEL (OMH-NICE 2.0).',
        'Vui lòng đọc cột "Bản dịch hiện tại" và ghi chỉnh sửa vào cột "Đề xuất sửa". Nếu không có vấn đề, chọn "OK".',
        'Hãy dùng cách diễn đạt tự nhiên của tài liệu nghiệp vụ tài chính/quản trị rủi ro. Nhãn nút và tiêu đề bảng cần ngắn gọn.'],
}
RULES = ['시트 "검수"의 각 행에서 "검수 결과"를 OK / 수정 / 질문 중 하나로 고르세요. 모든 행에 결과가 있어야 합니다.',
         '"수정"이면 "수정안"에 바꾼 번역 전체를 적으세요. "질문"이면 "코멘트"에 무엇이 불명확한지 적으세요.',
         '{0} {1} 같은 자리표시는 값이 들어가는 자리입니다. 지우지 말고 그대로 두되 어순에 맞게 옮겨도 됩니다.',
         '원문 앞뒤의 공백은 의미가 있습니다(숫자 뒤에 붙는 단어 등). 그대로 두세요. 베트남어는 숫자 뒤 공백이 필요하면 앞에 공백을 둘 수 있습니다.',
         'SCM, ELLIS, CSV, OMH, KRW/JPY/VND/USD/SGD, 등급 A·B·C·D·NR, ID는 번역하지 않습니다.',
         '"우선 검토" 표시된 행은 번역가가 뜻이 불확실하다고 알려 온 것이니 먼저 봐 주세요.',
         '화면 이름은 시트 "화면 구분" 열로 확인합니다. English 열은 원문 뜻을 확인하는 참고용입니다.',
         '이 시트에는 가상 샘플 호텔 이름 외에 내부 데이터가 없습니다.']

thin = Side(style='thin', color='CCCCCC'); BORDER = Border(left=thin, right=thin, top=thin, bottom=thin)
HEAD = PatternFill('solid', fgColor='1F4E78'); PRI = PatternFill('solid', fgColor='FFF2CC'); INPUT = PatternFill('solid', fgColor='FFF9E6')

for lg, (code, native, ko_name, _) in LANGS.items():
    pack = read_pack(lg); wb = Workbook()
    ws = wb.active; ws.title = '안내'
    rows = [['OMH-NICE 2.0 번역 검수 — ' + ko_name + ' (' + native + ')'], [''], ['■ 목적'], ['화면에 표시되는 문구 ' + str(len(SRC)) + '개의 ' + ko_name + ' 번역이 업무 용어로 자연스럽고 정확한지 확인합니다.'], [''], ['■ 검수 방법']] + [[str(i + 1) + '. ' + r] for i, r in enumerate(RULES)] + [[''], ['■ ' + native]] + [[x] for x in INTRO[lg]] + [[''], ['■ 회신'], ['검수한 엑셀 파일을 그대로 회신해 주세요. 반영은 개발팀이 `tools/i18n_import_review.py`로 합니다.'], ['번역은 기계 번역 수준의 초안이며, 최종 책임은 현지 담당자의 확인에 있습니다.']]
    for r in rows: ws.append(r)
    ws.column_dimensions['A'].width = 120; ws['A1'].font = Font(bold=True, size=14, color='1F4E78')
    for r in ws.iter_rows():
        for c in r:
            c.alignment = Alignment(wrap_text=True, vertical='top')
            if isinstance(c.value, str) and c.value.startswith('■'): c.font = Font(bold=True, color='1F4E78')
    # glossary
    gs = wb.create_sheet('용어집'); gs.append(['한국어', 'English', '현재 번역(' + native + ')', '수정안(필요 시)'])
    for k in GLOSSARY:
        if k in SRC and k in pack: gs.append([k, SRC[k]['en'], pack[k], ''])
    for c in gs[1]: c.font = Font(bold=True, color='FFFFFF'); c.fill = HEAD
    for col, w in zip('ABCD', (24, 30, 34, 34)): gs.column_dimensions[col].width = w
    gs.freeze_panes = 'A2'
    # review sheet
    rs = wb.create_sheet('검수')
    head = ['No', '화면 구분', '우선 검토', '한국어 원문', 'English', '현재 번역(' + native + ')', '검수 결과', '수정안', '코멘트']
    rs.append(head)
    keys = sorted(SRC.keys(), key=lambda k: (0 if k in PRIORITY else 1, AREA.get(WHERE.get(k), 'z'), k))
    for i, k in enumerate(keys, 1):
        rs.append([i, AREA.get(WHERE.get(k), WHERE.get(k, '')), '★' if k in PRIORITY else '', k, SRC[k]['en'] + ('  / ' + ' / '.join(SRC[k].get('alts', [])) if SRC[k].get('alts') else ''), pack.get(k, ''), '', '', ''])
    for c in rs[1]: c.font = Font(bold=True, color='FFFFFF'); c.fill = HEAD; c.alignment = Alignment(wrap_text=True, vertical='center')
    for col, w in zip('ABCDEFGHI', (6, 24, 8, 42, 42, 46, 12, 46, 36)): rs.column_dimensions[col].width = w
    for row in rs.iter_rows(min_row=2):
        pri = row[2].value == '★'
        for c in row:
            c.alignment = Alignment(wrap_text=True, vertical='top'); c.border = BORDER
            if pri and c.column <= 3: c.fill = PRI
            if c.column in (7, 8, 9): c.fill = INPUT
    dv = DataValidation(type='list', formula1='"OK,수정,질문"', allow_blank=True); rs.add_data_validation(dv); dv.add('G2:G' + str(rs.max_row))
    rs.freeze_panes = 'E2'; rs.auto_filter.ref = 'A1:I' + str(rs.max_row)
    rs.sheet_properties.tabColor = 'FFC000'
    wb.save(os.path.join(OUT, 'OMH-NICE_Translation_Review_' + code + '.xlsx'))
    print(code, len(keys), 'rows,', sum(1 for k in keys if k in PRIORITY), 'priority')
