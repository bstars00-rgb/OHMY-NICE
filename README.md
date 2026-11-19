# OMH-NICE 2.0 — 선급금 대시보드 (대표님 대시보드 기반 + SG 전환 탭)

대표님이 공유한 「선급금/하드 심사/관리」 대시보드(v21)를 기본 틀로 쓰고, 그 위에 재무·SCM 엑셀 양식(「SG 직접 지급 — 자료 수집 양식」)을 읽어 보여 주는 **SG 전환** 탭을 더했다. 결과는 HTML 파일 한 개이고, 서버와 설치 없이 더블클릭으로 열린다.

- 대표님 탭 8개(현황판, 신용·이중체크, 심사표, 정기 관리, 보증금, 데이터, 기준, 하드 기준)의 계산과 내용은 원본 그대로다. 5개 언어와 나라 단추도 그대로다. 바꾼 것은 현황판 위 카드의 모양과 화면 배치뿐이다.
- 화면 배치: 왼쪽에 메뉴, 나라, 거르기를 두고 오른쪽에 내용을 넓게 보여 준다. 현황판은 큰 신호 카드(누르면 그 색만 거름) → 위험 호텔 → 호텔별 신호 순이다. 위 막대의 단추로 다크/화이트를 바꾸고, 고른 값은 브라우저에 기억한다. 좁은 화면에서는 메뉴가 위로 올라간다.
- SG 전환 탭: 후불 지급(A1·A2), 프리바이 처리(B1·B2), 11/20 결재 준비, 수집·점검. 프리바이 호텔은 대표님 현황판의 같은 호텔(ELLIS 호텔코드 또는 이름)과 이어져 신호가 함께 보인다.

## 이 저장소의 자료

이 저장소와 GitHub Pages에는 **가상 샘플만** 있다. 호텔 이름과 금액은 모두 지어낸 값이고, 대표님 파일의 사람 이름과 내부 메모는 뺐다(`src/template_public.html`). 실제 자료로 만든 화면은 내부 파일이라 `private/` 폴더에만 쓰고, 공개 저장소에는 올리지 않는다(`tools/build_ceo.py`가 막는다).

## 만드는 방법

```bash
# 한 번만: 대표님 대시보드 파일을 코드와 자료로 나눈다(private/base/ 와 src/template_public.html 이 만들어진다)
node tools/ceo_split.js "선급금_하드_심사_대시보드_팀공유.html"

# 내부용(실제 자료): 대표님 원본 코드와 처음 자료 + 회신 엑셀
python tools/build_ceo.py --sg-in 회신1.xlsx 회신2.xlsx --out private/선급금_대시보드_내부용.html --json private/sg_data.json
node tools/summary.js private/sg_data.json        # 결과를 글로 요약

# 대표님 CSV 3종(① 호텔 ② 입금·반환 ③ 소진)으로 처음 자료를 바꿀 때
python tools/build_ceo.py --hotels-csv h.csv --deposits-csv d.csv --usage-csv u.csv --out private/...html

# 가상 샘플(공개 가능)
python tools/make_sample.py && python tools/make_seed_public.py
python tools/build_ceo.py --public --sg-in sample/SG지급_자료수집_샘플.xlsx --out index.html --json sample/sample_data.json --today 2026-11-17
```

화면에서도 바꿀 수 있다. 대표님 「데이터」 탭에서 CSV 3종을, 「SG 전환 → 수집·점검」에서 엑셀 시트를 CSV(UTF-8)로 저장해 올리면 바로 다시 계산한다(올린 나라의 줄만 바뀌고, 파일은 브라우저 밖으로 나가지 않는다).

필요한 것: Python 3와 `openpyxl`, 점검에 Node 18 이상.

## 점검

```bash
node tests/run.js            # 계산, 글, CSV 읽기, 틀 보존, SG 탭 화면, 공개 파일 점검
python tests/test_build.py   # 엑셀 읽기, 조립, 실제 자료 쓰기 차단
```

## 폴더

| 경로 | 내용 |
|---|---|
| `src/template_public.html` | 대표님 대시보드 코드(공개용 정리본). SEED 자리만 표시로 바꿨다 |
| `src/calc.js` | SG 계산부: 분류, 소진 계산, 신호, 수집 현황, 점검, 결재 자료 |
| `src/sg_ui.js` | SG 전환 탭 화면(대표님 전역 변수를 그대로 쓴다) |
| `src/layout.css`, `src/layout.js` | 화면 배치: 왼쪽 메뉴·나라·필터, 위 막대의 다크/화이트 단추, 구역 묶기와 순서. 대표님 요소를 옮길 뿐 다시 만들지 않는다 |
| `src/tiles.js` | 현황판 위 카드(큰 숫자, 비율 막대, 누르면 그 색만 거름). 조립할 때 대표님 카드 블록을 이것으로 바꾼다 |
| `src/sg_import.js` | 엑셀을 CSV로 저장한 글 읽기(화면 쪽) |
| `src/i18n.js` | SG 탭 글(한국어·영어) |
| `tools/ceo_split.js` | 대표님 대시보드를 코드와 자료로 나눔 |
| `tools/build_ceo.py`, `tools/build.py` | HTML 조립, 엑셀 읽기 |
| `tools/make_sample.py`, `tools/make_seed_public.py` | 가상 샘플 엑셀·CSV, 가상 처음 자료(호텔 50곳과 페르소나). 공개용 빌드는 기준일(2026-11-17)에 오늘 날짜를 고정한다 |
| `sample/` | 가상 샘플(엑셀, CSV, JSON). `hotel_personas.md`는 가상 호텔 50곳의 페르소나 표 |
| `private/` | 실제 자료와 내부용 결과(저장소에 올리지 않음) |
| `index.html` | 가상 샘플로 만든 화면(GitHub Pages가 보여 주는 파일) |
