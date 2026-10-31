# 보안·개인정보·권한 모델

**상태:** Proposed, 모든 단계의 필수 기준.

## 신뢰 경계

1. 에이전트 출력은 **데이터**다. 텍스트가 PC 도구를 실행할 권한을 부여하지 않는다.
2. Electron renderer는 **untrusted UI surface**로 보고 Node/쉘/자격증명 접근 차단.
3. Grok/Hermes/TTS의 네트워크 응답과 Grok Callback은 미검증 입력으로 취급.
4. 사용자 승인(authority)은 main의 PermissionBroker만 발행·검증.
5. 공급자 도구 승인과 로컬 OS 입력 승인은 별도이며 서로 대체할 수 없다.
6. Jev는 표현 판단 전용 외부 수신자다. 사용자가 켠 경우 현재 사용자 요청(최대 1600자)을 문맥으로, 표시용 assistant 답변 구간(최대 800자)을 판단 대상으로 구분해 전송하며 기억/이력·도구 입출력·reasoning·인증키·모델 자산은 state에 넣지 않는다. 판단은 허용된 캐릭터 표정/제스처로만 매핑하며 PC 실행 권한을 발행하지 않는다.

사용자 명시 지시(2026-11-01)에 따라 답변 전용 Jev 입력을 현재 요청+해당 답변으로 확장했다([ADR-0004](../planning/adrs/0004-integrated-companion-and-jev.md)). 요청 문맥은 Director의 현재 request 메모리에만 두고 취소/새 요청/선택 해제 시 정리한다. 사용자 감정을 그대로 캐릭터에 옮기거나 사용자 텍스트를 모션 명령으로 실행하지 않는다.

현재 초기 구현은 화면 캡처/PC 실행 IPC 자체를 제공하지 않는다. 인증키는 main의 async safeStorage로 보호하며 Linux의 `basic_text` 또는 암호화 불가 상태에서는 디스크 저장 없이 메모리만 사용한다. SSH 일회성 gateway ticket은 원격 프로세스 메모리에만 두고 로컬에는 전달하지 않는다.

Linux X11 Overlay의 입력 영역 helper는 main이 가진 자기 창의 native handle과 PID로만 시작한다. renderer는 창 ID·명령·외부 경로를 지정할 수 없고 자기 창 크기 안의 제한된 사각형 목록만 전달한다. helper는 PID와 창 소유를 확인하고 `ShapeInput`만 갱신한다. 자기 WebGL canvas의 알파를 로컬 입력 영역 계산에 사용하는 기능이며 데스크톱 화면·다른 앱 촬영이나 외부 전송은 수행하지 않는다. 실패 시 클릭 통과를 미지원으로 표시하고 캐릭터를 조작할 수 있는 입력 상태로 복구한다.

사용자 명시 선택(2026-10-31)에 따라 root `.env`를 Jev 키 입력원으로 지원한다. 앱이 평문 파일을 생성하거나 비밀을 `process.env`에 적재하지 않는다. 소유자/권한/파일 종류/크기를 검증하고 Unix의 공유 권한·symlink는 거절한다. 시작 시 `.env` 값이 vault보다 우선하며 renderer에는 키 유무만 전달한다. 이 명시적 파일 입력 예외가 일반 로그·소스·프롬프트·비밀 환경변수 금지 원칙을 완화하지 않는다.

## 권한 등급

표시용 채팅 복원은 선택한 Hermes SSH session의 `session.history` projection에서 `user/assistant`의 일반 `text` 또는 공개 display projection의 본문과 행 ID만 원격 host에서 추출한다. `display_commentary`의 공개 문자열과 `display_content`만 일반 본문으로 정제하며 raw codex items/내부 추론을 허용하지 않는다. system/tool·reasoning/detail sidecar·도구 인수/결과·첨부 데이터·display metadata는 SSH 경계를 넘기지 않는다. 본문은 main과 채팅 renderer의 메모리에서만 보관하며 Overlay의 history bootstrap에는 포함하지 않는다. 파일 로그/진단/저장소나 Jev에 이력을 복제하지 않고, 과거 메시지를 실행 권한으로 해석하지 않는다.

| 위험 | 예시 | 기본 정책 |
|---|---|---|
| R0 | 캐릭터 애니메이션, 대화 UI 표시 | 허용 |
| R1 | 지정 창 정보 보기/캡처 | 명시적 범위 선택 + 미리보기 + 전송 승인 |
| R2 | 클릭, 스크롤, 제한된 타이핑 | 요청별 단기 승인, 대상 창 고정 |
| R3 | 파일 쓰기/삭제, 터미널 실행, 외부 메시지 발송 | 명확한 영향 요약, 별도 강한 승인 또는 초기 차단 |
| R4 | 자격증명 접근, 결제, 보안 설정 변경, 광범위한 삭제 | 기본 차단, 별도 정책/사용자 직접 수행 |

승인 정보에는 subject(connection+agent+session+turn), action, target/window, TTL, one-shot 사용 여부를 포함한다. 타겟 창/범위가 달라지면 기존 승인은 무효.

## 위협과 대응

- **Prompt injection**: 외부 텍스트/웹 페이지/스크린샷에 포함된 명령은 사용자 승인으로 승격하지 않는다.
- **Exfiltration**: 캡처 미리보기, 대상 공급자 표시, 전송 데이터 최소화. HTTP 목적지 allowlist/설정 검증.
- **Callback spoofing**: 별도 고엔트로피 인증 비밀, 요청 nonce, request_id/turn binding, 만료, replay 체크, 사이즈·rate-limit.
- **Token disclosure**: 환경변수/파일/콘솔 출력 회피, OS protected store, 에러 메시지 redact.
- **Electron RCE**: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, CSP, 외부 링크 검증, 최소 IPC.
- **Clickjacking/approval confusion**: 승인 창은 클릭 통과 불가, 최소한의 target+행동/시각/공급자 표시, 앱 포커스 확보.
- **Cross-agent leak**: 공급자·봇·세션 경계와 별도 저장/토큰/이벤트 라우팅.
- **Replay/duplicate run**: webhook 반복 실행·재요청 위험을 사용자에게 고지, 자동 재시도 제한.

## Hermes 진행 보고 안내

Hermes의 진행 보고 안내는 이 앱이 제출하는 admission의 `api_text`에만 원래 user text와 함께 들어간다. 별도 system 권한이나 profile/persona 변경이 아니며, 원격 admission metadata에 남을 수 있다. 중간 응답도 공급자가 실제로 표시한 assistant text만 허용하고 reasoning/도구 인수·결과를 진행 문구로 복제하지 않는다. 타이머가 확인하지 않은 작업 결과를 만들지 않는다. Jev는 메시지당 대표 본문을 최대 한 번 판단하고 새 메시지/복구/중단/승인으로 무효가 된 과거 결과를 재생하지 않는다.

## 표시용 Markdown

assistant 원문은 `markdown-it`에서 HTML 비활성화로 token화한 뒤 허용된 태그와 `textContent`로 DOM을 만든다. 공급자 HTML을 `innerHTML`에 넣거나 token의 URL/style/event 속성을 복사하지 않는다. 링크는 이동 없는 표시, 이미지는 alt text이며 외부 fetch가 없다. user 입력은 원문이다. 이 처리는 원격 history 원본/Jev 입력/공급자 문맥을 바꾸지 않는다. 코드·표의 스크롤도 메시지 내부에 한정한다.

## 화면 캡처 정책

기본 OFF. 사용자 액션 → 캡처 범위/창 선택 → 로컬 미리보기 → 한 번만 전송 확인 → 해당 공급자 전달. 비밀번호 매니저/금융 등 민감한 창을 자동 인식해 완벽 차단한다고 주장하지 않음; 사용자의 시각적 검토가 필수. 자동 재캡처/백그라운드 모니터링은 별도 제품 설계 및 명시적 설정 없이는 금지.

## PC 도구 정책

지원할 동작은 허용 목록 기반의 typed actions (예: `pointer.click`, `keyboard.type`). 원문 `shell(command)`을 임의 실행하지 않는다. 허용 대상 창과 PID/소유권 재검증, 중단 버튼, 만료된 승인의 자동 차단, 감사 로그를 갖춘 후 구현한다.

## 라이선스/지적 재산권

Cubism SDK/Core, MotionSync, 개별 Live2D 모델·음성 모델/보이스마다 별도의 사용·배포 조건을 확인한다. 사용자가 제공한 자산의 로컬 참조만 기본 지원하며, 별도 허락 없는 바이너리 배포 금지.

관련 근거: https://www.electronjs.org/docs/latest/tutorial/security

## 독립 설정 창 IPC

채팅/설정은 parent·modal 없는 별도 managed dialog이며 동일한 sandbox/contextIsolation/CSP/외부 navigation·새 창 차단을 적용한다. main의 `trusted`는 현재 소유한 mainFrame·app origin·window identity를 검사한다. 설정 조작은 chat/settings에 허용하지만 메시지 전송·원격 승인·취소·상태 조회는 chat에만 허용한다. Overlay의 파일 선택 fallback은 좁은 `openSettings`만 호출한다. 설정의 bootstrap·작업 응답에는 대화 history를 넣지 않는다. 설정 열기/재열기는 세션을 만들거나 prompt를 보내지 않는다.
