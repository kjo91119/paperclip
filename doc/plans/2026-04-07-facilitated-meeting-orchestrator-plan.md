# 2026-04-07 전체회의 토론 오케스트레이터 계획

Status: ready_for_implementation
Date: 2026-04-07
Audience: product, design, engineering
Related:
- [AI Company Messenger Roadmap](/mnt/d/project/paperclipai/doc/plans/2026-04-05-ai-company-messenger-roadmap.md)
- [Paperclip V1 Implementation Spec](/mnt/d/project/paperclipai/doc/SPEC-implementation.md)
- [Office Conversation Cross Verification](/mnt/d/project/paperclipai/doc/plans/2026-04-05-office-conversation-cross-verification.md)
- [Facilitated Meeting Orchestrator Cross Verification](/mnt/d/project/paperclipai/doc/plans/2026-04-07-facilitated-meeting-orchestrator-cross-verification.md)

## 1. 목적

현재 `전체회의 V1`은 다음 수준에 머문다.

- 진행자 1명에게만 실제 이슈를 할당
- 다른 참가자는 본문 멘션과 컨텍스트로만 표현
- 회의 스레드는 하나지만, 실제 다자 토론을 보장하지 않음

이번 계획의 목표는 이 흐름을 다음 단계로 끌어올리는 것이다.

- 사용자가 `CEO`, `CTO`, `CMO` 같은 여러 에이전트를 선택해 회의를 시작
- 각 참가자가 먼저 독립적으로 의견을 제시
- 이후 서로의 의견을 읽고 반론, 보완, 우선순위 조정 토론
- 마지막에 사회자 또는 지정 요약자가 `합의안 / 쟁점 / 다음 액션`으로 정리

핵심은 "단순 멘션 회의"가 아니라 "라운드 기반 다자 토론 오케스트레이터"를 만드는 것이다.

## 2. 사용자 기대 동작

사용자는 아래와 같은 흐름을 기대한다.

1. 오피스에서 `전체회의`를 연다.
2. `CEO`, `CTO`, `CMO`를 참가자로 선택한다.
3. 안건을 입력한다.

예시:

```text
지금 우리 프로젝트가 애드센스 승인을 받으려면 어떤 형식으로 가는 게 좋을까?
```

4. 각 참가자가 자기 역할 관점에서 1차 의견을 낸다.
5. 참가자들이 서로의 의견을 보고 다시 논의한다.
6. 최종적으로 하나의 결론과 실행 계획이 정리된다.

사용자에게 보여야 하는 경험은 "한 회의방 안에서 여러 명이 대화하는 것"이지만, 시스템 내부는 여전히 Paperclip의 제약을 지켜야 한다.

## 3. 반드시 지켜야 하는 제약

기존 문서와 현재 구현을 기준으로 아래 제약은 유지한다.

- durable communication model은 여전히 `issues + comments`다.
- 하나의 issue는 여전히 `single assignee`다.
- 다자 토론은 "멀티 assignee"가 아니라 "오케스트레이션된 병렬 협업"이어야 한다.
- 비용, 활동 로그, wakeup, approvals, budgets는 기존 control-plane 규칙 안에서 동작해야 한다.
- 무한 토론 루프는 허용하지 않는다.

즉, UI는 그룹 회의처럼 보여도 백엔드는 task/comment 모델 위에서 유지해야 한다.

## 4. 현재 방식으로는 부족한 이유

현재 `전체회의 V1`만으로는 아래가 어렵다.

- 누가 아직 답하지 않았는지 추적
- 1차 의견과 2차 토론 라운드 구분
- 부분 응답 상태에서 다음 라운드로 넘어갈지 결정
- 사회자 요약 또는 자동 요약 시점 제어
- 참가자별 timeout, retry, remind 처리
- 회의 전체 transcript와 참가자별 작업 흔적을 모두 감사 가능하게 유지

같은 이슈에 참가자 전원이 직접 댓글만 달게 하면 얼핏 쉬워 보이지만, 실제로는 책임 추적과 라운드 제어가 불안정해진다.

## 5. 핵심 제품 결정

### 5.1 회의는 "루트 회의 이슈 + 참가자별 숨김 하위 이슈"로 구성한다

- 루트 회의 이슈 1개를 만든다.
- 루트 이슈는 회의방처럼 보이는 대표 스레드다.
- 참가자마다 하위 이슈 1개씩 자동 생성한다.
- 참가자 하위 이슈는 각 참가자의 실제 작업 단위다.
- 참가자 하위 이슈는 일반 이슈 목록을 오염시키지 않도록 기본적으로 숨김 처리한다.

이 구조의 장점:

- single-assignee invariant 유지
- 참가자별 책임, 응답 여부, wakeup, 비용 추적 가능
- UI에서는 하나의 회의 transcript로 다시 합쳐서 보여줄 수 있음

### 5.2 사회자는 회의 메타데이터에만 두고, 루트 회의 이슈를 agent assignee로 두지 않는다

- 현재 issue create/comment wakeup 규칙상 루트 이슈를 사회자 agent에 할당하면 round summary, timeout notice, final summary comment가 사회자를 반복적으로 다시 깨운다.
- 따라서 `사회자`는 `issue_meetings.facilitator_agent_id`로만 관리한다.
- 루트 회의 이슈는 visible meeting container이며, agent assignee는 두지 않는다.
- 루트 이슈의 사람 생성자는 `createdByUserId`로만 추적하고, `assigneeUserId` 기본값은 비워 둔다.
- 루트 이슈에 남기는 orchestrator/system comment는 내부 helper를 통해 직접 insert하며, route-level mention resolution/wakeup 경로를 타지 않는다.

#### 사회자 자동 선정 우선순위

1. 참가자에 `CEO`가 있으면 `CEO`
2. 아니면 역할 우선순위 `CTO > CMO > CFO > PM > DevOps > Engineer > Designer > QA > Researcher > General`
3. 그래도 같으면 사용자가 처음 선택한 agent

#### 요약자 제약

- V1에서 `summary_agent_id`는 반드시 active participant 중 한 명이어야 한다.
- 기본값은 `facilitator_agent_id`다.
- 사용자가 요약자를 override할 수 있어도, 선택지는 이번 회의 participant 목록 안으로 제한한다.
- V1에서는 summarizer 전용 별도 child issue를 만들지 않는다.
- final summary wakeup은 해당 summarizer participant의 기존 child issue를 통해서만 발생한다.

### 5.3 회의 참가자는 "토론 참가자"이며 각자 자기 하위 이슈에서 응답한다

- `CEO`, `CTO`, `CMO`는 같은 루트 이슈의 co-owner가 아니다.
- 각자 자기 하위 이슈에서 라운드별로 답한다.
- 루트 회의 화면은 이 하위 이슈 댓글을 합쳐서 대화처럼 렌더링한다.

### 5.4 회의는 기본 3단계 라운드로 동작한다

기본 흐름:

1. `1차 의견 수집`
2. `상호 토론`
3. `최종 요약`

기본 라운드 수는 2 + summary로 시작한다.

- Round 1: 독립 의견
- Round 2: 타인 의견을 읽고 토론
- Final: 사회자 또는 지정 요약자 결론

필요하면 이후 `후속 라운드`를 사람이 수동으로 추가할 수 있게 한다.

라운드 수 계산 규칙:

- `opening` 1개는 고정
- `discussion` + `followup`는 `max_discussion_rounds` 안에서만 증가
- `summary`는 finalization 시점마다 1개가 열린다

### 5.5 "동시에 떠드는 채팅"이 아니라 "병렬 응답 + 수집 + 재배포" 모델로 간다

정확한 의미의 동시 발화 채팅은 지향하지 않는다.

대신 아래를 한다.

- 한 라운드 시작 시 참가자 전원을 병렬 wakeup
- 응답을 수집
- 응답 묶음을 다음 라운드 입력으로 참가자 전원에게 재배포
- 마지막에 요약

이 방식은 사용자 체감상 "다 같이 회의하는 느낌"을 주면서도, 제어 가능성과 감사 가능성을 유지한다.

### 5.6 참가자 상태와 라운드 상태를 분리한다

- `issue_meeting_participants`는 "누가 회의 멤버인지"만 나타내는 비교적 정적인 테이블이다.
- 실제 dispatch, response, timeout, retry, late response 같은 실행 상태의 canonical source는 round-participant 조인 테이블에 둔다.
- participant row에 `last_response_comment_id` 같은 "최근 상태"만 두는 방식은 Round 1과 Round 2 이력을 덮어쓰므로 사용하지 않는다.

### 5.7 system note와 deliberative answer를 분리한다

- 라운드 시작, timeout, partial proceed notice, round summary projection은 `system-authored comment`로 남긴다.
- 실제 최종 권고안은 `사회자` 또는 명시적으로 지정한 `summary_agent_id`가 agent-authored comment로 남긴다.
- 즉, 회의 제어 메시지와 agent의 판단/결론 메시지를 서로 다른 author model로 구분한다.
- V1의 round summary는 "새 의견을 생성하는 AI 답변"이 아니라, 참가자 발화를 구조화해 보여주는 system projection으로 제한한다.

## 6. 권장 데이터 모델

`issues`와 `issue_comments`는 그대로 유지한다.
회의 오케스트레이션 상태만 위한 보조 테이블을 추가한다.

이 결정은 [AI Company Messenger Roadmap](/mnt/d/project/paperclipai/doc/plans/2026-04-05-ai-company-messenger-roadmap.md)에서 말한 "초기 phase에서는 가능하면 새 DB 테이블을 피한다"는 방향보다 한 단계 더 나아간 것이다.

이번에는 예외를 허용하는 편이 맞다.

- 요청된 기능은 단순 meeting V1이 아니라 다자 토론 오케스트레이션이다.
- 라운드 상태, participant 응답 상태, timeout, partial proceed를 comment만으로 안정적으로 관리하기 어렵다.
- durable communication record는 여전히 `issues + comments`에 남기고, 새 테이블은 orchestration state에만 한정하면 현재 모델과 충돌하지 않는다.

### 6.1 `issue_meetings`

한 회의의 루트 메타데이터.

- `id`
- `company_id`
- `root_issue_id`
- `facilitator_agent_id`
- `summary_agent_id`
- `status`
  - `draft`
  - `running`
  - `awaiting_operator`
  - `paused`
  - `completed`
  - `partial_completed`
  - `failed`
  - `cancelled`
- `running`은 현재 active round가 존재하거나, 다음 round dispatch 준비가 진행 중인 coarse meeting state를 뜻한다.
- `completed`는 계획된 라운드와 final summary가 정상 종료된 경우를 뜻한다.
- `partial_completed`는 하나 이상의 participant 또는 summarizer가 timeout/skip/failure 상태였지만 operator가 계속 진행해 usable final summary를 만든 경우를 뜻한다.
- `agenda`
- `reference_path`
  - nullable string
  - Office composer가 보내는 단일 정규화 경로와 같은 형식
- `project_id`
- `goal_id`
- `billing_code`
- `max_discussion_rounds`
  - `discussion` + `followup` round 개수만 센다
  - `opening`과 `summary` round는 포함하지 않는다
- `response_timeout_sec`
- `auto_start`
- `auto_continue`
- `current_round_number`
- `current_round_number`는 round가 `pending -> dispatching`으로 열릴 때 해당 round number로 갱신한다.
- 회의가 종료될 때는 마지막 active round number를 유지하고, 현재 phase는 active round의 `kind/status`에서 파생한다.
- `last_operator_signal_comment_id`
- `last_operator_signal_comment_id`는 생성 시 `null`이며, meeting이 `awaiting_operator` 또는 `failed`로 들어갈 때 최근 signal comment id로 갱신한다.
- operator action으로 문제가 해소되어 `running/completed/cancelled`로 복귀하면 다시 `null`로 초기화한다.
- `transition_version`
  - integer
  - default `0`
  - meeting-level 상태 전이가 성공할 때마다 `+1`
  - CAS update의 비교 기준
- `last_round_completed_at`
- `completed_at`

meeting-level canonical source는 아래처럼 나눈다.

- 회의 전체 라이프사이클: `issue_meetings.status`
- 현재 어느 단계인지: active `issue_meeting_rounds.kind/status`
- operator에게 보여줄 최근 개입 사유: `last_operator_signal_comment_id`
- traceability metadata (`project_id`, `goal_id`, `billing_code`): `issue_meetings.*`를 canonical snapshot으로 두고, root issue와 child issue는 read-only mirrored copy로 취급한다.
- V1에서는 이 metadata를 회의 생성 후 generic issue 편집 경로로 바꾸지 않는다. 향후 수정이 필요하면 dedicated meeting metadata update API가 root + meeting row + child mirror를 한 transaction에서 동기화해야 한다.

즉, 별도 `operator_attention_state`는 두지 않고 root issue signal comment와 meeting status에서 UI를 파생한다.

### 6.1.1 meeting 상태 전이 규칙

- `draft -> running`
  - manual start 또는 `auto_start`에 의해 opening round가 처음 dispatch될 때
- `running -> awaiting_operator`
  - active round가 `awaiting_operator` 또는 `timed_out`으로 들어가거나, blocked/failed participant 때문에 human decision이 필요해질 때
- `awaiting_operator -> running`
  - operator가 remind/skip/continue/summary action으로 회의를 다시 진행시킬 때
- `running|awaiting_operator -> completed`
  - current `summary` round가 `completed`가 되었고, bypass된 participant/summarizer failure 없이 정상 종료됐을 때
- `running|awaiting_operator -> partial_completed`
  - current `summary` round가 `completed`가 되었지만, 그 전에 `timed_out|blocked|skipped|failed|late` participant 또는 summary failure bypass가 있었을 때
- `running|awaiting_operator -> paused`
  - operator가 pause를 요청했을 때
- `paused -> running|awaiting_operator`
  - operator가 resume을 요청했을 때
  - resume 직후 current round 상태를 다시 읽어, round가 `awaiting_operator` 성격이면 meeting도 다시 `awaiting_operator`로 복귀시킨다.
- `* -> failed`
  - recovery 범위를 넘는 오케스트레이터 오류가 발생했을 때
- `* -> cancelled`
  - operator가 회의를 취소했을 때

### 6.2 `issue_meeting_participants`

회의 참가자 멤버십과 하위 이슈 연결.

- `id`
- `company_id`
- `meeting_id`
- `agent_id`
- `child_issue_id`
- `is_facilitator`
- `is_summarizer`
- `speaking_order`
- `status`
  - `active`
  - `removed`
- `joined_at`
- `removed_at`

participant row는 회의 생성 시점부터 `active`로 만든다. `status`가 participant 활성 여부의 canonical source이며, V1에서는 별도 `is_active_participant` boolean이나 `declined/invited` 상태를 두지 않는다.

### 6.3 `issue_meeting_rounds`

라운드 진행 상태.

- `id`
- `company_id`
- `meeting_id`
- `round_number`
- `kind`
  - `opening`
  - `discussion`
  - `summary`
  - `followup`
- `status`
  - `pending`
  - `dispatching`
  - `collecting`
  - `awaiting_operator`
  - `summarizing`
  - `completed`
  - `timed_out`
  - `cancelled`
  - `failed`
- `round_open_root_comment_id`
- `round_open_root_comment_id`는 `opening|discussion|followup` round가 `pending -> dispatching`으로 열릴 때 root issue에 기록되는 `round_opened` system marker를 가리킨다.
- `summary` round에서는 기본적으로 별도 root open marker를 만들지 않으므로 `null`일 수 있다.
- `round_summary_comment_id`
- `round_summary_comment_id`는 `opening|discussion|followup` round의 mechanical summary projection comment id다.
- `summary` round의 최종 산출물은 summarizer child issue comment이므로 이 필드는 기본적으로 `null`이다.
- `summary_requested_by_user_id`
- `summary_requested_by_user_id`는 operator가 `/meeting/summary` 또는 `/meeting/continue`로 요약 단계를 명시 요청했을 때의 user id다.
- auto-continue 또는 automatic transition으로 summary round가 열린 경우는 `null`이다.
- 이 필드는 round branching의 canonical source가 아니라 audit discriminator다. 즉, "이 summary/finalization이 operator 명시 요청이었는지 자동 전이였는지"를 구분하는 용도로만 쓴다.
- `dispatch_recovery_pass_count`
- `started_at`
- `deadline_at`
- `completed_at`
- `transition_version`
  - integer
  - default `0`
  - round-level 상태 전이가 성공할 때마다 `+1`
  - CAS update의 비교 기준

### 6.3.1 round 상태 전이 규칙

- `pending -> dispatching`
  - 해당 round가 현재 active round로 선택되고, round-participant dispatch 준비가 끝났을 때
- `dispatching -> collecting`
  - system-authored dispatch prompt comment insert와 wakeup enqueue가 모두 끝났을 때
- `dispatching -> dispatching`
  - orphan recovery sweep가 `status = pending_dispatch`이고 `dispatch_wakeup_request_id`와 `dispatch_run_id`가 모두 비어 있는 participant row만 idempotent 재-dispatch할 때
- `collecting -> summarizing`
  - 모든 active participant가 응답했거나, operator가 missing participant를 skip하고 계속 진행하기로 결정했을 때
- `collecting -> awaiting_operator`
  - deadline이 지났는데 응답이 일부만 왔거나, participant failure로 human decision이 필요할 때
- `collecting -> timed_out`
  - deadline이 지났고 usable participant response가 0개일 때
  - V1에서 usable response는 `issue_meeting_round_participants.status = responded`인 participant가 1명 이상 존재하는지로만 판정한다.
- `timed_out -> dispatching`
  - operator가 `remind/retry`로 0-response timeout round를 다시 dispatch하기로 결정했을 때
  - 이 경우 해당 participant row는 `timed_out|failed|blocked|skipped -> pending_dispatch`로 되돌린 뒤 기존 dispatch -> collecting 흐름을 다시 탄다
  - 같은 transaction 안에서 meeting status도 `awaiting_operator -> running`으로 복귀시킨다
- `awaiting_operator -> collecting`
  - operator가 remind/retry로 같은 round를 다시 수집하기로 했을 때
- `awaiting_operator -> summarizing`
  - operator가 partial proceed 또는 `최종 요약만 요청`을 선택했을 때
- `summarizing -> completed`
  - round summary 또는 final summary comment가 정상 저장됐을 때
- `summarizing -> awaiting_operator`
  - summary agent가 timeout/failure로 결론을 못 냈을 때
- `dispatching -> awaiting_operator`
  - 재시도 한도 내에서도 dispatch enqueue를 확정하지 못했을 때
- `* -> failed`
  - recovery 가능한 범위를 넘는 persistence/orchestrator 오류가 발생했을 때
- `* -> cancelled`
  - operator가 회의를 취소했을 때

회의 pause는 round status를 따로 바꾸지 않고, `issue_meetings.status = paused`로만 표현한다. resume 시에는 직전 round status에서 다시 진행한다.

meeting status 매핑:

- active round가 `opening`이면 meeting은 `running`
- active round가 `discussion` 또는 `followup`이면 meeting은 `running`
- active round가 `summary`이면 meeting은 `running`
- active round가 `timed_out`으로 기록되면 meeting은 즉시 `awaiting_operator`로 승격된다
- operator 개입이 필요하면 meeting은 `awaiting_operator`
- followup round를 추가해도 meeting status는 새 상태를 만들지 않고 계속 `running`으로 둔다

### 6.4 `issue_meeting_round_participants`

라운드별 참가자 실행 상태의 canonical record.

기본 규칙:

- `opening|discussion|followup` round는 active participant 전원에 대해 row를 만든다.
- `summary` round는 시작 시 summarizer participant 1명에 대해 active row 1개를 만든다.
- summarizer 교체가 일어나면 historical row는 남기되, final summary 완료 판정은 그 시점의 active summary row 1개만 기준으로 본다.

- `id`
- `company_id`
- `meeting_id`
- `round_id`
- `participant_id`
- `agent_id`
- `child_issue_id`
- `status`
  - `pending_dispatch`
  - `queued`
  - `deferred`
  - `coalesced`
  - `running`
  - `responded`
  - `timed_out`
  - `blocked`
  - `skipped`
  - `failed`
  - `late`
- `dispatch_prompt_comment_id`
- `dispatch_wakeup_request_id`
- `dispatch_wakeup_status`
  - raw `agent_wakeup_requests.status`
- `dispatch_attempt_count`
- `dispatch_run_id`
- `response_comment_id`
- `response_run_id`
- `reminded_count`
- `dispatched_at`
- `deadline_at`
- `responded_at`
- `timed_out_at`
- `skipped_at`
- `late_response_comment_id`
- `skip_reason`
- `failure_reason`
- `last_error_code`

`response_comment_id`는 round completion을 처음 만족시킨 canonical 첫 agent comment를 가리킨다. round close 전 같은 participant가 추가 comment를 더 남겨도 이 필드는 덮어쓰지 않으며, transcript projection은 이들을 별도 `participant_response_extra` entry로 함께 보여준다.
`late_response_comment_id`는 round close 뒤 non-responded participant의 첫 late response comment만 가리킨다. 이후 late comment가 더 들어와도 이 필드는 덮어쓰지 않으며, 추가 late comment는 debug/audit 전용 raw comment로만 남긴다.

### 6.4.1 round-participant 상태 전이 규칙

- `pending_dispatch -> queued`
  - wakeup request가 새로 `queued`로 만들어졌을 때
- `pending_dispatch -> coalesced`
  - 동일 child issue의 기존 live run으로 합쳐졌을 때
- `pending_dispatch -> deferred`
  - issue execution lock 때문에 `deferred_issue_execution` wakeup request가 생겼을 때
- `pending_dispatch -> blocked`
  - budget block, paused agent, pending approval 같은 conflict로 이번 dispatch가 실행 불가일 때
- `pending_dispatch -> skipped`
  - wakeOnDemand disabled 등으로 실행 자체가 생략될 때
- `queued|coalesced|deferred -> running`
  - heartbeat run start가 확인되거나, active run이 이 participant dispatch에 연결됐을 때
- `queued|coalesced|deferred|running -> responded`
  - round dispatch 이후 첫 agent-authored comment 또는 성공적인 run 결과 comment가 기록됐을 때
- `queued|coalesced|deferred|running -> timed_out`
  - deadline이 지났는데 usable response가 없을 때
- `timed_out|failed|blocked|skipped -> pending_dispatch`
  - operator가 remind/retry로 같은 participant를 다시 dispatch하기로 결정했을 때
  - summary round에서 같은 summarizer를 다시 재촉할 때도 같은 전이를 사용한다
  - `dispatch_attempt_count`가 participant-local 한도 미만일 때만 허용한다
- `timed_out|blocked|skipped|failed -> late`
  - round close 뒤 non-responded participant의 첫 agent comment가 도착했을 때
- `* -> failed`
  - run 실패 또는 recovery 불가 persistence 오류로 operator 개입이 필요할 때

`dispatch_wakeup_status`는 heartbeat의 raw outcome을 보존하고, `status`는 회의 오케스트레이터가 보는 canonical execution 상태로 사용한다.
active participant가 `blocked`에 들어가면 round는 즉시 `awaiting_operator` 후보가 된다. V1에서는 budget/paused/conflict를 자동 회복 기다리지 않고 operator가 판단하게 한다.
반복 `skipped` 또는 반복 `failed`도 round를 `awaiting_operator` 후보로 만든다.
summary round active slot 제약에서 말하는 active status는 `pending_dispatch|queued|deferred|coalesced|running|responded`를 뜻한다. `timed_out|blocked|skipped|failed|late`는 terminal status로 본다.

### 6.5 회의 테이블 불변식과 제약

- 모든 meeting 관련 테이블은 `company_id`를 가진다.
- `issue_meetings.root_issue_id`는 unique다.
- `issue_meeting_participants (meeting_id, agent_id)`는 unique다.
- `issue_meeting_participants (meeting_id, child_issue_id)`는 unique다.
- `issue_meeting_rounds (meeting_id, round_number)`는 unique다.
- `issue_meeting_round_participants (round_id, participant_id)`는 unique다.
- `issue_meeting_round_participants.dispatch_wakeup_request_id`는 `agent_wakeup_requests.id`를 참조한다.
- `issue_meeting_round_participants.dispatch_run_id`와 `response_run_id`는 `heartbeat_runs.id`를 참조한다.
- facilitator와 summarizer는 single `role` enum이 아니라 boolean capability로 표현해, 한 agent가 `participant + facilitator + summarizer`를 동시에 가질 수 있게 한다.
- 정확히 1명의 facilitator, 최대 1명의 summarizer는 schema partial unique index 또는 service-level validation으로 보장한다.
- 회의 생성/시작 시 active participant는 최소 2명이어야 한다.
- 이후 operator 제거 등으로 active participant가 1명으로 줄어들면, 새 discussion/followup round는 열지 않고 summary 또는 cancel만 허용한다.
- summary round에서는 historical row가 여러 개 남을 수 있어도, 동시에 active status인 round-participant row는 최대 1개여야 한다.
- "현재 열려 있는 라운드는 회의당 1개"라는 규칙은 transaction lock + compare-and-set으로 보장한다.

### 6.6 이 계획에서 의도적으로 추가하지 않는 것

- 별도 chat message table
- 회의 전용 freeform thread table
- 참가자별 utterance table

실제 발화 기록은 여전히 `issue_comments`를 쓴다.

### 6.7 comment author model 보강

현재 `issue_comments`는 agent/user author만 표현하므로, 회의 오케스트레이터에는 아래 확장이 필요하다.

- `author_kind`
  - `agent`
  - `user`
  - `system`
- `author_system_key`
  - 예: `meeting_orchestrator`
- `system_comment_kind`
  - `round_opened`
  - `round_closed`
  - `round_summary`
  - `operator_attention`
  - `meeting_completed`
  - `control_notice`

UI는 `system` comment를 `"회의 진행 시스템"`으로 렌더링한다.

이 모델은 아래 유형의 visible root comment에 필요하다.

- round opened / round closed marker
- round summary projection
- timeout / partial proceed / late response notice
- operator action required signal

### 6.8 comment author invariant, backfill, unread 규칙

`issue_comments` author 계약은 아래처럼 닫는다.

- `agent` comment:
  - `author_kind = agent`
  - `author_agent_id != null`
  - `author_user_id = null`
  - `author_system_key = null`
  - `system_comment_kind = null`
- `user` comment:
  - `author_kind = user`
  - `author_user_id != null`
  - `author_agent_id = null`
  - `author_system_key = null`
  - `system_comment_kind = null`
- `system` comment:
  - `author_kind = system`
  - `author_system_key != null`
  - `author_agent_id = null`
  - `author_user_id = null`
  - `system_comment_kind != null`

즉, 세 author 종류는 항상 상호배타적이며, DB check constraint와 service validation 둘 다로 보장한다.

마이그레이션 backfill 규칙:

- 기존 row에서 `author_agent_id`가 있으면 `author_kind = agent`
- 기존 row에서 `author_user_id`가 있으면 `author_kind = user`
- 두 값이 모두 null인 legacy row가 있다면 `author_kind = system`, `author_system_key = legacy_unknown`으로 임시 백필하고, migration report에서 별도 계수한다.
- 정상 운영 데이터에서는 "둘 다 null" row가 없어야 하므로, backfill 결과가 0이 아닌 경우 구현 착수 전 샘플 점검이 필요하다.

unread / read-context 규칙:

- `myLastCommentAt`은 계속해서 "현재 사용자 자신이 남긴 `user` comment의 마지막 시각"만 의미한다.
- `lastExternalCommentAt`은 현재 사용자 외부에서 생성된 `agent` comment와, notification-grade visible `system` comment만 포함한다.
- notification-grade `system` comment는 `system_comment_kind in ("round_summary", "operator_attention", "meeting_completed")`만 포함한다.
- low-signal marker 성격의 `round_opened`, `round_closed`, `control_notice` 같은 system comment는 recency projection 전용으로만 쓰고 unread/reply signal에는 포함하지 않는다.
- hidden child issue 안의 system prompt/comment는 hidden issue에만 머무르므로 inbox surface에는 직접 영향을 주지 않는다.
- `system` comment도 `issue.updatedAt`과 root issue recency를 갱신한다.

따라서 `IssueComment` shared type, unread aggregation, comment rendering은 모두 `authorKind` 기준으로 분기하도록 바꾼다.

## 7. 회의 생성 시 실제 객체 구조

애드센스 예시로 보면 아래처럼 된다.

- 루트 이슈
  - 제목: `[전체회의] 애드센스 승인 전략`
  - assignee: 없음
  - visible: true
- 하위 이슈 1
  - 제목: `[회의][CEO] 애드센스 승인 전략 응답`
  - assignee: `CEO`
  - status: `backlog`로 생성 후, 실제 round dispatch 시점에만 wakeup 가능 상태로 전이
  - parent: 루트 이슈
  - hidden: true (`issues.hiddenAt` 재사용, 새 hidden 컬럼 추가 없음)
- 하위 이슈 2
  - 제목: `[회의][CTO] 애드센스 승인 전략 응답`
  - assignee: `CTO`
  - status: `backlog`
  - parent: 루트 이슈
  - hidden: true
- 하위 이슈 3
  - 제목: `[회의][CMO] 애드센스 승인 전략 응답`
  - assignee: `CMO`
  - status: `backlog`
  - parent: 루트 이슈
  - hidden: true

사용자는 루트 이슈만 회의방처럼 보게 하고, 시스템은 숨김 하위 이슈로 participant work를 관리한다.

루트 회의 이슈의 canonical ownership 규칙:

- `createdByUserId`는 회의 생성 사용자 추적용이다.
- `assigneeUserId`는 기본적으로 비워 둔다.
- `issue_meetings`는 생성자 user id를 별도 중복 저장하지 않고, canonical source는 root issue의 `createdByUserId`로 둔다.
- 즉, "생성자"와 "담당자"를 같은 개념으로 취급하지 않는다.

루트 회의 이슈의 structural invariant:

- orchestrated meeting의 root issue는 unassigned visible container로 유지한다.
- generic issue 편집 경로(`PATCH /issues/:id`, 일반 `IssueProperties`)는 root meeting issue에 대해 `assigneeAgentId`, `assigneeUserId`, `status`, `hiddenAt`, `parentId`, `projectId`, `goalId`, `billingCode` 변경을 허용하지 않는다.
- generic lifecycle 경로도 root meeting issue에는 적용하지 않는다.
  - `POST /issues/:id/checkout`
  - `POST /issues/:id/release`
  - `POST /issues/:id/comments` with `reopen = true`
  - `DELETE /issues/:id`
- 루트 meeting lifecycle 변경은 meeting control endpoint가 유일한 진입점이다.
- UI도 root orchestrated meeting에서는 일반 assignee/status/hidden/project/goal/billing 편집 컨트롤을 숨기거나 read-only로 렌더링한다.

### 7.1 child issue 생성과 상속 규칙

회의 child issue는 `parentId`만으로 충분하지 않다. 현재 issue create는 project/goal/billing을 자동 상속하지 않으므로 아래를 명시적으로 복사해야 한다.

- `projectId`
- `goalId`
- `billingCode`
- `projectWorkspaceId`
- `inheritExecutionWorkspaceFromIssueId = root_issue_id`

즉, child issue는 "루트 회의 이슈의 traceability를 이어받은 숨김 작업 단위"여야 한다.

`billing_code`는 `issue_meetings.billing_code`를 canonical source로 두고, child issue의 `billingCode`는 실행/비용 집계를 위한 mirrored copy로만 사용한다.

### 7.2 내부 생성 순서

회의 생성은 public issue create route를 연달아 호출하는 방식이 아니라, internal meeting service transaction으로 처리한다.

1. root issue를 생성한다.
2. child issue를 기존 `issues.hiddenAt`을 사용한 `hidden + backlog` 상태로 insert한다.
3. meeting / participant / first round row를 만든다.
4. child issue용 round prompt comment를 transaction 안에서 system-authored row로 insert한다. 이 단계에서는 wakeup을 일으키지 않는다.
5. transaction commit 이후에만 실제 dispatch와 wakeup을 실행한다.

이 순서를 지키면 child issue가 잠깐 visible해지거나, prompt 없이 먼저 실행되는 상황을 피할 수 있다.

중요한 구현 전제:

- 현재 `issueService.create()`는 자체 `db.transaction()`을 열고, `addComment()`는 tx-aware helper가 아니라 global `db`를 직접 쓴다.
- 따라서 orchestrated meeting 구현 전 Phase A에서 `createIssueInTx`, `addIssueCommentInTx` 수준의 tx-aware 내부 helper 또는 `meetingIssueStore`를 먼저 분리해야 한다.
- meeting service는 public route helper를 중첩 호출하지 않고, 이 tx-aware 내부 helper만 사용한다.

### 7.3 child issue runtime status lifecycle

- 회의 생성 시: `backlog`
- round dispatch 직전: `todo`
- agent가 실제 checkout하여 실행 중일 때: 기존 issue semantics에 따라 `in_progress`
- round 응답이 수집되고 다음 round를 기다릴 때: `in_review`
- dispatch가 `blocked` 또는 `skipped`로 끝난 participant child issue는 해당 round 동안 `todo`에 머무른다. 실제 실행이 없었으므로 `in_progress`나 `in_review`로 올리지 않는다.
- 추가 round가 열리면 hidden child issue는 `in_review -> in_progress` 실행 사이클을 반복한다
- 회의가 정상 종료되면: `done`
- 회의 취소 또는 participant 제거로 더 이상 쓰지 않게 되면: `cancelled`

즉, child issue는 hidden이지만 V1 issue 상태 머신(`backlog -> todo -> in_progress -> in_review -> done/cancelled`)을 가능한 한 그대로 따른다.

## 8. 라운드 오케스트레이션 설계

### 8.1 Round 1: 독립 의견 수집

오케스트레이터가 현재 round row와 round-participant row를 먼저 만들고, 각 참가자 하위 이슈에 아래 정보를 남긴다.

- 회의 안건
- 프로젝트/경로 컨텍스트
- 참가자 목록
- "다른 사람 의견을 보지 말고 먼저 독립적으로 답하라"는 지시
- 역할 관점 체크리스트
- 이 dispatch prompt comment 자체는 `author_kind = system`이며, 응답 완료 판정 대상에서 제외한다.

예시:

- CEO: 전략, 우선순위, 사업성
- CTO: 기술 구조, 정책/구현 리스크
- CMO: 콘텐츠, 카피, 신뢰 신호, 광고 친화성

이후 `issue_meeting_round_participants` 중 아직 `pending_dispatch`인 row만 CAS로 선점해 병렬 wakeup 한다.

응답 완료 판정:

- 해당 participant의 child issue에 round dispatch 이후 첫 agent-authored comment가 생김
- 또는 dispatch run 결과로 comment가 추가됨
- 사용자 comment나 system note는 자동 응답 완료로 취급하지 않는다.

### 8.2 Round 1 수집 완료 후 루트 요약

오케스트레이터는 참가자 응답을 모아 루트 회의 이슈에 system-authored round summary comment를 남긴다.

V1에서 이 round summary는 자유 합성형 LLM 답변이 아니라, system projection이다.

- participant별 canonical response excerpt
- 직접 관찰된 겹침/차이만 정리한 짧은 합의/충돌 메모
- 다음 round에 넣을 표준화된 질문 패킷

요약 내용:

- 참가자별 핵심 주장 1~3개
- 공통 합의 지점
- 충돌 지점
- 다음 라운드 질문

### 8.3 Round 2: 상호 토론

각 참가자 하위 이슈에 아래 패킷을 다시 보낸다.

- 전체 참가자 Round 1 요약
- 자신의 이전 입장
- 동의/반대/보완이 필요한 포인트
- 이번 라운드에서는 "타인의 의견에 반응"하라는 지시

예시 지시:

- 어떤 의견에 동의하는가
- 어떤 의견이 위험하거나 과한가
- 지금 바로 실행 가능한 절충안은 무엇인가

그 후 다시 참가자 전원을 병렬 wakeup 한다.

timeout, partial proceed, late response는 모두 `issue_meeting_round_participants` 기준으로 계산한다.

### 8.4 Final: 사회자 또는 요약자의 결론

Round 2 수집이 끝나면 요약자 participant의 child issue에 final summary prompt를 보낸다.

기본 요약자:

- 사회자

대안:

- 명시적으로 지정된 `summary_agent_id`

V1에서는 `summary_agent_id`도 participant 중 한 명이어야 하므로, final summary를 위한 별도 summarizer child issue는 만들지 않는다.
요약자 교체나 재시도는 새 `summary` round를 추가로 만드는 대신, 현재 `kind = summary` round를 재사용해 처리한다.
동일 meeting 안에 summary round가 여러 개 생기는 경우는 operator가 explicit followup discussion round를 연 뒤, 그 후속 finalization pass를 다시 시작했을 때뿐이다.

summary round 재시도 시 row 재사용 규칙:

- summary round에는 동시에 active한 summarizer row가 최대 1개만 존재한다.
- 같은 summarizer를 다시 재촉하면 기존 row를 재사용하고 `dispatch_attempt_count`, deadline, dispatch 관련 포인터만 최신 값으로 갱신한다.
- summarizer를 다른 active participant로 교체할 때는 기존 row를 덮어쓰지 않고, 새 summarizer용 row를 추가한다.
- 이전 summarizer row는 `failed|timed_out|skipped` 같은 terminal 상태로 남아 summary round의 canonical history를 보존한다.
- service-level validation은 "summary round 안에 동시에 active status인 row는 최대 1개"만 보장한다.
- summarizer가 `A -> B -> A`로 다시 돌아오는 경우는 `(round_id, participant_id)` unique를 유지한 채, 기존 A row를 `timed_out|failed|blocked|skipped -> pending_dispatch`로 재활성화해 처리한다.
- 즉, "summary round 1개 + active summarizer slot 1개 + historical attempt rows 보존" 규칙을 유지한다.

최종 산출물의 canonical 저장 위치는 summarizer participant의 child issue다.

- summarizer agent는 자신의 child issue에 agent-authored final summary comment를 남긴다.
- `meetingTranscriptProjection`은 이 child issue comment를 root meeting room의 final summary block으로 투영한다.
- root issue raw comment stream에는 전체 본문을 agent 이름으로 cross-post하지 않는다.
- 대신 meeting status가 `completed` 또는 `partial_completed`로 전이될 때는 root issue에 `meeting_completed` system comment를 항상 1회 남긴다.

형식:

- 권장 결론
- 이유
- 반대 의견 / 남은 리스크
- 바로 실행할 액션 3~5개
- 필요하면 새 이슈 생성 제안

## 9. 회의 진행 제어

회의는 완전 자동으로 끝까지 흘려보내지 않는다.
사람이 개입할 수 있는 제어점을 둔다.

필수 제어:

- `회의 시작`
- `현재 라운드 상태 보기`
- `미응답 포함하고 다음 라운드 진행`
- `참가자 재촉`
- `특정 참가자 제외 후 계속`
- `회의 일시중지`
- `회의 재개`
- `회의 취소`
- `최종 요약만 요청`
- `추가 라운드 1회 더`

권장 기본값:

- Round 1 auto start
- Round 2 auto continue only when 모든 active participant가 deadline 전에 응답함
- Final summary는 자동 또는 버튼 기반 선택 가능

응답이 일부만 온 상태에서 deadline이 지나면 기본값은 `awaiting_operator`로 보내고, partial continue는 operator가 명시적으로 눌렀을 때만 진행한다.
응답이 0건인 timeout도 timeout marker를 남긴 직후 `awaiting_operator`로 승격해, operator가 `재촉` 또는 `중단`을 선택할 수 있게 한다.

`추가 라운드 1회 더`는 남아 있는 `max_discussion_rounds` 예산 안에서만 허용된다.

## 10. UI 계획

### 10.1 오피스 회의 생성기

현재 `전체회의` composer를 아래 기준으로 확장한다.

- 참가자 multi-select
  - 최소 2명 필수
- 사회자 선택
  - 기본값 자동
  - 고급 옵션으로 override
- 프로젝트
- 참고 경로
- 안건
- 회의 옵션
  - 응답 timeout
  - 토론 라운드 수
  - 자동 시작 여부
  - 자동 진행 여부
  - 요약자

send summary에는 아래가 반드시 보인다.

- 회의 방식
- 사회자
- 참가자
- 프로젝트
- 경로
- 토론 라운드 수
- timeout

### 10.2 회의방 UI

루트 회의 이슈를 전용 meeting room처럼 렌더링한다.

이 화면은 raw `GET /issues/:id/comments`를 직접 이어 붙여 만들지 않고, 오케스트레이터가 제공하는 `MeetingRoomDTO`를 기준으로 렌더링한다.

상단 영역:

- 안건
- 상태 badge
- Round indicator
- 참가자 status chips
- 비용/실행 수 요약

본문 transcript:

- Round header
- 참가자별 발화
- system round summary
- final summary

정렬 규칙:

- round open/system marker가 먼저 나온다.
- 같은 round 안의 participant 발화는 `responded_at` 오름차순으로 정렬한다.
- `responded_at`이 같으면 `speaking_order`로 tie-break 한다.
- round summary / final summary는 해당 round의 마지막에 나온다.
- late response는 원래 round 중간에 끼워 넣지 않고, 별도 late-response block으로 표시한다.

우측 패널:

- 누가 응답 완료했는지
- 누가 아직 대기 중인지
- 마지막 응답 시각
- 수동 제어 버튼
- `추가 라운드 1회 더` 버튼은 남은 discussion/followup budget이 없으면 비활성화한다.

`MeetingRoomDTO`의 최소 transcript shape:

- `meeting`
  - id, status, currentRoundNumber, currentRoundKind, needsAttention
- `rootIssue`
  - id, title, projectId, goalId
- `participants`
  - agentId, role flags, speakingOrder, status, childIssueId
- `rounds`
  - roundNumber, kind, status, deadlineAt, completedAt
- `transcript`
  - `entryKind`
    - `round_opened`
    - `participant_response`
    - `participant_response_extra`
    - `round_summary`
    - `final_summary`
    - `late_response`
    - `operator_signal`
    - `meeting_completed`
  - `roundNumber`
  - `roundKind`
  - `participantAgentId`
  - `sourceIssueId`
  - `sourceCommentId`
  - `authorKind`
  - `body`
  - `createdAt`
  - `respondedAt`
  - `speakingOrder`

entry 모델 규칙:

- transcript는 comment-level projection이다.
- canonical 첫 응답 comment는 `participant_response` entry 1개를 만든다.
- 같은 participant가 round close 전 추가로 남긴 comment는 입력 순서대로 `participant_response_extra` entry를 추가한다.
- non-responded participant의 첫 late comment만, meeting이 아직 종료되지 않은 경우에 한해 `late_response` entry로 투영한다.
- meeting이 이미 `completed|partial_completed|cancelled`로 종료된 뒤 도착한 late response는 main transcript에 추가하지 않고 debug/audit 전용 raw comment로만 남긴다.
- final summary completion 시 root-visible `meeting_completed` system entry를 항상 마지막에 추가한다.

UI는 orchestrated meeting에서 이 DTO만 사용하고, raw root issue comment stream은 debug/audit 보조 용도로만 남긴다.

### 10.3 일반 이슈와의 구분

- 루트 회의 이슈는 일반 이슈 목록에서 보여도 괜찮다.
- 참가자 하위 이슈는 기본 목록과 받은 편지함에서 숨긴다.
- 디버깅이나 감사용으로만 raw child issue 링크를 제공한다.
- 현재 `issues.list()`는 기본적으로 `hiddenAt IS NULL`만 반환하므로, hidden child issue는 기존 기본 목록 API 동작을 그대로 재사용해 숨긴다.
- root meeting issue는 기존 issue list/filter와 공존해야 하므로, `issues.status`를 meeting lifecycle의 coarse mirror로 유지한다.
- 권장 mirror 규칙:
  - `meeting.status = draft` -> `issues.status = backlog`
  - `meeting.status = running` -> `issues.status = in_progress`
  - `meeting.status = awaiting_operator|paused|failed` -> `issues.status = blocked`
  - `meeting.status = completed|partial_completed` -> `issues.status = done`
  - `meeting.status = cancelled` -> `issues.status = cancelled`
- 위 mapping은 기존 `IssueStatus` enum 값만 사용하며, `blocked`는 새 status를 추가하는 것이 아니라 이미 존재하는 generic issue status를 재사용한다.
- 즉, generic issue list/count/filter는 계속 `issues.status`를 쓰되, root meeting issue의 status는 orchestrator가 내부 helper로 동기화한다.
- 이 `issues.status` mirror 갱신은 meeting status 전이와 같은 transaction 안에서 중앙 helper가 함께 처리한다. 즉, `issue_meetings.status`와 root `issues.status`는 commit 시점에 서로 어긋난 intermediate 상태를 남기지 않는다.
- 루트 회의 이슈는 unassigned일 수 있으므로, Inbox/Office 진입은 `assigneeAgentId` 기반 direct conversation path가 아니라 `issueId` 또는 `meetingId` 기반 meeting room path를 별도로 써야 한다.
- 다만 "미할당 업무 triage" 성격의 전용 화면(`MyIssues` 류)에서는 `meetingMode = orchestrated` root issue를 기본 제외한다. 이 화면은 실제 배정이 필요한 작업을 위한 것이고, root meeting issue는 회의 container이기 때문이다.
- `Issue` payload에는 nullable `meetingId`와 `meetingMode`를 추가해, V2 orchestrated meeting root issue를 description 문구 파싱 없이 식별할 수 있게 한다.
- migration 기간 동안 server가 `meetingMode`를 계산해 내려준다.
- `meetingMode === "orchestrated"`면 새 meeting row 기반 V2, `meetingMode === "legacy_thread"`면 기존 description/metadata matcher 기반 V1이다.
- 즉, legacy 분류 fallback은 서버 내부 구현으로만 남기고, UI가 description을 직접 파싱하지 않게 한다.

## 11. 서버 오케스트레이터 설계

새 서비스:

- `meetingOrchestratorService`
- `meetingPromptBuilder`
- `meetingTranscriptProjection`
- `meetingRoundPlanner`

핵심 책임:

- 회의 생성
- 하위 이슈 생성
- 라운드 상태 전이
- wakeup fan-out
- 응답 수집
- timeout / remind / partial proceed
- root issue summary comment 생성

실행 방식:

- comment/run completion 기반 event-driven advance
- 주기적 sweep으로 timeout과 orphaned round 복구

이 서비스는 heartbeat scheduler와 비슷한 성격이지만, 개별 에이전트 실행이 아니라 회의 state machine을 관리한다.

`meetingPromptBuilder`는 child issue prompt와 root issue visible summary/control comment를 구분해 만든다.

### 11.0 meeting participant comment surface 정책

V1의 회사 내부 visibility 계약은 유지한다. 즉, orchestrated meeting 도입이 "같은 회사 board와 agent의 full visibility" 계약 자체를 깨는 권한 변경이 되어서는 안 된다.

따라서 V1에서 meeting participant isolation은 hard ACL이 아니라, "오케스트레이터가 신뢰하는 canonical comment surface"와 projection 규칙으로 다룬다.

- active participant agent에게 공식적으로 dispatch되는 실행 surface는 자기 자신의 child issue뿐이다.
- meeting prompt도 자기 child issue 기준으로만 전달한다.
- root meeting issue와 sibling child issue는 "권한상 완전 차단"이 아니라, 오케스트레이터가 canonical response source로 인정하지 않는 non-canonical surface로 취급한다.
- board/user comment는 root meeting issue에서 계속 허용된다.

정책 위반 처리:

- V1 범위에서는 orchestrated meeting만을 위한 별도 company-internal ACL 축소를 도입하지 않는다.
- 대신 participant의 round completion, timeout, late response 판정은 오직 자기 child issue의 designated round window 안에서 발생한 canonical comment만 본다.
- 구버전 클라이언트나 수동 조작으로 root/sibling/out-of-band comment가 이미 들어온 경우, 오케스트레이터는 이를 round advancement와 main transcript projection에서 제외한다.
- 이러한 comment는 debug/audit 용도로만 남기고 `meeting.policy_violation_comment` activity로 기록한다.

### 11.1 전이는 단일 `advanceMeeting()` 경로로만 일어난다

- comment 수신
- run completion
- timeout sweep
- operator action

위 이벤트는 모두 `advanceMeeting(meetingId, trigger)` 하나로 들어간다.

`trigger` 최소 타입:

- `meeting_created_auto_start`
- `participant_comment_received`
- `participant_run_completed`
- `timeout_sweep`
- `dispatch_recovery_sweep`
- `startup_recovery_sweep`
- `operator_action`

`advanceMeeting()`은 transaction 안에서 아래 row를 lock하고 진행한다.

- `issue_meetings`
- current `issue_meeting_rounds`
- affected `issue_meeting_round_participants`

전이는 항상 "현재 status가 예상값일 때만 update"하는 compare-and-set 방식으로 한다.
`transition_version`은 정수 카운터이며, CAS update 성공 시마다 `+1` 된다.

오케스트레이터 내부에서 생성하는 root/child system comment도 동일한 규칙을 따른다.

- comment row insert와 meeting/round 상태 update는 같은 transaction 안에서 기록한다.
- 실제 wakeup enqueue, 후속 prompt fan-out, 외부 side-effect는 commit 이후에만 수행한다.
- 즉, `advanceMeeting()` 전반도 회의 생성 트랜잭션과 같은 "DB 기록 먼저, wakeup 나중" 패턴을 유지한다.

### 11.2 idempotency와 duplicate 방지 규칙

- round summary는 `round_summary_comment_id IS NULL`일 때만 생성한다.
- `meeting_completed` system comment는 meeting이 `completed|partial_completed`로 처음 들어갈 때만 1회 생성한다.
- participant dispatch는 아직 `pending_dispatch`인 row만 CAS로 선점해 실제 wakeup하며, 그 결과는 `queued/coalesced/deferred/blocked/skipped` 중 하나로 기록한다.
- sweep와 event-driven path는 같은 transition helper를 호출하므로, 동시에 들어와도 한쪽은 no-op가 된다.
- late response는 completed round를 다시 여는 대신 `late_response_comment_id`에 기록하고, operator가 명시적으로 follow-up round를 열 때만 반영한다.

### 11.3 root issue wakeup suppression

- root meeting issue는 facilitator agent에 할당하지 않는다.
- orchestrator의 root system comment는 `/issues/:id/comments` route를 통하지 않는 내부 helper로 직접 insert한다.
- 따라서 현재 route-level comment wakeup/mention resolution 경로를 기본적으로 우회한다.
- root system comment에는 resolvable `@mention` 또는 `agent://` mention markup를 넣지 않는다.
- child issue에 기록하는 orchestrator prompt/system comment도 동일하게 route를 우회해 insert한다.
- meeting child issue prompt packet은 참가자 이름과 타인 의견 요약을 plain text label로만 담고, resolvable `@mention` 또는 `agent://` markup를 만들지 않는다.
- V1에서는 orchestrated meeting root issue와 hidden child issue 모두에서 generic comment-triggered assignee wakeup(`issue_commented`)을 비활성화한다.
- 즉, board/user가 root issue에 남긴 일반 댓글이나, debug/manual 경로로 child issue에 남긴 out-of-band 댓글은 저장과 audit은 되더라도 자동 agent run을 만들지 않는다.
- V1에서는 meeting child issue에 대한 mention resolution / mention-triggered wakeup을 비활성화한다. 구현 경로는 `/issues/:id/comments` route가 target issue가 orchestrated meeting child issue인지 확인한 뒤 `findMentionedAgents()`와 mention wakeup fan-out을 건너뛰는 방식으로 둔다.
- root meeting issue도 동일하게 mention fan-out을 만들지 않는다. root human comment는 회의 기록으로는 남지만, 다음 round 진행은 operator control 또는 orchestrator dispatch를 통해서만 일어난다.
- participant/summarizer agent prompt에도 meeting child issue comment에서는 resolvable mention syntax를 쓰지 말라는 규칙을 넣는다.
- 향후 generic comment service로 통합되더라도 `authorKind = system` comment는 mention resolution과 agent wakeup에서 자동 제외되어야 한다.
- participant child issue wakeup만 실제 agent runtime 진입점으로 사용한다.
- final summary wakeup도 summarizer participant의 child issue를 통해서만 수행한다.

### 11.4 meeting-level operator attention signal

hidden child issue의 timeout/failure는 inbox에 직접 안 보이므로, Phase A부터 root meeting issue에 최소 visible signal을 올린다.

- timeout/failure/partial proceed 필요 시 root issue에 system control comment를 남긴다.
- meeting status가 `awaiting_operator` 또는 `failed`로 전이될 때, `last_operator_signal_comment_id`를 갱신한다.
- meeting room과 issue list는 hidden child issue 대신 root meeting issue의 attention signal과 meeting status를 표시한다.
- Phase A에서는 root issue signal + activity log + debug projection만 먼저 제공하고, Inbox polish는 Phase E/F에서 다듬는다.

### 11.5 권한과 감사 로그 계약

meeting 제어 API는 V1에서는 모두 board/operator context 전용으로 둔다.

- `start`
- `continue`
- `pause`
- `resume`
- `cancel`
- `remind`
- `skip`
- `summary`

즉, agent API key가 직접 meeting control endpoint를 호출해 회의를 조작하는 모델은 V1 범위에서 제외한다.

route 권한 규칙은 명시적으로 아래를 따른다.

- `assertCompanyAccess(req, companyId)`
- `assertBoard(req)`
- mutating endpoint는 기존 issue assignment와 같은 권한 모델을 재사용해 `tasks:assign` grant도 요구한다.
- generic `PATCH /issues/:id`는 root orchestrated meeting issue에 대해 structural invariant를 깨는 필드(`assignee*`, `status`, `hiddenAt`, `parentId`, `projectId`, `goalId`, `billingCode`) patch를 `422`로 거부한다.
- generic `checkout`, `release`, `comment-reopen`, `delete` route도 root orchestrated meeting issue에 대해서는 같은 invariant guard로 차단한다.

즉, "같은 회사 agent key"만으로는 meeting control endpoint를 호출할 수 없다.

감사 로그 규칙:

- 모든 meeting state mutation은 activity log를 남긴다.
- route handler에서 끝나는 단순 create/update뿐 아니라, orchestrator 내부에서 일어나는 round open/complete, timeout, auto-continue, system comment emit도 모두 audit 대상이다.
- 따라서 오케스트레이터는 raw `issues.addComment()`나 ad-hoc db update를 직접 흩뿌리지 않고, `meetingCommandService` 또는 동등한 중앙 helper를 통해 mutation + logActivity를 함께 수행해야 한다.
- user-triggered control action은 `actorType = user`
- participant agent가 final summary를 남길 때의 실제 답변은 `actorType = agent`
- timeout sweep, orphan recovery, system summary projection 같은 내부 자동 전이는 `actorType = system`, `actorId = meeting-orchestrator`로 기록한다.

최소 activity action set:

- `meeting.created`
- `meeting.started`
- `meeting.round_opened`
- `meeting.round_completed`
- `meeting.paused`
- `meeting.resumed`
- `meeting.cancelled`
- `meeting.participant_reminded`
- `meeting.participant_responded`
- `meeting.participant_skipped`
- `meeting.summary_requested`
- `meeting.system_comment_added`
- `meeting.operator_attention_set`
- `meeting.completed`
- `meeting.partial_completed`
- `meeting.policy_violation_comment`

### 11.6 dispatch orphan / pause 처리 규칙

- sweep는 `dispatching` round 중 `status = pending_dispatch`이면서 `dispatch_wakeup_request_id`와 `dispatch_run_id`가 모두 비어 있는 participant row만 찾아 idempotent 재-dispatch를 시도한다.
- 실제 orphan redispatch 한도는 `issue_meeting_round_participants.dispatch_attempt_count`로 participant별로 계산한다.
- `issue_meeting_rounds.dispatch_recovery_pass_count`는 sweep가 해당 round를 몇 번 스캔했는지에 대한 관찰용 집계이며, healthy participant를 실패 처리하는 공유 budget으로 쓰지 않는다.
- 재-dispatch는 participant-local `dispatch_attempt_count`와 round-participant CAS를 사용해 중복 enqueue를 막는다.
- 특정 participant가 재시도 한도를 넘기면 그 participant를 `failed` 또는 `awaiting_operator` 원인으로 표시하고, 필요 시 round 전체를 `awaiting_operator`로 보낸다.
- `dispatch_wakeup_status`는 enqueue 직후 최초 상태를 기록하고, sweep/advance가 연결된 `agent_wakeup_requests`와 `heartbeat_runs`를 재조회할 때 최신 관찰값으로 갱신한다.
- meeting이 `paused`면 `advanceMeeting()`은 새로운 라운드 전이와 dispatch를 멈추고 early return 한다.
- 다만 pause 전에 이미 running 중이던 agent run은 강제 중단하지 않는다. 이 run에서 뒤늦게 들어온 comment는 저장되더라도, `advanceMeeting()`은 pause 해제 전까지 후속 전이를 일으키지 않는다.
- startup/crash recovery sweep는 `status = draft AND auto_start = true AND opening round = pending` meeting도 감지해 idempotent start를 다시 시도한다.

## 12. 프롬프트 전략

오케스트레이터 품질은 prompt 설계에 크게 좌우된다.

V1 note:

- `round_summary` system comment는 별도 LLM prompt를 쓰지 않는다.
- round summary는 participant canonical response를 기계적으로 구조화한 projection이며, 첫 번째 freeform synthesis는 final summary 단계에서만 허용한다.

### 12.1 Round 1 prompt 규칙

- 독립적으로 답하라
- 다른 사람의 예상 입장을 따라가지 말라
- 자신의 역할에서 중요 지표와 리스크를 말하라
- 5개 이하 핵심 포인트로 압축하라

### 12.2 Round 2 prompt 규칙

- 다른 참가자의 핵심 주장 요약 제공
- 동의/반대/보완을 분명히 하라
- 실행 가능한 절충안을 제안하라
- 같은 말 반복을 줄여라

### 12.3 Final summary prompt 규칙

- 결론, 이유, 반대 의견, 실행안 분리
- "좋은 토론이었다" 같은 빈 문장을 줄임
- 실제 작업으로 연결 가능한 형태로 정리

### 12.4 언어 규칙

- 회의 안건과 최근 스레드가 한국어면 한국어로 답한다.
- 참가자 역할명, 라운드 헤더, 요약도 한국어 우선

## 13. 비용과 안정성 제어

이 기능은 비용 폭증 위험이 크므로 기본 제어가 필요하다.

기본 제어:

- 기본 참가자 수 3명 이하 권장
- 기본 discussion rounds 1회
- hard max discussion rounds 3
- 즉 total round rows는 최대 `opening 1 + discussion/followup 3 + summary 1 = 5`
- 참가자별 응답 길이 가이드
- summary input은 raw full transcript가 아니라 round summary 중심
- budget hard-stop, agent paused 상태, company paused 상태를 존중

회의 시작 전 UI에 대략적 실행 규모도 보여준다.

- 참가자 수
- 예상 라운드 수
- 최대 응답 횟수
- 거친 토큰/비용 추정치

## 14. 실패 시나리오와 처리

### 14.1 한 명이 응답하지 않는 경우

- 상태를 `timed_out`으로 표시
- usable response가 0개인 timeout은 timeout marker를 남긴 뒤 즉시 `awaiting_operator`로 승격한다
- usable response가 남아 있는 partial case에서는 사람은 `재촉`, `건너뛰고 계속`, `회의 중단` 중 선택한다
- usable response가 0개인 case에서는 V1 기본 선택지는 `재촉/재시도` 또는 `회의 중단`이다

### 14.2 한 명이 엉뚱한 답을 하는 경우

- 사람은 follow-up round를 한 번 더 열 수 있음
- 또는 해당 참가자를 제외하고 계속 진행

### 14.3 루트 요약은 완료됐는데 child issue 하나가 늦게 도착하는 경우

- late response로 표시
- main meeting transcript에는 자동 반영하지 않고 audit/debug raw comment로만 남긴다
- 자동으로 final summary를 다시 열어젖히지 않음
- 사용자가 `추가 반영 요약`을 명시 요청할 때만 새로운 follow-up round를 연다

### 14.4 오케스트레이터가 중간에 죽는 경우

- `issue_meeting_rounds`와 `issue_meeting_round_participants`를 기반으로 재개
- orphaned round recovery sweep에서 복구

### 14.5 요약자가 응답하지 않거나 실패하는 경우

- current round는 `summarizing -> awaiting_operator`로 전이한다.
- meeting status는 즉시 `awaiting_operator`로 전이한다.
- operator는 아래 중 하나를 선택한다.
  - 같은 summarizer를 다시 재촉
  - 다른 active participant를 새 summarizer로 지정
  - operator 판단으로 회의를 취소
- 대체 summarizer 지정은 새 summary round를 만드는 대신, 기존 `kind = summary` round의 summarizer participant와 deadline을 갱신해 재사용한다.
- 대체 summarizer가 final summary를 남겨 회의를 끝내면, 누락/실패가 있었던 사실을 남기기 위해 최종 meeting status는 `partial_completed`가 될 수 있다.

## 15. API 계획

권장 API:

- `POST /companies/:companyId/meetings`
- `GET /meetings/:meetingId`
- `GET /issues/:issueId/meeting`
- `POST /issues/:issueId/meeting/start`
- `POST /issues/:issueId/meeting/continue`
- `POST /issues/:issueId/meeting/pause`
- `POST /issues/:issueId/meeting/resume`
- `POST /issues/:issueId/meeting/cancel`
- `POST /issues/:issueId/meeting/participants/:agentId/remind`
- `POST /issues/:issueId/meeting/participants/:agentId/skip`
- `POST /issues/:issueId/meeting/summary`

루트 이슈와 meeting state는 분리하되, UI는 root issue id와 meeting id 둘 다로 meeting room을 열 수 있어야 한다.

권한 규칙:

- 위 endpoint는 company access가 있는 board/operator만 호출 가능하다.
- route는 회사 접근 검증과 함께 existing `tasks:assign` grant를 검사한다.
- 자동 전이와 sweep은 외부 API가 아니라 내부 orchestrator entrypoint를 사용한다.

Issue payload 확장 규칙:

- root meeting issue는 일반 issue list/get payload에 nullable meeting metadata를 함께 싣는다.
- 최소 필드:
  - `meetingId`
  - `meetingMode` (`legacy_thread` | `orchestrated`)
  - `meetingStatus`
  - `meetingCurrentRoundNumber`
  - `meetingCurrentRoundKind`
  - `meetingNeedsAttention`

파생 규칙:

- `meetingNeedsAttention = meetingStatus === "awaiting_operator" || meetingStatus === "failed"`
- `meetingCurrentRoundKind`는 active round가 없으면 `null`이다.
- `participantAgentId` 기반 issue list/filter는 orchestrated meeting root issue도 포함해야 한다.
- 구현 규칙은 기존 `participatedByAgentCondition()`를 확장해, `issue_meetings.root_issue_id = issues.id` 이고 동일 meeting에 `issue_meeting_participants.agent_id = :participantAgentId` row가 있으면 그 root issue를 "해당 agent가 참여한 issue"로 간주하는 방식으로 둔다.

이 계약이 있어야 Inbox/Office/UI가 assigneeAgentId 없이도 meeting row를 올바르게 deep-link하고, V1/V2 meeting UI를 안정적으로 구분할 수 있다.

meeting read DTO 규칙:

- `GET /meetings/:meetingId`와 `GET /issues/:issueId/meeting`은 동일한 `MeetingRoomDTO`를 반환한다.
- `MeetingRoomDTO`는 raw root issue comment 배열이 아니라, `meetingTranscriptProjection`이 만든 merged transcript를 포함한다.
- transcript는 round 경계, participant canonical response, round summary, final summary, late response, operator signal을 모두 정규화한 읽기 전용 projection이다.
- orchestrated meeting UI는 `/issues/:id/comments` 대신 이 DTO를 polling 또는 live refresh 기준으로 사용한다.

start 경로 규칙:

- `POST /companies/:companyId/meetings`는 `autoStart` 옵션을 받는다.
- 기본값은 `true`이며, commit 직후 내부 orchestrator entrypoint가 자동 start를 건다.
- `POST /issues/:issueId/meeting/start`는 `autoStart = false`로 생성된 draft meeting을 수동 시작할 때만 사용한다.

control endpoint 유효 상태:

- `start`
  - `meeting.status = draft`에서만 가능
- `continue`
  - `meeting.status = awaiting_operator`에서만 가능
  - current round가 `awaiting_operator`이고 usable response가 1개 이상 있을 때만, 현재 round의 skip/remind/operator 결정을 반영해 다음 round 또는 summary로 진행한다
- `pause`
  - `meeting.status in (running, awaiting_operator)`에서 가능
- `resume`
  - `meeting.status = paused`에서만 가능
  - resume 시 meeting status는 무조건 `running`으로 고정하지 않고, current round를 다시 평가해 `running` 또는 `awaiting_operator`로 복귀시킨다
- `cancel`
  - terminal이 아닌 meeting에서 가능
- `remind`
  - current round가 `collecting|awaiting_operator|timed_out`이고, 대상 participant가 아직 `responded`가 아닐 때만 가능
- `skip`
  - current round가 `collecting|awaiting_operator`이고, 대상 participant가 아직 `responded`가 아닐 때만 가능
- `summary`
  - current round가 `collecting|awaiting_operator`이고, usable participant response가 1개 이상일 때만 가능

## 16. 구현 단계

### Phase A. 기반 설계와 데이터 모델

- tx-aware `createIssueInTx` / `addIssueCommentInTx` 계열 내부 helper 분리
- schema 추가
- 기존 `issues.hiddenAt` 재사용 경로 명시
- `issue_comments` system author model 추가
- `IssueComment` shared type과 unread aggregation 계약 갱신
- `lastExternalCommentAtExpr`, `unreadForUserCondition`, list stats subquery, `deriveIssueUserContext` 등 comment author 가정이 박힌 SQL/helper를 함께 갱신
- `Issue` payload meeting metadata 계약 추가
- server-side `meetingMode` 계산(`orchestrated` / `legacy_thread`) 추가
- `MeetingRoomDTO` / transcript projection 계약 추가
- meeting child issue mention suppression 경로 추가
- 최소 participant 수 validator 추가
- root meeting issue generic patch guard 추가 (`assignee*`, `status`, `hiddenAt`, `parentId`, `projectId`, `goalId`, `billingCode`)
- root meeting issue generic checkout/release/comment-reopen/delete guard 추가
- root meeting issue `issues.status` mirror helper 추가
- meeting status 전이와 root `issues.status` mirror를 같은 transaction으로 묶는 중앙 helper 추가
- `participatedByAgentCondition()`에 orchestrated meeting participant join 추가
- orchestrated meeting generic comment wakeup suppression 추가
- shared types/validators 추가
- server service skeleton 추가
- root issue + hidden child issue 생성 로직 추가
- hidden child issue internal transaction 생성 경로 추가
- participant-round state table과 uniqueness/invariant 추가
- meeting mutation + activity logging 중앙 helper 추가
- root issue 최소 attention signal과 debug projection 추가
- 기존 `전체회의 V1`은 feature flag 또는 fallback 모드로 유지

### Phase B. Round 1 자동 수집

- 회의 생성 API
- 참가자 하위 이슈 wakeup fan-out
- 응답 완료 판정
- root issue round summary comment
- root meeting issue attention signal
- pause/resume의 최소 골격

### Phase C. Round 2 상호 토론

- round packet builder
- 토론 라운드 continue
- partial/timeout 정책
- operator decision flow
- late response handling

### Phase D. Final summary

- summary agent flow
- final recommendation rendering
- action proposal blocks
- summary round는 active summarizer slot 1개만 유지하고, summarizer 교체 시 historical row를 보존

### Phase E. UI 통합

- 오피스 meeting composer 확장
- meeting room projection
- participant status panel
- control actions
- MyIssues/unassigned triage에서 orchestrated root 예외 처리
- 기존 단순 meeting과 새 orchestrated meeting의 전환 UX 정리

### Phase F. polish

- activity copy 정리
- 비용 표시
- guardrails와 empty states

## 17. 테스트 계획

### 17.1 단위 테스트

- 사회자 자동 선정
- summarizer는 participant 안에서만 선택 가능한지
- participant row는 생성 시 active인지
- participant child issue 생성
- tx-aware issue/comment helper가 단일 transaction에서 동작하는지
- child issue project/goal/billing inheritance
- participant-round row lifecycle
- meeting running -> completed / partial_completed 전이
- dispatch prompt comment가 system author인지
- system comment kind별 unread 포함/제외
- comment author invariant / backfill mapping
- unread aggregation에서 visible system comment 포함 여부
- meeting 완료 시 `meeting_completed` system comment가 항상 생성되는지
- root orchestrated meeting issue에 generic patch로 `assignee*`, `status`, `hiddenAt`, `parentId`, `projectId`, `goalId`, `billingCode`를 바꾸려 하면 `422`로 거부되는지
- root orchestrated meeting issue에 generic checkout/release/comment-reopen/delete가 거부되는지
- root meeting issue `issues.status` mirror가 meeting lifecycle과 동기화되는지
- round completion detection
- timeout handling
- timed_out round persisted + meeting awaiting_operator 에스컬레이션 + 이후 remind/retry 경로
- partial continue
- root wakeup suppression
- child issue mention wakeup suppression
- orchestrated meeting root/child issue의 generic comment가 assignee/mention wakeup을 만들지 않는지
- summary agent timeout -> awaiting_operator 전이
- dispatching orphan recovery
- child issue status lifecycle (`backlog -> todo -> in_progress -> in_review -> done/cancelled`)
- timed_out -> late 전이
- duplicate summary / duplicate dispatch no-op
- transcript projection ordering
- 최소 participant 수 제약이 meeting create/start에서 enforced 되는지
- responded 이후 extra comment가 `participant_response_extra`로 투영되는지
- summary round에서 summarizer 교체 시 historical row가 보존되는지
- system comment invariant에 `system_comment_kind`가 포함되는지
- usable response 정의가 `responded` participant 기준으로 일관되는지
- 두 번째 late response가 debug/audit 전용으로만 남는지
- `participatedByAgentCondition()`가 orchestrated meeting root issue를 포함하는지

### 17.2 통합 테스트

- 회의 생성 -> Round 1 -> Round 2 -> Final summary end-to-end
- final summary child issue comment가 root meeting room에 projection되는지
- final summary completion 시 root-visible `meeting_completed` signal이 항상 생기는지
- participant 1명 timeout 후 partial continue
- 회의 pause / resume
- paused agent / budget hard-stop / hidden child issue behavior
- draft + autoStart + pending crash recovery sweep
- blocked participant -> awaiting_operator 전이
- out-of-band sibling/root agent comment가 projection에서 제외되고 audit만 남는지
- child issue mention이 sibling wakeup으로 새지 않는지
- AgentDetail / Issues의 `participantAgentId` 필터에서 orchestrated meeting root가 노출되는지
- MyIssues/unassigned triage에서 `meetingMode = orchestrated` root issue가 기본 제외되는지
- 동시에 여러 participant comment가 들어와도 round completion이 한 번만 일어나는지
- timeout sweep와 event-driven advance가 겹쳐도 duplicate comment가 생기지 않는지

### 17.3 UI 테스트

- meeting composer send summary
- participant chips와 상태 변화
- merged transcript rendering
- orchestrated meeting room이 `/issues/:id/comments`가 아니라 `MeetingRoomDTO`를 쓰는지
- system comment author rendering
- V1/V2 meeting 구분 fallback 동작
- `meetingNeedsAttention` 파생 표시
- autoStart = false draft 상태 표시
- Inbox에서 unassigned root meeting issue deep-link 동작
- control buttons visibility

### 17.4 수동 시나리오

아래 실제 질문으로 검증한다.

```text
지금 우리 프로젝트가 애드센스 승인을 받으려면 어떤 형식으로 가는 게 좋을까?
```

참가자:

- CEO
- CTO
- CMO

기대 결과:

- 1차 의견이 역할별로 분명히 나뉨
- 2차에서 서로의 의견을 참조해 논의함
- 최종 요약이 실행안으로 수렴함

## 18. 코드베이스 영향 범위

예상 수정 영역:

- `packages/db/src/schema/*`
- `packages/shared/src/types/*`
- `packages/shared/src/validators/*`
- `server/src/services/*`
- `server/src/routes/*`
- `server/src/routes/meetings.ts`
- `server/src/routes/authz.ts`
- `server/src/services/activity-log.ts`
- `server/src/services/issues.ts`
- `ui/src/lib/inbox.ts`
- `ui/src/pages/OfficeView.tsx`
- `ui/src/pages/officeViewModel.ts`
- `ui/src/pages/Inbox.tsx`
- `ui/src/components/CommentThread.tsx`
- `ui/src/components/office/*`
- `ui/src/api/*`

## 19. 추천 구현 방향

가장 중요한 결론은 아래다.

- "같은 이슈에서 여러 에이전트가 마구 댓글 다는 방식"으로 가지 않는다.
- "루트 회의 이슈 + 참가자 하위 이슈 + 라운드 오케스트레이터"로 간다.
- UI는 그룹 회의처럼 보이게 만들되, 내부 책임 단위는 single-assignee를 유지한다.

이 방향이면 사용자가 원하는 경험에 가장 가깝고, Paperclip의 현재 control-plane 모델도 깨지지 않는다.

## 20. 바로 다음 액션

이 계획 기준의 첫 구현 순서는 아래를 추천한다.

1. schema와 shared contract 초안 작성
2. tx-aware issue/comment helper와 internal system comment path를 먼저 분리
3. wakeup suppression 규칙은 "route bypass + no resolvable mentions + authorKind=system skip"으로 고정
4. 회의 생성 API와 hidden child issue fan-out 구현
5. Round 1 수집과 root summary까지만 먼저 완성
6. UI에서 merged meeting transcript를 읽기 전용으로 먼저 붙임
7. 그 다음 Round 2 토론과 final summary를 추가

이렇게 가면 가장 위험한 부분을 초반에 검증하면서도, 단계마다 사용자 체감 기능을 만들 수 있다.

## 21. V1 설계 동결

이 문서는 V1 범위에서는 설계 확정본으로 본다.

즉, 이후 구현 검토에서 우선적으로 확인할 것은 아래다.

- 계획과 실제 코드가 충돌하는지
- invariant가 구현에서 빠졌는지
- generic issue plane과 orchestrated meeting plane의 경계가 무너지는지
- 상태머신과 transcript projection이 문서와 다르게 동작하는지

반대로 아래 항목은 V1에서 다시 열지 않는다.

- multi-assignee issue 모델 도입
- 별도 chat message table 도입
- participant hard ACL 축소
- freeform 동시 채팅형 회의 엔진
- summarizer 전용 별도 child issue
- final summary를 root raw issue comment에 agent 이름으로 cross-post하는 방식

V1 frozen decision 요약:

- 회의 구조는 `root issue + hidden participant child issues + orchestrator tables`로 간다.
- root meeting issue는 unassigned visible container이며, generic issue lifecycle 변경으로부터 보호한다.
- 회의 lifecycle의 canonical source는 `issue_meetings.status`다.
- root issue의 generic list/filter 호환을 위해 `issues.status`는 coarse mirror로 유지한다.
- participant work의 canonical source는 child issue + `issue_meeting_round_participants`다.
- root/sibling/out-of-band comment는 visibility 차단이 아니라 non-canonical surface exclusion으로 다룬다.
- orchestrated meeting root/child issue에서는 generic comment wakeup과 mention fan-out을 만들지 않는다.
- final summary의 canonical 저장 위치는 summarizer child issue이며, root에는 `meeting_completed` system comment를 남긴다.
- UI는 orchestrated meeting에서 raw `/issues/:id/comments`가 아니라 `MeetingRoomDTO`를 사용한다.

## 22. 교차검증 문서

페이즈별 교차검증 지시서는 별도 문서로 유지한다.

- [Facilitated Meeting Orchestrator Cross Verification](/mnt/d/project/paperclipai/doc/plans/2026-04-07-facilitated-meeting-orchestrator-cross-verification.md)

구현 중에는 각 Phase 완료 시점마다 해당 문서의 같은 Phase 섹션을 그대로 전달해 cross verification을 돌리는 것을 기본 운영 절차로 삼는다.
