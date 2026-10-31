# 상태 및 데이터 저장 설계

**상태:** Proposed

## 소유권 원칙

원격 봇의 기억과 대화 원본은 공급자에 남는다. 로컬 앱은 사용자가 허용하는 최소한의 연결 설정/바인딩/작업 상태만 유지한다. 삭제·동기화는 공급자별 한계가 다르므로 '로컬 기록 삭제'와 '공급자 기록 삭제'를 구별한다.

## 주요 엔터티

- `Connection`: `connection_id, provider, endpoint, credential_ref, status`.
- `Agent`: `provider + connection_id + agent_id + display_name`.
- `SessionBinding`: `provider + connection_id + agent_id + session_id + continuity_verification`.
- `ConversationView`: 사용자 선택/정렬용 로컬 메타데이터; 원격 history의 소유자는 공급자.
- `Turn`: `request_id, session_binding, state, remote_run_id?, timestamps, terminal_reason`.
- `Approval`: `approval_id, request_id, action fingerprint, scope, expiry, decision, used_at`.
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

1. turn에 원격 run ID와 고유 request_id를 저장하고 단일 terminal state를 강제.
2. 앱 재시작 후 진행 상태를 조회할 수 없으면 `interrupted / reconciliation_required`로 표시.
3. 중복 callback의 event_id + request_id를 dedupe. 저장 기간은 실험 결과에 따라 결정.
4. 공급자 전환은 기존 SessionBinding을 수정하지 않고 active selection pointer만 변경.
5. 장시간 미완료 요청은 UI에 명시, TTL 지난 민감한 임시 데이터 삭제.

## 데이터 수명

설정/선택 목록은 앱 삭제 또는 사용자 명시 삭제까지 보존. 감사 로그는 bounded 로테이션 + 사용자가 삭제 가능. 인증키 삭제는 서비스 토큰 폐기와 다름을 UI에 안내. 진단 업로드는 초기 버전 기본 OFF.
