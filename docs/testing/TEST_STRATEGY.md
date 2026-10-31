# 테스트 및 검증 전략

**상태:** Planned · 현재 코드는 없으며 테스트 실행 결과도 없다.

## 테스트 피라미드

- **Unit**: event validation, state transitions, idempotency, Director priorities, TTS queue, permission decision.
- **Contract**: Mock Hermes/SSE/JSON-RPC, Mock Grok webhook/callback, runtime schema validation.
- **Integration**: 실제 Hermes test host, 실제 Grok Bot test Bot(연동 가능 확인 후), Live2D SDK, Windows audio/device.
- **E2E**: Windows 11 실제 앱 실행, UI/권한/네트워크 장애/재시작/다중 모니터.
- **Security**: 공격성 payload, 악성 callback, 잘못된 IPC sender, 권한 재사용/만료/도구 변경.
- **Performance**: 모델별 FPS/CPU/GPU/메모리, TTS start latency, turn state latency.

## 계약 테스트 매트릭스

| 테스트 | Hermes | Grok(실증 후) | Mock |
|---|---|---|---|
| 텍스트 왕복 | required | conditional | required |
| 텍스트 delta 스트리밍 | required where supported | not assumed | required |
| 기존 Bot Chat 바인딩 | spike | spike | simulated |
| 승인 요청/거절 | required where supported | not assumed | required |
| 취소/interrupt | required where supported | not assumed | required |
| webhook accepted ≠ completed | n/a | required | required |
| 중복/late/잘못된 callback | n/a | required if callback | required |
| 오프라인·재시작 복구 | required | required if available | required |

## 중요 시나리오

- E-001: `accepted` 후 callback 미도착 → timeout, success 표시 금지.
- E-002: callback 서명 또는 bearer 검증 실패 → reject, 원문 미노출.
- E-003: 같은 event_id 두 번 → 한 번만 상태 전이.
- E-004: A봇 답변 기다리는 중 B봇 전환 → A 응답은 A에만.
- E-005: TTS 중 stop → 오디오/모션/자막 상태 일치.
- E-006: Live2D model motion 미존재 → fallback, crash 없음.
- E-007: 캡처 미리보기 취소 → 네트워크 첨부 0 bytes.
- E-008: PC click 승인 만료/타깃 변경 → 실행 0건.
- E-009: renderer에서 임의 IPC/Node API 호출 시도 → 차단.
- E-010: Hermes gateway reconnect → open_requests/inflight 재구성(해당 버전에서 지원 확인).
- E-011: 같은 Hermes 프로필 새 일반 세션 ≠ 원래 Bot Chat → 잘못된 동일성 주장 금지.

## 릴리스 품질 문턱

1. `docs/specs/ACCEPTANCE_CRITERIA.md`의 해당 Phase 수락 조건 통과.
2. 기술 검증 결과 및 공식 근거 업데이트.
3. secrets scan, dependency/vulnerability review, IPC/permission review.
4. 입력 검증·timeout·cancel·error UX 테스트.
5. 문서와 구현 상태 불일치 0건, Known Limitations 표기.

## 테스트 데이터 관리

민감정보 없는 mock transcript를 이용한다. 실제 Hermes/Grok credential, 개인 대화, 유료 Live2D 모델 자산을 fixture로 커밋하지 않는다. 외부 공급자 테스트는 별도 테스트 전용 Bot/프로필과 최소 권한/비용 제한으로 수행. 결과 로그는 토큰과 원문을 마스킹한다.

## CI 목표(미구현)

추후 `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`를 단일 CI 단계에 넣는 방안을 제안. 아직 패키지/스크립트가 없으므로 이 명령이 실행 가능하다고 가정하지 않는다.
