# Grok의 VTuber 연기 검토와 반영 결과

**확인일:** 2026-11-03 · **검토:** Grok CLI 1.0.70 / 기본 `grok-4.7`(실제 실행 ID `grok-4.7-build`) · **현재 코드:** `bda756d` (Source 18) · **범위:** 무음 시각 경험

사용자는 Grok의 조사·문서 작성, 개선 반영, 영상과 재검토를 요청했다. 종료 조건은 **Grok의 100점 만점 평가 85점 이상**이다. 점수는 단일 모델의 주관적 UX 평가이며 정확도·성능·사용성 인증이 아니다. TTS·음성·음절 립싱크는 제외했다. 이전 코드 `4771977`의 통제된 normal·새 기본 기쁨 구성 평가는 **67/100**이다. 같은69초 조건에서 `15c37eb`는74점, `b2f1401`은69점이었고, 더 짧은59초의 `3a0fef4`도74점이었다. 점수는 단일 평가자의 주관적 의견이며 코드 효과만의 측정치가 아니다. 같은 코드에 실제 저장 expressive·기쁨 `＞＜` 구성을 적용한 Product14는 **73/100**이었다. `5f33da8`의 Source 15도 같은 저장 구성을 유지했고 영상 검증과 Grok Product15 평가를 마쳐 **78/100**이었다. `6be797e`의 Source 16은 눈 강조·독립 idle 얼굴·화남의 짧은 눈 재접촉을 보강했고 **76/100**이었다. `3953383`의 Source 17은 기쁨 눈 강조 길이와 걱정→장난 자세를 보완했고 **80/100**이었다. 현재 `bda756d`의 Source 18은 독립 idle 눈인사를 추가했으며 단위·SDK·native·영상 최종 QA를 마쳤으며 Grok 평가는 진행 중이다. 종료 조건85점 달성을 아직 주장하지 않는다.

## 조사 자료와 실제 확인 범위

Grok은 50.4초 앱 시연의 전신/얼굴 filmstrip 16개, 타임라인, renderer/Director 코드·구현 상태와 일반 VTuber/제작자 자료를 조사했다. 이어 사용자가 지정한 [Kamiya Ryoko의 같은 모델 공식 쇼케이스](https://x.com/kamiya_ryoko/status/2116052617080311882/video/1?s=46)를 우선 비교 자료로 읽었다. 해당 URL은 추가 턴에 원문 그대로 전달했다.

공개 메타데이터는 업로더 `kamiya_ryoko`, 게시 2026-10-30, 1280×720, 64.481초다. Grok이 읽은 공식 영상 자료는 .5초 간격 129프레임의 filmstrip 7장과 추가 확대 프레임 17개다. MP4 연속 재생·음성 동기·트래킹 원인·실시간 FPS는 확인하지 않았다. 편집 컷·확대·소품 토글을 실시간 연기와 구분했다.

Grok이 작성한 원문은 ignored `.tmp/grok-vtuber-review/report/GROK_VTUBER_REVIEW.md`와 `GROK_OFFICIAL_VIDEO_REVIEW.md`에 있다. 이 문서는 그 조사와 후속 평가를 실제 코드에 대조한 채택 판단·검증 기록이다. 검토 패킷은 공개 코드/문서와 요청된 영상의 렌더 파생물이며 인증키·기존 에이전트 대화·원본 모델/SDK는 포함하지 않았다. 교차 세션 memory는 껐다. 이 CLI 검토는 기존 Grok Bot 앱 Bot/Webhook의 callback·canonical Bot Chat 연속성 실증이 아니다.

## 지적과 채택 판단

최초 일반 검토는 생동감 약 3/10·캐릭터 매력 약 4/10이었다. 후속 100점 평가와 같은 척도는 아니다. 공식 대조의 핵심은 **그림은 이미 매력적이지만, 앱은 표정을 오래 유지하는 상태 표시에 가깝다**는 것이었다.

| 지적                         | 확인한 원인                                                    | 현재 반영                                                                    |
| ---------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 기쁨·웃음 뒤 같은 기본 미소  | 작은 눈 반응, 약한 몸 기울임, 여운의 공통 얼굴                 | 감정별 유지 얼굴, 한 번의 앞으로 다가옴→안정, 눈·고개 변주                   |
| 부끄러움+웃음의 갭 부족      | laugh가 shy의 시선 회피를 가림                                 | 약 .9초 회피 뒤 지연 웃음·홍조·재접촉                                        |
| 걱정+장난의 구분 부족        | 빠른 wink가 준비 감정을 가리고 눈 합성이 wink를 덮음           | 걱정 입·미간을 먼저 보여 준 뒤 약 .9초 늦춘 wink; 눈/깜빡임 억제에 같은 시계 |
| 화남이 기본 미소와 비슷함    | 음수 입 부족, 약한 눈꺼풀·측면 자세                            | 실제 음수 입·닫힌 입, 옆으로 돌기→부분 재접촉, normal 유지 눈 열림 약 .4025  |
| 혼란 눈이 긴 스티커처럼 남음 | 눈 아트와 얼굴/표시 수명이 같음                                | 짧은 흰 눈→원래 눈, 한 번 회피/젖힘→반대쪽 호기심 기울임                     |
| 설명·인사와 얼굴이 분리됨    | 손 hold보다 얼굴 body envelope가 먼저 끝남                     | 진입/유지의 유한한 고개·눈썹·시선 반응, 낮춘 손과 두 부분 올림               |
| 인사가 가슴 앞에 멈춤        | 원본 Movement2의 CDI 이름은 `2. 抚胸`이며 endpoint는 가슴 자세 | 검증된 중간 편 손바닥에서 세 번 흔들기→낮춘 유지→원본 exit 합류              |
| 직접 접촉의 관계감이 약함    | 독립 대기 방향에 작은 델타만 더함                              | 접촉 목표로 고개/시선/상체 보간, 사용자 홍조, 작은 접근과 해제 여운          |
| 기본/유지 고개·몸이 정적임   | 대부분 preset의 headX가 0이고 시선→고개 결합도 작음            | 측정한 upstream 결합·지연된 상체 호응, 초기 감정별 몸 반응                   |

일반 검토의 짧은 손 유지 제안과 공식 대조의 기존 긴 유지 보존 제안은 충돌했다. 승인된 인계 의도를 우선해 **의미 cue의 긴 손 수명은 유지**하고 얼굴·관절의 유한한 반응을 더했다. 짧은 로컬 미리보기와 의미 cue는 같은 수명으로 주장하지 않는다. 활성 의미 cue의 `gesture=none`에서 감정만으로 authored 팔을 올리라는 제안은 기존 계약 때문에 채택하지 않았다. Source 15의 독립 idle 손은 활성 cue가 없는 대기에서만 허용한다.

일부 평가의 ‘기본 가슴 앞 손’은 실제 전신의 리본/단추를 손으로 오독한 것으로 보인다. 해당 평가 소스의 기본은 양팔이 아래에 있었고, 실제 입력/selector와 전신 이미지를 함께 확인했다. Source 15에서 실제 추가한 유한한 local idle 손과 과거 오독을 구분한다. 초기 평가의 인사·blink 오독도 원문 점수를 취소하는 근거로 쓰지 않았다. 테스트 수나 파라미터 변화량을 매력 점수로 환산하지 않는다.

## 기본 경로의 구현

- `acting.ts`: 강조→유지→복귀, 감정/말투의 합성, 두 변주, 고개·시선·상체의 시간차 반응을 제공한다. 기쁨/웃음의 접근은 한 번이며 3초 무렵 안정한다. 순수 기쁨/웃음의 손 없는 반응은 1.85~3.7초에 청자를 확인하는 시선 뒤 약간 비스듬한 유지로 돌아온다. 기존 불규칙 대기 시선 슬롯에 한 번의 고개·지연 상체 이동을 더하며 새 body/발화 반복 시계는 없다. 다음 cue·정확한 clear·승인/취소/오류/reset과 원래 기한을 따른다.
- `performance.ts`/`avatar.ts`: 특수 눈과 홍조/눈물/땀을 분리한다. 눈 그림은 합계 기여로 표시 여부를 정하고 최대 기여 한 그림만 0/1로 넘겨 이중 홍채·회색 전환·빠른 세 그림의 중립 틈을 막는다. 연속 얼굴과 표시 층은 fade를 유지한다. 눈의 자체 짧은 수명과 의미 여운은 독립이다.
- `greeting.ts`: 정확한 기본 paired clip·selector·입력 범위가 모두 맞는 명시적 wave/explain에만 적용한다. 팔 입력 하나의 낮춘 유지와 5.1/9.6초 부분 올림을 사용하고 exit 첫 .3초에 원본 복귀로 합류한다. 다른/부족한/physics-owned 채널에서는 원본 경로로 fallback한다.
- `petting.ts`/`avatar.ts`/입력: 기본 꺼짐의 Shift+왼쪽 직접 stroke다. 자기 canvas 상단 실루엣의 유효 접촉만 사용하며 전역 포인터를 읽지 않는다. 접촉 목표와 원래 자세를 보간해 반대 방향 대기에 묻히지 않는다. 음수 입도 해제 시 연속 복귀한다. .3초 유지+.75초 fade는 최초 12초 한도를 넘지 않으며 한도 근처에는 fade 시간을 먼저 확보한다. 중복 종료로 연장하지 않고 요청/승인·오류/해제에서 정리한다.

새 인벤토리의 기쁨은 파일 없는 미소/눈웃음이며, 이미 저장된 특수 눈·빈 선택·사용자 자산 매핑은 유지한다. 자동 표시에는 검증된 눈/눈물/홍조/땀만 사용한다. 없는 채널은 생략하고 authored motion·physics 출력·손가락/selector를 임의로 덮지 않는다. 강도·움직임 줄이기는 진행 중에도 적용한다. TTS·음소·새 Jev 호출·사용자 기억/공급자 persona·OS 창 위치/저장 배율은 변경하지 않았다.

### 고개·상체의 실제 구동 경로 확인

같은 MOC·normal .65·480×720·고정 root 행렬에서 upstream→physics→정점/PNG를 측정했다. AngleX 의도 .3/.6/.9는 얼굴 최대 약 11.69/22.05/30.96px를 움직였다. 같은 AngleZ의 눈 선 기울기는 약 3.24/6.48/9.72도여서 중앙 얼굴 방향에는 X보다 약했다. PositionX .3/.6은 상체 11.67/23.48px와 평균 세로 약 .38px(.6)를 만들었다. 17개 자세의 범위 오류/외부 요청은 0이다.

시선→고개를 .65→1.6, 지연된 고개→몸을 .3→.65로 보정했다. 강도별 수평 고개 ±.7/상체 ±.5 한도와 기존 추적 속도·불규칙 시계를 보존한다. 같은 시선 의도 .3의 실제 얼굴/몸 변화는 8.49/2.95px→20.85/12.14px였다. 더 큰 입력의 정상 자세 대비 변화는 약 29.11/17.75px에 제한됐다. 모든 기존 자세에서 접촉점까지 이동하는 보편 상한은 아니다. 근거는 `.tmp/head-life-probe/proof.json`, `combined-proof.json`이다.

물리 그래프의 weight0만으로 시선이 안 움직인다고 판단하지 않았다. 고개·몸·root 고정 상태에서 ParamEyeBallX ±.65는 눈동자 정점을 약 6.61px, Y는 약 3.54–3.99px 움직였다. X는 직접 MOC binding, Y는 PupilY 경로도 확인했다. 다섯 자세의 범위 오류/외부 요청은 0이다. `.tmp/gaze-binding-probe/proof.json`이 근거이며 physics 출력 PupilX/Y를 직접 연결하지 않았다.

### 초기 감정의 몸짓 보강

실제 1초의 같은 시각 idle 대비 몸통 최대 변형은 기쁨 27.04px·웃음 28.78px·화남 12.28px였다. 이전 코드 대비 증분은 18.66/20.63/12.86px다. 걱정의 추가 몸통 변화는 1초 .22px로 작고 주로 머리 숙임 변화였다(3초 몸통 증분 5.32px). 혼란은 회피→반대쪽 기울임을 두 변주로 확인했다. 근거는 `.tmp/emotion-body07/proof.json`, `.tmp/emotion-body08/proof.json`이다.

이러한 접근과 접촉 중 .18 목표 lean은 기존 Avatar의 negative LeanInput·zoom/anchor 경로를 쓰므로 **국소 자세의 MVP는 의도적으로 바뀐다**. 더 강한 기존 양수 lean은 보존한다. ambient offsetY·호흡·OS 창 위치/저장 배율을 키운 것은 아니다. 큰 양수 LeanInput의 포화 사례를 대기 움직임의 대체로 쓰지 않았다.

### 직접 접촉의 손과 재접촉 연속성

Source 11에서는 직접 입력에 한해 원본 가슴 손 포즈를 추가했다. Source 15의 독립 idle도 pair·7개 입력 검증을 공유하지만 직접 입력 조건·소유권·기한은 분리한다. 유효한 위치/알파 적중 8px와 정확한 기본 pair·7개 비물리 입력/endpoint·빈 소유권·충분한 수명이 조건이다. custom/빈 매핑·움직임 줄이기·늦은 접촉이면 기존 몸/얼굴만 사용한다. 기존 `PoseSequence`와 원본 곡선을 재사용하며 활성 의미 cue의 `gesture=none`에서 감정만으로 손을 올리는 동작은 추가하지 않았다.

부분 진입 해제는 마지막 렌더 프레임부터 원본 entry를 거꾸로 따라가고 hold 뒤는 원본 exit로 돌아온다. 해제 최대1.05초·정지 .9초·최초12초 안에 끝난다. selector를 가중 혼합하는 후보는 실제 이중 팔 그림이 나와 기각했다. scoped 메시지 clear는 독립된 직접 접촉을 지우지 않고 새 cue/요청·승인·오류·disable은 즉시 정리한다.

독립 검토에서 복귀 중 재접촉의 손 팝과 몸/눈 초기화가 발견되어 수정했다. 같은 기존 손 복귀와 기한을 보존하고 몸 fade 하나만 원래 시각/기한 그대로 carry한다. 새 유효 stroke 없는 begin/end는 옛 가중치를 새 기한으로 재활용하지 않는다. 실제 MOC의 1851ms 재접촉과 같은 시각 무접촉 대조는 MVP·전체 정점 차이0이었다. 이전 프레임1850ms와의 손 .97px 차이는 원본 복귀의1ms 진행이다. `.tmp/petting-body-feasibility/recontact-geometry-control-results.json`, `recontact-geometry-carry-results.json`이 근거다. SDK의 별도 재접촉·무 stroke·scoped clear 수락 검사도 통과했다.

대기 자세 이동은 actor만 바꾼 같은 시각 대조에서 몸통 최대 약10.10px, 기쁨/웃음3.2초는 약13.56/12.83px 변했다. `.tmp/presence-round10/proof.json`의74개 실제 체크포인트에 범위 오류/외부 요청/자동 손0이었다. 이는 actor 단독 기하 비교이며 최종 통합의 매력 점수나 실시간 성능 측정이 아니다.

### 독립된 expressive 대기 손동작 (Source 15)

기존 눈·고개 위주의 대기에 유한한 몸짓을 더하기 위해, **활성 cue가 없는 expressive idle**에만 검증된 원본 가슴 손 pair를 사용한다. 활성 의미 cue의 `gesture=none`에서 감정/말투만으로 손을 추가하는 계약은 바꾸지 않는다. `Avatar`의 `localIdleGesture`가 별도 소유권을 가지며 actor는 inactive/gesture none으로 남는다. Jev 판단·메시지·별도 MotionManager는 만들지 않는다.

기존 `gazeSlotId`의 네 번째 슬롯 edge마다 한 번만 검토한다. 시작 시각은 기존 불규칙 시선을 따르며 새 랜덤 타이머·주기·대기 큐가 없다. 비활성 조건에서도 edge를 소비해 cue 종료·설정 변경 직후 놓친 동작을 재생하지 않는다. 프레임이 크게 건너뛰어도 현재 edge 한 번만 처리한다. 원본 진입1133ms→유지600ms→복귀1017ms, 총2750ms를 같은 `PoseSequence`로 진행하고 기존 의미 손 cooldown·12초 반응 수명을 소비하거나 늘리지 않는다.

expressive/움직임 줄이기 꺼짐·idle·actor 반응 없음·빈 pose/gesture/state gesture·모션 manager 종료·pet 손/잔여 반응/held contact 없음이 모두 필요하다. 아직8px를 문지르지 않은 접촉도 `contactHeld`로 차단한다. 직접 petting과 공유하는 canonical wave 매핑·정확한7개 비물리 입력/범위/endpoint 검사를 통과해야 하며 custom/명시적 빈 선택/부족한 자산이면 생략한다. IDLE이 `Movement2`/`Param59~62`를 직접 구동하면 자동 idle 손을 생략하고, 기본 IDLE의 공유 조명 입력 `Param56/57`(CDI `光2`/`光4`)만으로는 차단하지 않는다. 사용자 IDLE·semantic/petting의 기존 우선권은 유지한다.

Source 15에서는 손을 잠시 내려다보는 고개/시선만 진입·복귀에 맞춰 보간하고 얼굴·입·호흡·rootY를 바꾸지 않았다. Source 16의 유한한 미소/눈 재접촉은 아래에 별도로 기록한다. 실제 접촉 overlay가 나중에 적용돼 방향 우선권을 가진다. 진행 중 pet begin은 idle 손을 재시작·이관·연장하지 않고 원래 기한대로 끝낸다. 해당 접촉은 몸/얼굴만 반응하며 pet end도 다른 소유자의 idle 손을 지우지 않는다. 자연 종료 뒤 새 접촉부터 기존 pet 손 경로를 다시 사용할 수 있다.

수락된 새 cue/승격, 요청·thinking/working·승인·오류·reset·preview·dispose는 idle 손을 즉시 정리한다. 무시된 stale cue나 이미 끝난 메시지의 scoped clear는 독립 idle 소유권을 지우지 않는다. normal/quiet·움직임 줄이기로 바꾸면 진행 중 손도 정리한다. 실제 SDK의 양성 대기·설정/매핑/작업/active-none 차단·승인 정리·접촉 중 기존 기한 유지, production renderer의 시작→자연 종료와 설정 보존을 아래 근거로 확인했다.

### 유지 얼굴과 대기 시선의 합성 원인

기쁨/웃음의 유지 얼굴이 같은 눈 열림/미소로 수렴했고, `Math.max(.12, heldFace.mouthOpen)`이 웃음의 명시적 입 열림0을 덮었다. 기본 최소값을 감정별 유지 목표로 옮겨 닫힌 입을 존중하고 neutral acknowledge의 기존 .12만 명시적으로 보존했다. 손 없는 기쁨은 밝은 열린 눈, 웃음은 한 번의 웃음 뒤 닫힌 입의 더 큰 미소로 분리하며 compound 감정 override와 화남 종료 fade를 유지한다. 실제 같은 rig8초에서 기쁨 눈 .844/입 .117, 웃음 눈 .467/입 약0/입꼬리 .52를 확인했다. `.tmp/face-hold12/face-grid.jpg`와 `results.json`은 이 얼굴 변경만의 대조이며 이후 대기 변경의 통합 근거와 구분한다.

대기에서도 눈과 고개를 같은 감소 목표에 묶어 모두 함께 돌아오는 원인이 있었다. 기존 불규칙 슬롯 안에서 눈은 먼저 이동→작은 반대 방향으로 복귀하고 고개/지연 상체는 다음 슬롯까지 측면 목표를 유지하도록 분리했다. Y 복귀·추적 속도·원래 head/body clamp·breath/rootY는 보존한다. 실제 MOC13자세(머리±.3/±.4×눈±.3/0)의 반대 눈 입력은 같은 고개에서 홍채 중심을 약1.59~1.75px 움직이고 눈 흰자·얼굴·코/MVP는 그대로였다. 범위 오류/외부 요청0이며 `.tmp/eye-head-calibration12/proof.json`과 grid가 근거다. 반대쪽을 보는 인상은 확인했지만 사람과의 시선 접촉을 정량 보정한 것은 아니다. 전체 영상과 SDK에서 최종 조합을 별도로 확인했다.

Source 16에서는 저장된 기쁨 눈 아트가 열린 눈의 기쁨 여운을 오래 가리던 경로를 보완했다. `cue.emotion=happy`의 눈 층에1500ms 수명/400ms fade를 적용하되 기존 confused1400ms·laugh1200ms·tease1100ms 우선순위는 유지한다. 저장된 자산 이름·명시적 빈 값·custom 자산을 바꾸지 않으며 눈 이외의 홍조/땀·사용자가 선택한 나머지 자산 파라미터는 기존 층/수명을 따른다. 실제 저장 `＞＜`는5초에 유지되고6~8초에는 열린 눈의 기존 기쁨 얼굴로 이어졌다. `.tmp/charm-gap-review15/proof.json`과 `happy-face-pairs.jpg`는 이 후보의 실제 MOC 대조이며 Source 15 원본은 보존했다. 최종 Source 16도 별도 SDK/영상에서 확인했다.

독립 idle 손의 같은 pose 가중치에 smile .55·eyeSmile .45·눈 열림 .75×blink를 연결했다. 손을 본 뒤 hold200~600ms에 눈만 정면으로 돌아오고 원본 exit와 함께 얼굴도 복귀한다. 새 입 열림·호흡/root 변화·새 시계·손 포즈는 없다. 특수 눈/자산·physics 보호와 직접 접촉 overlay 우선권, expressive/접근성 gate·2750ms 기한도 유지한다. 실제64~65초의 미소/눈 반응과66~67초 기존 idle 복귀를 `idle-face-pairs.jpg`와 최종 영상에서 확인했다. 이 작은 표정 연결의 기하·범위 통과를 매력 향상 점수로 환산하지 않는다.

순수 `angry` preset·`gesture=none`에는 기존 cue1.95~3.1초 안의 한 번의 눈 확인을 더했다. 변주 방향의 gaze .45와 눈 열림 .22에 기존 강도를 적용하고, pose 적분 뒤 눈에만 투영해 시선→고개→상체 추종이 옆으로 돌린 몸을 되돌리지 않게 한다. 같은 입력 대조에서 고개/몸·찡그린 입·입 열림·호흡은 동일하고 blink·원래 기한/clear·compound override는 유지한다. 최종 영상38.25~38.5초의 눈 확인과39.25초 원복을 확인했으며, actual SDK와30/60/120fps·강도/접근성·override·종료 검사를 통과했다. 감정 없는 idle에 화남을 추가하거나 몸 실루엣의 새 개선을 주장하는 변경은 아니다.

Source 17은 기쁨 눈 강조를1500→2300ms로 조정해 특수 눈의 정점을 약2.1초까지 읽은 뒤 열린 기쁨으로 이어지게 했다. 400ms fade와 confused1400/laugh1200/tease1100ms 우선순위·저장 자산/빈 값/custom 나머지·홍조/땀 수명은 그대로다. Source 16의 idle 얼굴·화남 눈 확인과 새 손 없음 계약도 유지한다.

걱정+tease는 깊은 숙임·큰 회피 시선·반눈이 겹쳐 이 rig에서 조심스러움보다 무심/피곤한 인상으로 보였다. 기존10초 actor headX−.698은±.7 한도에 가깝고 headY−.713/실제 ParamAngleY−22.97°였다. 입의 frown은 이미 구동되고 있어 음수 입이 약해서 생긴 문제는 아니었다. 해당 복합 조건 안에서만 기본 눈 열림 .64/.78→.88/.96, anticipation headX−.18→−.08, headY−.42+.3×reconnect→−.18+.1×reconnect, 초기 gazeX−.5→−.12/gazeY−.28→−.12로 줄였다. worry/reconnect·지연 wink 시계·변주·수명은 유지하고, smile은 초기−.82를 보존한 채 걱정이 풀릴 때−.18 대신 닫힌+.4의 장난 미소로 이어진 뒤 기존 concerned 여운에 합성한다. 다른47개 emotion/attitude 조합×8시각의376개 frame은 Source 16과 동일했다. 전역 gain/clamp·breath/rootY/lean·입 열림·LLM·손·땀 수명은 바꾸지 않았다.

실제 MOC 후보는 각 측260프레임/380회 범위 검사에서 오류/외부 요청0,9시각의 MVP 동일을 확인했다.10초 headX−.520/headY−.285로 포화에서 떨어졌고9~10초 열린 눈의 조심스러운 얼굴→10.5초 기존 wink/작은 미소로 이어졌다. `.tmp/charm-worry16/REVIEW.md`, `candidate.patch`, `proof.json`, `worry-face-pairs.jpg`가 근거다. 이는 특정 rig/저장 expressive 구성의 후보 대조이며 강한 걱정 기호나 종합점수 상승을 보장하지 않는다.

땀은 `key13=1`만으로 항상 보이는 그림이 아니다. 원본5.983초 IDLE의 `SweatBurst1~4`가 표시를 반복하며9/10/11.5/12.5초의 땀 mesh opacity는0,9.5/10.5초와11/12초에는 실제 켜진 mesh가 있었다. 중간 조사에서9.5초도 전부0이라고 한 표현은 오류여서 최종 근거에 정정했다.11초의 땀 투영 크기는480×720 canvas에서 최대 약5.3×8.2px로 작았다. `.tmp/charm-worry16/authored-sweat-curves.json`과 실제 opacity 근거를 보존하며 authored 스위치·physics 출력을 강제로 켜거나 땀 수명을 바꾸지 않았다.

### 몸통 기울임의 누락과 짧은 손 복귀

현재 MOC는 `PositionZ → physics → ParamBodyAngleZ`로 가슴·허리·엉덩이를 기울이는데, 기존 actor에는 bodyZ가 없었다. IDLE에도 이 곡선이 없어 머리를 더 움직여도 몸통 roll은 구동되지 않았다. 별도 실제5자세에서 normalized±.15/±.30은 어깨선 약∓1.91°/∓3.82°, 몸통 최대 약4.56/9.09px를 만들었다. MVP·selector·opacity 변화와 범위 오류/외부 요청은0이다. `.tmp/body-roll-probe13/proof.json`이 근거다.

기존 고개 시계에서 지연된 bodyZ를 생성하고 actor의 강도별±.3 한도를 적용한다. 현재 rig의 같은 부호는 머리와 어깨가 반대로 기울어 자연스러운 균형을 만든다. 미지원/physics-owned 입력은 생략하고, IDLE 자체가 PositionZ/BodyAngleZ를 소유하면 새 binding을 끈다. 메모리 안에서만 PositionZ 상수5를 넣은 실제 IDLE 대조에서도 사용자 authored 값5가 유지됐다(`.tmp/idle-ownership13/proof.json`,122,160회 범위 검사 오류/외부 요청0). 직접 접촉은 같은 envelope로 몸통 방향도 보간한다. 진행 중 강도/움직임 줄이기 변경 시 bodyZ까지 즉시 제한한다.

머리 자세는 웃음과 토라짐의 유지 기울임을 반대 방향으로 더 구분하고 대기 tilt를 기존 불규칙 슬롯 안에서 보강했다. 실제 결합142PNG·4,519,920회 parameter 검사에서 오류/외부 요청0, MVP·breath·offsetY 변화0이었다. idle2.2초 어깨/몸통 차이는 약+1.64°/3.58px, laugh4초−2.33°/5.10px, angry4초+1.01°/2.21px였다. normal/expressive 손과 reduced explain도 대조했다. `.tmp/posture13c/proof.json`이 근거이며 정점 변화량을 매력 점수로 환산하지 않는다.

설명에는 짧은 미리보기 안의 두 번째 고개/눈썹 박자와 검증된 Param41의 유한한 point를 더했다. 또 짧은 미리보기의 손은 기본1500ms hold여서 explain은2750ms, wave는2633ms에 복귀를 시작한다. 기존 overlay가 이를 fully relaxed 상태로 가정해 손을 뛰게 했다. `PoseFrame.heldMs`로 실제 유지 끝의 overlay를 평가하고 원본 복귀의 첫300ms에 합류하도록 고쳤다. 실제1ms 경계 손 최대 이동은 explain48.92→2.10px, wave14.23→.031px였다(`.tmp/preview-return13/proof.json`). explain의 남은 차이는 원본 Param41 끝값 .702→.700 불일치가 주원인이다. 이를 상쇄한 ignored 진단만 .661px였으며 production 결과로 주장하지 않는다. 원본 미세 불연속은 남기고 실제 자산 차이를 포함한 수락 허용값을 명시했다.

기존13.15초 미확인 clip의 body 곡선만 추출하는 후보도 실제26자세로 검사했지만 기각했다. 후반 약151/178°/s의 빠른 흔들림·숙임이 있고 초기 자세도 명확한 개선이 아니었다. `.tmp/filtered-motion-spike12/proof.json`을 보존하며 그 미확인 자산의 authored idle loop·손/소품 연결은 추가하지 않았다. Source 15의 검증된 기존 pair를 쓰는 유한한 idle 동작과 구분한다.

### 기각한 자산과 종료 경계 수정

알려진 `屑屑眼`(key6)도 실제 MOC에서는 눈뿐 아니라 입을 작은 원으로 바꿨다. MouthForm −1·MouthOpen0에서도 같아 닫힌 화남을 강화하는 자산으로 채택하지 않았다. 절차 눈 열림 .7/.5/.4/.3을 비교해 normal 약 .4를 택했고, .3은 졸린 인상이라 피했다. `.tmp/face-probe/angry08-lids-grid.jpg`와 기각한 key6 비교를 보존한다. 미확인 분노 effect·Emotion/Emotion2·탈포착·새 리깅은 연결하지 않았다.

코드 검토에서 화남의 눈꺼풀이 기존 envelope를 우회해 약 .5를 유지하다 기한에 1로 뛰는 원인을 찾았다. 화남의 계산된 눈 모양에 기존 강조+유지 가중치를 적용해 중립으로 복귀하도록 고쳤다. 8초 유지값 .4025는 같다. 실제 의미 반응 16100/16199/16200ms는 약 .99184/.99896/1, 미리보기 4150/4200ms는 약 .99086/.99736이었다. 종료 직전·미리보기/delivery·정확한 clear·30/60/120fps·강도/접근성을 검사했다. `.tmp/angry-tail-fix/proof.json`과 현재 SDK 결과가 근거다. 이 수정 전 Round08과 수정 후 Round09를 같은 소스라고 표기하지 않는다.

## 평가 방법과 보존한 점수

처음 메인이 추가한 고정 평가는 **기존 그림을 제외한 연기 기여도**였다. 사용자 원문의 전체 VTuber/오타쿠 매력보다 좁아, 이후 기존 아트를 포함한 종합 평가를 별도로 받았다. 둘을 같은 점수의 상승으로 합치지 않는다. 초기 일반 10점 의견도 별도 척도다.

| 연기 기여도 단독 | 점수   | 근거                |
| ---------------- | ------ | ------------------- |
| Round01          | 60/100 | `round-01-score.md` |
| Round02          | 57/100 | `round-02-score.md` |
| Round03          | 57/100 | `round-03-score.md` |
| Round04          | 63/100 | `round-04-score.md` |
| Round05          | 60/100 | `round-05-score.md` |

이 원문들은 ignored `.tmp/grok-grading/`에 보존한다. 다섯 항목(감정 가독성·시간 리듬·채널 조합/생동감·캐릭터 매력/변주·직접 입력 반응)을 각 0~20으로 평가했다. 고정 before는 `29b85f0`이고 긴 비교 영상은 `artifacts/grok-review/round-XX-comparison.mp4`다. 뒤의 유지/손 복귀까지 포함한 최종 긴 자료는 167.5초·3350 paired frame이다.

| 전체 그림+연출 종합 | 점수    | 관찰 조건·판단                                                                                           |
| ------------------- | ------- | -------------------------------------------------------------------------------------------------------- |
| Product05           | 60/100  | 59초, 1초 간격, 얼굴5/몸8페이지. 일러스트 호감보다 정적인 유지가 약점                                    |
| Product06           | 58/100  | 같은 1초 자료. 고개/몸 보정만으로 충분한 생동감으로 읽히지 않음                                          |
| Product07           | 72/100  | 같은59초, 균일 .5초+마지막119시각, 큰 전신 포함40페이지로 변경                                           |
| Product08           | 72/100  | 같은 .5초/40페이지. 걱정→장난·혼란·화남 대비 보강, 입력 표식 제거. 종료 경계 수정 전 소스                |
| Product09           | 74/100  | 종료 페이드 수정본·같은59초/.5초/40페이지                                                                |
| Product11           | 69/100  | 대기/직접 접촉 손 보강본·69초/.5초/47페이지. 추가된 긴 대기의 정적 인상과 같은 유지 미소를 약점으로 평가 |
| Product12           | 74/100  | 유지 얼굴/입0·눈/고개 독립 복귀 수정본·같은69초/.5초/47페이지. 몸 반응과 대기가 여전히 약하다는 평가     |
| Product13           | 67/100  | 몸통 roll·자세 대비·짧은 손 복귀 보강본·통제된 normal/새 기본 기쁨·같은69초/.5초/47페이지                |
| Product14           | 73/100  | Product13과 같은 코드·실제 저장 expressive/기쁨 `＞＜` 구성·같은69초/.5초/47페이지                       |
| Product15           | 78/100  | `5f33da8`의 독립 expressive idle 손·Product14와 같은 저장 구성/69초/.5초/47페이지                        |
| Product16           | 76/100  | `6be797e`의 짧은 기쁨 눈 강조·idle 얼굴·화남 눈 확인·같은 저장 구성/69초/.5초/47페이지                   |
| Product17           | 80/100  | `3953383`의2300ms 기쁨 눈 강조·걱정→장난 자세 보완·같은 저장 구성/69초/.5초/47페이지                     |
| Product18           | 대기 중 | `bda756d`의 독립 idle 눈인사·같은 저장 구성/69초 타임라인, 영상 QA 완료·47페이지 평가 진행 중            |

종합 평가 원문은 `product-XX-score.md`, 실제 세션/모델 metadata는 같은 회차 `.jsonl`이다. Product08 세션은 `01a19d89-3e94-71c3-8147-cb8543ef5546`, Product09는 `01a19d90-d1ae-7b70-8faf-204abd2eb850`이다. 낮은 점수는 지우거나 소급 변경하지 않는다. 새 세션에는 목표/이전 점수·개발 노력/검사 수를 주지 않고 실제 렌더·공개 타임라인만 제공한다. 검토 중 변경이 생기면 기존 자료를 고정해 보존하고 수정본은 새 영상/패킷으로 검토한다. Product09는 걱정·토라짐·수줍음·직접 반응을 읽었지만 감정 피크 뒤의 기본 미소와 몸/팔 동행을 약점으로 봤다. Product10은 재접촉 결함을 독립 검토에서 발견해 **완료 평점 전에 중단**했다(exit130, 완료 metadata/점수 없음). 이전 패킷/로그와 취소 이유를 보존했고 낮은 평점을 버린 회차가 아니다. 수정한 Product11은 기존59초의 모든 입력을 보존하고 추가 입력 없이 마지막 대기를10초 더 관찰하는69초·.5초·47페이지 자료다. 완료 세션은 `01a19dc8-706b-7703-bf0e-9224f2ce35d7`이며69/100을 원문과 함께 보존한다. 쓰다듬기의 손·눈·홍조 조합은 가장 좋은 구간으로 봤고, 긴 대기·웃음 뒤 미소·토라짐의 몸 실루엣은 약점으로 봤다. 일부 손 없는 cue를 깃의 손으로 오독한 지적은 실제 selector/전신과 달라 새 자동 손의 근거로 채택하지 않았다. 더 긴 관찰 창은 별도 조건 변경이며 점수 차이를 코드 효과만으로 해석하지 않는다. Product12 완료 세션은 `01a19dd9-eaf5-7c73-bad2-e4390b2123ea`이며74/100을 보존한다. 감정 구분은 읽었지만 웃음/토라짐의 몸과 긴 대기의 존재감을 약점으로 봤다. 63초의 가슴 손 등 실제 selector0인 구간의 오독도 있어 지적을 그대로 구현 요구로 바꾸지 않는다.

1초→.5초와 큰 전신 타일은 짧은 wink/blink·몸 변화를 더 읽기 위한 **관찰 조건 변경**이다. 점수 차이를 코드 효과만으로 환산하지 않는다. 59초는 메시지가 4~5초마다 바뀌어 5.1/9.6초의 긴 유지 반응을 대부분 보여 주지 않는다. 자료 밖의 긴 동작·실시간 재생을 추정하지 않는다.

청록 고리는 production 효과가 아니라 exporter의 입력 위치 표식이었다. Grok이 이를 제품 효과로 평가한 한계를 기록하고 Round08부터 모델 crop에서 제거했다. 접촉 좌표/실제 이동량/alpha 적중은 JSON에 남겼다. 이 변경으로 이전 평가를 취소하지 않았다.

### 저장 표현 설정의 별도 확인

Product13의 완료 세션은 `01a19dfa-a995-7683-8a2d-285d438ceaa6`이며67/100을 보존한다. 해당 Source 13은578개 unit/contract·SDK62개/186PNG,69초·20fps·1380 paired frame과 양측1500회 범위 검사/62회 alpha 적중/외부 요청0을 통과했다. 당시 production 실행 근거 `.tmp/afterglow-native/round-13-result.json`(2026-11-03 05:36 KST)과 `story-13-results.json`·영상은 그대로 보존한다. 실제 몸통 구동·손 복귀가 검증된 것과 주관적 인상 평가를 구분한다. 평가자는 여전히 감정이 얼굴 위주이고 기쁨/걱정·긴 대기가 비슷하다고 봤다.

기존 통제 영상은 normal/bust·새 기본 기쁨(표정 파일 없음)이었지만, 실제 저장 표현은 expressive/bust·reducedMotion=false·기쁨 `＞＜`였다. Product14는 **코드 변경 없이 Product13과 동일한22개 앱 해시**에서 저장된 표현/손 매핑을 production `applyModelMappings`로 적용한 별도 구성이다. 명시적 빈 선택도 유지하고 기록 중의 로컬 쓰다듬기만 켠다. 영구 사용자 설정은 변경하지 않았다. 외부 연결·키·이력 없이 표현 whitelist만 사용한다. `story-14-comparison.mp4`와 `story-14-results.json`에 구성을 명시하고, 다른 설정의 점수 차이를 새 코드 개선량으로 환산하지 않는다. 같은69초 타임라인·20fps·.5초47페이지를 모두 읽은 완료 세션 `01a19e06-490d-70f1-91f0-8da182e70a87`의 점수는73/100이다(`.tmp/grok-grading/product-14-score.md`). 직접 접촉/수줍음·인사는 읽었지만 긴 무입력 대기, 반복되는 기쁨/웃음 그림과 몸의 동행은 약점으로 봤다. 이 구성을 교정한 재검토를 코드 개선이나 점수 재추첨으로 해석하지 않는다.

Product15는 `5f33da8`의 별도 코드 변경이며 같은 저장 프로필·69초 타임라인을 유지한다. `.tmp/grok-story-video15/source-15.json`에22개 소스/import 해시·타임라인·표현 프로필 해시를 고정하고 당시 `5f33da8` 앱 소스와 일치함을 확인했다. 새 timeline 입력 없이 after의 `localIdleGesture`가63.35초에 켜지고66.05초에 꺼진 것을 관찰했다. 이는50ms 렌더 관찰 시각이며2750ms 내부 수명과 구분한다. 영상 QA와47페이지 패킷을 완료했고 평가자는47페이지를 모두 읽었다. 완료 세션 `01a19e25-7d7a-7410-a797-871a321229b3`의 점수는78/100이다(`.tmp/grok-grading/product-15-score.md`). 실제 idle 손을64~65.5초의 한 번의 몸짓으로 읽었으며 직접 접촉의 정서적 호응을 긍정적으로 봤다. 반복되는 `＞＜`의 기쁨/웃음, 약한 걱정, 감정의 몸 실루엣과 손동작 전후 대기는 여전히 약점으로 평가했다. 관찰하지 않은 장기 반복은 추정하지 않았고85점 종료 조건에는 미달이다.

Product15 당시590개 unit/contract·SDK67개/236PNG, 영상15·native15 시작/종료·기본 런처 PID107169/설정 보존 근거는 그대로 보존한다. Source 16은 같은 저장 프로필과 타임라인을 사용하고 `.tmp/grok-story-video16/source-16.json`의22개 고정 앱 해시는 `6be797e`와 일치한다. 영상 QA 및47페이지 패킷을 완료했고 평가자는47페이지를 모두 읽었다. 완료 세션 `01a19e30-d910-7630-a7c7-6467fd8be365`의 점수는76/100이다(`.tmp/grok-grading/product-16-score.md`). 짧은 기쁨 눈 강조와 걱정의 가독성·감정 사이 대기를 약점으로 봤다.0초의 가슴 앞 기본 손과 idle 미소 미복귀 주장은 실제 내린 팔·유한한 얼굴 복귀와 달라 그대로 구현 요구로 채택하지 않았다. 점수와 원문은 보존하고 활성 semantic none의 손 없음 계약도 유지한다. 당시595개 unit/contract·SDK70개/245PNG·영상16·native16/PID111416 설정 보존 근거도 남긴다.

Source 16의 별도 실제 대조에서 idle 얼굴 입력은65초 mouthForm .55/eyeSmile .45→66초 .00386/.00316→66.05초 실질0/owner false로 끝났다. 손·고개·시선은 같고 local idle 얼굴만 제외한 대조와68.95초480×720 캡처 모델 crop의 RGB 픽셀 차이는0이었다.66.05~68초에는 작은 SDK physics 출력 감쇠 차이가 남으므로 모든 물리 상태의 즉시 일치를 주장하거나 출력을 강제 reset하지 않는다. `.tmp/idle-face-return16/{REVIEW.md,proof.json,settling-parameters.json}`은 양측1380프레임/1500회 범위 검사 오류·외부 요청0과 Source 16 원본22개 해시 보존을 기록한다. Source 17 전체 검증과 구분하며 이 진단으로76점 자체를 소급 변경하지 않는다.

Source 17의 `.tmp/grok-story-video17/source-17.json`은 `3953383`의22개 파일을 고정하고 같은 profile14·69초 타임라인을 사용한다. 영상 생성/최종 QA와47페이지 패킷을 완료했다.47페이지를 모두 읽은 세션 `01a19e40-3133-7022-b6e4-0429399ef991`은 `grok-4.7-build`의 end_turn/exit0으로 종료했고 Product17은80/100이다(`.tmp/grok-grading/product-17-score.md`). 기쁨 눈 뒤 열린 기쁨과 걱정→지연 wink는 읽었지만 긴 대기·설명 얼굴·감정의 몸 실루엣을 약점으로 봤다. 실제5~6.5초의 기쁨 `＞＜`→7~8초 열린 눈,9~10초의 조심스러운 눈/숙임→10.5초 wink→11초 작은 미소를 영상/Source 16 대조에서 확인했다. 나머지 입력·저장 프로필·idle63.35~66.05초 동작 시각은 같다.

Source 17의596개 unit/contract·SDK71개/246PNG와 `round-17-expression-results.json`, native17의06:48:44 KST 실행·기본 런처 PID114906/설정 보존 근거도 보존한다. 당시 영상은 `artifacts/grok-review/story-17-comparison.mp4`/`story-17-results.json`, native 근거는 `.tmp/afterglow-native/round-17-{result,idle-native-proof,release-frame-proof}.json`이다. 같은69초·20fps·1380 paired frame에서 양측1500회 범위 오류0·alpha62/62·접촉670.483 CSS px·외부 요청0을 확인했다.

Product17의 “인사에서 좌우 손이 교대한다”는 지적은 실제 MOC 대조에서 확인되지 않아 팔 연결 변경의 근거로 채택하지 않았다. `.tmp/wave-side17/{REVIEW.md,proof.json,hand-trace.json,two-wave-strips.jpg}`의 두 인사창150개50ms 샘플에서 들린 손 Part52의 가시 bbox 중심은 모두480px canvas의 중앙240보다 왼쪽이었다. 반대 Part130은 X375~467/Y575~712px의 오른쪽 아래에 남고 Movement2만0→1→0, Movement1/3은0이었다. `Param56/57`은 CDI의 `光2`/`光4`인 공유 조명 입력이며 좌우 팔 전환 selector가 아니다. 별도로 bust 구도의 최대 sweep에서 손가락 X 약−55.6px의 왼쪽 잘림은 실제로 존재한다. 팔 교대와 이 잘림을 혼동하거나 모든 손이 화면 안에 있다고 주장하지 않는다. Source 17 원본22개 해시를 보존한1116연속 프레임/1236회 범위 검사 오류·외부 요청0의 진단이며 Source 18의 모든 기하 검증으로 확대하지 않는다.80점과 원문은 유지한다.

### 독립된 대기 눈인사 (Source 18)

`Avatar`의 `idleFaceSlot`이 활성 cue 없는 expressive idle의 유한한 얼굴만 소유한다. 기존 `gazeSlotId % 8 === 2` edge와 읽기 전용 `gazeSlotStartedAt`을 사용한다. 슬롯 시작 뒤250ms 준비→180ms attack→450ms hold→450ms release,1330ms에 끝난다. 실제 기여 구간은1080ms이며 smile .5로 보간하고 한 눈은 닫고 반대 눈은 기존 열림의 .92까지 줄인다. 기존 blink에 곱하므로 감긴 눈을 다시 열지 않으며 슬롯 번호에 따라 눈 방향을 교대한다. 새 시계·랜덤·메시지·manager·손·Jev 호출은 없다. 고개/몸/시선/lean·입 열림/호흡/root·자산 시계는 그대로다.

기존 손과 `idleEligible`/edge 소비를 공유한다. normal/quiet/reduced·작업/승인·활성 cue/pose/gesture·pet 손·held contact·잔여 petting은 차단한다. 부적격 edge를 소비하고 매 draw 소유권을 재검사해 접촉/반응이 끝난 같은 슬롯에서 뒤늦게 재개하지 않는다. actor만 바꾼 ignored 후보는 pet 해제46.35~46.5초 잔여에 겹쳤으므로 그대로 채택하지 않았고 Avatar에서 접촉 소유권을 검사하도록 통합했다. 첫 IDLE이 눈꺼풀/MouthForm/EyeSmile/특수 눈 입력을 구동하면 새 얼굴을 생략한다. canonical wave·빈/custom/부족한 손 자산 검사는 기존 손에만 적용하며 자산 없는 새 얼굴과 혼동하지 않는다. 사용자 눈/표시 매핑과 physics 보호는 유지한다.

접촉 begin·수락된 cue/승격·요청/상태·접근성 전환·reset/preview/dispose/context loss/렌더 오류에서 즉시 정리한다. 무시된 stale cue·끝난 메시지의 scoped clear는 독립 소유권을 지우지 않는다. `localIdleAttention`은 실제 얼굴 기여만 나타내고 `motionActive`에도 반영하지만 actor는 inactive/gesture none으로 남는다. 기존 네 번째 슬롯의2750ms idle 손과 활성 의미 cue의 자동 손 없음 계약은 바꾸지 않았다.

## 현재 검증·영상·적용과 복원

- **605개 unit/contract**, typecheck·format·build·외부 AI 없는 Mock desktop을 통과했다. 192조합, 30/60/120fps, 저장 매핑/빈 선택, 여운·손 복귀·clear/승인, 12초 접촉·짧은 fade·종료 직전 눈 복귀와 idle edge/소유권·held contact·접근성/매핑·프레임 건너뜀, custom 눈/표시/나머지 자산 분리와 유한한 idle/화남 눈 반응·기쁨 눈 기한·걱정 조합의 제한된 보정과 독립 눈인사의30/60/120fps·blink/다른 frame 필드 보존·접촉/잔여/점유 차단·edge 소비·IDLE 얼굴 소유권·즉시 정리를 포함한다.
- 실제 SDK/SwiftShader **76개 수락 검사·278개 현재 PNG**(after275/before3)에서 체크포인트마다 509개 parameter 범위 오류/외부 요청 0을 확인했다. `artifacts/grok-review/round-18-expression-results.json`의 assertions와 `artifacts/expression-afterglow/`가 현재 근거다. Source 13의62개/186PNG 결과도 별도 `round-13-expression-results.json`에 보존한다. 50ms 시뮬레이션·지정 rasterize이며 실시간 FPS/CPU 측정이 아니다.
- `artifacts/grok-review/story-18-comparison.mp4`/`story-18-results.json`의 최종 QA를 완료했다. **69초·1120×900·20fps·1380 paired frame**이며 `.tmp/grok-story-video18/source-18.json`의22개 소스/import 해시가 `bda756d` 현재 앱과 일치하고 저장 profile14/타임라인도 같다. 각 측1500회·전체509개 parameter 범위 오류0, alpha62/62·접촉 이동량670.483 CSS px·외부 요청0이다. 추가 timeline 입력 없이 `localIdleAttention`은57.85→58.95초, 기존 손은63.35→66.05초로 관찰됐고 이전 접촉 구간의 눈인사는 없었다. 이는50ms 관찰 시각이며 내부 수명과 구분한다. QA montage·Source 17/18 얼굴 대조와 native 눈인사 PNG를 직접 확인했다. 균일 .5초+마지막의139샘플/47페이지 패킷을 완료했고 Product18 평가는 진행 중이다. 기존 Source 13~17 영상과 점수는 보존한다. 자료는 합성 cue·로컬 미리보기·무음이며 실제 provider/IPC 대화 촬영이나 실시간 FPS 검사가 아니다.
- 실제 Sway/Xwayland 새 앱 프로세스의 production renderer에서 설정 UI20종·켜기 저장/reload·Shift stroke/창 위치 불변·해제·활성 petting→승인 정리·여운/낡은 clear/정확한 clear·renderer reload·원래 설정 해시 보존을 확인했다. 독립 idle 손과 새 눈인사 모두 시작→종료를 확인했다. 근거는 ignored `.tmp/afterglow-native/round-18-result.json`(2026-11-03 07:09:58 KST), `round-18-idle-native-proof.json`, `round-18-attention-native-proof.json`, `round-18-release-frame-proof.json`이다. 눈인사는 performance32598.8ms/frame88의 active에서35624.9ms/frame91의 종료를 관찰했으며 이는 캐시/조회 간격을 포함한 약3초 관찰 간격이다. 내부1080ms 기여 수명이나 실시간 FPS로 해석하지 않는다. 관찰용 검사기만 자기 overlay의 `moveTop`을 호출했고 저장 설정은 바꾸지 않았다. 이후 기본 런처로 정상 재실행해 PID120211 생존과 원래 저장 설정의 canonical digest 일치를 확인했다. provider/Jev 호출0이며 물리 마우스·OS 재부팅/재로그인은 수행하지 않았다.

Source 17/18 별도 영상 실행의 “눈인사 외 모든 JPEG 픽셀이 동일하다”는 추가 QA 가정은 실패했다.0초와 눈인사 전에도8bit RGB 평균 차이 약 .00095~.0043·최대1~9가 있었고46.5초에는345600픽셀 중1픽셀만 차이8을 넘었다. 별도 실행의 raster/encoding 미세 차이로 보일 수 있지만 원인을 확정하지 않았다.9/10.5/43/46.4초는 시각적으로 같은 동작,58초 새 눈인사는 평균 .63/최대246의 분명한 변화로 확인했다. 이는 전체 타 구간의 비트 단위 이미지 동일 증거가 아니며, unit의 frame 필드 보존·SDK의 소유권 차단과 구분한다. 이 가정 실패로 소스나 평가 영상을 바꾸지 않았다.

후속으로 **동일한 Source 18**의 두 Avatar에서 새 `idleAttentionFrame` 적용만 켠/끈 대조를 수행했다.0/9/10.5/38.5/43/46.2/46.35/46.4/46.45/46.5/57초에는509개 parameter·전체 drawable 정점/opacity·MVP·actor/owner/표정 층과 무손실 PNG/JPEG 모델 crop 차이가0이었다.58/58.5초에는 의도한 `ParamEyeLOpen/R`·`ParamMouthForm` 세 입력과 SDK physics 출력만 달라졌고59/60초에는 물리 감쇠만 남았다.68.95초 PNG/JPEG는 다시 같지만 미세 물리 상태까지 일치한다고 주장하지 않는다. `.tmp/idle-guard-control18/{REVIEW.md,proof.json,matched-face-pairs.jpg}`의 양측1380프레임/1500회 범위 검사 오류·외부 요청0과 원본22개 해시 보존이 근거다. 메인이 결과 수치와 이미지를 확인했으며, actor-only 초기 후보의 접촉 해제 비대칭은 현재 Avatar guard에서 재현되지 않았다. 이 동일 소스 대조는 별도 실행 Source 17/18의 작은 raster 차이 원인을 확정하는 검사가 아니다.

Source 17의 초기 SDK 실행은 기존 `ParamAngleY<-12`와 재접촉 변화+5°의 깊은 숙임 수락 조건에서 실패했다(exit1). 당시 실제1000ms−7.34466°→3000ms−3.58427°는 의도한 얕은 숙임/재접촉이었으며, production 값은 바꾸지 않고 기준을−12°<초기<−4°·재접촉+2°로 갱신했다. 닫힌 입/손 없음과 새 걱정→장난 얼굴 검사도 유지했다. 실패 JSON `.tmp/grok-vtuber-review/round-17-sdk-old-deep-bow-assertion.json`·`round-17-sdk.log`와 최종71개 통과의 `round-17-sdk-verified.log`를 모두 보존한다. 실패/재검사에서 실제 값도 같아 수락 의도 변경과 production 수정을 혼동하지 않는다.

적용은 현재 checkout에서 `npm run build` 후 앱 종료·기본 `~/.local/bin/live2d-companion` 재실행이다. 별도 시험용 런처나 서비스는 만들지 않았다. Source 18의 독립 눈인사만 복원하려면 `bda756d`를 revert한 뒤 build·같은 런처로 재실행한다. Source 17의 기쁨/걱정 조정까지 복원하려면 이어서 `3953383`을 revert한다. Source 16의 눈/얼굴 연결까지 복원하려면 이어서 `6be797e`를 revert한다. Source 15의 독립 idle까지 복원하려면 이어서 `5f33da8`을 revert한다. 이전 몸통/손 복귀 보강까지 복원할 때는 이어서 `4771977`→`22a2f2d`를 순서대로 revert한다. 전체 Grok 개선을 복원할 때는 코드 커밋 `bda756d`→`3953383`→`6be797e`→`5f33da8`→`4771977`→`22a2f2d`→`15c37eb`→`b2f1401`→`7e7e0b2`→`3a0fef4`→`9754202`→`28a9420`→`bdce55e`→`116e1b9`를 이 순서로 revert하며(최신→과거) 복원 버전의 문서도 맞춘다. 개인 연결/매핑·위치/배율의 설정 이관은 없다. 초기 감정 추가 이전으로 더 되돌리는 절차는 [구현 상태](../development/IMPLEMENTATION_STATUS.md)를 따른다. SDK·모델·영상/프레임·개인 설정·Grok 원문 세션은 공개 Git에 넣지 않는다.

## 근거 자료와 한계

- [같은 모델 공식 쇼케이스](https://x.com/kamiya_ryoko/status/2116052617080311882/video/1?s=46): Grok의 직접 프레임 대조. 연속 재생·음악/발화 동기·트래킹·실시간 성능은 미검증.
- [Cubism 표정](https://docs.live2d.com/en/cubism-editor-manual/facial-expression-system/), [표준 파라미터](https://docs.live2d.com/en/cubism-editor-manual/standard-parameter-list/), [갱신 순서](https://docs.live2d.com/en/cubism-sdk-manual/parameters/): 메인도 2026-11-03 화난 입의 음수 방향·눈꺼풀 Multiply·physics 적용 순서를 재확인했다. 예시 값을 다른 rig에 일반화하지 않는다.
- 일반 조사에서 조회한 Hooli/Cobalt·cillia/Laimu·Aquarelle Usagi·Iron Vertex·2wintails/Shylily·Brian Tsui/Vienna는 페이지/설명·크레딧과 이전 프레임 조사를 구분한다. 이번 Grok이 각 외부 영상 전체를 새로 시청했다고 주장하지 않는다.
- 평가는 단일 평가자·특정 모델/bust의 통제 normal 또는 저장 expressive 구성에 대한 프레임 기반 의견이다. 다른 사용자·모델·구도·실제 대화의 선호도나 Windows·실시간 성능을 보장하지 않는다.
