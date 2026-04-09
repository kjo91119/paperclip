# 2026-04-09 UI Simplification Brief For Claude

## 목적

Paperclip UI는 현재 "AI 운영자용 control plane" 관점이 너무 강해서, 일반 사용자가 처음 들어왔을 때 다음을 빠르게 이해하기 어렵다.

- 지금 어디에 있는지
- 무엇을 먼저 해야 하는지
- `STU-38`, `orchestrated`, `operator`, `thread`, `issue` 같은 내부 용어가 실제로 무엇을 뜻하는지

이번 변경의 목표는 기능을 줄이는 것이 아니라, **초보자 기본 화면을 사람 언어 중심으로 재구성**하는 것이다.

핵심 원칙은 다음 4가지다.

1. 기본 화면은 사람 언어로 보인다.
2. 내부 식별자와 운영 용어는 2차 정보로 밀어낸다.
3. 고급 제어와 진단 정보는 점진적으로 드러낸다.
4. 회의/이슈/에이전트의 실제 동작 모델은 유지하되, 노출 표현만 더 쉽게 바꾼다.

---

## 현재 문제 요약

### 1. 식별자 중심 노출

- `STU-38`, `PAP-123` 같은 내부 식별자가 제목만큼 강하게 보인다.
- 일반 사용자는 이 값이 무엇인지 모른다.
- 특히 `Office`, `Inbox`, `IssueDetail`, `Sidebar`에서 제목보다 먼저 시야를 잡아먹는다.

### 2. 계층 표현이 breadcrumb 링크 나열에 치우침

- `IssueDetail` 상단의 부모-자식 체인은 잘리고, 작고, 링크 나열만 되어 있다.
- 사용자는 "내가 지금 전체 흐름의 어디를 보고 있는지"를 이해하기 어렵다.

### 3. Inbox가 "받은 편지함"이 아니라 운영 이벤트 집합소처럼 보임

- 탭, 서브필터, signal, approval, failed run이 동시에 노출된다.
- 사용자는 "무엇이 지금 내 액션을 요구하는지"보다 "많은 종류의 시스템 상태"를 먼저 보게 된다.

### 4. IssueDetail이 사람용 문서와 에이전트용 작업지시를 분리하지 않음

- AI 작업지시서 구조와 사람 읽기용 화면이 충분히 분리되어 있지 않다.
- 회의/일반 이슈/하위 이슈의 맥락도 같은 톤으로 보여서, 인간 사용자 기준 가독성이 떨어진다.

### 5. Office가 너무 운영자 중심 화면으로 보임

- `orchestrated meeting`, `thread`, `gate`, `current thread`, `operator comment` 같은 용어가 기본 노출된다.
- 회의/대화 흐름은 사람 기준으로는 더 친근한 표현이 필요하다.

### 6. 사이드바가 도메인 모델 중심

- `이슈`, `루틴`, `목표`, `프로젝트`, `에이전트`, `오피스`, `비용`, `활동`이 내부 모델 순서로 배치돼 있다.
- 사용자 목적 관점의 정보 구조가 약하다.

### 7. 회의/승인 결과를 읽어도 "결론이 뭐냐"가 바로 안 보임

- 실제 회의/승인 출력은 `Update`, `Approval`, `관련 이슈`, `owner`, `gate`, `first ask`, `조건부`, `snapshot` 같은 운영 문장과 긴 본문이 섞여 있다.
- 사용자는 아래를 가장 먼저 알고 싶다.
  - 결국 승인된 건지 아닌지
  - 지금 당장 해야 하는 다음 행동이 뭔지
  - 누가 뭘 맡는지
- 그런데 현재 화면은 원문이 길게 이어져서, 사람 입장에서 핵심 판단을 추출해야 한다.

예:

- `지금 채용 승인된 건 아님`
- `파일럿 통과 후 2명 요청 가능`
- `CMO가 요청서 작성, CTO가 기준 확인, CEO가 최종 승인`

이런 한 줄/세 줄 결론이 먼저 보여야 한다.

### 8. IssueDetail / 회의실 읽기 레이아웃이 답답하고 오른쪽 공간이 비효율적임

- 현재 회의/이슈 본문은 왼쪽 콘텐츠 영역이 좁고, 오른쪽에는 메타 카드가 세로로 쌓이며 큰 빈 공간이 생긴다.
- 사용자는 긴 회의 응답과 요약을 읽어야 하는데, 실제 읽는 영역은 좁고 줄바꿈이 잦아서 더 "웅장하고 피곤한 문서"처럼 느껴진다.
- 특히 아래 문제가 겹친다.
  - 본문/대화 열이 좁다
  - 오른쪽 메타 영역의 우선순위가 높아 보인다
  - 시스템 카드와 상태 카드가 너무 크게 눈에 띈다

즉, 현재 레이아웃은 "읽는 화면"보다 "관리 패널"에 가깝다.

---

## 이번 작업에서 기대하는 결과

이번 변경은 "전체 리디자인"이 아니라 **첫 번째 큰 단순화 패스**다.

아래 7가지는 이번 변경에서 실제로 개선해주길 기대한다.

1. `STU-38` 같은 식별자를 기본 화면에서 강하게 보이지 않게 만들기
2. `IssueDetail`의 현재 위치/맥락을 breadcrumb보다 이해하기 쉽게 만들기
3. `Inbox`를 "지금 확인할 것" 중심으로 단순화하기
4. `Office`와 `회의실` 용어를 더 쉬운 한국어로 바꾸기
5. 사이드바를 처음 보는 사람이 목적 중심으로 이해하기 쉽게 다듬기
6. 회의/승인/토론 결과에서 `한 줄 결론 / 현재 결정 / 다음 행동 / 담당자`가 먼저 보이게 만들기
7. 긴 읽기 화면에서는 오른쪽 빈 공간을 줄이고, 본문 가독성을 우선하는 레이아웃으로 바꾸기

---

## 절대 깨지면 안 되는 invariant

이 작업은 UI/표현 변경이다. 아래 동작 계약은 깨지면 안 된다.

### 회의/오케스트레이터 invariant

- orchestrated meeting root issue는 generic issue plane에서 read-only 경계를 유지해야 한다.
- `MeetingRoomDTO` 기반 렌더링 계약은 유지해야 한다.
- operator comment / followup / summary / finalize 흐름은 깨지면 안 된다.
- `summary` 라운드는 더 이상 자동 종료되지 않고, 운영자가 `회의 종료`를 눌러야 닫히는 현재 동작을 유지해야 한다.
- `전원 재토론` 흐름은 유지해야 한다.

관련 파일:

- [meetings.ts](/mnt/d/project/paperclipai/server/src/services/meetings.ts)
- [meetings.ts](/mnt/d/project/paperclipai/server/src/routes/meetings.ts)
- [MeetingRoomPanel.tsx](/mnt/d/project/paperclipai/ui/src/components/MeetingRoomPanel.tsx)
- [meeting-room.ts](/mnt/d/project/paperclipai/ui/src/lib/meeting-room.ts)

### 회사 prefix / 라우팅 invariant

- `companyPrefix`가 붙은 라우팅 규칙은 유지해야 한다.
- issue/agent 상세 링크 생성 로직을 깨면 안 된다.

관련 파일:

- [router.tsx](/mnt/d/project/paperclipai/ui/src/lib/router.tsx)
- [issueDetailBreadcrumb.ts](/mnt/d/project/paperclipai/ui/src/lib/issueDetailBreadcrumb.ts)
- [utils.ts](/mnt/d/project/paperclipai/ui/src/lib/utils.ts)

### 숨김/정리 동작 invariant

- 회의/대화 `정리`는 삭제가 아니라 soft-hide 이어야 한다.
- 완료된 회의와 정리된 회의의 데이터 모델은 유지하되, 노출 방식만 바꿔야 한다.

관련 파일:

- [OfficeView.tsx](/mnt/d/project/paperclipai/ui/src/pages/OfficeView.tsx)
- [officeViewModel.ts](/mnt/d/project/paperclipai/ui/src/pages/officeViewModel.ts)

### unread / participant / inbox invariant

- participantAgentId 기반 참여 판정
- unread/recency 계산
- meeting system comment relevance

이 계약은 유지해야 한다.

관련 파일:

- [issues.ts](/mnt/d/project/paperclipai/server/src/services/issues.ts)
- [issues-service.test.ts](/mnt/d/project/paperclipai/server/src/__tests__/issues-service.test.ts)
- [inbox.test.ts](/mnt/d/project/paperclipai/ui/src/lib/inbox.test.ts)

---

## 제안하는 변경 방향

### A. 식별자 노출 축소

#### 목표

- 기본 화면에서 사람은 제목을 먼저 보고, 식별자는 필요할 때만 보게 한다.

#### 제안

- `IssueRow`, `OfficeSidebar`, `OfficeConversationPanel`, `Inbox`, `IssueDetail` 상단에서 식별자 노출 우선순위를 낮춘다.
- 기본:
  - 제목 우선
  - 식별자는 보조 텍스트 또는 hover/copy 영역
- 가능하면 표현을 아래처럼 바꾼다.
  - `STU-38` -> `회의 #38` 또는 `작업 #38`
  - 단, 내부 identifier 자체를 제거하지는 말고 secondary metadata로 유지

#### 손댈 가능성이 높은 파일

- [IssueRow.tsx](/mnt/d/project/paperclipai/ui/src/components/IssueRow.tsx)
- [Inbox.tsx](/mnt/d/project/paperclipai/ui/src/pages/Inbox.tsx)
- [OfficeSidebar.tsx](/mnt/d/project/paperclipai/ui/src/components/office/OfficeSidebar.tsx)
- [OfficeConversationPanel.tsx](/mnt/d/project/paperclipai/ui/src/components/office/OfficeConversationPanel.tsx)
- [IssueDetail.tsx](/mnt/d/project/paperclipai/ui/src/pages/IssueDetail.tsx)

---

### B. IssueDetail 맥락 표현 개선

#### 목표

- 사용자가 "지금 보고 있는 것이 전체회의인지, 하위 작업인지, 누구의 응답인지"를 breadcrumb 링크 해석 없이 알 수 있어야 한다.

#### 제안

- breadcrumb는 유지하되, 그 위 또는 바로 아래에 **사람 언어 요약 카드**를 추가한다.
- 예:
  - `이 화면은 "장사톡 전략 회의"의 하위 작업입니다`
  - `현재 단계: CTO 응답`
  - `원래 회의로 돌아가기`
- ancestor 링크는 2차 정보로 남기고, primary context는 문장형으로 보여준다.

#### 손댈 가능성이 높은 파일

- [IssueDetail.tsx](/mnt/d/project/paperclipai/ui/src/pages/IssueDetail.tsx)
- [issueDetailBreadcrumb.ts](/mnt/d/project/paperclipai/ui/src/lib/issueDetailBreadcrumb.ts)

---

### C. Inbox 단순화

#### 목표

- Inbox를 "모든 이벤트의 허브"가 아니라 "지금 봐야 할 것" 중심으로 바꾼다.

#### 제안

- 기본 탭 수를 줄이거나, 고급 필터를 접어둔다.
- 기본 landing은 `지금 확인할 것` 또는 `우선 확인` 느낌으로 정리
- approval / failed run / notifications는 2차 섹션 또는 보조 필터로 내린다.
- empty state와 tab copy를 더 직접적으로 바꾼다.

#### 손댈 가능성이 높은 파일

- [Inbox.tsx](/mnt/d/project/paperclipai/ui/src/pages/Inbox.tsx)
- [inbox.ts](/mnt/d/project/paperclipai/ui/src/lib/inbox.ts)
- [inbox.test.ts](/mnt/d/project/paperclipai/ui/src/lib/inbox.test.ts)

---

### D. Office / 회의실 용어를 쉬운 말로 변경

#### 목표

- `orchestrated`, `thread`, `operator`, `transcript` 같은 용어를 기본 화면에서 걷어낸다.

#### 제안

- `회의 transcript` -> `회의 대화`
- `운영자 코멘트` -> `내 의견` 또는 `운영자 메모`
- `현재 스레드` -> `지금 보고 있는 대화`
- `orchestrated meeting room` -> `회의실`
- `thread` -> `대화`
- `operator signal` -> `안내` 또는 `회의 안내`

주의:
- 내부 타입/entryKind 이름까지 바꿀 필요는 없다.
- UI 노출 copy만 사람 친화적으로 바꾸면 된다.

#### 손댈 가능성이 높은 파일

- [MeetingRoomPanel.tsx](/mnt/d/project/paperclipai/ui/src/components/MeetingRoomPanel.tsx)
- [meeting-room.ts](/mnt/d/project/paperclipai/ui/src/lib/meeting-room.ts)
- [OfficeView.tsx](/mnt/d/project/paperclipai/ui/src/pages/OfficeView.tsx)
- [OfficeConversationPanel.tsx](/mnt/d/project/paperclipai/ui/src/components/office/OfficeConversationPanel.tsx)
- [OfficeSidebar.tsx](/mnt/d/project/paperclipai/ui/src/components/office/OfficeSidebar.tsx)

---

### E. 회의/승인 출력에 사람용 요약 계층 추가

#### 목표

- 사용자가 긴 원문을 다 읽지 않아도 `결론`, `현재 상태`, `다음 행동`, `담당자`를 먼저 이해할 수 있어야 한다.

#### 제안

- 회의 transcript / 승인 출력 / 운영자 신호 위에 **사람용 요약 블록**을 추가한다.
- 우선순위는 아래 순서가 좋다.
  - 한 줄 결론
  - 현재 결정
  - 다음 행동
  - 담당자
- 긴 원문은 접기/펼치기 구조를 더 적극적으로 쓴다.
- `Update`, `Approval` 같은 시스템 태그보다, 사람이 이해할 수 있는 결론형 문장을 먼저 보여준다.

예:

- `현재 결정: 아직 채용 승인 아님`
- `다음 행동: 현재 팀으로 3일 파일럿 진행`
- `담당: CMO 요청서, CTO 기준 확인, CEO 최종 승인`

#### 손댈 가능성이 높은 파일

- [MeetingRoomPanel.tsx](/mnt/d/project/paperclipai/ui/src/components/MeetingRoomPanel.tsx)
- [meeting-room.ts](/mnt/d/project/paperclipai/ui/src/lib/meeting-room.ts)
- [IssueDetail.tsx](/mnt/d/project/paperclipai/ui/src/pages/IssueDetail.tsx)

---

### F. 읽기 중심 레이아웃으로 재조정

#### 목표

- 회의/이슈 상세는 "관리 패널"보다 "읽고 판단하는 화면"처럼 보여야 한다.

#### 제안

- 긴 본문/회의 transcript가 있는 화면에서는 본문 열을 더 넓힌다.
- 오른쪽 메타 카드 열은 아래 중 하나로 재구성한다.
  - 중요 카드만 남기고 줄이기
  - 일부를 접기
  - 모바일/중간 폭에서는 본문 아래로 내리기
- 읽는 흐름을 끊는 카드와 배지를 줄이고, 본문 주변 여백/줄 길이를 더 읽기 친화적으로 조정한다.
- 특히 사용자가 지적한 "오른쪽 빈공간"은 그냥 비워두지 말고:
  - 본문을 넓히거나
  - 메타 정보를 더 작은 요약 카드로 압축하거나
  - 중요한 결정/다음 액션 카드로 바꿔야 한다.

#### 손댈 가능성이 높은 파일

- [IssueDetail.tsx](/mnt/d/project/paperclipai/ui/src/pages/IssueDetail.tsx)
- [MeetingRoomPanel.tsx](/mnt/d/project/paperclipai/ui/src/components/MeetingRoomPanel.tsx)
- [OfficeView.tsx](/mnt/d/project/paperclipai/ui/src/pages/OfficeView.tsx)

---

### G. 사이드바를 목적 중심으로 정리

#### 목표

- 사용자가 메뉴 이름만 보고도 "어디서 무엇을 하는지" 감이 와야 한다.

#### 제안

- 도메인 모델 중심 메뉴를 완전히 뒤집지 않더라도, 시각적 그룹/레이블을 더 분명히 나눈다.
- 예:
  - `지금 할 일`
    - 받은 편지함
    - 오피스
    - 이슈
  - `운영 관리`
    - 프로젝트
    - 에이전트
    - 루틴
    - 목표
  - `조직/설정`
    - 조직
    - 기술
    - 비용
    - 활동
    - 설정

가능하면 텍스트만 바꾸는 것이 아니라, 그룹 제목과 우선순위를 함께 조정한다.

#### 손댈 가능성이 높은 파일

- [Sidebar.tsx](/mnt/d/project/paperclipai/ui/src/components/Sidebar.tsx)
- [SidebarSection.tsx](/mnt/d/project/paperclipai/ui/src/components/SidebarSection.tsx)
- [Layout.tsx](/mnt/d/project/paperclipai/ui/src/components/Layout.tsx)

---

## 구현 시 지켜야 할 실무 원칙

1. 기능을 숨기더라도 제거하지는 말 것
- power user 기능은 `자세히`, `고급 보기`, `보조 텍스트`로 이동

2. 내부 모델을 없애지 말 것
- `identifier`, `meetingMode`, `entryKind`, `status`는 유지
- 다만 사용자 기본 화면의 시각적 우선순위에서 내릴 것

3. 회의 room과 일반 issue detail을 섞지 말 것
- orchestrated meeting은 현재 전용 room 패턴을 유지

4. blank screen을 다시 만들지 말 것
- 최근 `IssueDetail` / `AgentDetail` / dev service worker 관련 안정화가 들어가 있음
- 이 변경을 되돌리거나, 다시 `return null` 류 blank path를 만들지 말 것

5. copy 개선은 과감하게, 상태 모델은 보수적으로
- 버튼 문구, 섹션 제목, 설명 텍스트는 적극적으로 바꿔도 됨
- API/상태머신/meeting control contract는 함부로 바꾸지 말 것

---

## 추천 작업 순서

### 1차 패스

- `STU` 식별자 노출 축소
- `MeetingRoomPanel` / `OfficeConversationPanel` / `OfficeSidebar` 용어 정리
- `IssueDetail` 상단 맥락 카드 추가
- 회의/승인 출력에 `한 줄 결론 / 현재 결정 / 다음 행동 / 담당자` 요약 계층 추가
- 긴 읽기 화면의 본문 폭과 오른쪽 메타 패널 재조정

### 2차 패스

- Inbox 단순화
- Sidebar 목적 기반 정리

### 3차 패스

- 사람용 보기 / 고급 운영 보기 분리
- AI 작업지시 포맷과 사람 읽기 포맷 분리

---

## 추가로 고려할 2차 패스 후보

아래 항목들은 이번 1차 패스에 꼭 포함되지 않아도 되지만, 실제 사용성 체감 개선이 큰 후보들이다.

### A. 바로 체감되는 저난이도 개선

#### 1. IssueDetail 제목 인라인 편집 발견성 개선

- 지금은 제목이 편집 가능한지 눈에 잘 안 들어온다.
- hover 또는 focus 시 아래 같은 힌트를 줄 수 있다.
  - 배경색 미세 변화
  - 연필 아이콘
  - `클릭해서 수정` 같은 짧은 힌트

목표:
- "이 제목은 수정 가능한 텍스트다"를 별도 설명 없이 알게 하기

#### 2. Inbox 알림 배지 심각도 분리

- 현재는 failed run이 아닌 단순 업데이트도 빨간 배지로 느껴지는 경우가 있어, 전체 화면이 항상 긴급해 보인다.
- severity를 구분하는 것이 좋다.

예:
- `red`: 실제 실패 / 즉시 조치 필요
- `amber`: 확인 필요 / 주의
- `default`: 일반 업데이트 / 참고용

목표:
- 진짜 중요한 것만 강하게 보이게 만들기

#### 3. 회의실 `현재 라운드 상태` 카드 자동 접기

- 참가자가 모두 응답했는데도 현재 라운드 상태 카드가 길게 남아 있으면, 이미 끝난 정보를 계속 읽게 된다.
- 전원 완료 시에는 기본적으로 아래처럼 압축하는 것이 좋다.

예:
- `✓ 모두 응답했습니다`
- `응답 3/3 · 자세히 보기`

목표:
- 회의 화면이 "지나간 상태 패널"보다 "현재 읽어야 할 대화" 중심으로 보이게 하기

### B. 구조적인 중간 난이도 개선

#### 4. 오피스 작업 큐에서 회의/일반 이슈 구분 배지 추가

- 지금은 작업 큐에서 회의 이슈와 일반 이슈가 섞여 보여 클릭 전엔 성격을 알기 어렵다.
- 회의 이슈에는 작은 `회의` 배지를 붙이면 좋다.

예:
- `회의`
- `작업`

목표:
- 클릭 전에 "이건 대화/회의 흐름인지, 일반 작업인지" 바로 알게 하기

#### 5. IssueDetail 빠른 답글 UX

- 현재 일반 이슈 댓글 입력창은 긴 본문/긴 댓글 아래까지 내려가야 한다.
- 바로 floating composer까지 갈 필요는 없지만, 최소한 아래 중 하나는 고려할 가치가 있다.
  - 상단 `빠른 답글` 버튼
  - 하단 고정 `답글 쓰기` 진입 바
  - 긴 스크롤 뒤에도 바로 이동 가능한 `답글로 이동`

목표:
- 긴 이슈에서도 "읽고 곧바로 답하는" 흐름을 더 자연스럽게 만들기

우선순위 추천:

1. Inbox 배지 심각도 분리
2. 오피스 작업 큐 회의 배지
3. 현재 라운드 상태 자동 접기
4. 제목 인라인 편집 힌트
5. 빠른 답글 UX

---

## 완료 기준

아래가 충족되면 이번 작업은 성공이다.

1. 처음 보는 사용자가 `STU`, `orchestrated`, `operator`, `thread`를 몰라도 핵심 흐름을 읽을 수 있다.
2. 회의/승인 출력에서 원문을 다 읽지 않아도 `결론 / 현재 결정 / 다음 행동 / 담당자`를 먼저 파악할 수 있다.
3. 회의 화면에서 "지금 무슨 단계인지 / 내가 뭘 할 수 있는지"가 더 빨리 보인다.
4. IssueDetail에서 현재 위치와 부모 맥락을 breadcrumb 해석 없이 이해할 수 있다.
5. 읽기 화면에서 본문이 너무 좁거나 오른쪽 공간이 비어 보여 불편하다는 느낌이 줄어든다.
6. Inbox의 기본 화면이 "뭘 눌러야 할지 모르겠다"보다 "지금 확인할 걸 보여준다"에 가까워진다.
7. 기존 meeting/issue/server invariant는 유지된다.

---

## 꼭 봐야 할 파일

### UI 핵심

- [MeetingRoomPanel.tsx](/mnt/d/project/paperclipai/ui/src/components/MeetingRoomPanel.tsx)
- [meeting-room.ts](/mnt/d/project/paperclipai/ui/src/lib/meeting-room.ts)
- [IssueDetail.tsx](/mnt/d/project/paperclipai/ui/src/pages/IssueDetail.tsx)
- [Inbox.tsx](/mnt/d/project/paperclipai/ui/src/pages/Inbox.tsx)
- [OfficeView.tsx](/mnt/d/project/paperclipai/ui/src/pages/OfficeView.tsx)
- [OfficeConversationPanel.tsx](/mnt/d/project/paperclipai/ui/src/components/office/OfficeConversationPanel.tsx)
- [OfficeSidebar.tsx](/mnt/d/project/paperclipai/ui/src/components/office/OfficeSidebar.tsx)
- [Sidebar.tsx](/mnt/d/project/paperclipai/ui/src/components/Sidebar.tsx)
- [IssueRow.tsx](/mnt/d/project/paperclipai/ui/src/components/IssueRow.tsx)

### 회귀/계약 확인

- [meetings.ts](/mnt/d/project/paperclipai/server/src/services/meetings.ts)
- [issues.ts](/mnt/d/project/paperclipai/server/src/services/issues.ts)
- [meetings-service.test.ts](/mnt/d/project/paperclipai/server/src/__tests__/meetings-service.test.ts)
- [issues-service.test.ts](/mnt/d/project/paperclipai/server/src/__tests__/issues-service.test.ts)
- [inbox.test.ts](/mnt/d/project/paperclipai/ui/src/lib/inbox.test.ts)
- [meeting-room.test.ts](/mnt/d/project/paperclipai/ui/src/lib/meeting-room.test.ts)

### 참고 문서

- [2026-04-07-facilitated-meeting-orchestrator-plan.md](/mnt/d/project/paperclipai/doc/plans/2026-04-07-facilitated-meeting-orchestrator-plan.md)
- [2026-04-07-facilitated-meeting-orchestrator-final-cross-verification.md](/mnt/d/project/paperclipai/doc/plans/2026-04-07-facilitated-meeting-orchestrator-final-cross-verification.md)
- [2026-04-08-meeting-operator-comment-cross-verification.md](/mnt/d/project/paperclipai/doc/plans/2026-04-08-meeting-operator-comment-cross-verification.md)

---

## 전달용 프롬프트

```text
Paperclip UI가 현재 너무 운영자/개발자 용어 중심이라 일반 사용자가 이해하기 어렵습니다.

이번 작업 목표는 기능을 줄이는 것이 아니라, 초보자 기본 화면을 사람 언어 중심으로 재구성하는 것입니다.

반드시 해결하고 싶은 문제:
1. STU-38 같은 내부 식별자가 제목보다 강하게 보임
2. IssueDetail에서 부모-자식 맥락이 breadcrumb 링크 나열로만 표현됨
3. Inbox가 "지금 확인할 것"보다 "시스템 이벤트 집합소"처럼 보임
4. Office / 회의실 용어가 orchestrated, operator, transcript, thread처럼 너무 기술적임
5. 사이드바가 내부 도메인 모델 중심이라 처음 보는 사람이 어디서 뭘 해야 할지 모름
6. 회의/승인 결과를 읽어도 결국 승인된 건지, 지금 해야 할 다음 행동이 뭔지 바로 안 보임
7. 긴 읽기 화면에서 오른쪽 빈 공간이 커서 본문 읽기가 오히려 더 불편함

원칙:
- 기본 화면은 사람 언어
- 내부 식별자/상태/운영 용어는 2차 정보
- 고급 제어는 점진적으로 노출
- meeting / issue / company routing invariant는 유지
- orchestrated meeting room / operator comment / followup / summary / finalize 흐름은 깨지지 않아야 함
- blank screen 방지용 recent guard는 되돌리지 말 것

먼저 아래 파일들을 중심으로 실제 개선안을 구현해 주세요:
- ui/src/components/MeetingRoomPanel.tsx
- ui/src/lib/meeting-room.ts
- ui/src/pages/IssueDetail.tsx
- ui/src/pages/Inbox.tsx
- ui/src/pages/OfficeView.tsx
- ui/src/components/office/OfficeConversationPanel.tsx
- ui/src/components/office/OfficeSidebar.tsx
- ui/src/components/Sidebar.tsx
- ui/src/components/IssueRow.tsx

그리고 다음 회귀 확인도 같이 봐 주세요:
- server/src/services/meetings.ts
- server/src/services/issues.ts
- server/src/__tests__/meetings-service.test.ts
- server/src/__tests__/issues-service.test.ts
- ui/src/lib/inbox.test.ts
- ui/src/lib/meeting-room.test.ts

이번 패스는 "큰 재설계"가 아니라 첫 번째 단순화 패스입니다.
우선 STU 노출 축소, 쉬운 카피, 회의/이슈 맥락 표현 개선, 회의/승인 결과 요약 계층 추가, 읽기 레이아웃 개선부터 진행해 주세요.

추가로 2차 패스 후보로 아래도 고려해 주세요:
- Inbox 알림 배지 심각도(red/amber/default) 분리
- 오피스 작업 큐의 회의 배지 추가
- 회의실 현재 라운드 상태 카드의 전원 완료 시 자동 접기
- IssueDetail 제목 인라인 편집 힌트
- IssueDetail 빠른 답글 UX
```
