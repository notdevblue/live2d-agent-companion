# Live2D Agent Companion

기존 AI 에이전트(**Grok Bot**, **Hermes Agent**)를 Live2D 데스크톱 캐릭터와 연결하는 Windows 우선 오픈소스 프로젝트입니다.

> **상태:** 초기 Electron 통합 구현. DeepSeek-chan 렌더 → Hermes 실제 왕복 → Jev 표정/모션 판단과 Sway/Xwayland 창·입력 경로를 실증했습니다. Windows 11 배포·클릭 통과 검증은 남아 있습니다.

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

모델만 보이는 투명 Overlay와 별도 채팅/설정 창, 요청 상태 관리, Hermes SSH/HTTP 어댑터, 비동기 Jev Character Director가 있습니다. Grok은 실험적 Webhook 제출만 구현했으며 응답 callback은 지원하지 않습니다. 기존 Bot Chat의 동일성은 별도 검증 대상입니다.

### 로컬 실행

Node.js 22.12 이상, npm, Git, Python 3, SSH 키 인증 가능한 OpenSSH 클라이언트가 필요합니다. 모델과 Cubism SDK는 저장소에 포함하지 않습니다.

~~~sh
npm ci
npm run setup:electron
npm run setup:live2d
npm run setup:model
npm run typecheck
npm test
npm run build
npm start
~~~

`setup:model`은 `~/Downloads/DeepSeek-chan*.zip`에서 런타임 파일만 `local-assets/`에 준비합니다. 다른 ZIP 경로는 `npm run setup:model -- /path/to/model.zip`으로 지정합니다. Core 다운로드는 공식 라이선스 적용 대상이며 로컬 개발용으로만 준비합니다.

캐릭터를 클릭하면 채팅이 열리고 왼쪽 드래그하면 이동합니다. 잡은 상태에서 휠로 크기를 **0.4~4배**까지 조절하며 위치·크기는 재실행 후에도 유지됩니다. 같은 범위는 ⚙ → 캐릭터 → 캐릭터 크기에서도 설정합니다. 조작은 사용자 지정 레퍼런스인 Steam [your wife](https://store.steampowered.com/app/3339420/your_wife/?l=english)의 공식 안내를 참고했습니다. `Ctrl+Shift+Space`는 채팅/설정, `Ctrl+Shift+Home`은 위치 복구입니다. 창 없는 상태의 조작은 트레이 메뉴에서도 가능합니다.

다른 모니터로는 그대로 드래그하거나 **채팅 창 ⚙ → 캐릭터 → 모니터 선택 → 선택한 모니터로 이동**을 사용하세요. 위치는 즉시 저장되며 별도 연결 저장은 필요하지 않습니다. 화면 경계 제한이 없어 하반신을 화면 아래로 내려 상반신만 표시할 수 있습니다. 부분 표시 위치도 재실행 후 유지하며, 완전히 사라졌으면 위치 복구 단축키를 사용하세요.

**⚙ → 캐릭터**에서 연출 강도(조용함/기본/과장), 구도(전신/상반신/얼굴 근접), 위치 잠금, 움직임 줄이기를 바로 변경하고 저장할 수 있습니다. 구도는 모델 canvas 안에서만 바뀌며 저장한 창 위치·배율·모니터를 옮기지 않습니다. 위치 잠금은 드래그/휠 이동만 막고 표정·연기는 계속됩니다. 생각/설명/쑥스러움/장난/기쁨 미리보기와 초기화는 메시지·Jev 호출 없이 동작하며, 실제 요청·승인 중에는 사용할 수 없습니다.

캐릭터는 시선→고개→몸이 시간차를 두고 반응하고 표정을 부드럽게 전환합니다. DeepSeek의 손동작은 기존 진입·복귀 자산 사이에 짧은 유지 구간을 둡니다. Jev를 켜면 감정·제스처와 함께 제한된 말하는 태도(`neutral/explain/tease/shy/reassure`)를 판단하며, 움직임 타이밍은 로컬에서 처리합니다. 이는 TTS/립싱크 지원을 뜻하지 않습니다.

Sway에서는 Xwayland로 실행하며(사용자가 backend를 지정하지 않고 `DISPLAY`가 있으면 자동 선택), 항상 위 설정을 켜면 모델 창만 WM 관리에서 제외해 작업공간·전체화면 위에 표시합니다. 클릭해서 여는 채팅·설정 창은 포커스 가능한 floating 창으로 표시합니다. Linux 입력 영역 helper의 빌드에는 C 컴파일러와 X11/Xext 개발 헤더가 필요합니다. 준비되지 않으면 클릭 통과를 미지원으로 표시합니다. native Wayland 클릭 통과와 Windows 실사용 검증은 별도입니다.

설정에서 `ssh://user@host`와 Hermes 프로필을 저장한 뒤 기존 세션을 조회/선택하거나 **도구가 꺼진 테스트용 새 세션**을 만들 수 있습니다. 일반 HTTP는 API 소유 세션 전용입니다. 개인 주소·세션은 앱 설정 또는 ignored `local-assets/connection.json`에만 보관합니다. 해당 파일 생성은 `npm run configure:local -- --endpoint ssh://user@example.test --profile default --session SESSION_ID`입니다.

Jev는 설정에서 켜고 키를 입력합니다. 표시용 답변 구간만 TypeSafe로 보내며 텍스트 표시를 지연시키지 않습니다. 인증키는 OS 보호 저장소로 암호화하고, 보호 저장소가 없으면 메모리에서만 유지합니다.

사용자가 직접 준비한 프로젝트 루트 `.env`도 시작 시 읽습니다. `.env.example`의 `JEV_API_KEY=` 또는 `TYPESAFE_API_KEY=` 형식과 `apikey_…` 키 한 줄 형식을 지원합니다. Unix에서는 현재 사용자 소유·권한 `600`이 필요합니다. 값은 main에서만 읽고 `process.env`나 renderer에 전달하지 않습니다. `.env`가 있으면 앱 재실행 때 그 값이 저장된 키보다 우선하며, 파일이 없고 보호 저장소도 없으면 키를 다시 입력해야 합니다. Jev 활성화 설정은 키 존재 여부와 별개입니다. 실제 `.env`는 Git에서 제외하며 비밀 파일은 별도로 복원하세요.

검증 범위·남은 기능·재현 명령은 [구현 및 검증 상태](docs/development/IMPLEMENTATION_STATUS.md)를 참고하세요. 문서의 MUST는 여전히 요구사항이며 구현 완료는 항목별 증거로 구분합니다.

## 라이선스 및 모델 자산

프로젝트 소스의 라이선스와 Live2D Cubism SDK/Core·모델 자산의 라이선스는 별도로 확인해야 합니다. 권리 없는 `.moc3`, 텍스처, SDK 바이너리, API 키 또는 사용자 대화 기록은 커밋하지 않습니다.

이번 로컬 검증의 DeepSeek-chan은 사용자가 제공한 자산입니다. 제공된 이용 안내의 크레딧은 Illustration/PSD: **Kamiya Ryoko**, Live2D Rigging: **霓虹猫_NeonNeko**입니다. 모델 파일은 재배포하지 않으며 공개 콘텐츠를 공유할 때 원 출처와 제작자를 표기해야 합니다.
