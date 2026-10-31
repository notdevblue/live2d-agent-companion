# 코드/저장소 기여 규칙

**상태:** Proposed · 현재 문서 전용 저장소, 아래 경로는 **미래 제안**.

## 예상 모노레포 구조

~~~text
apps/
  desktop/             Electron main, preload, renderer, UI
packages/
  contracts/           schema, normalized event and adapter types
  core/                AgentRouter, TurnCoordinator, state management
  adapters/
    hermes/            Hermes HTTP/SSE and Gateway JSON-RPC
    grok-bot/          Webhook/callback experimental adapter
    mock/              deterministic fake provider
  live2d/              Cubism loader and CharacterDirector
  speech/              TTS provider adapter and audio queue
  pc-tools/            permission broker, capture and tools
services/
  grok-relay/          OPTIONAL callback ingress, only after feasibility spike
tests/                 contract, E2E, security and performance fixtures
docs/                  design and requirements (this directory)
~~~

초기에는 간단한 형태로 시작하고 필요에 따라 패키지 추출. 핵심은 의존성 방향과 신뢰 경계이지 폴더 수 자체가 아니다.

## 코드 원칙

- TypeScript strict, 좁은 공개 인터페이스, 런타임 스키마 검증.
- Domain은 Electron/UI SDK와 독립; provider wire protocol은 adapter 내부로 한정.
- Renderer는 OS 권한을 갖지 않음. Main/preload IPC는 method allowlist와 payload validation.
- 원격 입력은 제어 정보가 아니라 데이터로 취급.
- 단일 책임, 명확한 cancellation/timeout, idempotent state transition.
- 테스트 가능한 순수 함수(상태 전이, 모션 선택, 승인 계산) 우선.
- 호환되지 않는 계약 변경 시 schema version 및 migration 계획 필요.

## 브랜치 및 PR

- 기본 브랜치 `Develop`(2026-10-31 확인). 변경 전 현재 브랜치를 다시 확인.
- 권장: `feat/<short>`, `fix/<short>`, `docs/<short>`.
- PR에 사용자 요구사항 ID, 설계 근거/ADR, 테스트 결과, 안전 영향, 미검증 항목 표시.
- CI 없이 구현 완료를 단정하지 않으며 미검증 사항은 Known Limitations로 남긴다.

## 문서 작성 및 상태 업데이트

문서/설계 상태는 Proposed/Spike-required/Verified/Blocked로 표현. **Verified는 외부 기능에 대한 공식 확인일 수 있지만 앱 코드 구현됨을 뜻하지 않는다.** 구현 완료 여부는 PR+테스트 근거로 별도 표시.

## 코드 스타일과 보안

- 비밀값은 키체인/OS 보호 저장소, repo에는 예제 .env만.
- 명시적 오류 타입과 안전한 메시지·진단 코드.
- model 파일, 라이선스가 있는 TTS 음성, screenshot, logs, SQLite DB는 자동 제외.
- 정기적으로 공식 공급자 문서와 SDK 라이선스 변경 확인.
