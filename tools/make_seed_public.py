#!/usr/bin/env python3
"""공개용 가상 처음 자료(SEED)를 만든다. 대표님 대시보드의 자료 모양(hotels, deposits, usage, pending, perf, gledger)과 같고,
호텔 이름·금액은 모두 지어낸 값이다.

현황판 호텔 50곳(KR 14 · JP 12 · VN 14 · TH 6 · SG 4)에는 각각 '페르소나'(운영 형태와 소진·잔액·위험 신호의 성격)가 있다.
페르소나는 호텔 메모(memo)에 적히고, 같은 내용이 sample/hotel_personas.md 표로도 나온다. 보증금 호텔 4곳은 보증금 탭용으로 따로 둔다.

사용법: python tools/make_seed_public.py [--out sample/seed_public.json] [--personas sample/hotel_personas.md]
화면이 '오늘'(2026-11-17)을 기준으로 계산하므로 소진 이력은 2026-01 ~ 2026-10(지난달까지)과 이번 달 초(11월 1~15일) 소진으로 만든다.
같은 난수 씨앗으로 만들므로 매번 같은 자료가 나온다."""
import argparse, datetime as dt, json, os, random

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOTEL_KEYS = ['corp', 'code', 'name', 'type', 'cur', 'start', 'end', 'rooms', 'op', 'sameBld', 'bizNo', 'scm', 'grade', 'prevGrade', 'limit', 'topup', 'guarantee', 'planMonthly', 'hotelBal', 'hotelBalDate', 'flags', 'status', 'topupMin', 'refundTerms', 'refundable', 'disputes', 'memo']
MONTHS = ['2026-%02d' % m for m in range(1, 11)]
UNIT = {'KRW': 10_000, 'JPY': 1_000, 'VND': 1_000_000, 'THB': 1_000, 'SGD': 100}
TODAY = dt.date(2026, 11, 17)
COLOR_KO = {'ok': '초록', 'warn': '노랑', 'bad': '빨강', 'na': '자료 대기', 'off': '신호 없음'}


def hotel(**kw):
    h = {k: '' for k in HOTEL_KEYS}; h.update(kw); h['status'] = h['status'] or '운영'
    return h


def rnd(v, cur):
    u = UNIT[cur]; return int(round(v / u)) * u


def add_year(s):
    d = dt.date.fromisoformat(s); return (dt.date(d.year + 1, d.month, d.day) - dt.timedelta(days=1)).isoformat()


def shape_factors(shape, n):
    f = [1.0] * n
    if shape == 'ramp':
        for i, v in enumerate([0.5, 0.8]):
            if i < n: f[i] = v
    elif shape == 'drop60': f[-1] = 0.6
    elif shape == 'drop40': f[-1] = 0.4
    elif shape == 'idle1': f[-1] = 0.0
    elif shape == 'idle2': f[-2:] = [0.0, 0.0]
    elif shape == 'none': f = [0.0] * n
    return f


def build_seed():
    rng = random.Random(20261117)
    hotels, deposits, usage, perf, gledger, personas = [], [], [], [], [], []

    def mk(corp, code, name, cur, start, monthly, scm, title, memo, color, typ='Floating', cover=1.3, shape='flat', nov=True, hb='match', plan=None, limit=0.6,
           flags='', status='운영', grade='B', prev='', op='소유 운영', rooms='', topups=(), end=None, stop_ym=None, ye=None, refundable='', disputes='', sales_x=1.12, nodata=False):
        h = dict(corp=corp, code=code, name=name, type=typ, cur=cur, start=start, end=end or add_year(start), scm=scm, grade=grade, prevGrade=prev, flags=flags, status=status, rooms=rooms, op=op, memo='샘플 · ' + memo)
        personas.append({'code': code, 'name': name, 'corp': corp, 'type': typ, 'title': title, 'memo': memo, 'color': color})
        if nodata:
            hotels.append(hotel(**h)); return
        sm = start[:7]; ms = [m for m in MONTHS if m >= sm and (not stop_ym or m < stop_ym)]
        fac = shape_factors(shape, len(ms)); amts = []
        for m, f in zip(ms, fac):
            a = rnd(monthly * f * (rng.uniform(0.96, 1.04) if f else 0), cur); amts.append(a)
            usage.append({'code': code, 'ym': m, 'amt': a, 'onbook': 0, 'corp': corp, 'cur': cur})
        if nov and shape != 'none' and not stop_ym:
            a = rnd(monthly * rng.uniform(0.4, 0.5), cur); amts.append(a)
            usage.append({'code': code, 'ym': '2026-11', 'amt': a, 'onbook': 0, 'corp': corp, 'cur': cur})
        for m, a in zip(ms, amts):
            if a and sales_x:
                s = int(a * sales_x); perf.append({'code': code, 'ym': m, 'sales': s, 'margin': s - a})
        used = sum(amts)
        series = [a for m, a in zip(ms, amts) if m <= '2026-10']
        avg3 = sum(series[-3:]) / len(series[-3:]) if series else 0
        dep_total = used + (cover * avg3 if avg3 else monthly * 3)
        dep_total = rnd(dep_total, cur) if cover else used
        tups = [(d, rnd(dep_total * fr, cur)) for d, fr in topups]
        first = dep_total - sum(a for _, a in tups)
        deposits.append({'corp': corp, 'code': code, 'date': start, 'kind': '신규', 'amt': first, 'cur': cur})
        for d, a in tups:
            deposits.append({'corp': corp, 'code': code, 'date': d, 'kind': '충전', 'amt': a, 'cur': cur})
        bal = dep_total - used
        if hb == 'match': h['hotelBal'], h['hotelBalDate'] = bal, '2026-11-15'
        elif hb == 'diff': h['hotelBal'], h['hotelBalDate'] = rnd(bal * 0.9, cur), '2026-11-10'
        elif hb == 'diff_old': h['hotelBal'], h['hotelBalDate'] = rnd(bal * 0.85, cur), '2026-09-30'
        elif hb == 'stale': h['hotelBal'], h['hotelBalDate'] = bal, '2026-09-22'
        if limit and bal > 0: h['limit'] = rnd(bal / limit, cur)
        if plan and used:
            months_el = (dt.date(2026, 10, 31) - dt.date.fromisoformat(start)).days / 30.4
            h['planMonthly'] = rnd(used / (plan * months_el), cur)
        if refundable: h['refundable'] = refundable
        if disputes: h['disputes'] = disputes
        hh = hotel(**h)
        if ye: hh['ye'] = ye(bal)
        hotels.append(hh)

    # ---------- KR (원) 14곳 ----------
    mk('KR', 'S10001', 'Sample Maple Resort Jeju', 'KRW', '2026-02-01', 9_000_000, 'SCM-KR-A', '연중 안정 소진형', '120실 리조트. 소진이 달마다 비슷하고 잔액 확인서가 제때 온다.', 'ok', cover=0.95, grade='B', rooms='120', plan=1.0, topups=[('2026-06-10', 0.3)], refundable='반환 가능')
    mk('KR', 'S10002', 'Sample Harbor Inn Busan', 'KRW', '2026-03-01', 3_000_000, 'SCM-KR-A', '임차·선급 요청형', '임차 운영 호텔이 먼저 선급을 요청했다. 소진은 보통이고 잔액은 넉넉하다.', 'warn', cover=3.0, flags='G1 G4', grade='C', op='임차 운영', rooms='60', hb='diff')
    mk('KR', 'S10003', 'Sample Coral Suites Seoul', 'KRW', '2026-05-01', 5_500_000, 'SCM-KR-B', '도심 비즈니스 안정형', '도심 80실. 평일 수요가 꾸준해 잔액이 빨리 돌고 확인서도 정시 회신.', 'ok', grade='A', rooms='80', cover=0.9, plan=1.05, topups=[('2026-08-20', 0.25)])
    mk('KR', 'S10004', 'Sample Willow Villa Gapyeong', 'KRW', '2026-04-01', 2_000_000, 'SCM-KR-B', '운영 중단형', '펜션형 30실. 11월 초 운영을 멈췄고 연락이 닿지 않는다.', 'bad', cover=2.0, shape='idle2', nov=False, flags='C3', status='운영 중단', grade='D', rooms='30', hb='diff_old', refundable='협의 필요')
    mk('KR', 'S10005', 'Sample Pine Hotel Gangneung', 'KRW', '2026-02-15', 6_500_000, 'SCM-KR-A', '소진 급감형', '바다 전망 호텔. 10월 소진이 직전 석 달 평균의 40%로 줄었다.', 'bad', cover=1.5, shape='drop40', grade='B', rooms='95', nov=False)
    mk('KR', 'S10006', 'Sample Lantern Hotel Jeonju', 'KRW', '2026-03-10', 4_000_000, 'SCM-KR-B', '계획 대비 미달형', '한옥마을 인근. 계약 때 잡은 월 소진 계획의 65% 수준에 머문다.', 'warn', plan=0.65, cover=1.6, grade='B', rooms='45')
    mk('KR', 'S10007', 'Sample Cherry Stay Seoul', 'KRW', '2026-08-01', 5_000_000, 'SCM-KR-A', '신규 직접 거래형', '직접 거래를 시작한 지 3개월이 안 됐다. 소진은 정상이다.', 'warn', shape='ramp', cover=1.4, flags='G3', grade='B', rooms='70')
    mk('KR', 'S10008', 'Sample Granite Tower Seoul', 'KRW', '2026-01-20', 14_000_000, 'SCM-KR-A', '한도 초과형', '대형 도심 호텔. 잔액이 승인 한도의 1.8배까지 쌓였다.', 'bad', cover=1.9, limit=1.8, grade='B', rooms='260', plan=1.0, topups=[('2026-04-15', 0.2), ('2026-08-05', 0.2)])
    mk('KR', 'S10009', 'Sample Birch Resort Pyeongchang', 'KRW', '2026-02-01', 7_500_000, 'SCM-KR-B', '잔액 확인 지연형', '스키 리조트. 호텔이 보낸 잔액 확인서가 두 달 넘게 오지 않고 금액도 다르다.', 'bad', cover=1.5, hb='diff_old', flags='G8', grade='C', rooms='140')
    mk('KR', 'S10010', 'Sample River Hotel Daegu', 'KRW', '2026-04-01', 3_800_000, 'SCM-KR-B', '지방 도시 안정형', '지방 도시 비즈니스 호텔. 소진과 확인서 모두 규칙적이다.', 'ok', cover=0.9, grade='B', rooms='88', plan=1.0)
    mk('KR', 'S10011', 'Sample Sunrise Condo Yeosu', 'KRW', '2026-05-01', 4_200_000, 'SCM-KR-A', '분양형 위탁 운영형', '분양형 객실을 위탁 운영한다. 소진은 보통이고 운영 주체가 겹쳐 있다.', 'warn', cover=1.8, flags='G1', op='분양형', grade='B', rooms='110')
    mk('KR', 'S10012', 'Sample Plum Hotel Incheon', 'KRW', '2026-03-01', 5_200_000, 'SCM-KR-A', '등급 하락형', '공항 인근. 지난 분기 A등급이었다가 이번 심사에서 C등급으로 내려갔다.', 'bad', cover=1.6, grade='C', prev='A', rooms='150')
    mk('KR', 'S10013', 'Sample Stone Hanok Andong', 'KRW', '2026-10-15', 0, 'SCM-KR-B', '자료 대기형', '계약만 맺은 한옥 숙소. 입금과 소진 자료가 아직 올라오지 않았다.', 'na', nodata=True, rooms='20')
    mk('KR', 'S10014', 'Sample Harvest Hotel Suwon', 'KRW', '2026-01-15', 3_200_000, 'SCM-KR-B', '정산 완료 종료형', '6월에 계약이 끝났고 남은 잔액 없이 정산을 마쳤다.', 'off', cover=0, stop_ym='2026-07', status='종료', hb='', limit=0, rooms='55')
    # ---------- JP (엔) 12곳 ----------
    mk('JP', 'S20001', 'Sample Cedar Hotel Tokyo', 'JPY', '2026-01-10', 1_100_000, 'SCM-JP-F', '도심 체인 안정형', '도쿄 체인 호텔. 하드블럭과 선급이 같이 돌고 소진이 안정적이다.', 'ok', cover=0.9, grade='A', plan=1.0, topups=[('2026-05-12', 0.3)], refundable='반환 가능')
    mk('JP', 'S20002', 'Sample Amber Hotel Osaka', 'JPY', '2026-02-01', 400_000, 'SCM-JP-F', '타사 선급 집중형', '다른 OTA 선급이 몰려 있고 우리 소진은 계획보다 느리다.', 'warn', cover=3.2, flags='G6', grade='B')
    mk('JP', 'S20003', 'Sample Jade Resort Okinawa', 'JPY', '2026-03-01', 750_000, 'SCM-JP-G', '연말 완소진 계획형', 'SCM이 연말까지 잔액을 다 쓰는 계획을 제출했다. 소진은 계획대로다.', 'ok', cover=1.2, grade='B', plan=1.0, topups=[('2026-07-01', 0.25)], ye=lambda b: {'asOf': '2026-11-10', 'bal': b, 'onbook': int(b * 0.6), 'pickup': b - int(b * 0.6), 'exp': 0, 'by': 'SCM-JP-G'})
    mk('JP', 'S20004', 'Sample Pearl Hotel Sapporo', 'JPY', '2026-09-01', 500_000, 'SCM-JP-G', '선급 후 무소진형', '직접 거래를 막 시작했고 입금 뒤 한 번도 소진되지 않았다.', 'bad', shape='none', flags='G3', grade='C', hb='none')
    mk('JP', 'S20005', 'Sample Sakura Ryokan Kyoto', 'JPY', '2026-02-01', 350_000, 'SCM-JP-F', '소규모 료칸·장부 혼선형', '12실 료칸. 9월 이후 소진이 없고 장부 입력이 자주 틀린다.', 'bad', cover=2.5, shape='idle2', nov=False, grade='C', rooms='12', hb='diff_old')
    mk('JP', 'S20006', 'Sample Harbor View Yokohama', 'JPY', '2026-03-15', 900_000, 'SCM-JP-F', '항구 도시 안정형', '관광과 출장 수요가 섞여 소진이 일정하다.', 'ok', cover=0.95, grade='B', plan=1.0)
    mk('JP', 'S20007', 'Sample Cypress Hotel Nagoya', 'JPY', '2026-04-01', 420_000, 'SCM-JP-G', '잔액 과다·확인서 지연형', '잔액이 소진 속도보다 많이 쌓였고 확인서는 두 달 가까이 지났다.', 'warn', cover=3.4, hb='stale', grade='B', ye=lambda b: {'asOf': '2026-11-10', 'bal': b, 'onbook': int(b * 0.3), 'pickup': int(b * 0.2), 'exp': int(b - b * 0.3 - b * 0.2), 'by': 'SCM-JP-G'})
    mk('JP', 'S20008', 'Sample Onsen Resort Hakone', 'JPY', '2026-02-01', 800_000, 'SCM-JP-G', '가압류 사고형', '온천 리조트. 채권자의 가압류가 들어왔다는 연락을 받았다.', 'bad', cover=1.8, flags='C2', grade='C', disputes='반환 요청 2회 지연')
    mk('JP', 'S20009', 'Sample Fuji Lodge Kawaguchiko', 'JPY', '2026-05-01', 600_000, 'SCM-JP-G', '신규 선급 순항형', '반년 전 선급을 시작했고 소진이 계획을 웃돈다.', 'ok', cover=0.95, grade='B', plan=1.15, rooms='40')
    mk('JP', 'S20010', 'Sample Kobe Bay Hotel', 'JPY', '2026-01-01', 0, 'SCM-JP-F', '買取(바이아웃)형', '객실을 매입하는 계약이라 현금 잔액이 없고 신호를 계산하지 않는다.', 'off', typ='買取', nodata=True)
    mk('JP', 'S20011', 'Sample Ginza Select Hotel', 'JPY', '2026-04-01', 1_500_000, 'SCM-JP-F', '하드블럭 월 선급형', '하드블럭 객실을 월 단위로 선급한다. 소진과 정산이 규칙적이다.', 'ok', typ='HB', cover=0.95, grade='A', plan=1.0)
    mk('JP', 'S20012', 'Sample Maple Court Fukuoka', 'JPY', '2026-03-01', 650_000, 'SCM-JP-G', '소진 둔화형', '10월 소진이 직전 석 달 평균의 60%로 줄었다. 다른 신호는 정상이다.', 'warn', cover=1.5, shape='drop60', grade='B')
    # JP 보증금(差入保証金): 보증금 탭에서 따로 본다
    for code, name, amt, scm in [('S29001', 'Sample Granite Hotel Group (3 sites)', 3_000_000, 'SCM-JP-F'), ('S29002', 'Sample Meadow Hotel Kyoto', 1_500_000, 'SCM-JP-F')]:
        hotels.append(hotel(corp='JP', code=code, name=name, type='差入保証金', cur='JPY', status='운영', scm=scm, memo='샘플 · 보증금 호텔(소진 없음)'))
    deposits += [{'corp': 'JP', 'code': 'S29001', 'date': '2019-12-01', 'kind': '신규', 'amt': 3_000_000, 'cur': 'JPY'}, {'corp': 'JP', 'code': 'S29002', 'date': '2023-04-01', 'kind': '신규', 'amt': 2_000_000, 'cur': 'JPY'}, {'corp': 'JP', 'code': 'S29002', 'date': '2025-09-30', 'kind': '반환', 'amt': 500_000, 'cur': 'JPY'}]
    gledger += [{'code': 'S29001', 'dDate': '2019-12-01', 'dAmt': 3_000_000, 'rDate': '', 'rAmt': 0, 'bal': 3_000_000, 'link': '', 'memo': '샘플: 장기 예치'},
                {'code': 'S29002', 'dDate': '2023-04-01', 'dAmt': 2_000_000, 'rDate': '2025-09-30', 'rAmt': 500_000, 'bal': 1_500_000, 'link': '', 'memo': '샘플: 일부 반환'}]
    # ---------- VN (동) 14곳 ----------
    mk('VN', 'S30001', 'Sample Lotus Resort Da Nang', 'VND', '2026-02-01', 95_000_000, 'SCM-VN-B', '대형 해변 리조트 안정형', '150실 해변 리조트. 소진이 꾸준하고 확인서가 제때 온다.', 'ok', cover=0.95, grade='B', rooms='150', plan=1.0, topups=[('2026-06-15', 0.3)])
    mk('VN', 'S30002', 'Sample Bamboo Hotel Hanoi', 'VND', '2026-03-01', 30_000_000, 'SCM-VN-B', '임차 운영·잔액 과다형', '임차 운영. 월 소진에 비해 잔액이 3배 넘게 남았다.', 'warn', cover=3.3, flags='G1', grade='C', op='임차 운영')
    mk('VN', 'S30003', 'Sample Orchid Resort Nha Trang', 'VND', '2026-04-01', 70_000_000, 'SCM-VN-C', '리조트 안정형', '90실 리조트. 충전 뒤 한 달 안에 소진되는 흐름을 지킨다.', 'ok', cover=1.5, grade='B', rooms='90', plan=1.0, topups=[('2026-08-01', 0.25)])
    mk('VN', 'S30004', 'Sample Mekong Riverside Can Tho', 'VND', '2026-03-15', 35_000_000, 'SCM-VN-C', '소진 공백형', '10월 소진이 없고 이번 달 소진도 아직 올라오지 않았다(마지막 소진 10월).', 'warn', cover=1.4, nov=False, grade='B')
    mk('VN', 'S30005', 'Sample Saigon Central Hotel', 'VND', '2026-01-10', 120_000_000, 'SCM-VN-B', '도심 비즈니스 안정형', '호치민 도심 호텔. 소진이 크고 규칙적이다.', 'ok', cover=0.9, grade='A', rooms='210', plan=1.0, topups=[('2026-05-20', 0.3)])
    mk('VN', 'S30006', 'Sample Halong Bay Cruise Hotel', 'VND', '2026-03-01', 55_000_000, 'SCM-VN-C', '다중 위험 신호형', '호텔이 선급을 먼저 요청했고 큰 폭 할인에 타사 선급까지 겹쳤다. 마진이 얇다.', 'bad', cover=2.2, flags='G4 G5 G6', grade='C', sales_x=1.02, rooms='100')
    mk('VN', 'S30007', 'Sample Hoi An Heritage Inn', 'VND', '2026-02-01', 25_000_000, 'SCM-VN-B', '확인서 거부형', '소규모 부티크. 잔액 확인서를 계속 미루고 있고 금액도 맞지 않는다.', 'bad', cover=1.7, flags='G8', hb='diff_old', grade='C', rooms='28')
    mk('VN', 'S30008', 'Sample Phu Quoc Sunset Resort', 'VND', '2026-06-01', 85_000_000, 'SCM-VN-C', '대형 선급·계획 미달형', '큰 금액을 선급했지만 소진은 계획의 35% 수준이다.', 'bad', cover=5.0, plan=0.35, grade='C', rooms='200')
    mk('VN', 'S30009', 'Sample Dalat Pine Lodge', 'VND', '2026-03-01', 28_000_000, 'SCM-VN-B', '리뷰 하락·소진 급감형', '리뷰 점수가 떨어지고 직원이 떠났다. 10월 소진이 절반 아래로 줄었다.', 'bad', cover=1.5, shape='drop40', flags='G7', grade='C', rooms='48')
    mk('VN', 'S30010', 'Sample Vung Tau Beach Hotel', 'VND', '2026-04-01', 48_000_000, 'SCM-VN-C', '주말 수요 안정형', '호치민 주말 수요로 소진이 일정하다.', 'ok', cover=0.95, grade='B', plan=1.0, rooms='75')
    mk('VN', 'S30011', 'Sample Hue Imperial Hotel', 'VND', '2026-01-01', 32_000_000, 'SCM-VN-B', '연말 만료·잔액 이월 불가형', '계약이 12월 31일에 끝나는데 잔액이 많이 남았다. 2027년으로 넘기지 못한다.', 'bad', cover=4.5, end='2026-12-31', grade='B', rooms='60')
    mk('VN', 'S30012', 'Sample Sapa Mountain Lodge', 'VND', '2026-04-01', 22_000_000, 'SCM-VN-C', '폐업 소문형', '매각·폐업 소문이 돌고 거래처 대금 미지급 얘기가 들린다.', 'bad', cover=2.0, shape='idle2', nov=False, flags='C4', status='운영 중단', grade='D', rooms='35', hb='diff_old')
    mk('VN', 'S30013', 'Sample Ninh Binh Garden Hotel', 'VND', '2026-05-01', 60_000_000, 'SCM-VN-B', 'Commit(약정) 안정형', '연간 약정 계약. 소진이 약정 속도를 따라간다.', 'ok', typ='Commit', cover=0.95, grade='B', plan=1.0, rooms='80')
    mk('VN', 'S30014', 'Sample Quy Nhon Coast Hotel', 'VND', '2026-10-20', 0, 'SCM-VN-C', '자료 대기형', '계약 직후라 입금·소진 자료가 아직 없다.', 'na', nodata=True, rooms='64')
    hotels.append(hotel(corp='VN', code='S39001', name='Sample Silver Hotel Hue', type='보증금', cur='VND', status='운영', scm='SCM-VN-C', memo='샘플 · 보증금 호텔(소진 없음)'))
    deposits.append({'corp': 'VN', 'code': 'S39001', 'date': '2026-03-01', 'kind': '신규', 'amt': 500_000_000, 'cur': 'VND'})
    gledger.append({'code': 'S39001', 'dDate': '2026-03-01', 'dAmt': 500_000_000, 'rDate': '', 'rAmt': 0, 'bal': 500_000_000, 'link': '', 'memo': '샘플: 2027 이월 불가'})
    # ---------- TH (바트) 6곳 ----------
    mk('TH', 'S40001', 'Sample Aurora Hotel Bangkok', 'THB', '2026-04-01', 300_000, 'SCM-TH-C', '방콕 도심 안정형', '방콕 도심 호텔. 환승·출장 수요로 소진이 일정하다.', 'ok', cover=1.3, grade='B', plan=1.0, rooms='120')
    mk('TH', 'S40002', 'Sample Phuket Sands Resort', 'THB', '2026-03-01', 420_000, 'SCM-TH-C', '성수기 대비 선충전형', '성수기를 앞두고 미리 충전해 잔액이 소진 속도보다 많다.', 'warn', cover=3.1, grade='B', rooms='180')
    mk('TH', 'S40003', 'Sample Chiang Mai Teak Lodge', 'THB', '2026-04-15', 180_000, 'SCM-TH-C', '소진 공백형', '마지막 소진이 10월이고 이번 달 소진이 아직 없다.', 'warn', cover=1.5, nov=False, grade='B', rooms='36')
    mk('TH', 'S40004', 'Sample Pattaya Marina Hotel', 'THB', '2026-02-01', 260_000, 'SCM-TH-C', '체납·압류형', '세금 체납으로 압류 통지가 왔다.', 'bad', cover=1.8, flags='C2', grade='C', rooms='90')
    mk('TH', 'S40005', 'Sample Krabi Cliff Resort', 'THB', '2026-08-15', 350_000, 'SCM-TH-C', '신규·계획 미달형', '직접 거래 3개월 미만이고 소진이 계획의 65% 수준이다.', 'warn', shape='ramp', cover=1.8, flags='G3', plan=0.65, grade='B', rooms='70')
    mk('TH', 'S40006', 'Sample Samui Palm Retreat', 'THB', '2026-05-01', 230_000, 'SCM-TH-C', '소규모 리조트 안정형', '소규모 리조트. 충전 주기와 소진이 잘 맞는다.', 'ok', cover=0.9, grade='B', plan=1.0, rooms='40')
    # ---------- SG (싱가포르 달러) 4곳 ----------
    mk('SG', 'S50001', 'Sample Summit Hotel Singapore', 'SGD', '2026-03-01', 12_000, 'SCM-SG-H', '도심 체인 안정형', '도심 대형 체인. 소진과 확인서 모두 모범적이다.', 'ok', cover=0.9, grade='A', plan=1.0, rooms='300')
    mk('SG', 'S50002', 'Sample Marina Boutique Singapore', 'SGD', '2026-04-01', 8_000, 'SCM-SG-H', '부티크 안정형', '55실 부티크. 규모가 작아도 소진이 꾸준하다.', 'ok', cover=0.9, grade='B', plan=1.0, rooms='55')
    mk('SG', 'S50003', 'Sample Orchard Stay Singapore', 'SGD', '2026-02-01', 9_500, 'SCM-SG-H', '한도 근접형', '잔액이 승인 한도의 1.2배다. 소진은 정상이다.', 'warn', cover=1.6, limit=1.2, grade='B', rooms='120')
    mk('SG', 'S50004', 'Sample Sentosa Isle Resort', 'SGD', '2026-03-01', 15_000, 'SCM-SG-H', '소진 급감형', '휴양지 리조트. 10월 소진이 평소의 40%로 떨어졌다.', 'bad', cover=1.6, shape='drop40', grade='B', rooms='210', nov=False)
    pending = [{'corp': 'KR', 'name': 'Sample Meadow Stay', 'req': '선지급 (금액 기안 확인)', 'status': '샘플: 기안 상신', 'next': '이 심사표로 먼저 심사'},
               {'corp': 'KR', 'name': 'Sample Aster Hotel Ulsan', 'req': 'Floating Deposit', 'status': '샘플: 재무 검토', 'next': '경영지원 채점 대기'},
               {'corp': 'JP', 'name': 'Sample Granite Resort', 'req': 'Floating Deposit', 'status': '샘플: 반려', 'next': '재기안 시 심사표 적용'},
               {'corp': 'JP', 'name': 'Sample Larch Hotel Nagano', 'req': 'Prebuy', 'status': '샘플: 계약서 검토', 'next': '내년 1월 이후 재개 검토'},
               {'corp': 'VN', 'name': 'Sample Harbor Resort Phu Quoc', 'req': 'Prebuy 계약 조건 검토', 'status': '샘플: 협상 중', 'next': '계약 체결 여부 SCM 확인'},
               {'corp': 'TH', 'name': 'Sample Palm Hotel', 'req': 'Prebuy', 'status': '샘플: 관심 표명', 'next': '미팅 결과 확인'}]
    # 보증금 호텔 4곳째(KR)
    hotels.append(hotel(corp='KR', code='S19001', name='Sample Garden Hotel Seoul', type='보증금', cur='KRW', status='운영', scm='SCM-KR-A', memo='샘플 · 보증금 호텔(소진 없음)'))
    deposits.append({'corp': 'KR', 'code': 'S19001', 'date': '2024-03-01', 'kind': '신규', 'amt': 50_000_000, 'cur': 'KRW'})
    gledger.append({'code': 'S19001', 'dDate': '2024-03-01', 'dAmt': 50_000_000, 'rDate': '', 'rAmt': 0, 'bal': 50_000_000, 'link': '', 'memo': '샘플: 장기 예치'})
    seed = {'hotels': hotels, 'deposits': deposits, 'usage': usage, 'pending': pending, 'perf': perf, 'gledger': gledger}
    return seed, personas


def persona_md(personas):
    lines = ['# 가상 호텔 50곳 페르소나', '', '공개 화면(현황판)의 가상 호텔이다. 이름·금액은 모두 지어낸 값이고 `tools/make_seed_public.py`가 만든다. 호텔을 펼치면 메모에 같은 설명이 나온다.', '',
             '「예상 색」은 대표님 현황판이 8개 신호 중 가장 나쁜 것으로 정하는 호텔 색이다. 시험이 실제 화면의 색과 같은지 확인한다.', '']
    cnt = {}
    for p in personas: cnt[p['color']] = cnt.get(p['color'], 0) + 1
    lines.append('색별 호텔 수: ' + ' · '.join('%s %d' % (COLOR_KO[c], cnt.get(c, 0)) for c in ('bad', 'warn', 'ok', 'na', 'off')) + ' (합계 %d)' % len(personas))
    lines += ['', '| 법인 | 코드 | 호텔 | 유형 | 페르소나 | 설명 | 예상 색 |', '|---|---|---|---|---|---|---|']
    for p in personas:
        lines.append('| %s | %s | %s | %s | %s | %s | %s |' % (p['corp'], p['code'], p['name'], p['type'], p['title'], p['memo'], COLOR_KO[p['color']]))
    lines += ['', '보증금 호텔 4곳(S29001, S29002, S39001, S19001)은 소진이 없어 보증금 탭에서만 본다.', '']
    return '\n'.join(lines)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--out', default=os.path.join(ROOT, 'sample', 'seed_public.json')); ap.add_argument('--personas', default=os.path.join(ROOT, 'sample', 'hotel_personas.md')); a = ap.parse_args()
    seed, personas = build_seed()
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(seed, f, ensure_ascii=False)
    with open(a.personas, 'w', encoding='utf-8', newline='\n') as f:
        f.write(persona_md(personas))
    json.dump({p['code']: p['color'] for p in personas}, open(os.path.join(os.path.dirname(a.out), 'persona_expected.json'), 'w', encoding='utf-8', newline='\n'), ensure_ascii=False)
    print('공개용 가상 처음 자료:', a.out, '· 호텔', len(seed['hotels']), '(현황판 %d + 보증금 %d)' % (len(personas), len(seed['hotels']) - len(personas)), '· 입금·반환', len(seed['deposits']), '· 소진', len(seed['usage']))


if __name__ == '__main__':
    main()
