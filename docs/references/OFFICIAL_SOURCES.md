# 공식 자료 및 근거 추적

**문서 확인일:** 2026-10-31 (KST). 외부 서비스와 SDK는 변경될 수 있으므로 구현 직전에 재확인.

| 공급자 | 공식 문서 | 이 프로젝트에서 확인한 내용 |
|---|---|---|
| Grok Bot | https://docs.x.ai/grok-bot/skills-routines-and-automations | Routine Webhook POST + Bearer; HTTP 200은 run accepted, completed 아님; 호출 제한. **양방향 chat API/callback 공식 보장 없음.** |
| Grok Bot | https://docs.x.ai/grok-bot/bots | 개별 Bot 생성/관리 개념(경로가 변경될 수 있어 구현 전에 재확인) |
| Hermes | https://hermes-agent.nousresearch.com/docs/developer-guide/programmatic-integration | HTTP/SSE, TUI JSON-RPC (stdio/WebSocket), ACP, method/event 목록 및 server request handshake |
| Hermes Bot Mode | https://hermes-agent.nousresearch.com/docs/user-guide/bot-mode | Bot은 프로필이며 canonical Bot Chat을 유지; 외부 클라이언트가 기존 Chat을 지정하는 방법은 별도 실증 필요 |
| Hermes Profiles | https://hermes-agent.nousresearch.com/docs/user-guide/profiles | profile별 환경/기억/세션/인증 분리 |
| Cubism Web | https://docs.live2d.com/en/cubism-sdk-manual/cubism-sdk-for-web/ | Cubism SDK for Web, SDK Core 패키지와 라이선스 별도 |
| Cubism LipSync | https://docs.live2d.com/en/cubism-sdk-manual/lipsync/ | 립싱크 parameter mapping |
| Cubism MotionSync | https://docs.live2d.com/en/cubism-sdk-manual/cubism-sdk-motionsync-plugin-for-web/ | Web MotionSync plugin, 별도 라이선스 조건 검토 |
| Electron | https://www.electronjs.org/docs/latest/tutorial/security | context isolation, sandbox, CSP, IPC, remote-content security guidance |
| Electron 창 | https://www.electronjs.org/docs/latest/tutorial/custom-window-styles | `frame: false`, `transparent: true`. 투명 영역 클릭 통과는 자동 제공되지 않으며 투명 창 리사이즈에 제약이 있음 |
| Electron 입력 | https://www.electronjs.org/docs/latest/api/base-window#winsetignoremouseeventsignore-options | 창 전체 mouse event 무시 및 Windows mousemove forwarding 옵션. 모델별 hit-test 조합은 별도 PoC 필요 |
| Electron Linux Overlay | https://www.electronjs.org/docs/latest/api/base-window | 생성 옵션 `focusable: false`는 Linux WM 관리에서 제외되어 모든 작업공간 위에 표시. 런타임 `setFocusable`는 Linux 미지원이므로 옵션 변경 시 Overlay만 재생성 |
| X11 입력 영역 | https://xorg.freedesktop.org/archive/X11R7.7/doc/xextproto/shape.html | Shape 1.1의 Input region은 표시용 bounding/clip과 별도다. Linux 클릭 통과는 모델의 입력 영역만 지정하며 Electron `setShape`의 표시 잘림을 피함 |
| 조작 레퍼런스 | https://store.steampowered.com/app/3339420/your_wife/?l=english | 사용자 지정 Steam `your wife`: 왼쪽 드래그, 드래그 중 휠 배율, 마우스 시선 추적. 2026-10-31 공식 설명 확인이며 직접 플레이 검증은 아님 |
| 버튜버 방송 영상 | https://www.youtube.com/watch?v=KNxKrlHpZxo&t=900s | 白上フブキ 본인 채널의 2.0 공개 방송 15:00~15:45를 연속 프레임으로 확인. 상반신의 작은 머리/눈/입 변화. 전체 시청·음성 동기 분석 아님 |
| Live2D 제작자 영상 | https://www.youtube.com/watch?v=UqwBaQ96iK8 | Iron Vertex 공식 쇼릴: 개요와 일부 상세 구간 프레임 비교. 모델 변형과 편집 컷/확대를 구분. 관찰 범위와 적용 제안은 [상호작용 설계](../ux/INTERACTION_DESIGN.md#버튜버-영상-조사와-표현-발전안) 참조 |
| hololive 공식 시연 | https://www.youtube.com/watch?v=TtB0GZLum1w&t=20640s | SUPER EXPO 2022 DAY2의 Live2D 3.0 소개 구간 프레임 확인. 손 포즈·특수 표정·근접 구도는 모델 리깅/구도와 구분 |
| VTube Studio 모델 설정 | https://github.com/DenchiSoft/VTubeStudio/wiki/VTS-Model-Settings | Movement Config, mapping/smoothing, Move Model의 위치·회전·배율·전환 시간, expression/animation hotkey. 우리 앱 구현/플러그인 연결 완료를 뜻하지 않음 |
| Shylily 제작자 영상 | https://www.youtube.com/watch?v=CK1_ONe0UNM | 2wintails 쇼케이스 0:00~0:08 연속 프레임에서 상체 높이/기울임·중심 변화를 확인. 고정 주기의 자동 호흡이라고 원인을 확정하지 않음 |
| Nazuna 제작자 영상 | https://www.youtube.com/watch?v=RDeRNF5BUqQ | Brian Tsui 쇼케이스 0:18~0:26 연속 프레임에서 고개와 어깨/상체 높이 변화 확인 |
| Vienna 제작자 영상 | https://www.youtube.com/watch?v=KqWia9RBjes | Brian Tsui의 Vienna 4.0 쇼케이스 0:16~0:23에서 자세와 상체 움직임 확인. 편집에 의한 확대는 작은 idle 움직임과 구분 |
| Cobalt 제작자 쇼케이스 | https://www.youtube.com/watch?v=3dzX8yKuT-Y&t=31s | Hooli Live2D: 0:27~0:45 상세 프레임에서 눈/미소/고개 조합. 편집 전환과 자동 연기를 구분 |
| Laimu 제작자 쇼케이스 | https://www.youtube.com/watch?v=Gu30oHOF-Lk&t=64s | cillia 본인 리깅 포트폴리오: 반눈/홍조/눈웃음·고개 결합. 480p 상세 재확인에서도 단안 윙크는 확정하지 못함 |
| Usagi 본인 제작 쇼케이스 | https://www.youtube.com/watch?v=25BSnSCAlCo&t=33s | Aquarelle Usagi: 얼굴 조합·양손 포즈, 컷 전환 때문에 pose 진입 시간을 측정한 근거는 아님 |
| VTube Studio 애니메이션 | https://github.com/DenchiSoft/VTubeStudio/wiki/Animations | Idle/one-shot, 마지막 프레임 유지·재생 시간 설정. 우리 앱의 pose sequence 설계 근거와 구분 |
| VTube Studio 적용 순서 | https://github.com/DenchiSoft/VTubeStudio/wiki/Interaction-between-Animations,-Tracking,-Physics,-etc. | idle/tracking/one-shot/expression/physics가 같은 parameter를 덮는 우선순위 설명. Cubism 자체나 현재 앱의 순서와 동일시하지 않음 |
| Cubism parameter 갱신 | https://docs.live2d.com/en/cubism-sdk-manual/parameters/ | motion/blink/expression/조작/breath/physics/lipsync의 공식 예제. DeepSeek upstream physics 매핑과 별도로 읽어야 함 |
| Cubism 마스크 용량 | https://github.com/Live2D/CubismWebFramework/blob/5-r.5/src/rendering/cubismclippingmanager.ts | 고정 Framework의 단일 버퍼 36그룹, 다중 버퍼당 32그룹. 모델별 그룹 수로 버퍼 수 계산 |
| Cubism 텍스처 예제 | https://github.com/Live2D/CubismWebSamples/blob/5-r.5/Samples/TypeScript/Demo/src/lapptexturemanager.ts | 축소 시 mipmap 필터 사용. WebGL 1의 POT 조건은 앱에서 검사 |
| Cubism Web 모델 | https://docs.live2d.com/en/cubism-sdk-manual/model-web/ | `.model3.json` 참조에 따라 모델/텍스처를 로드하고 WebGL 렌더러를 구성하는 공식 흐름 |
| TypeSafe Jev | https://docs.typesafe.ai/api/system-one | state와 typed questions의 API, Choice 기반 표현 판단 |
| TypeSafe Choice | https://docs.typesafe.ai/primitives/choice | choice/probabilities/confidence의 구조. 한국어 표현 품질은 앱 실증과 별도 |
| Hermes 소스 | https://github.com/NousResearch/hermes-agent | native control/interactive ticket/session authority 프로토콜. 앱 SSH 실증 버전 `6b5df79671` |

## 증거 등급

- **Official-confirmed:** 공식 문서에서 직접 확인되는 공급자 기능.
- **Integration-proven:** 실제 연결·왕복 및 에러 케이스를 재현하여 우리 프로젝트에서 확인.
- **Design-only:** 우리 설계에서 제안하는 구조/예시 JSON/기능.
- **Unknown:** 공식 API 확인 불가 또는 테스트 전.

외부 공급자의 Official-confirmed ≠ 우리 앱의 Integration-proven. 명세에서 지위가 다르면 반드시 표기한다.

## 최초 확인 요약

1. Grok Bot Routine Webhook의 응답은 단지 accepted이며 기존 Grok Bot의 타사 채팅 API 역할을 보장하지 않는다.
2. Hermes의 rich host 개발에는 TUI gateway JSON-RPC가 적합할 수 있으며 승인·재연결 프로토콜을 따라야 한다.
3. Hermes Bot Mode의 canonical Bot Chat은 프로필 일반 세션과 구별된다.
4. Live2D Core는 사용/재배포 조건을 확인하지 않고 GitHub에 포함하면 안 된다.
5. Electron renderer/OS 연결 부분은 높은 위험을 가지므로 공식 보안 가이드와 로컬 승인 경계를 따른다.

실증 결과는 `docs/planning/RISKS_AND_SPIKES.md`의 템플릿과 테스트 이슈/PR을 연결하여 이 파일에서 추적한다.
