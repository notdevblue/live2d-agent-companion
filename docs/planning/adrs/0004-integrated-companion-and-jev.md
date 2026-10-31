# ADR-0004: 캐릭터·대화·Jev 표현의 첫 통합 구현

**상태:** Accepted (design), 초기 구현/부분 실증 · **작성:** 2026-10-31

## Context

사용자는 캐릭터 단독 표시를 먼저 완료하면 후속 통합에서 경계 문제가 생길 수 있다고 지적하고 실제 요청/응답까지 같은 범위로 지정했다. Hermes/Grok에 감정 태그 생성까지 직렬로 맡기지 않고 TypeSafe Jev가 표시용 답변을 판단하도록 요청했다. 기준 모델은 사용자가 제공한 DeepSeek-chan이다.

## Decision

- 첫 완료 흐름은 캐릭터 표시→요청/응답→비동기 Jev 판단→표정/모션이다. TTS/PC 제어/화면 캡처는 포함하지 않는다.
- 본문은 즉시 표시한다. Director는 결정적 상태와 선택적 Jev 의미 판단을 분리한다. Jev는 제한된 emotion/gesture Choice이며 실패는 neutral/none, 취소·전환·이전 구간 결과는 폐기한다. 2026-10-31 후속 사용자 지시에 따라 같은 요청에 선택적 attitude Choice를 추가했다. 연기의 타이밍·강도·중립 복귀는 로컬에서 처리하고 attitude가 없는 기존 응답도 지원한다.
- 단일 npm 패키지로 시작한다. 확인 환경은 Node 26.12.1/npm 12.2.1이며 Electron 45.2.1, TypeScript 6.0.3, Vite 8.3.5, Vitest 5.0.5, esbuild 0.28.2, Zod 4.6.7, Prettier 3.9.10을 lockfile로 고정한다. npm은 실행 환경에 이미 있어 별도 전역 패키지 매니저를 설치하지 않았다.
- 공식 Cubism Framework 5-r.5와 Core 5.3/06을 로컬에서 준비한다. Core legacy URL과 새 Framework의 API 차이는 호환 버전 조합으로 해결한다. 모델/SDK를 저장소·배포물에 넣지 않는다.
- HTTP API가 기존 Desktop 세션을 소유한다고 가정하지 않는다. 실행 중인 Hermes에는 SSH를 통한 native control→일회성 ticket→WebSocket으로 연결한다. 기존 owner를 재사용하고 gateway 시작/정지나 공개 포트 설정을 하지 않는다.
- canonical Bot Chat 검증과 일반 세션 연결을 구분한다. 실제 왕복은 사용자가 승인한 전용 새 세션에서 수행한다. 개인 주소/실제 session ID/키는 공개 소스·문서·fixture에 넣지 않는다.
- 제출 전 메타데이터 저장 barrier, 종료 시 dispose→snapshot→flush, endpoint 정규화와 selection/revision 검사로 중복 실행/전환 중 누출을 막는다.

## Consequences

최신 사용자 지시(2026-10-31): 한 메시지의 문장별 표정을 순서 재생하니 답변 완료 뒤 연출이 밀리는 문제가 있어 채팅 메시지 하나당 대표 표정 하나로 바꾼다. 문장별 큐/최소 유지 대기를 제거하고 새 메시지에 즉시 반응한다. 대신 Hermes의 실제 중간 assistant 메시지와 최종 답변을 별도 bubble로 보여 주고, 이 앱의 `prompt.submit.api_text`에만 간단한 작업 진행 보고 안내를 넣는다. profile/persona/기존 다른 세션은 변경하지 않으며, 생성형 LLM을 추가하거나 가짜 진행 문구를 만들지 않는다. 이전 문장 큐 설계는 이 결정으로 대체한다.

2026-11-01 사용자 지시로 Jev의 답변 전용 입력 범위를 현재 사용자 요청+해당 답변으로 확장한다. `ExpressionContext.userRequest`는 현재 request에 묶인 메모리 문맥이며 최대 1600자(긴 요청은 앞뒤 유지), 답변은 기존 800자/메시지·요청당 8회 한도를 유지한다. API state는 user_request/assistant_message를 분리하고 판단 대상은 assistant로 고정한다. 원문 없는 재시작 복원은 이력에서 사용자 요청을 추정하지 않으며 metadata에 원문을 추가 저장하지 않는다. 새 추론 호출이나 provider 기억 이관은 없다. 이전 답변 전용 데이터 범위는 이 결정으로 대체한다.

전체 사용 흐름으로 모듈 경계를 검증하며 표현 판단이 답변 표시를 막지 않는다. Jev는 별도 외부 수신자이므로 명시적 활성화와 데이터 최소화가 필요하다. SSH는 native 프로토콜에 의존하므로 버전/권한/키 인증 실패를 정직하게 표시해야 한다. 라이선스·Windows 검증은 Linux 실행 성공으로 대체할 수 없다.

## 근거와 검증

[구현 및 검증 상태](../../development/IMPLEMENTATION_STATUS.md)에 확인일·명령·범위·한계를 기록한다. 공급자 근거는 [Hermes Programmatic Integration](https://hermes-agent.nousresearch.com/docs/developer-guide/programmatic-integration), [Hermes 공식 소스](https://github.com/NousResearch/hermes-agent), [TypeSafe Choice](https://docs.typesafe.ai/primitives/choice)다. 실제 native 경로/버전은 읽기 전용 탐색으로 확인했으며 공급자 기능 설명과 앱 E2E 증거를 구분한다.
