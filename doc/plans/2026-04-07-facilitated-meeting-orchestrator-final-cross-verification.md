# 전체회의 오케스트레이터 최종 교차검증 지시서

## 1. 문서 목적

이 문서는 `전체회의 토론 오케스트레이터`의 **Phase A~F 전체 구현분**을 최종 reviewer에게 넘길 때 사용하는 종합 교차검증 지시서다.

- 기준 변경셋:
  - final pre-fix base commit: `921d82c8`
  - final implementation fix commit: `9a16338b`
  - read-only UI regression-hardening commits: `f19145bc`, `789dd2dc`
- 브랜치: `local/2026-04-02-korean-ui-backup`
- 구현 기준 문서:
  - `doc/plans/2026-04-07-facilitated-meeting-orchestrator-plan.md`
  - `doc/plans/2026-04-07-facilitated-meeting-orchestrator-cross-verification.md`

이번 문서는 phase handoff를 개별로 다시 넘겨 읽지 않아도, reviewer가 최종 상태를 한 번에 검토할 수 있도록 아래를 정리한다.

- 무엇이 A~F에서 구현됐는지
- 현재 V1 frozen decision이 실제 코드에서 지켜지는지 어디를 보면 되는지
- 어떤 known failure가 현재도 남아 있는지
- 어떤 조건이면 최종 합격으로 볼 수 있는지

현재 판정은 **Conditional Pass**다.

- 오케스트레이션 구조, 라운드 상태머신, summary/final summary, transcript projection, MeetingRoomDTO 기반 UI, 비용/가드레일 polish까지 구현됨
- root orchestrated meeting issue는 서버 route guard뿐 아니라 UI header에서도 generic lifecycle mutation dead-end가 남지 않도록 read-only 표현으로 정리됨
- `git diff --check`, `pnpm -r typecheck`, `pnpm build`는 통과했음
- latest full-suite rerun에서는 `cli/src/__tests__/company-import-export-e2e.test.ts` 1건만 실패했고, `server/src/__tests__/company-skills-routes.test.ts`는 통과했음
- `company-import-export-e2e`는 full suite에서는 `beforeAll` hook timeout으로 실패했고, standalone 재실행은 통과함

## 2. 전체 구현 범위 요약

### 2.1 Phase A. 기반 모델과 generic issue plane guard

- meeting schema / shared DTO / validator 추가
- tx-aware issue/comment helper 추가
- root orchestrated meeting issue generic guard
- comment author model / unread contract / root issue status mirror
- `participatedByAgentCondition()` 확장
- generic comment wakeup suppression 기반

### 2.2 Phase B. 회의 생성과 Round 1 수집

- 회의 생성 API
- root issue + hidden participant child issue fan-out
- opening round dispatch
- response detection
- zero-response timeout escalation
- remind/retry 기본 경로

### 2.3 Phase C. Round 2 상호 토론

- discussion/followup round packet builder
- continue / skip / partial continue
- late response handling
- operator decision flow
- transcript projection 기반 강화

### 2.4 Phase D. final summary와 종료 semantics

- summary round / active summarizer slot
- summary reassignment history 보존
- final summary child issue canonical 저장
- `completed | partial_completed`
- `meeting_completed` mandatory signal

### 2.5 Phase E. UI 통합

- IssueDetail / Office / Inbox가 orchestrated meeting room 사용
- Office meeting composer가 실제 meeting create API 사용
- `participantAgentId` 경로 / MyIssues triage 예외 처리
- `MeetingRoomPanel` control actions와 query invalidation

### 2.6 Phase F. polish

- 상태 배너
- rough execution estimate / token range
- guardrail notes
- draft/paused/failed/completed empty state copy
- root meeting read-only UI dead-end 제거

## 3. reviewer가 최우선으로 검토해야 할 최종 invariant

리뷰어는 아래를 우선적으로 봐야 한다.

- root meeting issue는 visible container이지만, generic patch/checkout/release/comment-reopen/delete와 UI lifecycle mutation에서 모두 보호되는지
- canonical lifecycle source는 `issue_meetings.status`이고, `issues.status`는 coarse mirror로만 유지되는지
- participant work의 canonical source는 child issue + `issue_meeting_round_participants`인지
- root/child issue에서 generic comment wakeup과 mention fan-out이 오케스트레이터 바깥 run을 만들지 않는지
- final summary canonical 저장 위치가 summarizer child issue이고, root에는 `meeting_completed` signal만 남는지
- UI가 raw `/issues/:id/comments` 대신 `MeetingRoomDTO`를 사용하고, generic issue plane과 orchestrated meeting plane을 섞지 않는지
- `participantAgentId` 필터와 `MyIssues` 예외가 동시에 성립하는지
- unread / recency / activity log / transcript projection이 서로 같은 사건을 다른 의미로 해석하지 않는지

## 4. reviewer가 반드시 볼 파일

### 4.1 DB / shared / validators

- `packages/db/src/schema/issue_meetings.ts`
- `packages/db/src/schema/issue_comments.ts`
- `packages/shared/src/constants.ts`
- `packages/shared/src/types/meeting.ts`
- `packages/shared/src/types/issue.ts`
- `packages/shared/src/validators/meeting.ts`
- `packages/shared/src/validators/issue.ts`

### 4.2 server

- `server/src/services/meetings.ts`
- `server/src/services/issues.ts`
- `server/src/services/heartbeat.ts`
- `server/src/services/activity-log.ts`
- `server/src/routes/meetings.ts`
- `server/src/routes/issues.ts`
- `server/src/routes/authz.ts`
- `server/src/__tests__/meetings-service.test.ts`
- `server/src/__tests__/company-skills-routes.test.ts`

### 4.3 UI

- `ui/src/pages/IssueDetail.tsx`
- `ui/src/components/IssueProperties.tsx`
- `ui/src/components/MeetingRoomPanel.tsx`
- `ui/src/components/office/OfficeConversationPanel.tsx`
- `ui/src/pages/OfficeView.tsx`
- `ui/src/pages/officeViewModel.ts`
- `ui/src/pages/Inbox.tsx`
- `ui/src/pages/Issues.tsx`
- `ui/src/pages/AgentDetail.tsx`
- `ui/src/pages/MyIssues.tsx`
- `ui/src/lib/meeting-room.ts`
- `ui/src/lib/issue-detail-controls.ts`
- `ui/src/lib/inbox.ts`
- `ui/src/lib/queryKeys.ts`
- `ui/src/pages/Inbox.test.tsx`
- `ui/src/pages/OfficeView.model.test.ts`
- `ui/src/lib/meeting-room.test.ts`
- `ui/src/lib/issue-detail-controls.test.ts`

### 4.4 docs

- `doc/plans/2026-04-07-facilitated-meeting-orchestrator-plan.md`
- `doc/plans/2026-04-07-facilitated-meeting-orchestrator-cross-verification.md`
- `doc/plans/2026-04-07-facilitated-meeting-orchestrator-phase-b-cross-verification.md`
- `doc/plans/2026-04-07-facilitated-meeting-orchestrator-phase-c-cross-verification.md`
- `doc/plans/2026-04-07-facilitated-meeting-orchestrator-phase-d-cross-verification.md`
- `doc/plans/2026-04-07-facilitated-meeting-orchestrator-phase-e-cross-verification.md`
- `doc/plans/2026-04-07-facilitated-meeting-orchestrator-phase-f-cross-verification.md`

## 5. known exception / skeleton / 현재 한계

### 5.1 의도적 skeleton

- `POST /issues/:issueId/meeting/cancel`

위 endpoint는 아직 `501` skeleton이다. reviewer는 이를 회귀와 구분해야 한다.

### 5.2 현재 검증 환경에서 남아 있는 failure

- `cli/src/__tests__/company-import-export-e2e.test.ts`
  - full suite에서는 `beforeAll` hook timeout으로 실패
  - standalone 재실행은 통과

참고:

- `server/src/__tests__/company-skills-routes.test.ts`는 latest full-suite와 standalone 재실행 모두 통과했고, 현재 known blocker로 보지 않는다.

따라서 현재 최종 판정은 workspace-wide green이 아니라 `Conditional Pass`다.

## 6. 이번 기준에서 실제 수행한 검증

### 6.1 통과

- `git diff --check`
- `TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm -r typecheck`
- `TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm build`
- `TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm --filter @paperclipai/server exec vitest run src/__tests__/company-skills-routes.test.ts`
- `TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm --filter @paperclipai/ui exec vitest run src/lib/issue-detail-controls.test.ts`

### 6.2 관련 targeted test 상태

- `TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm --filter @paperclipai/server exec vitest run src/__tests__/meetings-service.test.ts`
  - `14` tests passed
- `TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm --filter @paperclipai/ui exec vitest run src/lib/meeting-room.test.ts src/pages/Inbox.test.tsx src/pages/OfficeView.model.test.ts`
  - `33` tests passed
- `TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm --filter @paperclipai/ui exec vitest run src/lib/issue-detail-controls.test.ts`
  - `3` tests passed
- `TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm --filter @paperclipai/server exec vitest run src/__tests__/company-skills-routes.test.ts`
  - `3` tests passed

### 6.3 full suite 상태

- `TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm test:run`
- 결과:
  - `154` test files passed
  - `1` test file failed
  - `821` tests passed
  - `2` skipped
- 실패:
  - `cli/src/__tests__/company-import-export-e2e.test.ts`

### 6.4 standalone verification 상태

- `TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm exec vitest run src/__tests__/company-import-export-e2e.test.ts` (in `cli/`)
- 결과:
  - `1` test file passed
  - `1` test passed

## 7. reviewer에게 같이 전달할 메모

- 이번 최종 검토는 개별 phase correctness보다, **서로 다른 층의 계약이 끝까지 일관되게 닫혔는지**를 보는 검토다.
- reviewer는 특히 아래 여섯 가지를 집중해서 보면 된다.
  - root meeting issue guard가 route와 UI 양쪽에서 일관된지
  - state machine과 transcript projection이 summary/final completion까지 모순 없이 이어지는지
  - wakeup suppression / mention suppression / non-canonical surface exclusion이 실제 코드 경로에서 새지 않는지
  - unread / recency / activity log / meeting_completed signal이 같은 사건을 서로 다른 의미로 해석하지 않는지
  - participantAgentId / MyIssues / Inbox / Office / IssueDetail이 같은 meeting을 서로 다른 방식으로 잘못 분류하지 않는지
  - known flaky/full-suite blockers가 회의 기능 회귀와 분리 가능한지

## 8. 전달용 프롬프트

```text
이번 변경은 전체회의 토론 오케스트레이터의 최종 구현분입니다.
Phase A~F를 모두 거친 상태에서 최종 종합 교차검증을 요청드립니다.

기준:
- base commit: 921d82c8
- implementation fix commit: 9a16338b
- read-only UI regression-hardening commits: f19145bc, 789dd2dc
- doc/plans/2026-04-07-facilitated-meeting-orchestrator-plan.md
- doc/plans/2026-04-07-facilitated-meeting-orchestrator-cross-verification.md
- doc/plans/2026-04-07-facilitated-meeting-orchestrator-final-cross-verification.md

중요:
- 이번 검토는 개별 phase correctness보다, generic issue plane / orchestrated meeting plane / transcript / wakeup / unread / activity log가 최종적으로 서로 모순 없이 닫혔는지를 보는 최종 검토입니다.
- /meeting/cancel endpoint는 아직 의도적으로 501 skeleton입니다.
- 현재 full pnpm test:run은 cli/src/__tests__/company-import-export-e2e.test.ts beforeAll hook timeout 1건 때문에 Conditional Pass 상태입니다.
- company-import-export-e2e는 standalone 재실행은 통과했고, server/src/__tests__/company-skills-routes.test.ts는 latest full-suite와 standalone 모두 통과했습니다.

반드시 봐 주세요:
- root meeting issue route/UI read-only guard
- issues.status mirror vs issue_meetings.status canonical source
- child issue canonical work surface + wakeup suppression
- summary/final summary/transcript projection/final completion
- meeting_completed signal / unread / recency / activity log
- MeetingRoomDTO 기반 UI와 participantAgentId / MyIssues / Inbox / Office / IssueDetail 일관성

특히 frozen decision을 구현이 어디서 깨는지, 또는 서로 다른 층이 같은 사건을 다르게 해석하는 지점이 있는지 중심으로 봐 주세요.
결과는 findings-first 형식으로, severity와 file/line reference를 포함해 정리해 주세요.
```
