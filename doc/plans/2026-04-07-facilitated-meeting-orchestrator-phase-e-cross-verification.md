# 전체회의 오케스트레이터 Phase E 교차검증 지시서

## 1. 문서 목적

이 문서는 `전체회의 토론 오케스트레이터`의 **Phase E UI 통합 구현분**을 reviewer에게 넘길 때 사용하는 전달용 교차검증 지시서다.

- 기준 변경셋:
  - Phase D handoff/docs base commit: `9e612d9c`
  - Phase E implementation commit: `afb0f815`
- 브랜치: `local/2026-04-02-korean-ui-backup`
- 구현 기준 문서:
  - `doc/plans/2026-04-07-facilitated-meeting-orchestrator-plan.md`
  - `doc/plans/2026-04-07-facilitated-meeting-orchestrator-cross-verification.md`

이번 문서는 "Phase E에서 실제로 구현된 범위", "아직 Phase F 이후로 남겨둔 범위", "reviewer가 반드시 봐야 할 검토 포인트"를 분리해서 적는다.

현재 판정은 **Conditional Pass**다.

- orchestrated meeting UI가 `MeetingRoomDTO`를 실제 렌더링 소스로 사용하도록 IssueDetail / Office / Inbox 경로가 연결됨
- meetingMode 기반 판별과 legacy fallback, unassigned root meeting deep-link, Office meeting create API 전환까지 반영됨
- `git diff --check`, `pnpm -r typecheck`, `pnpm build`, 관련 UI/server targeted tests는 통과했음
- 다만 full-suite `pnpm test:run`에서는 여전히 `company-import-export-e2e` beforeAll timeout이 1건 발생했고, 같은 파일 단독 재실행은 통과했음

## 2. 이번 변경에서 완료된 항목

### 2.1 MeetingRoomDTO 기반 UI 렌더링

- orchestrated meeting root issue가 raw `/issues/:id/comments`가 아니라 `/issues/:issueId/meeting` DTO를 사용하도록 전환
- `MeetingRoomDTO.currentRoundParticipants` read model 추가
- reusable `MeetingRoomPanel` 추가
  - 회의 상태 헤더
  - transcript
  - participant status panel
  - `start / pause / resume / continue / summary / remind / skip` control actions

주요 파일:

- `packages/shared/src/types/meeting.ts`
- `packages/shared/src/types/index.ts`
- `packages/shared/src/index.ts`
- `server/src/services/meetings.ts`
- `ui/src/components/MeetingRoomPanel.tsx`
- `ui/src/lib/meeting-room.ts`
- `ui/src/lib/meeting-room.test.ts`

### 2.2 IssueDetail / Office 통합

- `IssueDetail`에서 `meetingMode === "orchestrated"`인 경우 댓글 탭 대신 회의실 탭으로 `MeetingRoomPanel` 렌더링
- `OfficeView`에서 orchestrated meeting thread 선택 시 raw comment query를 끄고 meeting room query를 사용
- `OfficeConversationPanel`이 orchestrated root에서는 compact `MeetingRoomPanel`을 렌더링
- Office 상단/패널 copy를 legacy meeting thread 전제에서 orchestrated meeting room 전제로 정리
- legacy meeting thread는 기존 comment timeline fallback으로 계속 지원

주요 파일:

- `ui/src/pages/IssueDetail.tsx`
- `ui/src/pages/OfficeView.tsx`
- `ui/src/components/office/OfficeConversationPanel.tsx`
- `ui/src/pages/officeViewModel.ts`

### 2.3 Office meeting composer 전환

- Office의 `전체회의` 생성이 더 이상 embedded marker 기반 `issues.create`를 쓰지 않고 `POST /api/companies/:companyId/meetings`를 사용
- facilitator / participant / referencePath / projectId를 meeting create payload로 전달
- orchestrated meeting thread에서는 generic comment composer를 비활성화

주요 파일:

- `ui/src/api/meetings.ts`
- `ui/src/pages/OfficeView.tsx`

### 2.4 meeting 판별 / deep-link 정리

- `isOfficeMeetingIssue()`가 `issue.meetingMode`를 우선 사용하고, 기존 description marker는 fallback으로만 유지
- Inbox에서 unassigned orchestrated root meeting issue도 Office meeting room으로 deep-link 가능하게 수정
- `MyIssues`의 orchestrated root 제외 동작은 유지

주요 파일:

- `ui/src/pages/officeViewModel.ts`
- `ui/src/pages/Inbox.tsx`
- `ui/src/pages/MyIssues.tsx`
- `ui/src/pages/OfficeView.model.test.ts`

### 2.5 reviewer handoff 문서 drift 수정

- 공통 기준 문서 Phase D 필수 검토 파일 목록을 현재 코드 구조에 맞게 `server/src/services/meetings.ts` 중심으로 정정
- Phase D handoff에 `activity-log.ts`, `issues.ts` 필수 검토 경로를 추가
- Phase D handoff의 full-suite 실패 경로를 실제 `cli/src/__tests__/company-import-export-e2e.test.ts`로 정정

주요 파일:

- `doc/plans/2026-04-07-facilitated-meeting-orchestrator-cross-verification.md`
- `doc/plans/2026-04-07-facilitated-meeting-orchestrator-phase-d-cross-verification.md`

## 3. 이번 변경에서 의도적으로 아직 남겨둔 범위

### 3.1 아직 skeleton 또는 후속 Phase 범위인 항목

- `POST /issues/:issueId/meeting/cancel`

위 엔드포인트는 아직 `501` skeleton이다. 이는 현재 변경 기준으로 **의도된 상태**이며, reviewer는 이를 회귀와 구분해야 한다.

### 3.2 아직 partial인 항목

- 비용 표시 / 라운드 상한 안내 / polish copy 정리는 Phase F 범위다
- 운영 가시성 badge/empty state 세부 polish는 Phase F 범위다
- `participantAgentId` 기반 참여 회의 노출은 서버 계약이 먼저 정리된 축이지만, Phase E reviewer는 `Issues.tsx` / `AgentDetail.tsx`가 이 필터 결과를 실제 UI 경로에서 놓치지 않는지까지 함께 확인해야 한다

즉 이번 변경은 **IssueDetail / Office / Inbox를 orchestrated meeting room으로 실제 연결하는 Phase E UI 통합**이다.

## 4. reviewer에게 반드시 요청할 검토 항목

리뷰어는 아래를 우선적으로 봐야 한다.

- IssueDetail과 Office가 raw `/issues/:id/comments` 대신 `MeetingRoomDTO`를 실제 렌더링 소스로 쓰는지
- `meetingMode === "orchestrated"`를 UI가 설명문 파싱보다 우선 사용하는지
- legacy meeting thread는 fallback으로 유지되는지
- root meeting issue의 generic properties 편집 UI가 read-only인지
- Office에서 새 `전체회의` 생성이 실제 meeting create endpoint를 타는지
- orchestrated meeting thread에서 generic comment composer가 비활성화되는지
- Inbox의 unassigned root meeting issue deep-link가 정상 동작하는지
- `MeetingRoomPanel` control action이 query invalidation과 함께 실제 화면을 갱신하는지
- participant status panel이 current round DTO를 기준으로 렌더링되는지
- `participantAgentId` 필터에서 orchestrated root meeting이 `Issues / AgentDetail`에 정상 반영되는지
- `MyIssues`가 root meeting issue를 미할당 triage처럼 보여주지 않는지

## 5. reviewer가 반드시 볼 파일

- `ui/src/pages/IssueDetail.tsx`
- `ui/src/pages/OfficeView.tsx`
- `ui/src/components/office/OfficeConversationPanel.tsx`
- `ui/src/pages/officeViewModel.ts`
- `ui/src/pages/Inbox.tsx`
- `ui/src/pages/Issues.tsx`
- `ui/src/pages/AgentDetail.tsx`
- `ui/src/pages/MyIssues.tsx`
- `ui/src/components/MeetingRoomPanel.tsx`
- `ui/src/lib/meeting-room.ts`
- `ui/src/api/meetings.ts`
- `ui/src/lib/queryKeys.ts`
- `ui/src/pages/OfficeView.model.test.ts`
- `ui/src/pages/Inbox.test.tsx`
- `ui/src/lib/meeting-room.test.ts`
- `server/src/services/meetings.ts`
- `server/src/services/issues.ts`
- `server/src/routes/meetings.ts`
- `packages/shared/src/types/meeting.ts`
- `doc/plans/2026-04-07-facilitated-meeting-orchestrator-plan.md`
- `doc/plans/2026-04-07-facilitated-meeting-orchestrator-cross-verification.md`

## 6. 이번 변경에서 실제 수행한 검증

### 6.1 통과

- `git diff --check`
- `TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm --filter @paperclipai/ui exec vitest run src/lib/meeting-room.test.ts src/pages/OfficeView.model.test.ts`
- `TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm --filter @paperclipai/ui exec vitest run src/pages/Inbox.test.tsx src/pages/OfficeView.model.test.ts src/lib/meeting-room.test.ts`
- `TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm --filter @paperclipai/server exec vitest run src/__tests__/meetings-service.test.ts`
- `TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm -r typecheck`
- `TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm build`

### 6.2 targeted test 상태

- `ui/src/lib/meeting-room.test.ts`
  - `3` tests passed
- `ui/src/pages/OfficeView.model.test.ts`
  - `26` tests passed
- `ui/src/pages/Inbox.test.tsx`
  - `2` tests passed
- `server/src/__tests__/meetings-service.test.ts`
  - `14` tests passed
- `cli/src/__tests__/company-import-export-e2e.test.ts`
  - 단독 재실행 `1` test passed

### 6.3 full suite 상태

- `TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm test:run`
- 결과:
  - `153` test files passed
  - `1` test file failed
  - `817` tests passed
  - `2` skipped
- 실패:
  - `cli/src/__tests__/company-import-export-e2e.test.ts`
  - `beforeAll` hook timeout (`120000ms`)

즉, 이번 handoff 기준에서는 Phase E 자체 흐름은 통과했지만 workspace 전체 green은 아직 보장하지 못하므로 `Conditional Pass`가 맞다. 참고로 같은 E2E 파일 단독 재실행은 통과했다.

## 7. reviewer에게 같이 전달할 메모

- 이번 변경은 UI가 orchestrated meeting plane과 raw issue comment plane을 섞지 않도록 정리하는 것이 핵심이다.
- reviewer는 특히 아래 다섯 가지를 집중해서 보면 된다.
- reviewer는 특히 아래 여섯 가지를 집중해서 보면 된다.
  - IssueDetail이 raw comments가 아니라 meeting DTO를 쓰는지
  - Office meeting thread가 compact meeting room으로 렌더링되는지
  - Inbox deep-link가 unassigned root meeting에서도 열리는지
  - Office의 새 전체회의 생성이 legacy marker issue가 아니라 real meeting create endpoint를 타는지
  - meetingMode 기반 판별이 description fallback보다 우선하는지
  - `Issues / AgentDetail`의 `participantAgentId` 경로에서 orchestrated root meeting이 빠지지 않는지
- 전체 `pnpm test:run` 실패는 현재도 `company-import-export-e2e` 한 건의 beforeAll timeout이며, 이번 회의/UI 변경과 직접 맞닿은 targeted tests는 통과했다.

## 8. 전달용 프롬프트

```text
이번 변경은 전체회의 토론 오케스트레이터 Phase E UI 통합입니다.
아래 문서와 커밋을 기준으로 교차검증해 주세요.

기준:
- base commit: 9e612d9c
- implementation commit: afb0f815
- doc/plans/2026-04-07-facilitated-meeting-orchestrator-plan.md
- doc/plans/2026-04-07-facilitated-meeting-orchestrator-cross-verification.md
- doc/plans/2026-04-07-facilitated-meeting-orchestrator-phase-e-cross-verification.md

중요:
- 이번 변경은 IssueDetail / Office / Inbox를 orchestrated meeting room으로 연결하는 UI 통합이 핵심입니다.
- /meeting/cancel endpoint는 아직 의도적으로 501 skeleton입니다.
- full pnpm test:run은 company-import-export-e2e beforeAll timeout으로 Conditional Pass 상태이며, 관련 회의/UI targeted tests와 같은 E2E 파일 단독 재실행은 통과했습니다.

반드시 봐 주세요:
- IssueDetail이 raw /issues/:id/comments 대신 MeetingRoomDTO를 쓰는지
- OfficeView / OfficeConversationPanel이 orchestrated meeting thread에서 compact meeting room을 쓰는지
- Office의 새 전체회의 생성이 issues.create가 아니라 meetings.create를 타는지
- orchestrated meeting thread에서 generic comment composer가 비활성화되는지
- meetingMode 기반 UI 판별이 description fallback보다 우선하는지
- Inbox에서 unassigned root meeting issue deep-link가 정상 동작하는지
- Issues / AgentDetail이 participantAgentId 기반 참여 회의를 실제로 보여주는지
- root meeting IssueProperties read-only와 MyIssues triage 제외가 유지되는지

특히 UI가 raw issue comment plane과 orchestrated meeting plane을 섞어 쓰지 않는지, 그리고 legacy meeting thread fallback은 깨지지 않았는지 집중해서 봐 주세요.

결과는 findings-first 형식으로, file/line reference와 함께 정리해 주세요.
```
