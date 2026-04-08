# 전체회의 운영자 코멘트 교차검증 지시서

## 1. 문서 목적

이 문서는 `전체회의 오케스트레이터`에 새로 추가된 **운영자 코멘트 입력/반영 기능**과 그 후속 UX 정리까지 reviewer에게 별도로 넘길 때 사용하는 전달용 교차검증 지시서다.

- 기준 변경셋:
  - orchestrator final baseline: `766230f7`
  - operator comment implementation commit: `bfcc3c6c`
  - discussion UX follow-up: operator comment panel relocation, collapsed round summary, office thread cleanup action
  - reopen discussion from summary: `4202b311`
- 브랜치: `local/2026-04-02-korean-ui-backup`
- 구현 기준 문서:
  - `doc/plans/2026-04-07-facilitated-meeting-orchestrator-plan.md`
  - `doc/plans/2026-04-07-facilitated-meeting-orchestrator-final-cross-verification.md`

현재 판정은 **Conditional Pass**다.

- 회의 room 안에서 운영자가 직접 코멘트를 남길 수 있음
- 그 코멘트가 transcript에 `운영자 코멘트`로 보임
- 이후 `다음 라운드 진행 / 재촉 / 최종 요약` 시 생성되는 participant prompt에 운영자 코멘트가 포함됨
- 운영자 코멘트 입력창이 transcript 상단이 아니라 **마지막 회의 글 아래**에 위치함
- `round_summary` transcript entry는 기본 접힘 상태라 원문 반복을 덜어 줌
- 오피스 목록에서 회의/대화를 **정리** 버튼으로 숨길 수 있음
- summary 단계에서 멈춘 회의는 `전원 재토론`으로 followup 라운드를 다시 열 수 있음
- `pnpm -r typecheck`, `pnpm build`, feature-targeted test는 통과함
- latest full-suite `pnpm test:run`은 `cli/src/__tests__/company-import-export-e2e.test.ts`의 `beforeAll` timeout 1건으로 실패함
- 즉, 이번 handoff는 `feature-targeted pass, workspace full-suite red` 기준이다

## 2. 이번 변경에서 완료된 항목

### 2.1 운영자 코멘트 입력 UI 추가

- `MeetingRoomPanel`에 회의 전용 운영자 코멘트 입력창 추가
- 입력창을 transcript 상단이 아니라 **가장 마지막 회의 글 아래**로 이동
- 종료된 회의에서는 입력 비활성화
- 저장 성공 시 meeting/detail/list/activity/runs 계열 query invalidate
- 이번 변경에서는 helper-level gating test는 추가됐지만, `MeetingRoomPanel`의 textarea submit / toast / invalidate를 직접 누르는 컴포넌트 interaction test는 아직 없음

주요 파일:

- `ui/src/components/MeetingRoomPanel.tsx`
- `ui/src/lib/meeting-room.ts`
- `ui/src/lib/meeting-room.test.ts`

### 2.2 transcript projection에 운영자 코멘트 반영

- root meeting issue의 `authorKind = "user"` comment를 transcript에 `operator_comment` entry로 투영
- 기존 `operator_signal` system comment와 구분
- meeting activity log에 `meeting.operator_comment_added` 기록
- `round_summary` entry는 기본 접힘 상태로 렌더링해 중복 독서 부담을 낮춤

주요 파일:

- `packages/shared/src/types/meeting.ts`
- `server/src/services/meetings.ts`

### 2.3 다음 라운드 프롬프트에 운영자 코멘트 반영

- discussion round prompt에 운영자 코멘트 섹션 추가
- summary round prompt에도 운영자 코멘트 섹션 추가
- opening/discussion/summary 라운드별로 포함 범위를 다르게 계산

핵심 규칙:

- opening: 라운드 시작 이후 작성된 운영자 코멘트만 포함
- discussion/followup: 이전 라운드 요약 이후 작성된 운영자 코멘트만 포함
- summary: 회의 전체 동안 누적된 운영자 코멘트를 포함

주요 파일:

- `server/src/services/meetings.ts`
- `server/src/__tests__/meetings-service.test.ts`

### 2.4 오피스 목록 정리 액션 추가

- 회의/대화 카드마다 `정리` 액션 추가
- orchestrated meeting root는 meeting archive endpoint로 soft-hide
- 일반 대화는 기존 issue `hiddenAt` 업데이트로 soft-hide
- 기록은 남겨 두고 오피스 목록에서만 제거

주요 파일:

- `ui/src/components/office/OfficeConversationPanel.tsx`
- `ui/src/pages/OfficeView.tsx`
- `ui/src/api/meetings.ts`
- `server/src/routes/meetings.ts`
- `server/src/services/meetings.ts`

### 2.5 summary 단계에서 전원 재토론 재개

- `summary + awaiting_operator` 상태에서만 `전원 재토론` 버튼 노출
- 이 액션은 현재 summary round를 취소하고, 다음 번호의 `followup` round를 새로 열어 active participant 전원을 다시 dispatch
- summary 단계에서 추가한 운영자 코멘트도 새 followup prompt에 포함
- 즉, "최종 요약으로 넘어가서 멈춘 상태"에서도 운영자가 다시 CEO/CTO/CMO 전원 토론으로 되돌릴 수 있음

주요 파일:

- `server/src/services/meetings.ts`
- `server/src/routes/meetings.ts`
- `server/src/__tests__/meetings-service.test.ts`
- `ui/src/api/meetings.ts`
- `ui/src/components/MeetingRoomPanel.tsx`
- `ui/src/lib/meeting-room.ts`
- `ui/src/lib/meeting-room.test.ts`

## 3. 이번 변경의 의도적 동작

- 운영자 코멘트는 **현재 진행 중인 라운드를 즉시 끊어들어 재디스패치하지 않는다**
- 대신 다음 회의 전이에서 반영된다
  - `continue`
  - `summary`
  - `remind`
- 다만 summary 단계가 이미 열려 있고 운영자 판단 상태라면, 운영자는 `전원 재토론`으로 새 followup round를 다시 열 수 있다
- 저장 경로는 별도 meeting-only endpoint가 아니라 기존 root issue comment 저장 경로를 재사용한다
- 다만 orchestrated meeting root는 generic wakeup suppression이 이미 적용되어 있어, 운영자 코멘트가 out-of-band assignee wakeup이나 mention fan-out을 만들지 않아야 한다

즉 reviewer는 기본적으로 "지금 입력하면 바로 에이전트가 다시 말하기 시작하는가?"를 기대하면 안 되고, "다음 회의 전이의 입력 컨텍스트로 들어가는가?"를 봐야 한다.
예외적으로 summary/awaiting_operator에서는 `전원 재토론` 액션으로 전원을 다시 말하게 할 수 있다.

## 4. reviewer에게 반드시 요청할 검토 항목

- `MeetingRoomPanel`에서 운영자 코멘트 입력 UI가 실제로 보이는지
- 입력창이 transcript 맨 아래, 마지막 회의 글 아래에 위치하는지
- completed / partial_completed / failed / cancelled 상태에서 입력이 비활성화되는지
- root meeting issue에 저장된 user comment가 transcript에서 `operator_comment`로 보이는지
- 기존 `operator_signal` system comment와 `operator_comment` user comment가 구분되는지
- `round_summary`가 기본 접힘 상태인지
- discussion/followup prompt가 운영자 코멘트를 포함하는지
- summary prompt도 운영자 코멘트를 포함하는지
- summary/awaiting_operator 상태에서만 `전원 재토론` 버튼이 보이는지
- `전원 재토론` 실행 시 새 `followup` round가 열리고 active participant 전원이 다시 dispatch되는지
- summary 단계에서 작성한 운영자 코멘트가 그 새 followup prompt에도 포함되는지
- 운영자 코멘트 저장이 meeting activity에 `meeting.operator_comment_added`로 남는지
- 이 경로가 generic issue comment wakeup suppression을 깨지 않는지
- 여전히 root orchestrated meeting issue의 generic lifecycle UI는 read-only인지
- 오피스 목록에서 `정리` 액션이 회의/대화를 soft-hide하는지

## 5. reviewer가 반드시 볼 파일

### 5.1 shared / server

- `packages/shared/src/types/meeting.ts`
- `server/src/services/meetings.ts`
- `server/src/routes/issues.ts`
- `server/src/routes/meetings.ts`
- `server/src/__tests__/meetings-service.test.ts`

### 5.2 UI

- `ui/src/components/MeetingRoomPanel.tsx`
- `ui/src/components/office/OfficeConversationPanel.tsx`
- `ui/src/lib/meeting-room.ts`
- `ui/src/lib/meeting-room.test.ts`
- `ui/src/pages/IssueDetail.tsx`
- `ui/src/pages/OfficeView.tsx`

### 5.3 기준 문서

- `doc/plans/2026-04-07-facilitated-meeting-orchestrator-plan.md`
- `doc/plans/2026-04-07-facilitated-meeting-orchestrator-final-cross-verification.md`
- `doc/plans/2026-04-08-meeting-operator-comment-cross-verification.md`

## 6. 이번 변경에서 실제 수행한 검증

### 6.1 통과

- `git diff --check`
- `TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm --filter @paperclipai/server exec vitest run src/__tests__/meetings-service.test.ts`
- `TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm --filter @paperclipai/ui exec vitest run src/lib/meeting-room.test.ts src/pages/OfficeView.model.test.ts`
- `TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm -r typecheck`
- `TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm build`
- `TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm --filter paperclipai exec vitest run src/__tests__/company-import-export-e2e.test.ts`

### 6.2 targeted test 상태

- `server/src/__tests__/meetings-service.test.ts`
  - `16` tests passed
- `ui/src/lib/meeting-room.test.ts` + `ui/src/pages/OfficeView.model.test.ts`
  - `33` tests passed
- 현재 UI 쪽 직접 interaction 검증은 별도 컴포넌트 테스트가 아니라 helper-level test까지만 포함됨
- 즉 `MeetingRoomPanel`의 `issuesApi.addComment()` 호출, toast, query invalidation, textarea/button disabled 상태는 reviewer가 코드 기준으로 추가 확인해야 함

### 6.3 full suite 상태

- `TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm test:run`
- 결과:
  - `154` test files passed
  - `1` test file failed
  - `826` tests passed
  - `2` skipped
- 실패:
  - `cli/src/__tests__/company-import-export-e2e.test.ts`
  - `beforeAll` timeout

즉, 이번 변경은 feature-targeted verification 기준으로는 통과했지만, workspace full-suite는 현재도 green이 아니므로 문서 판정은 `Conditional Pass`가 맞다.

### 6.4 standalone CLI E2E 상태

- `TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm --filter paperclipai exec vitest run src/__tests__/company-import-export-e2e.test.ts`
- 결과:
  - `1` test file passed
  - `1` test passed

즉 `company-import-export-e2e`는 standalone으로는 통과하고, 현재 red는 full-suite 병렬 환경에서만 재현된다.

## 7. reviewer에게 같이 전달할 메모

- 이번 변경은 "운영자가 회의방에 의견을 남기고, 다음 토론/요약에서 그 의견에 대한 반응을 받는 루프"를 여는 변경이다.
- 동시에 transcript 가독성을 위해 라운드 요약은 기본 접힘으로 줄이고, 입력창은 마지막 회의 글 아래로 내렸다.
- 오래된 회의/대화는 `정리` 액션으로 오피스 목록에서만 숨길 수 있다.
- summary 단계에서 멈춘 경우에는 `전원 재토론`으로 새 followup round를 열어 전원 participant를 다시 토론에 참여시킬 수 있다.
- 즉시 인터럽트형 개입이 아니라 **다음 회의 전이에서 반영되는 입력**이라는 점을 기준으로 봐 달라.
- reviewer는 특히 transcript entry 종류(`operator_comment` vs `operator_signal`)와 prompt builder가 운영자 코멘트를 실제로 가져가는지에 집중하면 된다.

## 8. 전달용 프롬프트

```text
이번 변경은 전체회의 room에 운영자 코멘트 입력을 추가하고, 그 코멘트를 다음 토론/최종 요약 prompt에 반영하는 기능입니다.
추가로 운영자 코멘트 입력창을 마지막 회의 글 아래로 내리고, 라운드 요약은 기본 접힘 처리했으며, 오피스 목록에서 회의/대화를 정리(soft-hide)하는 액션도 같이 들어갔습니다.
또한 summary 단계에서 멈춘 회의는 전원 재토론으로 새 followup round를 열어 active participant 전원을 다시 토론에 참여시킬 수 있습니다.
아래 문서와 커밋을 기준으로 교차검증해 주세요.

기준:
- baseline: 766230f7
- implementation commit: bfcc3c6c
- reopen discussion from summary: 4202b311
- branch: local/2026-04-02-korean-ui-backup
- doc/plans/2026-04-07-facilitated-meeting-orchestrator-plan.md
- doc/plans/2026-04-07-facilitated-meeting-orchestrator-final-cross-verification.md
- doc/plans/2026-04-08-meeting-operator-comment-cross-verification.md

중요:
- 운영자 코멘트는 현재 라운드를 즉시 다시 돌리는 기능이 아닙니다.
- 대신 다음 continue / remind / summary 전이에서 participant prompt에 포함됩니다.
- transcript에서는 operator_signal(system)과 operator_comment(user)를 구분해서 봐 주세요.

반드시 봐 주세요:
- MeetingRoomPanel에 운영자 코멘트 입력창이 실제로 보이는지
- 입력창이 transcript 맨 아래에 배치됐는지
- 종료 상태에서는 입력이 비활성화되는지
- root user comment가 transcript에서 operator_comment로 보이는지
- round_summary가 기본 접힘 상태인지
- discussion/followup prompt에 운영자 코멘트가 포함되는지
- summary prompt에도 운영자 코멘트가 포함되는지
- summary/awaiting_operator 상태에서만 전원 재토론 버튼이 보이는지
- 전원 재토론 실행 시 새 followup round가 열리고 active participant가 다시 dispatch되는지
- summary 단계 운영자 코멘트가 그 followup prompt에도 포함되는지
- meeting.operator_comment_added activity가 기록되는지
- 이 경로가 generic wakeup suppression을 깨지 않는지
- 오피스 목록에서 정리 액션이 회의/대화를 soft-hide하는지

결과는 findings-first 형식으로, severity와 file/line reference를 포함해 정리해 주세요.
```
