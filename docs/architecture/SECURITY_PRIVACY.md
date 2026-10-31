# 보안·개인정보·권한 모델

**상태:** Proposed, 모든 단계의 필수 기준.

## 신뢰 경계

1. 에이전트 출력은 **데이터**다. 텍스트가 PC 도구를 실행할 권한을 부여하지 않는다.
2. Electron renderer는 **untrusted UI surface**로 보고 Node/쉘/자격증명 접근 차단.
3. Grok/Hermes/TTS의 네트워크 응답과 Grok Callback은 미검증 입력으로 취급.
4. 사용자 승인(authority)은 main의 PermissionBroker만 발행·검증.
5. 공급자 도구 승인과 로컬 OS 입력 승인은 별도이며 서로 대체할 수 없다.

## 권한 등급

| 위험 | 예시 | 기본 정책 |
|---|---|---|
| R0 | 캐릭터 애니메이션, 대화 UI 표시 | 허용 |
| R1 | 지정 창 정보 보기/캡처 | 명시적 범위 선택 + 미리보기 + 전송 승인 |
| R2 | 클릭, 스크롤, 제한된 타이핑 | 요청별 단기 승인, 대상 창 고정 |
| R3 | 파일 쓰기/삭제, 터미널 실행, 외부 메시지 발송 | 명확한 영향 요약, 별도 강한 승인 또는 초기 차단 |
| R4 | 자격증명 접근, 결제, 보안 설정 변경, 광범위한 삭제 | 기본 차단, 별도 정책/사용자 직접 수행 |

승인 정보에는 subject(connection+agent+session+turn), action, target/window, TTL, one-shot 사용 여부를 포함한다. 타겟 창/범위가 달라지면 기존 승인은 무효.

## 위협과 대응

- **Prompt injection**: 외부 텍스트/웹 페이지/스크린샷에 포함된 명령은 사용자 승인으로 승격하지 않는다.
- **Exfiltration**: 캡처 미리보기, 대상 공급자 표시, 전송 데이터 최소화. HTTP 목적지 allowlist/설정 검증.
- **Callback spoofing**: 별도 고엔트로피 인증 비밀, 요청 nonce, request_id/turn binding, 만료, replay 체크, 사이즈·rate-limit.
- **Token disclosure**: 환경변수/파일/콘솔 출력 회피, OS protected store, 에러 메시지 redact.
- **Electron RCE**: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, CSP, 외부 링크 검증, 최소 IPC.
- **Clickjacking/approval confusion**: 승인 창은 클릭 통과 불가, 최소한의 target+행동/시각/공급자 표시, 앱 포커스 확보.
- **Cross-agent leak**: 공급자·봇·세션 경계와 별도 저장/토큰/이벤트 라우팅.
- **Replay/duplicate run**: webhook 반복 실행·재요청 위험을 사용자에게 고지, 자동 재시도 제한.

## 화면 캡처 정책

기본 OFF. 사용자 액션 → 캡처 범위/창 선택 → 로컬 미리보기 → 한 번만 전송 확인 → 해당 공급자 전달. 비밀번호 매니저/금융 등 민감한 창을 자동 인식해 완벽 차단한다고 주장하지 않음; 사용자의 시각적 검토가 필수. 자동 재캡처/백그라운드 모니터링은 별도 제품 설계 및 명시적 설정 없이는 금지.

## PC 도구 정책

지원할 동작은 허용 목록 기반의 typed actions (예: `pointer.click`, `keyboard.type`). 원문 `shell(command)`을 임의 실행하지 않는다. 허용 대상 창과 PID/소유권 재검증, 중단 버튼, 만료된 승인의 자동 차단, 감사 로그를 갖춘 후 구현한다.

## 라이선스/지적 재산권

Cubism SDK/Core, MotionSync, 개별 Live2D 모델·음성 모델/보이스마다 별도의 사용·배포 조건을 확인한다. 사용자가 제공한 자산의 로컬 참조만 기본 지원하며, 별도 허락 없는 바이너리 배포 금지.

관련 근거: https://www.electronjs.org/docs/latest/tutorial/security
