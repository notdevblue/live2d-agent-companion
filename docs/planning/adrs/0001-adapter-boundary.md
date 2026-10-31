# ADR-0001: 에이전트 어댑터와 캐릭터 표현의 분리

**상태:** Accepted (design) · **작성:** 2026-10-31

## Context

Grok Bot 앱의 개별 Bot은 Webhook 기반 비동기 경로만 공식 확인되었고 Hermes Agent는 HTTP/SSE와 JSON-RPC를 제공한다. 두 공급자의 세션·기억·취소/승인 동작이 다르며, Live2D/TTS는 이러한 차이와 무관하게 동일 캐릭터를 표현해야 한다.

## Decision

- Core는 공급자 중립적인 `AgentAdapter` 인터페이스와 이벤트 상태 머신을 사용한다.
- 연결 키는 `provider + connection + agent + session`이다.
- CharacterDirector와 SpeechOrchestrator는 adapter 이벤트만 소비하고 remote 공급자 내부 모델에 의존하지 않는다.
- capability를 `supported/experimental/unsupported`로 노출한다.
- 기존 Grok Bot에 연결이 안 될 때 일반 Grok 모델 API를 **동일 봇**으로 자동 전환하지 않는다.

## Consequences

장점: 공급자 교체, 독립 테스트, 기억 혼합 방지, 비동기 처리 명확화. 비용: 어댑터별 계약·상태 관리가 추가된다. 새로운 공급자는 동일한 capability/이벤트 테스트를 통과해야 한다.

## Alternatives rejected

- 하나의 LLM 호출 API로 Grok Bot과 Hermes를 모두 감싸기: 기존 Bot의 기억/세션/도구 의미가 손상됨.
- TTS/모션 로직을 각 adapter 안에 구현: 중복과 상태 불일치가 커짐.
