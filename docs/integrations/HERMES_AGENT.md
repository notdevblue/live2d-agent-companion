# Hermes Agent 연결

**공급자 프로그램 연동:** 공식 인터페이스 Verified · **우리 앱 기존 Bot Chat 연동:** Spike-required

## 공급자 공식 연결 수단

**2026-10-31 앱 구현:** HTTP 어댑터와 SSH/native gateway 어댑터가 있다. 실제 검증은 실행 중인 owner에 SSH로 붙은 전용 테스트 세션과, 후속 사용자 지시로 전환한 default 프로필의 일반 대화다. 일반 대화에서 원격 read_file 호출도 확인했다. API 전용 HTTP 세션은 계약 테스트만 통과했으며 canonical Bot Chat의 동일성은 어느 경로에서도 완료로 표시하지 않는다.

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
- 로컬 연결 끊김은 `reconciling`으로 처리한다. 기존 원격 run을 조회/재구독하고 누적 텍스트는 snapshot으로 복원하며 새 `prompt.submit`을 보내지 않는다. 실제 run 종료 확인 전 세션 lease를 유지한다.
- 사용자 승인/거절은 `respondApproval`을 통해 원래 server request ID의 JSON-RPC 응답으로 변환한다. 철회·만료는 `approval.closed`이며 승인 응답 적용 여부가 불명확하면 `open_requests`와 대조한다. 정확한 choice 값과 HTTP 모드의 승인 응답 형식은 대상 버전의 계약 테스트로 확정한다.
- 서버 gateway의 session 재개와 실제 Bot Mode canonical Chat 바인딩은 별도 검증.

### 3. Bot Mode 지속성 검증

- profile 이름/host(connection)/canonical chat ID를 별개 저장.
- 공식적으로 노출되는 session roster와 Bot Chat 식별 경로를 확인.
- 동일 프로필의 **다른** session에 붙은 경우 오류/새 세션 경고.
- 기존 Bot Chat에서 질문 → 앱에서 답변 → 원래 Hermes Desktop의 같은 Bot Chat에 보이는지 왕복 검증.
- 서로 다른 host의 동명 Bot 충돌 방지.

## 권한/비밀 및 원격 호스트

### 현재 구현한 SSH 경로

`ssh://user@host` + 프로필 + 사용자가 선택한 session ID로 접속한다. 고정된 SSH 명령으로 Python stdlib 브리지를 실행하고 원격 프로필의 `gateway.sock`에서 native identify와 일회성 interactive ticket을 얻어 기존 owner의 WebSocket에 접속한다. ticket은 원격 메모리에서만 사용한다. gateway/서비스 시작·정지·설정 변경이나 외부 포트 개방은 하지 않는다.

`session.resume`은 원문 이력을 생략하고, bridge는 reasoning/도구 입출력/내부 transcript를 로컬로 넘기지 않는다. 사용자에게 보이는 assistant 메시지와 도구 lifecycle/승인 요약만 정규화한다. 제출은 session authority admission/receipt와 연결하고 terminal receipt를 확인해야 완료한다. 재접속 replay가 누락됐으면 snapshot을 사용하거나 미확정으로 유지하며 새 prompt를 보내지 않는다.

세션 목록은 메타데이터만 조회하고 기존 ID를 사용자가 명시적으로 고른다. ‘새 대화’는 프로필의 설정을 따르는 일반 세션을 만들며 `toolsets`를 강제로 비우지 않는다. 기존 테스트 세션을 계속 사용하던 상태는 사용자 지시로 일반 대화로 전환했다. 이는 기존 Bot Chat 생성/연결 성공으로 간주하지 않는다. 실제 확인한 Hermes 소스 버전은 `6b5df79671`이며 다른 버전은 계약 검증이 필요하다.

### 일반 대화와 통합 검사 구분

초기 생성 코드의 `toolsets: []` 때문에 선택한 프로필에 파일 도구가 있어도 테스트 세션에서 쓸 수 없었다. 원격 메타데이터에서는 이 세션에 x_search 도구 3개가 남아 있었으므로 ‘도구가 모두 꺼진다’고 일반화하지 않는다. 일반 생성은 `toolsets`를 생략하고 `follow_profile_config: true`로 프로필 설정을 따른다. default 일반 세션에서는 file/terminal/memory 등과 최초 tool_count 20을 확인하고 `/etc/os-release`를 `read_file`로 조회해 완료했다. 실제 ID는 앱 사용자 데이터와 ignored 로컬 연결 파일에만 저장한다.

프로필의 기존 실사용 대화는 여러 Discord 세션으로 구분되어 있었다. 이를 임의로 선택하거나 이력을 복제하지 않고 앱용 일반 대화를 default에 생성해 같은 ID를 재사용한다. 이 연결을 canonical Bot Chat 검증 완료라고 표시하지 않는다. 파일 도구는 Hermes가 실행되는 원격 호스트를 대상으로 하며 이 앱이 실행되는 PC의 파일/화면 권한과는 별개다.

`--smoke-hermes`는 선택된 세션의 제목이 전용 `Live2D Companion Integration Test`인지 확인하고, 일반 대화이면 prompt 제출 전에 거절한다. 실사용 연결로 bootstrap 파일을 바꾼 뒤에도 통합 검사가 그 대화에 인사를 넣지 않도록 분리한다. 전용 테스트 연결을 별도로 준비해야 실제 공급자 smoke를 실행할 수 있다.

### 주소와 인증

Gateway/API 주소·인증 정보는 main에서만. HTTPS/WSS 또는 보호된 local socket을 기본. 모델/프로필 등 선택은 capabilities와 permissions에 따라 달라지며, 원격 일반 세션은 선택한 Hermes 프로필의 도구 구성을 사용하며, Agent Companion이 실행되는 로컬 PC의 파일/쉘 권한은 별도로 취급한다.

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
