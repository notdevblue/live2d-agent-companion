# Live2D, TTS, Character Director

**상태:** Proposed · **전제:** 사용자가 합법적으로 보유한 리깅된 Live2D 모델을 사용.

## 렌더링

- **제안:** Cubism SDK for Web + Electron renderer/WebGL. SDK Core·샘플·MotionSync 바이너리의 라이선스 확인.
- 로더는 `.model3.json` 파일로 모델·텍스처·물리·모션·표정 참조를 해석한다.
- 모델 로딩 시 사용 가능한 parameter ID, motion 그룹, expression을 inventory로 수집.
- 알 수 없는 표현은 idle/neutral로 fallback, 모델 변조나 기본 파라미터 명칭 강제 금지.
- 현재 저장 가능한 매핑은 emotion/gesture → 모델 자산 또는 허용된 로컬 연기다. idle은 모델의 Idle 그룹, thinking/working/error는 결정적 상태로 구동한다. listening/talking/TTS 상태 매핑은 후속 설계다.

## Character Director

대화 본문(사용자에게 보여주는 안전한 텍스트), 원격 tool lifecycle, TTS 재생 상태, 클릭/드래그 이벤트를 입력으로 받는 별도 상태 머신이다. 기본 상태는 결정적 규칙으로 제어하고 의미에 따른 표정/제스처는 사용자가 켠 Jev 판단을 사용한다. TTS 재생 상태 입력은 후속 범위다.

**2026-10-31 구현 범위:** 사용자 요청으로 초기 통합에 Jev를 포함했다. 결정적 기본 상태와 별개로 TypeSafe Choice 질문 3개(emotion/gesture/attitude)를 한 번에 보내며 최대 800자 구간·판단 제한 시간·확신 임계값·최신 구간 검사로 제어한다. attitude는 `neutral/explain/tease/laugh/shy/reassure`이며 문장의 주제 대신 말하는 태도를 판단한다. 기존 attitude 없는 응답도 지원한다. 각 채널은 독립적으로 확신 임계값을 검사한다. 세부 말투가 웃음/장난으로만 갈린 경우는 아래의 보수적인 묶음 규칙을 적용하고, 그 밖의 저확신 채널은 neutral/none으로 바꾼다. 통합 confidence는 유지된 채널만의 최솟값이며, 버린 저확신 감정 때문에 확실한 손 인사까지 Director에서 폐기하지 않는다. 전 채널이 낮으면 기존 낮은 confidence/fallback을 유지한다. confidence는 불확실성이지 움직임의 강도가 아니다. 텍스트 UI는 판단을 기다리지 않는다. 실패/낮은 확신은 neutral/none이며 중단·전환·복구 snapshot은 지연 판단/재판단을 차단한다. 이는 아래 TTS 구현을 뜻하지 않는다.

**2026-11-01 요청 문맥:** Jev의 각 판단은 현재 사용자 요청(`user_request`, 최대 1600자)과 해당 assistant 답변(`assistant_message`, 최대 800자)을 같은 요청에 별도 필드로 보낸다. 요청과 완료 답변이 길면 각각의 한도 안에서 앞뒤를 남긴다. 사용자 요청은 답변의 상황을 이해하는 데이터이며 사용자 감정/모션 지시를 캐릭터에 그대로 적용하지 않는다. 같은 요청의 진행/최종 메시지는 동일 문맥을 쓰고 다음 request에는 바뀐다. 이전 대화/도구 로그/기억은 보내지 않으며 원문 없는 복구에서 다른 요청을 추정하지 않는다. 이 확장은 사용자 명시 지시이며 추가 호출·직렬 LLM·원문 영구 저장은 없다.

**2026-11-01 설명 과다 보정:** gesture의 `none`은 일반 대화·진행/결과 보고·사실 답변과 대부분의 설명에서 기본이다. `explain`은 예제/대조/단계를 직접 짚어 가르치는 명확한 강조에만 사용하도록 Choice 기준을 좁혔다. 설명 말투(`attitude=explain`)는 손동작이 아니므로 `gesture=none`을 설명 손 포즈로 승격하지 않는다. 인위적 랜덤 동작이나 추가 판단 호출은 넣지 않았다.

DeepSeek-chan은 `.model3.json`에 표정/모션 참조가 없어 `Exp3/`, `Animation/`을 안전하게 수집해 로컬 manifest에 보충한다. 사용자 모델 원본은 수정하지 않는다. Jev 기본 매핑에는 옷/체형/소품 토글을 넣지 않으며 사용자 설정으로 실제 존재하는 표정/모션을 매핑한다. idle만 loop로 설정하고 제스처는 one-shot이며 매 프레임 기준 파라미터를 복원해 영구 토글을 피한다.

기본 매핑의 누락을 막기 위해 `thinking → @companion/thinking`, `surprised → @companion/surprised`를 제공한다. 이는 모델 파일 이름이 아닌 앱 로컬 연기 ID다. 생각은 기존 시선·고개 연기를 재사용하며, 놀람은 지원되는 눈·눈썹·입 파라미터의 실제 중립값/범위 안에서 합성하고 physics 출력·없는 채널은 생략한다. 저장된 사용자 자산 매핑과 명시적인 빈 값은 보존한다. 생각 미리보기·응답 대기 진입·답변의 gesture 판단은 같은 thinking 매핑을 참조한다.

로컬 `ActingController`는 비주기 blink/시선과 눈→고개→몸 지연, thinking/working 및 짧은 감정·태도 반응을 생성한다. `Avatar`는 runtime 범위/중립값과 physics 출력 목록을 검사해 `Angle*`, `Position*`, `LeanInput` 같은 upstream을 구동한다. physics 출력에 해당하는 표준 채널밖에 없으면 그 채널을 생략한다. 표정은 기존/새 레이어를 240ms로 crossfade하고 만료/초기화 시 정리한다. DeepSeek의 알려진 손동작 쌍은 의미 반응에서 진입→여운 동안 유지→복귀이며 (로컬 미리보기의 유지는 기존 1.5초), 유지 시 selector만이 아니라 자산의 모든 손/손목 endpoint를 보존한다. SDK clip은 실제 pose phase 경과 시간으로 진행하고 physics step 제한과 분리한다. 자산 쌍이 없는 사용자 매핑은 기존 단발 motion으로 fallback한다.

추가 버튜버 연기는 기존 Choice를 재사용한다. 감정/태도 얼굴과 thinking/explain 시선·고개를 분리 합성하고, 반응별 준비·강조·여운·복귀 시간을 둔다. 윙크/반눈/눈웃음/눈썹/삐죽/볼은 좌우 눈과 실제 upstream 얼굴 범위로 제어한다. pipeline은 baseline→idle/one-shot→로컬 연기/얼굴→expression→physics→draw이며 자산이 구동하는 얼굴 채널과 physics 출력은 procedural 입력에서 제외한다. 놀람 눈은 Overwrite 대신 Multiply로 자동 blink를 보존하고 표정 hold도 actor의 2.2초와 맞춘다. 특수 눈 artwork가 켜지면 procedural wink/eyeSmile을 중첩하지 않는다. 기본 상하 offset은 유지한다.

로컬 미리보기 14종(초기화 포함)은 같은 enum/IPC 권한 검사와 승인/요청 차단을 사용한다. 새 강아지풀 포즈는 `狗尾草切换出来`↔`狗尾草切回默认手`/`Movement1` 쌍이며 기존 endpoint 보존·복귀 경로를 사용한다. 하트 눈/삐짐/강아지풀은 명시적 호출 위주이며 없던 손가락 리깅·발화 립싱크를 추가했다고 표시하지 않는다. 조사 근거/비교/후속 범위는 [상호작용 설계](../ux/INTERACTION_DESIGN.md#추가-조사-얼굴시선고개손을-겹치는-버튜버-연기)에 정리한다.

idle 호흡은 4.8초 주기(들숨 42%, 날숨 58%)의 부드러운 곡선으로 `ParamBreath`와 bodyY 입력을 함께 구동한다. 사용자 후속 피드백으로 bodyY 호흡 폭은 첫 구현의 2배로 키웠고, 전체 모델에도 canvas 내부의 작은 수직 offset을 추가했다. 호흡 위상은 cue/초기화와 독립적이며 기존 강도/움직임 줄이기를 적용한다. 승인 차단에는 기본 호흡/offset을 정지하고 사용자 gesture의 authored `ParamBreath` curve도 존중한다. OS 창 위치·배율은 호흡으로 바꾸지 않는다.

설정의 구도는 canvas matrix만 바꾸며 창 배치·모니터·대화 세션을 바꾸지 않는다. 연출 강도와 움직임 줄이기는 로컬 연기만 조절한다. 승인/취소/복구 상태는 transient와 손 포즈를 차단하고, 마지막 Director 상태를 보관해 승인 종료 뒤 복귀한다. 로컬 미리보기는 main의 enum/sender/진행 상태 검사 뒤 실행하며 실제 메시지나 외부 판단을 생성하지 않는다.

Framework 5-r.5는 Core 5.3(`core/06`)과 함께 고정했다. 예전 Core legacy URL은 API 시그니처가 달라 모델 로드에 실패했으므로 사용하지 않는다. 모션에는 EyeBlink/LipSync effect ID 목록을 명시적으로 초기화한다. 공식 SDK의 타입은 renderer의 좁은 runtime 어댑터로 감싸며 ignored SDK 원본 자체의 타입 검사는 앱 typecheck 범위 밖이다.

DeepSeek-chan의 49개 clipping mask 그룹은 기본 버퍼 1개의 36그룹 용량을 넘는다. SDK의 그룹 중복 제거 결과로 버퍼 수를 계산하고, 다중 버퍼의 32그룹/버퍼 용량에 따라 이 모델에는 버퍼 2개를 사용한다. 마스크 텍스처는 512픽셀이며 GPU 초기화 전에 설정한다. 용량을 초과한 채 그리면 SDK가 마스크 영역을 재사용해 얼굴·머리카락·꼬리가 서로 잘못 합성된다. 원본 모델 파라미터나 색을 바꾸는 방식으로 가리지 않는다.

큰 텍스처의 축소 점무늬를 줄이기 위해 POT 텍스처에는 trilinear mipmap을 사용하고 WebGL 1의 NPOT 텍스처는 기존 linear 필터를 유지한다. premultiplied alpha 업로드는 유지한다. 첫 제스처는 앱 시작 시각과 무관하게 허용하고 이후 제스처 사이에만 cooldown을 적용한다.

예: `request accepted → thinking`; `tool.started → working`; `audio.playing → talking`; `turn.completed + audio ended → idle`; `turn.failed → brief error → idle`.

**애니메이션 우선순위:** security/approval UX > explicit user interaction > speaking > task state > idle. 전환 시 crossfade, 전환 가능 여부는 모델/SDK 지원 확인.

## 감정 여운과 독립 표정 층 (2026-11-02)

`ActingController.reactionDuration`은 기존 강조 길이이고 `reactionLifetime`은 의미 반응에만 최대 12초를 더한 전체 기한이다. 미소·눈웃음·눈썹은 강조의 복귀 구간에서 낮은 여운으로 이어지고 작은 `ParamMouthOpenY`(.12 × 강도)를 사용한다. 모음·턱은 구동하지 않는다. 마지막 1초 fade 뒤 정확한 기한에 얼굴을 정리한다. 대기 호흡·시선·blink와 기존 상하 offset은 유지하며 몸의 강조를 반복 재생하지 않는다. preview/delivery는 기존 짧은 길이를 유지하고 중립 semantic 승격은 끄덕임을 다시 시작하지 않는다.

`ExpressionMixer.transitionMany`에 특수 눈(`key3~6`)과 표시(`key2/7/13`)를 분리해 전달한다. 눈 아트는 강조 동안 한 종류만 소유하고 홍조·땀·눈물은 독립적으로 여운을 유지한다. 감정 자산을 주표정으로 보존한 채 shy의 홍조나 tease의 눈을 보조로 올리므로 부끄러움+웃음, 걱정+장난이 함께 보인다. 보조 자산에서 옷·소품·미확인 키는 제외하고 직접 매핑한 사용자 자산은 전체를 보존한다. 각 층은 240ms crossfade하며 구성 파라미터가 바뀌는 같은 이름의 표정도 연속으로 전환한다. 강도/움직임 줄이기 변경은 현재 여운에도 적용한다.

paired 손은 진입/복귀 클립 시간을 전체 의미 반응 기한에서 빼 유지 시간을 정한다. 수명 안에 복귀를 마치며 다음 메시지 첫 글자의 scoped `cue.clear`, 정정·승인·취소·오류·새 요청에서 이전 표정/여운/손을 정리한다. 같은 손의 반복 억제는 유지한다. `LeanInput` 계수는 .35에서 .7로 바꾸되 호흡·고개 추적 속도·상하 offset은 바꾸지 않는다. 실제 비교 근거와 적용·복원은 [구현 상태](../development/IMPLEMENTATION_STATUS.md)를 따른다.

유지 얼굴은 순수 기쁨의 밝은 열린 눈과 웃음 뒤 닫힌 입의 미소로 분리한다. 유지 입 목표0을 공통 최소값이 덮지 않으며 neutral acknowledge의 작은 입 목표는 별도로 보존한다. 대기에서는 같은 불규칙 gaze 슬롯의 눈 먼저 이동→반대 방향 복귀와 측면 고개/지연 상체 목표를 분리한다. 새 시계·발화 운동·breath/rootY 증폭은 없다. 실제 MOC 캘리브레이션과 적용 근거는 위 검토 문서를 따른다.

현재 모델의 `PositionZ`는 physics를 통해 흉곽·허리를 기울인다. bodyZ는 고개를 같은 시계에서 지연 추적하며 actor 강도별±.3으로 제한하고, 접근성 설정 변경 시 현재 값도 즉시 줄인다. physics 출력이나 IDLE이 소유한 roll은 덮지 않는다. 직접 접촉도 같은 가중치로 몸통을 보간한다. 실제 모델·authored IDLE 대조 근거와 모델별 한계는 검토 문서를 따른다.

짧은 preview paired 손은 기본1500ms hold라 긴 semantic 반응과 복귀 시각이 다르다. `PoseFrame.heldMs`로 실제 hold 종료 시각을 전달하고 handAttention의 이완/point 전체를 그 시각부터 원본 exit 첫300ms에 합류시킨다. metadata 없는 기존 호출은 종전 완전 이완 baseline을 사용한다. 직접 petting의 별도 reverse 경로는 이 overlay를 우회한다. 원본 explain pair의 작은 endpoint 차이는 남아 있음을 검토/수락 근거에 기록했다.

### 직접 쓰다듬기의 선택적 손 반응 (2026-11-03)

기본 꺼짐의 직접 입력에서는 기존 `PoseSequence`와 원본 가슴 손 pair를 함께 사용한다. Source 15의 독립 idle 손도 같은 자산 검증을 공유하며 아래와 같이 별도 소유권으로 처리한다. 8px의 위치/알파 적중, idle·빈 손 소유권, 기본 wave 매핑, 정확한 7개 비물리 입력/endpoint와 진입1133ms·복귀1017ms를 모두 확인한다. 사용자 다른/빈 매핑·reducedMotion·늦은 접촉이면 몸/얼굴만 반응한다. 새 MotionManager나 의미 감정→자동 팔 연결은 없다.

부분 진입의 해제는 마지막 렌더 시각부터 원본 entry를 거꾸로 샘플하며 hold 이후는 원본 exit를 사용한다. 정지/해제/12초 예산 안에 끝내고 원본 selector 전환을 보존한다. 복귀 중 새 접촉은 기존 손·기한과 몸 fade를 유지하고, 새 유효 stroke에만 별도 몸 예산을 준다. 무 stroke begin/end는 이전 fade를 연장하지 않는다. 메시지 scoped clear와 직접 입력의 소유권을 분리하며 새 cue/요청·승인·오류·disable은 즉시 전체 정리한다. 실제 SDK 수락/기본 앱 재실행 근거는 [구현 상태](../development/IMPLEMENTATION_STATUS.md)를 따른다.

### 활성 cue와 분리된 로컬 대기 손 (Source 15, 2026-11-03)

`5f33da8`은 기존 expressive 설정에서만 활성 cue 없는 idle에 유한한 가슴 손동작을 제공한다(`FR-L2D-010`). `gazeSlotId`의 네 번째 edge를 사용하고 비활성 조건에서도 edge를 소비한다. 놓친 edge를 큐에 넣거나 설정 변경/반응 만료 뒤 재생하지 않는다. 같은 `PoseSequence`의 원본 entry1133ms·hold600ms·exit1017ms, 총2750ms이며 별도 랜덤 타이머·MotionManager·Jev 호출·의미 손 cooldown 변경은 없다.

idle/actor inactive·빈 pose/gesture/state gesture·manager 종료와 expressive/reducedMotion=false를 모두 요구한다. petting의 held contact는8px 전에도 차단하고 잔여 petting·pet 손이 있어도 시작하지 않는다. shared `chestPoseDefinition`이 canonical wave 매핑·7개 비물리 입력/범위/endpoint를 검사해 custom/명시적 빈 선택/없는 자산을 보존한다. 첫 IDLE이 전용 `Movement2`/`Param59~62`를 구동하면 자동 idle 손을 생략하고 공유 조명 입력 `Param56/57`(CDI `光2`/`光4`)만으로는 막지 않는다. 직접 petting과 명시적 semantic 손의 기존 우선권은 바꾸지 않는다.

`localIdleGesture`는 의미 gesture와 별도인 owner/진단 상태다. **활성 의미 cue의 `gesture=none`은 계속 새 authored 손 없음**이며 이 대기 동작은 actor를 active로 만들지 않는다. 손 쪽 고개/시선은 진입·복귀에 맞춰 한 번 보간하고 직접 접촉보다 먼저 적용한다. Source 15에서는 얼굴·입·호흡/rootY를 그대로 두었다. Source 16의 유한한 얼굴 연결은 아래와 같으며 입 열림·호흡/rootY 보존은 유지한다. idle 중 pet begin/end는 손을 재시작·이관·연장·정리하지 않고 기존 기한까지 둔다. 그 접촉은 몸/얼굴만 반응하고 자연 종료 후 새 접촉부터 기존 pet 손을 사용할 수 있다.

수락된 새 cue/승격·요청·thinking/working·승인·오류·reset/preview/dispose와 normal/quiet/reduced 전환은 idle owner를 정리한다. stale cue와 끝난 메시지의 scoped clear는 독립 owner를 지우지 않는다. Source 15 당시590개 unit/contract·SDK67개 수락/236PNG·실제 production 시작→자연 종료·기본 앱 재실행/설정 보존과 영상15를 확인했다. 완료 점수는 Product14=73, Product15=78로85점 종료 조건에 미달이며 [검토·적용/복원](../ux/GROK_VTUBER_REVIEW.md)과 [구현 상태](../development/IMPLEMENTATION_STATUS.md)가 최신 근거다. 물리 마우스·OS 재부팅/재로그인·TTS 검증은 아니다.

### 저장 눈 강조와 유한한 얼굴 연결 (Source 16, 2026-11-03)

`6be797e`는 happy 눈 층에1500ms 수명/400ms fade를 적용해 선택한 특수 눈 강조 뒤 기존 절차 기쁨 얼굴로 이어지게 한다. confused1400ms·laugh1200ms·tease1100ms 우선순위는 유지한다. 자산 이름이나 저장 매핑/빈 선택을 바꾸지 않고 `setExpression`의 기존 눈/표시/나머지 층 분리를 재사용한다. 사용자 custom 눈과 함께 들어 있는 표시·다른 자산 파라미터까지 짧게 끝내지 않는다.

local idle 얼굴은 기존 pose의 진입·복귀 가중치로 smile .55·eyeSmile .45·눈 열림 .75×blink를 보간한다. hold200~600ms에 눈을 정면으로 돌리고 exit에서 원래 idle로 복귀한다. 같은2750ms 기한·expressive/접근성 gate·직접 접촉 우선권을 유지하며 새 입 열림·호흡/root 운동·손·시계는 없다. 순수 angry preset/gesture none은 기존1.95~3.1초의 한 번의 gaze/눈꺼풀 확인만 pose 적분 뒤 적용한다. 고개/몸의 외면·찡그린 입·입 열림·호흡을 바꾸지 않고 blink·강도/접근성·compound override·clear/종료를 지킨다.

Source 16 당시595개 unit/contract·SDK70개 수락/245PNG·native16의 production idle 시작/종료와 기존20종 UI·petting/승인·scoped clear·reload/설정 보존을 통과했다. 기본 런처 PID111416으로 정상 복원하고 원래 저장 설정 digest 일치를 확인했다. Source 16 영상도69초·20fps·1380 paired frame 및 소스22개 해시/같은 저장 프로필 검증을 완료했다. Product16은47페이지를 모두 읽은76/100 평가로 종료했으며 당시 근거와 적용/복원은 [Grok 검토](../ux/GROK_VTUBER_REVIEW.md)·[구현 상태](../development/IMPLEMENTATION_STATUS.md)를 따른다. TTS·물리 마우스·OS 재부팅/재로그인은 이번 검증에 포함하지 않는다.

### 기쁨의 정점과 걱정→장난 자세 보정 (Source 17, 2026-11-03)

`3953383`은 happy 눈 강조를2300ms/fade400ms로 정해 약2.1초의 특수 눈 정점 뒤 기존 열린 기쁨으로 이어지게 한다. Source 16의1500ms 설정을 대체하며 confused1400/laugh1200/tease1100ms 우선순위·자산 선택/빈 값·custom 나머지/홍조/땀은 유지한다. 같은 저장 profile14를 사용하고 새 손·시계·LLM·입 열림을 추가하지 않는다.

concerned+tease에만 작은 숙임/회피·눈 .88/.96을 적용해 깊은 headY/gaze와 반눈이 headX 한도 부근까지 밀던 조합을 줄였다. 기존 worry→지연 wink/reconnect 시계와 초기 smile−.82를 유지하고 걱정이 풀릴 때 닫힌+.4 미소로 응답한 뒤 기존 concerned 여운으로 돌아간다. 다른47개 emotion/attitude 조합·강도/움직임 줄이기·기한/clear·breath/rootY/lean·입 열림·손 소유권은 보존한다. 땀의 실제 표시는 원본 IDLE의 `SweatBurst1~4` 곡선에 따라 달라지므로 key13만으로 가시성을 판단하거나 authored 출력을 강제하지 않는다.

Source 17 당시596개 unit/contract·SDK71개 수락/246PNG·native17/기본 런처 PID114906·원래 설정 보존을 확인했다. 최초 SDK의 깊은 숙임 요구는 새 얕은 숙임 의도와 충돌해 실패했고, production 변경 없이 실제 각도/재접촉·닫힌 입/손 없음으로 수락 기준을 갱신한 이력을 보존한다. 영상17은 같은 저장 프로필/69초·20fps·1380 paired frame/22개 소스 고정으로 최종 QA까지 완료했고47페이지를 모두 읽은 Product17은80/100으로 종료했다. 상세 실패/재검사·현재 결과·최신 소스부터의 복원은 [Grok 검토](../ux/GROK_VTUBER_REVIEW.md)·[구현 상태](../development/IMPLEMENTATION_STATUS.md)를 따른다. TTS·물리 마우스·OS 재부팅/재로그인 검증은 추가하지 않았다.

### 기존 시선 구간의 독립 대기 눈인사 (Source 18, 2026-11-03)

현재 코드 `bda756d`는 활성 cue 없는 expressive idle에 `Avatar.idleFaceSlot` 소유권을 추가한다. 기존 `gazeSlotId % 8 === 2` edge와 읽기 전용 `gazeSlotStartedAt`을 사용하고250ms 준비/180ms attack/450ms hold/450ms release 뒤1330ms에 종료한다. smile .5·한 눈 닫힘/반대 눈 .92를 기존 blink에 곱하며 해당 슬롯마다 눈 방향을 교대한다. 고개/몸/시선/lean·입 열림/호흡/root·자산 시계·기존2750ms 손·의미 cooldown·LLM 예산은 바꾸지 않는다.

`idleEligible`/edge 소비를 기존 손과 공유한다. held contact/잔여 petting·pet 손·활성 cue/pose/gesture·작업/승인·normal/quiet/reduced는 차단하고, 해제된 같은 슬롯에서 뒤늦게 재개하지 않는다. 첫 IDLE의 눈꺼풀/MouthForm/EyeSmile/특수 눈 입력은 새 얼굴보다 우선한다. canonical wave·custom/빈 매핑 검사는 authored 손에만 적용하며 자산 없는 절차 눈인사는 독립이다. actor-only 후보의 pet 해제 잔여 충돌을 피해 Avatar에서 접촉을 검사하고 overlay를 직접 petting보다 먼저 적용한다. pet begin·새 cue/승격·요청/상태·설정 축소·reset/preview/dispose/context loss/렌더 오류는 즉시 정리하고 stale cue/끝난 메시지의 scoped clear는 독립 owner를 보존한다. `localIdleAttention`은 얼굴 기여·`motionActive`는 실제 활성 상태를 표시하며 semantic cue/actor active로 위장하지 않는다.

605개 unit/contract·SDK76개/278PNG(after275/before3)·native18의 눈인사/손 시작→종료와 기존 UI20종·petting/승인·reload/설정 보존을 통과했다. 기본 런처 PID120211의 원래 설정 digest도 확인했다. native 눈인사 기록의 약3초는 캐시/조회 관찰 간격이며 내부1080ms 기여 수명·실시간 FPS가 아니다. 영상18은 같은 저장 profile14·69초 타임라인/22개 소스 고정·20fps/1380 paired frame으로 QA를 완료했고47페이지 평가의 점수는 미정이다. 눈인사57.85~58.95초와 기존 손63.35~66.05초를 관찰했다. 별도 영상 실행의 타 구간 JPEG 완전 일치는 주장하지 않으며 실제 범위·차이 근거를 검토 문서에 구분한다. 최신 검증·`bda756d`부터의 복원은 [구현 상태](../development/IMPLEMENTATION_STATUS.md)와 [Grok 검토](../ux/GROK_VTUBER_REVIEW.md)를 따른다. TTS·물리 마우스·OS 재부팅/재로그인은 검증하지 않았다.

## 전체 표현 점검 (2026-11-01)

2026-11-02 현재 자동 판단의 전체 집합은 감정 8종·말투 6종·제스처 4종이다. 한 메시지에서 세 채널을 조합하며, 말투가 로컬 연기 프리셋을 우선 선택해도 감정 자산과 명시적인 제스처는 별도로 적용한다. `laugh`는 기존 눈웃음 프리셋에 연결했고 추가 질문/호출은 만들지 않았다. `ㅋㅋ` 문자열만으로 로컬에서 웃음을 강제하지 않는다.

| 채널·값             | 자동 연기·기본 모델 연결                                                         | 미리보기·제약                                                       |
| ------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| emotion neutral     | 작은 중립 전달 반응                                                              | 초기화는 중립 상태로 복귀하며 전달 반응은 재생하지 않음             |
| emotion happy       | 기쁨의 절차 미소·눈웃음, 기본 표정 파일 없음                                     | 기쁨. 사용자가 저장한 특수 눈 매핑은 보존                           |
| emotion sad         | 슬픈 시선/고개 + `流泪`                                                          | 슬픔                                                                |
| emotion surprised   | 짧은 놀람 + 로컬 눈/눈썹/입 합성                                                 | 놀람                                                                |
| emotion embarrassed | 수줍음 + `脸红`                                                                  | 수줍음                                                              |
| emotion concerned   | 걱정 + `流冷汗`                                                                  | 걱정                                                                |
| emotion angry       | 화난 눈썹·삐죽·볼 + 지원 채널의 로컬 합성                                        | 화남                                                                |
| emotion confused    | 혼란 시선·고개 + 대응 `圈圈眼`                                                   | 당황·혼란                                                           |
| attitude neutral    | 감정·제스처에 따라 기본 연기 선택                                                | 별도 연기를 강제하지 않음                                           |
| attitude explain    | 설명 고개·시선                                                                   | 설명 미리보기는 손 포즈도 요청하지만 말투 단독은 손 없음            |
| attitude tease      | 장난, 첫 변주는 `屑屑眼`, 다음은 윙크 시도                                       | 장난 미리보기는 첫 변주                                             |
| attitude laugh      | 함께 웃는 농담·재미있는 관찰 → 눈웃음 연기                                       | 눈웃음                                                              |
| attitude shy        | 수줍음, embarrassed 자산 우선                                                    | 수줍음                                                              |
| attitude reassure   | 안심시키는 미소·작은 끄덕임                                                      | 안심                                                                |
| gesture none        | 활성 cue의 새 손 포즈 없음, 이전 메시지의 다른 손 포즈 정리                      | 말투가 손 포즈를 추가하지 않음                                      |
| gesture wave        | 손 들기 → 유지 → 복귀                                                            | 인사                                                                |
| gesture explain     | 검지 포즈 → 유지 → 복귀                                                          | 설명                                                                |
| gesture thinking    | 생각 시선·고개 또는 사용자 생각 자산                                             | 생각, 응답 대기 상태에서도 사용                                     |
| 독립 wink / nod     | 전용 자동 Choice 없음. 장난 변주에는 윙크, 중립 전달/안심에는 다른 끄덕임이 있음 | 윙크 / 끄덕끄덕                                                     |
| shake / pout        | 전용 자동 Choice 없음                                                            | 도리도리 / 볼빵빵·삐짐                                              |
| heart / grass       | 기본 자동 Choice 없음                                                            | 하트 눈 / 강아지풀. 사용자가 감정/제스처 자산에 직접 매핑할 수 있음 |
| reset               | 요청/선택/차단 경계에서 내부 정리                                                | 초기화                                                              |

표정 파일 23개는 감정용 눈·눈물·홍조뿐 아니라 의상·체형·안경·소품·손 selector도 포함한다. 인벤토리 개수를 감정의 개수로 표시하지 않는다. 모든 파일을 실제 SDK에서 개별 로드·렌더·범위·만료 검사했으며, 로컬 놀람 합성은 파일과 별개로 메모리에 한 종류 추가된다. 모션 8개도 로드·렌더를 확인했지만 단독 복귀 clip/의미 미확인 특수 동작을 자동 감정으로 연결하지 않는다. 원본 이름과 한글 별칭은 `src/renderer/model-labels.ts`를 따른다.

**눈 자산 우선순위:** 사용자가 선택한 `＞＜`/하트 눈/장난 눈 등 특수 눈 artwork는 procedural 눈웃음·윙크보다 우선한다. 새 인벤토리의 happy 기본은 파일 없는 절차 미소·눈웃음이다. 이전에 저장된 happy 매핑이 `＞＜`이면 그 선택을 보존하므로 `happy + laugh`의 강조 중에는 일반 감은 눈 대신 `＞＜`가 우선하고 `happy + tease`의 윙크도 가릴 수 있다. 특수 눈 아트는 강조 뒤 정리하고 낮은 절차 얼굴 여운을 남긴다. 이를 판단 미전달로 보거나 사용자 매핑을 조용히 무시하지 않는다. 일반 눈 연기를 원하면 설정에서 기쁨을 ‘기본 연기만’ 또는 특수 눈이 없는 자산으로 선택한다. 기존 선택으로 되돌리면 원래 표현으로 복원된다.

**전환과 fallback:** 새 메시지가 다른 손동작/none을 요청하면 이전 손 포즈를 즉시 중단하고 다음 draw의 중립 기준에서 새 동작을 시작한다. 진입 도중 완성된 endpoint/복귀 clip으로 점프하지 않는다. 같은 손동작의 반복은 기존 cooldown을 유지하고 자연 종료는 기존 paired 복귀를 완주한다. Jev가 없거나 8회 판단 예산을 다 써도 외부 호출 없이 중립 전달 반응을 유지하며, 중복/취소/복구/승인 경계는 과거 반응을 재생하지 않는다.

검증은 [수락 기준](../specs/ACCEPTANCE_CRITERIA.md)과 [구현 상태](../development/IMPLEMENTATION_STATUS.md)의 범위를 따른다. 한국어 예문의 단발 판단은 전체 정확도 보장이 아니며, 144개 의미 조합의 actor 검사와 실제 모델의 개별 경로/자산 출력 검사는 구분한다.

### 요청·응답 연결과 실제 대화의 의미 판단 (2026-11-01)

사용자가 요청한 최근 사례 점검에서는 선택된 같은 세션의 표시용 요청·응답 14쌍을 메모리에서 읽고, 각 쌍만 최신 표현 코드/설정 모델(`jev-1.14.0`)로 별도 재평가했다. 기록 복원 자체가 Jev를 호출하도록 바꾸거나 실제 Hermes prompt를 재전송하지 않았다. 호출 payload의 두 필드가 해당 요청/답변과 일치하는지, Jev → TurnCoordinator → actor 프리셋이 이어지는지도 검사했다. 14쌍 모두 연결은 일치했고 재평가 결과는 웃음 9·중립 전달 4·인사 1이었다. 본문·주소·세션 ID는 검증 파일/저장소에 남기지 않고 해시·길이·선택값·확신도만 ignored `.tmp/linkage-check/recent-result.json`에 기록했다.

**의미 판단 누락의 원인과 개선:** 당시 마지막 공유 농담은 최초+재검사 2회 모두 웃음이 탈락했다. 추가 조사에서 말투 분포가 laugh .47 / tease .46으로 합 .93이었지만 두 세부 표현 사이에서 갈리면서 기존 confidence 기준을 통과하지 못한 것을 확인했다. 저확신 슬픔 후보는 계속 폐기돼 sad cue로 전달되지 않았다. 기준 문구만 늘리거나 줄인 예비안은 실제 사례를 고치지 못하거나 기존 웃음 사례를 누락시켜 채택하지 않았다. 기존 말투 기준을 유지하고, 아래의 보수적인 확률 묶음 규칙으로 보완했다.

상위 선택이 laugh/tease인데 세부 confidence가 설정 기준보다 낮고, 두 확률이 각각 .2 이상이며 합 q가 .85 이상인 경우에만 일반 웃음을 검토한다. 검증된 분포를 반올림 오차 합계로 정규화하고, 이진 confidence `max(0, 2q−1)`도 기존 설정 기준을 통과해야 한다. q=.93이면 .86이므로 기본 .65는 통과하되 사용자 기준 .9에는 적용하지 않는다. 확실한 tease/중립/위로는 그대로 유지한다. 이는 [공식 confidence 정의](https://docs.typesafe.ai/confidence)의 척도를 사용한 앱의 보수적 표현 정책이며, 모델의 세부 선택을 확실한 laugh로 바꾸었다는 주장은 아니다. 질문 3개·외부 호출 1회·기존 임계값은 유지한다.

**완료 본문과 빠른 전달 분리:** `message.complete` 또는 정상 `turn.completed`에서 누적된 현재 live 메시지가 확정될 때만 의미를 한 번 판단한다. 스트림 첫 문장부호/120자에서는 판단하지 않는다. 긴 완료 답변은 앞뒤 800자 발췌를 쓰고 생략 때문에 불명확하면 중립으로 둔다. 의미가 350ms 안에 오지 않으면 로컬 delivery 끄덕임으로 수신을 알린다. 빠른 semantic 결과는 예약된 delivery를 취소한다. delivery→semantic 승격은 한 번만 허용하고 중립 승격은 반응을 다시 시작하지 않는다. 채널 대조는 [감정 표현 조사](../ux/EMOTION_EXPRESSION_AUDIT.md)를 따른다.

**정정·복구의 철회:** 첫 완료는 초안과 달라도 그 완료 본문을 최초 판단한다. 실제 호출 시작 전에 같은 batch에서 완료가 바뀌면 최신 본문으로 한 번 호출한다. 이미 호출했거나 적용한 완료가 정정되면 재판단하지 않고 requestId/messageId/segmentId가 일치하는 반응·표정·손만 정리한다. 전체 본문으로 변경을 비교하므로 발췌 밖의 수정도 감지한다. 빈 delta는 완료 표지를 지우지 않으며, 이전 ID의 완료/snapshot이 최신 메시지를 취소하지 않는다. snapshot 본문·그 뒤 같은 ID의 complete는 재생하지 않고, 원문 없는 재시작 요청의 새 메시지는 로컬 중립만 제공한다.

검증(2026-11-01): 기존 14쌍을 동일 해시로 대조해 이전 웃음 9개를 유지하고 누락했던 농담도 일반 laugh로 전달했다. 해당 완료 본문 반복과 실제 모델 적용을 별도로 확인했다. 순수 기쁨/슬픔/놀람/부끄러움/걱정·위로·교육/인사/생각·일반 보고·웃음 소재 설명/웃음 표기만 있는 보고 등의 합성 대조군은 별도 평가한다. 원문은 공개 fixture에 추가하지 않았고 수치 근거는 ignored `.tmp/expression-fix/`에 있다. 단발·소수 반복 결과로 전체 정확도를 보장하지 않으며, 최종 검사/앱 적용 범위는 [구현 상태](../development/IMPLEMENTATION_STATUS.md)를 따른다.

**당시 적용의 증거 한계:** 일반 앱은 과거 메시지별 Jev 입력·판단·적용 시각을 저장하지 않는다. `lastCue`와 `__avatarStatus`는 현재 프로세스/renderer의 마지막 상태에 불과하며 본문과 연결된 과거 기록이 아니다. 이번 재평가가 과거 화면에서 실제 어떤 표정을 재생했는지를 증명하지 않는다. 진단을 보강하더라도 원문 없이 요청/메시지에 묶인 판단·적용·폐기 사유를 제한된 메모리에 두는 방향으로 검토하며, 이 점검에서 수집/저장 기능을 새로 켜지 않았다. 전체 의미 조합의 로드·렌더 검사와 실제 대화의 적합성 검증은 별개다.

## TTS 제공자 인터페이스

```ts
interface SpeechSynthesizer {
  listVoices(): Promise<Array<{ id: string; locale: string }>>;
  synthesize(
    text: string,
    opts: { voiceId: string; signal: AbortSignal },
  ): AsyncIterable<{ audio: Uint8Array; format: string; timing?: unknown }>;
}
```

이는 앱 내부 추상 인터페이스 예시이며 특정 공급자 API를 의미하지 않는다. 1단계: 로컬 또는 공급자 1종으로 텍스트→오디오 재생. 이후 옵션으로 스트리밍 TTS, provider 교체, 한국어/일본어 voice mapping 지원.

## 립싱크

- 기본: 실제 출력되는 오디오 샘플 RMS를 분석하여 Cubism 립싱크 파라미터에 적용.
- 개선: phoneme/viseme timing 또는 공식 MotionSync Plugin 사용(모델 지원 및 SDK 라이선스 확인).
- 침묵·중단·버퍼 부족 시 입을 자연스럽게 닫으며 다음 오디오 대기.
- 텍스트 delta 도착만으로 입을 움직이지 않음.
- TTS 요청 취소 시 오디오 큐 flush 및 stale chunk 무시.

## 발화 안전

표시용 assistant 답변만 읽고, 도구 stdout·비밀번호·raw request/approval data·비공개 정보는 읽지 않는다. 문장 단위 큐는 문장 경계와 공급자 latency를 고려하며, 토큰 스트림이 완전히 신뢰되기 전 외부 HTML/마크다운을 실행하지 않는다. 음소거/볼륨/스피커 선택 제공.

## 모델 자산 계약

선택한 로컬 모델 디렉터리에서 읽을 수 있는 파일만 참조, 내장되는 샘플 모델도 사용/배포권을 검증. 라이선스가 불명확한 모델·SDK 바이너리 및 타인 보이스 프리셋은 repo에 포함하지 않는다.

근거:

- https://docs.live2d.com/en/cubism-sdk-manual/cubism-sdk-for-web/
- https://docs.live2d.com/en/cubism-sdk-manual/lipsync/
- https://docs.live2d.com/en/cubism-sdk-manual/cubism-sdk-motionsync-plugin-for-web/

## 후속 감정·직접 쓰다듬기 (2026-11-02)

사용자 요청으로 기존 Jev emotion Choice에 `angry`/`confused`를 추가했다. 화자 자신의 감정과 사용자/주제의 감정을 구분하는 기준을 사용하며 호출·임계값·시간/문자 예산은 유지한다. 감정 8×말투 6×제스처 4의 192조합을 검사하고, 슬픔·걱정·안심·인사·화남·혼란 6개를 더한 미리보기는 20종이다. 화남은 미확인 화남 토글 대신 실제 지원 upstream 눈썹·입·볼로 합성하며 혼란은 존재하는 빙글빙글 눈을 쓴다. `Emotion`/`Emotion2`·미확인 특수 모션은 연결하지 않는다.

쓰다듬기는 `presentation.pettingEnabled`(기본 꺼짐)를 저장하고 Overlay 안의 Shift+왼쪽 stroke만 처리한다. 자기 canvas 알파 실루엣의 상단 40%를 대상으로 하며 해부학적 머리 인식/전역 커서 추적은 아니다. 클릭·일반 드래그·휠 배율과 별도이며 누적 8 CSS px 이상 문지르면 눈웃음·미소·작은 고개 반응을 합성한다. 크게 튀는 입력은 버리고 정지 시 약 .9초 안에, 손을 놓으면 .3초의 짧은 여운 뒤 줄어들어 최대 1.05초에 복귀한다. 이 해제 여운도 최초 접촉의 12초 한도를 넘지 않고 중복 종료 이벤트로 연장되지 않는다. 지속 입력도 12초로 제한하며 외부 판단/메시지를 만들지 않는다. 요청·승인 중에는 시작하지 않고 설정 해제·새 요청·승인·오류·reset에서 즉시 정리한다. 특수 눈·자산·physics 채널과 강도/움직임 줄이기를 존중한다.

## Grok 검토 후 무음 시각 연기 (2026-11-03)

`FR-L2D-009`의 조사·의견 충돌·실제 렌더·점수와 반복 반영은 [Grok 검토 문서](../ux/GROK_VTUBER_REVIEW.md)에 연결한다. 감정/말투의 복합 의도는 `ActingController.reactionTarget`에서 합성하고, 의미 여운은 유한한 `maintenanceTarget`의 시선 이동·재접촉·기울임으로 이어진다. 새 시계나 외부 판단을 추가하지 않고 기존 cue 시작/기한·강도/접근성을 따른다. 두 번째 변주의 강조 시계는 지연·늘이기를 적용하며 wink의 blink 억제 시계도 같은 값을 사용한다. 대기는 기존 불규칙 시선 전환에만 작은 기울임·재접촉을 붙이고 호흡/상하 offset은 보존한다.

`ExpressionTarget.durationMs/fadeOutMs`는 눈 아트의 자체 강조/복귀를 정하며 홍조·땀과 전체 의미 기한은 독립이다. 웃음/혼란/장난의 눈 아트를 짧게 되돌려 절차 눈 연기가 이어지게 한다. 저장된 사용자 자산 선택/빈 매핑은 유지한다. 특수 눈 그림끼리의 중간 opacity가 회색/이중 홍채를 만들므로 `selectEyeArtwork`가 가중치 .5에서 단일 표시 소유권을 넘긴다. 자산 안의 사용자 값은 보존하고 표시 층·연속 얼굴의 crossfade는 유지한다. 로컬 화남 합성은 지원되는 음수 `ParamMouthForm`과 안전한 눈썹을 사용하며 짧은 강조 뒤 낮은 여운으로 줄인다. 화남·혼란의 입 열림은 0이다. 웃음의 입 모양 강조는 한 번이며 반복 발화/음소/오디오 처리가 아니다.

원본 `Movement2`는 손을 가슴에 얹는 포즈였으므로 이를 손 흔들기라 간주하던 연결을 보완한다. `greeting.ts`는 **확인된 paired 파일명·selector·네 개의 입력 범위가 모두 맞는 명시적 wave**에만 적용된다. 원본 진입의 .5초 손바닥 자세를 이어 세 번의 유한한 관절 sweep 뒤 손바닥을 유지하고, exit 첫 .3초에 실제 authored 복귀 값으로 합류한 뒤 소유권을 돌려준다. 다른 매핑/부족한 채널/physics 출력은 원본 경로로 fallback한다. selector·최종 물리 출력·원본 모션 파일은 수정하지 않으며 움직임 줄이기에서는 손을 정리한다.

쓰다듬기는 유효한 로컬 stroke의 접촉 좌표를 정규화·제한하고 시간 기반으로 부드럽게 시선/고개에 합성한다. 거절된 점프·해제 뒤 입력은 접촉 방향을 바꾸지 않는다. 사용자가 고른 `embarrassed` 자산의 양수 `key7`만 보조 홍조에 사용하며 이미 적용된 홍조와 더하지 않는다. 옷/소품·authored/physics 출력은 제외한다. 접촉 방향도 기존 petting envelope와 함께 사라지고 다음 접촉은 방향을 초기화한다. 전역 포인터 추적을 추가한 기능이 아니다.

### 실제 rig 보정과 손의 강세/유지/복귀

2026-11-03 실제 MOC의 drawable 정점/opacity와 PNG를 비교했다. `EyeSmile`의 변형은 작고 닫힌 입에서 `MouthSmile_L/R`은 변화가 없었으므로 이름만 보고 새 입력을 연결하지 않았다. 기쁨의 유지 눈은 확인된 눈 열림 입력으로 더 분명히 좁히고, 손을 향한 시선 때 다시 연다. 기쁨의 입은 하나의 작은 비언어 미소 자세(.18 이하 유지)로 이어지며 음소·턱 반복이나 TTS를 만들지 않는다. `ParamMouthForm` 약−.37은 W자 입, −.6은 평평한 입, −.75~−.9는 아래로 굽은 입으로 보여 로컬 화남의 목표를 실제 범위 최저 쪽으로 보정했다. 모든 값은 각 rig의 실제 min/max 안이며 다른 모델의 동일한 미적 결과를 보장하지 않는다.

손은 `handAttentionValues`에서 검증된 dominant 팔 입력(설명 `Param41`, 인사 `Param62`)만 사용한다. 2.5~3.5초에 조금 낮춘 유지로 가고 5.1/9.6초에 서로 다른 크기로 부분적으로 올린다. exit 첫 .3초에 offset을 해제해 원본 복귀에 합류한다. selector·손가락·seam 입력은 유지하며 다른/부족한/physics-owned 입력에서는 원본 경로로 fallback한다. 기존 진입·복귀 자산과 의미 수명은 유지하고 해당 손 방향의 고개·시선을 맞춘다.

해제의 12초 한도가 가까워지면 유지보다 fade 시간을 먼저 확보해 짧은 1ms 끊김을 피한다. 특수 눈 세 개를 빠르게 전환하는 경우에도 전체 기여 가중치로 표시 여부를 정하고 최대 기여의 그림 하나만 선택해 순간 중립 틈을 막는다. 이 두 경계는 normal 동작을 바꾸지 않는 회귀 검사로 검증한다.

### 측정한 고개·상체 연결과 직접 접촉 우선권

실제 MOC의 좌우 회전을 확인한 뒤 시선→고개 결합을 .65에서 1.6으로, 고개→상체 결합을 .3에서 .65로 보정했다. 고개는 강도에 따른 ±.7, 상체는 ±.5로 제한하고 기존의 고개/상체 추적 속도와 불규칙 시계를 쓴다. 대기의 재접촉 뒤 남는 시선은 .2에서 .45로 조절했다. 강도/움직임 줄이기를 낮출 때 이미 진행 중인 자세도 해당 한도 안으로 즉시 제한한다. `PositionX`의 실제 상체 변형을 사용하며 root 상하 이동·호흡·창 위치/배율을 키우지 않는다. 측정 범위와 그림은 [Grok 검토](../ux/GROK_VTUBER_REVIEW.md#고개상체의-실제-구동-경로-확인)에 연결한다.

직접 쓰다듬기는 기존 자세에 접촉 방향을 더하는 대신, 원래 고개/시선/상체에서 접촉 목표로 가중 보간한다. 따라서 반대쪽을 보는 대기 자세가 접촉을 이기지 않는다. 미소/눈웃음도 원래 값에서 따뜻한 목표로 보간해 화남의 음수 입이 마지막 해제 프레임에 튀지 않게 한다. 가중치 0은 원래 frame이며 cue 시계·lean/zoom·상하 offset과 controller의 타임아웃/승인 경계는 유지한다.

### 초기 감정과 접촉의 유한한 몸 반응

기쁨·웃음은 기존 강조 구간에 한 번의 forward lean과 고개 반응을 만들고 3초 무렵 안정한다. 화남은 옆으로 고개/상체를 돌린 뒤 눈을 부분 재접촉하고 측면 자세를 남긴다. 걱정 섞인 장난의 초기 숙임/회피는 같은 wink 시계로 재접촉한다. 활성 의미 cue의 `gesture=none`은 authored 팔 포즈를 시작하지 않는다. 활성 cue 없는 독립 idle owner와 구분한다. 여운 동안 새 body/발화 반복 시계는 만들지 않으며 기존 수명/clear·강도·움직임 줄이기를 적용한다.

직접 쓰다듬기의 접근은 원래 lean에서 최소 .18의 목표로 같은 접촉 가중치만큼 보간한다. 더 강한 기존 양수 lean은 보존하고 해제 시 원래 자세로 돌아간다. 기존 Avatar의 negative `LeanInput` forward branch와 접근용 zoom/anchor 경로를 사용하므로 이 국소 자세의 MVP는 변한다. `offsetY`·ambient 호흡이나 OS 창 위치/저장 배율을 바꾼 것은 아니다. SDK 수락은 실제 forward branch 출력 `Param50`과 최종 해제를 확인하며, 움직임 줄이기에서는 lean을 줄이고 접근 zoom은 사용하지 않는다.

### 복합 감정의 준비와 눈꺼풀 종료

`attitudeTime`은 부끄러움+웃음·걱정+장난에서 기존 cue 시간의 .9초를 준비 감정에 쓰고, 같은 지연 시간을 눈 모양과 wink의 blink 억제에 적용한다. 별도 타이머나 전체 cue 수명 연장은 없다. 걱정의 음수 입·미간을 먼저 보여 준 뒤 장난으로 재접촉하고, 혼란은 한 번의 회피/젖힘 뒤 반대쪽을 살핀다.

화남은 특수 눈 자산 없이 normal 실제 눈 열림 약 .4를 사용한다. 알려진 key6도 MOC에서 원형 입을 그려 닫힌 화남과 맞지 않아 추가하지 않았다. 화남의 기존 eye target 우회 경로가 기한까지 .5를 남기는 원인을 고쳐, 계산된 눈 모양에 기존 강조+유지 가중치를 적용하고 마지막에 중립으로 복귀한다. 유지값 .4025는 보존하며 preview/delivery도 기존 release를 따른다. quiet/expressive·움직임 줄이기·정확한 clear와 종료 직전 실제 출력은 현재 [검증 상태](../development/IMPLEMENTATION_STATUS.md)를 따른다.
