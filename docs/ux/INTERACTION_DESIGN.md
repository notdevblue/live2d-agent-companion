# UI/UX 및 캐릭터 상호작용 설계

**상태:** Proposed

## 화면 구성

1. **Character Overlay:** 투명 Live2D 캔버스, 드래그 핸들, 선택적 클릭 통과, 작은 상태 아이콘.
2. **Chat Panel:** 텍스트 입력, 메시지/자막, 보내기/취소, 첨부, 입력 중 표시.
3. **Agent Switcher:** 공급자 아이콘, 연결 상태, 봇 이름, 현재 세션, capability.
4. **Action Panel:** 진행 중 도구·요청된 승인·보류된 작업·중단 버튼.
5. **Settings:** 모델 경로·표정 매핑·음성·공급자 연결·프라이버시/권한.

## UI 플로우와 의미

| 상태 | 표시 문구 예시 | 캐릭터 |
|---|---|---|
| disconnected | 연결되지 않음 | idle |
| connecting | 연결 중 | idle |
| submitted | 보내는 중 | thinking |
| accepted (async) | Grok Bot이 요청을 받음 · 답변 대기 | thinking |
| streaming | 응답 작성 중 | thinking → talking(음성 재생 시) |
| tool.started | 작업 진행 중 · 자세히 보기 | working |
| approval.requested | 승인 필요 · 실행 전 확인 | neutral, 제스처 중단 |
| completed | 답변 완료 | talking → idle |
| reconciling (disconnect/timeout) | 원격 실행 상태 확인 중 · 같은 세션 전송 보류 | error → idle |
| failed | 요청 실패 확인 · 재시도 가능 여부 표시 | error → idle |
| unsupported | 이 연결은 해당 기능을 지원하지 않음 | idle |

'보내기 성공'과 '답변 완료'는 서로 다른 상태. 특히 Grok Bot의 callback 미도착은 성공으로 표시하지 않는다.

## 캐릭터 상호작용

- 클릭: 기본 표정 반응(옵션), 앱 포커스 및 채팅 열기.
- 드래그: 위치 이동; 화면 경계 밖 이동 시 복구 단축키.
- 마우스 바라보기: 사용자 ON/OFF 및 움직임 완화 옵션.
- idle: 눈 깜빡임/호흡/미세한 움직임. 과도한 시선 추적·음성 자율발화는 기본 비활성화.
- speaking: TTS 실제 출력 시간에 립싱크.
- working: 원격 도구 상태를 표현하되 사용자의 PC에서 실제 조작 중이라는 오해가 없도록 텍스트와 함께 표시.
- approval: 캐릭터 애니메이션보다 승인이 우선, 수락/거절의 클릭 영역이 안정적이어야 함.

## 에이전트 전환 설계

- 전환 전에 '기존 요청이 계속 실행 중' 여부를 표시.
- 미완료 요청은 탭 내에 남기며 새 에이전트 대화에 합쳐지지 않음.
- voice/model override는 `per-agent` 또는 `global`로 선택; 미설정 시 글로벌로 fallback.
- 특정 봇의 이름·아이콘은 실제 공급자 표시와 매핑, 존재하지 않는 봇의 기억을 있는 것처럼 표현하지 않음.
- capability 불일치(예: Grok 비동기, 이미지 미지원)는 전환 화면에서 노출.

## 승인 및 프라이버시 UX

스크린샷 전송 버튼은 **선택 → 미리보기 → 전송 확인** 단계를 따른다. 수신 에이전트와 캡처 영역을 표시. PC 도구 승인 UI는 행동/대상/예상 영향/기한, '이번 한 번 허용'과 '거절'을 제공하며 임의 광범위 영구 허용 버튼은 초기 버전에 만들지 않는다.

## 접근성

- UI 글자 크기, 대비, 키보드 탐색, ESC 닫기, 단축키, 발화 자막 지원.
- reduced motion, 음소거, 알림 끄기, 포커스 복구 제공.
- 눈에 띄는 연결 오류와 재설정 안내, 음성만으로 상태 알리지 않음.

## 반응 우선순위

`approval/security > user interaction > speech playback > tool execution > thought > idle`. 단일 모션 슬롯으로만 구현 가능한 모델에서도 안전 상태가 우선한다.
