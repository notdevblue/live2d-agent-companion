# ADR-0002: 스크린샷과 PC 동작의 명시적 권한 경계

**상태:** Accepted (design) · **작성:** 2026-10-31

## Context

사용자는 미래에 에이전트가 화면을 보고 PC를 조작하길 원한다. 원격 agent output에는 프롬프트 인젝션과 무권한 행동 위험이 있으므로, 'PC를 봄'과 'PC에서 행동함'을 분리해야 한다.

## Decision

- 캡처는 사용자 요청에 의해 선택한 창/영역만 1회 수집.
- 캡처 전송은 대상 공급자 표시 + 미리보기 + 명시적 승인.
- PC 도구는 main-process의 별도 PermissionBroker가 type/target/scope/TTL/turn 바인딩을 검증.
- 승인 없이 실행되지 않으며 one-shot 기본, kill switch 필수.
- 외부 공급자의 tool approval과 사용자 로컬 OS tool approval은 구분한다.
- 고위험 조작은 초기 범위에서 차단한다.

## Consequences

장점: 보안 경계 명확, 사용자 통제, 테스트 가능. 비용: 추가 클릭·개발 복잡도, 일부 자율성 감소.

## Alternatives rejected

- 모델이 보낸 문자열을 shell로 실행: 위험하고 검증 불가.
- '한 번 허용하면 언제나 제어' 기본 정책: 과도한 권한.
- 상시 화면 업로드: 불필요한 정보 노출.
