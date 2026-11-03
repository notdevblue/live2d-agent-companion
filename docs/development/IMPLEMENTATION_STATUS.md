# 구현 및 검증 상태

**확인일:** 2026-11-03 · **버전:** 0.1.0-alpha.1 · **배포:** 로컬 개발용, Windows 릴리스 검증 전

<a id="현재-검증영상"></a>

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

## 감정별 물리 몸 연기 (Source 21 · 2026-11-03)

직접 조사와 구조 정리 뒤 `b33dfda`에서 기존 얼굴의 준비/복귀와 몸 자세의 시계를 맞췄다. 당황의 움찔→되묻기, 걱정→장난의 경직→초대, 윙크의 상체 지지, 화남의 잠깐 어깨 풀기, 걱정의 청자 지향 자세를 기본 경로에 통합했다. 몸 숙임은 canvas 접근과 분리하며 원본 IDLE의 `LeanInput` 소유권을 보호한다. 명시적 제스처·순수 기쁨/웃음/부끄러움의 목표·매핑/빈 선택·입/눈·판단 호출·몸 범위/수명·ambient 호흡/rootY·대기 빈도는 유지한다. 세부 근거와 관측 한계는 [연기 설계](../ux/ACTING_DESIGN.md#감정별-몸의-흐름-source-21)를 따른다.

620개 unit/contract·typecheck·format·build·Mock desktop, SDK89항목/322PNG를 통과했다. 실제 MOC20쌍480PNG/14,600 체크포인트의 범위 오류0·외부 요청0, 표본 MVP/대상 밖 upstream 변화0·새 좌우 손 잘림0을 확인했다. 모든 중간 기하나 실시간 FPS 검사는 아니다. 실제 Sway production renderer의 **09:59:41 KST** 검사에서8개 gesture-none 합성 흐름·UI20종·접촉/해제/승인/clear·renderer reload·대기 얼굴/손 복귀와 설정 보존을 확인했다. 기본 런처 재실행·기본 진입점과 원래 설정 digest 보존을 확인했다. provider/Jev 호출0이며 물리 마우스·OS 재부팅/재로그인 검증은 아니다.

새69초 비교 영상은 저장 profile14·기존59초 입력+10초 무입력·20fps를 유지하고 왼쪽 Source20과 오른쪽 Source21을 비교한다. 69초·1120×900·20fps·1380 paired frame export/ffprobe/최종 QA를 마쳤다. 양측1500회 범위 검사 오류0·외부 요청0이며, 47페이지 완료 읽기·exit0/end_turn을 검증한 Product21은72/100이었다. 변경 의도를 미리 설명하던 문구를 제거했고 시각 범위/표본/평가 기준은 유지했지만 완전히 같은 프롬프트 반복은 아니다. 종료 조건85점에는 미달이다. source freeze는23개 앱 파일이며 ignored `.tmp/grok-story-video21/source-21.json`, 상세 결과는 `.tmp/response-phrases21/`와 `.tmp/response-concern21/`에 있다.

## 현재 검증과 정리 범위

`461079a`에서 미리보기/일반 반응의 감정 변환·눈 강조 정책을 공통화하고, 화남의 눈/어깨 확인과 유지 시선 계산을 한 경로로 통합했다. 미리보기 happy의 원래 수명과 cue happy의2300ms 차이·우선순위·접근성·기한은 보존한다. 검증 없는 테스트 꼬리와 과거 lean 계수 비교를 위한 소스 변조/별도 실행을 제거했다. 현재 제품에 대한89개 SDK 수락 항목은 유지한다.

620개 unit/contract·strict unused typecheck·format·build·Mock desktop을 통과했다. Source21 대비1,066,752개 의미/전달/clear 프레임과126,360개 미리보기 프레임 차이0, SDK322개 캡처의 수집 파라미터·actor·표정 층·pose 값 차이0을 확인했다.09:59:41 KST의 실제 앱 검사에서 미리보기20종·8개 gesture-none 흐름·쓰다듬기/승인/clear/reload·대기 복귀·설정 보존을 확인했다. 검사 뒤 같은 기본 런처의 일반 앱으로 복원했다. OS 재부팅/재로그인은 하지 않았다.

회차별 공유·옛 점수 추이·PID·재시도 일지는 현재 문서에서 삭제했다. 새 보관 문서를 만들지 않았고 과거 문서 내용은 Git 이력으로 확인한다. 재생성 가능한 Chromium GPU/코드/셰이더 캐시410개 디렉터리·약452.6MiB와 오래된 진행 메모4개, 삭제한 과거 비교 경로의 생성물5개를 제거했다. 원본 모델·SDK·공식 참고자료·현재 영상/검토 근거·개인 설정은 정리 대상에 넣지 않았다.

현재 근거는 ignored `.tmp/cleanup-review/`의 unit/SDK/native 로그, `clock-equivalence.json`, `preview-equivalence.json`, `sdk-equivalence.json`, `cache-cleanup.json`, `doc-links.json`이다. 열린 GitHub 이슈는 확인 시점0개이며, [시각 검토에 남은 세 이슈](../ux/GROK_VTUBER_REVIEW.md#보류한-후속-이슈)는 별도로 남겼다. 추가 연출·85점 반복은 일시정지 상태다. 동작 보존 정리만으로 새 영상이나 재채점을 만들지 않았다.

## 유지보수에 필요한 원인과 계약

- 완료 본문 판단(`FR-DIR-005`): 첫 구간 판단은 뒤의 정정을 놓치므로350ms에는 로컬 중립 delivery를 제공하고, 완료 본문의 앞뒤800자를 메시지당 한 번 판단해 semantic으로 승격한다. 같은 메시지의 완료 뒤 수정은 재판단 대신 scoped `cue.clear`로 철회한다. 발췌 밖 수정·빈 delta·이전 ID·복구 snapshot도 구분하며 원문 없는 복원은 로컬 중립만 제공한다.
- Jev 문맥·확신도(`FR-DIR-003/004`): 현재 요청 최대1600자와 해당 답변 최대800자만 분리 전송한다. 요청당8회 한도와 취소/선택 격리를 유지한다. 감정·제스처의 최솟값을 전체 confidence로 쓰면 유효한 인사도 폐기되므로 저확신 채널별로 fallback한다. 웃음/장난의 모호한 분포는 검증한 묶음 확률과 사용자 임계값을 함께 적용한다. 설명 말투만으로 `gesture=none`을 손 포즈로 승격하지 않는다.
- 새 메시지와 손 소유권(`FR-L2D-004/006`): 이전 손이 남던 원인은 다른/none cue와 전역 cooldown의 결합이었다. 새 cue의 소유권을 즉시 반영하고 같은 손 반복 억제만 유지한다. clear·승인·취소·오류는 정리하며 낡은 scoped clear는 새 메시지나 직접 접촉을 지우지 않는다. 저장 특수 눈·빈 선택·custom 자산과 눈 외 표시 층을 보존한다.
- 채팅·설정(`FR-UI-002`): 설정을 채팅 DOM에서 분리한 non-modal singleton으로 제공해 초안·스크롤을 보존한다. `/new`와 연결 변경의 무조건 Overlay reload를 제거해 캐릭터 소실을 막고 필요한 모델/매핑 재로드만 유지한다. slash 명령은 기존 IPC를 쓰며 prompt/Jev로 보내지 않는다. 늦은 설정/세션 조회는 최신 선택을 되돌리지 않는다.
- 채팅 렌더(`FR-CHAT-001/002`): user 전송은 하단 이동, assistant 갱신은 기존 하단32px 이내일 때만 추적한다. Markdown은 allowlist DOM으로 구성해 원문을 바꾸지 않고 HTML·위험 URL·원격 이미지를 실행하지 않는다. Hermes history의 중간/최종 답변을 메시지 ID로 복원하며 replay를 새 연기로 재생하지 않는다.
- 첨부(`FR-CHAT-003`): UI 선택별 capability discovery와 bootstrap 대기를 사용해 지원 조회 전 버튼 비활성화를 해결했다. main→Core→SSH는 제한된 바이트 snapshot만 전달하고 renderer 파일 경로를 읽지 않는다. 첨부는 전송 시에만 원격으로 보내며 로컬 pending/log/Jev에는 원문을 넣지 않는다. ACK 전 유실은 접수 여부 미확정으로 남기고 자동 재송신하지 않는다. 원격 파일 참조/불확실한 이미지 stage 보관은 공급자 계약의 한계다.
- Hermes 요청 복구(`FR-AG-012`, `AC-02`, `E-019`):30초 무이벤트와 재시작 뒤 원래 요청을 조회한다. replay 만료는 완료 증거가 아니며 조회 실패의 최초+5회 backoff 뒤에도 lease를 보존한다. 승인 만료는 별도로 처리한다. `session.create`의 `toolsets: []` override는 프로필 도구를 없애므로 일반 대화에서는 생략한다. canonical Bot Chat 연속성을 입증한 것은 아니다.
- UI·blur(`FR-UI-005`): 서로 다른 버튼/문자 baseline과 hidden 우선순위는 공통 컨트롤/CSS로 통일한다. 최신 UI는 Ubuntu Mono·D2Coding과 불투명도 .8을 사용한다. alpha만으로 compositor blur가 생기지 않으며 Xwayland class+dialog 규칙이 필요하다. 개인 환경 규칙의 적용·복원은 해당 SwayFX 문서가 소유한다. IPC 상태만으로 픽셀 blur를 검증했다고 주장하지 않는다.

근거는 관련 `tests/`, `scripts/smoke-desktop.mjs`, `scripts/verify-expression.mjs`와 현재 통합 결과다. 실제 Hermes 왕복·Jev 판단·모델 반영과 앱 재실행을 확인했지만 공급자 의미 판단의 전체 정확도·최악 지연을 보장하지 않는다.

## 적용·복원

적용은 현재 checkout에서 `npm run build` 후 앱 종료·기본 `~/.local/bin/live2d-companion` 재실행이다. 별도 시험용 런처나 서비스는 없다. 이번 중복 정리만 되돌릴 때는 `461079a`를 revert하고 같은 절차로 실행한다. Source21 몸 연기까지 되돌릴 때는 이어서 `b33dfda`를 revert한다. 두 변경은 설정 schema를 바꾸지 않으므로 개인 연결/세션/매핑·위치/배율 이관은 필요 없다.

더 이전 버전으로 복원할 때는 Git에서 해당 버전의 구현 상태·설정 schema를 함께 확인한다. 새 감정/쓰다듬기 필드를 모르는 구버전은 앱을 종료하고 사용자 설정 디렉터리에 권한600의 백업을 만든 뒤 호환되는 필드로 복원해야 한다. 개인 연결 값·키·대화·모델/SDK를 저장소에 넣지 않는다. 구버전 rollback은 이번 검증에서 실행하지 않았다.

## 실행·복원 구조

후속 캐릭터 연기 구현(`FR-L2D-005~006`, `FR-DIR-004`, `FR-SET-003`): `acting.ts`는 결정적인 시선/단일·이중 blink와 시간 기반 damping, 감정·생각/설명 제스처의 조합, 반응별 시간 구조·제한된 변주 및 반복 억제를 담당한다. 좌우 눈·눈웃음·눈썹·볼/삐죽은 지원되는 upstream 얼굴 파라미터로 합성하며 로컬 미리보기는 초기화 포함20종이다. `performance.ts`는 범위/중립값/physics-output 검사, 표정 crossfade, authored pose의 진입/유지/복귀를 분리한다. `Avatar`는 DeepSeek의 `Angle*`/`Position*`/`LeanInput`을 구동한다. 이전 `ParamAngleZ` 직접 쓰기는 physics에 의해 0으로 덮였지만 현재는 upstream과 최종 출력 모두 변한다. 모든 모델이 같은 리깅을 제공한다고 가정하지 않고 없는/physics 출력인 채널은 생략한다.

표현 설정은 기존 설정 파일에 선택적 `presentation`으로 저장하고 이전 파일에는 기본값을 적용한다. 구도/강도/위치 잠금/움직임 줄이기만 바꾸면 adapter/session과 Overlay를 재생성하지 않는다. preview의 paired 손 pose는 기본1.5초 유지 후 대응 복귀 자산을 사용한다. semantic 손은 전체 의미 반응 기한에서 진입/복귀 시간을 뺀 동안 유지하며 두 경로 모두 손목/손가락 endpoint를 보존한다. pose와 clip은 같은 경과 시간을 쓰고 physics의 bounded step과 분리해 느린 프레임의 단계 불일치를 피한다. 일반 사용자 gesture 매핑은 기존 단발 재생으로 fallback한다.

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

## 남은 작업

첨부의 창 재생성/재실행 뒤 thumbnail·파일명 이력 복원, HTTP/Grok 첨부, native 파일 chooser/물리 클립보드 전체 수락은 별도 범위다. 현재 검증은 브라우저 File/ClipboardEvent를 통한 자기 앱 입력과 실제 SSH 왕복이다. 첨부 적용은 build 후 기존 앱 종료·설치된 Live2D Companion 런처 재실행이며, 복원은 변경 커밋 revert 후 같은 절차다. 별도 Linux 설정/서비스는 추가하지 않았고 OS 재부팅·재로그인은 수행하지 않았다.

Windows 실제 Overlay/포커스/드래그/클릭 통과·고 DPI·보호 저장소, canonical Bot Chat 동일성, Grok callback 가능성, TTS/립싱크, 실서비스 취소/승인, 릴리스 패키징/라이선스 확인이 남아 있다.
