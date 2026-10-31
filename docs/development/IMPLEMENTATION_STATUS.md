# 구현 및 검증 상태

**확인일:** 2026-10-31 · **버전:** 0.1.0-alpha.1 · **배포:** 로컬 개발용, Windows 릴리스 검증 전

## 구현 범위

사용자가 확정한 완료 흐름은 **DeepSeek-chan 표시 → 채팅 요청 → Hermes 실제 응답 → Jev 판단 → 모델 표정/모션**이다. 내부 모듈은 분리하지만 캐릭터 단독 PoC로 완료하지 않는다. 화면 캡처·PC 실행·TTS/립싱크는 구현하지 않았다.

| 항목 | 구현/실증 | 한계 |
|---|---|---|
| Electron | typed IPC, sender/mainFrame 검사, sandbox/contextIsolation, renderer 외부 네트워크 차단 | Windows 실제 창/입력 미검증 |
| UI/Live2D | 모델만 보이는 투명 Overlay, 별도 채팅/설정, 이동·배율·트레이·복구 단축키, 실제 모델 idle/blink/breath/표정/one-shot 모션 | 클릭 통과·다중 모니터·고 DPI·실사용 GPU 성능 수락 전 |
| Core | binding/turn/request 검사, dedupe, lease, reconciling, 승인/취소, 원문 없는 복원 | 원문 히스토리 영구 저장 안 함 |
| Hermes SSH | 기존 owner의 native control/ticket/WebSocket, 명시적 세션 선택, 전용 테스트 세션 실제 왕복·새 연결 receipt 복구 | canonical Bot Chat 미검증, 실제 진행 중 취소/승인은 계약 테스트만 |
| Hermes HTTP | Runs/SSE/상태/중단/승인/복구와 테스트 서버 왕복 | 원격 실증 전. API 소유 세션 전용 |
| Grok Bot | Webhook 인증 제출, 200→accepted/awaiting_result | 실계정 미실증, callback 미구현, 양방향 채팅 미지원 |
| Jev | Choice emotion/gesture, 최대 800자 구간, 비동기 판단·deadline·confidence·stale gating | 한국어 인사 실증은 전체 품질 평가가 아님 |
| 인증키 | async safeStorage, 서버별 credential scope | 현재 headless 환경은 보호 저장소 불가. 키는 메모리 전용 |

## 실행·복원 구조

루트 [README](../../README.md)의 준비/실행 명령을 따른다. `local-assets/DeepSeek/`와 `vendor/`는 ignored이며 git clone만으로 자산이 준비되지 않는다. SDK는 공식 Framework 5-r.5 commit과 Core 5.3(`core/06`) 해시를 검사한다. 로컬 개발 사용과 배포 라이선스 검토는 구분한다.

사용자 ZIP에서 runtime만 추출하고, 누락된 `Exp3/`·`Animation/` 참조는 검증된 manifest에 보충한다. 원본 파일을 수정하지 않는다. 자산 URL은 선택 디렉터리의 의존 파일만 토큰으로 제공하며 symlink/traversal/외부 URL을 거절한다. 재선택 시 토큰은 폐기된다.

설정은 OS 사용자 앱 데이터의 `settings.json`, 미종결 요청은 `pending-requests.json`이다. 앱 설정이 없는 첫 실행에는 ignored `local-assets/connection.json`을 읽는다. 개인 주소/실제 세션/키는 공개 저장소에 넣지 않는다. 인증키는 별도 암호화 저장이며 Linux `basic_text` 우회는 없다. 보호 저장소가 없으면 메모리만 사용하고 재실행 시 입력이 필요하다.

요청 메타데이터는 **네트워크 제출 전에 await하여 저장**한다. 저장 실패/손상된 미종결 상태를 빈 상태로 바꿔 새 요청을 보내지 않는다. 재시작 시 원래 요청을 조회하며 자동 재전송하지 않는다. endpoint 정규화와 selectionId/revision 검사가 전환 중 중복 제출·잘못된 이벤트/표현 적용을 막는다.

## 재현 명령

~~~sh
npm run format:check
npm run typecheck
npm test
npm run build
npm run test:desktop
npm audit
~~~

기본 desktop 검사는 외부 AI 없이 실제 Electron/SDK/모델에 Mock 응답과 명시적 표현 fixture를 적용한다. `artifacts/desktop-smoke.json`, `live2d-smoke.png`, `chat-smoke.png`는 로컬 확인용이며 커밋하지 않는다. headless의 고정 viewport·software GPU는 Windows 합성/입력이나 실사용 성능 검증을 대체하지 않는다.

실제 공급자 검사는 준비한 로컬 연결 설정으로 `node scripts/smoke-desktop.mjs --smoke-hermes --jev-stdin`을 실행한다. 터미널 echo를 끈 stdin에서 키를 받아 자식 fd로만 전달하며 명령 인자·환경변수·파일에 평문 저장하지 않는다. 도구가 꺼진 전용 세션에서 인사만 요청한다. 실제 검사 결과는 로컬 `artifacts/desktop-live.json`에 원문/키/주소/세션 없이 기록한다.

## 확인 결과 (2026-10-31)

- TypeScript strict 및 production build 통과. Unit/Contract 73개: 전송/SSE·SSH receipt/replay·코어 복구/lease·승인·저장 barrier·지연 판단·모델 경로·credential/endpoint 정규화 검사. Electron smoke는 실제 form 제출, 새 세션 생성/공급자 변경 뒤 이전 대화·승인 UI 제거도 검사한다.
- npm audit 취약점 0건. CI 자동 실행과 Windows 빌드는 아직 없다.
- 실제 Electron headless에서 모델 파라미터 509개와 440×680 WebGL 출력, 알파 0인 빈 모서리, renderer Node `require` 접근 불가 및 좁은 preload 브리지 확인.
- 사용자가 승인한 Hermes `default` 전용 새 테스트 세션에서 delta→최종 본문→원격 receipt 완료를 확인했다. 기존 대화에 테스트 메시지를 넣거나 원격 서비스를 재시작/변경하지 않았다. 새 SSH 클라이언트의 동일 요청 receipt 복구도 통과했다.
- 실제 Hermes 답변을 실제 Jev가 `happy/wave`로 판단하고 모델의 실제 표정/모션 파라미터 적용까지 확인했다. 관찰된 Jev 왕복은 188ms와 208ms였으며 평균/최악 지연 보장은 아니다.
- 별도 앱 프로세스 재실행과 같은 로컬 연결 설정 사용을 확인했다. 실제 OS 재부팅·재로그인·장치 재연결·Windows 클릭 통과·DPAPI/Secret Service 지속성은 검증하지 않았다.

근거는 같은 변경의 `tests/`, `scripts/smoke-desktop.mjs`, main의 smoke 결과 생성 코드와 실행 결과다. 모델/SDK·키·개인 대화는 증거 fixture로 커밋하지 않는다.

## 남은 작업

Windows 실제 Overlay/포커스/드래그/클릭 통과·고 DPI·보호 저장소, canonical Bot Chat 동일성, Grok callback 가능성, TTS/립싱크, 실서비스 취소/승인, 릴리스 패키징/라이선스 확인이 남아 있다.
