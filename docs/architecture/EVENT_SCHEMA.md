# 공통 이벤트/상태 프로토콜

**상태:** Proposed · **스키마 버전:** `1` (미출시 초안; 이번 변경의 마이그레이션 대상 구현/저장 데이터 없음)

## 봉투(Envelope)

현재 로컬 `CompanionEvent`의 `cue`에는 선택적 `attitude`(`neutral/explain/tease/shy/reassure`)가 있다. `presentation` 이벤트는 연출 강도·구도·배치 잠금·움직임 줄이기 설정을 같은 selection의 renderer에 전달하고, `character.preview`는 main에서 검증한 로컬 preset만 전달한다. 이들은 원격 AgentEvent/실행 권한이 아니며, 외부 입력이 직접 발행할 수 없다. pose/표정 타이밍은 renderer 로컬에서 처리한다. 실제 타입은 `src/shared/contracts.ts`를 따른다.

~~~json
{
  "schemaVersion": 1,
  "eventId": "evt-unique",
  "turnId": "turn-uuid",
  "requestId": "req-uuid",
  "binding": {
    "provider": "hermes",
    "connectionId": "local-main",
    "agentId": "default",
    "sessionId": "opaque-provider-session",
    "continuity": "unverified"
  },
  "type": "message.delta",
  "payload": {"text": "안녕", "messageId": "message-1"}
}
~~~

위 형식은 현재 `src/shared/contracts.ts`의 `AgentEvent`와 런타임 validator를 따른다. `eventId`는 중복 처리 방지 키다. 공급자의 sequence/epoch는 각 어댑터 내부에서 재생/누락 검증에 사용하며 공통 이벤트에 임의 ordering guarantee를 추가하지 않는다. Main→renderer 이벤트는 selectionId/revision으로 전환·초기화 중 오래된 전달을 차단한다. 아래 표의 payload는 개념 설명이며 실제 필드 타입은 shared 계약이 기준이다.

턴 이벤트는 전체 binding + turnId + requestId로 검증한다. 문서에서 사용하는 turn_id/request_id는 각각 코드의 turnId/requestId에 대응한다. 연결 상태는 현재 Bootstrap의 capabilities/connectionError로 제공하며 `connection.changed`는 후속 이벤트 제안이다.

## 표준 이벤트 종류

| type | payload 필드(개념) | UX 의미 |
|---|---|---|
| `turn.submitted` (후속 제안) | content hash, requestId | 현재는 core의 submitting TurnView로 입력 접수 표시 |
| `turn.accepted` | remoteRunId? | 공급자가 실행 수락, **완료 아님** |
| `turn.awaiting_result` | deadline? | 비동기 결과 대기 |
| `turn.reconciling` | reason: disconnect/timeout/restart | 원격 상태 확인 중, 종료 아님 |
| `turn.resumed` | state: accepted/streaming/awaiting_result/cancel_requested | 기존 원격 실행 복원 |
| `message.delta` | text, messageId | 텍스트 스트리밍 |
| `message.complete` | text, messageId | 해당 메시지 확정 |
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

## 로컬 설정 동기화

`CompanionEvent {type: configuration, selectionId, revision}`은 설정 창에서 프로필/세션·runtime·모델 매핑 또는 연결 검사 결과가 바뀌었음을 main이 알리는 로컬 알림이다. chat은 기존 selection 필터보다 먼저 이를 처리해 bootstrap/history를 새로 읽고, fetch token으로 더 늦게 도착한 이전 응답을 버린다. 같은 selection이면 transcript DOM·입력 초안·스크롤을 유지한다. 설정 창은 자신의 변경 응답으로 상태를 갱신하므로 이 방송으로 작성 중인 필드를 덮지 않는다. presentation·배율·입력 영역은 기존 전용 이벤트를 재사용한다. 외부 어댑터 이벤트나 새 원격 제출이 아니다.

## 캐릭터 이벤트

현재 `TurnView.messages`는 `messageId/text/completed`의 순서 있는 배열이며 `text` 집계는 기존 호출과 호환하기 위해 유지한다. 말풍선/로컬 표시 cache는 requestId+messageId로 구분한다. `cue.messageId`는 실제 assistant 메시지 하나에, segmentId는 현재 요청의 메시지 순서에 대응한다. 같은 메시지를 문장별로 다시 판단하거나 큐에 쌓지 않는다. 새 메시지는 이전 미적용 판단을 취소하고 애니메이션 종료를 기다리지 않으며, 같은 메시지/복구 텍스트는 재적용하지 않는다. 본문/호출/수집·판단 기한은 shared `EXPRESSION_PACING`을 따른다.

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
