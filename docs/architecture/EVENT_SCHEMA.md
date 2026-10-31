# 공통 이벤트/상태 프로토콜

**상태:** Proposed · **스키마 버전:** `1`

## 봉투(Envelope)

~~~json
{
  "schema_version": 1,
  "event_id": "evt-unique",
  "request_id": "req-uuid",
  "provider": "hermes",
  "connection_id": "local-main",
  "agent_id": "profile:coder",
  "session_id": "opaque-provider-session",
  "sequence": 5,
  "occurred_at": "2026-10-31T00:00:00.000Z",
  "type": "message.delta",
  "payload": {"text": "안녕"}
}
~~~

`event_id`는 같은 이벤트 재전송을 구별하는 키, `sequence`는 공급자별로 보장되지 않는 경우 어댑터가 정렬하여 부여한다. origin 서버의 ordering guarantee가 없다면 adapter buffering과 terminal gating이 필요.

## 표준 이벤트 종류

| type | payload 필드(개념) | UX 의미 |
|---|---|---|
| `turn.submitted` | content hash, requestId | 입력 접수 |
| `turn.accepted` | remoteRunId? | 공급자가 실행 수락, **완료 아님** |
| `turn.awaiting_result` | deadline? | 비동기 결과 대기 |
| `message.delta` | text | 텍스트 스트리밍 |
| `message.complete` | text?, messageId? | 해당 메시지 확정 |
| `tool.started` | toolId, name, safeDescription | 도구 수행 표시 |
| `tool.completed` | toolId, outcome | 도구 결과 표시 |
| `approval.requested` | approvalId, summary, target, risk, expiresAt | 인간 승인 |
| `approval.resolved` | approvalId, decision | 승인 처리 |
| `turn.completed` | messageId?, completed:true | 정상 종료 |
| `turn.failed` | code, retryable, safeMessage | 실패 종료 |
| `turn.cancelled` | remoteConfirmed:boolean | 취소 종료 |
| `turn.interrupted` | reason | 이전 실행 불명확/중단 |
| `connection.changed` | state, capabilityChanges? | 연결상태 변경 |

이것은 **앱 내부 이벤트**이며 공급자 실제 메시지 필드와 1:1 매핑을 보장하지 않는다.

## 턴 상태 머신

~~~text
draft -> submitting -> accepted -> streaming -> completed
                    └-> awaiting_result -> completed
          └-> failed / interrupted
accepted, streaming, awaiting_result -> cancel_requested
cancel_requested -> cancelled | completed | interrupted
any nonterminal -> failed / interrupted (timeout/disconnect)
~~~

- `completed/failed/cancelled/interrupted`는 terminal이며 동일 request_id에서 두 번 처리 금지.
- Grok 웹훅 `200`은 반드시 `accepted` 및 `awaiting_result`로만 정규화.
- callback/late event는 원래 binding에만 반영하고, 다른 선택 탭에서 즉시 TTS를 시작하지 않는다.
- 종결 후 중복 delta/complete는 무시, 진단 카운터만 증가.
- 네트워크 재연결 후 `unknown`일 때 원격 전송 재시도는 사용자 확인 필요.

## 캐릭터 이벤트

`character.state` = `idle | thinking | talking | listening | working | success | error`; `expression` / `motion`은 모델 호환성 검사 후 유효한 매핑으로 축소된다. Audio playback 상태가 실제 입 움직임 시간의 기준이며 text delta 도착 자체가 lip-sync를 켜지 않는다.

## 승인 데이터

~~~json
{
  "approval_id": "apr-uuid",
  "request_id": "req-uuid",
  "action": "input.click",
  "target": {"window_id": "opaque", "screen_region": [10, 20, 100, 80]},
  "risk": "medium",
  "expires_at": "2026-10-31T00:00:30.000Z",
  "display_summary": "선택한 창에서 버튼 클릭"
}
~~~

이 예시는 스키마 예시다. 원격 공급자의 approval 이벤트와 로컬 PC tool 승인은 서로 다른 트러스트 도메인으로 검증. 이벤트 페이로드는 크기 제한, 런타임 validation, escape/sanitize를 적용한다.
