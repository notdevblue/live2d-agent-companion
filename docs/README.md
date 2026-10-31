# 문서 허브

> **문서 기준일:** 2026-10-31 · **프로젝트 상태:** 설계/기술검증 전 · **대상 플랫폼:** Windows 11 우선

이 저장소는 기존 Grok Bot 앱의 개별 Bot과 Hermes Agent Bot을 Live2D 데스크톱 캐릭터에 연결하는 프로젝트다. 이 문서의 MUST는 **요구사항**이지 현재 제공 기능이 아니다.

## 목적별 목차

| 폴더 | 목적 | 시작 문서 |
|---|---|---|
| `ai/` | AI 코딩 에이전트의 역할·읽는 순서·작업 규칙 | [WORKING_AGREEMENT](ai/WORKING_AGREEMENT.md), [IMPLEMENTATION_PLAYBOOK](ai/IMPLEMENTATION_PLAYBOOK.md) |
| `product/` | 사용자 문제, 제품 범위, 핵심 시나리오 | [PRD](product/PRD.md), [USER_JOURNEYS](product/USER_JOURNEYS.md) |
| `specs/` | 테스트 가능한 기능·비기능 요구사항, 수락 조건 | [FUNCTIONAL_SPEC](specs/FUNCTIONAL_SPEC.md), [NON_FUNCTIONAL_SPEC](specs/NON_FUNCTIONAL_SPEC.md), [ACCEPTANCE_CRITERIA](specs/ACCEPTANCE_CRITERIA.md) |
| `architecture/` | 컴포넌트, 어댑터, 이벤트, 상태, 데이터, 보안 | [SYSTEM_DESIGN](architecture/SYSTEM_DESIGN.md), [ADAPTER_CONTRACT](architecture/ADAPTER_CONTRACT.md), [EVENT_SCHEMA](architecture/EVENT_SCHEMA.md), [STATE_AND_STORAGE](architecture/STATE_AND_STORAGE.md), [SECURITY_PRIVACY](architecture/SECURITY_PRIVACY.md) |
| `integrations/` | 외부 서비스별 실제 연결·제약·검증 | [GROK_BOT](integrations/GROK_BOT.md), [HERMES_AGENT](integrations/HERMES_AGENT.md), [LIVE2D_TTS](integrations/LIVE2D_TTS.md) |
| `platform/` | Windows 창, 화면 캡처, 입력 제어 | [WINDOWS_DESKTOP](platform/WINDOWS_DESKTOP.md) |
| `ux/` | 사용자 흐름과 캐릭터 반응 설계 | [INTERACTION_DESIGN](ux/INTERACTION_DESIGN.md) |
| `planning/` | 단계별 개발 순서, 리스크, 아키텍처 결정 | [ROADMAP](planning/ROADMAP.md), [RISKS_AND_SPIKES](planning/RISKS_AND_SPIKES.md), [ADR-0001](planning/adrs/0001-adapter-boundary.md), [ADR-0002](planning/adrs/0002-approval-boundary.md) |
| `testing/` | 단위/통합/E2E 검증 계획 | [TEST_STRATEGY](testing/TEST_STRATEGY.md) |
| `development/` | 코드 구조, 변경 절차, PR 기준 | [REPO_CONVENTIONS](development/REPO_CONVENTIONS.md) |
| `references/` | 공식 자료, 검증일, 링크 | [OFFICIAL_SOURCES](references/OFFICIAL_SOURCES.md) |

루트 `AGENTS.md`는 모든 AI 개발 에이전트의 진입점이다.

## 요구사항 키워드

- **MUST**: 구현/검증 없이는 해당 단계 완료 불가.
- **SHOULD**: 권장 목표. 예외는 근거를 문서화.
- **MAY**: 선택 또는 후속 범위.
- **P0/P1/P2**: 필수 / 중요 / 개선.
- **Verified**: 공식 자료로 근거가 확인된 **공급자 기능**(우리 앱의 구현 완료와 별개).
- **Proposed**: 설계 제안, 아직 구현·검증 전.
- **Spike-required**: 기술적 실증이 필요한 미확정 항목.
- **Blocked**: 외부 API/권한/라이선스 등으로 실행 불가.

## 변경 관리

기능별 요구사항 ID(예: FR-CHAT-001)를 코드/테스트/PR에서 참조한다. 외부 제품의 문서가 바뀌면 `references`의 근거와 통합 스펙을 갱신한다. 사용자의 결정이 필요한 사항은 `planning/RISKS_AND_SPIKES.md`의 Open Questions에 기록하고 임의로 확정하지 않는다.
