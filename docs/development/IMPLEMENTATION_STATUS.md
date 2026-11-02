# 구현 및 검증 상태

**확인일:** 2026-11-03 · **버전:** 0.1.0-alpha.1 · **배포:** 로컬 개발용, Windows 릴리스 검증 전

## 구현 범위

사용자가 확정한 완료 흐름은 **DeepSeek-chan 표시 → 채팅 요청 → Hermes 실제 응답 → Jev 판단 → 모델 표정/모션**이다. 내부 모듈은 분리하지만 캐릭터 단독 PoC로 완료하지 않는다. 화면 캡처·PC 실행·TTS/립싱크는 구현하지 않았다.

| 항목        | 구현/실증                                                                                                                                             | 한계                                                                                                                                            |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Electron    | typed IPC, sender/mainFrame 검사, sandbox/contextIsolation, renderer 외부 네트워크 차단                                                               | Windows 실제 창/입력 미검증                                                                                                                     |
| Chat        | 직접 전송 시 하단 이동, 응답 하단 추적/과거 위치 유지, 실시간·복원 답변의 Markdown 문단/강조/목록/코드/표                                             | 링크는 이동 없는 표시, 이미지는 alt text. 코드 문법 강조 없음                                                                                   |
| 첨부        | 이미지/일반 파일 선택·드롭·paste·초안 미리보기/삭제, Hermes SSH 실제 이미지/파일 전달                                                                 | 10개·파일당 10 MiB·전체 25 MiB. HTTP/Grok 미지원, 첨부-only의 로컬 history 복원은 기본 텍스트 표시이며 첨부 thumbnail/파일명 이력 보존은 미구현 |
| UI/Live2D   | 투명 Overlay, 모니터 이동·부분 표시·휠 배율, 로컬 actor의 시선/고개/몸 연기·표정 crossfade·paired 손 포즈, 강도/구도/배치 잠금/움직임 줄이기/미리보기 | Windows·실제 고 DPI·성능 수락 전. 선택적 직접 쓰다듬기 제공. 마우스 시선 추적/TTS 없음                                                          |
| Linux/Sway  | Xwayland의 non-focusable Overlay, 입력 전용 XShape로 빈 영역 통과·모델 재진입, 실패 시 전체 입력 복구                                                 | 현재 SwayFX 환경에서 실증. native Wayland 클릭 통과는 미지원                                                                                    |
| Core        | binding/turn/request 검사, dedupe, lease, reconciling, 승인/취소, 원문 없는 복원                                                                      | 원문 히스토리 영구 저장 안 함                                                                                                                   |
| Hermes SSH  | 기존 owner의 native control/ticket/WebSocket, 명시적 세션 선택, 동일 세션 표시용 history 복원, 전용 테스트 세션 실제 왕복·새 연결 receipt 복구        | canonical Bot Chat 미검증, 실제 진행 중 취소/승인은 계약 테스트만                                                                               |
| Hermes HTTP | Runs/SSE/상태/중단/승인/복구와 테스트 서버 왕복                                                                                                       | 원격 실증 전. API 소유 세션 전용                                                                                                                |
| Grok Bot    | Webhook 인증 제출, 200→accepted/awaiting_result                                                                                                       | 실계정 미실증, callback 미구현, 양방향 채팅 미지원                                                                                              |
| Jev         | 메시지당 대표 Choice emotion/gesture/선택적 attitude 1회, 800자·요청당 8회·짧은 수집/판단 기한, 문장 재생 큐 없음                                     | 진행 응답의 빈도/감정 품질은 모델·작업에 따라 다름                                                                                              |
| 인증키      | async safeStorage, 서버별 credential scope, 사용자 `.env` 시작 시 입력                                                                                | 현재 headless 환경은 보호 저장소 불가. 앱 보관은 메모리 전용이며 사용자 `.env`는 별도 유지                                                      |

## Grok의 VTuber 시각 검토와 개선 (2026-11-03)

현재 코드 기준은 `15c37eb`이다. 조사 원문·공식 영상 링크 전달·채택/기각·전체 점수와 적용/복원은 [Grok 검토·반영](../ux/GROK_VTUBER_REVIEW.md)을 따른다. 초기 연기 기여도 단독 점수는60→57→57→63→60/100, 기존 그림을 포함한 완료 종합 평가는60→58→72→72→74→69→74/100이었다. 직전 검토 `b2f1401`의69점은69초 자료의 주관적 시각 의견이며, 직전74점은59초 자료의 `3a0fef4`에 대한 의견이다. 유지 얼굴·눈/고개 독립 복귀를 보강한 현재 `15c37eb`도 같은69초 조건에서74/100으로 종료 조건에 못 미쳤다. 몸통의 실제 구동 경로와 자세 대비는 후속 검증 중이다. 평가 범위·프레임 간격·전신 크기·관찰 길이의 변경을 구분하고 코드 효과만의 상승치로 합치지 않는다.

`FR-L2D-004/006/008/009`를 실제 기본 renderer에 통합했다. 감정별 유지 얼굴과 두 변주, 부끄러움/걱정→지연 웃음/wink, 혼란의 회피/젖힘→호기심 기울임, 화남의 측면 자세·음수 닫힌 입·실제 normal 눈 열림 .4025를 제공한다. 특수 눈은 짧은 강조 뒤 단일 그림의 표시 소유권으로 돌아오고 홍조/땀과 독립된다. 시선→고개→지연된 상체를 실제 rig로 보정했고 기쁨/웃음은 한 번 다가왔다 안정한다. 기존 lean 경로의 국소 zoom/anchor는 의도적으로 변하지만 ambient offsetY/호흡·OS 창 위치/저장 배율은 유지한다. `gesture=none`에서 감정만으로 팔을 자동으로 올리지 않는다. 기존 불규칙 대기 슬롯의 고개→지연 상체 이동과 손 없는 순수 기쁨/웃음의1.85~3.7초 청자 확인 시선·비스듬한 유지 자세를 추가했다.

명시적 인사는 원본 가슴 포즈의 검증된 중간 편 손바닥을 이어 세 번 흔들고 낮춘 유지/부분 올림 뒤 원본 exit로 복귀한다. 설명도 검증된 팔 입력만 사용한다. selector·손가락·seam·physics 출력과 사용자 다른 매핑은 보존한다. 직접 쓰다듬기는 유효한 접촉 좌표로 고개/시선/상체를 보간하고 사용자 홍조·작은 접근을 제공한다. .3초 유지+.75초 fade·최초12초·중복 종료·승인 즉시 정리와 opt-in을 유지한다. 검증된 기본 손 pair·범위/endpoint·빈 소유권 조건의 직접8px stroke에만 원본 가슴 손 포즈를 함께 사용한다. 부분 진입은 마지막 렌더부터 역재생하고 hold는 원본 복귀를 쓰며 정지 .9초/해제1.05초/최초12초를 지킨다. custom/빈 매핑·움직임 줄이기·늦은 접촉은 몸/얼굴만 사용한다. 복귀 중 재접촉은 기존 손 기한·몸 fade를 보존하고 무 stroke begin/end로 연장하지 않는다. scoped 메시지 clear와 직접 입력 소유권도 분리했다. 음수 입·눈 전환·화남 종료 경계 수정도 유지한다. TTS·음소·새 리깅·전역 커서/PC 조작·새 공급자 판단은 추가하지 않았다.

기쁨과 웃음이 같은 유지 미소로 수렴하고 닫힌 입0을 공통 최소 .12가 덮던 원인도 수정했다. neutral acknowledge의 기존 입 목표는 명시적으로 보존하며, 실제8초 기쁨 눈 .844/입 .117과 웃음 눈 .467/입 약0/입꼬리 .52를 확인했다. 대기는 눈의 반대 방향 복귀와 측면 고개/지연 상체 목표를 분리하고 같은 불규칙 시계·기존 clamp/속도·Y/호흡·rootY를 유지한다. MOC13자세의 홍채 이동과 실제 PNG 근거는 검토 문서를 따른다.

### 현재 검증·영상

- **571개 unit/contract**, typecheck·format·build·외부 AI 없는 Mock Electron 검사를 통과했다. 192조합·30/60/120fps·강도/접근성·저장 매핑/빈 선택·손 복귀·clear/승인·12초·종료 직전 페이드를 포함한다. 잘못된 sender/enum과 요청 중 미리보기 거절 로그는 Mock의 예상 결과다.
- 실제 SDK/SwiftShader **56개 수락 검사·165개 현재 PNG**(after162/before3)의 체크포인트마다 509개 parameter 범위 오류/외부 요청 0을 확인했다. 실제 눈 그림·입·손/최종 endpoint·접촉 방향·강도·종료 직전을 검사한다. 화남 16100/16150/16200ms의 실제 눈 열림은 약 .99184/.99647/1이며, 8초 .4025·입 열림0은 보존했다. `artifacts/grok-review/round-12-expression-results.json`과 `artifacts/expression-afterglow/`가 근거다. 50ms 시뮬레이션·지정 rasterize이며 실시간 FPS/CPU 검사가 아니다.
- 실제 MOC의 별도 정점/PNG 비교로 시선의 직접 binding, 고개/몸 upstream, 초기 감정 몸 반응과 종료 경계를 확인했다. scalar 값만 바뀐 상태를 연기 완료로 판단하지 않는다. 정점 변화량·고정 root 비교와 국소 접근의 MVP 변화를 [검토 문서](../ux/GROK_VTUBER_REVIEW.md#고개상체의-실제-구동-경로-확인)에 구분해 기록했다.
- `artifacts/grok-review/story-12-comparison.mp4`는 **69초·1120×900·20fps·1380 paired frame**다. 한 Avatar/actor가 이어지며 22개 앱 소스·실제 import 해시를 고정했다. 각 측 509개 parameter의 1500회 검사에서 범위 오류0·접촉62/62 alpha 적중·외부 요청0이다. 이벤트/해시는 `story-12-results.json`에 있다. **합성 cue·로컬 미리보기·무음**이며 실제 provider/IPC 대화 촬영이 아니다. 입력 위치용 시연 고리는 제품 효과가 아니므로 모델 crop에서 제거했다. 긴 의미 손/복귀의 별도 기존 자료는 `round-05-comparison.mp4`(167.5초/3350 paired frame)로 보존한다.
- 실제 Sway/Xwayland 새 앱 프로세스의 production renderer에서 설정 UI20종·켜기 저장/reload·Shift stroke/창 위치 불변·해제·활성 petting→승인 즉시 정리·의미 여운 손 hold·낡은/정확한 clear·renderer reload·원래 설정 해시 보존을 확인했다. 이후 정상 `~/.local/bin/live2d-companion` 런처의 PID 생존/설정 보존을 확인했다. ignored `.tmp/afterglow-native/round-12-result.json`(2026-11-03 05:00 KST, `approvalActiveBefore:true`)이 근거이며 provider/Jev 호출은0이다. 테스트의 배경 JS 조회 중에도 제한된 획 입력을 지속해 실제 활성 반응에서 승인을 검사했다. 고정 wall-time의 캐시 조회 대신 해제 수신+기한 이후 실제 프레임을 기다리도록 검사기를 보강했다(캐시 약1초 지연 관찰). 물리 마우스·OS 재부팅/재로그인은 하지 않았다.

### 적용·복원

적용은 현재 checkout에서 `npm run build` 후 앱 종료·같은 기본 런처 재실행이다. 별도 시험용 실행 경로나 서비스는 없다. 현재 유지 얼굴/시선 변경만 복원하려면 `15c37eb`를 revert하고 build·기본 런처로 재실행한다. 전체 Grok 개선은 `15c37eb`→`b2f1401`→`7e7e0b2`→`3a0fef4`→`9754202`→`28a9420`→`bdce55e`→`116e1b9`를 이 순서로 revert하며(최신→과거) 해당 문서 버전도 맞춘다. `29b85f0`의 설정 schema와 호환되어 개인 연결/세션/매핑·위치/배율을 이관하지 않는다. SDK·모델·영상/프레임·개인 설정·Grok 원문 세션은 공개 Git에 넣지 않는다. 초기 감정 추가 이전으로 더 복원할 때는 아래 별도 절차를 따른다.

## 감정 여운·추가 감정·쓰다듬기 (2026-11-02)

사용자 요청에 따라 [구현 인계](../ux/EMOTION_EXPRESSION_HANDOFF.md)의 5항목을 기본 renderer/매핑 경로에 통합하고 화남·당황 및 직접 쓰다듬기를 추가했다. 관련 요구사항은 `FR-L2D-004~008`, `FR-DIR-005~006`, `FR-SET-003`이며 [수락 기준](../specs/ACCEPTANCE_CRITERIA.md#감정-여운과-합성-fr-l2d-004006007-fr-dir-005)을 갱신했다. TTS/립싱크·커서 시선 추적·새 리깅은 포함하지 않는다.

- 기존 강조 뒤 최대 12초의 얼굴 여운을 추가했다. 미소·눈웃음·눈썹·홍조·땀은 기준 .4에 강도를 적용하고 입 열림은 범위의 .12 이하를 사용한다. 마지막 1초 fade 및 정확한 기한 정리를 제공하며 대기 시선·blink·호흡과 기존 상하 offset 한도는 유지한다. 몸의 끄덕임/웃음을 여운 동안 반복하지 않는다. preview/delivery는 기존 짧은 길이이며 중립 승격은 원래 시작 시각을 유지해 끄덕임을 재시작하지 않는다.
- `ExpressionMixer.transitionMany`는 눈 아트와 표시 층을 분리해 홍조+웃음·식은땀+장난·여러 표시 키의 조합과 240ms crossfade를 제공한다. 자동 보조 자산의 옷·소품은 제외하고 직접 선택한 자산은 보존한다. 새 기본 happy는 파일 없는 미소·눈웃음이며 이미 저장한 `＞＜`/빈 선택은 보존한다. 일반 눈웃음을 원하면 설정에서 기쁨을 ‘기본 연기만’으로 선택한다. 강도/움직임 줄이기는 진행 중 여운에도 적용한다.
- paired 손은 전체 의미 반응 기한에서 진입/복귀 시간을 뺀 동안 유지하고 authored 복귀를 끝낸다. 새 메시지 첫 글자의 scoped `cue.clear`로 이전 여운/표정/손을 정리한다. 같은 손의 6.2초 반복 억제는 clear 후에도 유지하고 다른 손/none은 즉시 반영한다. 정정·승인·취소·오류·reset에서도 정리하며 오래된 clear는 현재 메시지를 지우지 않는다.
- body lean 계수 .35/.7을 같은 actor·모델·구도로 비교한 뒤 .7을 채택했다. 실제 1초 upstream `LeanInput`은 기쁨 약 −.933→−1.865, 장난 −1.748→−3.496, 슬픔 1.163→2.325였다. PNG를 직접 비교했고 상하 offset·호흡·고개 추적 속도는 유지했다.
- 감정 enum은 `angry`/`confused`를 더한 8종이다. 화남은 지원 눈썹·입·볼 upstream의 범위 기반 합성이고 혼란은 존재하는 `圈圈眼`과 시선·고개를 조합한다. 없는 채널/자산은 생략하며 미확인 `Emotion`/`Emotion2`/`脱捕`는 연결하지 않는다. 감정 8×말투 6×제스처 4의 192조합을 검사하고 미리보기는 슬픔·걱정·안심·인사·화남·혼란을 더한 20종이다. 매핑 schema도 같은 enum을 사용해 새 행의 저장·빈 선택·복원을 허용한다.
- 쓰다듬기는 설정의 `pettingEnabled`(기본 꺼짐)와 **Shift+왼쪽으로 캐릭터 상단을 문지르는 입력**만 사용한다. 자기 canvas 알파 실루엣의 상단 40%이며 해부학적 머리 인식은 아니다. 8 CSS px 이상 stroke에서 눈웃음·미소·작은 기울임을 합성하고 정지 시 .9초, 해제 시 최대 .45초의 연속 fade로 복귀한다. 지속 입력도 12초 한도이며 요청·승인 중 시작 금지/새 요청·승인·오류·설정 해제 즉시 정리를 제공한다. 일반 클릭·드래그/휠 배율과 분기하고 위치 잠금에서도 쓸 수 있다. 전역 커서·화면·외부 서비스는 읽지 않는다.

### 재현 가능한 검증과 근거

- `npm run typecheck`, `npm test`의 **490개**, 전체 `format:check`, `build`, 외부 AI 없는 Mock Electron 검사를 통과했다. actor/mixer/손의 30/60/120fps, 여운 중 강도/접근성 변경, 엄격한 신규 감정 매핑, 의미 적용 후 clear와 중립 승격, 같은 손 반복 억제, 쓰다듬기 임계값·상단·종료/타임아웃 검사를 포함한다. 관련 `tests/acting.test.ts`, `performance.test.ts`, `avatar.test.ts`, `director.test.ts`, `emotion-controls.test.ts`, `petting.test.ts`, `model-library.test.ts`, `validation.test.ts`, `adapters.test.ts`가 코드 근거다.
- `npm run test:expression -- --model 'local-assets/DeepSeek/大肥鱼.model3.json'`은 일반 앱 설정·키·공급자와 격리된 실제 SDK/SwiftShader 검증이다. 최종 **49개 PNG·수락 검사 22개**, 체크포인트마다 실제 509개 parameter 범위 오류 0개·외부 요청 0개를 확인했다. 기쁨·기쁨+웃음·홍조+웃음·걱정+장난, 새 화남/혼란·미리보기 6종, 두 손의 진입/8초 유지/복귀, clear·움직임 줄이기·쓰다듬기/상단 판정을 포함한다. 로컬 근거는 ignored `artifacts/expression-afterglow/results.json`과 `*.png`다. 50ms 시뮬레이션 간격으로 모델/physics를 진행하고 체크포인트만 실제 rasterize한 검사이며 실시간 FPS/CPU·음성 동기 측정은 아니다.
- 실제 모델의 부끄러움+웃음 1초에서 `key7=1`, `EyeSmile≈.585`, 8초에서 각각 .26/.234를 확인하고 이미지를 직접 확인했다. 설명 손 `Movement3`는 8초에 1, 16.2초에 0이며 손/손목/손가락 endpoint 복귀를 검사했다. Idle이 계속 구동하는 조명 곡선은 정적인 손 endpoint 판정에서 제외했다. 새 화남 1초의 눈썹 입력은 −.55, 삐죽 .35이고 혼란 `key3=1`이다. 쓰다듬기는 실제 모델에서 미소/눈웃음과 종료 복귀를 확인했다.
- 실제 Jev에는 합성 한국어 대조 5개만 보냈다. 화자 분노→angry(.98), 화자 혼란→confused(.92), 분노 주제의 사실 설명→neutral(1.0), 화난 사용자에게 위로→concerned(.98)/reassure(1.0), 차분한 숙고→neutral(1.0)이었다. 이는 채널 confidence이며 최종 통합 confidence와 다르다. 기존 질문 3개·호출 1회·한도/임계값을 유지했고, Hermes prompt·실제 사용자 이력은 보내지 않았다. 원문/키 없이 선택·확신도만 ignored `.tmp/expression-afterglow/jev-controls.json`에 보관했다. 5개 대조 결과가 전체 의미 정확도를 보장하지 않는다.

- 실제 Sway/Xwayland의 새 앱 프로세스에서 production renderer와 설정 UI에 합성 pointer 입력(CDP)을 보내 20종 버튼, 쓰다듬기 켜기 저장·설정 renderer reload 복원, Shift stroke의 얼굴 반응·창 위치 불변·해제 복귀·승인 즉시 정리를 확인했다. 감정 여운 단계의 손 hold와 낡은 clear 무시/정확한 clear 정리, 모델 renderer reload 로드·원래 설정 해시 보존도 확인했다. 입력 검증 도중 처음에는 테스트 주입의 screen 좌표가 움직이지 않는 차이를 발견해 petting 이동량을 CSS client 좌표로 계산하도록 고쳤다. 직접 petting에는 창이 움직이지 않으므로 이 기준이 맞고 일반 드래그의 screen 기준은 유지한다. 근거는 ignored `.tmp/afterglow-native/result.json`이다. 실제 손으로 마우스를 문지른 검증/OS 재부팅·재로그인 검증과는 구분한다. 이 앱 검사에서 provider prompt/Jev 호출은 0회다. 테스트 종료 시 개인 설정을 원래 값으로 복원했으므로 쓰다듬기는 사용자가 설정에서 켜야 한다.

### 적용·복원과 지속성

적용은 `npm run build` 뒤 기존 앱을 종료하고 기본 `~/.local/bin/live2d-companion` 런처로 실행한다. 런처는 이 checkout의 기본 Electron 진입점을 읽으므로 별도 시험 경로·서비스·자동 실행 항목은 없다. 쓰다듬기 설정은 기존 settings 저장/부트스트랩과 presentation 이벤트를 사용하고, 예전 설정에 필드가 없으면 꺼짐으로 해석한다. 기존 개인 연결/세션/모델/표정 매핑·위치·배율은 자동 이관하지 않는다. 새 happy 기본이 이미 저장된 사용자의 `＞＜`를 덮지 않는다.

복원은 이 변경 커밋을 revert하고 `npm run build` 뒤 같은 기본 런처로 재실행한다. 되돌린 버전은 새 감정/쓰다듬기 필드를 모를 수 있으므로, **되돌리기 전에** 현재 버전 설정에서 새 angry/confused 매핑 행과 `presentation.pettingEnabled`만 제거한 기존 형태의 비밀 없는 설정 백업으로 복원한다. 개인 연결 값·비밀·대화는 저장소에 넣지 않는다. 모델/SDK 자산 추가 배포는 없다. 실제 앱 재실행 검증과 OS 재부팅/재로그인 검증을 구분하며 이번에 OS 재부팅·재로그인은 수행하지 않았다.

Linux에서 구버전으로 돌아갈 때 새 설정 필드를 제거하는 예시다. **앱을 먼저 종료**하고 실행한다. 백업에는 개인 연결 메타데이터가 들어갈 수 있으므로 사용자 설정 디렉터리에만 두고 저장소에 추가하지 않는다.

```bash
python3 - <<'PYCONFIG'
import json, os, shutil, tempfile
from pathlib import Path
root = Path(os.environ.get('XDG_CONFIG_HOME', Path.home() / '.config')) / 'Live2D Agent Companion'
file = root / 'settings.json'
backup = root / 'settings.before-expression-revert.json'
shutil.copy2(file, backup)
os.chmod(backup, 0o600)
data = json.loads(file.read_text())
settings = data['settings']
for key in ('angry', 'confused'):
    settings.get('expressionMap', {}).pop(key, None)
settings.get('presentation', {}).pop('pettingEnabled', None)
with tempfile.NamedTemporaryFile(mode='w', dir=root, delete=False) as output:
    os.chmod(output.name, 0o600)
    json.dump(data, output, ensure_ascii=False, indent=2)
os.replace(output.name, file)
PYCONFIG
```

그 뒤 구현 커밋 `57bf907`을 revert하고 build·기본 런처 재실행한다. 다시 최신 버전을 사용할 때는 로컬 백업으로 선택 설정을 복원할 수 있다. 위 rollback 명령은 이번 검증에서 실행하지 않았다.

## 완료 본문 판단과 정정 처리 개선 (2026-11-01)

- 사용자 개선 지시에 따라 첫 구간 의미 판단을 완료 본문 판단으로 대체했다. 텍스트는 즉시 표시하고, 의미 판단이 늦으면 350ms에 `delivery` 중립 전달을 낸다. `message.complete` 또는 정상 `turn.completed`에서 현재 live 메시지의 앞뒤 800자를 한 번 판단해 `semantic`으로 승격한다. 빠른 결과는 delivery를 취소하고, 중립 승격은 기존 끄덕임을 재시작하지 않는다. 새 메시지 첫 글자는 이전 미적용 판단을 즉시 취소한다. 설계 결정은 [ADR-0004](../planning/adrs/0004-integrated-companion-and-jev.md)에 통합했다.
- 이미 판단한 완료 본문의 수정은 외부 재판단 없이 `cue.clear`로 철회한다. requestId/messageId/segmentId가 모두 현재 단계와 일치할 때만 actor·표정·손을 정리하고 작업/승인 상태는 유지한다. 수정 여부는 전체 본문으로 비교해 발췌 밖 변경도 감지한다. 빈 delta가 완료 표지를 지워 수정 감지를 우회하는 경로를 함께 막았다. 이전 ID의 완료/snapshot은 최신 메시지를 취소하지 않는다. 복구 snapshot은 같은 ID의 후속 complete까지 재생하지 않으며, 원문 없는 복원 요청은 새 live 메시지도 로컬 중립만 제공한다.
- 실제 누락 농담의 말투 분포는 laugh .47·tease .46으로 합 .93이었다. 세부 confidence만 검사해 둘 다 버리던 처리를 보완했다. 검증/정규화한 두 확률 각각 ≥.2·합 q≥.85이며, 이진 confidence `max(0,2q−1)`이 기존 설정 기준을 통과할 때만 일반 laugh를 선택한다. q=.93은 confidence .86이며 사용자 기준 .9에는 폐기한다. [공식 confidence 정의](https://docs.typesafe.ai/confidence)의 척도를 쓰는 앱의 보수적 표현 정책이다. 확실한 tease·중립·위로 및 독립 감정/제스처는 보존하며 질문·호출·기존 임계값은 유지했다. 기준 문구만 바꾼 예비안은 기존 사례를 누락시켜 채택하지 않았고, 기존 말투 기준과 분포 처리를 최종 조합했다.
- 기존 실제 대화 14쌍을 동일 해시로 대조해 이전 웃음 9개를 모두 유지하고 누락된 농담을 웃음으로 전달했다. 같은 완료 대사의 별도 반복 2회도 일반 laugh였고, 단독 앞부분은 여전히 불확실하므로 의미 판단에 쓰지 않는다. 현재 선택에 추가된 2쌍은 별도로 재평가했다. 기쁨/슬픔/놀람/부끄러움/걱정·장난/위로·설명/인사/생각·일반 보고·웃음 주제/웃음 표기만 있는 보고의 합성 대조 14개도 목표 채널을 확인했다. 성공으로 시작해 끝에서 실패로 정정하는 긴 합성 답변과 초안을 통째로 교체한 합성 답변도 실제 Jev/Core로 각 1회 검사했다. 완료 전 호출은 0회, 완료 뒤 1회였고 결론이 발췌에 포함되며 각각 neutral/sad로 기쁨이 남지 않았다(`completed-result.json`). 단발·소수 반복 평가이며 전체 정확도 보장이 아니다. provider prompt 재전송은 없고 각 Jev 입력은 해당 요청/답변 한 쌍뿐이다. 원문 대신 해시·길이·선택·확신도만 ignored `.tmp/expression-fix/{before-recent,after-recent,final-recheck,final-controls}.json`에 기록했다. 과거 실제 적용값을 복구한 것은 아니다.
- 단위/계약 **398개**, typecheck·전체 format·build·외부 AI 없는 Mock Electron 검사를 통과했다. 새 경계 검사는 완료 전 호출 0회, 느린/빠른 판단, 중립 승격 무재시작, 같은 batch 정정, 적용 후 정정, 발췌 밖 수정, 빈 delta, 이전 ID/segment 격리, 복구/중단/예산과 확률 묶음 11개 분포를 포함한다. 실제 SDK에서도 delivery→semantic, 성공 초안 뒤 실패 완료의 sad, 정정 후 표정·인사 손 selector 정리, 오래된 clear 무시, 실제 재평가 laugh 적용과 범위 오류 0개를 확인했다. 근거는 관련 tests와 ignored `.tmp/expression-fix/model-result.json`, `final-model.log`, `desktop.log`다.
- 실제 Sway 앱의 새 프로세스에서 production renderer의 delivery→laugh 승격, 이전 단계/메시지의 clear 무시, 설명 손→정정 clear의 중립 복귀, Overlay 재로딩 후 모델 로드와 설정 해시 보존을 확인했다(`.tmp/expression-fix/native-result.json`). 이 검사의 provider prompt/Jev 호출은 0회다. 검증 후 설치된 `~/.local/bin/live2d-companion` 기본 런처로 다시 실행하고 실제 Electron 기본 진입점·프로세스 생존·설정 해시 동일을 확인했다(`normal-result.json`). OS 재부팅/재로그인은 하지 않았다. 적용은 build 후 기존 앱 종료·기본 런처 실행이며 복원은 변경 커밋 revert 후 같은 절차다. 설정 마이그레이션과 라이선스 자산 추가는 없다.

## 전체 표현 조사와 수정 (2026-11-01)

- `FR-DIR-004`: 눈웃음 `laugh`는 로컬 미리보기에는 있었지만 자동 attitude 후보에는 없었다. 기존 한 번의 Choice에 laugh를 추가하고 함께 웃는 농담과 상대를 능청스럽게 놀리는 tease를 구분했다. 사용자 제시 대사의 재평가는 이전 tease .98 → laugh .84였고, 원래 대화의 저장된 판단을 복원한 결과는 아니다. 기쁨·슬픔·놀람·부끄러움·걱정·중립, 웃음·장난·수줍음·안심·교육적 설명, none/wave/explain/thinking과 대조 사례를 포함한 한국어 예문 14개를 최종 기준으로 각 1회 평가해 목표 채널을 확인했다. 복합 말투와 확신도 fallback이 있으므로 전체 정확도 보장은 아니다. 웃음과 장난의 구분을 조정하며 실행한 예비 평가와 최종 평가는 ignored `.tmp/laugh-check/*judge-result.json`, `initial-result.json`, `second-result.json`에 분리했다. Hermes prompt 재전송은 하지 않았다.
- `FR-L2D-004/006`, `FR-DIR-005`: 새 메시지의 gesture none/다른 손동작을 받아도 이전 메시지 손 포즈가 유지되거나 전역 cooldown이 새 동작을 막았다. 승인된 새 cue가 다른 손동작을 요청하면 기존 pose·clip을 정리하고 다음 draw의 저장된 중립 기준에서 시작한다. 진입 도중 완성된 endpoint/exit로 점프하지 않으며 같은 손동작의 반복 억제와 자연 종료 복귀는 유지한다. 실제 SDK에서 진입 500ms·유지 1800ms 각각 none/wave/thinking으로 바꾼 6개 전환 모두 이전 검지 selector가 사라지고 새 반응이 즉시 적용됐다.
- `FR-DIR-005`: judge 없음/8회 판단 한도에서 append/schedule이 cue까지 생략하던 원인을 수정했다. 같은 수집·메시지 중복·generation·유효시간 검사로 neutral/none fallback을 발행하고 외부 판단 예산은 늘리지 않는다. Jev 없는 동일 batch의 마지막 메시지, 중복/취소 및 20개 메시지 중 8회 판단+12개 로컬 반응을 검사했다.
- 감정 6×말투 6×제스처 4의 **144개 actor 조합**을 범위·유한값·중복·만료 검사했다. 실제 DeepSeek/SDK에서는 기본 의미 경로 14개·미리보기 14개(초기화 포함)·표정 파일 23개·모션 8개의 **59개 장면**을 각각 12개 시점에서 draw하고 파라미터 범위·표정/actor/paired pose 종료를 확인했다. 메모리의 놀람 합성은 별도의 로컬 표정으로 존재한다. 출력 이미지 두 묶음도 비교했다. 이는 144개 모든 조합의 SDK 이미지 품질, 모든 프레임의 동작 품질, 실시간 GPU FPS/CPU 또는 Windows 검증이 아니다. 근거는 `tests/acting.test.ts`, `adapters.test.ts`, `avatar.test.ts`, `director.test.ts`와 ignored `.tmp/laugh-check/full-model-result.json`, `semantic-gallery.png`, `asset-gallery.png`다.
- 특수 눈 artwork 소유권과 유효한 사용자 매핑은 보존했다. 기본 happy의 `＞＜` 때문에 happy+laugh는 일반 감은 눈 대신 만화 눈으로 웃고, happy+tease의 윙크가 가릴 수 있다. 로컬 미리보기와 동일하다고 주장하지 않으며 자동/미리보기/사용자 매핑 경로 전수표와 적용·복원 방법은 [전체 표현 점검](../integrations/LIVE2D_TTS.md#전체-표현-점검-2026-11-01)에 통합했다.
- 단위/계약 검사 **379개**, typecheck, 전체 format 검사, build와 외부 AI 없는 Electron Mock desktop 검사가 통과했다. 동시 진행 중인 별도 UI 변경은 이번 수정의 커밋에서 제외한다. 실제 Sway 앱의 새 프로세스에서 production renderer의 laugh → explain 손 → laugh 전환, Overlay 재로딩 후 모델 로드, 기존 연결/표현 설정 보존을 확인했다. 이 앱 검증의 provider prompt/Jev 호출은 0회다. 이후 일반 실행 경로로 다시 실행했다. OS 재부팅/재로그인은 수행하지 않았다. 비공개 근거는 ignored `.tmp/laugh-check/native-result.json`, `desktop.log`다.

## 실행·복원 구조

후속 캐릭터 연기 구현(`FR-L2D-005~006`, `FR-DIR-004`, `FR-SET-003`): `acting.ts`는 결정적인 시선/단일·이중 blink와 시간 기반 damping, 감정·생각/설명 제스처의 조합, 반응별 시간 구조·제한된 변주 및 반복 억제를 담당한다. 좌우 눈·눈웃음·눈썹·볼/삐죽은 지원되는 upstream 얼굴 파라미터로 합성하며 로컬 미리보기는 초기화 포함 14종이다. `performance.ts`는 범위/중립값/physics-output 검사, 표정 crossfade, authored pose의 진입/유지/복귀를 분리한다. `Avatar`는 DeepSeek의 `Angle*`/`Position*`/`LeanInput`을 구동한다. 이전 `ParamAngleZ` 직접 쓰기는 physics에 의해 0으로 덮였지만 현재는 upstream과 최종 출력 모두 변한다. 모든 모델이 같은 리깅을 제공한다고 가정하지 않고 없는/physics 출력인 채널은 생략한다.

표현 설정은 기존 설정 파일에 선택적 `presentation`으로 저장하고 이전 파일에는 기본값을 적용한다. 구도/강도/위치 잠금/움직임 줄이기만 바꾸면 adapter/session과 Overlay를 재생성하지 않는다. paired 손 pose는 1.5초 유지 후 대응 복귀 자산을 사용하며 손목/손가락 endpoint를 함께 보존한다. pose와 clip은 같은 경과 시간을 쓰고 physics의 bounded step과 분리해 느린 프레임의 단계 불일치를 피한다. 일반 사용자 gesture 매핑은 기존 단발 재생으로 fallback한다.

미리보기 IPC는 enum/sender/현재 요청·승인/switching 검사를 거친다. 늦은 character 이벤트가 승인 차단을 풀지 못하도록 renderer는 현재 turn에서 blocked 여부를 파생하고, 승인 종료 뒤 마지막 Director 상태를 복원한다. 이전 대상의 느린 connect는 selection별 pending token으로 격리한다. 자세한 조작은 README와 [상호작용 설계](../ux/INTERACTION_DESIGN.md#구현된-캐릭터-연기와-표현-설정)를 따른다.

루트 [README](../../README.md)의 준비/실행 명령을 따른다. `local-assets/DeepSeek/`와 `vendor/`는 ignored이며 git clone만으로 자산이 준비되지 않는다. SDK는 공식 Framework 5-r.5 commit과 Core 5.3(`core/06`) 해시를 검사한다. 로컬 개발 사용과 배포 라이선스 검토는 구분한다.

사용자 ZIP에서 runtime만 추출하고, 누락된 `Exp3/`·`Animation/` 참조는 검증된 manifest에 보충한다. 원본 파일을 수정하지 않는다. 자산 URL은 선택 디렉터리의 의존 파일만 토큰으로 제공하며 symlink/traversal/외부 URL을 거절한다. 재선택 시 토큰은 폐기된다.

DeepSeek의 49개 마스크 그룹에 기본 버퍼 1개를 사용하면 SDK의 36그룹 용량을 초과해 얼굴·머리카락·꼬리가 오염됐다. SDK의 그룹 집계와 다중 버퍼 용량으로 버퍼 2개를 할당하고 POT 텍스처에는 mipmap 축소 필터를 적용한다. 원래 alpha 업로드를 공식 예제 방식과 동일 geometry에서 비교했을 때 픽셀 차이는 0이었다. 첫 gesture는 시작 후 1.6초 cooldown에 막히지 않도록 초기 시각을 분리했다.

Linux에서는 `DISPLAY`가 있고 backend를 명시하지 않았으면 X11을 선택한다. 항상 위 옵션을 켠 Overlay만 생성 시 `focusable: false`를 사용하며 chat은 포커스 가능한 관리되는 `dialog` 창이다. 기본 normal 창이 Sway에서 tiled로 열리던 원인을 생성 시 Linux `type: dialog` 지정으로 해결해 자동 floating 처리한다. Linux에서 해당 옵션을 바꾸면 Overlay만 재생성한다. Sway의 일회성 floating/sticky 명령이나 사용자 전체화면 해제로 해결하지 않는다.

Linux의 `setIgnoreMouseEvents`는 mouse forwarding을 지원하지 않는다. Sway에서 뒤쪽 Wayland 창으로 넘어가면 Xwayland의 전역 커서 좌표도 갱신되지 않아 polling 복구 역시 실패했다. 따라서 Linux는 자기 canvas의 alpha로 입력 전용 `ShapeInput` 영역을 갱신한다. 10Hz·8 CSS 픽셀 타일과 6픽셀 여유 영역을 사용하므로 외곽의 좁은 투명 여백은 조작 영역에 포함될 수 있다. 표시 영역은 자르지 않는다. 드래그 중에는 전체 입력 영역을 유지하고 resize·로드 오류·helper 실패 때도 조작 가능한 상태로 복구한다.

위치를 매번 창 왼쪽 위가 속한 화면의 안쪽으로 제한하던 구현은 모니터 이동과 하반신을 화면 밖으로 내보내는 배치를 막았다. 현재는 드래그·휠 조절·버튼 해제·재실행 모두 부분 표시 위치를 그대로 유지한다. 연결된 어떤 화면과도 전혀 겹치지 않는 창만 드래그 종료/재실행/모니터 제거 시 복구한다. 설정의 모니터 선택은 현재 창 위치와 가장 많이 겹치는 화면을 표시하며, 대상 화면으로 옮길 때 배율·가장자리 밖으로 내보낸 분량을 유지한다. 대화 adapter/session을 재설정하지 않는다. 항상 위·모든 작업공간 표시 동작은 유지한다.

`npm run build`는 Linux에서 `scripts/native/x11-input.c`를 C 컴파일러와 X11/Xext 개발 헤더로 빌드한다. main이 자기 창 ID와 PID를 고정해 helper를 시작하며 renderer는 제한된 사각형 목록만 보낼 수 있다. helper는 소유권·크기를 재검사하고 논리 좌표를 native 크기로 변환한다. 준비/실행 실패는 설정값을 보존한 채 클릭 통과를 미지원으로 표시한다. 별도 시스템 서비스나 Sway 설정 파일은 필요하지 않다.

설정은 OS 사용자 앱 데이터의 `settings.json`, 미종결 요청은 `pending-requests.json`이다. 앱 설정이 없는 첫 실행에는 ignored `local-assets/connection.json`을 읽는다. 개인 주소/실제 세션/키는 공개 저장소에 넣지 않는다. 인증키는 별도 암호화 저장이며 Linux `basic_text` 우회는 없다. 보호 저장소가 없으면 앱은 메모리에만 보관하며, 사용자가 직접 준비한 `.env`가 있으면 재실행 시 main에서 다시 읽는다. `.env`의 복원은 비밀정보 관리 범위로 별도 수행한다.

요청 메타데이터는 **네트워크 제출 전에 await하여 저장**한다. 저장 실패/손상된 미종결 상태를 빈 상태로 바꿔 새 요청을 보내지 않는다. 재시작 시 원래 요청을 조회하며 자동 재전송하지 않는다. endpoint 정규화와 selectionId/revision 검사가 전환 중 중복 제출·잘못된 이벤트/표현 적용을 막는다.

## 재현 명령

```sh
npm run format:check
npm run typecheck
npm test
npm run build
npm run test:desktop
# Linux X11이 있는 환경에서만: 자기 소유의 숨겨진 창으로 native protocol 검사
DISPLAY=:0 npm run test:x11
npm audit
```

기본 desktop 검사는 외부 AI 없이 실제 Electron/SDK/모델에 Mock 응답과 명시적 표현 fixture를 적용한다. `artifacts/desktop-smoke.json`, `live2d-smoke.png`, `chat-smoke.png`는 로컬 확인용이며 커밋하지 않는다. headless의 고정 viewport·software GPU는 Windows 합성/입력이나 실사용 성능 검증을 대체하지 않는다.

실제 공급자 검사는 준비한 로컬 연결 설정으로 `node scripts/smoke-desktop.mjs --smoke-hermes --jev-stdin`을 실행한다. 터미널 echo를 끈 stdin에서 키를 받아 자식 fd로만 전달하며 명령 인자·환경변수·파일에 평문 저장하지 않는다. 전용 테스트 세션 제목을 검증한 뒤 인사만 요청한다. 현재 실사용 일반 연결을 그대로 지정하면 제출 전에 거절한다. 도구 구성이 완전히 비었다고 가정하지 않는다. 실제 검사 결과는 로컬 `artifacts/desktop-live.json`에 원문/키/주소/세션 없이 기록한다.

사용자 `.env` 경로의 실제 시작 검사는 `node scripts/smoke-desktop.mjs --smoke-hermes --smoke-env`다. 기본 `test:desktop`은 `.env`를 읽거나 유료 Jev 호출을 하지 않는다.

## 확인 결과 (2026-11-01)

- `FR-UI-002`: 입력칸 28px과 버튼 30/32px, 문자 ＋의 기본 line-height와 ↑의 별도 line-height·폰트 fallback이 서로 달라 기준선이 어긋났다. 두 아이콘을 18px SVG·같은 32px 버튼으로 교체하고 textarea는 22px 행 높이+상하 5px로 32~120px를 사용한다. JS 높이 계산은 CSS min/max를 읽어 중복 상수를 없앴다. 상태/중단은 11px/16px·20px 행으로 맞추고 설정 입력/select/버튼은 32px, checkbox/첨부 삭제는 행 중앙에 맞췄다. button의 inline-flex가 hidden을 덮지 않도록 공통 hidden 우선 규칙을 둔다. Electron `panelLayout`의 `aligned/footerAligned/multilineAligned/hiddenActions/settingsFit`은 네 viewport/zoom 조건에서 컨트롤 중심·크기·아래쪽·숨김을 검사한다. 전체 단위/계약 검사 379개·typecheck·format·build·Mock Electron을 통과했다. 기존 대화/첨부/Markdown/명령 및 투명 배경도 같은 통합 검사에서 확인했다. 실제 Sway 앱 재실행에서 채팅/설정 정렬·포커스·alpha 204·32-bit ARGB·mapped를 확인했으며 근거는 ignored `.tmp/align-native-result.json`이다. 적용은 build 후 기본 런처 재실행, 복원은 해당 commit revert 후 같은 절차다. OS 재부팅/재로그인은 하지 않았다.

- `FR-UI-005`: alpha .8만으로 blur가 생기지 않고 기존 Kitty `app_id` 규칙이 Xwayland Companion에 일치하지 않던 원인을 수정했다. Yuru effects의 class+dialog 규칙을 원본·관리 설치·복원본에 추가하고 현재 창의 scoped blur enable 및 새 창 for_window 등록을 확인했다. global blur radius/passes와 캐릭터 Overlay는 바꾸지 않는다. include·journal SHA·headless SwayFX 설정 validate와 선택 설치/기존 백업 보존 2개 검사를 통과했다. 실제 앱 재실행 후 새 채팅/설정의 해당 criteria 일치·alpha 204·32-bit ARGB·mapped를 확인했다. IPC는 개별 blur 상태를 반환하지 않아 compositor 픽셀 차이를 검증했다는 의미는 아니다. 근거는 ignored `.tmp/blur-check/runtime-result.json`, `persistence.json`, `native-result.json`이며 적용·복원은 개인 환경 SwayFX 문서와 Dotfiles/yuru README가 소유한다. OS 재부팅/재로그인은 하지 않았다.

- `FR-UI-002/005`: 상단 브랜드 헤더·설정 버튼과 연결 handler를 제거하고 기존 우클릭/트레이/`/settings`를 사용한다. 고정 폭 user 박스·35px 들여쓰기·큰 padding/label 간격이 빈 공간을 만들던 원인이어서 내용 너비·얇은 구분선·작은 간격으로 정리했다. 입력칸은 한 줄에서 28~132px로 자동 확장한다. 실제 Kitty 마지막 include/기본 설정과 설치 글꼴을 확인해 Ubuntu Mono 11pt·D2Coding·Yuru 색·배경 불투명도 .8을 적용했다. 기존 Sarasa 우선 순위·버건디 박스 테마를 대체한다. Linux managed dialog는 transparent framebuffer를 사용하며 글자 전체 opacity/모델 Overlay와 SwayFX/Kitty 설정은 바꾸지 않는다.
- Electron의 `panelLayout`은 470×810·400×600·640×900·400×600의 125%에서 헤더 없음·짧은 말풍선 너비·가로 overflow 없음·footer/버튼 표시·입력 자동 확장·대화/설정 스크롤·font/rgba를 검사한다. `artifacts/compact-chat-smoke.png`, `compact-settings-smoke.png`는 실제 사용자 대화 없는 로컬 fixture 시각 근거다. own-window PNG의 빈 모서리 alpha 204/255를 확인했다. 초기 capture는 다음 paint 이전 입력값을 보던 문제여서 fixture scroll/paint를 기다리게 했다. 전체 단위/계약 검사 379개·typecheck·format·build·Mock Electron을 통과했고, 별도 변경을 제외한 UI 기준 230개 검사에서도 같은 수락 조건을 통과했다. 실제 Sway 앱 재실행에서 본문/설정·키보드 포커스·헤더 제거·배경 alpha 204·32-bit ARGB visual·mapped를 확인했다(ignored `.tmp/kitty-ui/native-result.json`). Electron getBackgroundColor는 alpha를 반환하지 않으므로 RGB 문자열로 투명 여부를 판정하지 않는다. 적용은 build 후 기존 앱 종료·설치된 기본 런처 재실행, 복원은 해당 변경 revert 후 같은 절차다. OS 재부팅/재로그인은 하지 않았다.

- `FR-CHAT-003`: 기존 요청은 text만 받았고 첨부 선택 UI·바이트 transport가 없었다. File 선택/채팅 drop/명시 paste, 파일명·크기·raster blob preview/삭제와 attachment-only 전송을 추가했다. main→Core→SSH는 제한된 바이트 snapshot만 전달하고 renderer 경로를 읽지 않는다. source probe로 지원을 확인한 뒤 이미지 immutable admission·일반 파일의 canonical file.attach ref를 사용한다. 새 UI가 시작 시 비활성화되던 원인은 configure에서 capability를 조회하지 않던 경로였고, 선택별 자동 discovery·이전 조회 무시·chat bootstrap 대기로 해결했다. 전체 230개 검사·typecheck·format·build를 통과했다. Mock Electron의 `attachmentComposer`는 실제 input/drop→blob preview→adapter 바이트·빈 텍스트 전송·제거와 Overlay/설정의 전송 거절을 검사한다. 초기에 테스트가 image read 완료 전에 확인하던 문제를 고쳐 실제 준비 완료까지 기다리며 `.message.user:last-of-type` 대신 전달한 파일명으로 bubble을 확인한다. 이미지 근거는 ignored `artifacts/attachments-smoke.png`, 수치 근거는 `artifacts/desktop-smoke.json`이다.
- 실제 default 전용 검증 세션에서 합성 PNG 숫자와 텍스트 파일의 임의 verification 값을 정확히 읽은 최종 응답을 확인했다(ignored `.tmp/attachment-check/live-result.json`). 실사용 session binding을 바꾸거나 기존 대화에 테스트 메시지를 넣지 않았고 Jev 호출은 0회다. 실제 Sway 기본 설정의 앱 재실행에서 지원 자동 조회·버튼 활성·이미지 paste/실제 preview load·초안 전송 준비·삭제·수평 잘림 없음·요청 미생성을 확인했다(`.tmp/attachment-check/native-result.json`). 이 UI 검사는 전송 버튼을 누르지 않았다. 검증한 build를 설치된 rofi 기본 항목으로 재실행해 실제 production 경로·동일 build·기존 설정/위치 보존·Overlay 한 개 mapped를 확인했다(`.tmp/attachment-check/production-result.json`). 파일 원문은 로컬 pending/log/Jev에 저장·전송하지 않는다. 이미 접수한 첨부는 자동 재송신하지 않으며 ACK 전 유실의 접수 여부 미확정은 기존 Hermes 계약의 한계다. 일반 첨부는 원격 후속 참조를 위해 보관되고 불확실한 이미지 stage는 remote cache에 남을 수 있다.

- `FR-DIR-005/FR-L2D-007`: 고개 반응이 잘 보이지 않던 원인은 작은 회전 target에 기본 강도 .65와 느린 4.5/s 추종이 겹치던 것이었다. 중립 전달의 headY target을 -.22→-.48, 명시적 끄덕임을 ±.24→±.60, 안심 끄덕임을 ±.24→±.36, 도리도리를 ±.30→±.52로 조정했다. 고개 추종은 명시적 끄덕/도리도리 8.5/s·전달/안심 6.5/s이며 idle·다른 표정의 추종은 유지한다. 전체 상하 offset/호흡·창 배치·반응 수명·Jev 판단/호출 수는 바꾸지 않았다. 기본 강도의 실제 회전 하한·idle과 같은 offset·승인 차단을 회귀 검사하고 기존 30/60/120fps·움직임 줄이기 검사를 포함한 전체 206개·typecheck·format·build·Mock desktop을 통과했다. 실제 DeepSeek/SDK의 idle 대비 physics 이후 각도 비교에서 중립 전달의 아래 끄덕임은 약 3.56°→8.60°, 명시적 끄덕임의 peak-to-peak는 약 6.55°→20.53°였다. 도리도리·안심도 증가했고 전체 offset 동일·손 포즈 없음·자연 종료를 확인했다(ignored `.tmp/nod-check/before.json`, `after.json`). headless의 기본 강도 로컬 모델 검증이며 화면 거리별 가시성/실사용 성능 보장은 아니다. 설치된 rofi 항목으로 기본 앱을 재실행해 Overlay 한 개·mapped·기존 설정/위치 보존을 확인했다(ignored `.tmp/nod-check/restart.json`). 적용은 build 후 기존 앱 종료·Live2D Companion 런처 재실행, 복원은 변경 커밋 revert 후 같은 절차다. OS 재부팅/재로그인은 하지 않았다.

- `FR-UI-004`: 캐릭터 우클릭을 트레이와 같은 native Menu 인스턴스에 연결했다. 항목은 채팅·설정·캐릭터 위치 복구·종료이며 alpha hit와 드래그 상태를 검사한다. main은 Overlay 전용 IPC로 제한한다. 위치 복구의 중복 코드를 단축키와 통합하고 복구 위치도 저장한다. 전체 단위/계약 검사 205개·typecheck·format·build·Mock Electron을 통과했으며 `artifacts/desktop-smoke.json`의 `overlayContextMenu`가 빈 영역 무시·동일 메뉴·채팅/설정 IPC 거절·위치/드래그 보존을 검사한다. 실제 Sway 기본 설정/모델에서도 해당 프로세스 소유의 `_NET_WM_WINDOW_TYPE_MENU`가 mapped 상태로 생성되고 채팅 미생성·위치 보존을 확인했다(ignored `.tmp/right-menu/native-result.json`). 이 검사는 실제 provider 메시지를 전송하지 않는다. 이후 설치된 rofi 항목으로 시험 wrapper 없이 실제 기본 앱을 다시 실행해 Overlay 1개·mapped 상태·WM class 및 기존 설정/위치 보존을 확인했다(`.tmp/right-menu/final-result.json`). 적용은 `npm run build` 후 기존 앱 종료·설치된 Live2D Companion 런처 재실행이며, 변경을 되돌리려면 해당 커밋을 revert한 뒤 같은 절차를 사용한다. OS 재부팅/재로그인은 수행하지 않았다.

- `FR-UI-002/004`: Linux 개발 checkout용 `install:desktop`이 사용자 bin/desktop/SVG 아이콘을 등록한다. 터미널/런처 PATH에 Node·npm을 요구하지 않고 로컬 Electron을 직접 실행하며 기본 compositor 환경과 기존 사용자 설정을 사용한다. 대상은 앱 관리 표식이 있는 파일만 재설치하고 알 수 없는 파일/symlink는 거절한다. 실제 사용자 파일 설치와 구문/desktop validator를 확인했다. rofi drun으로 설치된 항목을 실행·재호출해 같은 primary PID·Overlay 1개/기존 채팅 1개·mapped 상태·WM class 일치와 기존 설정/위치 보존을 확인했다. 검증 호출만 별도 rofi pidfile/normal-window로 다른 열린 메뉴와 분리했으며 등록된 기본 Exec/사용자 rofi 설정은 그대로다. 구조상 다음 로그인에도 같은 사용자 applications 경로에서 읽고 실제 앱 재시작도 검사했지만 OS 재부팅/재로그인은 하지 않았다. 비공개 수치 근거는 ignored `.tmp/launcher-check/cold-result.json`, `warm-result.json`이다. single-instance lock은 async 초기화 전에 획득하고 초기화 중 재호출도 준비 뒤 기존 채팅을 표시한다.
- 사용자 지시에 따라 앱 표시 이름/트레이/HTML/런처를 Live2D Companion으로 통일했다. `/new`의 configure 뒤 Overlay reload와 연결/Jev 전환의 무조건 reload가 캐릭터를 사라지게 하던 원인이어서 제거했다. 새 selection에서는 기존 Avatar 반응만 reset한다. 실제 모델/매핑·입력 backend/생성 옵션의 필요한 재로드는 유지한다. Mock Electron에서 동일 window/process/canvas·loaded 상태·증가하는 frame·중립/pose none을 확인했다(`sessionKeepsModel`). 전체 단위/계약 검사 205개·typecheck·format·build와 최종 Mock desktop 검사를 통과했다. 초기 검사에서 기존 모션 preview의 300ms 관찰 1개가 실패해 상태 수치 수집을 추가했으며 후속 두 실행에서 매핑·모델 유지·대화 복원 검사가 모두 통과했다.

- `FR-UI-002`: composer에 로컬 slash 명령과 접근성 목록을 추가했다. `/new`, `/settings`, `/stop`, `/status`, `/help`는 기존 IPC를 재사용하며 prompt·Jev·대화 bubble로 전달하지 않는다. 키보드/IME/중복·명령 실패 시 입력 보존·생성 대기 중 새 초안 보존·경로형 입력/미지원 명령을 검사했다. 채팅에서 새 세션을 만드는 경로가 생겨 설정 창의 configuration 무시가 이전 세션을 재저장할 수 있던 문제를 함께 수정했다. 설정의 미수정 provider 필드/저장 기준만 갱신하고 미저장 필드는 유지하며 늦은 조회가 최신 pending 상태를 되돌리지 않게 했다. 전체 단위/계약 검사 205개와 Mock Electron에서 실제 `/new` 생성/대화 초기화·설정 session 동기화·5개 메뉴 표시/viewport 경계를 확인했다. 테스트는 Mock이고 실제 사용자 세션에서 명령을 자동 실행하거나 새 Hermes 세션을 만들지 않는다. UI 근거는 ignored `artifacts/slash-menu-smoke.png`와 `artifacts/desktop-smoke.json`이다. format/typecheck/build/Mock desktop을 통과했고 실제 앱 재실행에서도 목록 5개·viewport 내 표시·Tab 완성·Esc 닫기와 설정/위치 보존을 확인했다. 이 실사용 세션 검사는 메뉴만 조작해 실제 `/new`·중단·prompt/Jev를 실행하지 않았으며 OS 재부팅/재로그인은 하지 않았다. 비공개 수치 근거는 `.tmp/slash-check/native-result.json`이다.

- `FR-DIR-003/005`: 사용자 지시에 따라 Jev 입력을 해당 답변만에서 현재 사용자 요청+해당 답변으로 확장했다. Core.send→Director.begin은 request별 문맥을 메모리에 보관하고 `ExpressionContext`로 전달하며, Jev state는 `user_request`/`assistant_message` 두 필드로 구분한다. 사용자 요청은 최대 1600자(긴 요청의 앞뒤 유지), 메시지 본문은 기존 800자/요청당 8회다. 사용자 감정을 캐릭터로 복제하거나 텍스트의 모션 명령을 실행하지 않도록 판단 기준을 분리했다. 새 요청·취소/선택/Dispose 경계에서 문맥을 정리하고 pending JSON에는 추가 원문을 넣지 않는다. 원문 없는 restore는 과거 요청을 임의로 채우지 않는다. 경계/길이/요청 교체·중간/최종 문맥 유지·metadata 원문 없음·별도 state 필드와 단일 호출을 검사했다. 실제 Jev에도 합성 위로/인사 문맥 쌍을 Core 경로로 각 1회 보내, 실제 JSON의 두 필드 일치와 각각 concerned/reassure, happy/wave 판단을 확인했다. 관찰 지연은 285/202ms 단발이며 문맥 정확도/지연 보장은 아니다. Hermes 실제 제출 없이 수행했고 비공개 수치 근거는 ignored `.tmp/context-check/live-result.json`이다. 전체 검사 191개·typecheck·format·build·Electron Mock 검사를 통과했고, 실제 앱을 최신 build로 재실행해 설정의 요청/응답 전송 안내와 독립 창·기존 설정/위치 보존을 확인했다. OS 재부팅/재로그인은 하지 않았다.

- `FR-DIR-004`: 인사에도 끄덕임만 나오던 원인은 Jev 인식 실패가 아니라 채널 확신도 결합이었다. 공개 인사 예문의 실제 Jev 결과는 wave .92였지만 emotion .56을 합친 최솟값 때문에 Director의 .6 기준에서 전체를 neutral/none으로 폐기했다. 저확신 채널은 각각 fallback하고, 유지한 채널만 통합 confidence에 포함하도록 고쳤다. 같은 인사 재평가는 wave .92를 유지했고 일반 진행 보고는 none .91이었다(수정 전/후/대조 각 1회). 단발 예문 결과이며 전체 정확도 보장은 아니다. 어댑터→Director 회귀와 반대 방향의 저확신 gesture, 실제 Avatar의 대기→손 인사 연결을 검사했다. 실제 DeepSeek/SDK에서 이전 acknowledge/손 selector 0과 수정 후 happy/wave·Movement2 최대 1·paired 포즈 활성 및 정상 복귀를 비교했다. Hermes 제출 없이 예문 Jev/로컬 모델만 사용했고 근거는 ignored `.tmp/greeting-check/judge-evidence.json`, `model-result.json`이다. 최종 typecheck·format·단위/계약 검사 187개·build·독립 설정창 포함 Electron Mock 검사를 통과했다.

- `FR-UI-002`: 채팅과 같은 DOM 구역에서 설정을 열어 conversation을 숨기던 구조를 독립 non-modal `view=settings` 창으로 분리했다. 같은 창 생성·보안 로직을 재사용하고 재호출은 singleton을 포커스하며 닫기/재열기는 chat을 reload하지 않는다. 환영 장문·연결 상세·Jev 표현 진단은 채팅에서 제거하고 설정 상세/성공 안내는 설정 창 안에 둔다. 프로필/세션 변경은 main의 configuration 알림과 bootstrap으로 동기화하며 동일 선택의 DOM·초안·스크롤을 보존하고 오래된 fetch 결과를 버린다. 설정 renderer의 메시지 제출/승인/중단 권한은 열지 않았다. renderer 통합 검사 6개는 별도 view·초안/스크롤·선택 변경 race·승인 중 preview 차단·설정 오류 격리를 검사한다. Mock Electron 검사에서 실제 두 창의 동시 표시/재호출·닫기/재열기·main IPC 제출 거절과 실제 설정 form의 모니터/표현·세션 변경 동기화를 확인했다. 전체 검사 184개·typecheck·format·build·Mock desktop을 통과했다. 실제 Sway 앱 재실행에서도 두 창 동시 표시·설정 singleton·독립 닫기/재열기·기존 대화 DOM/초안/스크롤 유지와 설정/위치 보존을 확인했고 Sway tree의 chat/settings 모두 floating이었다. OS 재부팅/재로그인은 수행하지 않았다. 실제 prompt/도구/Jev 호출 없이 수행했으며 비공개 수치 근거는 ignored `.tmp/clean-chat/native-result.json`, `sway-result.json`이다.

- `FR-DIR-005`: 진행 응답이 neutral/none이면 actor의 reaction도 idle과 같은 중립 파형이어서 변화가 거의 보이지 않던 원인을 수정했다. 사용자가 제시한 진행 문장을 실제 Jev로 한 번 평가해 neutral/none/neutral, confidence .98을 확인했으며 당시 요청의 저장된 판단 결과를 복원한 것은 아니다. 메시지 ID가 있는 중립 cue에 1.8초의 작은 끄덕임·교대 기울임을 넣고 감정·웃음·손 포즈와 호흡 offset은 바꾸지 않았다. 기본 중립 상태와 로컬 메시지 반응을 분리해 과거 history/snapshot은 재생하지 않고 동일 ID·승인 차단·자연 종료·30/60/120fps·reduced motion을 검사했다. 실제 DeepSeek/SDK의 같은 clock idle 비교에서 upstream AngleY 차이 최대 약 3.35, physics 뒤 ParamAngleY 차이 약 3.56을 확인했고 손 selector는 0·pose none·종료 뒤 중립이었다. 근거는 `tests/acting.test.ts`, `avatar.test.ts`와 ignored `.tmp/neutral-reaction/judge-result.json`, `model-result.json`이다. 외부 Hermes 작업 재전송 없이 예문 Jev 평가 1회와 로컬 모델만 검사했다. 모델 canvas 이미지도 비교했으며 전체 단위/계약 검사 178개·typecheck·format·build·Electron Mock 검사가 통과했다. 일반 앱을 최신 build로 재실행해 설정·위치 보존과 프로세스 실행을 확인했다. OS 재부팅/재로그인은 하지 않았다.

- `FR-DIR-004`: Jev가 설명을 넓게 선택하던 Choice 기준과, `gesture=none`을 설명 말투만으로 손 포즈로 승격하던 renderer 경로를 수정했다. 일반 답변/진행 보고는 none을 기본으로, 명확한 시연·교육 강조만 explain 후보로 두며 말투와 물리 제스처를 분리한다. 실제 Jev에 같은 한국어 예문 6개를 전후 각 한 번씩 평가했다. 수정 전 진행/결과/사실 답변 3개 모두 explain이었으나 수정 후 확인/진행/결과/사실 4개는 모두 none이었다. 직접 예제로 대조하며 가르치는 예문은 explain을 유지했고 일반 단계 안내는 확신 부족으로 none이었다. 표본별 단발 결과이며 전체 한국어 정확도/비율 보장은 아니다. 원문 대화 대신 합성 예문만 사용했으며 Hermes 제출/세션 변경은 없었다. 근거는 ignored `.tmp/explain-check/before-result.json`, `after-result.json`이다. 실제 DeepSeek/SDK fixture에서도 일반 예문과 설명 말투만 있는 입력의 손 selector가 0/pose none, 명시적 설명 제스처는 selector 1/pose 활성임을 확인했다(`.tmp/explain-check/model-result.json`). 전체 검사 175개·typecheck·format·build·Electron Mock 검사가 통과했고 최신 앱을 재실행해 기존 설정·위치 보존과 프로세스 실행을 확인했다. OS 재부팅/재로그인은 하지 않았다.

- `FR-DIR-005`: streaming도 thinking으로 매핑하고 도구 상태 변화가 actor reaction·표정 mixer·paired pose를 초기화하던 경로를 수정했다. streaming은 도구 작업이 없으면 idle, 같은 요청의 배경 상태 변화는 메시지 반응을 보존하고 반응 중 생각 포즈와의 합성을 멈춘다. 새 요청 경계는 renderer에서 명시적으로 reset하며 승인/복구/취소/오류는 계속 즉시 정리한다. 단위 검사는 메시지 연기 중 상태 변화 전후 동일 궤적과 자연 종료 뒤 최신 working 복귀를 비교한다. 실제 DeepSeek/SDK 로컬 fixture에서도 thinking→메시지 explain 손 포즈→working→thinking→idle 전환의 포즈/표정 유지, 자연 복귀와 승인 차단 즉시 정리, 짧은 놀람 뒤 긴 손 복귀 동작 완주를 확인했다. 사용자 thinking 자산은 메시지 도착 시 교체되고 이전 대기 clip의 cooldown이 실제 제스처를 막지 않는다. 근거는 `tests/avatar.test.ts`, `acting.test.ts`, `director.test.ts`와 ignored `.tmp/request-recovery/motion-result.json`이다.

- `FR-AG-012`/`AC-02`/`E-019`: 30초 무이벤트 뒤 타이머를 지우고 수동 조회만 기다리던 원인을 수정했다. 원래 요청의 자동 조회·재시작 복원, 미확인 최초+5회 backoff, 진행 확인 시 감시 재개와 승인 만료의 별도 처리를 추가했다. 이벤트 replay가 만료돼도 receipt로 진행을 확인하며 snapshot의 살아 있는 승인도 복원한다. 중복/낡은 요청 조회·dispose 뒤 타이머·원격 terminal 증거 없는 lease 해제를 회귀 검사했다.
- 실제 미수신 요청의 원격 receipt는 이미 completed였으며 최종 본문 886자가 남아 있었다. 같은 binding/request/admission 메타데이터로 별도 클라이언트의 `restore`만 호출해 자동 완료 복구를 확인했다. 실제 RPC는 `session.resume`, `prompt.receipt` 각 1회이며 새 prompt·중단·승인·Jev 호출은 0회다. 복구 본문을 snapshot으로 먼저 적용해 과거 모션을 재생하지 않는다. 비공개 근거는 ignored `.tmp/request-recovery/automatic-result.json`이며 본문·주소·ID는 기록하지 않는다. 실제 Sway 앱을 재실행해 같은 default 세션의 최종 답변이 history에 정확히 1개, 알림 없음·전송 가능·모델 로드 상태이며 기존 설정/위치가 유지됨을 확인했다. 이 검증은 새 prompt/도구 실행 없이 수행했고 OS 재부팅/재로그인은 하지 않았다.

- 이 변경의 `typecheck`, `format:check`, 전체 단위/계약 검사 174개, production build와 외부 AI 없는 Electron Mock desktop 검사를 통과했다. 검증 후 일반 앱을 최신 build로 재실행하고 선택 세션·표현 설정·배율·최신 위치 유지와 프로세스 실행을 확인했다.

## 이전 확인 결과 (2026-10-31)

- Hermes의 공개 중간 응답을 합치던 원인을 native `message.delta {text:null}` 경계와 비스트리밍 `message.interim` 처리로 수정했다. TurnView/messages와 메모리 history·renderer는 requestId+messageId로 말풍선을 나누며, 중간 message.complete는 요청 완료를 뜻하지 않는다. 앱의 prompt.submit에만 api_text 진행 보고 안내를 넣고 원래 transcript user text·프로필/서비스 설정은 보존한다. 같은 title의 session.create가 기존 제한 세션을 재사용한다는 원인도 확인해 명시적인 새 대화는 고유 제목을 사용한다.
- 실제 default의 독립 테스트 세션에서 read_file 두 단계(/etc/os-release, /proc/version) → 중간 응답 2개와 최종 답변 1개 → 서로 다른 messageId 3개·Jev 판단 1회씩을 확인했다. 응답 종료 후 추가 문장 큐가 재생되지 않았고 일반 앱의 선택 세션은 바꾸지 않았다. 별도 SSH 조회에서도 user 1/assistant 3개를 복원했다. 기존 bridge가 공개 display_commentary를 빠뜨리던 경로는 공개 문자열만 펼치는 방식으로 수정해 중간 응답도 재실행 후 보이게 했다. 최초 검사는 기존 테스트 title이 x_search 전용 세션을 재사용해 파일 도구가 없어 성립하지 않았으며, 고유 제목의 새 세션에서 다시 검증했다. 원문/키/실제 ID 대신 event 시각·메시지 순번·도구명/판단 enum만 ignored `.tmp/progress-check/result.json`에 기록한다. 모델의 진행 보고 빈도 보장은 아니다.
- 별도 Electron fixture는 중간/최종 bubble 복원·반복 snapshot 중복 없음·지난 기록 스크롤 유지·하단 추적과 외부 HTTP 0회를 확인했다. 단위/계약 검사는 단일 메시지의 여러 문장=판단 1회, 새 메시지 즉시 전환/취소, null/interim 경계와 복구·원격 sidecar 제거·고유 제목을 검사한다. 근거는 `tests/director.test.ts`, `core.test.ts`, `adapters-ssh.test.ts`, `history.test.ts`, `assistant-messages.test.ts`와 ignored `.tmp/progress-check/`, `.tmp/chat-layout/messages-*`다.

- `FR-UI-002/FR-CHAT-002`: user bubble 추가 때 scrollTop을 바꾸지 않아 전송 후 아래로 내려가지 않던 원인을 수정했다. 전송은 하단으로 이동하고 assistant 갱신 전 하단 32px 이내였을 때만 계속 따라간다. Markdown은 `markdown-it` 15.0.3 token을 allowlist DOM으로 구성하며 사용자 입력·history 원본은 바꾸지 않는다. 굵게/목록/fence/table·부분 fence 교체, HTML/위험 URL·이미지 미실행과 스크롤 정책 6개 검사를 추가했다. 실제 Electron fixture의 470×810·400×600·640×900·125% 확대에서 전송/응답 추적, 과거 읽기 위치 유지, 긴 코드의 내부 가로 스크롤, footer 표시와 외부 HTTP 요청 0회를 확인했다. 실제 Sway 새 앱 프로세스의 기존 default 기록 14개(user 7/assistant 7)가 창 reload/재생성 뒤 같은 순서·역할로 복원되고 표 3개/strong 17개가 렌더링되며 활성 링크/이미지/script/iframe 0개임을 확인했다. 실제 대화 원문은 증거 파일에 저장하지 않는다. 근거는 ignored `.tmp/chat-layout/markdown-*`다.
- `FR-DIR-005`: 사용자 피드백에 따라 답변 종료 뒤 밀리던 문장별 표현 큐/1.8초 유지 대기를 제거했다. assistant 메시지 하나당 대표 판단 한 번, 최대 800자·요청당 8회·짧은 prefix 수집(350ms)/판단 기한·2초 나이 상한을 적용한다. 새 메시지는 이전 미적용 판단을 취소하고 renderer도 이전 애니메이션 종료를 기다리지 않는다. 같은 messageId 중복/복구 텍스트는 재판단하지 않는다. 400ms 간격의 서로 다른 실제 DeepSeek 메시지 cue 세 개가 모두 수락되는 것을 별도 로컬 모델 검사로 확인했다. 새 동작은 이전 sentence 큐 설계를 대체한다. 별도 앱 프로세스 재실행에서 같은 default 일반 세션·최신 위치/배율/표현 설정 보존을 확인했으며 실제 OS 재부팅/재로그인은 수행하지 않았다.

- `FR-UI-002`: textarea의 바깥 focus outline이 간격 없는 전송 버튼과 5px 겹치는 원인을 재현했다. composer의 focus-within 경계와 10px gap·축소 가능한 textarea/고정 40px 버튼으로 변경하고, conversation의 flex 최소 높이·독립 스크롤과 답변 오른쪽/마지막 메시지 아래 이중 여백을 조정했다. 실제 Electron의 로컬 긴 대화 fixture를 470×810·400×600·640×900 및 125% 확대에 렌더해 포커스/버튼 분리·body/대화 가로 overflow 없음·footer 표시·스크롤 하단 도달을 확인했다. 실제 Sway 앱 새 프로세스·창 재생성에서도 10px 간격·40px 버튼·mint composer 포커스·가로 잘림 없음과 기존 history/session·배율/표현 설정 보존을 확인했다. 확인 중 위치 저장값이 바뀌어 이전 값으로 되돌리지 않고 최신 저장 위치로 일반 앱을 다시 실행했다. 이미지를 육안 확인했고 수치/이미지 근거는 ignored `.tmp/chat-layout/`에 둔다. 기존 TypeScript/Prettier·build·Mock desktop 검사도 통과했다. OS 재부팅/재로그인은 수행하지 않았다.

- `FR-CHAT-001`: 동일 default SSH 세션에서 실제 기록 8개(user 4/assistant 4)를 read-only로 읽고 native 채팅 DOM과 순서/본문이 일치함을 확인했다. renderer reload·창 닫기/재열기에서도 8개가 중복 없이 복원됐다. 원문은 출력/증거 파일/로컬 대화 파일에 저장하지 않고 역할 수·일치 여부만 ignored `.tmp/history-check/`에 기록했다. Mock desktop의 창 reload/재열기·세션 전환 후 복귀와 history/adapter/host 필터 회귀 검사를 추가했다. 별도 앱 프로세스를 다시 실행해 같은 기록의 본문/순서·default session과 기존 위치/배율/표현 설정도 복원됨을 확인했다. 새 prompt·도구·Jev 호출과 OS 재부팅/재로그인은 수행하지 않았다.

- TypeScript strict, Prettier 및 production build 통과. Unit/Contract 161개: 기존 전송/SSE·SSH receipt/replay·복구/lease·승인·저장·지연 판단·모델 경로·인증 입력·렌더 용량·입력 영역·모니터 배치에 더해 actor의 30/60/120fps 일관성, 감정/태도·반복/만료/blocked, idle 호흡 주기·위상/강도·몸 반응, expression crossfade, upstream/range 선택, 전체 손 pose endpoint와 진입/유지/복귀, 표현 설정 마이그레이션/저장 검사를 포함한다.
- 사용자 지시로 default의 테스트 연결을 프로필 설정 기반 일반 대화로 전환했다. 기존 생성 코드가 `toolsets: []`를 넣어 파일/터미널이 누락됐고, 기존 세션에는 실제로 x_search 3개만 있었다. 일반 `session.create`에서 toolsets override를 제거하고 제목/버튼을 일반 대화로 변경했다. 원격 메타데이터에서 file/terminal/memory 등을 포함한 최초 tool_count 20을 확인했으며 실제 앱을 통한 `read_file`의 `/etc/os-release` 조회→최종 답변을 확인했다. 도구 이름·완료 상태만 로컬 `.tmp/hermes-session-check/connect-result.json`에 기록하고 키/주소/세션 ID·원문은 공개하지 않는다. 기존 Discord 세션이나 canonical Bot Chat에 이어 붙였다는 의미는 아니다. 일반 대화 ID를 앱 설정과 ignored bootstrap에 저장하고 프로필/배치 설정을 보존했다. 관련 계약 테스트는 toolsets 미지정과 profile 추종을 검사하고 공급자 smoke에는 일반 대화 제출 방지 guard를 추가했다. 별도 앱 프로세스 재실행에서 default/동일 일반 session ID·연결 오류 없음과 bootstrap 일치, 기존 배치·배율·표현 설정 보존을 확인했다. 일반 연결의 공급자 smoke가 제출 전에 exit 1로 거절되는 것도 확인했다. OS 재부팅/재로그인은 수행하지 않았다.
- 팝업을 현재 사용자 Yuru rice와 같은 배경/면·크림 글자·민트 강조·버건디 경계/직각 컨트롤로 변경했다. 실제 palette/설치 GTK/Sway 설정과 대조했고 한영은 현재 브라우저와 같은 Sarasa Mono K를 사용한다(미설치 fallback 포함). renderer `style.css`의 변수와 main의 chat `backgroundColor`로 첫 paint까지 적용하며 다른 OS 설정이나 모델 자산은 변경하지 않는다. dark scheme은 chat에만 한정한다. 기본 Mock desktop·빌드·Prettier/TypeScript 검사를 통과했고 대화/설정/캐릭터 화면 이미지, 470×810 및 400×600의 수평 overflow 없음·직각/색/폰트 계산값을 확인했다. 근거는 ignored `.tmp/yuru-popup/`의 화면/`styles.json` 및 `artifacts/desktop-smoke.json`이다. 실제 Sway 새 앱 프로세스·팝업 재열기에서 색/폰트/직각·floating과 Overlay root/배경 투명 유지, 사용자 배치 보존을 확인했다. 일반 앱으로 재실행했으며 OS 재부팅/재로그인은 수행하지 않았다. 테마는 저장된 앱 CSS로 복원되고 rice 팔레트 자동 동기화는 아니다.
- 제작자 Cobalt/Laimu/Usagi 공개 영상의 연속 프레임을 조사해 얼굴·시선·고개·손의 조합을 우선했다. 상세 타임스탬프·관찰과 추론·후속 항목은 [상호작용 설계](../ux/INTERACTION_DESIGN.md#추가-조사-얼굴시선고개손을-겹치는-버튜버-연기)에 정리했다. 단안 윙크는 자료에서 확정한 관찰이 아니라 제품 연출 제안이다.
- 버튜버 연기 추가 후 Unit/Contract 132개와 기본 Mock desktop 통과. 14종 미리보기의 enum/실제 버튼·요청/승인 차단을 검사하고, 얼굴 helper는 실제 범위/중립값·좌우 독립·alias·physics 출력/자산 소유권 제외를 검사했다. happy+thinking의 감정 얼굴 보존·생각 시선 합성, 단안 윙크/복귀·볼/삐죽·고개 단발 accent, 놀람의 짧은 수명, 모든 신규 얼굴 채널의 30/60/120fps 일관성과 reduced motion/blocked 정리를 검증했다. 새 Jev 질문/호출·상하 offset 증가는 없다.
- 실제 DeepSeek headless에서 수정 전 990 draw/수정 후 1,980 draw를 30fps 시간 간격으로 비교했다. 0.7초 윙크의 좌/우 눈은 약 0.00225/1, 볼 입력은 최대 0.455, 삐죽 입력은 0.4225였다. 감정 smile 약 0.849를 유지하면서 mixed-thinking의 눈 시선 X는 약 −0.057→0.098, upstream AngleZ는 −0.944→−2.978로 달라졌다. expression→physics 순서 수정 뒤 놀람의 downstream `ParamBrowLY2`는 기존 0에서 약 −0.251~0.325로 반응하고 2.4초에는 표정 weight가 0으로 정리됐다. 강아지풀은 enter/hold/exit/none을 거쳐 Movement1이 1→0으로 복귀했다. root offset 최대 ±0.002925는 유지됐다. 얼굴·하트 눈·손 포즈 출력 이미지도 확인했으며, 실시간 GPU FPS/CPU 측정이나 TTS 동기 검증은 아니다.
- 로컬 시각 근거는 ignored `artifacts/motion-comparison/vtuber-v2-preview.jpg`, `vtuber-v2-showcase.mp4`(10fps로 추출한 55초 무음 모션 확인 영상), 수치/수정 전 비교는 `.tmp/vtuber-v2/{before,after}/traces.json`, `summary.json`이다. 모델/SDK/외부 제작자 영상은 커밋하지 않았다.
- 실제 Sway 앱 새 프로세스에서 14개 미리보기 버튼과 wink/pout/grass 적용·reset, 닫고 다시 연 창의 floating을 확인했다. 사용자 위치·배율·표현 설정·항상 위는 보존했고 일반 앱으로 다시 실행했다. 로컬 근거는 `.tmp/vtuber-v2/native-*.json`이다. OS 재부팅/재로그인과 외부 Hermes/Jev 호출은 이번 검사에서 수행하지 않았다.
- 기본 매핑에는 기쁨/슬픔/부끄러움/걱정과 손 들기/설명만 있었으며, 생각·놀람은 빈 선택으로 표시되고 생각 미리보기/상태 진입은 사용자 모션 매핑을 읽지 않았다. `@companion/thinking`/`@companion/surprised` 로컬 선택지를 추가하고 기존 actor·범위 기반 expression mixer를 재사용했다. 생각 미리보기/대기 진입/gesture가 같은 매핑을 사용하며 자산 인벤토리 23표정/8모션에는 가상 파일을 끼워 넣지 않는다. ModelLibrary/복원·범위 검사와 Mock desktop `mappingCoverage`가 기본 선택·사용자 생각 자산의 미리보기/상태 적용·로컬 선택 저장 및 renderer 재로딩·놀람 실제 expression 적용을 검사한다. 이전 사용자의 명시적 빈 선택과 유효 자산 연결은 보존한다. 로컬 `artifacts/surprised-smoke.png`로 모델 출력도 확인했다. 실제 Sway 앱을 새 프로세스로 실행해 모든 선택 행과 생각 미리보기의 `preset=thinking`·기본 연기 활성, 창 재열기의 floating 유지, 사용자 위치·배율·표현 설정·항상 위 보존을 확인했다. 근거는 ignored `.tmp/mapping-check-*.json`이다. 일반 앱으로 다시 실행했으며 OS 재부팅/재로그인은 수행하지 않았다. 외부 Hermes/Jev 호출은 이번 변경에서 수행하지 않았다.
- 채팅·설정 창 변경 후 실제 Sway/Xwayland 앱을 새 프로세스로 실행하고 창을 닫았다 다시 열어 두 번 모두 `floating=true`, `_NET_WM_WINDOW_TYPE_DIALOG`, `modal=false`를 확인했다. 앱 생성 코드에서 매번 지정하므로 별도 Sway 규칙·서비스가 필요하지 않다. OS 재부팅/재로그인 및 Windows 창 동작은 이번 검사에서 검증하지 않았다. 로컬 근거는 ignored `.tmp/floating-check-*.json`이다.
- DeepSeek 표정 23개·모션 8개의 표시 별칭을 추가했다. 의미 미확인 `脱捕`는 원문 병기, 알 수 없는 자산 이름은 원문 fallback이다. 기본 desktop smoke의 `localizedMaps`와 실제 창에서 ‘홍조’/‘검지 포즈 시작’ 표시, tooltip 원문 및 option의 원래 ID 보존을 확인했다. 파일 이름이나 기존 매핑은 바꾸지 않았다.
- 기본 Electron Mock smoke에서 기존 form/모니터/세션 라우팅 외에 `presentationControls`, `previewSafety`, `lockedGesture`, `approvalBlocked`, `approvalResumed`, `pendingSelection` 모두 통과했다. 로컬 미리보기 후 첫 실제 cue의 표정 weight 1·pose 활성, 표현 설정 적용 시 renderer/selection/request/위치 유지, renderer reload 복원, 뒤늦은 character 이벤트의 승인 차단 유지, 이전 느린 connect와 새 선택의 pending token 격리를 검사했다. 고의로 잘못된 IPC를 보내는 거절 로그는 예상된 거절 경로 검사 결과다.
- 실제 DeepSeek의 로컬 연속 프레임에서 고개 physics 출력이 thinking 중 약 −3.64까지 변하고, 설명 포즈 유지 중 `Movement3=1`과 손목/손가락 endpoint가 보존되며 복귀 뒤 모두 중립으로 돌아오는 것을 확인했다. happy→홍조→땀은 240ms crossfade 가중치가 연속으로 이어졌다. `neutral/none + attitude=tease`도 실제 장난 눈과 고개 연기로 적용됐다. 30fps 간격 시뮬레이션 1,980 draw와 10fps 간격 60 draw를 검사했으며 실시간 GPU FPS 측정은 아니다. 로컬 비교 영상/이미지는 ignored `artifacts/motion-comparison/updated-motion.mp4`, `before-after.png`, 수치 근거는 `.tmp/motion-after/*traces.json`이다.
- idle 호흡은 actor의 4.8초 들숨/날숨, bodyY 반응과 canvas 내부 전체 모델 상하 offset을 합성한다. 사용자 피드백에 따라 첫 bodyY 호흡 폭을 2배로 키웠다. 실제 DeepSeek 8초/240 draw에서 `ParamBreath` 약 .188~.812, `PositionY` 약 −2.335~1.967 및 physics 뒤 몸 반응, 초기 clip 좌표 offset ±.0117을 확인하고 상반신 렌더 이미지를 검사했다. 사용자의 과도한 상하 이동 피드백에 따라 전체 offset만 1/4(기본 연출 ±.002925, 4배 창에서 약 ±4 CSS px)로 줄였고 몸통 호흡은 유지했다. 강도/reduced motion·cue와 독립적인 위상·blocked 중립 회귀와 새 offset 한도는 unit test로 검사했다. 참고 영상과 구현의 차이는 상호작용 설계의 추가 조사 절에 구분했다. 초기 offset의 로컬 시각 근거는 ignored `artifacts/motion-comparison/idle-breath-root.mp4`, `.tmp/motion-after/breath-traces.json`이다. 앱 재실행 뒤 사용자 배율·위치·표현 설정 유지도 확인했으며 OS 재부팅/재로그인 검증은 아니다.
- 크기 상한을 기존 2배에서 4배로 올렸다. 설정 검증·설정 슬라이더·드래그 휠은 같은 범위(0.4~4배)를 사용한다. 높은 DPI에서 큰 창의 framebuffer가 기존 16,777,216픽셀/readback·GPU dimension 한도를 넘으면 내부 canvas 해상도만 낮추며 logical 창 크기와 입력 좌표는 유지한다. 실제 Sway 앱에서 4배(1760×2720) 저장·렌더와 native-shape 모드, 대화 selection/request 유지 및 이전 크기 복귀를 확인했다. DPI/GPU 한도 조합은 순수 함수 검사이며 실제 고 DPI 장치 검증은 아니다. 검증 후 사용자 위치·기존 배율을 유지한 일반 앱으로 재실행했다. 근거는 ignored `.tmp/scale-native-result.json`이다.
- attitude Choice 추가 후 기존에 허용된 Hermes 테스트 세션에서 `.env` 입력으로 실제 한국어 왕복·Jev 판단·새 actor의 happy/손 pose 적용을 다시 확인했다. 관찰된 Jev 왕복은 220ms 한 번이며 전체 지연이나 한국어 attitude 품질 보장은 아니다. 기존 provider 기억·canonical Bot Chat 연속성을 새로 검증한 결과도 아니다.
- 실제 Sway/Xwayland 앱 프로세스에서 조용함/상반신/배치 잠금/움직임 줄이기를 저장하고, 별도 앱 프로세스로 재실행해 네 필드와 기존 위치·크기 복원을 확인했다. 표현 설정 저장은 selection/request를 유지했고 실제 로컬 shy 미리보기도 확인했다. 검증 후 기존과 같은 기본 연출/전신/잠금 해제/움직임 줄이기 해제로 되돌리고 일반 앱으로 다시 실행했다. 사용자가 정한 부분 오프스크린 위치·배율과 항상 위는 유지했다. 실제 OS 재부팅/재로그인은 수행하지 않았다.
- npm audit 취약점 0건. CI 자동 실행과 Windows 빌드는 아직 없다.
- 실제 Electron headless에서 모델 파라미터 509개와 440×680 WebGL 출력, 알파 0인 빈 모서리, renderer Node `require` 접근 불가 및 좁은 preload 브리지 확인.
- 사용자가 승인한 Hermes `default` 전용 새 테스트 세션에서 delta→최종 본문→원격 receipt 완료를 확인했다. 기존 대화에 테스트 메시지를 넣거나 원격 서비스를 재시작/변경하지 않았다. 새 SSH 클라이언트의 동일 요청 receipt 복구도 통과했다.
- 실제 Hermes 답변을 실제 Jev가 `happy/wave`로 판단하고 모델의 실제 표정/모션 파라미터 적용까지 확인했다. 관찰된 Jev 왕복은 188ms와 208ms였으며 평균/최악 지연 보장은 아니다.
- 별도 앱 프로세스 재실행과 같은 로컬 연결 설정 사용을 확인했다. 실제 OS 재부팅·재로그인·장치 재연결·Windows 클릭 통과·DPAPI/Secret Service 지속성은 검증하지 않았다.
- 사용자 `.env`(소유자 전용 권한 600)의 bare Jev 키로 별도 앱 프로세스를 두 차례 실행했다. 두 번 모두 stdin 입력 없이 `credentialSource=env-file`, 실제 Hermes 완료·실제 Jev 판단·모델 표정/모션 적용을 확인했다. 파일을 다시 읽는 앱 재시작 검증이며 OS 재부팅/재로그인 검증은 아니다.
- 마스크 수정 뒤 실제 Electron headless Mock 검사에서 49그룹/2버퍼, 표정 weight 1·gesture 활성과 정상 얼굴/머리/꼬리 출력을 확인했다. 모델 파라미터 적용과 이미지 확인을 각각 수행했다.
- 실제 SwayFX/Xwayland 앱에서 모델 창의 `override_redirect=1`, root 직속·viewable 상태를 확인했다. 기존 managed Overlay는 전체화면 아래에서 `visible=false`였으나 새 창은 별도 sticky 규칙 없이 표시됐다. 모든 작업공간 위에 남는 생성 구조는 확인했으며 실제 작업공간 전환·OS 재로그인/재부팅은 이 검사에서 수행하지 않았다.
- 실제 Sway 커서 이동 명령으로 빈 영역→모델 재진입 시 자기 창의 pointermove 수신을 확인했다. 자기 Overlay만 대상으로 XTest 버튼/이동/휠을 보내 pointerdown→capture→이동→왼쪽 버튼 유지 휠→release 순서와 native 위치·크기 변경을 확인했다. 물리 마우스 전체 시나리오 수락을 대체하지 않는다.
- 입력 helper만 강제 종료한 뒤 XShape 조회에서 모델 영역이 전체 사각형 1개로 복구됨을 확인했다. native protocol 검사는 화면에 표시하지 않는 자기 소유 창에서 좌표 확대·표시 영역 불변·빈 입력 영역·EOF 복구·잘못된 사각형/개수·PID/소유권 거절을 통과했다.
- 실제 앱 재실행 뒤 위치·배율·항상 위 생성 방식·native 입력 영역의 자동 재적용을 확인했다. Linux 앱 자동 시작은 추가하지 않았다. OS 재부팅·재로그인·모니터 재연결 및 실제 고 DPI는 검증하지 않았다.
- 실제 Sway의 가로·세로 모니터 2대에서 자기 창에 XTest 드래그를 보내 모니터 경계를 넘긴 뒤 위치를 유지함을 확인했다. 실제 설정의 모니터 목록에서 현재 화면이 바뀌고, ‘선택한 모니터로 이동’ 버튼으로 반대 화면에 이동함을 확인했다. 부분 표시 상태와 배율 2도 앱 재실행 뒤 화면 안으로 밀려나지 않고 복원됐다. 실제 모니터 분리/재연결은 수행하지 않았으며 빈 공간·음수 원점 배치와 완전 이탈 판단은 단위 검사로 구분한다.

근거는 같은 변경의 `tests/`, `scripts/smoke-desktop.mjs`, main의 smoke 결과 생성 코드와 실행 결과다. 모델/SDK·키·개인 대화는 증거 fixture로 커밋하지 않는다.

## 남은 작업

첨부의 창 재생성/재실행 뒤 thumbnail·파일명 이력 복원, HTTP/Grok 첨부, native 파일 chooser/물리 클립보드 전체 수락은 별도 범위다. 현재 검증은 브라우저 File/ClipboardEvent를 통한 자기 앱 입력과 실제 SSH 왕복이다. 첨부 적용은 build 후 기존 앱 종료·설치된 Live2D Companion 런처 재실행이며, 복원은 변경 커밋 revert 후 같은 절차다. 별도 Linux 설정/서비스는 추가하지 않았고 OS 재부팅·재로그인은 수행하지 않았다.

Windows 실제 Overlay/포커스/드래그/클릭 통과·고 DPI·보호 저장소, canonical Bot Chat 동일성, Grok callback 가능성, TTS/립싱크, 실서비스 취소/승인, 릴리스 패키징/라이선스 확인이 남아 있다.
