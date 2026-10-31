# 구현 및 검증 상태

**확인일:** 2026-10-31 · **버전:** 0.1.0-alpha.1 · **배포:** 로컬 개발용, Windows 릴리스 검증 전

## 구현 범위

사용자가 확정한 완료 흐름은 **DeepSeek-chan 표시 → 채팅 요청 → Hermes 실제 응답 → Jev 판단 → 모델 표정/모션**이다. 내부 모듈은 분리하지만 캐릭터 단독 PoC로 완료하지 않는다. 화면 캡처·PC 실행·TTS/립싱크는 구현하지 않았다.

| 항목 | 구현/실증 | 한계 |
|---|---|---|
| Electron | typed IPC, sender/mainFrame 검사, sandbox/contextIsolation, renderer 외부 네트워크 차단 | Windows 실제 창/입력 미검증 |
| UI/Live2D | 모델만 보이는 투명 Overlay, 별도 채팅/설정, 모니터 사이 드래그·모니터 선택·부분 표시·잡은 상태의 휠 배율·트레이·복구 단축키, 실제 모델 idle/blink/breath/표정/one-shot 모션 | Windows·실제 고 DPI·성능 수락 전 |
| Linux/Sway | Xwayland의 non-focusable Overlay, 입력 전용 XShape로 빈 영역 통과·모델 재진입, 실패 시 전체 입력 복구 | 현재 SwayFX 환경에서 실증. native Wayland 클릭 통과는 미지원 |
| Core | binding/turn/request 검사, dedupe, lease, reconciling, 승인/취소, 원문 없는 복원 | 원문 히스토리 영구 저장 안 함 |
| Hermes SSH | 기존 owner의 native control/ticket/WebSocket, 명시적 세션 선택, 전용 테스트 세션 실제 왕복·새 연결 receipt 복구 | canonical Bot Chat 미검증, 실제 진행 중 취소/승인은 계약 테스트만 |
| Hermes HTTP | Runs/SSE/상태/중단/승인/복구와 테스트 서버 왕복 | 원격 실증 전. API 소유 세션 전용 |
| Grok Bot | Webhook 인증 제출, 200→accepted/awaiting_result | 실계정 미실증, callback 미구현, 양방향 채팅 미지원 |
| Jev | Choice emotion/gesture, 최대 800자 구간, 비동기 판단·deadline·confidence·stale gating | 한국어 인사 실증은 전체 품질 평가가 아님 |
| 인증키 | async safeStorage, 서버별 credential scope, 사용자 `.env` 시작 시 입력 | 현재 headless 환경은 보호 저장소 불가. 앱 보관은 메모리 전용이며 사용자 `.env`는 별도 유지 |

## 실행·복원 구조

루트 [README](../../README.md)의 준비/실행 명령을 따른다. `local-assets/DeepSeek/`와 `vendor/`는 ignored이며 git clone만으로 자산이 준비되지 않는다. SDK는 공식 Framework 5-r.5 commit과 Core 5.3(`core/06`) 해시를 검사한다. 로컬 개발 사용과 배포 라이선스 검토는 구분한다.

사용자 ZIP에서 runtime만 추출하고, 누락된 `Exp3/`·`Animation/` 참조는 검증된 manifest에 보충한다. 원본 파일을 수정하지 않는다. 자산 URL은 선택 디렉터리의 의존 파일만 토큰으로 제공하며 symlink/traversal/외부 URL을 거절한다. 재선택 시 토큰은 폐기된다.

DeepSeek의 49개 마스크 그룹에 기본 버퍼 1개를 사용하면 SDK의 36그룹 용량을 초과해 얼굴·머리카락·꼬리가 오염됐다. SDK의 그룹 집계와 다중 버퍼 용량으로 버퍼 2개를 할당하고 POT 텍스처에는 mipmap 축소 필터를 적용한다. 원래 alpha 업로드를 공식 예제 방식과 동일 geometry에서 비교했을 때 픽셀 차이는 0이었다. 첫 gesture는 시작 후 1.6초 cooldown에 막히지 않도록 초기 시각을 분리했다.

Linux에서는 `DISPLAY`가 있고 backend를 명시하지 않았으면 X11을 선택한다. 항상 위 옵션을 켠 Overlay만 생성 시 `focusable: false`를 사용하며 chat은 일반 창이다. Linux에서 해당 옵션을 바꾸면 Overlay만 재생성한다. Sway의 일회성 floating/sticky 명령이나 사용자 전체화면 해제로 해결하지 않는다.

Linux의 `setIgnoreMouseEvents`는 mouse forwarding을 지원하지 않는다. Sway에서 뒤쪽 Wayland 창으로 넘어가면 Xwayland의 전역 커서 좌표도 갱신되지 않아 polling 복구 역시 실패했다. 따라서 Linux는 자기 canvas의 alpha로 입력 전용 `ShapeInput` 영역을 갱신한다. 10Hz·8 CSS 픽셀 타일과 6픽셀 여유 영역을 사용하므로 외곽의 좁은 투명 여백은 조작 영역에 포함될 수 있다. 표시 영역은 자르지 않는다. 드래그 중에는 전체 입력 영역을 유지하고 resize·로드 오류·helper 실패 때도 조작 가능한 상태로 복구한다.

위치를 매번 창 왼쪽 위가 속한 화면의 안쪽으로 제한하던 구현은 모니터 이동과 하반신을 화면 밖으로 내보내는 배치를 막았다. 현재는 드래그·휠 조절·버튼 해제·재실행 모두 부분 표시 위치를 그대로 유지한다. 연결된 어떤 화면과도 전혀 겹치지 않는 창만 드래그 종료/재실행/모니터 제거 시 복구한다. 설정의 모니터 선택은 현재 창 위치와 가장 많이 겹치는 화면을 표시하며, 대상 화면으로 옮길 때 배율·가장자리 밖으로 내보낸 분량을 유지한다. 대화 adapter/session을 재설정하지 않는다. 항상 위·모든 작업공간 표시 동작은 유지한다.

`npm run build`는 Linux에서 `scripts/native/x11-input.c`를 C 컴파일러와 X11/Xext 개발 헤더로 빌드한다. main이 자기 창 ID와 PID를 고정해 helper를 시작하며 renderer는 제한된 사각형 목록만 보낼 수 있다. helper는 소유권·크기를 재검사하고 논리 좌표를 native 크기로 변환한다. 준비/실행 실패는 설정값을 보존한 채 클릭 통과를 미지원으로 표시한다. 별도 시스템 서비스나 Sway 설정 파일은 필요하지 않다.

설정은 OS 사용자 앱 데이터의 `settings.json`, 미종결 요청은 `pending-requests.json`이다. 앱 설정이 없는 첫 실행에는 ignored `local-assets/connection.json`을 읽는다. 개인 주소/실제 세션/키는 공개 저장소에 넣지 않는다. 인증키는 별도 암호화 저장이며 Linux `basic_text` 우회는 없다. 보호 저장소가 없으면 앱은 메모리에만 보관하며, 사용자가 직접 준비한 `.env`가 있으면 재실행 시 main에서 다시 읽는다. `.env`의 복원은 비밀정보 관리 범위로 별도 수행한다.

요청 메타데이터는 **네트워크 제출 전에 await하여 저장**한다. 저장 실패/손상된 미종결 상태를 빈 상태로 바꿔 새 요청을 보내지 않는다. 재시작 시 원래 요청을 조회하며 자동 재전송하지 않는다. endpoint 정규화와 selectionId/revision 검사가 전환 중 중복 제출·잘못된 이벤트/표현 적용을 막는다.

## 재현 명령

~~~sh
npm run format:check
npm run typecheck
npm test
npm run build
npm run test:desktop
# Linux X11이 있는 환경에서만: 자기 소유의 숨겨진 창으로 native protocol 검사
DISPLAY=:0 npm run test:x11
npm audit
~~~

기본 desktop 검사는 외부 AI 없이 실제 Electron/SDK/모델에 Mock 응답과 명시적 표현 fixture를 적용한다. `artifacts/desktop-smoke.json`, `live2d-smoke.png`, `chat-smoke.png`는 로컬 확인용이며 커밋하지 않는다. headless의 고정 viewport·software GPU는 Windows 합성/입력이나 실사용 성능 검증을 대체하지 않는다.

실제 공급자 검사는 준비한 로컬 연결 설정으로 `node scripts/smoke-desktop.mjs --smoke-hermes --jev-stdin`을 실행한다. 터미널 echo를 끈 stdin에서 키를 받아 자식 fd로만 전달하며 명령 인자·환경변수·파일에 평문 저장하지 않는다. 도구가 꺼진 전용 세션에서 인사만 요청한다. 실제 검사 결과는 로컬 `artifacts/desktop-live.json`에 원문/키/주소/세션 없이 기록한다.

사용자 `.env` 경로의 실제 시작 검사는 `node scripts/smoke-desktop.mjs --smoke-hermes --smoke-env`다. 기본 `test:desktop`은 `.env`를 읽거나 유료 Jev 호출을 하지 않는다.

## 확인 결과 (2026-10-31)

- TypeScript strict, Prettier 및 production build 통과. Unit/Contract 94개: 전송/SSE·SSH receipt/replay·코어 복구/lease·승인·저장 barrier·지연 판단·모델 경로·credential/endpoint 정규화·`.env` 입력·마스크 용량·입력 영역·드래그 배율·모니터 간 배치 검사. Electron smoke는 실제 form 제출, 모니터 선택 UI/알 수 없는 ID 거절/대화 대상 유지, 새 세션 생성/공급자 변경 뒤 이전 대화·승인 UI 제거도 검사한다.
- npm audit 취약점 0건. CI 자동 실행과 Windows 빌드는 아직 없다.
- 실제 Electron headless에서 모델 파라미터 509개와 440×680 WebGL 출력, 알파 0인 빈 모서리, renderer Node `require` 접근 불가 및 좁은 preload 브리지 확인.
- 사용자가 승인한 Hermes `default` 전용 새 테스트 세션에서 delta→최종 본문→원격 receipt 완료를 확인했다. 기존 대화에 테스트 메시지를 넣거나 원격 서비스를 재시작/변경하지 않았다. 새 SSH 클라이언트의 동일 요청 receipt 복구도 통과했다.
- 실제 Hermes 답변을 실제 Jev가 `happy/wave`로 판단하고 모델의 실제 표정/모션 파라미터 적용까지 확인했다. 관찰된 Jev 왕복은 188ms와 208ms였으며 평균/최악 지연 보장은 아니다.
- 별도 앱 프로세스 재실행과 같은 로컬 연결 설정 사용을 확인했다. 실제 OS 재부팅·재로그인·장치 재연결·Windows 클릭 통과·DPAPI/Secret Service 지속성은 검증하지 않았다.
- 사용자 `.env`(소유자 전용 권한 600)의 bare Jev 키로 별도 앱 프로세스를 두 차례 실행했다. 두 번 모두 stdin 입력 없이 `credentialSource=env-file`, 실제 Hermes 완료·실제 Jev 판단·모델 표정/모션 적용을 확인했다. 파일을 다시 읽는 앱 재시작 검증이며 OS 재부팅/재로그인 검증은 아니다.
- 마스크 수정 뒤 실제 Electron headless Mock 검사에서 49그룹/2버퍼, 표정 weight 1·gesture 활성과 정상 얼굴/머리/꼬리 출력을 확인했다. 모델 파라미터 적용과 이미지 확인을 각각 수행했다.
- 실제 SwayFX/Xwayland 앱에서 모델 창의 `override_redirect=1`, root 직속·viewable 상태를 확인했다. 기존 managed Overlay는 전체화면 아래에서 `visible=false`였으나 새 창은 별도 sticky 규칙 없이 표시됐다. 모든 작업공간 위에 남는 생성 구조는 확인했으며 실제 작업공간 전환·OS 재로그인/재부팅은 이 검사에서 수행하지 않았다.
- 실제 Sway 커서 이동 명령으로 빈 영역→모델 재진입 시 자기 창의 pointermove 수신을 확인했다. 자기 Overlay만 대상으로 XTest 버튼/이동/휠을 보내 pointerdown→capture→이동→왼쪽 버튼 유지 휠→release 순서와 native 위치·크기 변경을 확인했다. 물리 마우스 전체 시나리오 수락을 대체하지 않는다.
- 입력 helper만 강제 종료한 뒤 XShape 조회에서 모델 영역이 전체 사각형 1개로 복구됨을 확인했다. native protocol 검사는 화면에 표시하지 않는 자기 소유 창에서 좌표 확대·표시 영역 불변·빈 입력 영역·EOF 복구·잘못된 사각형/개수·PID/소유권 거절을 통과했다.
- 실제 앱 재실행 뒤 위치·배율·항상 위 생성 방식·native 입력 영역의 자동 재적용을 확인했다. Linux 앱 자동 시작은 추가하지 않았다. OS 재부팅·재로그인·모니터 재연결 및 실제 고 DPI는 검증하지 않았다.
- 실제 Sway의 가로·세로 모니터 2대에서 자기 창에 XTest 드래그를 보내 모니터 경계를 넘긴 뒤 위치를 유지함을 확인했다. 실제 설정의 모니터 목록에서 현재 화면이 바뀌고, ‘선택한 모니터로 이동’ 버튼으로 반대 화면에 이동함을 확인했다. 부분 표시 상태와 배율 2도 앱 재실행 뒤 화면 안으로 밀려나지 않고 복원됐다. 실제 모니터 분리/재연결은 수행하지 않았으며 빈 공간·음수 원점 배치와 완전 이탈 판단은 단위 검사로 구분한다.

근거는 같은 변경의 `tests/`, `scripts/smoke-desktop.mjs`, main의 smoke 결과 생성 코드와 실행 결과다. 모델/SDK·키·개인 대화는 증거 fixture로 커밋하지 않는다.

## 남은 작업

Windows 실제 Overlay/포커스/드래그/클릭 통과·고 DPI·보호 저장소, canonical Bot Chat 동일성, Grok callback 가능성, TTS/립싱크, 실서비스 취소/승인, 릴리스 패키징/라이선스 확인이 남아 있다.
