# AI 구현 플레이북

## 시작 절차

1. 저장소 브랜치/기존 파일과 최신 ADR 확인.
2. 요구사항 ID와 현재 Phase 확인: `docs/planning/ROADMAP.md`.
3. 해당 통합의 공식 API·버전·테스트 가능 환경 파악.
4. 입력/출력/오류/취소 계약부터 정의하고 Mock으로 테스트.
5. 가장 작은 수직 슬라이스를 구현하며 과도한 공통 추상화를 피함.
6. 테스트, 보안 리뷰, 문서 갱신 후 사용자에게 사실만 보고.

## 먼저 해결할 실증(Spikes)

- **S-001 Hermes API:** 독립 세션 → SSE 스트리밍·취소·승인 확인.
- **S-002 Hermes Bot Chat:** 특정 프로필의 **기존 영구 Bot Chat**에 안전하게 재접속 가능한지 확인.
- **S-003 Grok outbound:** Webhook Routine 호출 및 해당 Bot에서 외부 HTTPS 콜백을 보낼 수 있는지 확인.
- **S-004 Grok continuity:** Webhook으로 시작된 런이 기존 Bot Chat 기억/대화와 실제로 어떻게 연결되는지 확인.
- **S-005 Live2D rights:** SDK·배포·모델 파일 사용권, 샘플 로드·표정·립싱크 확인.
- **S-006 Windows:** 투명 창, 클릭 통과, 캡처 및 승인 UI의 권한 경계 확인.

Spikes 성공 전 공급자 어댑터를 `stable`로 표기하지 않는다.

## 권장 구현 순서

1. 스키마·타입·상태 머신·Mock Agent Adapter
2. Electron main/preload/renderer의 최소 보안 뼈대
3. Live2D 로딩 + idle/talking 모션
4. 채팅 UI + 메시지 이벤트/중단
5. Hermes Adapter → 실제 스트리밍
6. TTS/오디오 + 립싱크 + Character Director
7. Grok Bot Integration (기술검증 성공 시)
8. 요청 기반 화면 공유, 승인 기반 PC tools

## 테스트 더블

- Hermes mock: delta, complete, tool.start, approval, disconnect, duplicate, cancel
- Grok mock: accepted/no callback, delayed callback, duplicate/out-of-order callback, timeout, invalid signature
- TTS mock: audio chunk, interruption, device loss
- Live2D mock: missing params/motions/texture/unsupported model
- Windows mock: capture denied, changed monitor topology, expired approval

## 문서 유지

동작을 변경하면 관련 FR/NFR, 수락 시나리오, 데이터/이벤트 스키마, 구현 상태, ADR과 근거 링크를 함께 바꾼다. 공급자 SDK 표면 변경 시 마이그레이션 위험과 하위 호환성을 기록한다. 소스가 아직 없다면 코드 생성을 시작하기 전에 PoC와 재현 가능한 테스트 명령을 먼저 작성한다.
