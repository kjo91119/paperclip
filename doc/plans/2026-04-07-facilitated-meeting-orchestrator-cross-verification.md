# 2026-04-07 Facilitated Meeting Orchestrator Cross Verification

Status: ready
Date: 2026-04-07
Audience: engineering, reviewers
Related:
- [Facilitated Meeting Orchestrator Plan](/mnt/d/project/paperclipai/doc/plans/2026-04-07-facilitated-meeting-orchestrator-plan.md)
- [Paperclip V1 Implementation Spec](/mnt/d/project/paperclipai/doc/SPEC-implementation.md)

## 1. 목적

이 문서는 `전체회의 토론 오케스트레이터` 구현을 Phase A~F로 나눠 교차검증할 때 사용하는 표준 지시서다.

목표는 단순 코드리뷰가 아니라 아래를 빠짐없이 확인하는 것이다.

- 구현이 계획 문서의 frozen decision을 실제로 지키는지
- generic issue plane과 orchestrated meeting plane의 경계가 무너지지 않는지
- 상태머신, transcript projection, wakeup suppression, activity log가 서로 모순 없이 닫혀 있는지
- 타입/빌드/테스트/수동 시나리오 기준으로 구현이 handoff 가능한지

## 2. 사용 원칙

각 Phase 구현이 끝날 때 아래 순서로 검증한다.

1. 구현 diff를 준비한다.
2. 이 문서의 해당 Phase 섹션만 reviewer에게 전달한다.
3. reviewer는 반드시 plan 문서와 현재 코드베이스를 함께 대조한다.
4. findings-first 형식으로 결과를 받는다.
5. 반영 후 같은 Phase를 한 번 더 재검증한다.
6. 그 다음 Phase로 넘어간다.

리뷰어 공통 원칙:

- 이미 frozen decision으로 닫힌 제품 방향을 다시 제안하는 데 시간을 쓰지 않는다.
- 다만 구현이 frozen decision을 깨거나, frozen decision이 실제 코드베이스와 양립 불가하면 그건 반드시 지적한다.
- 코드리뷰 모드로 본다. 요약보다 findings가 우선이다.
- file/line reference와 함께 재현 가능한 이유를 적는다.
- "이상해 보임" 수준의 추측보다, 실제 코드 경로와 상태 전이 기준으로 설명한다.
- wakeup, coalesced, deferred, orphan recovery, assignee comment wakeup을 검토할 때는 반드시 `server/src/services/heartbeat.ts`까지 함께 본다.

Severity 기준:

- `Critical`: 구현 진행 또는 merge 전에 반드시 방향을 바꿔야 하는 결함
- `High`: 현재 설계/구현을 깨뜨리거나 사용자 동작을 크게 어그러뜨릴 위험
- `Medium`: 구현 중 막히거나 회귀 가능성이 높은 공백
- `Low`: 품질, 명확성, 유지보수성 이슈

## 3. Frozen Decision Snapshot

아래는 V1에서 다시 열지 않는 설계 결정이다.

- 구조는 `root meeting issue + hidden participant child issues + orchestration tables`
- root meeting issue는 unassigned visible container
- single-assignee invariant 유지
- canonical lifecycle source는 `issue_meetings.status`
- generic issue list/filter 호환을 위해 root issue의 `issues.status`는 coarse mirror 유지
- participant work의 canonical source는 child issue + `issue_meeting_round_participants`
- same-company full visibility 계약은 유지하고, ACL 축소 대신 non-canonical surface exclusion으로 다룸
- orchestrated meeting root/child issue에서는 generic comment wakeup과 mention fan-out 비활성화
- final summary의 canonical 저장 위치는 summarizer child issue
- root에는 `meeting_completed` system comment를 항상 남김
- orchestrated meeting UI는 raw `/issues/:id/comments` 대신 `MeetingRoomDTO` 사용
- root orchestrated meeting issue는 generic patch/checkout/release/comment-reopen/delete로 lifecycle을 바꾸지 않음

reviewer는 이 결정 자체를 다시 설계하라고 하기보다, 구현이 이 결정을 실제로 지키는지를 우선 검증해야 한다.

## 4. 공통 자동 검증

기본 명령:

- `git diff --check`
- `TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm -r typecheck`
- `TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm build`

Phase A 또는 schema 변경이 포함되면 추가:

- `pnpm db:generate`

Phase B 이후 기능 동작이 붙으면 추가:

- `TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm test:run`

리뷰어는 가능하면 아래도 함께 본다.

- 변경된 파일 기준 단위 테스트
- 관련 E2E 또는 integration test
- `git diff --check` 기준 whitespace / merge marker 문제

## 5. 결과 기록 템플릿

모든 Phase 검증 결과는 아래 형식을 권장한다.

```md
판정:

Findings
- severity: ...
  file: ...
  detail: ...

검증 범위:
- plan sections: ...
- code paths: ...

실행 결과:
- git diff --check
- TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm -r typecheck
- TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm build
- 추가 테스트 ...

메모:
- ...
```

## 6. Phase A

### 6.1 목표

기반 설계와 데이터 모델을 닫는다.

- schema
- shared types / validators
- tx-aware helper
- generic issue plane guard
- unread / author model
- meeting metadata payload
- root issue status mirror
- participant filter extension
- generic comment wakeup suppression 기반

### 6.2 핵심 검토 포인트

- `issue_meetings`, `issue_meeting_participants`, `issue_meeting_rounds`, `issue_meeting_round_participants`가 계획 문서와 동일한 invariant를 가지는지
- `author_kind`, `author_system_key`, `system_comment_kind`가 DB / shared type / unread SQL / rendering contract에 모두 연결되는지
- root orchestrated meeting issue에 대해 generic `PATCH`, `checkout`, `release`, `comment reopen`, `delete`가 `422` validation guard로 막히는지
- `projectId`, `goalId`, `billingCode`가 root generic edit로 drift 나지 않게 막혔는지
- `issues.status` mirror helper가 generic list/filter와 충돌 없이 들어가는지
- `participatedByAgentCondition()`가 orchestrated meeting root를 포함하는지
- child issue / root issue의 generic comment wakeup suppression 기반이 들어갔는지
- unread / recency가 서버 SQL뿐 아니라 `ui/src/lib/inbox.ts` signal 계산과도 일치하는지

### 6.3 반드시 볼 파일

- `packages/db/src/schema/*`
- `packages/shared/src/types/*`
- `packages/shared/src/validators/*`
- `packages/shared/src/constants.ts`
- `server/src/services/heartbeat.ts`
- `server/src/services/issues.ts`
- `server/src/routes/issues.ts`
- `server/src/routes/meetings.ts`
- `ui/src/components/IssueProperties.tsx`
- `ui/src/pages/IssueDetail.tsx`
- `ui/src/pages/MyIssues.tsx`
- `ui/src/lib/inbox.ts`

### 6.4 반려 기준

- root meeting issue를 generic route로 재할당/숨김/삭제/checkout/reopen 가능
- `IssueComment` author model은 추가됐는데 unread SQL이나 shared type이 예전 가정(`authorUserId IS NULL`)에 묶여 있음
- `meetingMode`, `meetingStatus`, `participantAgentId` 관련 payload / filter 계약이 빠짐
- generic comment wakeup suppression이 root/child 둘 중 하나에만 반영됨
- root invariant guard가 generic lifecycle mutation에 대해 `422`가 아니라 임의의 `409`/silent ignore로 처리됨
- `issues.status` mirror가 없거나, invalid enum 값을 씀

### 6.5 전달용 검증 프롬프트

```text
이번 변경은 전체회의 토론 오케스트레이터 Phase A 구현입니다.
아래 문서를 기준으로 diff와 현재 코드베이스를 교차검증해 주세요.

기준 문서:
- doc/plans/2026-04-07-facilitated-meeting-orchestrator-plan.md
- doc/plans/2026-04-07-facilitated-meeting-orchestrator-cross-verification.md 의 Phase A

검토 원칙:
- findings-first 형식
- file/line reference 포함
- frozen decision 자체를 다시 설계하지 말고, 구현이 frozen decision을 지키는지 우선 검토

반드시 확인할 것:
- meeting schema / shared contract / validators 일치
- root orchestrated meeting issue generic guard
- issue comment author model + unread aggregation + recency SQL
- inbox signal / recency UI 계산(`ui/src/lib/inbox.ts`)
- issues.status mirror
- participatedByAgentCondition 확장
- generic comment wakeup suppression

특히 root meeting issue가 generic issue plane에서 실수로 lifecycle 변경될 수 있는지 엄격히 봐 주세요.
```

## 7. Phase B

### 7.1 목표

회의 생성과 Round 1 자동 수집을 완성한다.

- root + hidden child issue 생성
- opening round dispatch
- response detection
- root summary
- zero-response timeout escalation
- remind / retry 기본 경로

### 7.2 핵심 검토 포인트

- 회의 생성이 단일 transaction + commit 후 wakeup 패턴을 지키는지
- child issue prompt가 system-authored이며 mention-free인지
- pending_dispatch -> dispatching -> collecting 흐름이 CAS/idempotent하게 닫혀 있는지
- `collecting -> timed_out -> dispatching` 재시도 경로가 실제로 이어지는지
- 0-response timeout이 deadlock 없이 operator attention으로 올라가는지
- root round summary가 mechanical projection인지
- duplicate dispatch / duplicate summary가 생기지 않는지
- meeting create/control route가 board-only + `tasks:assign` grant를 실제로 검사하는지
- auto transition / dispatch / timeout / system comment emit이 activity log를 빠뜨리지 않는지

### 7.3 반드시 볼 파일

- `server/src/routes/meetings.ts`
- `server/src/routes/authz.ts`
- `server/src/services/activity-log.ts`
- `server/src/services/heartbeat.ts`
- `server/src/services/meeting-orchestrator*`
- `server/src/services/issues.ts`
- `server/src/routes/issues.ts`
- 관련 schema / shared DTO / tests

### 7.4 반려 기준

- 회의 생성 중 child issue가 visible 상태로 새어 나감
- dispatch prompt가 agent author로 저장됨
- timeout 0응답 시 다음 액션이 끊김
- remind/retry 후 participant는 `pending_dispatch`인데 round는 다시 dispatch를 타지 않음
- child issue mention 또는 generic comment wakeup이 sibling run을 만듦
- meeting create/control은 동작하지만 board-only / `tasks:assign` / activity log 계약이 빠져 있음

### 7.5 전달용 검증 프롬프트

```text
이번 변경은 전체회의 토론 오케스트레이터 Phase B 구현입니다.
Round 1 생성/dispatch/수집/timeout 경로를 중심으로 검토해 주세요.

기준 문서:
- doc/plans/2026-04-07-facilitated-meeting-orchestrator-plan.md
- doc/plans/2026-04-07-facilitated-meeting-orchestrator-cross-verification.md 의 Phase B

반드시 확인할 것:
- 회의 생성 transaction 순서
- hidden child issue 생성과 wakeup 타이밍
- opening round dispatch prompt author / mention-free packet
- response detection
- 0-response timeout -> operator attention -> remind/retry 경로
- duplicate dispatch / duplicate summary 방지
- meeting create/control route authz + activity log

특히 timed_out round가 실제로 remind 후 다시 dispatch를 탈 수 있는지, 그리고 child issue comment가 sibling wakeup을 만들지 않는지 집중해서 봐 주세요.
```

## 8. Phase C

### 8.1 목표

Round 2 상호 토론과 followup / partial proceed / late response를 완성한다.

### 8.2 핵심 검토 포인트

- Round 2 packet이 Round 1 summary와 자기 이전 입장을 올바르게 섞는지
- `max_discussion_rounds` budget 안에서만 followup이 열리는지
- partial continue / skip / remind가 operator action으로 일관되게 닫히는지
- responded 이후 추가 comment가 `participant_response_extra`로 투영되는지
- late response가 회의를 자동 재오픈하지 않는지
- 완료 이후 late response가 main transcript에 섞이지 않는지

### 8.3 반려 기준

- followup round가 hard max를 무시함
- responded 이후 extra comment가 유실됨
- completed / partial_completed 이후 late response가 main transcript를 다시 뒤흔듦
- `summary_requested_by_user_id`가 operator 명시 요청과 auto transition을 구분하는 audit field로 일관되게 채워지지 않음

### 8.4 전달용 검증 프롬프트

```text
이번 변경은 전체회의 토론 오케스트레이터 Phase C 구현입니다.
Round 2 상호 토론, followup, partial proceed, late response를 중점 검토해 주세요.

꼭 볼 것:
- Round 2 packet builder
- followup round budget
- partial continue / skip / remind flow
- participant_response_extra projection
- late response 처리
- `summary_requested_by_user_id` audit semantics

특히 late response가 meeting_completed 이후 main transcript를 다시 열지 않는지, followup round count가 max_discussion_rounds를 넘지 않는지 확인해 주세요.
```

## 9. Phase D

### 9.1 목표

최종 요약과 회의 종료 semantics를 완성한다.

- summary round
- summarizer retry / reassignment
- final summary projection
- meeting_completed / partial_completed

### 9.2 핵심 검토 포인트

- summary round active slot 1개 + historical row 보존 규칙이 실제 코드에서 지켜지는지
- summarizer `A -> B -> A` 복귀가 `(round_id, participant_id)` unique와 양립하는지
- final summary canonical 저장 위치가 child issue인지
- root-visible `meeting_completed` system comment가 항상 1회 생성되는지
- `completed`와 `partial_completed`가 activity log, transcript, unread semantics에서 구분되는지
- summary / completion control endpoint가 board-only + `tasks:assign` grant를 유지하는지
- final summary projection과 종료 전이가 `meeting.completed` / `meeting.partial_completed` audit를 빠뜨리지 않는지

### 9.3 반드시 볼 파일

- `server/src/routes/meetings.ts`
- `server/src/routes/authz.ts`
- `server/src/services/activity-log.ts`
- `server/src/services/meeting-orchestrator*`
- `server/src/services/issues.ts`
- 관련 summary projection / transcript DTO / tests

### 9.4 반려 기준

- summarizer 교체 시 이전 attempt row가 덮어써져 history가 사라짐
- final summary가 root raw comment stream에 agent 이름으로 cross-post됨
- partial_completed와 completed가 audit 상 구분되지 않음
- completion은 되지만 meeting control authz 또는 audit가 빠져 있음

### 9.5 전달용 검증 프롬프트

```text
이번 변경은 전체회의 토론 오케스트레이터 Phase D 구현입니다.
summary round와 최종 종료 semantics를 중점 검토해 주세요.

꼭 확인할 것:
- summary round active slot 1개 규칙
- summarizer retry / reassignment history 보존
- final summary child issue canonical 저장
- root meeting_completed signal 항상 생성
- completed vs partial_completed 구분
- summary/control authz와 completion activity log

특히 summarizer 교체 시 history 유실이 없는지, meeting_completed가 optional이 아니라 mandatory로 구현됐는지 봐 주세요.
```

## 10. Phase E

### 10.1 목표

오피스와 이슈 UI를 orchestrated meeting 기준으로 통합한다.

- meeting composer
- meeting room
- participant panel
- deep-link
- MyIssues / Issues / AgentDetail 예외 처리

### 10.2 핵심 검토 포인트

- UI가 raw `/issues/:id/comments` 대신 `MeetingRoomDTO`를 쓰는지
- V1/V2 meeting 판별을 UI가 description 파싱이 아니라 server payload로 처리하는지
- root meeting issue의 generic `IssueProperties` 편집 UI가 숨겨졌는지
- `participantAgentId` 필터에서 orchestrated meeting root가 보이는지
- `MyIssues`에서는 orchestrated root가 기본 제외되는지
- unassigned root meeting issue deep-link가 정상 동작하는지

### 10.3 반드시 볼 파일

- `ui/src/pages/OfficeView.tsx`
- `ui/src/pages/officeViewModel.ts`
- `ui/src/pages/Inbox.tsx`
- `ui/src/pages/IssueDetail.tsx`
- `ui/src/pages/Issues.tsx`
- `ui/src/pages/AgentDetail.tsx`
- `ui/src/pages/MyIssues.tsx`
- `ui/src/components/IssueProperties.tsx`
- `ui/src/components/CommentThread.tsx`
- `ui/src/lib/inbox.ts`
- `ui/src/api/*`
- `server/src/routes/meetings.ts`
- `server/src/services/issues.ts`
- 관련 `MeetingRoomDTO` shared type / tests

### 10.4 반려 기준

- meeting room이 여전히 root raw comments를 직접 렌더링함
- root meeting issue가 일반 이슈처럼 재할당/숨김 가능한 UI를 그대로 노출
- AgentDetail / Issues가 `participantAgentId` 기반 서버 filter 또는 meeting metadata를 실제 UI 경로에서 쓰지 않아 참여 회의가 누락됨
- MyIssues가 root meeting issue를 미할당 triage처럼 보여줌

### 10.5 전달용 검증 프롬프트

```text
이번 변경은 전체회의 토론 오케스트레이터 Phase E UI 통합입니다.
UI가 plan 문서의 meeting DTO / root guard / triage 예외 규칙을 실제로 따르는지 검토해 주세요.

꼭 확인할 것:
- MeetingRoomDTO 기반 렌더링
- server payload 기반 V1/V2 meeting 구분
- root meeting issue IssueProperties read-only 처리
- participantAgentId 필터에 orchestrated root 포함
- MyIssues에서 orchestrated root 제외
- Inbox / Office deep-link
- IssueDetail / officeViewModel / Inbox / OfficeView / CommentThread 실제 코드 경로

특히 UI가 raw issue comment plane과 orchestrated meeting plane을 섞어 쓰지 않는지 집중해서 봐 주세요.
```

## 11. Phase F

### 11.1 목표

polish, copy, 비용 표시, guardrail, empty state를 마무리한다.

### 11.2 핵심 검토 포인트

- activity copy가 technical detail을 과하게 노출하지 않는지
- 비용 추정이 실제 round/participant 상한과 일치하는지
- operator attention / empty state / paused / failed / no participants 같은 edge case copy가 자연스러운지
- hidden child issue가 일반 화면으로 새지 않는지
- 최종적으로 typecheck / build / test가 안정적인지

### 11.3 반려 기준

- 비용 추정 또는 상태 badge가 실제 동작과 어긋남
- operator attention 상태인데 UI가 조용함
- empty state / error state가 actionless 상태로 남음

### 11.4 전달용 검증 프롬프트

```text
이번 변경은 전체회의 토론 오케스트레이터 Phase F polish입니다.
기능 correctness 자체보다 user-facing guardrail, copy, edge state, regression을 중심으로 검토해 주세요.

꼭 확인할 것:
- 비용/라운드/참가자 수 표시
- operator attention / paused / failed / empty state
- hidden child issue 누출 여부
- activity copy / system comment copy
- 전체 회귀

이 Phase에서는 작은 UX 문구라도 실제 오해를 만들면 medium 이상으로 봐 주세요.
```

## 12. 최종 합격 기준

전체 feature는 아래를 모두 만족할 때 handoff 가능으로 본다.

1. plan 문서의 frozen decision과 구현이 모순되지 않는다.
2. Phase A~F의 각 반려 기준이 모두 해소됐다.
3. `git diff --check`, `pnpm -r typecheck`, `pnpm build`, `pnpm test:run`이 통과한다.
4. root meeting issue / child issue / transcript / wakeup / activity log / unread semantics가 서로 충돌하지 않는다.
5. UI가 generic issue plane과 orchestrated meeting plane을 구분해 표시한다.
