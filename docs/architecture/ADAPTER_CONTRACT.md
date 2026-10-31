# Agent Adapter 인터페이스 계약

**상태:** Proposed. 아래 코드는 라이브러리 API가 아니라 구현을 위한 논리적 계약 초안이다.

## 핵심 모델

~~~ts
type ProviderId = "hermes" | "grok_bot";
type Capability =
  | "text" | "streaming" | "attachments.image"
  | "session.list" | "session.resume" | "cancel"
  | "tool.events" | "tool.approvals" | "pc.tools";

type Support = "supported" | "experimental" | "unsupported";
type AgentBinding = {
  provider: ProviderId;
  connectionId: string; // credential/host boundary
  agentId: string;      // Hermes profile+bot or Grok Bot identifier
  sessionId: string;    // may be adapter-specific and opaque
  continuity: "verified" | "unverified" | "new-session";
};
type UserTurn = {
  requestId: string; // UUID, generated once
  binding: AgentBinding;
  text: string;
  attachments?: Array<{kind: "image"; localRef: string}>;
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
}
~~~

`NormalizedAgentEvent`는 `EVENT_SCHEMA.md`의 이벤트 정의를 따른다. 선택적 메서드와 capability 값은 서로 일치해야 한다. 타입은 추후 런타임 유효성 검사 스키마와 함께 결정한다.

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
