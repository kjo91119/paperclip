# 전체회의 오케스트레이터 Phase D 교차검증 지시서

## 1. 문서 목적

이 문서는 `전체회의 토론 오케스트레이터`의 **Phase D 구현분**을 reviewer에게 넘길 때 사용하는 전달용 교차검증 지시서다.

- 기준 변경셋:
  - Phase C base commit: `a767a6a8`
  - Phase D implementation commit: `f15c5998`
- 브랜치: `local/2026-04-02-korean-ui-backup`
- 구현 기준 문서:
  - `doc/plans/2026-04-07-facilitated-meeting-orchestrator-plan.md`
  - `doc/plans/2026-04-07-facilitated-meeting-orchestrator-cross-verification.md`

이번 문서는 "Phase D에서 실제로 구현된 범위", "아직 Phase E/F 이후로 남겨둔 범위", "reviewer가 반드시 봐야 할 검토 포인트"를 분리해서 적는다.

현재 판정은 **Conditional Pass**다.

- Phase D 목표 범위의 핵심 흐름은 구현됨
- `summary_requested_by_user_id` audit semantics, summary reassignment history, `meeting_completed` mandatory signal, `completed | partial_completed` 종료 semantics까지 연결됨
- `git diff --check`, `typecheck`, `build`, targeted `meetings-service.test.ts`는 통과했음
- 다만 full-suite 재검증에서는 `company-import-export-e2e` healthcheck timeout이 다시 재현되어, 전체 `pnpm test:run`은 아직 green으로 닫히지 않음

## 2. 이번 변경에서 완료된 항목

### 2.1 summary round / final summary flow

- `POST /api/issues/:issueId/meeting/summary` route wiring 추가
- `requestMeetingSummarySchema` 및 shared export 추가
- explicit summary 요청 구현
  - 현재 round가 usable response를 가진 경우 summary round 개시
  - current round summary가 없으면 먼저 mechanical round summary를 닫고 summary round 진입
- `continue`가 마지막 discussion/followup 이후 summary round로 전이되도록 구현
- summary round packet builder 추가
  - 이전 round summary 묶음
  - 안건 / 참고 경로 / 진행자
  - final recommendation 형식
- `summary_requested_by_user_id`가 operator 명시 요청일 때만 채워지도록 구현

주요 파일:

- `server/src/services/meetings.ts`
- `server/src/routes/meetings.ts`
- `packages/shared/src/validators/meeting.ts`
- `packages/shared/src/validators/index.ts`
- `packages/shared/src/index.ts`

### 2.2 summary reassignment / history 보존

- summary round는 active summarizer slot 1개만 유지
- summarizer `A -> B -> A` 재지정 시 기존 participant row를 덮어쓰지 않고 history를 보존
- 동일 participant로 다시 돌아오면 기존 row를 재활성화하고, 다른 active summarizer row는 `skipped(summary.reassigned)` 처리
- summary round timeout / retry / 재촉 경로가 active slot 기준으로만 계산되도록 보강

주요 파일:

- `server/src/services/meetings.ts`
- `server/src/__tests__/meetings-service.test.ts`

### 2.3 final completion semantics

- summarizer child issue comment가 canonical final summary가 되도록 구현
- transcript projection에서 summary round responded comment를 `final_summary`로 투영
- final summary 완료 시 root issue에 `meeting_completed` system comment를 항상 1회 생성
- meeting 종료 상태를 아래 둘로 구분
  - `completed`
  - `partial_completed`
- `partial_completed` 판정은 non-summary round에 `timed_out | blocked | skipped | failed | late` 이력이 하나라도 있는지 기준으로 계산
- 종료 시:
  - root issue `issues.status` mirror -> `done`
  - active participant child issue -> `done`
  - activity log -> `meeting.completed` 또는 `meeting.partial_completed`

주요 파일:

- `server/src/services/meetings.ts`
- `server/src/__tests__/meetings-service.test.ts`

### 2.4 transcript / read model 보강

- `MeetingRoomDTO.transcript`에 `final_summary` entry를 실제로 포함
- meeting terminal 이후 late response는 main transcript에 더 이상 추가하지 않음
- `meeting_completed` entry가 transcript 마지막 semantic footer가 되도록 유지

주요 파일:

- `server/src/services/meetings.ts`
- `packages/shared/src/types/meeting.ts`

### 2.5 Phase C handoff 문서 정정

- Phase C handoff 문서의 판정을 `Conditional Pass`로 수정
- full-suite 수치와 `company-import-export-e2e` timeout 메모를 실제 재현 결과로 정정
- `summary_requested_by_user_id` reviewer acceptance criterion을 추가

주요 파일:

- `doc/plans/2026-04-07-facilitated-meeting-orchestrator-phase-c-cross-verification.md`

## 3. 이번 변경에서 의도적으로 아직 남겨둔 범위

### 3.1 아직 skeleton 또는 후속 Phase 범위인 항목

- `POST /issues/:issueId/meeting/cancel`

위 엔드포인트는 아직 `501` skeleton이다. 이는 현재 변경 기준으로 **의도된 상태**이며, reviewer는 이를 회귀와 구분해야 한다.

### 3.2 아직 partial인 항목

- orchestrated meeting UI가 `MeetingRoomDTO`를 실제 주 데이터 소스로 사용하는 통합은 아직 Phase E 범위다
- participant status panel / control actions / Office deep-link polishing은 아직 Phase E 범위다
- copy 정리, 비용 표시, 운영 polish는 Phase F 범위다

즉 이번 변경은 **summary round, final summary, 종료 semantics, transcript footer의 backend 중심 Phase D 구현**이다.

## 4. reviewer에게 반드시 요청할 검토 항목

리뷰어는 아래를 우선적으로 봐야 한다.

- summary round active slot 1개 규칙이 실제 코드에서 지켜지는지
- summarizer `A -> B -> A` 재할당이 `(round_id, participant_id)` uniqueness와 양립하는지
- `summary_requested_by_user_id`가 operator 명시 요청과 auto transition을 구분하는 audit field로 일관되게 채워지는지
- final summary canonical 저장 위치가 summarizer child issue인지
- root issue에 `meeting_completed` system comment가 항상 1회 생성되는지
- `completed`와 `partial_completed`가 activity log, transcript, unread semantics에서 구분되는지
- final summary 이후 late response가 main transcript를 다시 열지 않는지
- summary/control endpoint가 board-only + `tasks:assign` grant를 유지하는지
- summary round retry / reassignment 시 history row가 유실되지 않는지
- final completion이 root issue status mirror와 child issue terminal status를 함께 닫는지

## 5. reviewer가 반드시 볼 파일

- `server/src/services/meetings.ts`
- `server/src/routes/meetings.ts`
- `server/src/routes/authz.ts`
- `server/src/services/heartbeat.ts`
- `server/src/__tests__/meetings-service.test.ts`
- `packages/shared/src/validators/meeting.ts`
- `packages/shared/src/types/meeting.ts`
- `doc/plans/2026-04-07-facilitated-meeting-orchestrator-plan.md`
- `doc/plans/2026-04-07-facilitated-meeting-orchestrator-cross-verification.md`

## 6. 이번 변경에서 실제 수행한 검증

### 6.1 통과

- `git diff --check`
- `TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm --filter @paperclipai/server exec vitest run src/__tests__/meetings-service.test.ts`
- `TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm -r typecheck`
- `TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm build`

### 6.2 targeted test 상태

- `server/src/__tests__/meetings-service.test.ts`
  - `14` tests passed

### 6.3 full suite 상태

- `TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm test:run`
- 결과:
  - `152` test files passed
  - `1` test file failed
  - `813` tests passed
  - `2` skipped
- 실패:
  - `src/__tests__/company-import-export-e2e.test.ts`
  - `/api/health` 대기 timeout

즉, 이번 handoff 기준에서는 Phase D 자체 흐름은 통과했지만 workspace 전체 green은 아직 보장하지 못하므로 `Conditional Pass`가 맞다.

## 7. reviewer에게 같이 전달할 메모

- 이번 변경은 Phase D 전체 중에서도 **summary round + final completion semantics** 중심이다.
- reviewer는 Phase D cross-verification 기준을 적용하되, 아직 의도적으로 `501`인 `/meeting/cancel`은 회귀와 구분해서 봐 달라고 요청하는 것이 맞다.
- 핵심 리스크는 크게 다섯 가지다.
  - summary active slot이 실제로 1개만 살아 있는지
  - summarizer 재지정 시 history row가 덮어써지지 않는지
  - final summary가 root raw comment에 cross-post되지 않고 child issue canonical을 유지하는지
  - `meeting_completed` signal이 optional이 아니라 mandatory인지
  - `completed | partial_completed`가 audit/log/transcript에서 일관되게 구분되는지

## 8. 전달용 프롬프트

```text
이번 변경은 전체회의 토론 오케스트레이터의 Phase D 구현분입니다.
아래 문서와 커밋을 기준으로 교차검증해 주세요.

기준:
- base commit: a767a6a8
- implementation commit: f15c5998
- doc/plans/2026-04-07-facilitated-meeting-orchestrator-plan.md
- doc/plans/2026-04-07-facilitated-meeting-orchestrator-cross-verification.md
- doc/plans/2026-04-07-facilitated-meeting-orchestrator-phase-d-cross-verification.md

중요:
- 이번 변경은 summary round, final summary, completed / partial_completed 종료 semantics가 중심입니다.
- 아래 control endpoint는 아직 의도적으로 501 skeleton입니다:
  - /meeting/cancel
- 이를 회귀와 구분해서 검토해 주세요.

반드시 봐 주세요:
- summary round active slot 1개 규칙
- summarizer A -> B -> A 재할당 history 보존
- summary_requested_by_user_id audit semantics
- final summary child issue canonical 저장
- root meeting_completed signal 항상 1회 생성
- completed vs partial_completed 구분
- final summary 이후 late response가 main transcript를 다시 열지 않는지
- summary/control authz와 completion activity log
- root issue status mirror + child issue terminal status 동기화

특히 summarizer 교체 시 기존 row가 덮어써지지 않는지, meeting_completed가 optional이 아니라 mandatory인지, 그리고 final summary가 root raw comment stream에 agent 이름으로 cross-post되지 않는지 집중해서 봐 주세요.

결과는 findings-first 형식으로, file/line reference와 함께 정리해 주세요.
```
