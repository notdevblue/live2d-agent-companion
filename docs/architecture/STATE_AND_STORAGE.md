# 상태 및 데이터 저장 설계

**상태:** Proposed

## 소유권 원칙

원격 봇의 기억과 대화 원본은 공급자에 남는다. 로컬 앱은 사용자가 허용하는 최소한의 연결 설정/바인딩/작업 상태만 유지한다. 삭제·동기화는 공급자별 한계가 다르므로 '로컬 기록 삭제'와 '공급자 기록 삭제'를 구별한다.

## 주요 엔터티

- `Connection`: `connection_id, provider, endpoint, credential_ref, status`.
- `Agent`: `provider + connection_id + agent_id + display_name`.
- `SessionBinding`: `provider + connection_id + agent_id + session_id + continuity_verification`.
- `ConversationView`: 사용자 선택/정렬용 로컬 메타데이터; 원격 history의 소유자는 공급자.
- `Turn`: `turn_id, session_binding`. 논리적 입력을 식별하며 본문 저장은 별도 opt-in.
- `Request`: `request_id, turn_id, state, remote_run_id?, timestamps, terminal_reason`. 개별 제출 시도이며 하나의 Turn에 여러 Request를 연결 가능.
- `SessionLease`: `session_binding, request_id`. 세션당 하나의 미종결 요청만 허용하고 `reconciling` 중에도 유지.
- `Approval`: `domain(provider/local_pc), approval_id, turn_id, request_id, action fingerprint, scope, expiry, decision, used_at`. domain + binding + request_id + approval_id로 식별.
- `CharacterProfile`: 모델 디렉터리, state→motion, 표정 매핑, TTS 프로필.
- `AudioJob`: request_id, chunk index, generation/cancel state; 원문·오디오 기본 영구 저장 안 함.
- `AuditEvent`: 시각, 요청 ID, 행동 타입, 승인 상태, 안전한 요약; 비밀/원문 제외.

## 저장 위치 제안

- 메타데이터: 사용자 프로필 아래 앱 전용 SQLite. 스키마 버전/마이그레이션 필요.
- 설정: 버전 관리 가능한 로컬 JSON 또는 SQLite(인증키 제외).
- 인증키: OS 자격증명 저장소(DPAPI/Windows Credential Manager 기반 라이브러리 검증 후 선택).
- 사용자 Live2D 파일: 원본 경로만 참조. 임의 복제·깃 업로드 금지.
- 스크린샷: 메모리 내 일회성 데이터, 미리보기/전송 완료 후 제거. 디스크 저장은 별도 명시적 동의.
- 대화 원문: 기본 로컬 영구 저장 OFF; 히스토리 기능 추가 시 opt-in, 별도 보존기간 설정.

## 상태 정합성

1. 논리 입력에 turn_id, 제출마다 request_id, 공급자 실행에 remote_run_id를 별도 저장하고 request별 단일 terminal state를 강제한다. 재전송은 새 request_id이며 과거 응답을 새 요청으로 병합하지 않는다.
2. 앱 재시작 후 미종결 요청은 `reconciling`으로 표시하고 lease를 복원한다. 원격 상태 조회/재구독으로 진행 상태 또는 terminal을 확인한다. 확인 불가 시 미확정으로 유지하고 같은 세션의 새 제출을 차단한다.
3. 중복 callback의 event_id + request_id를 dedupe. 저장 기간은 실험 결과에 따라 결정.
4. 공급자 전환은 기존 SessionBinding을 수정하지 않고 active selection pointer만 변경.
5. 장시간 미완료 요청은 UI에 명시, TTL 지난 민감한 임시 데이터 삭제.
6. 요청 상태와 lease 변경은 원자적으로 저장한다. 확인된 terminal/미접수 실패만 lease를 해제하며, 연결 종료·로컬 timeout·승인 만료 자체는 원격 실행 종료로 보지 않는다. 복원된 승인에는 기존 식별자와 만료를 유지하고 새 로컬 PC 권한을 만들지 않는다.

## 데이터 수명

### 현재 SSH 대화 표시 복원

사용자 요청(2026-10-31)에 따라 Hermes SSH는 같은 session의 `session.history`를 읽어 채팅을 복원한다. 본문을 로컬 디스크에 저장하지 않고 provider/connection/profile/session별 `ConversationHistory` 메모리 cache를 사용한다. 창을 닫거나 세션을 바꿨다 돌아오면 같은 cache를 표시하고, 앱 재실행은 원격 원본을 다시 읽는다. 설정과 미종결 요청 JSON에는 대화 본문을 추가하지 않는다. HTTP/Mock/Grok에는 원격 이력 복원을 구현하지 않았다.

복원된 pending 요청은 기존 lease/receipt 복구를 유지하고, 원격 완료 뒤 history를 다시 읽어 답변을 한 번만 표시한다. 네트워크 실패는 기록 오류로 안내하며 자동 prompt 재전송은 없다. 원격 전체 frame 16 MB·정제된 SSH JSON 1 MB 제한을 넘는 큰 기록은 오류로 표시한다. 현재 Hermes `session.history`는 pagination이 없어 이 경우 별도 페이징 API 연동이 필요하다. 원격 보존·삭제·압축 정책 자체를 변경하지 않는다.

설정/선택 목록은 앱 삭제 또는 사용자 명시 삭제까지 보존. 감사 로그는 bounded 로테이션 + 사용자가 삭제 가능. 인증키 삭제는 서비스 토큰 폐기와 다름을 UI에 안내. 진단 업로드는 초기 버전 기본 OFF.
