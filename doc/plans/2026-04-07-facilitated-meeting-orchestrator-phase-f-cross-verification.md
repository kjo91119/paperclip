# 전체회의 오케스트레이터 Phase F 교차검증 지시서

## 1. 문서 목적

이 문서는 `전체회의 토론 오케스트레이터`의 **Phase F polish 구현분**을 reviewer에게 넘길 때 사용하는 전달용 교차검증 지시서다.

- 기준 변경셋:
  - Phase E review-gap closed base commit: `d674cf5a`
  - Phase F implementation commit: `576e09ca`
- 브랜치: `local/2026-04-02-korean-ui-backup`
- 구현 기준 문서:
  - `doc/plans/2026-04-07-facilitated-meeting-orchestrator-plan.md`
  - `doc/plans/2026-04-07-facilitated-meeting-orchestrator-cross-verification.md`

이번 문서는 "Phase F에서 실제로 구현된 polish 범위", "아직 known gap으로 남아 있는 항목", "reviewer가 반드시 봐야 할 검토 포인트"를 분리해서 적는다.

현재 판정은 **Conditional Pass**다.

- `MeetingRoomPanel`에 상태 안내 배너, 실행 규모/가드레일 카드, draft/paused/failed/completed empty state copy가 실제로 반영됨
- rough cost/round/participant estimate와 response timeout 표시가 `MeetingRoomDTO` 설정값과 연결됨
- `git diff --check`, `pnpm -r typecheck`, `pnpm build`, 관련 UI/server targeted tests는 통과했음
- 다만 full-suite `pnpm test:run`과 `cli/src/__tests__/company-import-export-e2e.test.ts` 단독 재실행은 모두 `/api/health` timeout으로 실패했음

## 2. 이번 변경에서 완료된 항목

### 2.1 Meeting room status notice polish

- meeting status별 안내 배너 추가
  - `draft`
  - `running`
  - `awaiting_operator`
  - `paused`
  - `failed`
  - `completed`
  - `partial_completed`
- tone별 visual treatment를 분리해 operator attention / failure / completion이 조용히 묻히지 않도록 정리
- 현재 라운드 헤더에 response timeout label을 함께 노출

주요 파일:

- `ui/src/components/MeetingRoomPanel.tsx`
- `ui/src/lib/meeting-room.ts`
- `ui/src/lib/meeting-room.test.ts`

### 2.2 비용/가드레일 표시

- 회의 설정 기준 rough execution estimate 추가
  - 참가자 수
  - 토론 라운드 수
  - 예상 총 라운드 수
  - 최대 응답 수
  - 거친 prompt token range
- 아래 guardrail note를 UI에서 직접 노출
  - 참가자 4명 이상
  - discussion/followup 2회 이상
  - timeout 30분 초과
  - autoContinue 비활성화
- response timeout을 `초/분/시간` 단위 copy로 정리

주요 파일:

- `ui/src/components/MeetingRoomPanel.tsx`
- `ui/src/lib/meeting-room.ts`
- `ui/src/lib/meeting-room.test.ts`

### 2.3 empty state / edge state copy 정리

- transcript empty state를 meeting status별 문맥에 맞게 분기
  - 시작 전
  - 일시중지
  - 실패
  - 일반 empty
- current round participant panel empty state를 terminal/draft/failure 상태에 맞게 정리
- participant list가 비어 있는 경우 최소 participant 제약을 직접 설명하는 empty state 추가

주요 파일:

- `ui/src/components/MeetingRoomPanel.tsx`

## 3. 이번 변경에서 의도적으로 아직 남겨둔 범위

### 3.1 아직 skeleton 또는 후속 범위인 항목

- `POST /issues/:issueId/meeting/cancel`

위 엔드포인트는 아직 `501` skeleton이다. 이는 현재 변경 기준으로 **의도된 상태**이며, reviewer는 이를 회귀와 구분해야 한다.

### 3.2 아직 partial 또는 known gap인 항목

- CLI `company-import-export-e2e`는 이번 환경에서 full-suite와 단독 재실행 모두 `/api/health` timeout으로 실패한다
- 이번 변경은 Phase F polish이므로, 해당 CLI startup timeout은 meeting UI 변경의 직접 회귀로 단정하지 않고 별도 known failure로 취급한다

즉 이번 변경은 **orchestrated meeting room의 user-facing guardrail / copy / edge-state polish**다.

## 4. reviewer에게 반드시 요청할 검토 항목

리뷰어는 아래를 우선적으로 봐야 한다.

- 비용/라운드/participant 표시가 실제 `MeetingRoomDTO` 설정값과 맞는지
- rough token range와 maxResponses 계산이 문서의 guardrail 의도와 어긋나지 않는지
- `awaiting_operator`, `paused`, `failed`, `completed`, `partial_completed`, `draft` 배너 copy가 자연스럽고 action을 오해시키지 않는지
- transcript empty state와 current-round empty state가 actionless dead-end처럼 보이지 않는지
- hidden child issue가 일반 화면으로 새지 않는 기존 보장이 그대로 유지되는지
- root orchestrated meeting issue의 read-only / generic issue plane 분리가 이번 polish로 되돌아가지 않았는지
- targeted meeting/UI tests는 green인데 unrelated CLI E2E만 실패하는 현재 상태 서술이 handoff 문서와 실제 결과가 일치하는지

## 5. reviewer가 반드시 볼 파일

- `ui/src/components/MeetingRoomPanel.tsx`
- `ui/src/lib/meeting-room.ts`
- `ui/src/lib/meeting-room.test.ts`
- `ui/src/pages/IssueDetail.tsx`
- `ui/src/components/office/OfficeConversationPanel.tsx`
- `ui/src/pages/Inbox.tsx`
- `ui/src/pages/OfficeView.tsx`
- `ui/src/pages/Issues.tsx`
- `ui/src/pages/AgentDetail.tsx`
- `ui/src/pages/MyIssues.tsx`
- `ui/src/lib/inbox.ts`
- `server/src/services/meetings.ts`
- `server/src/services/issues.ts`
- `server/src/__tests__/meetings-service.test.ts`
- `cli/src/__tests__/company-import-export-e2e.test.ts`
- `doc/plans/2026-04-07-facilitated-meeting-orchestrator-plan.md`
- `doc/plans/2026-04-07-facilitated-meeting-orchestrator-cross-verification.md`

## 6. 이번 변경에서 실제 수행한 검증

### 6.1 통과

- `git diff --check`
- `TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm --filter @paperclipai/ui exec vitest run src/lib/meeting-room.test.ts src/pages/Inbox.test.tsx src/pages/OfficeView.model.test.ts`
- `TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm --filter @paperclipai/server exec vitest run src/__tests__/meetings-service.test.ts`
- `TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm -r typecheck`
- `TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm build`

### 6.2 targeted test 상태

- `ui/src/lib/meeting-room.test.ts`
  - `5` tests passed
- `ui/src/pages/OfficeView.model.test.ts`
  - `26` tests passed
- `ui/src/pages/Inbox.test.tsx`
  - `2` tests passed
- `server/src/__tests__/meetings-service.test.ts`
  - `14` tests passed

### 6.3 full suite 상태

- `TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm test:run`
- 결과:
  - `153` test files passed
  - `1` test file failed
  - `819` tests passed
  - `2` skipped
- 실패:
  - `cli/src/__tests__/company-import-export-e2e.test.ts`
  - `/api/health` 대기 timeout

### 6.4 standalone known-failure 상태

- `TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm exec vitest run src/__tests__/company-import-export-e2e.test.ts` (in `cli/`)
- 결과:
  - `1` test file failed
  - `1` test skipped
- 실패:
  - `cli/src/__tests__/company-import-export-e2e.test.ts`
  - `/api/health` 대기 timeout

즉, 이번 handoff 기준에서는 meeting UI polish 자체는 통과했지만 workspace 전체 green은 아직 보장하지 못하므로 `Conditional Pass`가 맞다.

## 7. reviewer에게 같이 전달할 메모

- 이번 변경은 correctness보다 **user-facing polish와 guardrail copy**가 핵심이다.
- reviewer는 특히 아래 다섯 가지를 집중해서 보면 된다.
  - status notice가 실제 operator action 의미와 맞는지
  - 비용/응답 규모 표시가 문서의 상한과 일치하는지
  - paused/failed/draft/completed 상태가 어색한 blank UI로 남지 않는지
  - root meeting issue read-only / MyIssues 제외 / participantAgentId 경로가 polish 과정에서 깨지지 않았는지
  - known CLI E2E failure 서술이 문서와 실제 실행 결과가 일치하는지
- 이번 phase에서 추가된 UI는 `MeetingRoomDTO` read model 위에서만 동작해야 하므로, raw issue comment plane에 다시 의존하는 흔적이 없는지 봐야 한다.

## 8. 전달용 프롬프트

```text
이번 변경은 전체회의 토론 오케스트레이터의 Phase F polish 구현입니다.
아래 문서와 커밋을 기준으로 교차검증해 주세요.

기준:
- base commit: d674cf5a
- implementation commit: 576e09ca
- doc/plans/2026-04-07-facilitated-meeting-orchestrator-plan.md
- doc/plans/2026-04-07-facilitated-meeting-orchestrator-cross-verification.md
- doc/plans/2026-04-07-facilitated-meeting-orchestrator-phase-f-cross-verification.md

중요:
- 이번 변경은 correctness보다 user-facing guardrail, 비용 표시, status notice, empty state polish가 중심입니다.
- 아래 control endpoint는 아직 의도적으로 501 skeleton입니다:
  - /meeting/cancel
- full pnpm test:run과 cli/src/__tests__/company-import-export-e2e.test.ts 단독 재실행은 모두 /api/health timeout으로 실패했습니다.
- 이를 meeting UI 회귀와 별개 known failure로 보고, 이번 변경분과 실제로 연결되는지 중심으로 검토해 주세요.

반드시 봐 주세요:
- 비용/라운드/participant 표시가 실제 MeetingRoomDTO 설정값과 맞는지
- awaiting_operator / paused / failed / completed / partial_completed / draft copy가 자연스러운지
- transcript empty state와 current-round empty state가 dead-end처럼 보이지 않는지
- root meeting issue read-only / MyIssues 제외 / participantAgentId 경로가 유지되는지
- MeetingRoomPanel이 여전히 raw issue comment plane이 아니라 orchestrated meeting read model 위에만 서 있는지

특히 작은 문구라도 운영자 액션을 오해하게 만들면 medium 이상으로 봐 주세요.
결과는 findings-first 형식으로, file/line reference와 함께 정리해 주세요.
```
