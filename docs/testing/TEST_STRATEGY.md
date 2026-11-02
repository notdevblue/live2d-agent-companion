# 테스트 및 검증 전략

**상태:** 초기 Unit/Contract 및 Linux headless 통합 검사 구현. 현재 결과/재현은 [IMPLEMENTATION_STATUS](../development/IMPLEMENTATION_STATUS.md) 참조. 아래 전체 계획을 통과했다는 의미는 아니다.

## 테스트 피라미드

- **Unit**: event validation, state transitions, idempotency, Director priorities, TTS queue, permission decision.
- **Contract**: Mock Hermes/SSE/JSON-RPC, Mock Grok webhook/callback, runtime schema validation.
- **Integration**: 실제 Hermes test host, 실제 Grok Bot test Bot(연동 가능 확인 후), Live2D SDK, Windows audio/device.
- **E2E**: Windows 11 실제 앱 실행, UI/권한/네트워크 장애/재시작/다중 모니터.
- **Security**: 공격성 payload, 악성 callback, 잘못된 IPC sender, 권한 재사용/만료/도구 변경.
- **Performance**: 모델별 FPS/CPU/GPU/메모리, TTS start latency, turn state latency.

## 계약 테스트 매트릭스

| 테스트                       | Hermes                   | Grok(실증 후)         | Mock      |
| ---------------------------- | ------------------------ | --------------------- | --------- |
| 텍스트 왕복                  | required                 | conditional           | required  |
| 텍스트 delta 스트리밍        | required where supported | not assumed           | required  |
| 기존 Bot Chat 바인딩         | spike                    | spike                 | simulated |
| 승인 요청/거절               | required where supported | not assumed           | required  |
| 취소/interrupt               | required where supported | not assumed           | required  |
| webhook accepted ≠ completed | n/a                      | required              | required  |
| 중복/late/잘못된 callback    | n/a                      | required if callback  | required  |
| 오프라인·재시작 복구         | required                 | required if available | required  |

## 중요 시나리오

- E-001: `accepted` 후 callback 미도착 → 로컬 timeout 안내 + reconciling 유지, success 표시 및 같은 세션 재전송 금지.
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
- E-012: streaming → disconnect → reconciling → 원래 run 재구독 → completed 1회. 복구 누적 본문은 snapshot으로 교체하고 TTS 재생 0회.
- E-013: reconciling 중 같은 세션 새 submit → 차단. 원격 terminal/미접수 확인 후에만 lease 해제. 별도 세션은 독립적으로 사용 가능.
- E-014: 미종결 요청 상태 저장 → 앱 재시작 복원 → reconciling과 lease 유지. 조회 불가/복구 미지원도 종료나 자동 재전송으로 바뀌지 않음.
- E-015: 공급자 승인 거절 → 원래 승인에 deny 응답 1회. 잘못된 binding/turn/request/approval과 중복 응답은 재적용 0회, 로컬 PC 권한 발행 0회.
- E-016: 승인 대기 중 만료/서버 철회/다른 클라이언트 응답 → 해당 UI만 닫힘. 승인 전송 ack 유실 시 unknown 표시 후 실제 open_requests와 대조.
- E-017: 종료 확인된 실패의 사용자 재전송 → 같은 turn_id/새 request_id. 과거 요청의 late complete는 새 요청의 상태를 변경하지 않음.
- E-019: 30초 무이벤트/restore→자동 reconcile, 진행 중+replay 만료에서도 감시 지속→terminal 1회. 조회 실패는 최초+5회 backoff 뒤 lease 유지/수동 안내. 중복 조회·이전 요청 finally·dispose·승인 만료·snapshot 승인 복원·복구 Jev 0회 회귀 검사(`core.test.ts`, `adapters-ssh.test.ts`).
- E-018: accepted → 비스트리밍 completed 및 accepted/awaiting_result → 로컬 timeout → reconciling → 인증된 늦은 완료 수신. 각 request의 terminal 반영 1회.

E-012~018은 [ADR-0003](../planning/adrs/0003-request-recovery-and-approvals.md)의 회귀 기준이다. 첫 core PoC에서는 가짜 clock과 메모리 상태의 저장/복원으로 검증하고, 실제 앱 재시작·네트워크·Hermes 검증은 Integration/E2E 단계에서 별도로 기록한다.

## 릴리스 품질 문턱

`FR-CHAT-002/FR-UI-002`: `tests/chat-rendering.test.ts`는 Markdown 구조, 부분 fence의 교체, user 원문, HTML/URL/image 속성 미생성, 전송 강제 하단/응답 하단 추적 정책을 검사한다. Electron fixture에서 실제 레이아웃 변경 전/후 스크롤과 가로 overflow·외부 요청 0회를 따로 검사한다. `FR-DIR-005`: `tests/director.test.ts`, `core.test.ts`, `acting.test.ts`는 메시지당 판단 1회·문장 큐 없음·새 메시지 즉시 전환·수집/본문/호출/나이 한도·generation/승인/교체 취소를 검사한다. `adapters-ssh.test.ts`는 null 경계/비스트리밍 interim·receipt 종결·다중 snapshot 복구를, `history.test.ts`와 `assistant-messages.test.ts`는 bubble별 순서/갱신/복원·중복 방지를 검사한다. 실제 테스트 세션의 read_file 두 단계에서 중간 응답→최종 답변·메시지당 Jev 1회와 종료 뒤 재생 큐 없음을 따로 확인한다.

`FR-CHAT-001`: `tests/history.test.ts`는 동시 로드·실패 후 재조회·답변 교체·동일 본문인 다른 요청 구분·snapshot 격리·복원 요청의 provider 기록 사용·원격 sidecar 제거를 검사한다. `tests/adapters-ssh.test.ts`는 정확한 binding/세션 검사와 prompt 없는 history 조회를 고정한다. Mock desktop은 실제 창 reload/닫기·재열기·다른 세션으로 전환 후 복귀를 검사하며 앱 프로세스 재실행은 실제 SSH에서 원문 없는 결과만 기록한다.

1. `docs/specs/ACCEPTANCE_CRITERIA.md`의 해당 Phase 수락 조건 통과.
2. 기술 검증 결과 및 공식 근거 업데이트.
3. secrets scan, dependency/vulnerability review, IPC/permission review.
4. 입력 검증·timeout·cancel·error UX 테스트.
5. 문서와 구현 상태 불일치 0건, Known Limitations 표기.

## 테스트 데이터 관리

민감정보 없는 mock transcript를 이용한다. 실제 Hermes/Grok credential, 개인 대화, 유료 Live2D 모델 자산을 fixture로 커밋하지 않는다. 외부 공급자 테스트는 별도 테스트 전용 Bot/프로필과 최소 권한/비용 제한으로 수행. 결과 로그는 토큰과 원문을 마스킹한다.

## CI 목표(미구현)

현재 `npm run typecheck`, `npm test`, `npm run build`, `npm run test:desktop`이 있다. CI 자동 실행은 아직 없다. desktop 검사는 모델/SDK를 준비한 뒤 실행하며 기본은 Mock 응답+명시적 표현 fixture이다. 실제 Hermes/Jev 검사는 별도 로컬 연결 설정과 비밀 입력으로만 수행하며 CI fixture로 키/자산을 업로드하지 않는다.

- 메시지/배경 연기 우선순위: streaming 기본 상태, 생각/도구 상태 변화 중 동일 reaction 궤적, 짧은 반응 뒤 긴 paired pose의 복귀 완주, 사용자 대기 clip 교체와 cooldown, 새 요청/승인/복구/취소 경계 정리를 검사한다(`director.test.ts`, `acting.test.ts`, `avatar.test.ts`). 실제 DeepSeek/SDK fixture 수치 검증과 실서비스 진행 응답 품질 검증은 구분한다.

## 실제 모델의 표현 렌더 검사

`npm run test:expression -- --model <로컬 model3.json>`은 실제 SDK와 모델로 고정 시각을 렌더한다. 수백 PNG를 생성하는 전체 작업과 한 장면의 정체를 구분한다. renderer 준비·장면 시작·이미지 저장의 IPC 진행을 받을 때90초 정체 제한만 갱신하며, 전체300초 상한은 갱신하지 않는다. timeout은 마지막 mode/scene·경과 시간과 실패 결과를 남긴다. 진행 없는 지연·전체 한도·늦은 성공 종료가 실패를 성공으로 바꾸지 않는 경계도 확인한다. 이 제한은 검사 프로세스의 장애 감지용이며 실시간 FPS·제품 성능 수락 기준이 아니다.

구조 정리는 cue 소유권과 상태를 `acting.ts`에, 상태 없는 시간/자세/얼굴 계산을 `acting-phrases.ts`에 둔다. 외부 API와 기존 의미/미리보기·강도/접근성·수명/clear 출력 보존을 확인한 근거는 [연기 설계](../ux/ACTING_DESIGN.md#구조-정리-검증-2026-11-03)와 [구현 상태](../development/IMPLEMENTATION_STATUS.md)에 연결한다.
