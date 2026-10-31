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
