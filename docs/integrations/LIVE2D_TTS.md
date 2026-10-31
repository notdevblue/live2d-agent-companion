# Live2D, TTS, Character Director

**상태:** Proposed · **전제:** 사용자가 합법적으로 보유한 리깅된 Live2D 모델을 사용.

## 렌더링

- **제안:** Cubism SDK for Web + Electron renderer/WebGL. SDK Core·샘플·MotionSync 바이너리의 라이선스 확인.
- 로더는 `.model3.json` 파일로 모델·텍스처·물리·모션·표정 참조를 해석한다.
- 모델 로딩 시 사용 가능한 parameter ID, motion 그룹, expression을 inventory로 수집.
- 알 수 없는 표현은 idle/neutral로 fallback, 모델 변조나 기본 파라미터 명칭 강제 금지.
- 저장 가능한 매핑: `idle, thinking, listening, talking, working, success, error` → 모델에서 실제 존재하는 motions/expressions.

## Character Director

대화 본문(사용자에게 보여주는 안전한 텍스트), 원격 tool lifecycle, TTS 재생 상태, 클릭/드래그 이벤트를 입력으로 받은 별도 상태 머신. 1단계는 **결정적 규칙**만 적용; 감정 추론 LLM은 선택적, 사용자 설정 ON 후 추가.

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
