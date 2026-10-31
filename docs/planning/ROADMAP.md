# 구현 로드맵 (실행 백로그)

**상태:** Planned · **날짜는 미확정**, 각 단계는 테스트/검증 게이트를 만족해야 종료한다.

## 우선순위/의존성

**핵심 경로:** 계약/TurnCoordinator/Mock PoC → 보안 Electron + Mock Chat → S-005 확인 후 Live2D Overlay → Hermes 연결 S-001/S-002 → TTS Director → Grok S-003/S-004(독립 실험) → Screen → PC Tools.

Grok 연동은 외부 인터페이스 제약에 묶이므로 다른 개발 진행을 막지 않게 별도 트랙으로 유지한다. 실증 실패는 프로젝트 전체 실패가 아님.

위 핵심 경로는 대화까지 포함한 MVP 통합 순서다. **모델만 먼저 보고 싶다면**, core와 독립적으로 P0-001 → P1-001 최소 보안 뼈대 → S-005의 자산 권리/기본 렌더 및 S-006의 창/입력 실증 → P1-002의 캐릭터 단독 표시 PoC를 먼저 진행할 수 있다. 창 구성은 배경·테두리·제목 표시줄 없이 모델만 보이는 방식이며, 입력/채팅/승인 창은 별도로 연다. 구현 항목과 시각적 완료 기준은 [WINDOWS_DESKTOP](../platform/WINDOWS_DESKTOP.md#모델만-표시하는-poc)을 따른다. 채팅·AI·TTS·캡처 실증은 모델 표시에 선행할 필요가 없다.

## 첫 구현 — 캐릭터와 대화의 통합

**사용자 확정 범위(2026-10-31):** 캐릭터 표시만으로 완료하지 않고 DeepSeek-chan 표시 → 실제 요청/응답 → Jev 판단 → 표정/모션까지 함께 구현한다. 내부 core는 TypeScript strict 기반으로 분리하되 사용자 완료 기준은 전체 흐름이다. 현재 구현·실증과 남은 범위는 [IMPLEMENTATION_STATUS](../development/IMPLEMENTATION_STATUS.md)를 따른다.

초기 구조는 단일 패키지의 `src/shared/`, `src/core/`, `src/adapters/`, `src/main/`, `src/preload/`, `src/renderer/`, `tests/`다. npm과 도구 버전은 [ADR-0004](adrs/0004-integrated-companion-and-jev.md) 및 lockfile로 고정한다. 모노레포 추출은 필요할 때 진행한다.

| 순서 | 첫 변경의 범위 | 완료 증거 |
|---|---|---|
| 1 | AgentBinding/Turn/Request/승인 응답/이벤트의 타입과 런타임 검증 | 잘못된 binding·payload 거절, FR-AG-003 식별자 테스트 |
| 2 | 순수 상태 전이와 TurnCoordinator, 메모리 세션 lease 및 저장/복원 인터페이스 | 중복 terminal 차단, reconciling 복구와 같은 세션 중복 제출 차단 |
| 3 | 결정적인 MockAdapter와 가짜 clock | 정상/비스트리밍/취소/오프라인/승인 거절·철회/지연·중복/재전송 시나리오 |
| 4 | Electron 통합과 자동 검사 스크립트 | 로컬 전체 흐름 및 별도 실제 Hermes/Jev 왕복 증거 |

SDK·모델을 준비한 뒤 사용하는 검증 명령이다. 설치/실행 전제는 루트 README를 따른다.

~~~sh
npm ci
npm run typecheck
npm test
npm run build
npm run test:desktop
~~~

Mock 및 계약 테스트는 정상 왕복과 disconnect → reconciling → 동일 요청 완료를 검증한다. core는 메타데이터를 새 coordinator로 복원해 재시작 계약을 검사하고 실제 desktop 실행은 별도 프로세스로 확인한다. SQLite는 사용하지 않고 원문 없이 식별자·상태·lease만 JSON으로 저장한다. 실제 OS 재부팅·재로그인은 별도 검증이다.

통합 흐름의 구현·Linux headless/실제 공급자 실증이 AC-01 전체나 Windows 배포 완료를 뜻하지 않는다. Windows 창·입력, SDK/모델 배포 권리, 기존 canonical Bot Chat, TTS는 별도 게이트다.

설계 이슈의 원인·결정·검증 연결은 [ADR-0003](adrs/0003-request-recovery-and-approvals.md)을 따른다.

## Phase 0 — 환경/문서/실증

- [x] P0-001: npm/TypeScript/Electron 버전, 테스트 도구 및 ADR-0004
- [ ] P0-002: S-005 Cubism SDK/Core/MotionSync/모델 라이선스 및 예제 로드
- [ ] P0-003: S-001 Hermes 테스트 환경 및 API 세션 왕복
- [ ] P0-004: S-002 Hermes 기존 Bot Chat 복원·동일성 검증
- [ ] P0-005: S-003/S-004 Grok Bot Webhook + callback + continuity 실험(별도 브랜치에서 가능)
- [ ] P0-006: S-006 Windows 투명 창/캡처 권한 실험
- [x] P0-007: Mock 어댑터와 프로토콜 schema 테스트

**완료:** 검증 결과를 기록하고, 지원 가능한 기능/차단 기능을 결정한 ADR이 존재한다.

## Phase 1 — 데스크톱 MVP

- [x] P1-001: Electron main/preload/renderer 보안 뼈대(실행 증거는 Linux headless)
- [ ] P1-002: Live2D 파일 로더 + 기본 모션 + 투명 Overlay
- [ ] P1-003: 채팅/에이전트 선택/설정 UI + 로컬 persistence
- [x] P1-004: Event schema + TurnCoordinator + MockAdapter
- [x] P1-005: 실패/중단/중복/late message 회귀 테스트

**완료:** 외부 키 없이 샘플 모델과 Mock 채팅이 작동하고 AC-01/02 핵심이 통과.

## Phase 2 — Hermes 연결

- [ ] P2-001: Hermes API HTTP/SSE adapter
- [ ] P2-002: session/capability discovery 및 host 인증
- [ ] P2-003: Gateway JSON-RPC 이벤트/approval/reconnect/interrupt
- [ ] P2-004: Bot Mode canonical Chat 동등성 실증·바인딩 저장 또는 미지원 표시
- [ ] P2-005: Hermes 통합 테스트·오프라인/중단 테스트
- [x] P2-006: 실행 중인 Hermes owner에 SSH/native gateway 연결, 명시적 전용 세션 실제 왕복·재접속 후 receipt 복구(기존 canonical Bot Chat 동일성 제외)

**완료:** 실제 Hermes와 메시지 왕복 및 승인/취소, session continuity가 검증되는 범위에 한해 명시.

## Phase 3 — Live2D/TTS 표현

- [ ] P3-001: SpeechSynthesizer 및 최소 1개 TTS 구현
- [ ] P3-002: 오디오 큐/중단/텍스트 fallback
- [ ] P3-003: RMS 립싱크, Director 상태 머신/모션 우선순위
- [ ] P3-004: 감정 매핑·보이스/캐릭터 설정, 장치 오류 테스트

**완료:** 실제 답변에 맞춰 말하고 움직이며 실패/중단 시 안정적으로 종료.

## Phase 4 — Grok Bot 실험적 커넥터

- [ ] P4-001: Webhook 설정·Bearer 보호·call acceptance
- [ ] P4-002: 실증 결과에 따른 callback relay/인증/코릴레이션 또는 명시적 미지원 처리
- [ ] P4-003: 기존 Bot identity/continuity 검사
- [ ] P4-004: 느린 응답·비용·제한 안내, 안전한 timeout/중복 처리

**완료:** **확인된** 기능만 공개. 외부 제약으로 실패하면 이유를 문서화하고 unsupported 처리.

## Phase 5 — 화면 보기 및 PC 작업

- [ ] P5-001: 요청 기반 창/영역 캡처 + 미리보기/취소
- [ ] P5-002: 선택 공급자 첨부 capability 검증
- [ ] P5-003: Typed PC tools + PermissionBroker/one-shot approvals
- [ ] P5-004: kill switch/감사/위험 단계/오류·재시작 테스트
- [ ] P5-005: 고위험 동작은 별도 보안 검토 후 단계적으로 허용

**완료:** AC-06/07 및 보안 검증 충족. 기본 OFF 유지.

## 릴리스 메모

- 초기 버전은 명시적인 **alpha**. 보안·라이선스·연동 가능성 확인 전 배포하지 않는다.
- 실제 진행/담당/기한은 이 문서에 추정으로 채우지 않고 이슈/PR에서 관리.
- 요구사항 참조: `docs/specs/FUNCTIONAL_SPEC.md`; 실험: `RISKS_AND_SPIKES.md`.
