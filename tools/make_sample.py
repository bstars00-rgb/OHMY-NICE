#!/usr/bin/env python3
"""가상 샘플 엑셀을 만든다(실제 양식과 같은 시트·열·수식·선택지). 호텔 이름·금액은 모두 지어낸 값이다.

사용법: python tools/make_sample.py [--out sample/SG지급_자료수집_샘플.xlsx]
같은 난수 씨앗으로 만들므로 매번 같은 파일이 나온다. 의도한 결함(통화 불일치, 큰 잔액 차이, 음수 잔액 등)이 몇 건 들어 있어 점검 화면을 보여 줄 수 있다.
"""
import argparse, datetime as dt, os, random
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.worksheet.datavalidation import DataValidation

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BLUE, ORANGE, GRAY = 'DCE6F1', 'FCE4D6', 'E7E6E6'

PAY_HEAD = ['나라', 'ELLIS\n거래처코드', '호텔명\n(ELLIS 등록 영문)', '지급 구분', '현재 지급 법인', '현재 지급 방식', '지급 통화', '최근 3개월\n월평균 지급액\n(지급 통화)', 'A1 카드\n수용 여부', 'A2 수취 계좌\n(법인 계좌 여부)', '분류 (자동)', '비고', '작성 담당', '작성일']
PAY_FILL = [GRAY] * 8 + [ORANGE, ORANGE, GRAY, ORANGE, ORANGE, ORANGE]
PRE_HEAD = ['법인', '나라', '호텔명\n(ELLIS 등록 영문)', 'ELLIS\n호텔코드', '프리바이 종류', '통화', '대장 상 잔액\n(통화 그대로)', '호텔 확인 잔액\n(SCM, 호텔에 확인)', '기준일\n(대장 기준)', '잔액 차이\n(대장−호텔)', '최근 3개월\n월평균 소진액', '소진 예상\n개월', '12/31까지\n소진 가능', '이관 가능\n(3자 합의)', '이관 조건·호텔 의견', '반환 가능', '반환 조건\n(기간·절차)', '참고 분류 (자동)', '비고', '작성 담당', '12/31 예상 잔액\n(참고 · 자동)']
PRE_FILL = [BLUE] * 7 + [ORANGE] + [BLUE] + [GRAY] + [BLUE] + [GRAY, GRAY] + [ORANGE] * 4 + [GRAY, ORANGE, ORANGE, GRAY]

WORDS_A = ['Harbor', 'Maple', 'Coral', 'Silver', 'Lotus', 'Cedar', 'Amber', 'Willow', 'Jade', 'Summit', 'Pearl', 'Aurora', 'Bamboo', 'Granite', 'Meadow', 'Orchid']
WORDS_B = ['Resort', 'Hotel', 'Suites', 'Inn', 'Residence', 'Villa', 'Lodge', 'Grand Hotel']
SCM_NAMES = {'KR': 'SCM-KR-A', 'VN': 'SCM-VN-B', 'TH': 'SCM-TH-C', 'HK': 'SCM-HK-D', 'TW': 'SCM-TW-D', 'MY': 'SCM-MY-E', 'MO': 'SCM-HK-D', 'JP': 'SCM-JP-F'}


def hotel_names(rng, n, prefix):
    seen, out = set(), []
    while len(out) < n:
        nm = 'Sample %s %s' % (rng.choice(WORDS_A), rng.choice(WORDS_B))
        if nm in seen:
            nm += ' %s' % prefix
        if nm in seen:
            continue
        seen.add(nm); out.append(nm)
    return out


def style_header(ws, row, fills):
    for i, f in enumerate(fills, start=1):
        c = ws.cell(row=row, column=i)
        c.fill = PatternFill('solid', fgColor=f); c.font = Font(bold=True); c.alignment = Alignment(wrap_text=True, vertical='center')
    ws.row_dimensions[row].height = 48


def make_guide(wb):
    ws = wb.active; ws.title = '작성안내'
    rows = [
        ('SG 직접 지급 — 자료 수집 양식 (재무 · SCM) [가상 샘플]',),
        ('회수 목표: 재무 11/16(월) 오전 · SCM 11/17(화) 오전',),
        ('목적', '12월 SG 직접 지급 테스트 대상 선정과 프리바이(선급) 호텔별 처리(11/20 결재)에 쓸 기초 자료입니다. 이 파일은 대시보드 시연용 가상 자료입니다.'),
        ('시트 구성', '①지급목록: 후불 지급 호텔의 카드 수용 여부, 법인 계좌 등록 여부 / ②프리바이목록: 선급 호텔의 대장 잔액·소진액(재무)과 호텔 확인 잔액, 이관·반환 가능 여부(SCM)'),
        ('색 구분', '파란 머리글 = 재무가 입력 / 주황 머리글 = SCM이 입력 / 회색 머리글 = 미리 채워지거나 자동 계산'),
        ('분류 용어', 'A1 = 후불·카드 수용 / A2 = 후불·카드 미수용(법인 계좌) / B1 = 선불 이관 가능 / B2 = 선불 이관 불가(12/31까지 소진, 소진 불가 시 반환)'),
        ('작성 원칙', '수취 계좌 번호는 적지 않습니다. 확실하지 않으면 미확인으로 두고 비고에 이유를 남깁니다. 금액은 통화 그대로 입력합니다(환산 금지).'),
        ('기준일·소진 계산', '12/31 소진 가능 = 기준일부터 12/31까지 남은 개월(일수 ÷ 30) 동안의 예상 소진액이 잔액 이상인지로 판정합니다. 최종 처리는 11/20 대표 결재에서 정합니다.'),
    ]
    for r, vals in enumerate(rows, start=1):
        for c, v in enumerate(vals, start=2 if len(vals) > 1 else 2):
            ws.cell(row=r, column=c, value=v).alignment = Alignment(wrap_text=True, vertical='top')
    ws.column_dimensions['B'].width = 20; ws.column_dimensions['C'].width = 110


def add_validation(ws, rng, items):
    dv = DataValidation(type='list', formula1='"%s"' % ','.join(items), allow_blank=True); ws.add_data_validation(dv); dv.add(rng)


def make_pay(wb, rng, today):
    ws = wb.create_sheet('①지급목록')
    ws['A1'] = '① 후불 지급 목록 (가상 샘플 · 지급 실적 기준)'; ws['A1'].font = Font(bold=True, size=13)
    ws['A2'] = '회색 열: 미리 채워진 가상 지급 실적 · 주황 열: 나라별 SCM 작성 · 월평균 = 8~10월 합계 ÷ 3'
    for c, h in enumerate(PAY_HEAD, start=1):
        ws.cell(row=4, column=c, value=h)
    style_header(ws, 4, PAY_FILL)
    plan = [('VN', 'VND', 'VN 법인 (Citi VN VCC)', 'VCC', 60, (30e6, 650e6)), ('KR', 'KRW', 'KR 법인 (Citi KR VCC)', 'VCC', 16, (2e6, 180e6)), ('KR', 'KRW', 'KR 법인 (Hana KR 선불 VCC)', 'VCC', 12, (1e6, 90e6)),
            ('TH', 'THB', 'KR 법인 (Citi KR VCC)', 'VCC', 14, (80e3, 2.4e6)), ('HK', 'HKD', 'KR 법인 (Citi KR VCC)', 'VCC', 5, (40e3, 520e3)), ('TW', 'TWD', 'KR 법인 (Citi KR VCC)', 'VCC', 4, (120e3, 1.6e6)),
            ('MY', 'MYR', 'KR 법인 (Citi KR VCC)', 'VCC', 3, (15e3, 160e3)), ('MO', 'MOP', 'KR 법인 (Citi KR VCC)', 'VCC', 2, (30e3, 240e3))]
    fill_rate = {'KR': 0.85, 'VN': 0.35, 'TH': 0.6, 'HK': 1.0, 'TW': 0.5, 'MY': 0.0, 'MO': 0.0}
    r = 5; code = 10100
    for country, ccy, entity, method, n, (lo, hi) in plan:
        for nm in hotel_names(rng, n, country):
            code += rng.randint(3, 40)
            avg = int(rng.uniform(lo, hi))
            ws.append([country, 'S%05d' % code, nm, '후불', entity, method, ccy, avg, None, None, None, '[참고] 현재 VCC 결제 중 · 가상 지급 실적 %d건' % rng.randint(8, 420), None, None])
            if rng.random() < fill_rate[country]:
                roll = rng.random()
                if roll < 0.55:
                    ws.cell(row=r, column=9, value='O')
                elif roll < 0.85:
                    ws.cell(row=r, column=9, value='X'); ws.cell(row=r, column=10, value=rng.choice(['법인 계좌 등록', '법인 계좌 등록', '미등록', '미확인']))
                elif roll < 0.9:
                    ws.cell(row=r, column=9, value='X'); ws.cell(row=r, column=10, value=rng.choice(['개인 계좌', '현금 수령']))
                elif roll < 0.95:
                    ws.cell(row=r, column=9, value='X')            # 카드 미수용인데 계좌 칸이 빔
                else:
                    ws.cell(row=r, column=9, value='미확인')
                ws.cell(row=r, column=13, value=SCM_NAMES[country]); ws.cell(row=r, column=14, value=today.isoformat())
            r += 1
    # 의도한 결함: 나라와 통화 불일치, 중복 줄, 선불 구분 한 줄
    ws.cell(row=7, column=7, value='USD')
    dup = [ws.cell(row=9, column=c).value for c in range(1, 15)]; ws.append(dup); r += 1
    ws.cell(row=10, column=4, value='선불')
    for rr in range(5, r):
        ws.cell(row=rr, column=11, value='=IF(C%d="","",IF(D%d="선불","→ ②프리바이목록에 입력",IF(I%d="O","A1 카드",IF(I%d="X",IF(J%d="법인 계좌 등록","A2 송금","예외 목록 검토"),"확인 필요"))))' % ((rr,) * 5))
        ws.cell(row=rr, column=8).number_format = '#,##0'
    add_validation(ws, 'A5:A%d' % (r + 50), ['KR', 'JP', 'VN', 'TH', 'SG', 'TW', 'HK', 'MY', 'MO', '기타']); add_validation(ws, 'D5:D%d' % (r + 50), ['후불', '선불'])
    add_validation(ws, 'F5:F%d' % (r + 50), ['현금 송금', 'VCC', '신용카드', '기타']); add_validation(ws, 'I5:I%d' % (r + 50), ['O', 'X', '미확인'])
    add_validation(ws, 'J5:J%d' % (r + 50), ['법인 계좌 등록', '미등록', '개인 계좌', '현금 수령', '미확인'])
    for col, w in zip('ABCDEFGHIJKLMN', [7, 11, 34, 10, 28, 12, 9, 15, 11, 17, 20, 60, 12, 11]):
        ws.column_dimensions[col].width = w
    ws.freeze_panes = 'D5'


def make_pre(wb, rng):
    ws = wb.create_sheet('②프리바이목록')
    ws['A1'] = '② 프리바이(선급) 목록 — Floating · 買取 · 하드블럭 선급 · 보증금 (가상 샘플)'; ws['A1'].font = Font(bold=True, size=13)
    ws['A2'] = '출처: 가상 샘플. 기준일 KR 11/2 · JP 9/30 · VN 10월말. 모든 호텔·금액은 지어낸 값입니다.'
    ws['A3'] = 'SG 전환 관련 기준: VN Deposit 잔액은 2027 이월 불가 → 연말 잔액이 남지 않게 충전 축소·잔액 반환 요청.'
    for c, h in enumerate(PRE_HEAD, start=1):
        ws.cell(row=4, column=c, value=h)
    style_header(ws, 4, PRE_FILL)
    # (법인, 나라, 종류, 통화, 잔액 범위, 월평균 배수 범위(잔액 ÷ 소진 개월), 기준일)
    spec = [('KR', 'KR', 'Floating', 'KRW', (8e6, 40e6), (0.5, 30), '2026-11-02')] * 4 + \
           [('JP', 'JP', 'Floating', 'JPY', (2e6, 20e6), (0.5, 12), '2026-09-30')] * 5 + [('JP', 'JP', 'Deposit', 'JPY', (3e6, 12e6), (0, 0), '2026-09-30')] * 2 + [('JP', 'JP', '買取', 'JPY', (3e6, 9e6), (1, 3), '2026-09-30')] * 2 + [('JP', 'JP', '하드블럭 선급', 'JPY', (1e6, 6e6), (0.5, 2), '2026-09-30')] + \
           [('VN', 'VN', 'Floating', 'VND', (200e6, 1500e6), (0.5, 9), '2026-10-31')] * 4 + [('VN', 'VN', 'Deposit', 'VND', (300e6, 900e6), (0, 0), '2026-10-31')] * 3 + [('VN', 'VN', 'Commit', 'VND', (400e6, 1200e6), (1, 5), '2026-10-31')] * 3
    names = hotel_names(rng, len(spec), 'P')
    r = 5; code = 20000
    for (ent, ctry, typ, ccy, (b_lo, b_hi), (m_lo, m_hi), asof), nm in zip(spec, names):
        code += rng.randint(2, 60)
        ledger = int(rng.uniform(b_lo, b_hi)); months = rng.uniform(m_lo, m_hi) if m_hi else 0
        avg = int(ledger / months) if months >= 0.5 else 0
        note = None
        hotel_bal = None
        if rng.random() < 0.6:
            hotel_bal = ledger if rng.random() < 0.5 else int(ledger * rng.uniform(0.9, 1.05))
        transfer = refund = t_note = r_note = None
        if rng.random() < 0.55:
            transfer = rng.choice(['O', 'X', 'X', '미확인'])
            if transfer == 'O':
                t_note = '3자 합의 가능 · 11/25까지 회신 (가상)'
            if transfer in ('X', '미확인') and rng.random() < 0.8:
                refund = rng.choice(['O', 'X', 'O'])
                if refund == 'O':
                    r_note = '12/20까지 반환 가능 (가상)' if rng.random() < 0.7 else None
        ws.append([ent, ctry, nm, ('S%05d' % code) if rng.random() < 0.5 else None, typ, ccy, ledger, hotel_bal, dt.date.fromisoformat(asof), None, avg, None, None, transfer, t_note, refund, r_note, None, note, SCM_NAMES[ctry] if transfer else None, None])
        r += 1
    # 공개용 처음 자료(tools/make_seed_public.py)와 같은 호텔로 맞춘다: 같은 ELLIS 호텔코드면 대표님 현황판 신호가 함께 보인다
    for row, code, name in [(5, 'S10001', 'Sample Maple Resort'), (6, 'S10002', 'Sample Harbor Inn'), (7, 'S10003', 'Sample Coral Suites'), (8, 'S10004', 'Sample Willow Villa'), (9, 'S20001', 'Sample Cedar Hotel Tokyo'), (10, 'S20002', 'Sample Amber Hotel Osaka'), (11, 'S20003', 'Sample Jade Resort Okinawa'), (12, 'S20004', 'Sample Pearl Hotel Sapporo'), (19, 'S30001', 'Sample Lotus Resort Da Nang'), (20, 'S30002', 'Sample Bamboo Hotel Hanoi'), (21, 'S30003', 'Sample Orchid Resort Nha Trang')]:
        ws.cell(row=row, column=4, value=code); ws.cell(row=row, column=3, value=name)
    # 분류가 골고루 보이도록 몇 줄을 맞춘다: (행, 잔액÷월평균 소진, 이관, 반환)
    for row, div, tr, rf in [(8, 1.2, 'X', 'O'), (12, 1.0, 'X', 'X'), (13, 20, 'X', 'X'), (20, 15, 'X', '미확인'), (21, 1.5, 'X', None), (22, 6, 'X', 'O'), (23, None, 'X', 'O'), (24, None, 'O', None)]:
        led = ws.cell(row=row, column=7).value
        ws.cell(row=row, column=11, value=int(led / div) if div else 0)
        ws.cell(row=row, column=14, value=tr); ws.cell(row=row, column=16, value=rf); ws.cell(row=row, column=20, value=SCM_NAMES[ws.cell(row=row, column=2).value])
        if ws.cell(row=row, column=8).value is None:
            ws.cell(row=row, column=8, value=led)
        if tr == 'O':
            ws.cell(row=row, column=15, value='3자 합의 가능 (가상)')
        if rf == 'O':
            ws.cell(row=row, column=17, value='12/20까지 반환 가능 (가상)')
    # 의도한 결함
    ws.cell(row=6, column=8, value=int(ws.cell(row=6, column=7).value * 0.82))            # 호텔 확인 잔액이 크게 다름
    ws.cell(row=7, column=19, value='월평균 소진이 있었으나 운영 중단(11/3)으로 0 처리 · 가압류 검토 중'); ws.cell(row=7, column=11, value=0)
    ws.cell(row=9, column=7, value=-250000)                                              # 음수 잔액
    ws.cell(row=10, column=9, value=dt.date(2026, 8, 31))                                # 오래된 기준일
    ws.cell(row=11, column=6, value='VND')                                               # 법인과 통화 불일치(JP 법인에 VND)
    for rr in range(5, r):
        ws.cell(row=rr, column=10, value='=IF(OR(G%d="",H%d=""),"",G%d-H%d)' % ((rr,) * 4))
        ws.cell(row=rr, column=12, value='=IF(OR(G%d="",K%d="",K%d=0),"",ROUND(G%d/K%d,1))' % ((rr,) * 5))
        ws.cell(row=rr, column=13, value='=IF(OR(G%d="",K%d="",I%d=""),"",IF(G%d<=K%d*MAX(0,DATE(2026,12,31)-I%d)/30,"가능","불가"))' % ((rr,) * 6))
        ws.cell(row=rr, column=18, value='=IF(C%d="","",IF(OR(N%d="",N%d="미확인"),"확인 필요",IF(N%d="O","B1 이관",IF(M%d="가능","B2 소진",IF(M%d="불가",IF(P%d="O","B2 반환","B2 협의 필요"),"확인 필요")))))' % ((rr,) * 7))
        ws.cell(row=rr, column=21, value='=IF(OR(G%d="",K%d="",I%d=""),"",MAX(0,G%d-K%d*MAX(0,DATE(2026,12,31)-I%d)/30))' % ((rr,) * 6))
        for col in (7, 8, 10, 11, 21):
            ws.cell(row=rr, column=col).number_format = '#,##0'
        ws.cell(row=rr, column=9).number_format = 'yyyy-mm-dd'
    add_validation(ws, 'A5:B%d' % (r + 50), ['KR', 'JP', 'VN', 'TH', 'SG', '기타']); add_validation(ws, 'E5:E%d' % (r + 50), ['Floating', 'Deposit', 'Commit', '買取', '하드블럭 선급', '보증금', '기타'])
    add_validation(ws, 'F5:F%d' % (r + 50), ['KRW', 'JPY', 'VND', 'USD', 'SGD', 'THB', '기타']); add_validation(ws, 'N5:N%d' % (r + 50), ['O', 'X', '미확인']); add_validation(ws, 'P5:P%d' % (r + 50), ['O', 'X', '미확인'])
    for col, w in zip('ABCDEFGHIJKLMNOPQRSTU', [8, 7, 32, 11, 14, 8, 15, 15, 11, 14, 15, 10, 11, 12, 28, 10, 26, 18, 32, 12, 16]):
        ws.column_dimensions[col].width = w
    ws.freeze_panes = 'R5'


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--out', default=os.path.join(ROOT, 'sample', 'SG지급_자료수집_샘플.xlsx')); a = ap.parse_args()
    rng = random.Random(20261116)
    wb = Workbook(); make_guide(wb); make_pay(wb, rng, dt.date(2026, 11, 16)); make_pre(wb, rng)
    os.makedirs(os.path.dirname(a.out), exist_ok=True); wb.save(a.out); print('가상 샘플을 만들었습니다:', a.out)
    # 엑셀에서 "CSV UTF-8로 저장"한 것과 같은 모양의 CSV(수식 열은 비워 둔다): 화면의 파일 올리기를 시험하고 시연하는 데 쓴다
    import csv
    base = os.path.splitext(a.out)[0]
    for name, tag in (('①지급목록', '_1지급목록'), ('②프리바이목록', '_2프리바이목록')):
        ws = wb[name]
        with open(base + tag + '.csv', 'w', encoding='utf-8-sig', newline='') as f:
            w = csv.writer(f)
            for row in ws.iter_rows(values_only=True):
                w.writerow(['' if v is None or (isinstance(v, str) and v.startswith('=')) else (v.date().isoformat() if hasattr(v, 'date') and not isinstance(v, str) else v) for v in row])
    print('CSV도 만들었습니다:', base + '_1지급목록.csv', base + '_2프리바이목록.csv')


if __name__ == '__main__':
    main()
