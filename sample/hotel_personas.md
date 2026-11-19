# 가상 호텔 50곳 페르소나

공개 화면(현황판)의 가상 호텔이다. 이름·금액은 모두 지어낸 값이고 `tools/make_seed_public.py`가 만든다. 호텔을 펼치면 메모에 같은 설명이 나온다.

「예상 색」은 대표님 현황판이 8개 신호 중 가장 나쁜 것으로 정하는 호텔 색이다. 시험이 실제 화면의 색과 같은지 확인한다.

색별 호텔 수: 빨강 16 · 노랑 13 · 초록 17 · 자료 대기 2 · 신호 없음 2 (합계 50)

| 법인 | 코드 | 호텔 | 유형 | 페르소나 | 설명 | 예상 색 |
|---|---|---|---|---|---|---|
| KR | S10001 | Sample Maple Resort Jeju | Floating | 연중 안정 소진형 | 120실 리조트. 소진이 달마다 비슷하고 잔액 확인서가 제때 온다. | 초록 |
| KR | S10002 | Sample Harbor Inn Busan | Floating | 임차·선급 요청형 | 임차 운영 호텔이 먼저 선급을 요청했다. 소진은 보통이고 잔액은 넉넉하다. | 노랑 |
| KR | S10003 | Sample Coral Suites Seoul | Floating | 도심 비즈니스 안정형 | 도심 80실. 평일 수요가 꾸준해 잔액이 빨리 돌고 확인서도 정시 회신. | 초록 |
| KR | S10004 | Sample Willow Villa Gapyeong | Floating | 운영 중단형 | 펜션형 30실. 11월 초 운영을 멈췄고 연락이 닿지 않는다. | 빨강 |
| KR | S10005 | Sample Pine Hotel Gangneung | Floating | 소진 급감형 | 바다 전망 호텔. 10월 소진이 직전 석 달 평균의 40%로 줄었다. | 빨강 |
| KR | S10006 | Sample Lantern Hotel Jeonju | Floating | 계획 대비 미달형 | 한옥마을 인근. 계약 때 잡은 월 소진 계획의 65% 수준에 머문다. | 노랑 |
| KR | S10007 | Sample Cherry Stay Seoul | Floating | 신규 직접 거래형 | 직접 거래를 시작한 지 3개월이 안 됐다. 소진은 정상이다. | 노랑 |
| KR | S10008 | Sample Granite Tower Seoul | Floating | 한도 초과형 | 대형 도심 호텔. 잔액이 승인 한도의 1.8배까지 쌓였다. | 빨강 |
| KR | S10009 | Sample Birch Resort Pyeongchang | Floating | 잔액 확인 지연형 | 스키 리조트. 호텔이 보낸 잔액 확인서가 두 달 넘게 오지 않고 금액도 다르다. | 빨강 |
| KR | S10010 | Sample River Hotel Daegu | Floating | 지방 도시 안정형 | 지방 도시 비즈니스 호텔. 소진과 확인서 모두 규칙적이다. | 초록 |
| KR | S10011 | Sample Sunrise Condo Yeosu | Floating | 분양형 위탁 운영형 | 분양형 객실을 위탁 운영한다. 소진은 보통이고 운영 주체가 겹쳐 있다. | 노랑 |
| KR | S10012 | Sample Plum Hotel Incheon | Floating | 등급 하락형 | 공항 인근. 지난 분기 A등급이었다가 이번 심사에서 C등급으로 내려갔다. | 빨강 |
| KR | S10013 | Sample Stone Hanok Andong | Floating | 자료 대기형 | 계약만 맺은 한옥 숙소. 입금과 소진 자료가 아직 올라오지 않았다. | 자료 대기 |
| KR | S10014 | Sample Harvest Hotel Suwon | Floating | 정산 완료 종료형 | 6월에 계약이 끝났고 남은 잔액 없이 정산을 마쳤다. | 신호 없음 |
| JP | S20001 | Sample Cedar Hotel Tokyo | Floating | 도심 체인 안정형 | 도쿄 체인 호텔. 하드블럭과 선급이 같이 돌고 소진이 안정적이다. | 초록 |
| JP | S20002 | Sample Amber Hotel Osaka | Floating | 타사 선급 집중형 | 다른 OTA 선급이 몰려 있고 우리 소진은 계획보다 느리다. | 노랑 |
| JP | S20003 | Sample Jade Resort Okinawa | Floating | 연말 완소진 계획형 | SCM이 연말까지 잔액을 다 쓰는 계획을 제출했다. 소진은 계획대로다. | 초록 |
| JP | S20004 | Sample Pearl Hotel Sapporo | Floating | 선급 후 무소진형 | 직접 거래를 막 시작했고 입금 뒤 한 번도 소진되지 않았다. | 빨강 |
| JP | S20005 | Sample Sakura Ryokan Kyoto | Floating | 소규모 료칸·장부 혼선형 | 12실 료칸. 9월 이후 소진이 없고 장부 입력이 자주 틀린다. | 빨강 |
| JP | S20006 | Sample Harbor View Yokohama | Floating | 항구 도시 안정형 | 관광과 출장 수요가 섞여 소진이 일정하다. | 초록 |
| JP | S20007 | Sample Cypress Hotel Nagoya | Floating | 잔액 과다·확인서 지연형 | 잔액이 소진 속도보다 많이 쌓였고 확인서는 두 달 가까이 지났다. | 노랑 |
| JP | S20008 | Sample Onsen Resort Hakone | Floating | 가압류 사고형 | 온천 리조트. 채권자의 가압류가 들어왔다는 연락을 받았다. | 빨강 |
| JP | S20009 | Sample Fuji Lodge Kawaguchiko | Floating | 신규 선급 순항형 | 반년 전 선급을 시작했고 소진이 계획을 웃돈다. | 초록 |
| JP | S20010 | Sample Kobe Bay Hotel | 買取 | 買取(바이아웃)형 | 객실을 매입하는 계약이라 현금 잔액이 없고 신호를 계산하지 않는다. | 신호 없음 |
| JP | S20011 | Sample Ginza Select Hotel | HB | 하드블럭 월 선급형 | 하드블럭 객실을 월 단위로 선급한다. 소진과 정산이 규칙적이다. | 초록 |
| JP | S20012 | Sample Maple Court Fukuoka | Floating | 소진 둔화형 | 10월 소진이 직전 석 달 평균의 60%로 줄었다. 다른 신호는 정상이다. | 노랑 |
| VN | S30001 | Sample Lotus Resort Da Nang | Floating | 대형 해변 리조트 안정형 | 150실 해변 리조트. 소진이 꾸준하고 확인서가 제때 온다. | 초록 |
| VN | S30002 | Sample Bamboo Hotel Hanoi | Floating | 임차 운영·잔액 과다형 | 임차 운영. 월 소진에 비해 잔액이 3배 넘게 남았다. | 노랑 |
| VN | S30003 | Sample Orchid Resort Nha Trang | Floating | 리조트 안정형 | 90실 리조트. 충전 뒤 한 달 안에 소진되는 흐름을 지킨다. | 초록 |
| VN | S30004 | Sample Mekong Riverside Can Tho | Floating | 소진 공백형 | 10월 소진이 없고 이번 달 소진도 아직 올라오지 않았다(마지막 소진 10월). | 노랑 |
| VN | S30005 | Sample Saigon Central Hotel | Floating | 도심 비즈니스 안정형 | 호치민 도심 호텔. 소진이 크고 규칙적이다. | 초록 |
| VN | S30006 | Sample Halong Bay Cruise Hotel | Floating | 다중 위험 신호형 | 호텔이 선급을 먼저 요청했고 큰 폭 할인에 타사 선급까지 겹쳤다. 마진이 얇다. | 빨강 |
| VN | S30007 | Sample Hoi An Heritage Inn | Floating | 확인서 거부형 | 소규모 부티크. 잔액 확인서를 계속 미루고 있고 금액도 맞지 않는다. | 빨강 |
| VN | S30008 | Sample Phu Quoc Sunset Resort | Floating | 대형 선급·계획 미달형 | 큰 금액을 선급했지만 소진은 계획의 35% 수준이다. | 빨강 |
| VN | S30009 | Sample Dalat Pine Lodge | Floating | 리뷰 하락·소진 급감형 | 리뷰 점수가 떨어지고 직원이 떠났다. 10월 소진이 절반 아래로 줄었다. | 빨강 |
| VN | S30010 | Sample Vung Tau Beach Hotel | Floating | 주말 수요 안정형 | 호치민 주말 수요로 소진이 일정하다. | 초록 |
| VN | S30011 | Sample Hue Imperial Hotel | Floating | 연말 만료·잔액 이월 불가형 | 계약이 12월 31일에 끝나는데 잔액이 많이 남았다. 2027년으로 넘기지 못한다. | 빨강 |
| VN | S30012 | Sample Sapa Mountain Lodge | Floating | 폐업 소문형 | 매각·폐업 소문이 돌고 거래처 대금 미지급 얘기가 들린다. | 빨강 |
| VN | S30013 | Sample Ninh Binh Garden Hotel | Commit | Commit(약정) 안정형 | 연간 약정 계약. 소진이 약정 속도를 따라간다. | 초록 |
| VN | S30014 | Sample Quy Nhon Coast Hotel | Floating | 자료 대기형 | 계약 직후라 입금·소진 자료가 아직 없다. | 자료 대기 |
| TH | S40001 | Sample Aurora Hotel Bangkok | Floating | 방콕 도심 안정형 | 방콕 도심 호텔. 환승·출장 수요로 소진이 일정하다. | 초록 |
| TH | S40002 | Sample Phuket Sands Resort | Floating | 성수기 대비 선충전형 | 성수기를 앞두고 미리 충전해 잔액이 소진 속도보다 많다. | 노랑 |
| TH | S40003 | Sample Chiang Mai Teak Lodge | Floating | 소진 공백형 | 마지막 소진이 10월이고 이번 달 소진이 아직 없다. | 노랑 |
| TH | S40004 | Sample Pattaya Marina Hotel | Floating | 체납·압류형 | 세금 체납으로 압류 통지가 왔다. | 빨강 |
| TH | S40005 | Sample Krabi Cliff Resort | Floating | 신규·계획 미달형 | 직접 거래 3개월 미만이고 소진이 계획의 65% 수준이다. | 노랑 |
| TH | S40006 | Sample Samui Palm Retreat | Floating | 소규모 리조트 안정형 | 소규모 리조트. 충전 주기와 소진이 잘 맞는다. | 초록 |
| SG | S50001 | Sample Summit Hotel Singapore | Floating | 도심 체인 안정형 | 도심 대형 체인. 소진과 확인서 모두 모범적이다. | 초록 |
| SG | S50002 | Sample Marina Boutique Singapore | Floating | 부티크 안정형 | 55실 부티크. 규모가 작아도 소진이 꾸준하다. | 초록 |
| SG | S50003 | Sample Orchard Stay Singapore | Floating | 한도 근접형 | 잔액이 승인 한도의 1.2배다. 소진은 정상이다. | 노랑 |
| SG | S50004 | Sample Sentosa Isle Resort | Floating | 소진 급감형 | 휴양지 리조트. 10월 소진이 평소의 40%로 떨어졌다. | 빨강 |

보증금 호텔 4곳(S29001, S29002, S39001, S19001)은 소진이 없어 보증금 탭에서만 본다.
