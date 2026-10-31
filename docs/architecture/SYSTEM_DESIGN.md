# 시스템 아키텍처

**상태:** Proposed · **기술 기준:** Windows 11 + Electron/TypeScript + Cubism SDK for Web

## 개념 구조

~~~text
User ──> Chat / Overlay UI (Electron renderer)
          │    ▲               ▲
          │    │ events        │ presentation
          ▼    │               │
Electron preload (narrow typed IPC, validated)
          │
          ▼
Electron main / Local Orchestrator
 ├─ Agent Router ──────┬─ HermesAdapter ── Hermes API / gateway
 │                     └─ GrokBotAdapter ── webhook + optional callback relay
 ├─ Event Bus + Turn State Machine
 ├─ Character Director ───────────────> Live2D Renderer
 ├─ Speech Orchestrator ─ TTS Provider ─> Audio Player / LipSync
 ├─ Permission Broker ── Capture / PC Tool Executors
 ├─ Settings / OS credential store / optional SQLite
 └─ Audit / bounded structured logs
~~~

## 프로세스 및 신뢰 경계

- **Renderer:** 캐릭터 캔버스, 자막/채팅, 상태 뷰, 키보드 UX; 직접 FS/exec/OS 권한 없음.
- **Preload:** 최소 typed IPC만 노출; 요청 이름·페이로드·송신 origin 검증.
- **Main:** 에이전트 실행 제어, 네트워크 자격증명, 시스템 권한, 로컬 도구, 데이터 저장.
- **External:** Hermes Gateway/API, Grok Bot Webhook 및 선택한 callback relay, TTS 공급자. 모두 불신 네트워크 경계.
- **Optional relay:** Grok Bot이 송신할 수 있는 외부 HTTPS 수신점; 로컬 OS 권한을 가지지 않으며 결과만 전달.

## 애플리케이션 컴포넌트

| 컴포넌트 | 책임 | 하지 않는 일 |
|---|---|---|
| AgentRegistry | 연결 설정·capability·상태 | memory/session 병합 |
| AgentRouter | agent + session 라우팅, turn correlation | 공급자별 Wire 프로토콜 파싱 |
| HermesAdapter | Hermes HTTP/SSE 또는 JSON-RPC 구현 | Grok 전용 기능 |
| GrokBotAdapter | Webhook submission, callback verification | 웹훅 200을 답변 완료로 해석 |
| TurnCoordinator | 상태 전이, dedupe, 취소, late response | 인증·권한 승인 |
| CharacterDirector | 감정 추정·애니메이션 큐·우선순위 | AI 답변 원문 수정 |
| SpeechOrchestrator | 텍스트 분할·음성 큐·동기화 | 비공개 tool data 발화 |
| PermissionBroker | 사용자 승인, scope, TTL, 감사 | 공급자가 보낸 텍스트를 무조건 허용 |
| ScreenCapture | 사용자 선택 캡처, 미리보기 | 상시 백그라운드 녹화 |
| ToolExecutor | 허용된 PC 동작 실행 | 임의 shell string 실행 |
| Persistence | 설정/바인딩/요청 상태 보존 | 타 공급자 대화 전체 복제 |

## 메시지 수명주기

1. UI가 선택 중인 provider/agent/session에 `UserTurn` 작성.
2. TurnCoordinator가 논리 입력의 `turn_id`와 제출 시도의 유일한 `request_id`를 생성·저장하고 세션 lease 획득 후 adapter에 전달.
3. Adapter가 공급자 이벤트를 정규화 (`EVENT_SCHEMA.md`).
4. 상태 머신이 중복·순서·종결 상태 검증 후 UI 이벤트 전파.
5. Director는 UI 용도의 의미·상태만 받아 캐릭터 행동 결정.
6. SpeechOrchestrator는 사용자에게 보여지는 완료/안전한 텍스트에만 TTS 생성.
7. 사용자가 전환·중단하면 모든 후속 메시지는 원래 세션으로만 라우팅.
8. 연결 끊김·로컬 timeout·재시작은 `reconciling`으로 두고 기존 원격 실행에 재구독한다. 원격 종료/미접수 확인 전 lease를 유지한다. 공급자 승인 선택은 adapter 응답 경로로만 전달하고 로컬 PC 권한과 분리한다.

## 선택한 기술과 유연성

- Electron/TS: 제안. 렌더·백엔드 프로세스 분리; 동작/보안 검증 전 확정된 릴리스 기술이 아님.
- Live2D Cubism SDK for Web: 로컬 번들·라이선스 확인 필요.
- SQLite: 요청/바인딩/선택적 대화 메타데이터; 비밀키는 저장하지 않음.
- TTS: 프로바이더 교체 가능; API 의존성은 SpeechSynthesizer 뒤로 감춤.
- WebSocket: Hermes gateway 이벤트/승인 처리에 적합; API server/SSE로 기본 회귀 테스트 가능.

## 공급자 capability가 UX에 주는 영향

Hermes는 스트리밍, 세션 상태, tool events, 승인 요청 등 공식 표면이 있다. Grok Bot Webhook은 비동기 run trigger로만 공식 확인된다. 따라서 공통 UI는 기능이 없으면 숨기거나 '미지원' 표기해야 하며, 지원 강제 가정 금지.

## 설계에서 의도적으로 보류한 것

- Grok Bot callback의 정확한 프로토콜과 기존 Chat 식별자: 실증 전 미확정
- Hermes canonical Bot Chat 식별/복원 구현: 실증 필요
- 음성 모델, 감정 분류 모델, Live2D 리깅 파일명: 사용자 자산/공급자에 따라 결정
- PC 입력 자동화 엔진: 권한 모델 확정·검증 이후 선정

관련: `ADAPTER_CONTRACT.md`, `SECURITY_PRIVACY.md`, `docs/planning/adrs/`.
