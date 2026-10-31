# Agent Adapter 인터페이스 계약

**상태:** Proposed. 아래 코드는 라이브러리 API가 아니라 구현을 위한 논리적 계약 초안이다.

## 핵심 모델

~~~ts
type ProviderId = "hermes" | "grok_bot" | "mock";
type Capability =
  | "text" | "streaming" | "attachments.image"
  | "session.list" | "session.resume" | "session.history" | "request.reconcile" | "cancel"
  | "tool.events" | "tool.approvals" | "pc.tools";

type Support = "supported" | "experimental" | "unsupported";
type AgentBinding = {
  provider: ProviderId;
  connectionId: string; // credential/host boundary
  agentId: string;      // Hermes profile+bot or Grok Bot identifier
  sessionId: string;    // may be adapter-specific and opaque
  continuity: "verified" | "unverified" | "new-session";
};
type RequestRef = {
  turnId: string;    // one logical user turn
  requestId: string; // UUID, generated once per submission attempt
  binding: AgentBinding;
};
type UserTurn = RequestRef & {
  text: string;
  attachments?: Array<{kind: "image"; localRef: string}>;
};
type ProviderApprovalResponse = RequestRef & {
  approvalId: string;
  decision: "allow_once" | "deny";
};
interface AgentAdapter {
  readonly provider: ProviderId;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  discover(): Promise<Record<Capability, Support>>;
  listAgents?(): Promise<Array<{id: string; displayName: string}>>;
  listSessions?(agentId: string): Promise<Array<{id: string; label: string}>>;
  send(turn: UserTurn, sink: (event: NormalizedAgentEvent) => void): Promise<void>;
  cancel?(requestId: string): Promise<"confirmed" | "requested" | "unsupported">;
  respondApproval?(response: ProviderApprovalResponse):
    Promise<"applied" | "closed" | "unknown">;
  reconcile?(request: RequestRef, sink: (event: NormalizedAgentEvent) => void):
    Promise<"resumed" | "settled" | "unknown">;
}
~~~

`NormalizedAgentEvent`는 `EVENT_SCHEMA.md`의 이벤트 정의를 따른다. 선택적 메서드와 capability 값은 서로 일치해야 한다. 타입은 추후 런타임 유효성 검사 스키마와 함께 결정한다.

**현재 구현:** 위 코드는 논리적 초안이며 실제 TypeScript 이름은 `src/shared/contracts.ts`의 `AgentEvent`/`ApprovalResponse`다. `src/shared/validation.ts`가 런타임 검사 기준이다. 실제 어댑터에는 명시적 `listSessions`와 `createSession` 선택 메서드가 있으며 새 세션 생성은 UI 동작으로만 수행한다. HTTP와 SSH는 서로 다른 연결 방식으로 유지한다. 미구현 첨부/listAgents를 지원한다고 선언하지 않는다.

`mock`은 개발·테스트 전용 공급자이며 실제 Hermes/Grok 연결로 표시하지 않는다. `request.reconcile`은 기존 요청의 상태 조회·이벤트 재구독 능력이며 `session.resume`과 별개다. `send`의 Promise는 제출 처리 종료를 뜻하고 답변 완료를 뜻하지 않는다. sink는 해당 요청의 종결 또는 재구독 교체까지 유지한다. 복구 시 누적 텍스트는 기존 메시지를 교체하는 snapshot으로 전달하며 delta처럼 덧붙이지 않는다(`EVENT_SCHEMA.md`).

## 표시용 기록 (현재 구현)

현재 `TurnView.messages`는 같은 request 안의 assistant 메시지들을 messageId별로 구분한다. `message.complete`는 해당 메시지 확정이며 요청 종결인 `turn.completed`와 별개다. renderer와 메모리 history는 requestId+messageId를 사용해 중간 응답/최종 답변을 별도 표시한다. 기존 `TurnView.text` 집계와 messages 미포함 fixture의 단일 bubble fallback은 유지한다.

실제 `AgentAdapter`는 선택적 `history(binding): Promise<ConversationMessage[]>`를 제공한다. 각 메시지는 `id`, `role: user | assistant`, `text`이며 로컬 실행 중인 메시지에는 `requestId`가 추가될 수 있다. SSH만 `session.history` capability를 제공한다. native 표시 projection의 역할/본문만 원격 bridge에서 allowlist로 추출하고 main에서 재검증한다. 기록은 selected binding 단위 메모리 cache로만 유지하며 다른 공급자·프로필·세션으로 보내거나 새 prompt의 본문에 덧붙이지 않는다.

기록 행과 admission의 안정적인 join이 없는 Hermes에서는 재시작 때 복원된 미종결 요청의 본문을 별도 bubble로 중복 추가하지 않는다. 기존 기록과 실행 상태를 표시하고 원격 종결 확인 뒤 기록을 다시 읽는다. 같은 문자열을 가진 별개 답변은 합치지 않는다. 이 경로는 Jev와 캐릭터 cue를 재실행하지 않는다.

## 식별자 및 재전송

- `turnId`는 사용자의 논리적 입력에, `requestId`는 개별 제출 시도에 발급한다. 원격 run ID는 공급자의 식별자로 별도 보존한다.
- 재전송은 사용자 확인 후 새 `requestId`를 발급하고 같은 `turnId`로 연결한다. 입력·대상 binding을 바꾸면 새 `turnId`다. 이전 요청의 이벤트는 새 요청의 응답으로 합치지 않는다.
- 원격 실행 여부가 불명확하면 사용자 확인만으로 같은 세션에 새 요청을 제출하지 않는다. 기존 요청의 원격 종료 또는 미접수를 확인해야 세션 lease를 해제할 수 있다.

## 공급자 승인 응답

`tool.approvals` 지원 시 `respondApproval`을 제공해야 한다. Main은 사용자 선택을 받은 뒤 binding/turn/request/approval 식별자와 만료·미해결 상태를 확인하고 어댑터가 공급자의 실제 응답 형식으로 변환한다. `allow_once`는 해당 요청의 1회 승인만 의미한다.

- `applied`: 공급자 적용이 확인됨. 이때만 `approval.resolved`를 발행한다.
- `closed`: 이미 응답·만료·철회된 요청. UI를 닫고 실행 권한을 새로 만들지 않는다.
- `unknown`: 통신 장애 등으로 적용 여부 불명. 성공으로 표시하거나 자동 재전송하지 않고 복구 시 확인한다.

서버 철회·만료는 `approval.closed`로 알린다. 중복 응답은 재적용하지 않으며 재접속 시 살아 있는 승인만 복원한다. 공급자 승인 응답은 PermissionBroker가 발행하는 **로컬 PC 실행 승인과 다른 타입/경로**이며 이를 발행하거나 대체하지 않는다.

## 요청 복구

연결 끊김·로컬 대기 시간 초과·앱 재시작은 원격 종료의 증거가 아니다. 요청을 `reconciling`으로 두고 세션 lease를 유지한다. `reconcile`은 원래 binding과 원격 run의 상태만 확인하며 새 실행을 시작하지 않는다.

- `resumed`: 원격 진행이 확인되고 이벤트 재구독이 연결됨. `turn.resumed`로 원래 진행 상태와 살아 있는 승인을 복원한다.
- `settled`: 원격 종료 또는 미접수가 확인됨. 해당 terminal 이벤트를 한 번 전달한 뒤 lease를 해제한다.
- `unknown`: 확인 불가/일시 오류. `reconciling`과 lease를 유지하고 사용자에게 표시한다. 메서드 미지원도 동일하다. 이후 인증된 callback 등으로 원격 종료를 확인할 수 있다.

재구독은 이전 sink를 교체하고 replay/snapshot을 중복 반영하지 않는다. 종료를 확인할 수 없는 세션은 새 제출을 차단한다. 사용자가 명시적으로 별도 세션을 선택해도 원래 요청의 미확정 상태는 보존한다.

## 필수 어댑터 의미론

1. **정체성**: provider/connection/agent/session을 모두 분리. 동일한 이름의 다른 봇을 병합하면 안 된다.
2. **에러**: 정상 종료, 공급자 실패, 통신 실패, 승인 거절, 취소 불가, 권한 미부여를 구분.
3. **스트리밍**: chunk가 아니더라도 최종 응답 이벤트를 전송할 수 있음. 공급자에서 지원하지 않으면 streaming=unsupported.
4. **중단**: 로컬 UI 재생 중단과 원격 실행 중단은 다르다. 원격 중단 미지원은 명시.
5. **동시성**: 한 세션에 대해 submit이 중복 실행되는 위험을 피하도록 turn lease/queue를 관리.
6. **재시도**: transport ack가 불명확하면 원격 중복 실행 위험을 알리고 자동 재시도하지 않는다.
7. **모의 구현**: 외부 키 없이 모든 이벤트·에러·승인을 재현하는 MockAdapter 제공.

## 연결 상태

`disconnected → connecting → connected → degraded → disconnected`; 인증 실패는 `auth_required`, 미지원은 `unsupported`. 각 전이는 사용자에게 제공되고, 오류는 마스킹한 진단 코드만 노출한다.

## Hermes 매핑(초안)

- HTTP mode: `POST /v1/runs` + `GET /v1/runs/{id}/events` 또는 SSE chat completions.
- Rich mode: TUI gateway JSON-RPC; session selection, prompt.submit, message.delta, tool.start, approval 등.
- Bot Mode canonical Chat은 별도 실증이 필요한 바인딩. 단지 프로필만 선택하고 세션을 새로 만들면 성공으로 간주하지 않는다.

## Grok Bot 매핑(실험적)

- 입력: Routine Webhook URL + Bearer key, JSON message payload.
- Webhook 200 = `accepted`, **completed 아님**.
- 출력: 별도 verified callback path가 실증될 때만 활성화. 실증 전 capability `text`조차 양방향 성공으로 선언 금지.
- 기존 봇 ID, run ID 및 세션 연속성 방식은 확정되지 않았다. UI에는 이 제한을 보인다.

## 실패·보안 규칙

Adapter는 raw HTML, model-suggested shell command, 임의 외부 URL을 실행하지 않는다. 외부 호출은 main 프로세스에서만, HTTPS/WSS 인증을 사용하고 표준 오류로 매핑한다. 로그는 공급자의 비밀 토큰이나 사용자 대화 원문을 포함하지 않는다.
