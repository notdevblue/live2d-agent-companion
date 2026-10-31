# Windows 11 데스크톱 통합 설계

**상태:** Proposed · Windows 11 x64 첫 대상

## 창 정책

- **사용자 지정 방향(2026-10-31):** 평소에는 배경·테두리·제목 표시줄·사각 패널 없이 Live2D 모델만 데스크톱에 보인다. 채팅/설정/승인 UI는 요청할 때 별도 창으로 연다.
- 투명 배경, 창 장식·그림자 없음, 모델 드래그 이동, 항상 위 표시 선택. 크기 조절은 우선 모델 배율 설정으로 제공한다. 투명 창의 OS 테두리 드래그 리사이즈는 지원을 가정하지 않고 별도 검증한다.
- 캐릭터 영역 클릭/드래그, 비캐릭터 영역 클릭 통과 기능은 OS 적합성·접근성을 확인해 구현.
- 승인 요청·비밀 입력 UI는 클릭 통과 불가, 사용자 포커스를 명확히 확보.
- 다중 디스플레이/고 DPI/해상도 변경/절전·재개/게임 전체화면을 테스트.
- 게임 감지/자동 숨김은 선택적이며 안티치트·포커스·GPU 점유 영향 검증.

## 모델만 표시하는 PoC

이 PoC는 AgentAdapter/TurnCoordinator·외부 AI·TTS 없이 독립적으로 진행할 수 있다. [ROADMAP](../planning/ROADMAP.md)의 core PoC와 코드를 공유할 의존성은 최소 Electron 보안 뼈대를 통해 나중에 연결한다.

1. **앱 뼈대:** Electron main/preload/renderer 분리, context isolation/sandbox/CSP, 필요한 창 조작 IPC만 허용.
2. **투명 Overlay:** `frame: false`, `transparent: true` 및 그림자 제거를 후보로 검증. HTML/body/canvas와 WebGL clear alpha까지 투명하게 구성한다. OS 창은 사각형으로 존재하지만 사용자에게 배경이나 외곽선이 보이지 않게 한다.
3. **모델 자산 경로:** main에서 사용자가 선택한 모델 디렉터리만 허용한다. `.model3.json`의 `.moc3`·텍스처·모션 등 상대 참조를 검증하고 디렉터리 밖 경로/외부 URL은 차단한다. renderer에 임의 파일 읽기 권한을 주지 않는 제한된 자산 로딩 경로를 둔다. SDK/Core 및 모델 사용권은 S-005에서 확인한다.
4. **렌더러:** Cubism 초기화 → 모델/텍스처 로드 → WebGL 렌더 루프 → 좌표·DPI·배율 조정. 모델이 지원하는 idle/눈깜빡임/호흡부터 적용하고 자산/파라미터 누락은 fallback. 움직임에 필요한 canvas 여백을 확보해 팔다리·머리카락이 창 경계에서 잘리지 않도록 확인한다.
5. **입력 처리:** 모델 hit-test로 드래그/클릭과 빈 영역을 구분하고 main에서 클릭 통과를 전환하는 방식을 PoC로 확인한다. `setIgnoreMouseEvents`는 창 전체에 적용되므로 투명 픽셀별 통과를 자동 보장하지 않는다. 드래그 중 통과 전환 방지, 모델 재진입 감지, 숨김/복구용 트레이 또는 단축키를 검증한다.
6. **설정/복원:** 모델 경로·창 위치·모델 배율·항상 위·클릭 통과 설정을 저장한다. 앱 재실행 후 복원과 모니터 제거/DPI 변경 시 화면 안으로 위치 복구를 실제 Windows에서 확인한다.

첫 시각적 완료 기준은 **로컬 모델 표시 + 기본 idle + 모델 드래그 + 설정 저장/앱 재실행 복원**이다. 빈 영역의 클릭 통과는 별도 상호작용 게이트이며 그 검증 전에는 지원한다고 표시하지 않는다. 캐릭터 단독 표시 PoC 완료는 채팅까지 요구하는 AC-01 전체 통과를 뜻하지 않는다.

근거: [Electron 투명/프레임 없는 창과 제약](https://www.electronjs.org/docs/latest/tutorial/custom-window-styles), [마우스 이벤트 무시 API](https://www.electronjs.org/docs/latest/api/base-window#winsetignoremouseeventsignore-options), [Cubism Web 모델 로드](https://docs.live2d.com/en/cubism-sdk-manual/model-web/). API 후보 확인과 실제 Windows 동작 검증은 구분한다.

**검토 범위(2026-10-31):** 공식 문서와 로컬 설계/수락 조건을 대조했다. 실행 코드가 없어 실제 투명 창·모델 렌더·클릭 통과·앱 재시작 복원은 검증하지 않았다.

## 화면 캡처(후속 단계)

~~~text
User gesture
 -> Select monitor/window/region
 -> OS capture API (candidate: Windows Graphics Capture)
 -> Local preview + sensitive-content review
 -> Confirm exact destination + once
 -> Attach image if adapter supports attachments.image
 -> Discard temporary buffers
~~~

Windows Graphics Capture/Electron desktopCapturer 등은 PoC로 지원 조건 비교. 캡처 API 지원만으로 모든 프로세스/보호된 창의 캡처가 가능하다고 가정하지 않는다. 사용자는 화면을 보여주는 **시점과 범위**를 결정해야 한다.

## PC 동작(후속 단계)

- Typed tool actions: `pointer.move, pointer.click, pointer.scroll, keyboard.type, keyboard.hotkey, window.focus` 등 허용 목록.
- main의 ToolExecutor는 액션별 허용 대상 창/윈도우 핸들·PID·범위·승인 TTL 재검증.
- 화면 배치 변화/포커스 변화/모니터 변경/권한 상실 시 즉시 중단.
- 파일/쉘/네트워크 쓰기 도구는 기본 제외, 추가 단계의 보안 리뷰 필요.
- 사용자 kill switch 및 자동화 활성 표시 상시 제공.

## 기술 보안

Electron main/preload/renderer 분리, contextIsolation/sandbox, Node integration OFF, CSP, 외부 페이지 직접 로드 금지, IPC sender 검증. OS 자격증명은 renderer에 전달하지 않는다. 원격 플랫폼 답변은 모두 텍스트 데이터로 처리.

참고: https://www.electronjs.org/docs/latest/tutorial/security
