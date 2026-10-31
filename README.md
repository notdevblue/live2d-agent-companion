# Live2D Agent Companion

기존 AI 에이전트(**Grok Bot**, **Hermes Agent**)를 Live2D 데스크톱 캐릭터와 연결하는 Windows 우선 오픈소스 프로젝트입니다.

> **상태:** 설계 단계. 이 저장소의 문서는 목표 사양이며 구현 완료를 의미하지 않습니다.

## 프로젝트 목표

- 기존 Grok Bot의 정체성·대화 흐름을 유지하면서 Live2D로 표현하는 통합 경로 검증
- Hermes Agent의 개별 프로필/Bot Chat을 연결하는 실시간 대화·작업 이벤트 지원
- 에이전트와 독립된 Live2D/TTS/립싱크/행동 시스템
- 사용자 요청 시 화면 캡처 및 승인 기반 PC 조작으로 단계적 확장
- 공급자별 기능과 제약을 노출하는 **Agent Adapter** 구조

## 문서 시작점

- [문서 전체 목차](docs/README.md)
- [제품 요구사항](docs/product/PRD.md)
- [기능 명세](docs/specs/FUNCTIONAL_SPEC.md)
- [시스템 설계](docs/architecture/SYSTEM_DESIGN.md)
- [개발 로드맵](docs/planning/ROADMAP.md)
- [AI 개발자 지침](AGENTS.md)

## 중요 사항

**Grok Bot의 Webhook Routine은 작업 시작 경로일 뿐, 공식 양방향 채팅 API로 검증되지 않았습니다.** 응답 콜백, 기존 Bot Chat 연속성, 호출 지연은 개발 초기 실험으로 확인합니다. 연결 불가 시 앱이 이를 명확히 알리고, 별개의 Grok 모델 API를 기존 Bot으로 오인시키지 않습니다.

Hermes Agent는 공식 프로그램 연동 인터페이스를 제공하지만, **정확한 기존 Bot Chat 세션 재연결** 역시 통합 실험에서 검증합니다.

## 개발 상태

코드는 아직 없습니다. 문서 내 `MUST/SHOULD/MAY`는 구현 대상의 요구 수준이며 현재 구현 기능을 나타내지 않습니다.

## 라이선스 및 모델 자산

프로젝트 소스의 라이선스와 Live2D Cubism SDK/Core·모델 자산의 라이선스는 별도로 확인해야 합니다. 권리 없는 `.moc3`, 텍스처, SDK 바이너리, API 키 또는 사용자 대화 기록은 커밋하지 않습니다.
