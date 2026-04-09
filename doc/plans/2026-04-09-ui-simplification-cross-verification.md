# UI 단순화 교차검증 지시서 (1차+2차 패스 통합)

## 1. 문서 목적

`2026-04-09-ui-simplification-brief-for-claude.md`에서 정의한 UI 단순화 변경의 전체 교차검증 지시서.  
1차 패스(copy/식별자/탭/그룹)와 2차 패스(결론 카드, 메타 패널 토글, 오피스 용어)를 모두 포함한다.

- 변경 브랜치: `local/2026-04-02-korean-ui-backup`

---

## 2. 변경 파일 목록

| 파일 | 변경 분류 |
|------|-----------|
| `ui/src/components/IssueRow.tsx` | 식별자 기본 숨김 |
| `ui/src/components/MeetingRoomPanel.tsx` | 용어 변경 + 결론 카드 + 메타 패널 토글 |
| `ui/src/lib/meeting-room.ts` | 레이블 변경 |
| `ui/src/pages/IssueDetail.tsx` | 맥락 카드 + 본문 폭 |
| `ui/src/components/office/OfficeSidebar.tsx` | 작업 큐 식별자 축소 |
| `ui/src/pages/Inbox.tsx` | 탭 레이블 + empty state |
| `ui/src/components/Sidebar.tsx` | 목적 기반 그룹 |
| `ui/src/components/office/OfficeConversationPanel.tsx` | 용어 정리 + ThreadList/ThreadHeader 식별자 축소 |

---

## 3. 변경 내용 상세

### A. IssueRow.tsx — 식별자 기본 숨김

- `identifier` span에 `opacity-0 group-hover:opacity-100 transition-opacity` 추가
- 기본 상태에서 STU 식별자가 보이지 않고, 행 hover 시에만 나타남
- DOM에는 여전히 존재 — 복사/접근성 동작 유지

### B. MeetingRoomPanel.tsx — 3가지 변경

**B1. 용어 변경**

| 이전 | 이후 |
|------|------|
| `회의 transcript` (헤더) | `회의 대화` |
| `운영자 코멘트` (레이블) | `내 의견 남기기` |
| `운영자 코멘트 추가` (버튼) | `의견 등록` |
| `운영자 코멘트` (토스트 제목) | `내 의견을 등록했습니다` |
| `운영자` (저자명) | `나` |
| `운영자 코멘트` (entry label) | `내 의견` |
| `운영자 신호` (entry label) | `진행 안내` |
| `운영자 판단 필요` (needsAttention) | `확인이 필요합니다` |
| 식별자 위치 | 상태 배지 옆 → 맨 뒤 `opacity-40` |

**B2. 결론 카드 추가**

- 조건: `isFinished` (`completed` 또는 `partial_completed`) + transcript에 `final_summary` 또는 `meeting_completed` entry 존재
- 위치: 상태 알림 배너 아래, 본문 그리드 위
- 스타일: emerald 테마 (`border-emerald-500/30 bg-emerald-500/5`)
- `final_summary` entry가 있으면 body를 카드에 렌더링 + "대화에서 전체 보기 ↓" 스크롤 버튼
- `meeting_completed`만 있으면 그 body를 muted 스타일로 렌더링
- `finalSummaryRef`로 대화 내 `final_summary` entry에 스크롤 앵커 연결

**B3. 메타 패널 토글**

- 오른쪽 패널(실행 규모와 가드레일 / 현재 라운드 상태 / 참가자) 접기/펼치기 버튼 추가
- 버튼 위치: "회의 대화" 헤더 오른쪽
- 버튼 아이콘: `PanelRight` (lucide-react), 접힌 상태에서 좌우 반전(`scale-x-[-1]`)
- 기본 상태: 열림 (`metaPanelOpen = true`)
- `compact` prop이 true일 때는 버튼 숨김, 패널 항상 표시
- 패널 접힘 시 그리드 `grid-cols-1`로 전환

### C. meeting-room.ts — 레이블 변경

- `summarizeMeetingTranscriptEntry`: "라운드 X 요약" → "라운드 X 정리"
- "기본 접힘" suffix 제거

### D. IssueDetail.tsx — 맥락 카드 + 본문 폭

- `max-w-2xl` → `max-w-3xl` (본문 열 확대)
- `ancestors[ancestors.length - 1].meetingMode === "orchestrated"` 조건으로 회의 자식 감지
  - 맥락 카드 표시: "{회의 제목} 회의의 하위 작업입니다" + "회의실로 돌아가기 →" 링크
  - 비회의 계층: 기존 breadcrumb nav 유지
- 이슈 상단 `identifier`: `text-muted-foreground` → `text-muted-foreground/50`

### E. OfficeSidebar.tsx — 작업 큐 식별자 축소

- 제목을 primary로 노출, identifier는 카드 하단 `text-[10px] text-muted-foreground/50 font-mono`로 이동

### F. Inbox.tsx — 탭 레이블 + empty state

- 탭 순서: `지금 확인할 것` (mine) → `안 읽음` (unread) → `최근 활동` (recent) → `전체`
- empty state 문구 갱신 (all 4 tabs)

### G. Sidebar.tsx — 목적 기반 그룹

- `지금 할 일`: 새 이슈 버튼 → 받은 편지함 → 오피스 → 대시보드 (순서 중요)
- `작업 관리`: 이슈 / 루틴 / 목표
- `조직 설정`: 조직 / 기술 / 비용 / 활동 / 설정

### H. OfficeConversationPanel.tsx — 용어 정리 + 식별자 축소

**H1. 용어 변경**

| 이전 | 이후 |
|------|------|
| `AI Company Messenger` (상단 eyebrow 레이블) | 제거 |
| `에이전트 DM은 이슈/댓글 스레드로, 전체회의는 orchestrated meeting room으로 렌더링합니다.` | `에이전트와 1:1 대화, 또는 여러 에이전트가 참여하는 전체회의를 진행할 수 있습니다.` |
| `orchestrated 회의실을 만들고, 각 참가자는 내부 child issue로 라운드 응답을 진행합니다.` | `전체회의를 열고, 각 참가자가 라운드별로 의견을 제시합니다.` |
| `orchestrated 회의실과 기존 legacy meeting thread를 함께 엽니다.` | `진행 중이거나 완료된 회의를 여기서 확인할 수 있습니다.` |
| `현재 스레드` (ThreadHeader 레이블) | `선택된 대화` |

**H2. 식별자 축소**

- `ThreadHeader`: `<span className="font-mono">{identifier}</span>` → `<span className="font-mono opacity-50 text-[11px]">{identifier}</span>`
- `ThreadList` 항목: identifier를 제목 위 primary에서 제거 → 하단 타임스탬프 옆 `font-mono opacity-40`으로 이동, 제목을 row 최상단으로

---

## 4. 깨지면 안 되는 invariant

### 4.1 기능 동작 invariant

- orchestrated meeting root issue의 read-only 경계 (`isIssueDetailReadOnly`, `MeetingRoomPanel`)
- `MeetingRoomDTO` 기반 렌더링 — 서버 데이터 계약 변경 없음
- meeting control mutations (start/pause/resume/continue/finalize/reopen_discussion/summary/remind/skip) 모두 유지
- operator comment mutation (POST `/issues/:id/comments`) 유지 — 버튼 레이블만 변경
- Inbox 탭 라우팅 (`/inbox/mine`, `/inbox/unread`, `/inbox/recent`, `/inbox/all`) — path segment 불변
- `saveLastInboxTab` / `isMineInboxTab` 동작 — `tab` 값 자체는 그대로
- `entryKind` 값 (`operator_comment`, `operator_signal`, `final_summary`, `meeting_completed` 등) 불변 — 서버 DTO 계약

### 4.2 MeetingRoomPanel 결론 카드 조건

- `isFinished` 가 false이면 결론 카드 미표시 (진행 중 회의에서 노출 없음)
- `finalSummaryEntry`와 `meetingCompletedEntry` 모두 없으면 `showConclusionCard === false`
- "대화에서 전체 보기 ↓" 버튼: `finalSummaryEntry`가 있을 때만 표시

### 4.3 메타 패널 토글 범위

- `compact` prop이 true이면 토글 버튼 미표시, 패널은 항상 렌더링
- `metaPanelOpen` 상태는 페이지 새로고침 시 기본값(`true`)으로 리셋 — 영구 저장 없음 (의도적)

### 4.4 IssueDetail 맥락 카드 조건

- `ancestors` 배열이 비면 카드도 breadcrumb도 없음
- 최상위 ancestor의 `meetingMode !== "orchestrated"` 이면 기존 breadcrumb 렌더링

---

## 5. reviewer가 반드시 볼 파일

### 5.1 변경 파일

- [IssueRow.tsx](ui/src/components/IssueRow.tsx) — identifier span
- [MeetingRoomPanel.tsx](ui/src/components/MeetingRoomPanel.tsx) — 결론 카드(`showConclusionCard`), 토글 버튼(`metaPanelOpen`), 용어 변경
- [meeting-room.ts](ui/src/lib/meeting-room.ts) — `summarizeMeetingTranscriptEntry`
- [IssueDetail.tsx](ui/src/pages/IssueDetail.tsx) — `max-w-3xl`, `isChildOfMeeting`, 맥락 카드 블록
- [OfficeSidebar.tsx](ui/src/components/office/OfficeSidebar.tsx) — 작업 큐 링크 카드
- [Inbox.tsx](ui/src/pages/Inbox.tsx) — `PageTabBar items`, empty state
- [Sidebar.tsx](ui/src/components/Sidebar.tsx) — 섹션 레이블, 항목 순서
- [OfficeConversationPanel.tsx](ui/src/components/office/OfficeConversationPanel.tsx) — 용어, ThreadHeader, ThreadList

### 5.2 회귀 확인 파일 (변경 없음, 호환성만 확인)

- [meeting-room.test.ts](ui/src/lib/meeting-room.test.ts)
- [meetings-service.test.ts](server/src/__tests__/meetings-service.test.ts)
- [inbox.test.ts](ui/src/lib/inbox.test.ts)

### 5.3 미변경 (다음 패스 대상)

- [OfficeView.tsx](ui/src/pages/OfficeView.tsx) — 오른쪽 공간 재조정 미변경

---

## 6. 검증 항목

### 6.1 시각 검증

| 항목 | 기대 동작 |
|------|-----------|
| IssueRow hover 전 | STU 식별자 안 보임 |
| IssueRow hover 후 | STU 식별자 페이드인 |
| MeetingRoomPanel — 진행 중 회의 | 결론 카드 없음, "확인이 필요합니다" badge 가능 |
| MeetingRoomPanel — 완료 회의 (final_summary 있음) | 결론 카드 emerald 스타일, final_summary body 표시, "대화에서 전체 보기 ↓" 버튼 |
| MeetingRoomPanel — 완료 회의 (final_summary 없음) | 결론 카드 muted 스타일, meeting_completed body 표시, 스크롤 버튼 없음 |
| MeetingRoomPanel 헤더 | 식별자 맨 뒤 희미하게 |
| MeetingRoomPanel "회의 대화" 헤더 | 오른쪽에 PanelRight 토글 버튼 |
| MeetingRoomPanel 토글 닫힘 | 우측 메타 패널 사라짐, 대화 열 전체 폭으로 확장 |
| MeetingRoomPanel 토글 열림 | 우측 메타 패널 다시 표시, 아이콘 반전 복구 |
| MeetingRoomPanel compact 모드 | 토글 버튼 없음, 패널 항상 표시 |
| IssueDetail (회의 자식 이슈) | 상단 맥락 카드 + "회의실로 돌아가기 →" 링크 |
| IssueDetail (일반 이슈) | 맥락 카드 없이 breadcrumb만 표시 |
| IssueDetail 본문 폭 | max-w-3xl |
| OfficeSidebar 작업 큐 | 제목 primary, 식별자 하단 희미하게 |
| Inbox 탭 | "지금 확인할 것 / 안 읽음 / 최근 활동 / 전체" 순서 |
| Sidebar 섹션 | "지금 할 일 / 작업 관리 / 프로젝트 / 에이전트 / 조직 설정" |
| Sidebar 지금 할 일 순서 | 새 이슈 버튼 → 받은 편지함 → 오피스 → 대시보드 |
| OfficeConversationPanel 헤더 | "AI Company Messenger" eyebrow 없음 |
| OfficeConversationPanel 전체회의 준비 설명 | "orchestrated" 단어 없음 |
| OfficeConversationPanel 회의 목록 헤더 설명 | "legacy" 단어 없음 |
| OfficeConversationPanel ThreadHeader 레이블 | "선택된 대화", 식별자 희미하게 |
| OfficeConversationPanel ThreadList 항목 | 제목 최상단, 식별자 타임스탬프 옆 희미하게 |

### 6.2 기능 회귀 검증

| 항목 | 기대 동작 |
|------|-----------|
| 회의실 컨트롤 버튼 | start/pause/resume/continue/finalize/재토론/요약 모두 정상 |
| 의견 등록 버튼 | POST /comments 호출, 성공 toast 표시 |
| "대화에서 전체 보기 ↓" 버튼 | `final_summary` entry로 부드럽게 스크롤 |
| Inbox 탭 클릭 | 각 탭 라우팅, `saveLastInboxTab` 정상 동작 |
| Inbox mine 탭 | `isMineInboxTab("mine")` === true, 정리 버튼 표시 |
| IssueDetail 맥락 카드 링크 | orchestrated meeting root로 올바르게 이동 |
| IssueDetail 일반 이슈 | 맥락 카드 없이 breadcrumb만 |
| meeting-room.test.ts | `summarizeMeetingTranscriptEntry` 통과 |
| inbox.test.ts | 탭 값 로직 통과 |

---

## 7. known exception / 의도적 미변경

- `operatorCommentBody` 상태명, API 호출 경로 불변 — 내부 타입 및 서버 계약 유지
- `entryKind` 값 (`operator_comment`, `operator_signal`, `final_summary` 등) 불변 — 서버 DTO 계약
- `InboxTab` 타입 값 (`mine`/`unread`/`recent`/`all`) 불변 — 라우팅/로컬스토리지 키 안정성
- `IssueRow` identifier는 DOM에 존재 — 접근성 및 copy-paste 가능
- `metaPanelOpen` 상태는 영구 저장 없음 (새로고침 시 열림 상태로 리셋) — 의도적
- `OfficeView.tsx` 미변경 — 다음 패스에서 오른쪽 공간 재조정 예정

---

## 8. 수행할 테스트

```bash
# 타입체크
pnpm -r typecheck

# 빌드
pnpm build

# 관련 단위 테스트
pnpm --filter @paperclipai/ui exec vitest run src/lib/meeting-room.test.ts
pnpm --filter @paperclipai/ui exec vitest run src/lib/inbox.test.ts
pnpm --filter @paperclipai/ui exec vitest run src/lib/issue-detail-controls.test.ts
pnpm --filter @paperclipai/server exec vitest run src/__tests__/meetings-service.test.ts
```

---

## 9. 전달용 프롬프트

```text
Paperclip AI UI 단순화 변경(1차+2차 패스 통합)을 교차검증해 주세요.

변경 범위: 기능 변경 없음. copy, 식별자 노출 우선순위, 결론 카드, 메타 패널 토글, 오피스 패널 용어 정리, 탭/그룹 레이블 조정입니다.

구현된 변경사항:
1. IssueRow STU 식별자 기본 숨김 (hover 시 표시)
2. MeetingRoomPanel 용어 사람 언어로 변경 (transcript→대화, 운영자 코멘트→내 의견 남기기 등)
3. MeetingRoomPanel 완료 회의 결론 카드 추가 (final_summary body 노출 + 스크롤 앵커)
4. MeetingRoomPanel 오른쪽 메타 패널 토글 버튼 추가 (PanelRight 아이콘)
5. IssueDetail 회의 자식 이슈 맥락 카드 + 본문 폭 max-w-3xl
6. OfficeSidebar 작업 큐 식별자 보조로 이동
7. Inbox 탭 "지금 확인할 것 / 안 읽음 / 최근 활동 / 전체" 순서로 변경
8. Sidebar "지금 할 일 / 작업 관리 / 조직 설정" 목적 기반 그룹
9. OfficeConversationPanel "AI Company Messenger" 및 "orchestrated", "legacy" 기술 용어 제거
10. OfficeConversationPanel ThreadList 제목을 primary로, 식별자를 타임스탬프 옆 희미하게

회귀 확인 포인트:
- meeting control mutations (start/pause/resume/continue/finalize/reopen/summary/remind/skip) 동작 유지
- operator comment POST /comments 유지 (버튼 레이블만 변경)
- InboxTab 값 자체 (mine/unread/recent/all) 불변 — 라우팅 안정
- isMineInboxTab("mine") === true 유지
- 결론 카드: 진행 중 회의에서는 미표시 확인
- 메타 패널 토글: compact 모드에서 토글 버튼 없음, 패널은 항상 표시 확인
- IssueDetail 맥락 카드: non-meeting 이슈에서 breadcrumb만 표시
- meeting-room.test.ts, inbox.test.ts, meetings-service.test.ts 통과

깨지면 안 되는 것:
- orchestrated meeting read-only guard
- MeetingRoomDTO 렌더링 계약
- entryKind 값 (server DTO contract)

Sidebar "지금 할 일" 실제 순서: 새 이슈 버튼 → 받은 편지함 → 오피스 → 대시보드
```
