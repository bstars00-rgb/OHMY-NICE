# OMH-NICE 2.0 — 선급·SG 지급 대시보드

재무와 SCM이 채우는 엑셀 양식(「SG 직접 지급 — 자료 수집 양식」)을 읽어 대시보드 한 파일(HTML)로 만든다. 서버도 설치도 필요 없고, 만들어진 HTML은 더블클릭으로 열린다.

화면은 여섯 개다: 보드, SG 지급(후불), 프리바이 처리, 결재 준비(11/20), 수집·점검, 기준. 한국어와 영어를 지원한다.

## 이 저장소의 자료

이 저장소와 GitHub Pages에는 **가상 샘플 자료만** 있다. 호텔 이름과 금액은 모두 지어낸 값이다(`sample/`). 실제 자료로 만든 화면은 내부 파일이라 `private/` 폴더에만 쓰고, 공개 저장소에는 올리지 않는다(`tools/build.py`가 막는다).

## 만드는 방법

엑셀이 바뀔 때마다 아래 한 줄이면 대시보드가 다시 만들어진다. Claude에게 엑셀을 주면 대신 실행한다.

```bash
# 실제 자료(내부용): 결과는 private/ 안에만 쓴다
python tools/build.py --in 회신1.xlsx 회신2.xlsx --out private/SG지급_대시보드_내부용.html --json private/data.json
node tools/summary.js private/data.json          # 결과를 글로 요약

# 가상 샘플(공개 가능)
python tools/make_sample.py                      # sample/SG지급_자료수집_샘플.xlsx 다시 만들기
python tools/build.py --in sample/SG지급_자료수집_샘플.xlsx --synthetic --out index.html --json sample/sample_data.json
```

- 엑셀은 여러 개를 한꺼번에 줘도 된다(나라별 회신). 줄을 이어 붙여 하나의 화면으로 만든다.
- 시트는 이름으로, 열은 머리글 글자로 찾는다. 열 순서가 바뀌거나 앞에 열이 끼어도 읽는다.
- 엑셀의 수식 결과는 쓰지 않는다. 입력값으로 분류·소진 계산·신호를 화면에서 다시 계산하고, 엑셀의 분류와 다르면 점검에 표시한다.
- 필요한 것: Python 3와 `openpyxl`(`pip install openpyxl`), 점검 실행에는 Node 18 이상.

## 점검

```bash
node tests/run.js            # 계산, 글, 화면 그리기
python tests/test_build.py   # 엑셀 읽기, HTML 조립, 실제 자료 보호
```

## 폴더

| 경로 | 내용 |
|---|---|
| `src/calc.js` | 계산부: 분류, 소진 계산, 신호, 수집 현황, 점검. 화면과 시험이 같이 쓴다 |
| `src/app.js`, `src/i18n.js`, `src/style.css`, `src/template.html` | 화면 |
| `tools/build.py` | 엑셀 읽기와 HTML 조립 |
| `tools/make_sample.py` | 가상 샘플 엑셀 만들기 |
| `tools/summary.js` | 결과 요약 |
| `sample/` | 가상 샘플 엑셀과 그 JSON |
| `private/` | 실제 자료로 만든 내부 파일(저장소에 올리지 않음) |
| `index.html` | 가상 샘플로 만든 화면(GitHub Pages가 보여 주는 파일) |

## 읽는 양식

- `①지급목록`: 후불 지급 호텔. 재무가 아닌 SCM이 카드 수용 여부와 법인 계좌 등록 여부를 채운다.
- `②프리바이목록`: 선급 호텔. 재무가 대장 상 잔액·기준일·월평균 소진액을, SCM이 호텔 확인 잔액·이관 가능·반환 가능을 채운다.
- 수취 계좌 번호는 양식에도 화면에도 없다. 법인 계좌 등록 여부만 쓴다.
