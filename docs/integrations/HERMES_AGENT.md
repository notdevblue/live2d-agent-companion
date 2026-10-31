# Hermes Agent 연결

**공급자 프로그램 연동:** 공식 인터페이스 Verified · **우리 앱 기존 Bot Chat 연동:** Spike-required

## 공급자 공식 연결 수단

- **API Server:** HTTP + SSE. `POST /v1/chat/completions`, `POST /v1/responses`, `POST /v1/runs`, `GET /v1/runs/{id}/events` 등.
- **TUI Gateway:** JSON-RPC over stdio 또는 WebSocket. `prompt.submit`, `session.list`, `session.resume`, `session.interrupt` 등.
- **ACP:** IDE/ACP 호스트에 적합한 stdio JSON-RPC; 본 앱의 rich host에는 Gateway를 우선 고려.

참고: https://hermes-agent.nousresearch.com/docs/developer-guide/programmatic-integration

## Hermes Bot Mode와 일반 세션의 차이

Hermes Bot Mode의 Bot은 프로필이며, 별도 기억/스킬/설정을 가지고 **영구적인 canonical Bot Chat**을 제공한다. 일반 프로필의 임의 신규 세션에 접속하는 것과 Bot Chat에 동일하게 재접속하는 것은 다른 문제다.

공식 자료:
- https://hermes-agent.nousresearch.com/docs/user-guide/bot-mode
- https://hermes-agent.nousresearch.com/docs/user-guide/profiles

## 권장 구현 전략

### 1. 기본 경로: API Server

- 개발 편의성과 자동화 테스트를 위해 HTTP endpoint에서 텍스트 왕복 및 SSE 검증.
- `X-Hermes-Session-Id` 등 공급자 세션 헤더 사용 시 **공식 API 문서와 버전 검증 후** 실제 파라미터 적용.
- Server error / running / completed / cancelled / failed를 UI 이벤트로 매핑.
- Remote run과 local request id를 별개 기록.

### 2. 고급 경로: Gateway JSON-RPC

- streaming messages, tool state, approvals, clarify, interrupt, session reattach 지원.
- `gateway.ready` 이후 `client.capabilities({"server_requests": true})` 호출해 approval/clarify 등 server→client request 수신 의사를 표시해야 하는 문서 조건을 반영.
- 지원하지 않는 server request에는 안전한 JSON-RPC method-not-found 응답을 반환.
- `request.cancel`에 해당하는 UI 질문만 제거; 재연결 시 `open_requests`와 inflight 복구.
- 서버 gateway의 session 재개와 실제 Bot Mode canonical Chat 바인딩은 별도 검증.

### 3. Bot Mode 지속성 검증

- profile 이름/host(connection)/canonical chat ID를 별개 저장.
- 공식적으로 노출되는 session roster와 Bot Chat 식별 경로를 확인.
- 동일 프로필의 **다른** session에 붙은 경우 오류/새 세션 경고.
- 기존 Bot Chat에서 질문 → 앱에서 답변 → 원래 Hermes Desktop의 같은 Bot Chat에 보이는지 왕복 검증.
- 서로 다른 host의 동명 Bot 충돌 방지.

## 권한/비밀 및 원격 호스트

Gateway/API 주소·인증 정보는 main에서만. HTTPS/WSS 또는 보호된 local socket을 기본. 모델/프로필 등 선택은 capabilities와 permissions에 따라 달라지며, Agent Companion이 Hermes의 파일/쉘 권한을 자동으로 상속하지 않는다.

## 어댑터 이벤트

| Hermes | 내부 정규화 |
|---|---|
| `message.delta` | `message.delta` |
| `message.complete` | `message.complete` |
| `tool.start` / `tool.complete` | `tool.started` / `tool.completed` |
| `approval` server request | `approval.requested` + Hermes 승인지원 UI |
| `request.cancel` | 요청별 승인 UI 취소 |
| `session.interrupt` | local cancel requested + remote status reconciliation |

위 매핑은 명칭·동작 확인을 위한 초안이다. Hermes 버전/모드별 실제 이벤트 필드는 계약 테스트로 고정할 것.

## 미검증 질문

- Hermes Desktop Bot Mode에서 사용하는 canonical Chat의 ID를 외부 통합이 공식 인터페이스로 조회할 수 있는가?
- 외부 WebSocket 클라이언트의 연결/재시작 동안 동일 session이 확실하게 유지되는가?
- 원격 Gateway, 여러 profile의 Bot roster와 인증 분리가 어떻게 노출되는가?
- 특정 경로로 처리된 승인과 로컬 PC 승인의 UX가 충돌하지 않는가?

실증 전에는 '기존 Bot Chat 완전 연결'을 제공 기능으로 표기하지 않는다.
