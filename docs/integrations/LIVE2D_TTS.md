# Live2D, TTS, Character Director

**상태:** Proposed · **전제:** 사용자가 합법적으로 보유한 리깅된 Live2D 모델을 사용.

## 렌더링

- **제안:** Cubism SDK for Web + Electron renderer/WebGL. SDK Core·샘플·MotionSync 바이너리의 라이선스 확인.
- 로더는 `.model3.json` 파일로 모델·텍스처·물리·모션·표정 참조를 해석한다.
- 모델 로딩 시 사용 가능한 parameter ID, motion 그룹, expression을 inventory로 수집.
- 알 수 없는 표현은 idle/neutral로 fallback, 모델 변조나 기본 파라미터 명칭 강제 금지.
- 저장 가능한 매핑: `idle, thinking, listening, talking, working, success, error` → 모델에서 실제 존재하는 motions/expressions.

## Character Director

대화 본문(사용자에게 보여주는 안전한 텍스트), 원격 tool lifecycle, TTS 재생 상태, 클릭/드래그 이벤트를 입력으로 받는 별도 상태 머신이다. 기본 상태는 결정적 규칙으로 제어하고 의미에 따른 표정/제스처는 사용자가 켠 Jev 판단을 사용한다. TTS 재생 상태 입력은 후속 범위다.

**2026-10-31 구현 범위:** 사용자 요청으로 초기 통합에 Jev를 포함했다. 결정적 기본 상태와 별개로 TypeSafe Choice 질문 2개(emotion/gesture)를 한 번에 보내며 최대 800자 구간·판단 제한 시간·확신 임계값·최신 구간 검사로 제어한다. 텍스트 UI는 판단을 기다리지 않는다. 실패/낮은 확신은 neutral/none이며 중단·전환·복구 snapshot은 지연 판단/재판단을 차단한다. 이는 아래 TTS 구현을 뜻하지 않는다.

DeepSeek-chan은 `.model3.json`에 표정/모션 참조가 없어 `Exp3/`, `Animation/`을 안전하게 수집해 로컬 manifest에 보충한다. 사용자 모델 원본은 수정하지 않는다. Jev 기본 매핑에는 옷/체형/소품 토글을 넣지 않으며 사용자 설정으로 실제 존재하는 표정/모션을 매핑한다. idle만 loop로 설정하고 제스처는 one-shot이며 매 프레임 기준 파라미터를 복원해 영구 토글을 피한다.

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
