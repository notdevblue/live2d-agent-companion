# 공통 이벤트/상태 프로토콜

**상태:** Proposed · **스키마 버전:** `1` (미출시 초안; 이번 변경의 마이그레이션 대상 구현/저장 데이터 없음)

## 봉투(Envelope)

~~~json
{
  "schema_version": 1,
  "event_id": "evt-unique",
  "turn_id": "turn-uuid",
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

턴 이벤트는 `provider + connection_id + agent_id + session_id + turn_id + request_id`로 검증한다. `turn_id`는 논리적 입력, `request_id`는 개별 제출 시도이며 재전송에서도 이전 요청의 이벤트를 새 요청으로 바꾸지 않는다. 연결 전용 `connection.changed`에는 turn/request/agent/session 필드를 요구하지 않고 provider/connection으로 라우팅한다.

## 표준 이벤트 종류

| type | payload 필드(개념) | UX 의미 |
|---|---|---|
| `turn.submitted` | content hash, requestId | 입력 접수 |
| `turn.accepted` | remoteRunId? | 공급자가 실행 수락, **완료 아님** |
| `turn.awaiting_result` | deadline? | 비동기 결과 대기 |
| `turn.reconciling` | reason: disconnect/timeout/restart | 원격 상태 확인 중, 종료 아님 |
| `turn.resumed` | state: accepted/streaming/awaiting_result/cancel_requested | 기존 원격 실행 복원 |
| `message.delta` | text | 텍스트 스트리밍 |
| `message.complete` | text?, messageId? | 해당 메시지 확정 |
| `message.snapshot` | messageId, text | 복구된 누적 본문으로 기존 메시지를 교체 |
| `tool.started` | toolId, name, safeDescription | 도구 수행 표시 |
| `tool.completed` | toolId, outcome | 도구 결과 표시 |
| `approval.requested` | approvalId, summary, target, risk, expiresAt | 인간 승인 |
| `approval.resolved` | approvalId, decision | 승인 처리 |
| `approval.closed` | approvalId, reason: expired/withdrawn/already_answered | 종료된 승인 UI 정리, 승인 아님 |
| `turn.completed` | messageId?, completed:true | 정상 종료 |
| `turn.failed` | code, retryable, safeMessage | 실패 종료 |
| `turn.cancelled` | remoteConfirmed:boolean | 취소 종료 |
| `turn.interrupted` | reason | 공급자가 확인한 실행 중단 |
| `connection.changed` | state, capabilityChanges? | 연결상태 변경 |

이것은 **앱 내부 이벤트**이며 공급자 실제 메시지 필드와 1:1 매핑을 보장하지 않는다.

## 턴 상태 머신

~~~text
draft -> submitting -> accepted -> streaming -> completed
                    └-> awaiting_result -> completed
accepted -> completed (non-streaming final response)
accepted, streaming, awaiting_result -> cancel_requested
cancel_requested -> cancelled | completed | interrupted
submitting, accepted, streaming, awaiting_result, cancel_requested -> reconciling (disconnect/local timeout/restart)
reconciling -> accepted | streaming | awaiting_result | cancel_requested (remote running confirmed)
submitting, accepted, streaming, awaiting_result, cancel_requested, reconciling -> completed | failed | cancelled | interrupted (authoritative outcome)
~~~

- `completed/failed/cancelled/interrupted`는 terminal이며 동일 request_id에서 두 번 처리 금지.
- 원격 종료가 확인되거나 원격 미접수가 확정된 제출 실패일 때만 terminal로 전이한다. 로컬 timeout/disconnect는 `reconciling`이며 세션 lease를 해제하지 않는다. `cancelled`는 원격 취소 확인 시에만 사용한다(`remoteConfirmed: true`).
- `reconciling`에서는 상태 조회/재구독만 허용하고 같은 세션의 새 제출은 차단한다. 확인된 원격 결과는 원래 request_id에 한 번 반영한다. 복구 미지원·결과 미도착은 미확정 상태로 계속 표시한다.
- `message.snapshot`은 기존 messageId의 텍스트를 교체하고 자동 TTS를 시작하지 않는다. 복구 대상 메시지에는 동일한 messageId를 계속 사용한다. snapshot 이후 delta 재개는 그 snapshot 이후의 이벤트만 전달한다. 안전한 replay 경계를 확인할 수 없으면 누적 snapshot으로 갱신한다.
- Grok 웹훅 `200`은 반드시 `accepted` 및 `awaiting_result`로만 정규화.
- callback/late event는 원래 binding에만 반영하고, 다른 선택 탭에서 즉시 TTS를 시작하지 않는다.
- 종결 후 중복 delta/complete는 무시, 진단 카운터만 증가.
- 네트워크 재연결 후 `unknown`일 때 자동 재전송 금지. 재전송은 사용자 확인뿐 아니라 이전 실행의 종료/미접수 확인도 필요하다(`ADAPTER_CONTRACT.md`).

## 캐릭터 이벤트

`character.state` = `idle | thinking | talking | listening | working | success | error`; `expression` / `motion`은 모델 호환성 검사 후 유효한 매핑으로 축소된다. Audio playback 상태가 실제 입 움직임 시간의 기준이며 text delta 도착 자체가 lip-sync를 켜지 않는다.

## 승인 데이터

~~~json
{
  "approval_id": "apr-uuid",
  "turn_id": "turn-uuid",
  "request_id": "req-uuid",
  "action": "input.click",
  "target": {"window_id": "opaque", "screen_region": [10, 20, 100, 80]},
  "risk": "medium",
  "expires_at": "2026-10-31T00:00:30.000Z",
  "display_summary": "선택한 창에서 버튼 클릭"
}
~~~

이 예시는 스키마 예시다. 원격 공급자의 approval 이벤트와 로컬 PC tool 승인은 서로 다른 트러스트 도메인으로 검증. 이벤트 페이로드는 크기 제한, 런타임 validation, escape/sanitize를 적용한다.
