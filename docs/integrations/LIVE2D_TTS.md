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

**2026-10-31 구현 범위:** 사용자 요청으로 초기 통합에 Jev를 포함했다. 결정적 기본 상태와 별개로 TypeSafe Choice 질문 3개(emotion/gesture/attitude)를 한 번에 보내며 최대 800자 구간·판단 제한 시간·확신 임계값·최신 구간 검사로 제어한다. attitude는 `neutral/explain/tease/shy/reassure`이며 문장의 주제 대신 말하는 태도를 판단한다. 기존 attitude 없는 응답도 지원한다. confidence는 불확실성이지 움직임의 강도가 아니다. 텍스트 UI는 판단을 기다리지 않는다. 실패/낮은 확신은 neutral/none이며 중단·전환·복구 snapshot은 지연 판단/재판단을 차단한다. 이는 아래 TTS 구현을 뜻하지 않는다.

**2026-11-01 설명 과다 보정:** gesture의 `none`은 일반 대화·진행/결과 보고·사실 답변과 대부분의 설명에서 기본이다. `explain`은 예제/대조/단계를 직접 짚어 가르치는 명확한 강조에만 사용하도록 Choice 기준을 좁혔다. 설명 말투(`attitude=explain`)는 손동작이 아니므로 `gesture=none`을 설명 손 포즈로 승격하지 않는다. 인위적 랜덤 동작이나 추가 판단 호출은 넣지 않았다.

DeepSeek-chan은 `.model3.json`에 표정/모션 참조가 없어 `Exp3/`, `Animation/`을 안전하게 수집해 로컬 manifest에 보충한다. 사용자 모델 원본은 수정하지 않는다. Jev 기본 매핑에는 옷/체형/소품 토글을 넣지 않으며 사용자 설정으로 실제 존재하는 표정/모션을 매핑한다. idle만 loop로 설정하고 제스처는 one-shot이며 매 프레임 기준 파라미터를 복원해 영구 토글을 피한다.

기본 매핑의 누락을 막기 위해 `thinking → @companion/thinking`, `surprised → @companion/surprised`를 제공한다. 이는 모델 파일 이름이 아닌 앱 로컬 연기 ID다. 생각은 기존 시선·고개 연기를 재사용하며, 놀람은 지원되는 눈·눈썹·입 파라미터의 실제 중립값/범위 안에서 합성하고 physics 출력·없는 채널은 생략한다. 저장된 사용자 자산 매핑과 명시적인 빈 값은 보존한다. 생각 미리보기·응답 대기 진입·답변의 gesture 판단은 같은 thinking 매핑을 참조한다.

로컬 `ActingController`는 비주기 blink/시선과 눈→고개→몸 지연, thinking/working 및 짧은 감정·태도 반응을 생성한다. `Avatar`는 runtime 범위/중립값과 physics 출력 목록을 검사해 `Angle*`, `Position*`, `LeanInput` 같은 upstream을 구동한다. physics 출력에 해당하는 표준 채널밖에 없으면 그 채널을 생략한다. 표정은 기존/새 레이어를 240ms로 crossfade하고 만료/초기화 시 정리한다. DeepSeek의 알려진 손동작 쌍은 진입→1.5초 유지→복귀이며 유지 시 selector만이 아니라 자산의 모든 손/손목 endpoint를 보존한다. SDK clip은 실제 pose phase 경과 시간으로 진행하고 physics step 제한과 분리한다. 자산 쌍이 없는 사용자 매핑은 기존 단발 motion으로 fallback한다.

추가 버튜버 연기는 기존 Choice를 재사용한다. 감정/태도 얼굴과 thinking/explain 시선·고개를 분리 합성하고, 반응별 준비·강조·여운·복귀 시간을 둔다. 윙크/반눈/눈웃음/눈썹/삐죽/볼은 좌우 눈과 실제 upstream 얼굴 범위로 제어한다. pipeline은 baseline→idle/one-shot→로컬 연기/얼굴→expression→physics→draw이며 자산이 구동하는 얼굴 채널과 physics 출력은 procedural 입력에서 제외한다. 놀람 눈은 Overwrite 대신 Multiply로 자동 blink를 보존하고 표정 hold도 actor의 2.2초와 맞춘다. 특수 눈 artwork가 켜지면 procedural wink/eyeSmile을 중첩하지 않는다. 기본 상하 offset은 유지한다.

로컬 미리보기 14종(초기화 포함)은 같은 enum/IPC 권한 검사와 승인/요청 차단을 사용한다. 새 강아지풀 포즈는 `狗尾草切换出来`↔`狗尾草切回默认手`/`Movement1` 쌍이며 기존 endpoint 보존·복귀 경로를 사용한다. 하트 눈/삐짐/강아지풀은 명시적 호출 위주이며 없던 손가락 리깅·발화 립싱크를 추가했다고 표시하지 않는다. 조사 근거/비교/후속 범위는 [상호작용 설계](../ux/INTERACTION_DESIGN.md#추가-조사-얼굴시선고개손을-겹치는-버튜버-연기)에 정리한다.

idle 호흡은 4.8초 주기(들숨 42%, 날숨 58%)의 부드러운 곡선으로 `ParamBreath`와 bodyY 입력을 함께 구동한다. 사용자 후속 피드백으로 bodyY 호흡 폭은 첫 구현의 2배로 키웠고, 전체 모델에도 canvas 내부의 작은 수직 offset을 추가했다. 호흡 위상은 cue/초기화와 독립적이며 기존 강도/움직임 줄이기를 적용한다. 승인 차단에는 기본 호흡/offset을 정지하고 사용자 gesture의 authored `ParamBreath` curve도 존중한다. OS 창 위치·배율은 호흡으로 바꾸지 않는다.

설정의 구도는 canvas matrix만 바꾸며 창 배치·모니터·대화 세션을 바꾸지 않는다. 연출 강도와 움직임 줄이기는 로컬 연기만 조절한다. 승인/취소/복구 상태는 transient와 손 포즈를 차단하고, 마지막 Director 상태를 보관해 승인 종료 뒤 복귀한다. 로컬 미리보기는 main의 enum/sender/진행 상태 검사 뒤 실행하며 실제 메시지나 외부 판단을 생성하지 않는다.

Framework 5-r.5는 Core 5.3(`core/06`)과 함께 고정했다. 예전 Core legacy URL은 API 시그니처가 달라 모델 로드에 실패했으므로 사용하지 않는다. 모션에는 EyeBlink/LipSync effect ID 목록을 명시적으로 초기화한다. 공식 SDK의 타입은 renderer의 좁은 runtime 어댑터로 감싸며 ignored SDK 원본 자체의 타입 검사는 앱 typecheck 범위 밖이다.

DeepSeek-chan의 49개 clipping mask 그룹은 기본 버퍼 1개의 36그룹 용량을 넘는다. SDK의 그룹 중복 제거 결과로 버퍼 수를 계산하고, 다중 버퍼의 32그룹/버퍼 용량에 따라 이 모델에는 버퍼 2개를 사용한다. 마스크 텍스처는 512픽셀이며 GPU 초기화 전에 설정한다. 용량을 초과한 채 그리면 SDK가 마스크 영역을 재사용해 얼굴·머리카락·꼬리가 서로 잘못 합성된다. 원본 모델 파라미터나 색을 바꾸는 방식으로 가리지 않는다.

큰 텍스처의 축소 점무늬를 줄이기 위해 POT 텍스처에는 trilinear mipmap을 사용하고 WebGL 1의 NPOT 텍스처는 기존 linear 필터를 유지한다. premultiplied alpha 업로드는 유지한다. 첫 제스처는 앱 시작 시각과 무관하게 허용하고 이후 제스처 사이에만 cooldown을 적용한다.

예: `request accepted → thinking`; `tool.started → working`; `audio.playing → talking`; `turn.completed + audio ended → idle`; `turn.failed → brief error → idle`.

**애니메이션 우선순위:** security/approval UX > explicit user interaction > speaking > task state > idle. 전환 시 crossfade, 전환 가능 여부는 모델/SDK 지원 확인.

## TTS 제공자 인터페이스

~~~ts
interface SpeechSynthesizer {
  listVoices(): Promise<Array<{id: string; locale: string}>>;
  synthesize(text: string, opts: {voiceId: string; signal: AbortSignal}):
    AsyncIterable<{audio: Uint8Array; format: string; timing?: unknown}>;
}
~~~

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
