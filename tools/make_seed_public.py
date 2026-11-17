#!/usr/bin/env python3
"""공개용 가상 처음 자료(SEED)를 만든다. 대표님 대시보드의 자료 모양(hotels, deposits, usage, pending, perf, gledger)과 같고, 호텔 이름·금액은 모두 지어낸 값이다.
사용법: python tools/make_seed_public.py [--out sample/seed_public.json]
화면이 '오늘'을 기준으로 계산하므로 소진 이력은 2026-01 ~ 2026-10(지난달까지)로 만든다."""
import argparse, json, os, random

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOTEL_KEYS = ['corp', 'code', 'name', 'type', 'cur', 'start', 'end', 'rooms', 'op', 'sameBld', 'bizNo', 'scm', 'grade', 'prevGrade', 'limit', 'topup', 'guarantee', 'planMonthly', 'hotelBal', 'hotelBalDate', 'flags', 'status', 'topupMin', 'refundTerms', 'refundable', 'disputes', 'memo']
MONTHS = ['2026-%02d' % m for m in range(1, 11)]


def hotel(**kw):
    h = {k: '' for k in HOTEL_KEYS}; h.update(kw); h.setdefault('status', '운영'); h['status'] = h['status'] or '운영'
    return h


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--out', default=os.path.join(ROOT, 'sample', 'seed_public.json')); a = ap.parse_args()
    rng = random.Random(20261117)
    hotels, deposits, usage, perf = [], [], [], []

    def add(corp, code, name, cur, start, end, scm, first, topups, monthly, from_m, hotel_bal=None, hotel_bal_date='', limit='', plan='', flags='', status='운영', grade='', typ='Floating', rooms=''):
        hotels.append(hotel(corp=corp, code=code, name=name, type=typ, cur=cur, start=start, end=end, scm=scm, limit=limit, planMonthly=plan, hotelBal=hotel_bal if hotel_bal is not None else '', hotelBalDate=hotel_bal_date, flags=flags, status=status, grade=grade, rooms=rooms, op='소유 운영'))
        deposits.append({'corp': corp, 'code': code, 'date': start, 'kind': '신규', 'amt': first, 'cur': cur})
        for d, amt in topups:
            deposits.append({'corp': corp, 'code': code, 'date': d, 'kind': '충전', 'amt': amt, 'cur': cur})
        for m in MONTHS:
            if m < from_m:
                continue
            amt = int(monthly * rng.uniform(0.85, 1.15)) if monthly else 0
            usage.append({'code': code, 'ym': m, 'amt': amt, 'onbook': 0, 'corp': corp, 'cur': cur})
            if monthly:
                sales = int(amt * 1.12); perf.append({'code': code, 'ym': m, 'sales': sales, 'margin': sales - amt})

    # KR (원)
    add('KR', 'S10001', 'Sample Maple Resort', 'KRW', '2026-02-01', '2027-01-31', 'SCM-KR-A', 60_000_000, [('2026-06-10', 30_000_000)], 9_000_000, '2026-02', 11_000_000, '2026-10-31', 60_000_000, 9_000_000, grade='B', rooms='120')
    add('KR', 'S10002', 'Sample Harbor Inn', 'KRW', '2026-03-01', '2027-02-28', 'SCM-KR-A', 40_000_000, [], 3_000_000, '2026-03', None, '', 30_000_000, 3_000_000, grade='C', flags='G1 G4', rooms='60')
    add('KR', 'S10003', 'Sample Coral Suites', 'KRW', '2026-05-01', '2027-04-30', 'SCM-KR-B', 30_000_000, [('2026-08-20', 10_000_000)], 5_500_000, '2026-05', 8_900_000, '2026-10-31', 40_000_000, 5_500_000, grade='A', rooms='80')
    add('KR', 'S10004', 'Sample Willow Villa', 'KRW', '2026-04-01', '2027-03-31', 'SCM-KR-B', 50_000_000, [], 2_000_000, '2026-04', None, '', 40_000_000, 4_000_000, flags='C3', status='운영 중단', grade='D', rooms='30')
    # JP (엔)
    add('JP', 'S20001', 'Sample Cedar Hotel Tokyo', 'JPY', '2026-01-10', '2027-01-09', 'SCM-JP-F', 8_000_000, [('2026-05-12', 4_000_000)], 1_100_000, '2026-01', 1_300_000, '2026-09-30', 10_000_000, 1_100_000, grade='A')
    add('JP', 'S20002', 'Sample Amber Hotel Osaka', 'JPY', '2026-02-01', '2027-01-31', 'SCM-JP-F', 5_000_000, [], 300_000, '2026-02', 1_900_000, '2026-09-30', 6_000_000, 400_000, grade='B', flags='G6')
    add('JP', 'S20003', 'Sample Jade Resort Okinawa', 'JPY', '2026-03-01', '2027-02-28', 'SCM-JP-G', 6_000_000, [('2026-07-01', 2_000_000)], 750_000, '2026-03', None, '', 8_000_000, 800_000, grade='B')
    add('JP', 'S20004', 'Sample Pearl Hotel Sapporo', 'JPY', '2026-06-01', '2027-05-31', 'SCM-JP-G', 4_000_000, [], 0, '2026-06', None, '', 5_000_000, 500_000, grade='C', flags='G3')
    # JP 보증금(差入保証金): 보증금 탭에서 따로 본다
    for code, name, amt in [('S29001', 'Sample Granite Hotel Group (3 sites)', 3_000_000), ('S29002', 'Sample Meadow Hotel Kyoto', 1_500_000)]:
        hotels.append(hotel(corp='JP', code=code, name=name, type='差入保証金', cur='JPY', status='운영', scm='SCM-JP-F'))
    deposits += [{'corp': 'JP', 'code': 'S29001', 'date': '2019-12-01', 'kind': '신규', 'amt': 3_000_000, 'cur': 'JPY'}, {'corp': 'JP', 'code': 'S29002', 'date': '2023-04-01', 'kind': '신규', 'amt': 2_000_000, 'cur': 'JPY'}, {'corp': 'JP', 'code': 'S29002', 'date': '2025-09-30', 'kind': '반환', 'amt': 500_000, 'cur': 'JPY'}]
    gledger = [{'code': 'S29001', 'dDate': '2019-12-01', 'dAmt': 3_000_000, 'rDate': '', 'rAmt': 0, 'bal': 3_000_000, 'link': '', 'memo': '샘플: 장기 예치'},
               {'code': 'S29002', 'dDate': '2023-04-01', 'dAmt': 2_000_000, 'rDate': '2025-09-30', 'rAmt': 500_000, 'bal': 1_500_000, 'link': '', 'memo': '샘플: 일부 반환'}]
    # VN (동)
    add('VN', 'S30001', 'Sample Lotus Resort Da Nang', 'VND', '2026-02-01', '2027-01-31', 'SCM-VN-B', 1_000_000_000, [('2026-06-15', 400_000_000)], 95_000_000, '2026-02', 260_000_000, '2026-10-31', 1_000_000_000, 100_000_000, grade='B', rooms='150')
    add('VN', 'S30002', 'Sample Bamboo Hotel Hanoi', 'VND', '2026-03-01', '2027-02-28', 'SCM-VN-B', 800_000_000, [], 30_000_000, '2026-03', None, '', 600_000_000, 60_000_000, grade='C', flags='G1')
    add('VN', 'S30003', 'Sample Orchid Resort Nha Trang', 'VND', '2026-04-01', '2027-03-31', 'SCM-VN-C', 500_000_000, [('2026-08-01', 200_000_000)], 70_000_000, '2026-04', 150_000_000, '2026-10-31', 700_000_000, 70_000_000, grade='B', rooms='90')
    hotels.append(hotel(corp='VN', code='S39001', name='Sample Silver Hotel Hue', type='보증금', cur='VND', status='운영', scm='SCM-VN-C'))
    deposits.append({'corp': 'VN', 'code': 'S39001', 'date': '2026-03-01', 'kind': '신규', 'amt': 500_000_000, 'cur': 'VND'})
    gledger.append({'code': 'S39001', 'dDate': '2026-03-01', 'dAmt': 500_000_000, 'rDate': '', 'rAmt': 0, 'bal': 500_000_000, 'link': '', 'memo': '샘플: 2027 이월 불가'})
    # TH, SG
    add('TH', 'S40001', 'Sample Aurora Hotel Bangkok', 'THB', '2026-04-01', '2027-03-31', 'SCM-TH-C', 2_000_000, [], 300_000, '2026-04', None, '', 2_500_000, 300_000, grade='B')
    add('SG', 'S50001', 'Sample Summit Hotel Singapore', 'SGD', '2026-03-01', '2027-02-28', 'SCM-SG-H', 100_000, [], 12_000, '2026-03', 24_000, '2026-10-31', 120_000, 12_000, grade='A')
    pending = [{'corp': 'KR', 'name': 'Sample Meadow Stay', 'req': '선지급 (금액 기안 확인)', 'status': '샘플: 기안 상신', 'next': '이 심사표로 먼저 심사'},
               {'corp': 'JP', 'name': 'Sample Granite Resort', 'req': 'Floating Deposit', 'status': '샘플: 반려', 'next': '재기안 시 심사표 적용'},
               {'corp': 'VN', 'name': 'Sample Harbor Resort Phu Quoc', 'req': 'Prebuy 계약 조건 검토', 'status': '샘플: 협상 중', 'next': '계약 체결 여부 SCM 확인'},
               {'corp': 'TH', 'name': 'Sample Palm Hotel', 'req': 'Prebuy', 'status': '샘플: 관심 표명', 'next': '미팅 결과 확인'}]
    seed = {'hotels': hotels, 'deposits': deposits, 'usage': usage, 'pending': pending, 'perf': perf, 'gledger': gledger}
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(seed, f, ensure_ascii=False)
    print('공개용 가상 처음 자료:', a.out, '· 호텔', len(hotels), '· 입금·반환', len(deposits), '· 소진', len(usage))


if __name__ == '__main__':
    main()
