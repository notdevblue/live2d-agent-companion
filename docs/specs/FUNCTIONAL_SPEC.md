# 기능 명세 (FR)

**상태:** Proposed · **우선순위:** P0 핵심, P1 중요, P2 후속

## 창과 캐릭터

| ID | 우선 | 요구사항 |
|---|---|---|
| FR-UI-001 | P0 | Windows 11에서 평소 배경·테두리·제목 표시줄·패널 없이 모델만 보이고 항상 위 선택·모델 드래그 이동 가능한 Live2D Overlay MUST 제공 |
| FR-UI-002 | P0 | 채팅 패널 표시/숨기기·입력·스크롤·기본 키보드 조작 MUST 제공 |
| FR-UI-003 | P0 | 클릭 통과/포커스/작업표시줄/다중 모니터 동작을 설정 가능하게 설계 |
| FR-UI-004 | P1 | 트레이 아이콘·게임/전체화면 시 숨김 옵션 SHOULD 제공 |
| FR-UI-005 | P0 | 사용자 지정 Linux/Sway 로컬 환경에서는 모델 창을 모든 작업공간·전체화면 위에 표시 가능하게 하고, 왼쪽 드래그·드래그 중 휠 배율·투명 영역 통과 후 모델 재진입 및 앱 재실행 뒤 설정 복원을 검증 MUST. native Wayland·Windows 검증과 구분 |
| FR-L2D-001 | P0 | 사용자가 지정한 `.model3.json` 로딩, 실패 원인 및 의존 자산 검증 MUST |
| FR-L2D-002 | P0 | idle/blink/breathing 기본 상태와 표현 불가 모션 fallback MUST |
| FR-L2D-003 | P1 | talking/thinking/working/success 상태 및 사용자 정의 모션 매핑 MUST |
| FR-L2D-004 | P1 | 여러 표정과 모션 충돌 시 우선순위·전환·인터럽트 제어 MUST |

## 에이전트

| ID | 우선 | 요구사항 |
|---|---|---|
| FR-AG-001 | P0 | `AgentAdapter` 인터페이스 및 capability discovery MUST |
| FR-AG-002 | P0 | 에이전트 선택·연결 상태·이벤트 표시·비밀정보 없는 로컬 설정 저장 MUST |
| FR-AG-003 | P0 | 요청마다 provider/agent/session/turn/request 식별자를 분리 MUST |
| FR-AG-004 | P0 | 답변 유실·중복·타임아웃·취소·late event를 정의된 상태 머신으로 처리 MUST |
| FR-AG-005 | P1 | Hermes HTTP/SSE 또는 Gateway JSON-RPC 연결 및 인증 방식 지원 MUST |
| FR-AG-006 | P1 | Hermes 세션·프로필 및 기존 Bot Chat 동일성 확인 절차 MUST |
| FR-AG-007 | P1 | Hermes 메시지 델타·툴 이벤트·승인·취소 지원 MUST (지원 capability별) |
| FR-AG-008 | P1 | Grok Bot Webhook Routine 호출을 실험적 어댑터로 분리 MUST |
| FR-AG-009 | P1 | Grok 응답 Callback/연속성 실증 전 기능을 '실시간 대화 지원'으로 표시 금지 MUST |
| FR-AG-010 | P1 | 공급자 전환 후 과거 세션의 late response 격리 MUST |
| FR-AG-011 | P2 | 음성 입력, 다중 봇 동시 표시, 사용자 정의 공급자 어댑터 MAY |
| FR-AG-012 | P0 | 연결 끊김·로컬 timeout·재시작은 `reconciling`으로 처리하고 원격 종료/미접수 확인 전 세션 lease 유지 및 같은 세션의 새 제출 차단 MUST |
| FR-AG-013 | P1 | 공급자 승인 응답을 binding/turn/request/approval에 바인딩하고 거절 전달·만료·철회·중복·응답 적용 불명 상태를 로컬 PC 승인과 분리하여 처리 MUST |

## 음성과 표현

| ID | 우선 | 요구사항 |
|---|---|---|
| FR-TTS-001 | P1 | 교체 가능한 `SpeechSynthesizer` / provider 선택 MUST |
| FR-TTS-002 | P1 | 사용자에게 보여지는 답변 본문만 발화 MUST |
| FR-TTS-003 | P1 | 음소거·볼륨·음성 선택·중단·재생 실패 시 자막 fallback MUST |
| FR-TTS-004 | P1 | 오디오 재생 시각에 동기화한 RMS 또는 phoneme 립싱크 MUST |
| FR-TTS-005 | P1 | 텍스트/문장 단위 스트리밍과 안전한 오디오 큐 SHOULD |
| FR-DIR-001 | P1 | 이벤트→캐릭터 상태 전환을 독립된 Character Director가 담당 MUST |
| FR-DIR-002 | P1 | 무조건적 LLM 감정 추론 없이 결정적 기본 규칙을 제공 MUST |
| FR-DIR-003 | P1 | Jev 표현 판단은 명시적으로 켠 경우 표시용 답변의 제한된 구간에만 비동기로 수행 MUST. 텍스트 표시를 막지 않고 확신 부족/timeout은 neutral fallback, 취소·전환·이전 구간의 지연 결과는 폐기 |

## 화면/PC

| ID | 우선 | 요구사항 |
|---|---|---|
| FR-SCR-001 | P2 | 화면 캡처는 명시적 사용자 제스처 후 모니터/창/영역을 선택 MUST |
| FR-SCR-002 | P2 | 미리보기·일회성 전송 확인·대상 에이전트 표시 MUST |
| FR-SCR-003 | P2 | 이미지 미지원 공급자에는 원본 캡처를 전송하지 않음 MUST |
| FR-PC-001 | P2 | PC 도구 호출은 구조화된 tool request + 허용 목록 검증 MUST |
| FR-PC-002 | P2 | 실행 전 범위 제한 승인/거절 UI 및 kill switch MUST |
| FR-PC-003 | P2 | 파일 변경·명령 실행·네트워크 전송·고위험 UI 조작은 별도 위험 단계 적용 MUST |
| FR-PC-004 | P2 | 실행 결과는 현재 승인된 요청에만 바인딩 MUST |

## 공통 설정/관찰성

| ID | 우선 | 요구사항 |
|---|---|---|
| FR-SET-001 | P0 | 에이전트·모델 경로·TTS·캐릭터 상태 매핑 설정 MUST |
| FR-SET-002 | P0 | 키/토큰은 OS 보호 저장소 사용 MUST |
| FR-OBS-001 | P0 | 연결/요청/재시도/오류 상태를 개인 정보 없이 사용자에게 표시 MUST |
| FR-OBS-002 | P1 | 사용자가 감사 로그/전송 데이터 삭제 가능 MUST |

**참고:** 요구사항이 실제 구현·공급자 확인을 의미하지 않는다. 완료 여부는 `ACCEPTANCE_CRITERIA.md`와 테스트 결과로만 판단한다.
