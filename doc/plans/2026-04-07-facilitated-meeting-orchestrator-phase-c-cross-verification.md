# 전체회의 오케스트레이터 Phase C 교차검증 지시서

## 1. 문서 목적

이 문서는 `전체회의 토론 오케스트레이터`의 **Phase C 구현분**을 reviewer에게 넘길 때 사용하는 전달용 교차검증 지시서다.

- 기준 커밋: `a767a6a8`
- 브랜치: `local/2026-04-02-korean-ui-backup`
- 구현 기준 문서:
  - `doc/plans/2026-04-07-facilitated-meeting-orchestrator-plan.md`
  - `doc/plans/2026-04-07-facilitated-meeting-orchestrator-cross-verification.md`

이번 문서는 "Phase C에서 실제로 구현된 범위", "아직 Phase D/E 이후로 남겨둔 범위", "reviewer가 반드시 봐야 할 검토 포인트"를 분리해서 적는다.

현재 판정은 **Conditional Pass**다.

- Phase C 목표 범위의 핵심 흐름은 구현됨
- Phase B 리뷰에서 지적된 `blocked 즉시 에스컬레이션`, `duplicate summary CAS`, `heartbeat 분기/handoff 누락`도 함께 보강됨
- `git diff --check`, `typecheck`, `build`는 통과했음
- 다만 full-suite 재검증에서는 `company-import-export-e2e` healthcheck timeout이 재현되어, 전체 `pnpm test:run`은 간헐 실패 가능성을 남긴 상태다
- 다만 reviewer는 여전히 "Phase C 범위를 넘는 skeleton"과 "Phase C 범위 안의 상태머신/투영 회귀 위험"을 구분해서 봐야 한다

## 2. 이번 커밋에서 완료된 항목

### 2.1 meeting service 상태머신 확장

- Round 2 / followup용 packet builder 추가
  - 이전 round summary
  - 자기 이전 입장
  - 토론용 답변 형식
- `continue` 구현
  - opening -> discussion
  - discussion/followup -> followup
  - `maxDiscussionRounds` budget 검사
  - 다음 round row / round participant row 생성
  - round open root comment 생성
  - `dispatching -> collecting` fan-out 재사용
- `skip` 구현
  - operator가 응답 없는 participant를 skip 처리 가능
  - 이후 partial continue 흐름으로 다음 round 진입 가능
- late response 처리 구현
  - `timed_out|blocked|skipped|failed -> late`
  - late response는 round를 재오픈하지 않음
- transcript projection 구현
  - `round_opened`
  - `participant_response`
  - `participant_response_extra`
  - `round_summary`
  - `operator_signal`
  - `late_response`
- dispatch 중 `blocked`/`failed` participant가 나오면 즉시 `awaiting_operator`로 승격
- duplicate `round_summary` 생성을 막는 CAS guard 추가
- `meeting.round_opened` activity logging 추가
- pause/resume이 current round를 재평가해 `running | awaiting_operator`로 복귀하도록 정리

주요 파일:

- `server/src/services/meetings.ts`

### 2.2 route wiring 확장

- `POST /api/issues/:issueId/meeting/continue`
- `POST /api/issues/:issueId/meeting/participants/:agentId/skip`

위 엔드포인트를 실제 service 구현에 연결했다.

- board-only + `tasks:assign` grant 검사 유지
- actor 정보를 meeting service로 전달
- 기존 `start / pause / resume / remind` 경로와 같은 authz 규칙 유지

주요 파일:

- `server/src/routes/meetings.ts`

### 2.3 test 보강

- embedded Postgres integration test 보강
  - duplicate summary race 방지
  - blocked participant 즉시 에스컬레이션
  - Round 2 continue + packet 내용 검증
  - partial continue after skip
  - `participant_response_extra` transcript projection
  - late response가 round를 다시 열지 않는지
  - pause/resume 재평가

주요 파일:

- `server/src/__tests__/meetings-service.test.ts`

### 2.4 handoff 문서 보강

- Phase B 교차검증 지시서도 reviewer feedback에 맞게 갱신했다.
  - `heartbeat.ts` 검토 경로 강조
  - pause/resume 검토 항목 추가
  - "2명 응답"이 아니라 "모든 active participant 응답"으로 표현 정리

주요 파일:

- `doc/plans/2026-04-07-facilitated-meeting-orchestrator-phase-b-cross-verification.md`

## 3. 이번 커밋에서 의도적으로 아직 남겨둔 범위

아래는 이번 커밋에서 **일부러 Phase C 범위 밖으로 남겨둔 것**이다.

### 3.1 아직 skeleton 또는 후속 Phase 범위인 항목

- `POST /issues/:issueId/meeting/cancel`
- `POST /issues/:issueId/meeting/summary`

위 엔드포인트는 아직 `501` skeleton이다. 이는 현재 커밋 기준으로 **의도된 상태**이며, reviewer는 이를 숨은 회귀와 구분해야 한다.

### 3.2 아직 partial인 항목

- summary round / final summary canonical flow는 아직 Phase D 범위다
- `meeting_completed`, `completed`, `partial_completed` 종료 semantics는 아직 Phase D 범위다
- transcript의 `final_summary`, `meeting_completed` entry는 아직 본격 사용되지 않는다
- orchestrated meeting UI가 `MeetingRoomDTO`를 실제 화면 주 데이터 소스로 쓰는 것은 아직 Phase E 범위다

즉 이번 커밋은 **Round 2 상호 토론, partial continue, late response, transcript projection의 backend 중심 Phase C 구현**이다.

## 4. reviewer에게 반드시 요청할 검토 항목

리뷰어는 아래를 우선적으로 봐야 한다.

- Round 2 packet이 이전 round summary와 자기 이전 입장을 정확히 섞는지
- `continue`가 opening -> discussion, discussion/followup -> followup budget 규칙을 지키는지
- `maxDiscussionRounds`를 넘는 followup을 막는지
- `skip` 이후 partial continue가 실제로 다음 round dispatch까지 이어지는지
- `late response`가 response completion으로 오인되지 않고 round를 다시 열지 않는지
- `participant_response_extra`가 canonical 첫 응답과 별도 projection으로 남는지
- `blocked` participant가 dispatch 시점에 즉시 `awaiting_operator`로 올라가는지
- duplicate `round_summary` / duplicate `operator_attention`가 race 상황에서 생기지 않는지
- `server/src/services/heartbeat.ts` 기준 `queued`, `coalesced`, `deferred_issue_execution`, `skipped`, conflict 경로가 discussion round dispatch에서도 여전히 participant status로 올바르게 번역되는지
- `pause` / `resume`이 current round 성격을 덮어쓰지 않는지
- `summary_requested_by_user_id`가 operator 명시 요청과 auto transition을 구분하는 audit field로 일관되게 채워지는지
- route authz가 board-only + `tasks:assign` grant를 빠뜨리지 않는지
- auto transition / continue / skip / timeout / response가 activity log를 빠뜨리지 않는지
- transcript projection이 raw root comments를 그대로 노출하지 않고 normalized entry만 내보내는지

## 5. reviewer가 반드시 볼 파일

- `server/src/services/meetings.ts`
- `server/src/routes/meetings.ts`
- `server/src/routes/issues.ts`
- `server/src/services/heartbeat.ts`
- `server/src/__tests__/meetings-service.test.ts`
- `packages/shared/src/types/meeting.ts`
- `doc/plans/2026-04-07-facilitated-meeting-orchestrator-plan.md`
- `doc/plans/2026-04-07-facilitated-meeting-orchestrator-cross-verification.md`

## 6. 이번 커밋에서 실제 수행한 검증

### 6.1 통과

- `git diff --check`
- `TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm --filter @paperclipai/server exec vitest run src/__tests__/meetings-service.test.ts`
- `TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm -r typecheck`
- `TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm build`
- `TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm test:run` 재실행

### 6.2 전체 테스트 상태

- `git diff --check`, `typecheck`, `build`는 통과
- targeted `meetings-service.test.ts`는 통과
- full suite 재실행에서는 아래가 관측됨
  - `152` test files passed
  - `1` test file failed
  - `808` tests passed
  - `2` skipped
  - 실패: `cli/src/__tests__/company-import-export-e2e.test.ts` 의 `/api/health` 대기 timeout

즉, Phase C handoff 기준에서는 full-suite green을 보장하지 못하므로 reviewer에게는 이 flake를 별도 메모로 전달하는 편이 맞다.

## 7. reviewer에게 같이 전달할 메모

- 이번 커밋은 Phase C 전체 중에서도 **backend discussion orchestration + transcript projection** 중심이다.
- reviewer는 Phase C cross-verification 기준을 적용하되, 아직 의도적으로 `501`인 `/meeting/cancel`, `/meeting/summary`를 회귀와 구분해 달라고 요청하는 것이 맞다.
- 핵심 리스크는 크게 다섯 가지다.
  - Round 2 / followup 상태머신이 실제로 닫혀 있는지
  - `blocked` dispatch와 partial continue가 operator attention 흐름과 어긋나지 않는지
  - `participant_response_extra` / `late_response` projection이 canonical response를 흔들지 않는지
  - `heartbeat.ts`의 coalesced/deferred/skipped/conflict 분기가 discussion round fan-out에서도 깨지지 않는지
  - CAS guard가 duplicate summary/operator signal을 막는지
- 추가로, 기준 커밋 `a767a6a8`에는 `summary_requested_by_user_id`가 아직 의미 있게 채워지지 않으므로, reviewer는 이 audit field를 Phase C 잔여 acceptance gap으로 따로 봐야 한다.

## 8. 전달용 프롬프트

```text
이번 변경은 전체회의 토론 오케스트레이터의 Phase C 구현분입니다.
아래 문서와 커밋을 기준으로 교차검증해 주세요.

기준:
- commit: a767a6a8
- doc/plans/2026-04-07-facilitated-meeting-orchestrator-plan.md
- doc/plans/2026-04-07-facilitated-meeting-orchestrator-cross-verification.md
- doc/plans/2026-04-07-facilitated-meeting-orchestrator-phase-c-cross-verification.md

중요:
- 이번 커밋은 Round 2 상호 토론, partial continue, skip, late response, transcript projection의 backend 구현이 중심입니다.
- 아래 control endpoint는 아직 의도적으로 501 skeleton입니다:
  - /meeting/cancel
  - /meeting/summary
- 이를 회귀와 구분해서 검토해 주세요.

반드시 봐 주세요:
- Round 2 packet builder
- followup round budget
- continue / skip / remind flow
- blocked participant 즉시 에스컬레이션
- `server/src/services/heartbeat.ts` 기준 coalesced/deferred/conflict/skip 경로와 participant status 번역
- participant_response_extra projection
- late response 처리
- `summary_requested_by_user_id` audit semantics
- duplicate round_summary / operator_attention 방지
- pause/resume 복귀 상태
- meeting create/control route authz
- activity log 누락 여부

특히 late response가 round를 다시 열지 않는지, skip 후 partial continue가 실제로 다음 round dispatch까지 이어지는지, discussion round packet이 이전 round summary + 자기 이전 입장을 모두 포함하는지, 그리고 `summary_requested_by_user_id`가 비어 있는 채로 남아 있지 않은지 집중해서 봐 주세요.

결과는 findings-first 형식으로, file/line reference와 함께 정리해 주세요.
```
