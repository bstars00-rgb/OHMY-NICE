# OMH-NICE 2.0 — 호텔 플로팅·선급금 위험관리 프로토타입

가상의 샘플 데이터로 동작하는 정적 웹앱이다. 실제 송금·결재·장부 이전을 실행하지 않고 외부 네트워크 호출이 없다.

## 실행

```bash
python -m http.server 8765
# 브라우저: http://127.0.0.1:8765/index.html
```

빌드 단계와 외부 의존성은 없다. 이 저장소와 GitHub Pages에는 가상 샘플 데이터만 있다. 실제 호텔·계약·금액·신용평가 결과·비밀번호를 넣지 않는다. 내부 데이터를 쓰기 전에는 서버측 인증이 먼저 필요하다. 로그인 화면의 시연 계정과 비밀번호는 공개 값이다.

## 테스트

```bash
node tests/run_all.js                 # 엔진·시스템 테스트 (Node 18+)
node tools/mutation_check.js          # 결함 주입 검사: 테스트가 실제로 실패하는지 확인
node tools/gen_reports.js             # 추적 매트릭스(../11_*.md)와 tests/results/summary.json 생성
# 브라우저 UI 테스트: http://127.0.0.1:8765/tests/ui_tests.html
```

## 폴더

| 경로 | 내용 |
|---|---|
| `index.html`, `css/`, `js/` | 앱 (`js/engine` 순수 계산, `js/store.js` 명령·감사·저장, `js/ui` 화면) |
| (`legacy/`) | 기존 OMH-NICE 파트너 평가. 공개 저장소에는 올리지 않는다. 폴더가 없으면 이 모듈을 검증하는 테스트 3개(X11, X12, U13)는 건너뛰고, 배포 사이트에서는 파트너 평가 링크를 숨긴다 |
| `tests/` | 엔진·시스템 테스트, 브라우저 UI 테스트, 결과 JSON, 기존 앱 회귀 기준선 |
| `tools/` | 요구사항 목록, 보고서 생성, 결함 주입 검사 |

## 언어팩

한국어·영어·일본어·베트남어를 지원한다. 일본어·베트남어 사전은 `js/i18n/ja.js`, `vi.js`에 한국어 원문을 키로 두며 직접 고쳐도 된다. 새 화면 문구를 추가하면 `node tools/i18n_extract.js`로 번역 대상을 뽑고 `node tools/i18n_build.js <번역 JSON>`으로 합친다. 빠진 문구는 `node tests/run_all.js`(I01)가 알려준다.

## ELLIS MCP 연동

브라우저 앱은 네트워크 호출이 막혀 있어 ELLIS MCP를 직접 부르지 않는다. 수집기(Claude 또는 서버)가 만든 스냅샷 JSON을 관리 화면의 "ELLIS 연동" 패널에서 가져와 원장과 비교한다. 원장은 바뀌지 않는다. 구조와 규칙은 `../14_ELLIS_MCP_Integration.md`.

```bash
node tools/make_ellis_sample.js                       # 합성 샘플 스냅샷 생성 (samples/, js/data/)
node tools/ellis_snapshot.js check samples/ellis_snapshot_SYNTHETIC.json
node tools/ellis_snapshot.js build <호출기록.json> <프로젝트 밖 경로>/snapshot.json --collector CLAUDE_MCP --by "<이름>"
```

실제 ELLIS 응답과 스냅샷은 프로젝트 폴더 밖에 둔다. 샘플 상태에서는 실데이터 스냅샷 가져오기가 거부된다.

## PIC 트래커 변환

베트남 PIC 트래커(Existing·Top-up Log·Risk Register)를 시트별로 CSV(UTF-8)로 저장하면 입력 점검 목록과 통합 형식 파일(계약·원장·호텔 확인 잔액)을 만든다. 관리 화면의 "PIC 트래커 점검·변환" 패널(저장 안 함) 또는 명령줄을 쓴다. 자세한 내용은 `../15_Tracker_Reconciliation.md`.

```bash
node tools/make_tracker_sample.js                     # 합성 샘플 생성 (samples/, js/data/)
node tools/tracker_import.js --existing samples/tracker_SYNTHETIC_existing.csv --topup samples/tracker_SYNTHETIC_topup.csv --risk samples/tracker_SYNTHETIC_risk.csv --as-of 2026-11-06 --out <폴더> --synthetic
```

실제 호텔 자료의 결과는 프로젝트 폴더 밖에 쓴다(안에 쓰려 하면 도구가 거부한다).

## 알아둘 점

- 등급 구간(A≥80, B≥65, C≥50)과 한도 배수(A2·B1·C0.5·D0)는 잠정값이다.
- 로그인은 시연용이며 보안 통제가 아니다. 계정마다 역할이 정해지고(`demo.viewer`, `demo.scm`, `demo.scm2`, `demo.ceo`, `demo.admin`, 비밀번호는 로그인 화면에 공개된 시연 값) 화면에서 역할을 바꿀 수 없다. 실제 비밀번호를 입력하지 않는다.
- 저장은 브라우저 `localStorage`(`omh_hfr_v1`)이며 기존 `omh_prg_v42`와 분리되어 있다.

## 배포

`.github/workflows/pages.yml`이 main에 올라온 변경마다 Node 테스트를 돌리고, 통과하면 `index.html`, `css/`, `js/`, `samples/`를 GitHub Pages에 올린다. 저장소 설정의 Pages 소스는 "GitHub Actions"여야 한다. 브라우저 UI 테스트와 결함 주입 검사는 배포에 포함하지 않는다.
