# Grok Bot 앱의 개별 Bot 연결

**상태:** **Spike-required** · 기존 Bot의 '실시간 채팅 API' 연동은 아직 검증되지 않았다.

## 무엇을 연결하는가

이 프로젝트의 Grok Bot은 사용자가 **Grok Bot 앱에서 직접 만든 특정 개별 Bot**이다. `docs.x.ai/grok-bot`의 Bots/Routines 개념을 가리키며, `api.x.ai`의 일반 Grok 모델 API 호출과 동일하지 않다.

## 공식적으로 확인된 사실 (2026-10-31)

- 개별 Bot은 Routine을 가질 수 있다.
- Routine에 Webhook trigger를 추가하면 공개된 POST URL과 비밀 key를 이용하여 외부에서 작업 시작을 요청할 수 있다.
- 호출자는 `Authorization: Bearer <key>`를 포함하고 JSON body를 선택적으로 보낼 수 있다.
- HTTP `200`은 **Bot이 요청을 수락하고 run을 시작했음**만 의미한다. 답변은 Bot Chat에서 확인하라고 문서에 안내한다.
- Routine별 시간당 200회, 전체 합계 시간당 300회 등 제한이 문서에 명시되어 있다(변경 가능).
- **공식 양방향 메시지 API/외부 callback 응답 계약/기존 Bot Chat 동일성 보장**은 위 문서에서 확인되지 않았다.

공식 문서: https://docs.x.ai/grok-bot/skills-routines-and-automations (마지막 업데이트 2026-10-28 기준)

## 제안한 연결 구조(아직 검증되지 않음)

~~~text
Desktop request (request_id)
  -> authenticated routine webhook POST
  -> 200 = ACCEPTED, awaiting_result
  -> Bot's run inside provider
  -> [unverified] Bot sends HTTPS callback to relay
  -> relay validates and routes to desktop
  -> terminal response, TTS
~~~

**핵심 주의:** Bot이 임의 HTTPS POST를 외부로 보낼 수 있는지, 그 권한/연결 앱/환경 제약, callback 도달성/주소 설정 가능성은 반드시 실제 계정·Bot으로 실증해야 한다. 유효한 callback 통로가 없으면 텍스트 왕복 지원을 선언하지 않는다.

## 입력 계약(로컬 제안)

~~~json
{
  "schema_version": 1,
  "request_id": "uuid",
  "message": "오늘 작업 상황 좀 봐줘",
  "reply_channel": "configured-callback-alias"
}
~~~

이 JSON은 우리 클라이언트가 Webhook body로 전달할 **제안 포맷**이며 Grok Bot 공식 API 스키마가 아니다. Routine instruction이 각 필드의 의미를 해석하도록 구성하고, 비밀 callback key/서버 주소를 대화에 그대로 반복하지 않도록 한다.

## 설정 UX

- 사용자가 기존 Grok Bot 이름/ID(확인 가능한 경우), 해당 Bot의 Routine Webhook URL 및 secret 설정.
- `Test trigger` 누르면 안전한 메시지로 호출하고 Bot Chat에서 run 생성 여부를 수동 확인.
- `Test callback`은 실증 성공 이후에만 제공. 비밀/nonce/TTL/dedupe 검증.
- 실제 대화 탭에서는 `Experimental / awaiting result` 배지 및 중단 가능 여부 표시.
- 사용량·호출 제한을 고지하고 폭주/중복 방지.

## 실패 및 폴백

| 상황 | 사용자 표시 | 처리 |
|---|---|---|
| Webhook 401/403 | 인증 오류 | 키 교체 요청, 자동 재시도 중지 |
| Webhook 비-200 | 제출 실패 | 원격 run 시작 불명확 가능성 안내 |
| Webhook 200, 응답 없음 | 시작됨/결과 미도착 | 정해진 대기 후 timeout, 성공으로 표시 금지 |
| 중복 callback | 무시 + 진단 | 일회성 request 이벤트 처리 |
| 세션 연속성 불명 | 검증되지 않음 | '기존 Bot Chat 그대로' 주장 금지 |
| 아예 callback 불가 | Grok Bot 채팅 미지원 | Hermes 연결은 계속 사용 가능 |

## S-003 / S-004 실증 절차

1. 앱의 특정 Bot에 안전한 Webhook Routine 생성(권한 범위 최소).
2. request_id 포함한 1회 POST; Bot Chat에 run 내용이 남는지 확인.
3. Bot에 구조화된 응답을 외부 HTTPS 테스트 endpoint로 보내도록 **허용된 기능으로만** 시도.
4. Callback의 성공/실패/타임아웃/중복/백그라운드 종료·재연결을 측정.
5. 과거 Bot Chat을 참고할 수 있는지, 실제 '동일 대화'인지 테스트 케이스 분리.
6. 제한, 응답 속도, 호출 비용 및 서비스 약관에 맞는지 검토.
7. 결과를 실험 기록에 첨부하고 `supported` / `experimental` / `blocked`로 결론.

웹 UI 쿠키 추출·비공식 세션 하이재킹·약관 위반 자동화는 대안으로 채택하지 않는다. 일반 Grok 모델 API는 필요 시 **별도 새 공급자**로 추가할 수 있지만 기존 Bot으로 표시하지 않는다.
