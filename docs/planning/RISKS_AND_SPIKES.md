# 기술 리스크, 실증 계획 및 열린 질문

**상태:** Open / 부분 실증 · 결과가 없는 항목에 '성공' 표시 금지. 2026-10-31에 Hermes SSH의 전용 새 세션 왕복·receipt 복구와 로컬 모델 렌더/실제 Jev 판단을 확인했다. 이것은 HTTP 실증·기존 canonical Bot Chat·Grok·Windows 실험의 완료가 아니다. 수행 범위와 증거는 [IMPLEMENTATION_STATUS](../development/IMPLEMENTATION_STATUS.md)를 따른다.

## 위험 레지스터

| ID | 위험 | 영향 | 대응 | 상태 |
|---|---|---|---|---|
| R-001 | Grok Bot은 양방향 실시간 Chat API를 공개하지 않았을 수 있음 | 기존 Bot의 대화 기능 차단 | Webhook/callback 실증, UI 차단 상태 지원 | Spike-required |
| R-002 | Webhook Routine과 기존 Bot Chat의 세션/기억 연속성 불명확 | 사용자가 기대한 동일 봇 경험 훼손 | 실제 Bot Chat에서 양방향 검증 | Spike-required |
| R-003 | Hermes Bot Mode canonical session을 외부에서 식별 못할 수 있음 | 새 세션으로 이탈 | 프로필 vs Bot Chat을 구분한 테스트 | Spike-required |
| R-004 | 공급자/서비스 업데이트로 RPC 필드가 변경 | 연동 장애 | 버전 고정, capability 검사, 계약 테스트 | Ongoing |
| R-005 | Live2D SDK/모델 재배포 권리 미확인 | 배포 불가 | 라이선스 리뷰, 사용자 로컬 모델 경로 기본 | Spike-required |
| R-006 | 오디오 지연·모션 충돌 | 부자연스러운 캐릭터 | 음성 재생 기준으로 동기화, 모션 우선순위 | Proposed |
| R-007 | 화면 데이터 유출·도구 오남용 | 높은 보안 위험 | 명시적 캡처, 승인, scoped one-shot tool | Proposed |
| R-008 | 비동기 webhook 반복 호출이 사용량 소비 | 비용/한도 소진 | rate limit, no blind retry, 상태 UI | Proposed |

## S-001 Hermes transport

**가설:** 공식 API를 통해 텍스트 응답·스트리밍·기본 세션을 제어할 수 있다.

- 환경: Hermes version, OS, API mode, profile, authentication (비밀 제외).
- 절차: 한 세션에서 A→B 2턴, SSE events와 terminal status 수집, cancel/reconnect, tool event.
- 통과: 유일한 request/session 매핑, 중복 terminal 없음, 실패 상태 구분.
- 산출물: 재현 명령(토큰 마스킹), 응답 필드, 캡처 시간, 테스트 링크.

## S-002 Hermes canonical Bot Chat

**가설:** 외부 어댑터가 기존 Bot Mode의 고정 Bot Chat에 연결 가능하다.

- 고유한 프로필/호스트/원래 Bot Chat에서 식별 가능한 테스트 메시지 작성.
- 연결 후 메시지를 보내고 원래 Hermes Desktop에서 같은 Bot Chat에 나타나는지 확인.
- 앱 재실행/에이전트 전환/remote restart 뒤 연속성 시험.
- 통과 실패 시 지원 범위는 '일반 Hermes 세션'으로 한정.

## S-003 Grok Webhook → callback

**가설:** 기존 Bot에 Webhook으로 메시지를 보내고 승인된 수단으로 외부 HTTPS endpoint에 응답을 전달받을 수 있다.

- 테스트 Bot·Routine·비밀키 준비, safe noop body 전송.
- `HTTP 200`과 Bot Chat run 생성 확인을 분리해서 기록.
- 승인된 Bot 기능으로 nonce, request_id, reply payload를 callback에 POST 가능한지 조사.
- 성공 시 인증/중복/지연/실패·재시작/레이트 제한까지 검증.
- 실패 시 클라이언트의 Grok chat adapter를 비활성화(사용자에게 이유 공개).

## S-004 Grok Bot continuity

**가설:** Webhook run은 사용자가 기대하는 기존 Bot의 기억·대화 문맥에 접근할 수 있다.

- Bot에 미리 알려 둔 비민감한 식별 정보로 기억 일관성 검사.
- Webhook run이 동일 대화 thread에 연결되는지 별도로 확인.
- **기억 접근과 동일 Bot Chat thread의 일치**는 다른 성공 조건.
- 결과/제약이 모두 입증되기 전 문구에 '동일 대화' 사용 금지.

## S-005 Live2D 라이선스와 런타임

- Cubism SDK/Core/MotionSync 버전·EULA·배포 형태 검토.
- 권리 있는 샘플 모델로 Windows Electron WebGL 렌더, parameter discovery, 오디오 lip sync 시험.
- 모델 파일 누락/리깅 부족/권한 없음 fallback 확인.

## S-006 Windows 권한/창

- 여러 모니터·DPI에서 투명 창, 클릭 통과, 승인창 포커스 테스트.
- Windows 캡처 대상 선택 및 보호 창 제약, 메모리 버퍼 제거 확인.
- PC 도구 안전 모델 검토 전 실제 입력 자동화는 구현하지 않음.

## 실험 기록 템플릿

~~~md
### S-NNN 결과
- 상태: PASS / PARTIAL / FAIL / BLOCKED
- 날짜/제품 버전:
- 환경/권한:
- 수행 단계 및 재현:
- 관찰된 응답/시간/오류(비밀 마스킹):
- 보안/약관/비용 영향:
- 증거 링크(민감정보 비포함):
- 결정: 지원 가능 범위 / 보류 / 다음 실험
~~~

## Open Questions

- 사용자가 선택할 Grok Bot의 표시·식별 수단 및 webhook 생성 권한은?
- Grok Bot의 외부 HTTPS callback이 가능한가? 사용자가 켜야 할 기능은 무엇인가?
- Hermes Bot Mode 영구 Chat을 외부 RPC에서 공식적으로 지정할 수 있는가?
- TTS 우선순위(로컬/클라우드), 음성 언어, 사용자 소유 Live2D 모델의 리깅 범위는?
- 음성 및 PC 도구의 실행 승인 UX를 어떤 단계에서 공개할 것인가?

답을 알기 전 임의의 식별자나 공급자 권한을 가정하지 않는다.
