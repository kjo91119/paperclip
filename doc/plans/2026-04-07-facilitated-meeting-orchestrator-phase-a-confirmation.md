# 전체회의 오케스트레이터 Phase A 교차검증 확인서

## 1. 문서 목적

이 문서는 `전체회의 토론 오케스트레이터`의 **Phase A 구현분**을 교차검증에 넘길 때 사용하는 전달용 확인서다.

- 기준 커밋: `caf0f353`
- 브랜치: `local/2026-04-02-korean-ui-backup`
- 구현 기준 문서:
  - `doc/plans/2026-04-07-facilitated-meeting-orchestrator-plan.md`
  - `doc/plans/2026-04-07-facilitated-meeting-orchestrator-cross-verification.md`

이 확인서는 "이번 커밋에서 실제로 들어간 Phase A 범위"와 "아직 skeleton 또는 후속 구현이 남아 있는 범위"를 분리해서 적는다.

현재 판정은 **Conditional Pass**다.

- Phase A 핵심 계약은 구현됨
- 다만 reviewer가 알아야 할 known gap 몇 가지는 남아 있으며, 이는 아래 별도 섹션에 적는다

## 2. 이번 커밋에서 완료된 항목

### 2.1 데이터 모델 / shared contract

- `issue_meetings`, `issue_meeting_participants`, `issue_meeting_rounds`, `issue_meeting_round_participants` schema 추가
- `issue_comments`에 `authorKind`, `authorSystemKey`, `systemCommentKind` 추가
- meeting 관련 shared constants / types / validators 추가
- `Issue` payload에 meeting metadata(`meetingId`, `meetingMode`, `meetingStatus`, `meetingCurrentRoundNumber`, `meetingCurrentRoundKind`, `meetingNeedsAttention`) 추가
- `IssueComment` payload에 author model 추가

주요 파일:

- `packages/db/src/schema/issue_meetings.ts`
- `packages/db/src/schema/issue_comments.ts`
- `packages/shared/src/constants.ts`
- `packages/shared/src/types/issue.ts`
- `packages/shared/src/types/meeting.ts`
- `packages/shared/src/validators/meeting.ts`

### 2.2 server issues plane 보강

- `createIssueInTx`, `addIssueCommentInTx` tx-aware helper 추가
- `participatedByAgentCondition()`에 orchestrated meeting participant join 추가
- `meetingMode` 계산(`orchestrated` / `legacy_thread`)과 meeting metadata enrich 추가
- unread / recency SQL을 새 comment author model에 맞게 갱신
- `ui/src/lib/inbox.ts`가 소비하는 signal/recency 계약과 맞도록 `lastExternalCommentAt` / unread 계산을 서버 기준에서 정리
- root orchestrated meeting issue generic guard 추가
  - `PATCH`
  - `checkout`
  - `release`
  - `comment reopen`
  - `delete`
- orchestrated meeting root/child issue의 generic comment wakeup suppression 추가

주요 파일:

- `server/src/services/issues.ts`
- `server/src/routes/issues.ts`

### 2.3 meetings plane skeleton

- `meetingService` skeleton 추가
- `GET /api/meetings/:meetingId`
- `GET /api/issues/:issueId/meeting`
- root issue `issues.status` mirror helper skeleton 추가
- meeting status 전이와 root `issues.status` mirror를 같은 mutation 단위로 묶기 위한 중앙 helper 방향 추가

주요 파일:

- `server/src/services/meetings.ts`
- `server/src/routes/meetings.ts`
- `server/src/app.ts`

### 2.4 UI / rendering 정합성

- root orchestrated meeting issue에서 `IssueProperties`를 read-only로 제한
- `MyIssues`에서 `meetingMode = orchestrated` root issue 기본 제외
- `CommentThread`, `OfficeConversationPanel`에서 `authorKind` 기반 렌더링 반영
- optimistic comment/test fixture를 새 author model에 맞게 갱신

주요 파일:

- `ui/src/components/IssueProperties.tsx`
- `ui/src/pages/IssueDetail.tsx`
- `ui/src/pages/MyIssues.tsx`
- `ui/src/components/CommentThread.tsx`
- `ui/src/components/office/OfficeConversationPanel.tsx`
- `ui/src/lib/optimistic-issue-comments.ts`

## 3. 이번 커밋에서 부분 완료 또는 skeleton 상태인 항목

아래는 Phase A 문서에 걸쳐 있지만, 이번 커밋에서는 **계약/뼈대만 들어갔거나 아직 후속 구현이 남아 있는 항목**이다.

### 3.1 partial

- `MeetingRoomDTO`는 추가됐지만 transcript projection은 아직 빈 배열 skeleton이다.
- root issue `issues.status` mirror helper는 추가됐지만, 실제 meeting mutation flow 전체에 연결된 상태는 아니다.
- 최소 participant 수 validator는 meeting validator에 추가됐지만, public create route는 아직 `501` skeleton이다.
- `issue_meeting_round_participants`는 baseline schema는 들어갔지만, Phase B 운영 필드(`reminded_count`, `dispatched_at`, `timed_out_at`, `skipped_at`, `skip_reason`, `last_error_code`)는 아직 없다.
- `issue_comments` author model은 service validation으로는 보호되지만, DB-level check constraint는 아직 없다.

### 3.2 deferred to next implementation step

- root issue + hidden child issue 생성 로직
- hidden child issue internal transaction 생성 경로
- meeting mutation + activity logging 중앙 helper의 실제 사용 경로
- root issue 최소 attention signal / debug projection의 실제 발화 흐름
- create/control meeting POST endpoint 본 구현

즉, 이번 커밋은 **Phase A의 contract / guard / payload / schema 기반을 닫는 작업**에 가깝고, 회의 실행 자체는 아직 시작 단계다.

## 4. 교차검증 시 반드시 확인해 달라고 요청할 항목

리뷰어는 아래를 우선적으로 봐야 한다.

- schema / shared / server / UI contract가 서로 어긋나지 않는지
- tx-aware `createIssueInTx` / `addIssueCommentInTx` helper가 실제로 추가되어 이후 meeting transaction의 기반이 되는지
- root orchestrated meeting issue가 generic issue plane에서 lifecycle 변경되지 않는지
- `IssueComment` author model이 unread / recency / rendering에 일관되게 연결되는지
- `ui/src/lib/inbox.ts` 기준 signal / recency 해석과 서버 unread / `lastExternalCommentAt` 계산이 어긋나지 않는지
- `participatedByAgentCondition()`가 orchestrated meeting root issue를 포함하는지
- orchestrated meeting root/child issue에서 generic comment wakeup이 새지 않는지
- `meetingMode`, `meetingStatus` 등 metadata가 payload에 안정적으로 포함되는지
- root issue `issues.status` mirror helper와 meeting service skeleton이 generic list/filter 계약과 충돌하지 않는지
- UI가 root meeting issue를 일반 triage issue처럼 잘못 편집하거나 노출하지 않는지

## 5. 이번 커밋에서 실제 수행한 검증

### 5.1 통과

- `git diff --check`
- `TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm -r typecheck`
- `pnpm db:generate`
- `TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm build`
- 단독 재검증:
  - `pnpm --filter @paperclipai/server exec vitest run src/__tests__/issues-service.test.ts`
  - `pnpm --filter @paperclipai/server exec vitest run src/__tests__/issue-comment-reopen-routes.test.ts`
  - `pnpm --filter paperclipai exec vitest run src/__tests__/company-import-export-e2e.test.ts`

### 5.2 전체 테스트 스위트 상태

- `TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm test:run`
  - 대부분 통과
  - 단, 전체 병렬 실행에서는 `cli/src/__tests__/company-import-export-e2e.test.ts` 가 `http://127.0.0.1:<port>/api/health` 대기 timeout으로 실패했다
  - 같은 테스트를 단독 재실행하면 통과했다

현재 해석:

- 이번 변경으로 인한 deterministic regression이라기보다는
- 전체 병렬 부하 또는 서버 startup timing에 영향을 받는 기존성 플래키에 가깝다

따라서 교차검증 시에는:

- 이번 커밋의 명확한 회귀는 이미 수정 완료됐는지
- 남은 `company-import-export-e2e` timeout이 실제 코드 회귀인지 환경성 플래키인지

를 분리해서 판단해 달라고 요청하는 것이 맞다.

### 5.3 이번 확인서 작성 후 reviewer 피드백으로 추가 확인된 known gap

- `issue_meeting_round_participants`에 계획 §6.4 기준 운영 필드 6개가 아직 없다
  - `reminded_count`
  - `dispatched_at`
  - `timed_out_at`
  - `skipped_at`
  - `skip_reason`
  - `last_error_code`
- `issue_comments.authorKind` 관련 DB-level check constraint는 아직 없다
- root orchestrated meeting issue guard에 대한 전용 unit test는 아직 추가하지 않았다

현재 판단:

- 첫 번째 항목은 **Phase B 착수 전 migration 보강 필요**
- 두 번째와 세 번째 항목은 **Phase A merge blocker는 아니지만 계약 불일치/테스트 보강 포인트로 추적 필요**

## 6. 리뷰어에게 같이 전달할 메모

- 이번 커밋은 Phase A 전체 중에서도 **schema / contract / guard / metadata / wakeup suppression** 중심이다.
- create/control POST endpoint가 `501`인 것은 현재 구현 상태 그대로이며, reviewer는 이를 "구현 누락"으로는 볼 수 있어도 "숨은 회귀"와는 구분해 주는 것이 맞다.
- `company-import-export-e2e`는 전체 병렬 스위트에서는 timeout, 단독 재실행에서는 통과했다.
- reviewer는 cross-verification Phase A 기준에 들어 있는 `tx-aware helper`, `issues.status mirror`, `ui/src/lib/inbox.ts` 검토를 생략하지 않는 것이 좋다.
- 알려진 잔여 gap:
  - round participant 운영 필드 6개 미추가
  - comment author DB check constraint 미구현
  - root guard 전용 단위 테스트 미추가
- `.workflow/`, `doc/plans/2026-04-05-ai-company-messenger-roadmap.md`는 이번 작업 범위 밖이다.

## 7. 전달용 프롬프트

```text
이번 변경은 전체회의 토론 오케스트레이터의 Phase A 구현분입니다.
아래 문서와 커밋을 기준으로 교차검증해 주세요.

기준:
- commit: caf0f353
- doc/plans/2026-04-07-facilitated-meeting-orchestrator-plan.md
- doc/plans/2026-04-07-facilitated-meeting-orchestrator-cross-verification.md
- doc/plans/2026-04-07-facilitated-meeting-orchestrator-phase-a-confirmation.md

중요:
- 이번 커밋은 Phase A 전체 중 schema / shared contract / root invariant guard / unread-author model / meeting metadata / wakeup suppression 중심입니다.
- meeting create/control POST endpoint는 아직 501 skeleton입니다.
- 이를 회귀와 구분해서 검토해 주세요.
- known gap:
  - issue_meeting_round_participants의 일부 Phase B 운영 필드는 아직 없습니다.
  - issue_comments author model의 DB check constraint는 아직 없습니다.
  - root guard 전용 단위 테스트는 아직 없습니다.

반드시 봐 주세요:
- meeting schema / shared types / validators 정합성
- tx-aware createIssueInTx / addIssueCommentInTx helper
- issue comment author model과 unread/recency SQL 정합성
- ui/src/lib/inbox.ts signal / recency 계산
- root orchestrated meeting issue generic guard
- issues.status mirror helper
- participatedByAgentCondition 확장
- root/child generic comment wakeup suppression
- UI read-only / triage 예외 처리

검증 결과는 findings-first 형식으로, 파일/라인 기준으로 정리해 주세요.
```
