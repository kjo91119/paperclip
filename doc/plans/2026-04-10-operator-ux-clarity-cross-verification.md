# 2026-04-10 Operator UX Clarity Cross-Verification

## 1. 목적

이번 검증은 두 가지 변경을 함께 확인하기 위한 것이다.

1. 에이전트가 board(사람 사용자)에게 답할 때 더 쉽게 말하도록 바꾼 변경
2. 일반 이슈/목록/댓글 화면이 내부 작업지시서처럼 보이지 않고, 사람이 읽기 쉬운 화면으로 바뀌는 변경

핵심 목표는 기능 추가가 아니라 다음 두 가지다.

- 사람이 `결국 무슨 뜻인지`를 바로 이해할 수 있어야 한다.
- 내부 번호와 원문 작업지시보다 `쉽게 말하면 / 지금 결정할 것 / 다음 할 일`이 먼저 보여야 한다.

---

## 2. 이번 문서가 커버하는 범위

### 2.1 이미 반영된 이전 변경

에이전트가 더 쉽게 말하도록 한 변경은 이미 커밋/푸시 완료 상태다.

- 커밋: `f3b1c403`
- 범위: 공통 prompt note, 기본 AGENTS, CEO 전용 AGENTS/HEARTBEAT, 회귀 테스트

### 2.2 현재 워킹트리 변경

일반 이슈/목록/댓글을 쉽게 읽게 만드는 UI 변경은 현재 워킹트리 기준이다.

- 브랜치: `local/2026-04-02-korean-ui-backup`
- 아직 이번 턴 기준으로는 별도 커밋 전일 수 있다.
- reviewer는 현재 워킹트리 상태를 기준으로 확인해야 한다.

---

## 3. 기준 문서

아래 문서를 함께 참조한다.

- [2026-04-09-agent-language-clarity-cross-verification.md](/mnt/d/project/paperclipai/doc/plans/2026-04-09-agent-language-clarity-cross-verification.md)
- [2026-04-09-ui-simplification-cross-verification.md](/mnt/d/project/paperclipai/doc/plans/2026-04-09-ui-simplification-cross-verification.md)

이번 문서는 위 두 문서의 핵심을 합치되, **이번 턴의 일반 이슈/댓글 단순화 패치까지 포함한 최종 reviewer SOP**에 가깝다.

---

## 4. 변경 파일

### 4.1 에이전트 답변 단순화 범위

- [server-utils.ts](/mnt/d/project/paperclipai/packages/adapter-utils/src/server-utils.ts)
- [default AGENTS.md](/mnt/d/project/paperclipai/server/src/onboarding-assets/default/AGENTS.md)
- [CEO AGENTS.md](/mnt/d/project/paperclipai/server/src/onboarding-assets/ceo/AGENTS.md)
- [CEO HEARTBEAT.md](/mnt/d/project/paperclipai/server/src/onboarding-assets/ceo/HEARTBEAT.md)
- [paperclip-skill-utils.test.ts](/mnt/d/project/paperclipai/server/src/__tests__/paperclip-skill-utils.test.ts)

### 4.2 일반 이슈/목록/댓글 단순화 범위

- [IssueDetail.tsx](/mnt/d/project/paperclipai/ui/src/pages/IssueDetail.tsx)
- [IssueRow.tsx](/mnt/d/project/paperclipai/ui/src/components/IssueRow.tsx)
- [IssueRow.test.tsx](/mnt/d/project/paperclipai/ui/src/components/IssueRow.test.tsx)
- [CommentThread.tsx](/mnt/d/project/paperclipai/ui/src/components/CommentThread.tsx)
- [issue-brief.ts](/mnt/d/project/paperclipai/ui/src/lib/issue-brief.ts)
- [issue-brief.test.ts](/mnt/d/project/paperclipai/ui/src/lib/issue-brief.test.ts)

관련 회귀 참고:

- [meeting-room.test.ts](/mnt/d/project/paperclipai/ui/src/lib/meeting-room.test.ts)

---

## 5. reviewer가 반드시 이해해야 하는 기대 UX

### 5.1 에이전트 답변

이전에는 에이전트가 `STU-51`, `gate`, `owner`, `approval flow` 같은 내부 용어를 먼저 늘어놓는 경향이 있었다.

이제는:

- 먼저 사람말로 뜻을 설명하고
- 다음에 지금 상태를 짧게 말하고
- 마지막에 사용자가 해야 할 일이 있으면 한 줄로 말해야 한다.

즉 기대 형식은 대략 아래와 같아야 한다.

- 쉽게 말하면
- 지금 상태
- 다음 할 일

### 5.2 일반 이슈 상세

이전에는 `Objective / Context / Deliverable / Constraints` 원문이 바로 보여서, 사용자가 문서를 읽는 대신 작업지시서를 해석해야 했다.

이제는:

- 상단에 `바로 이해하기` 카드가 먼저 보이고
- 그 안에서 `쉽게 말하면 / 지금 결정할 것 / 참고 배경 / 주의할 점`이 요약돼야 하며
- 원래 원문은 `원문 작업 지시`로 접혀 있어야 한다.

### 5.3 이슈 목록/받은 편지함 목록

이전에는 제목보다 `STU-55` 같은 식별자와 역할 prefix가 먼저 눈에 들어왔다.

이제는:

- 제목이 먼저 보여야 하고
- 한 줄 요약이 바로 아래에 붙어야 하며
- 식별자는 `작업 #55` 같이 훨씬 약한 보조 정보로 뒤로 가야 한다.

### 5.4 긴 댓글

이전에는 긴 운영 댓글과 승인 댓글을 raw markdown 그대로 읽어야 했다.

이제는:

- 긴 댓글 위에 `쉽게 읽기` 카드가 먼저 나오고
- `지금 상태 / 다음 할 일 / 추가 메모`를 바로 볼 수 있어야 하며
- 원문은 `원문 보기`를 눌렀을 때 펼쳐져야 한다.

---

## 6. 이번 패스에서 구현된 핵심 변경

### 6.1 일반 이슈 상세

- 상단 `바로 이해하기` 카드 추가
- `Objective / Context / Deliverable / Constraints` 파싱해서 사람말 카드로 노출
- 원문 설명은 `원문 작업 지시`로 접기
- 식별자는 `작업 #번호` 수준으로 축소
- structured 일반 이슈는 오른쪽 속성 패널을 **처음 열 때만** 기본 접힘으로 시작
- 같은 이슈에서 저장/refetch가 일어나도 사용자가 직접 펼친 패널/원문 상태를 다시 덮어쓰지 않음
- 일반 이슈 읽기 화면 폭 확장 (`max-w-[72rem]`)

### 6.2 이슈 목록

- 제목에서 `[CTO]` 같은 prefix는 배지로 분리
- 제목 아래 한 줄 요약 표시
- 식별자는 `작업 #번호`로 약하게 표시
- `IssuesList`와 `Inbox` 같은 실제 주요 소비처도 기본 단순화 UI를 다시 덮어쓰지 않도록 정리
- 제목이 데스크톱 메타 블록보다 먼저 보이도록 순서 조정

### 6.3 댓글/실행 로그

- 긴 댓글에 `쉽게 읽기` 카드 추가
- `지금 상태 / 다음 할 일 / 추가 메모`를 먼저 노출
- raw markdown 본문은 `원문 보기` 아래 접어서 표시

### 6.4 에이전트 답변 규칙

- board-facing 답변에서 사람말 우선
- `what this means -> current status -> next action` 순서 강제
- 내부 번호와 control-plane 용어는 뒤로 이동
- live company bundle에도 같은 취지 반영

---

## 7. 깨지면 안 되는 invariant

- 기존 이슈 편집 기능은 유지되어야 한다.
- 원문 작업지시는 삭제되면 안 되고, 접힘 상태로만 이동해야 한다.
- 회의 이슈의 read-only 경계는 깨지면 안 된다.
- `IssueRow`의 링크/라우팅은 그대로 유지되어야 한다.
- 댓글 원문 markdown은 여전히 열어볼 수 있어야 한다.
- 에이전트 답변 단순화는 기능 변경이 아니라 표현 변경이어야 한다.
- live bundle 패치와 git tracked prompt 규칙이 서로 충돌하면 안 된다.

---

## 8. 반려 기준

아래 중 하나라도 보이면 반려한다.

- 일반 이슈를 열었을 때 여전히 raw `Objective / Context / Deliverable / Constraints`만 바로 보이고, `바로 이해하기` 카드가 없음
- 제목/목록에서 `STU-xx` 또는 내부 prefix가 여전히 제목보다 먼저 튀어 보임
- 긴 댓글에 `쉽게 읽기` 카드가 없고 원문만 길게 노출됨
- `원문 작업 지시` 또는 `원문 보기`를 열 수 없어 기존 정보가 사라짐
- 에이전트 답변이 여전히 내부 번호/flow 설명부터 시작하고 사람말 요약이 뒤에 옴
- 다음 할 일이 있는지 없는지 한두 문장 안에 알 수 없음

---

## 9. reviewer가 꼭 확인할 화면/동작

### 9.1 일반 이슈 상세

- 상단 제목 아래에 `바로 이해하기` 카드가 보이는지
- 카드 안에 `쉽게 말하면 / 지금 결정할 것`이 먼저 보이는지
- `원문 작업 지시`가 기본 접힘인지
- 오른쪽 속성 패널이 기본으로 덜 튀는지

### 9.2 이슈 목록과 받은 편지함 목록

- 제목이 먼저 보이는지
- 한 줄 요약이 붙는지
- `작업 #번호`가 보조 정보로만 보이는지

### 9.3 댓글

- 긴 댓글에 `쉽게 읽기` 카드가 붙는지
- `지금 상태 / 다음 할 일 / 추가 메모`가 먼저 보이는지
- `원문 보기`를 펼치면 기존 markdown 본문이 그대로 나오는지

### 9.4 새 에이전트 답변

- 먼저 사람말 결론이 나오는지
- `지금 상태`와 `다음 할 일`이 짧게 구분되는지
- `STU-xx` 같은 내부 번호가 제목처럼 앞에 나오지 않는지

---

## 10. 수행할 검증

### 10.1 이번 턴에서 실제 실행한 UI 검증

```bash
pnpm --filter @paperclipai/ui exec vitest run src/components/IssueRow.test.tsx src/lib/issue-brief.test.ts src/lib/meeting-room.test.ts src/pages/Inbox.test.tsx
pnpm --filter @paperclipai/ui exec tsc -b --pretty false
pnpm --filter @paperclipai/ui build
git diff --check
```

### 10.2 이전 턴에서 이미 확인한 에이전트 답변 검증

```bash
pnpm --filter @paperclipai/server exec vitest run src/__tests__/paperclip-skill-utils.test.ts
pnpm -r typecheck
```

런타임 live bundle 확인 절차는 아래 기존 문서를 따른다.

- [2026-04-09-agent-language-clarity-cross-verification.md](/mnt/d/project/paperclipai/doc/plans/2026-04-09-agent-language-clarity-cross-verification.md)

---

## 11. 이번 턴에서 실제 확인한 결과

### 11.1 UI 변경

- `git diff --check` 통과
- `pnpm --filter @paperclipai/ui exec vitest run src/components/IssueRow.test.tsx src/lib/issue-brief.test.ts src/lib/meeting-room.test.ts src/pages/Inbox.test.tsx --reporter verbose` 통과
  - `4 files passed`
  - `17 tests passed`
- `pnpm --filter @paperclipai/ui exec tsc -b --pretty false` 통과
- `pnpm --filter @paperclipai/ui build` 통과

### 11.2 에이전트 답변 변경

- `pnpm --filter @paperclipai/server exec vitest run src/__tests__/paperclip-skill-utils.test.ts` 통과
- `pnpm -r typecheck` 통과
- live company bundle 반영 절차와 결과는 기존 문서에 이미 정리돼 있음

### 11.3 이번 턴에서 다시 실행하지 않은 것

- `pnpm test:run`
- server 전체 `pnpm build`

---

## 12. reviewer 전달용 프롬프트

```text
Paperclip의 운영자 UX 단순화 변경을 교차검증해 주세요.

기준 문서:
- doc/plans/2026-04-10-operator-ux-clarity-cross-verification.md
- 참고: doc/plans/2026-04-09-agent-language-clarity-cross-verification.md
- 참고: doc/plans/2026-04-09-ui-simplification-cross-verification.md

이번 변경의 핵심은 두 가지입니다.
1. 에이전트가 board에게 더 쉽게 말하게 하기
2. 일반 이슈/목록/댓글이 내부 작업지시서처럼 보이지 않고 사람말 중심으로 읽히게 하기

꼭 봐야 할 점:
1. 일반 이슈 상세에 `바로 이해하기` 카드가 먼저 보이는지
2. `Objective / Context / Deliverable / Constraints` 원문은 접혀 있고, 사람말 요약이 먼저 보이는지
3. 이슈 목록에서 제목과 한 줄 요약이 먼저 보이고, `작업 #번호`는 보조 정보인지
4. 긴 댓글에서 `쉽게 읽기` 카드가 먼저 보이고, `지금 상태 / 다음 할 일 / 추가 메모`가 바로 보이는지
5. 새 에이전트 답변이 내부 번호보다 사람말 결론을 먼저 주는지

반려 기준:
- raw 작업지시서만 보이고 요약 카드가 없음
- 식별자/STU 번호가 여전히 제목보다 먼저 튐
- 긴 댓글 원문을 그대로 먼저 읽어야 함
- 에이전트 답변이 여전히 내부 용어부터 시작함
```
