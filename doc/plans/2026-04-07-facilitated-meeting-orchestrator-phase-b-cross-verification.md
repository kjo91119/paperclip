# 전체회의 오케스트레이터 Phase B 교차검증 지시서

## 1. 문서 목적

이 문서는 `전체회의 토론 오케스트레이터`의 **Phase B 구현분**을 reviewer에게 넘길 때 사용하는 전달용 교차검증 지시서다.

- 기준 커밋: `4a4a2bb9`
- 브랜치: `local/2026-04-02-korean-ui-backup`
- 구현 기준 문서:
  - `doc/plans/2026-04-07-facilitated-meeting-orchestrator-plan.md`
  - `doc/plans/2026-04-07-facilitated-meeting-orchestrator-cross-verification.md`

이번 문서는 "Phase B에서 실제로 구현된 범위", "아직 Phase C/D 이후로 남겨둔 범위", "reviewer가 반드시 봐야 할 검토 포인트"를 분리해서 적는다.

현재 판정은 **Pass**다.

- Phase B 목표 범위의 핵심 흐름은 구현됨
- typecheck / build / 전체 test suite까지 통과함
- 다만 reviewer는 여전히 "Phase B 범위를 넘는 skeleton"과 "Phase B 범위 안의 회귀 위험"을 구분해서 봐야 한다

## 2. 이번 커밋에서 완료된 항목

### 2.1 schema / migration 보강

- `issue_meeting_round_participants`에 Phase B 운영 필드 추가
  - `remindedCount`
  - `skipReason`
  - `lastErrorCode`
  - `dispatchedAt`
  - `deadlineAt`
  - `timedOutAt`
  - `skippedAt`
- drizzle migration 생성 및 snapshot 반영

주요 파일:

- `packages/db/src/schema/issue_meetings.ts`
- `packages/db/src/migrations/0048_clear_imperial_guard.sql`
- `packages/db/src/migrations/meta/0048_snapshot.json`

### 2.2 meeting service 본체 연결

- 회의 생성 구현
  - root meeting issue 생성
  - hidden participant child issue 생성
  - participant row / opening round / round participant row 생성
- autoStart 시 opening round 시작 구현
- Round 1 dispatch 구현
  - child issue에 system-authored prompt comment 기록
  - wakeup dispatch
  - round `dispatching -> collecting`
- child issue agent comment 기반 응답 감지 구현
- 모든 participant 응답 완료 시 root `round_summary` + `operator_attention` 생성
- zero-response timeout 감지 및 `awaiting_operator` 승격 구현
- `remind`를 통한 단일 participant re-dispatch 구현
- 최소 `pause` / `resume` 구현
- root issue `issues.status` mirror를 meeting mutation과 같은 transaction 안에서 갱신

주요 파일:

- `server/src/services/meetings.ts`

### 2.3 route wiring

- `POST /api/companies/:companyId/meetings`
- `POST /api/issues/:issueId/meeting/start`
- `POST /api/issues/:issueId/meeting/pause`
- `POST /api/issues/:issueId/meeting/resume`
- `POST /api/issues/:issueId/meeting/participants/:agentId/remind`

위 엔드포인트를 실제 service 구현에 연결

- board-only + `tasks:assign` grant 검사 유지
- actor 정보를 meeting service로 전달

또한 issue comment 경로에서:

- `PATCH /api/issues/:id`의 comment path
- `POST /api/issues/:id/comments`

양쪽 모두 comment 생성 후 `meetingService.onIssueCommentAdded()`를 호출해 child issue agent comment를 round response로 반영하도록 연결했다.

주요 파일:

- `server/src/routes/meetings.ts`
- `server/src/routes/issues.ts`
- `server/src/routes/authz.ts`

### 2.4 테스트 보강

- 새 embedded Postgres integration test 추가
  - 회의 생성 + autoStart + hidden child issue + opening round dispatch
  - active participant 전원 응답 수집 후 round complete + root summary/operator attention
  - zero-response timeout 후 remind redispatch
- issue route mock 테스트 보강
  - `meetingService` import 추가에 맞춘 mock 정리

주요 파일:

- `server/src/__tests__/meetings-service.test.ts`
- `server/src/__tests__/issue-comment-reopen-routes.test.ts`
- `server/src/__tests__/issues-goal-context-routes.test.ts`
- `server/src/__tests__/issue-document-restore-routes.test.ts`

## 3. 이번 커밋에서 의도적으로 아직 남겨둔 범위

아래는 이번 커밋에서 **일부러 Phase B 범위 밖으로 남겨둔 것**이다.

### 3.1 아직 skeleton 또는 후속 Phase 범위인 항목

- `POST /issues/:issueId/meeting/continue`
- `POST /issues/:issueId/meeting/cancel`
- `POST /issues/:issueId/meeting/summary`
- `POST /issues/:issueId/meeting/participants/:agentId/skip`

위 엔드포인트는 아직 `501` skeleton이다. 이는 현재 커밋 기준으로 **의도된 상태**이며, reviewer는 이를 숨은 회귀와 구분해야 한다.

### 3.2 아직 partial인 항목

- `MeetingRoomDTO.transcript`는 여전히 빈 배열 skeleton이다
- Round 2 discussion packet / followup / partial continue / late response / final summary는 아직 들어가지 않았다
- summary round / final summary canonical projection은 아직 미구현이다
- UI는 Phase A 상태를 유지하고, Phase B에서는 backend orchestration 흐름만 본격 연결했다

즉 이번 커밋은 **Round 1 생성, dispatch, 수집, timeout, remind까지를 실제로 동작시키는 backend 중심 Phase B 구현**이다.

## 4. reviewer에게 반드시 요청할 검토 항목

리뷰어는 아래를 우선적으로 봐야 한다.

- 회의 생성이 root + hidden child issue + opening round row를 일관되게 생성하는지
- 생성 transaction과 wakeup dispatch가 `commit 후 wakeup` 패턴을 지키는지
- `server/src/services/heartbeat.ts` 기준으로 `queued`, `coalesced`, `deferred_issue_execution`, conflict/skip 결과가 participant status로 올바르게 번역되는지
- child issue prompt comment가 `system` author이고 mention-free인지
- generic root/child comment wakeup suppression과 meeting dispatch wakeup이 서로 충돌하지 않는지
- child issue agent comment가 `onIssueCommentAdded()`를 통해 정확히 round response로 잡히는지
- 모든 active participant가 응답하면 round가 `completed`, meeting이 `awaiting_operator`로 가는지
- root `round_summary`가 기계적 projection인지
- zero-response timeout 시 round / participant / meeting 상태가 deadlock 없이 `timed_out + awaiting_operator`로 정리되는지
- `remind`가 실제로 participant row를 재활성화하고 round를 다시 `dispatching -> collecting`으로 보낼 수 있는지
- `pause` / `resume`이 current round 성격을 덮어쓰지 않고 `running | awaiting_operator`로 올바르게 복귀하는지
- route authz가 board-only + `tasks:assign` grant를 빠뜨리지 않는지
- auto transition / timeout / dispatch / response / summary / attention이 activity log를 빠뜨리지 않는지

## 5. 이번 커밋에서 실제 수행한 검증

### 5.1 통과

- `git diff --check`
- `pnpm db:generate`
- `TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm -r typecheck`
- `TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm build`
- targeted tests:
  - `TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm --filter @paperclipai/server exec vitest run src/__tests__/meetings-service.test.ts`
  - `TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm --filter @paperclipai/server exec vitest run src/__tests__/issue-comment-reopen-routes.test.ts src/__tests__/issues-goal-context-routes.test.ts src/__tests__/issue-document-restore-routes.test.ts`
- full suite:
  - `TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm test:run`

### 5.2 전체 테스트 상태

- 전체 테스트 통과
- 결과:
  - `153` test files passed
  - `803` tests passed
  - `1 skipped`

이전 Phase A 때 보였던 `company-import-export-e2e` full-suite timeout도 이번 검증에서는 재현되지 않았다.

## 6. reviewer에게 같이 전달할 메모

- 이번 커밋은 Phase B 전체 중에서도 **backend orchestration flow** 중심이다.
- reviewer는 Phase B cross-verification 기준을 적용하되, 아직 의도적으로 `501`로 남겨둔 control endpoint를 "미구현 skeleton"과 "회귀"로 구분해 달라고 요청하는 것이 맞다.
- 핵심 리스크는 크게 네 가지다.
  - dispatch / timeout / remind 상태머신이 실제로 닫혀 있는지
  - `heartbeat.ts`의 queued/coalesced/deferred/skip/conflict 경로가 meeting participant 상태머신과 어긋나지 않는지
  - child issue generic comment wakeup이 sibling run leak를 만들지 않는지
  - activity log와 authz가 happy path만 맞고 edge case에서 빠지지 않는지
  - pause/resume 및 duplicate dispatch / duplicate summary가 race 상황에서 생기지 않는지

## 7. 전달용 프롬프트

```text
이번 변경은 전체회의 토론 오케스트레이터의 Phase B 구현분입니다.
아래 문서와 커밋을 기준으로 교차검증해 주세요.

기준:
- commit: 4a4a2bb9
- doc/plans/2026-04-07-facilitated-meeting-orchestrator-plan.md
- doc/plans/2026-04-07-facilitated-meeting-orchestrator-cross-verification.md
- doc/plans/2026-04-07-facilitated-meeting-orchestrator-phase-b-cross-verification.md

중요:
- 이번 커밋은 Round 1 생성/dispatch/수집/timeout/remind까지의 backend orchestration flow가 중심입니다.
- 아래 control endpoint는 아직 의도적으로 501 skeleton입니다:
  - /meeting/continue
  - /meeting/cancel
  - /meeting/summary
  - /meeting/participants/:agentId/skip
- 이를 회귀와 구분해서 검토해 주세요.

반드시 봐 주세요:
- 회의 생성 transaction 순서
- hidden child issue 생성과 wakeup 타이밍
- `server/src/services/heartbeat.ts` 기준 coalesced/deferred/conflict/skip 경로와 participant status 번역
- opening round dispatch prompt author / mention-free packet
- child issue agent comment -> round response detection
- 0-response timeout -> awaiting_operator
- remind/retry 후 timed_out round가 다시 dispatch를 탈 수 있는지
- pause/resume이 current round 성격에 맞게 복귀하는지
- root round_summary / operator_attention 생성
- duplicate dispatch / duplicate summary 방지
- meeting create/control route authz
- activity log 누락 여부

특히 child issue comment가 sibling wakeup을 만들지 않는지와, remind 후 participant row만 바뀌고 round는 다시 dispatch되지 않는 상태가 없는지 집중해서 봐 주세요.

결과는 findings-first 형식으로, file/line reference와 함께 정리해 주세요.
```
