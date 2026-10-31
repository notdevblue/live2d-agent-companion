# 구현 및 검증 상태

**확인일:** 2026-10-31 · **버전:** 0.1.0-alpha.1 · **배포:** 로컬 개발용, Windows 릴리스 검증 전

## 구현 범위

사용자가 확정한 완료 흐름은 **DeepSeek-chan 표시 → 채팅 요청 → Hermes 실제 응답 → Jev 판단 → 모델 표정/모션**이다. 내부 모듈은 분리하지만 캐릭터 단독 PoC로 완료하지 않는다. 화면 캡처·PC 실행·TTS/립싱크는 구현하지 않았다.

| 항목 | 구현/실증 | 한계 |
|---|---|---|
| Electron | typed IPC, sender/mainFrame 검사, sandbox/contextIsolation, renderer 외부 네트워크 차단 | Windows 실제 창/입력 미검증 |
| UI/Live2D | 투명 Overlay, 모니터 이동·부분 표시·휠 배율, 로컬 actor의 시선/고개/몸 연기·표정 crossfade·paired 손 포즈, 강도/구도/배치 잠금/움직임 줄이기/미리보기 | Windows·실제 고 DPI·성능 수락 전. 마우스 시선 추적/쓰다듬기/TTS 없음 |
| Linux/Sway | Xwayland의 non-focusable Overlay, 입력 전용 XShape로 빈 영역 통과·모델 재진입, 실패 시 전체 입력 복구 | 현재 SwayFX 환경에서 실증. native Wayland 클릭 통과는 미지원 |
| Core | binding/turn/request 검사, dedupe, lease, reconciling, 승인/취소, 원문 없는 복원 | 원문 히스토리 영구 저장 안 함 |
| Hermes SSH | 기존 owner의 native control/ticket/WebSocket, 명시적 세션 선택, 전용 테스트 세션 실제 왕복·새 연결 receipt 복구 | canonical Bot Chat 미검증, 실제 진행 중 취소/승인은 계약 테스트만 |
| Hermes HTTP | Runs/SSE/상태/중단/승인/복구와 테스트 서버 왕복 | 원격 실증 전. API 소유 세션 전용 |
| Grok Bot | Webhook 인증 제출, 200→accepted/awaiting_result | 실계정 미실증, callback 미구현, 양방향 채팅 미지원 |
| Jev | 한 요청의 Choice emotion/gesture/선택적 attitude, 최대 800자 구간, 비동기 판단·deadline·confidence·stale gating | 한국어 인사 실증은 전체 품질 평가가 아님. attitude 품질과 transport 검증은 구분 |
| 인증키 | async safeStorage, 서버별 credential scope, 사용자 `.env` 시작 시 입력 | 현재 headless 환경은 보호 저장소 불가. 앱 보관은 메모리 전용이며 사용자 `.env`는 별도 유지 |

## 실행·복원 구조

후속 캐릭터 연기 구현(`FR-L2D-005~006`, `FR-DIR-004`, `FR-SET-003`): `acting.ts`는 결정적인 시선/blink와 시간 기반 damping, 생각·설명·쑥스러움·기쁨·장난·안심 반응 및 반복 억제를 담당한다. `performance.ts`는 범위/중립값/physics-output 검사, 표정 crossfade, authored pose의 진입/유지/복귀를 분리한다. `Avatar`는 DeepSeek의 `Angle*`/`Position*`/`LeanInput`을 구동한다. 이전 `ParamAngleZ` 직접 쓰기는 physics에 의해 0으로 덮였지만 현재는 upstream과 최종 출력 모두 변한다. 모든 모델이 같은 리깅을 제공한다고 가정하지 않고 없는/physics 출력인 채널은 생략한다.

표현 설정은 기존 설정 파일에 선택적 `presentation`으로 저장하고 이전 파일에는 기본값을 적용한다. 구도/강도/위치 잠금/움직임 줄이기만 바꾸면 adapter/session과 Overlay를 재생성하지 않는다. paired 손 pose는 1.5초 유지 후 대응 복귀 자산을 사용하며 손목/손가락 endpoint를 함께 보존한다. pose와 clip은 같은 경과 시간을 쓰고 physics의 bounded step과 분리해 느린 프레임의 단계 불일치를 피한다. 일반 사용자 gesture 매핑은 기존 단발 재생으로 fallback한다.

미리보기 IPC는 enum/sender/현재 요청·승인/switching 검사를 거친다. 늦은 character 이벤트가 승인 차단을 풀지 못하도록 renderer는 현재 turn에서 blocked 여부를 파생하고, 승인 종료 뒤 마지막 Director 상태를 복원한다. 이전 대상의 느린 connect는 selection별 pending token으로 격리한다. 자세한 조작은 README와 [상호작용 설계](../ux/INTERACTION_DESIGN.md#구현된-캐릭터-연기와-표현-설정)를 따른다.

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

- TypeScript strict, Prettier 및 production build 통과. Unit/Contract 118개: 기존 전송/SSE·SSH receipt/replay·복구/lease·승인·저장·지연 판단·모델 경로·인증 입력·렌더 용량·입력 영역·모니터 배치에 더해 actor의 30/60/120fps 일관성, 감정/태도·반복/만료/blocked, idle 호흡 주기·위상/강도·몸 반응, expression crossfade, upstream/range 선택, 전체 손 pose endpoint와 진입/유지/복귀, 표현 설정 마이그레이션/저장 검사를 포함한다.
- 기본 Electron Mock smoke에서 기존 form/모니터/세션 라우팅 외에 `presentationControls`, `previewSafety`, `lockedGesture`, `approvalBlocked`, `approvalResumed`, `pendingSelection` 모두 통과했다. 로컬 미리보기 후 첫 실제 cue의 표정 weight 1·pose 활성, 표현 설정 적용 시 renderer/selection/request/위치 유지, renderer reload 복원, 뒤늦은 character 이벤트의 승인 차단 유지, 이전 느린 connect와 새 선택의 pending token 격리를 검사했다. 고의로 잘못된 IPC를 보내는 거절 로그는 예상된 거절 경로 검사 결과다.
- 실제 DeepSeek의 로컬 연속 프레임에서 고개 physics 출력이 thinking 중 약 −3.64까지 변하고, 설명 포즈 유지 중 `Movement3=1`과 손목/손가락 endpoint가 보존되며 복귀 뒤 모두 중립으로 돌아오는 것을 확인했다. happy→홍조→땀은 240ms crossfade 가중치가 연속으로 이어졌다. `neutral/none + attitude=tease`도 실제 장난 눈과 고개 연기로 적용됐다. 30fps 간격 시뮬레이션 1,980 draw와 10fps 간격 60 draw를 검사했으며 실시간 GPU FPS 측정은 아니다. 로컬 비교 영상/이미지는 ignored `artifacts/motion-comparison/updated-motion.mp4`, `before-after.png`, 수치 근거는 `.tmp/motion-after/*traces.json`이다.
- idle 호흡은 actor의 4.8초 들숨/날숨, bodyY 반응과 canvas 내부 전체 모델 상하 offset을 합성한다. 사용자 피드백에 따라 첫 bodyY 호흡 폭을 2배로 키웠다. 실제 DeepSeek 8초/240 draw에서 `ParamBreath` 약 .188~.812, `PositionY` 약 −2.335~1.967 및 physics 뒤 몸 반응, clip 좌표 offset ±.0117을 확인하고 상반신 렌더 이미지를 검사했다. 강도/reduced motion·cue와 독립적인 위상·blocked 중립 회귀는 unit test로 검사했다. 참고 영상과 구현의 차이는 상호작용 설계의 추가 조사 절에 구분했다. 로컬 근거는 ignored `artifacts/motion-comparison/idle-breath-root.mp4`, `.tmp/motion-after/breath-traces.json`이다. 앱 재실행 뒤 사용자 배율·위치·표현 설정 유지도 확인했으며 OS 재부팅/재로그인 검증은 아니다.
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
