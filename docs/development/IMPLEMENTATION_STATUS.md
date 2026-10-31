# 구현 및 검증 상태

**확인일:** 2026-11-01 · **버전:** 0.1.0-alpha.1 · **배포:** 로컬 개발용, Windows 릴리스 검증 전

## 구현 범위

사용자가 확정한 완료 흐름은 **DeepSeek-chan 표시 → 채팅 요청 → Hermes 실제 응답 → Jev 판단 → 모델 표정/모션**이다. 내부 모듈은 분리하지만 캐릭터 단독 PoC로 완료하지 않는다. 화면 캡처·PC 실행·TTS/립싱크는 구현하지 않았다.

| 항목 | 구현/실증 | 한계 |
|---|---|---|
| Electron | typed IPC, sender/mainFrame 검사, sandbox/contextIsolation, renderer 외부 네트워크 차단 | Windows 실제 창/입력 미검증 |
| Chat | 직접 전송 시 하단 이동, 응답 하단 추적/과거 위치 유지, 실시간·복원 답변의 Markdown 문단/강조/목록/코드/표 | 링크는 이동 없는 표시, 이미지는 alt text. 코드 문법 강조 없음 |
| UI/Live2D | 투명 Overlay, 모니터 이동·부분 표시·휠 배율, 로컬 actor의 시선/고개/몸 연기·표정 crossfade·paired 손 포즈, 강도/구도/배치 잠금/움직임 줄이기/미리보기 | Windows·실제 고 DPI·성능 수락 전. 마우스 시선 추적/쓰다듬기/TTS 없음 |
| Linux/Sway | Xwayland의 non-focusable Overlay, 입력 전용 XShape로 빈 영역 통과·모델 재진입, 실패 시 전체 입력 복구 | 현재 SwayFX 환경에서 실증. native Wayland 클릭 통과는 미지원 |
| Core | binding/turn/request 검사, dedupe, lease, reconciling, 승인/취소, 원문 없는 복원 | 원문 히스토리 영구 저장 안 함 |
| Hermes SSH | 기존 owner의 native control/ticket/WebSocket, 명시적 세션 선택, 동일 세션 표시용 history 복원, 전용 테스트 세션 실제 왕복·새 연결 receipt 복구 | canonical Bot Chat 미검증, 실제 진행 중 취소/승인은 계약 테스트만 |
| Hermes HTTP | Runs/SSE/상태/중단/승인/복구와 테스트 서버 왕복 | 원격 실증 전. API 소유 세션 전용 |
| Grok Bot | Webhook 인증 제출, 200→accepted/awaiting_result | 실계정 미실증, callback 미구현, 양방향 채팅 미지원 |
| Jev | 메시지당 대표 Choice emotion/gesture/선택적 attitude 1회, 800자·요청당 8회·짧은 수집/판단 기한, 문장 재생 큐 없음 | 진행 응답의 빈도/감정 품질은 모델·작업에 따라 다름 |
| 인증키 | async safeStorage, 서버별 credential scope, 사용자 `.env` 시작 시 입력 | 현재 headless 환경은 보호 저장소 불가. 앱 보관은 메모리 전용이며 사용자 `.env`는 별도 유지 |

## 실행·복원 구조

후속 캐릭터 연기 구현(`FR-L2D-005~006`, `FR-DIR-004`, `FR-SET-003`): `acting.ts`는 결정적인 시선/단일·이중 blink와 시간 기반 damping, 감정·생각/설명 제스처의 조합, 반응별 시간 구조·제한된 변주 및 반복 억제를 담당한다. 좌우 눈·눈웃음·눈썹·볼/삐죽은 지원되는 upstream 얼굴 파라미터로 합성하며 로컬 미리보기는 초기화 포함 14종이다. `performance.ts`는 범위/중립값/physics-output 검사, 표정 crossfade, authored pose의 진입/유지/복귀를 분리한다. `Avatar`는 DeepSeek의 `Angle*`/`Position*`/`LeanInput`을 구동한다. 이전 `ParamAngleZ` 직접 쓰기는 physics에 의해 0으로 덮였지만 현재는 upstream과 최종 출력 모두 변한다. 모든 모델이 같은 리깅을 제공한다고 가정하지 않고 없는/physics 출력인 채널은 생략한다.

표현 설정은 기존 설정 파일에 선택적 `presentation`으로 저장하고 이전 파일에는 기본값을 적용한다. 구도/강도/위치 잠금/움직임 줄이기만 바꾸면 adapter/session과 Overlay를 재생성하지 않는다. paired 손 pose는 1.5초 유지 후 대응 복귀 자산을 사용하며 손목/손가락 endpoint를 함께 보존한다. pose와 clip은 같은 경과 시간을 쓰고 physics의 bounded step과 분리해 느린 프레임의 단계 불일치를 피한다. 일반 사용자 gesture 매핑은 기존 단발 재생으로 fallback한다.

미리보기 IPC는 enum/sender/현재 요청·승인/switching 검사를 거친다. 늦은 character 이벤트가 승인 차단을 풀지 못하도록 renderer는 현재 turn에서 blocked 여부를 파생하고, 승인 종료 뒤 마지막 Director 상태를 복원한다. 이전 대상의 느린 connect는 selection별 pending token으로 격리한다. 자세한 조작은 README와 [상호작용 설계](../ux/INTERACTION_DESIGN.md#구현된-캐릭터-연기와-표현-설정)를 따른다.

루트 [README](../../README.md)의 준비/실행 명령을 따른다. `local-assets/DeepSeek/`와 `vendor/`는 ignored이며 git clone만으로 자산이 준비되지 않는다. SDK는 공식 Framework 5-r.5 commit과 Core 5.3(`core/06`) 해시를 검사한다. 로컬 개발 사용과 배포 라이선스 검토는 구분한다.

사용자 ZIP에서 runtime만 추출하고, 누락된 `Exp3/`·`Animation/` 참조는 검증된 manifest에 보충한다. 원본 파일을 수정하지 않는다. 자산 URL은 선택 디렉터리의 의존 파일만 토큰으로 제공하며 symlink/traversal/외부 URL을 거절한다. 재선택 시 토큰은 폐기된다.

DeepSeek의 49개 마스크 그룹에 기본 버퍼 1개를 사용하면 SDK의 36그룹 용량을 초과해 얼굴·머리카락·꼬리가 오염됐다. SDK의 그룹 집계와 다중 버퍼 용량으로 버퍼 2개를 할당하고 POT 텍스처에는 mipmap 축소 필터를 적용한다. 원래 alpha 업로드를 공식 예제 방식과 동일 geometry에서 비교했을 때 픽셀 차이는 0이었다. 첫 gesture는 시작 후 1.6초 cooldown에 막히지 않도록 초기 시각을 분리했다.

Linux에서는 `DISPLAY`가 있고 backend를 명시하지 않았으면 X11을 선택한다. 항상 위 옵션을 켠 Overlay만 생성 시 `focusable: false`를 사용하며 chat은 포커스 가능한 관리되는 `dialog` 창이다. 기본 normal 창이 Sway에서 tiled로 열리던 원인을 생성 시 Linux `type: dialog` 지정으로 해결해 자동 floating 처리한다. Linux에서 해당 옵션을 바꾸면 Overlay만 재생성한다. Sway의 일회성 floating/sticky 명령이나 사용자 전체화면 해제로 해결하지 않는다.

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

실제 공급자 검사는 준비한 로컬 연결 설정으로 `node scripts/smoke-desktop.mjs --smoke-hermes --jev-stdin`을 실행한다. 터미널 echo를 끈 stdin에서 키를 받아 자식 fd로만 전달하며 명령 인자·환경변수·파일에 평문 저장하지 않는다. 전용 테스트 세션 제목을 검증한 뒤 인사만 요청한다. 현재 실사용 일반 연결을 그대로 지정하면 제출 전에 거절한다. 도구 구성이 완전히 비었다고 가정하지 않는다. 실제 검사 결과는 로컬 `artifacts/desktop-live.json`에 원문/키/주소/세션 없이 기록한다.

사용자 `.env` 경로의 실제 시작 검사는 `node scripts/smoke-desktop.mjs --smoke-hermes --smoke-env`다. 기본 `test:desktop`은 `.env`를 읽거나 유료 Jev 호출을 하지 않는다.

## 확인 결과 (2026-11-01)

- `FR-DIR-005`: 진행 응답이 neutral/none이면 actor의 reaction도 idle과 같은 중립 파형이어서 변화가 거의 보이지 않던 원인을 수정했다. 사용자가 제시한 진행 문장을 실제 Jev로 한 번 평가해 neutral/none/neutral, confidence .98을 확인했으며 당시 요청의 저장된 판단 결과를 복원한 것은 아니다. 메시지 ID가 있는 중립 cue에 1.8초의 작은 끄덕임·교대 기울임을 넣고 감정·웃음·손 포즈와 호흡 offset은 바꾸지 않았다. 기본 중립 상태와 로컬 메시지 반응을 분리해 과거 history/snapshot은 재생하지 않고 동일 ID·승인 차단·자연 종료·30/60/120fps·reduced motion을 검사했다. 실제 DeepSeek/SDK의 같은 clock idle 비교에서 upstream AngleY 차이 최대 약 3.35, physics 뒤 ParamAngleY 차이 약 3.56을 확인했고 손 selector는 0·pose none·종료 뒤 중립이었다. 근거는 `tests/acting.test.ts`, `avatar.test.ts`와 ignored `.tmp/neutral-reaction/judge-result.json`, `model-result.json`이다. 외부 Hermes 작업 재전송 없이 예문 Jev 평가 1회와 로컬 모델만 검사했다. 모델 canvas 이미지도 비교했으며 전체 단위/계약 검사 178개·typecheck·format·build·Electron Mock 검사가 통과했다. 일반 앱을 최신 build로 재실행해 설정·위치 보존과 프로세스 실행을 확인했다. OS 재부팅/재로그인은 하지 않았다.

- `FR-DIR-004`: Jev가 설명을 넓게 선택하던 Choice 기준과, `gesture=none`을 설명 말투만으로 손 포즈로 승격하던 renderer 경로를 수정했다. 일반 답변/진행 보고는 none을 기본으로, 명확한 시연·교육 강조만 explain 후보로 두며 말투와 물리 제스처를 분리한다. 실제 Jev에 같은 한국어 예문 6개를 전후 각 한 번씩 평가했다. 수정 전 진행/결과/사실 답변 3개 모두 explain이었으나 수정 후 확인/진행/결과/사실 4개는 모두 none이었다. 직접 예제로 대조하며 가르치는 예문은 explain을 유지했고 일반 단계 안내는 확신 부족으로 none이었다. 표본별 단발 결과이며 전체 한국어 정확도/비율 보장은 아니다. 원문 대화 대신 합성 예문만 사용했으며 Hermes 제출/세션 변경은 없었다. 근거는 ignored `.tmp/explain-check/before-result.json`, `after-result.json`이다. 실제 DeepSeek/SDK fixture에서도 일반 예문과 설명 말투만 있는 입력의 손 selector가 0/pose none, 명시적 설명 제스처는 selector 1/pose 활성임을 확인했다(`.tmp/explain-check/model-result.json`). 전체 검사 175개·typecheck·format·build·Electron Mock 검사가 통과했고 최신 앱을 재실행해 기존 설정·위치 보존과 프로세스 실행을 확인했다. OS 재부팅/재로그인은 하지 않았다.

- `FR-DIR-005`: streaming도 thinking으로 매핑하고 도구 상태 변화가 actor reaction·표정 mixer·paired pose를 초기화하던 경로를 수정했다. streaming은 도구 작업이 없으면 idle, 같은 요청의 배경 상태 변화는 메시지 반응을 보존하고 반응 중 생각 포즈와의 합성을 멈춘다. 새 요청 경계는 renderer에서 명시적으로 reset하며 승인/복구/취소/오류는 계속 즉시 정리한다. 단위 검사는 메시지 연기 중 상태 변화 전후 동일 궤적과 자연 종료 뒤 최신 working 복귀를 비교한다. 실제 DeepSeek/SDK 로컬 fixture에서도 thinking→메시지 explain 손 포즈→working→thinking→idle 전환의 포즈/표정 유지, 자연 복귀와 승인 차단 즉시 정리, 짧은 놀람 뒤 긴 손 복귀 동작 완주를 확인했다. 사용자 thinking 자산은 메시지 도착 시 교체되고 이전 대기 clip의 cooldown이 실제 제스처를 막지 않는다. 근거는 `tests/avatar.test.ts`, `acting.test.ts`, `director.test.ts`와 ignored `.tmp/request-recovery/motion-result.json`이다.

- `FR-AG-012`/`AC-02`/`E-019`: 30초 무이벤트 뒤 타이머를 지우고 수동 조회만 기다리던 원인을 수정했다. 원래 요청의 자동 조회·재시작 복원, 미확인 최초+5회 backoff, 진행 확인 시 감시 재개와 승인 만료의 별도 처리를 추가했다. 이벤트 replay가 만료돼도 receipt로 진행을 확인하며 snapshot의 살아 있는 승인도 복원한다. 중복/낡은 요청 조회·dispose 뒤 타이머·원격 terminal 증거 없는 lease 해제를 회귀 검사했다.
- 실제 미수신 요청의 원격 receipt는 이미 completed였으며 최종 본문 886자가 남아 있었다. 같은 binding/request/admission 메타데이터로 별도 클라이언트의 `restore`만 호출해 자동 완료 복구를 확인했다. 실제 RPC는 `session.resume`, `prompt.receipt` 각 1회이며 새 prompt·중단·승인·Jev 호출은 0회다. 복구 본문을 snapshot으로 먼저 적용해 과거 모션을 재생하지 않는다. 비공개 근거는 ignored `.tmp/request-recovery/automatic-result.json`이며 본문·주소·ID는 기록하지 않는다. 실제 Sway 앱을 재실행해 같은 default 세션의 최종 답변이 history에 정확히 1개, 알림 없음·전송 가능·모델 로드 상태이며 기존 설정/위치가 유지됨을 확인했다. 이 검증은 새 prompt/도구 실행 없이 수행했고 OS 재부팅/재로그인은 하지 않았다.

- 이 변경의 `typecheck`, `format:check`, 전체 단위/계약 검사 174개, production build와 외부 AI 없는 Electron Mock desktop 검사를 통과했다. 검증 후 일반 앱을 최신 build로 재실행하고 선택 세션·표현 설정·배율·최신 위치 유지와 프로세스 실행을 확인했다.

## 이전 확인 결과 (2026-10-31)

- Hermes의 공개 중간 응답을 합치던 원인을 native `message.delta {text:null}` 경계와 비스트리밍 `message.interim` 처리로 수정했다. TurnView/messages와 메모리 history·renderer는 requestId+messageId로 말풍선을 나누며, 중간 message.complete는 요청 완료를 뜻하지 않는다. 앱의 prompt.submit에만 api_text 진행 보고 안내를 넣고 원래 transcript user text·프로필/서비스 설정은 보존한다. 같은 title의 session.create가 기존 제한 세션을 재사용한다는 원인도 확인해 명시적인 새 대화는 고유 제목을 사용한다.
- 실제 default의 독립 테스트 세션에서 read_file 두 단계(/etc/os-release, /proc/version) → 중간 응답 2개와 최종 답변 1개 → 서로 다른 messageId 3개·Jev 판단 1회씩을 확인했다. 응답 종료 후 추가 문장 큐가 재생되지 않았고 일반 앱의 선택 세션은 바꾸지 않았다. 별도 SSH 조회에서도 user 1/assistant 3개를 복원했다. 기존 bridge가 공개 display_commentary를 빠뜨리던 경로는 공개 문자열만 펼치는 방식으로 수정해 중간 응답도 재실행 후 보이게 했다. 최초 검사는 기존 테스트 title이 x_search 전용 세션을 재사용해 파일 도구가 없어 성립하지 않았으며, 고유 제목의 새 세션에서 다시 검증했다. 원문/키/실제 ID 대신 event 시각·메시지 순번·도구명/판단 enum만 ignored `.tmp/progress-check/result.json`에 기록한다. 모델의 진행 보고 빈도 보장은 아니다.
- 별도 Electron fixture는 중간/최종 bubble 복원·반복 snapshot 중복 없음·지난 기록 스크롤 유지·하단 추적과 외부 HTTP 0회를 확인했다. 단위/계약 검사는 단일 메시지의 여러 문장=판단 1회, 새 메시지 즉시 전환/취소, null/interim 경계와 복구·원격 sidecar 제거·고유 제목을 검사한다. 근거는 `tests/director.test.ts`, `core.test.ts`, `adapters-ssh.test.ts`, `history.test.ts`, `assistant-messages.test.ts`와 ignored `.tmp/progress-check/`, `.tmp/chat-layout/messages-*`다.

- `FR-UI-002/FR-CHAT-002`: user bubble 추가 때 scrollTop을 바꾸지 않아 전송 후 아래로 내려가지 않던 원인을 수정했다. 전송은 하단으로 이동하고 assistant 갱신 전 하단 32px 이내였을 때만 계속 따라간다. Markdown은 `markdown-it` 15.0.3 token을 allowlist DOM으로 구성하며 사용자 입력·history 원본은 바꾸지 않는다. 굵게/목록/fence/table·부분 fence 교체, HTML/위험 URL·이미지 미실행과 스크롤 정책 6개 검사를 추가했다. 실제 Electron fixture의 470×810·400×600·640×900·125% 확대에서 전송/응답 추적, 과거 읽기 위치 유지, 긴 코드의 내부 가로 스크롤, footer 표시와 외부 HTTP 요청 0회를 확인했다. 실제 Sway 새 앱 프로세스의 기존 default 기록 14개(user 7/assistant 7)가 창 reload/재생성 뒤 같은 순서·역할로 복원되고 표 3개/strong 17개가 렌더링되며 활성 링크/이미지/script/iframe 0개임을 확인했다. 실제 대화 원문은 증거 파일에 저장하지 않는다. 근거는 ignored `.tmp/chat-layout/markdown-*`다.
- `FR-DIR-005`: 사용자 피드백에 따라 답변 종료 뒤 밀리던 문장별 표현 큐/1.8초 유지 대기를 제거했다. assistant 메시지 하나당 대표 판단 한 번, 최대 800자·요청당 8회·짧은 prefix 수집(350ms)/판단 기한·2초 나이 상한을 적용한다. 새 메시지는 이전 미적용 판단을 취소하고 renderer도 이전 애니메이션 종료를 기다리지 않는다. 같은 messageId 중복/복구 텍스트는 재판단하지 않는다. 400ms 간격의 서로 다른 실제 DeepSeek 메시지 cue 세 개가 모두 수락되는 것을 별도 로컬 모델 검사로 확인했다. 새 동작은 이전 sentence 큐 설계를 대체한다. 별도 앱 프로세스 재실행에서 같은 default 일반 세션·최신 위치/배율/표현 설정 보존을 확인했으며 실제 OS 재부팅/재로그인은 수행하지 않았다.

- `FR-UI-002`: textarea의 바깥 focus outline이 간격 없는 전송 버튼과 5px 겹치는 원인을 재현했다. composer의 focus-within 경계와 10px gap·축소 가능한 textarea/고정 40px 버튼으로 변경하고, conversation의 flex 최소 높이·독립 스크롤과 답변 오른쪽/마지막 메시지 아래 이중 여백을 조정했다. 실제 Electron의 로컬 긴 대화 fixture를 470×810·400×600·640×900 및 125% 확대에 렌더해 포커스/버튼 분리·body/대화 가로 overflow 없음·footer 표시·스크롤 하단 도달을 확인했다. 실제 Sway 앱 새 프로세스·창 재생성에서도 10px 간격·40px 버튼·mint composer 포커스·가로 잘림 없음과 기존 history/session·배율/표현 설정 보존을 확인했다. 확인 중 위치 저장값이 바뀌어 이전 값으로 되돌리지 않고 최신 저장 위치로 일반 앱을 다시 실행했다. 이미지를 육안 확인했고 수치/이미지 근거는 ignored `.tmp/chat-layout/`에 둔다. 기존 TypeScript/Prettier·build·Mock desktop 검사도 통과했다. OS 재부팅/재로그인은 수행하지 않았다.

- `FR-CHAT-001`: 동일 default SSH 세션에서 실제 기록 8개(user 4/assistant 4)를 read-only로 읽고 native 채팅 DOM과 순서/본문이 일치함을 확인했다. renderer reload·창 닫기/재열기에서도 8개가 중복 없이 복원됐다. 원문은 출력/증거 파일/로컬 대화 파일에 저장하지 않고 역할 수·일치 여부만 ignored `.tmp/history-check/`에 기록했다. Mock desktop의 창 reload/재열기·세션 전환 후 복귀와 history/adapter/host 필터 회귀 검사를 추가했다. 별도 앱 프로세스를 다시 실행해 같은 기록의 본문/순서·default session과 기존 위치/배율/표현 설정도 복원됨을 확인했다. 새 prompt·도구·Jev 호출과 OS 재부팅/재로그인은 수행하지 않았다.

- TypeScript strict, Prettier 및 production build 통과. Unit/Contract 161개: 기존 전송/SSE·SSH receipt/replay·복구/lease·승인·저장·지연 판단·모델 경로·인증 입력·렌더 용량·입력 영역·모니터 배치에 더해 actor의 30/60/120fps 일관성, 감정/태도·반복/만료/blocked, idle 호흡 주기·위상/강도·몸 반응, expression crossfade, upstream/range 선택, 전체 손 pose endpoint와 진입/유지/복귀, 표현 설정 마이그레이션/저장 검사를 포함한다.
- 사용자 지시로 default의 테스트 연결을 프로필 설정 기반 일반 대화로 전환했다. 기존 생성 코드가 `toolsets: []`를 넣어 파일/터미널이 누락됐고, 기존 세션에는 실제로 x_search 3개만 있었다. 일반 `session.create`에서 toolsets override를 제거하고 제목/버튼을 일반 대화로 변경했다. 원격 메타데이터에서 file/terminal/memory 등을 포함한 최초 tool_count 20을 확인했으며 실제 앱을 통한 `read_file`의 `/etc/os-release` 조회→최종 답변을 확인했다. 도구 이름·완료 상태만 로컬 `.tmp/hermes-session-check/connect-result.json`에 기록하고 키/주소/세션 ID·원문은 공개하지 않는다. 기존 Discord 세션이나 canonical Bot Chat에 이어 붙였다는 의미는 아니다. 일반 대화 ID를 앱 설정과 ignored bootstrap에 저장하고 프로필/배치 설정을 보존했다. 관련 계약 테스트는 toolsets 미지정과 profile 추종을 검사하고 공급자 smoke에는 일반 대화 제출 방지 guard를 추가했다. 별도 앱 프로세스 재실행에서 default/동일 일반 session ID·연결 오류 없음과 bootstrap 일치, 기존 배치·배율·표현 설정 보존을 확인했다. 일반 연결의 공급자 smoke가 제출 전에 exit 1로 거절되는 것도 확인했다. OS 재부팅/재로그인은 수행하지 않았다.
- 팝업을 현재 사용자 Yuru rice와 같은 배경/면·크림 글자·민트 강조·버건디 경계/직각 컨트롤로 변경했다. 실제 palette/설치 GTK/Sway 설정과 대조했고 한영은 현재 브라우저와 같은 Sarasa Mono K를 사용한다(미설치 fallback 포함). renderer `style.css`의 변수와 main의 chat `backgroundColor`로 첫 paint까지 적용하며 다른 OS 설정이나 모델 자산은 변경하지 않는다. dark scheme은 chat에만 한정한다. 기본 Mock desktop·빌드·Prettier/TypeScript 검사를 통과했고 대화/설정/캐릭터 화면 이미지, 470×810 및 400×600의 수평 overflow 없음·직각/색/폰트 계산값을 확인했다. 근거는 ignored `.tmp/yuru-popup/`의 화면/`styles.json` 및 `artifacts/desktop-smoke.json`이다. 실제 Sway 새 앱 프로세스·팝업 재열기에서 색/폰트/직각·floating과 Overlay root/배경 투명 유지, 사용자 배치 보존을 확인했다. 일반 앱으로 재실행했으며 OS 재부팅/재로그인은 수행하지 않았다. 테마는 저장된 앱 CSS로 복원되고 rice 팔레트 자동 동기화는 아니다.
- 제작자 Cobalt/Laimu/Usagi 공개 영상의 연속 프레임을 조사해 얼굴·시선·고개·손의 조합을 우선했다. 상세 타임스탬프·관찰과 추론·후속 항목은 [상호작용 설계](../ux/INTERACTION_DESIGN.md#추가-조사-얼굴시선고개손을-겹치는-버튜버-연기)에 정리했다. 단안 윙크는 자료에서 확정한 관찰이 아니라 제품 연출 제안이다.
- 버튜버 연기 추가 후 Unit/Contract 132개와 기본 Mock desktop 통과. 14종 미리보기의 enum/실제 버튼·요청/승인 차단을 검사하고, 얼굴 helper는 실제 범위/중립값·좌우 독립·alias·physics 출력/자산 소유권 제외를 검사했다. happy+thinking의 감정 얼굴 보존·생각 시선 합성, 단안 윙크/복귀·볼/삐죽·고개 단발 accent, 놀람의 짧은 수명, 모든 신규 얼굴 채널의 30/60/120fps 일관성과 reduced motion/blocked 정리를 검증했다. 새 Jev 질문/호출·상하 offset 증가는 없다.
- 실제 DeepSeek headless에서 수정 전 990 draw/수정 후 1,980 draw를 30fps 시간 간격으로 비교했다. 0.7초 윙크의 좌/우 눈은 약 0.00225/1, 볼 입력은 최대 0.455, 삐죽 입력은 0.4225였다. 감정 smile 약 0.849를 유지하면서 mixed-thinking의 눈 시선 X는 약 −0.057→0.098, upstream AngleZ는 −0.944→−2.978로 달라졌다. expression→physics 순서 수정 뒤 놀람의 downstream `ParamBrowLY2`는 기존 0에서 약 −0.251~0.325로 반응하고 2.4초에는 표정 weight가 0으로 정리됐다. 강아지풀은 enter/hold/exit/none을 거쳐 Movement1이 1→0으로 복귀했다. root offset 최대 ±0.002925는 유지됐다. 얼굴·하트 눈·손 포즈 출력 이미지도 확인했으며, 실시간 GPU FPS/CPU 측정이나 TTS 동기 검증은 아니다.
- 로컬 시각 근거는 ignored `artifacts/motion-comparison/vtuber-v2-preview.jpg`, `vtuber-v2-showcase.mp4`(10fps로 추출한 55초 무음 모션 확인 영상), 수치/수정 전 비교는 `.tmp/vtuber-v2/{before,after}/traces.json`, `summary.json`이다. 모델/SDK/외부 제작자 영상은 커밋하지 않았다.
- 실제 Sway 앱 새 프로세스에서 14개 미리보기 버튼과 wink/pout/grass 적용·reset, 닫고 다시 연 창의 floating을 확인했다. 사용자 위치·배율·표현 설정·항상 위는 보존했고 일반 앱으로 다시 실행했다. 로컬 근거는 `.tmp/vtuber-v2/native-*.json`이다. OS 재부팅/재로그인과 외부 Hermes/Jev 호출은 이번 검사에서 수행하지 않았다.
- 기본 매핑에는 기쁨/슬픔/부끄러움/걱정과 손 들기/설명만 있었으며, 생각·놀람은 빈 선택으로 표시되고 생각 미리보기/상태 진입은 사용자 모션 매핑을 읽지 않았다. `@companion/thinking`/`@companion/surprised` 로컬 선택지를 추가하고 기존 actor·범위 기반 expression mixer를 재사용했다. 생각 미리보기/대기 진입/gesture가 같은 매핑을 사용하며 자산 인벤토리 23표정/8모션에는 가상 파일을 끼워 넣지 않는다. ModelLibrary/복원·범위 검사와 Mock desktop `mappingCoverage`가 기본 선택·사용자 생각 자산의 미리보기/상태 적용·로컬 선택 저장 및 renderer 재로딩·놀람 실제 expression 적용을 검사한다. 이전 사용자의 명시적 빈 선택과 유효 자산 연결은 보존한다. 로컬 `artifacts/surprised-smoke.png`로 모델 출력도 확인했다. 실제 Sway 앱을 새 프로세스로 실행해 모든 선택 행과 생각 미리보기의 `preset=thinking`·기본 연기 활성, 창 재열기의 floating 유지, 사용자 위치·배율·표현 설정·항상 위 보존을 확인했다. 근거는 ignored `.tmp/mapping-check-*.json`이다. 일반 앱으로 다시 실행했으며 OS 재부팅/재로그인은 수행하지 않았다. 외부 Hermes/Jev 호출은 이번 변경에서 수행하지 않았다.
- 채팅·설정 창 변경 후 실제 Sway/Xwayland 앱을 새 프로세스로 실행하고 창을 닫았다 다시 열어 두 번 모두 `floating=true`, `_NET_WM_WINDOW_TYPE_DIALOG`, `modal=false`를 확인했다. 앱 생성 코드에서 매번 지정하므로 별도 Sway 규칙·서비스가 필요하지 않다. OS 재부팅/재로그인 및 Windows 창 동작은 이번 검사에서 검증하지 않았다. 로컬 근거는 ignored `.tmp/floating-check-*.json`이다.
- DeepSeek 표정 23개·모션 8개의 표시 별칭을 추가했다. 의미 미확인 `脱捕`는 원문 병기, 알 수 없는 자산 이름은 원문 fallback이다. 기본 desktop smoke의 `localizedMaps`와 실제 창에서 ‘홍조’/‘검지 포즈 시작’ 표시, tooltip 원문 및 option의 원래 ID 보존을 확인했다. 파일 이름이나 기존 매핑은 바꾸지 않았다.
- 기본 Electron Mock smoke에서 기존 form/모니터/세션 라우팅 외에 `presentationControls`, `previewSafety`, `lockedGesture`, `approvalBlocked`, `approvalResumed`, `pendingSelection` 모두 통과했다. 로컬 미리보기 후 첫 실제 cue의 표정 weight 1·pose 활성, 표현 설정 적용 시 renderer/selection/request/위치 유지, renderer reload 복원, 뒤늦은 character 이벤트의 승인 차단 유지, 이전 느린 connect와 새 선택의 pending token 격리를 검사했다. 고의로 잘못된 IPC를 보내는 거절 로그는 예상된 거절 경로 검사 결과다.
- 실제 DeepSeek의 로컬 연속 프레임에서 고개 physics 출력이 thinking 중 약 −3.64까지 변하고, 설명 포즈 유지 중 `Movement3=1`과 손목/손가락 endpoint가 보존되며 복귀 뒤 모두 중립으로 돌아오는 것을 확인했다. happy→홍조→땀은 240ms crossfade 가중치가 연속으로 이어졌다. `neutral/none + attitude=tease`도 실제 장난 눈과 고개 연기로 적용됐다. 30fps 간격 시뮬레이션 1,980 draw와 10fps 간격 60 draw를 검사했으며 실시간 GPU FPS 측정은 아니다. 로컬 비교 영상/이미지는 ignored `artifacts/motion-comparison/updated-motion.mp4`, `before-after.png`, 수치 근거는 `.tmp/motion-after/*traces.json`이다.
- idle 호흡은 actor의 4.8초 들숨/날숨, bodyY 반응과 canvas 내부 전체 모델 상하 offset을 합성한다. 사용자 피드백에 따라 첫 bodyY 호흡 폭을 2배로 키웠다. 실제 DeepSeek 8초/240 draw에서 `ParamBreath` 약 .188~.812, `PositionY` 약 −2.335~1.967 및 physics 뒤 몸 반응, 초기 clip 좌표 offset ±.0117을 확인하고 상반신 렌더 이미지를 검사했다. 사용자의 과도한 상하 이동 피드백에 따라 전체 offset만 1/4(기본 연출 ±.002925, 4배 창에서 약 ±4 CSS px)로 줄였고 몸통 호흡은 유지했다. 강도/reduced motion·cue와 독립적인 위상·blocked 중립 회귀와 새 offset 한도는 unit test로 검사했다. 참고 영상과 구현의 차이는 상호작용 설계의 추가 조사 절에 구분했다. 초기 offset의 로컬 시각 근거는 ignored `artifacts/motion-comparison/idle-breath-root.mp4`, `.tmp/motion-after/breath-traces.json`이다. 앱 재실행 뒤 사용자 배율·위치·표현 설정 유지도 확인했으며 OS 재부팅/재로그인 검증은 아니다.
- 크기 상한을 기존 2배에서 4배로 올렸다. 설정 검증·설정 슬라이더·드래그 휠은 같은 범위(0.4~4배)를 사용한다. 높은 DPI에서 큰 창의 framebuffer가 기존 16,777,216픽셀/readback·GPU dimension 한도를 넘으면 내부 canvas 해상도만 낮추며 logical 창 크기와 입력 좌표는 유지한다. 실제 Sway 앱에서 4배(1760×2720) 저장·렌더와 native-shape 모드, 대화 selection/request 유지 및 이전 크기 복귀를 확인했다. DPI/GPU 한도 조합은 순수 함수 검사이며 실제 고 DPI 장치 검증은 아니다. 검증 후 사용자 위치·기존 배율을 유지한 일반 앱으로 재실행했다. 근거는 ignored `.tmp/scale-native-result.json`이다.
- attitude Choice 추가 후 기존에 허용된 Hermes 테스트 세션에서 `.env` 입력으로 실제 한국어 왕복·Jev 판단·새 actor의 happy/손 pose 적용을 다시 확인했다. 관찰된 Jev 왕복은 220ms 한 번이며 전체 지연이나 한국어 attitude 품질 보장은 아니다. 기존 provider 기억·canonical Bot Chat 연속성을 새로 검증한 결과도 아니다.
- 실제 Sway/Xwayland 앱 프로세스에서 조용함/상반신/배치 잠금/움직임 줄이기를 저장하고, 별도 앱 프로세스로 재실행해 네 필드와 기존 위치·크기 복원을 확인했다. 표현 설정 저장은 selection/request를 유지했고 실제 로컬 shy 미리보기도 확인했다. 검증 후 기존과 같은 기본 연출/전신/잠금 해제/움직임 줄이기 해제로 되돌리고 일반 앱으로 다시 실행했다. 사용자가 정한 부분 오프스크린 위치·배율과 항상 위는 유지했다. 실제 OS 재부팅/재로그인은 수행하지 않았다.
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
