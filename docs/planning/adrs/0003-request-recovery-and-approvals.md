# ADR-0003: 요청 식별자, 원격 실행 복구와 공급자 승인 응답

**상태:** Accepted (design) · **작성/문서 검토:** 2026-10-31 · **구현:** 없음

## Context

설계 검토에서 다음 모순이 발견됐다. 실행 코드의 장애를 재현한 결과는 아니다.

| 이슈 | 기존 원인과 영향 | 설계 결정 | 요구사항/검증 |
|---|---|---|---|
| 승인 응답 경로 누락 | 수신 이벤트만 있어 사용자의 거절을 공급자에 전달할 공통 계약이 없음 | `respondApproval`과 적용/종료/불명 결과, `approval.closed` 정의. 로컬 PC 승인과 별도 경로 | FR-AG-007/013, AC-03, E-015/016 |
| 연결 끊김과 복구 충돌 | disconnect를 terminal로 확정하면 서버에서 계속된 실행의 완료를 재접속 후 반영할 수 없음 | 비종결 `reconciling`과 기존 요청 조회/재구독 계약. 원격 종료/미접수 확인 전 세션 lease 유지 | FR-AG-004/012, AC-02, E-012~014/018 |
| 논리 턴/제출 시도 혼용 | FR-AG-003은 분리를 요구하지만 모델·이벤트·저장은 request_id만 사용 | `turn_id` 1개에 제출 시도별 `request_id` 연결. 원격 run ID는 별도 | FR-AG-003, AC-02, E-017 |

## Decision

상세 계약의 단일 기준은 다음 문서다.

- [ADAPTER_CONTRACT](../../architecture/ADAPTER_CONTRACT.md): ID 수명, 승인 응답, 복구 메서드 및 지원 능력.
- [EVENT_SCHEMA](../../architecture/EVENT_SCHEMA.md): 비종결 복구 전이, snapshot, 승인 철회 이벤트.
- [STATE_AND_STORAGE](../../architecture/STATE_AND_STORAGE.md): Turn/Request/SessionLease 구분과 재시작 복원.
- [ACCEPTANCE_CRITERIA](../../specs/ACCEPTANCE_CRITERIA.md), [TEST_STRATEGY](../../testing/TEST_STRATEGY.md): 수락 조건과 회귀 시나리오.

이 계약은 core 회귀 테스트로 실증하고 첫 사용자 완료 범위는 [ROADMAP의 통합 흐름](../ROADMAP.md)을 따른다(후속 ADR-0004). 계약 테스트 통과만으로 외부 공급자 capability나 기존 Bot Chat 연속성을 검증했다고 간주하지 않는다.

## Consequences

연결 장애를 성공/실패로 성급하게 확정하지 않으며 재접속 후 동일 요청을 계속 추적할 수 있다. 반면 원격 상태를 확인할 수 없는 세션은 제출이 계속 차단될 수 있다. UI는 미확정 이유를 보여 주고 별도 세션 선택을 제공하되, 원래 요청을 종료했다고 표시하거나 lease를 임의 해제하지 않는다.

공급자 프로토콜의 구체적인 승인 choice·조회·재구독 필드는 대상 버전과 S-001로 확인한다. 내부 스키마는 미출시 v1 초안이므로 이번 변경의 데이터 마이그레이션 대상은 없다. 구현/배포 이후 호환 불가 변경에는 버전과 마이그레이션이 필요하다.

## Alternatives rejected

- 연결 끊김 즉시 종료 후 재전송: 원격 중복 실행과 정상 결과 유실 위험.
- 승인 UI 클릭을 로컬 PC 실행 권한으로 재사용: ADR-0002의 신뢰 경계 위반.
- request_id를 재전송에서도 재사용: 개별 시도와 늦은 결과의 관계가 모호함. 공급자 idempotency key는 별도 공급자 계약에 따라 결정.

## 검증 범위와 남은 증거

2026-10-31 최초 문서 개정에서 계약·요구사항·수락 조건을 대조하고 별도 읽기 전용 재검토를 수행했다. 당시 Markdown 28개의 상대 링크/앵커 39개와 JSON 예시 3개는 오류 0건, `git diff --check`는 통과했다. 당시에는 실행 코드가 없어 E-012~018은 계획이었다. 이후 구현/실제 검증 결과는 [IMPLEMENTATION_STATUS](../../development/IMPLEMENTATION_STATUS.md)로 추적하며 Windows 검증과 구분한다.

외부 근거: [Hermes Programmatic Integration](https://hermes-agent.nousresearch.com/docs/developer-guide/programmatic-integration)의 server request 응답 및 `open_requests`/`inflight` 복원 설명. 공급자 기능과 앱의 구현 증거는 구분한다.

## 자동 복구 보완 (2026-11-01)

30초 무이벤트 뒤 수동 조회만 기다리던 구현을 원래 요청의 자동 조회로 변경한다. 진행 확인 시 감시를 이어가고 미확인일 때만 유한 backoff로 제한한다. 메서드 반환값만으로 lease를 해제하지 않으며 terminal 이벤트가 필요하다. replay 만료도 receipt/snapshot으로 현재 실행·승인을 확인한다. 재시작·과거 답변 복구는 재제출/Jev 재판단을 하지 않는다. 수락 근거는 AC-02, E-019와 core/SSH 계약 검사다.
