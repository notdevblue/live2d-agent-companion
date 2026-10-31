# Windows 11 데스크톱 통합 설계

**상태:** Proposed · Windows 11 x64 첫 대상

## 창 정책

- 투명 배경, 창 장식 없음, 크기 조절·드래그, 항상 위 표시 선택.
- 캐릭터 영역 클릭/드래그, 비캐릭터 영역 클릭 통과 기능은 OS 적합성·접근성을 확인해 구현.
- 승인 요청·비밀 입력 UI는 클릭 통과 불가, 사용자 포커스를 명확히 확보.
- 다중 디스플레이/고 DPI/해상도 변경/절전·재개/게임 전체화면을 테스트.
- 게임 감지/자동 숨김은 선택적이며 안티치트·포커스·GPU 점유 영향 검증.

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
