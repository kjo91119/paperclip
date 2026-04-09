# 2026-04-09 Agent Language Clarity Cross-Verification

## 1. 목적

이번 변경은 에이전트가 board(사람 사용자)에게 답할 때 너무 내부 용어와 운영 문장 중심으로 길게 쓰는 문제를 줄이는 것이다.

목표는 기능 변경이 아니라 **에이전트의 board-facing 답변 스타일을 더 쉽게 이해되는 사람말 중심으로 유도하는 것**이다.

핵심 기대 결과:

- 내부 식별자(`STU-51` 등)를 앞세우지 않는다.
- 먼저 `쉽게 말하면 / 지금 상태 / 다음 할 일` 흐름으로 설명한다.
- 사람이 별도 해석 없이 "결국 무슨 뜻인지"를 빠르게 이해할 수 있다.

---

## 2. 범위

이번 변경은 두 층으로 이루어진다.

### 2.1 코드 변경 (git tracked)

- 공통 adapter prompt note 강화
- 기본 에이전트 지침 강화
- CEO 전용 지침 강화
- 회귀 테스트 추가

### 2.2 런타임 적용 (git tracked 아님, live instance patch)

현재 dev 인스턴스에서 아래 회사의 실제 CEO/CMO/CTO instruction bundle도 직접 갱신했다.

- `STUDIOJUN`
- `outo jun`

즉 reviewer는

1. git 코드 변경 검토
2. 현재 인스턴스의 live instruction bundle 반영 여부 확인

두 가지를 모두 봐야 한다.

중요:

- 이 2번은 **dev 서버가 실제로 떠 있어야만** 재현 가능하다.
- 현재 기준 기본 확인 주소는 `http://127.0.0.1:3100` 또는 `http://localhost:3100` 이다.
- 현재 인스턴스는 `local_trusted` 기준이라 bundle 조회에는 별도 board auth header가 필요하지 않았다.

---

## 3. 변경 파일

### 3.1 코드 변경 파일

- [server-utils.ts](/mnt/d/project/paperclipai/packages/adapter-utils/src/server-utils.ts)
- [default AGENTS.md](/mnt/d/project/paperclipai/server/src/onboarding-assets/default/AGENTS.md)
- [CEO AGENTS.md](/mnt/d/project/paperclipai/server/src/onboarding-assets/ceo/AGENTS.md)
- [CEO HEARTBEAT.md](/mnt/d/project/paperclipai/server/src/onboarding-assets/ceo/HEARTBEAT.md)
- [paperclip-skill-utils.test.ts](/mnt/d/project/paperclipai/server/src/__tests__/paperclip-skill-utils.test.ts)

### 3.2 런타임 확인 대상

현재 live로 반영된 에이전트:

- `STUDIOJUN` CEO / CMO / CTO
- `outo jun` CEO / CMO / CTO

검증 포인트:

- `AGENTS.md` bundle에 사람말 우선 규칙이 들어갔는지
- CEO는 `HEARTBEAT.md`에도 같은 취지의 규칙이 들어갔는지

### 3.3 독립 reviewer용 재현 절차

1. dev 서버가 안 떠 있으면 프로젝트 루트에서 아래 명령으로 실행

```bash
pnpm dev
```

2. health 확인

```bash
curl http://127.0.0.1:3100/api/health
curl http://localhost:3100/api/health
```

3. 회사 찾기

```bash
curl http://127.0.0.1:3100/api/companies
```

4. 회사별 에이전트 찾기

```bash
curl http://127.0.0.1:3100/api/companies/<companyId>/agents
```

5. 각 에이전트 bundle 읽기

```bash
curl "http://127.0.0.1:3100/api/agents/<agentId>/instructions-bundle/file?path=AGENTS.md"
curl "http://127.0.0.1:3100/api/agents/<agentId>/instructions-bundle/file?path=HEARTBEAT.md"
```

현재 live 확인 대상의 known id는 아래와 같다.

- `STUDIOJUN`
  - companyId: `66e10e1d-42ce-497b-bcd7-46f9e08a123a`
  - CEO: `517e1e4f-14b1-44c0-89ba-e47b60970886`
  - CMO: `19f73b22-e1a9-4388-bce2-9821bbc4ae0b`
  - CTO: `8b0dd871-1126-4e7c-a03f-98f2dcb4c103`
- `outo jun`
  - companyId: `b04ab1bf-6c97-4560-8190-169de229d1fa`
  - CEO: `60c7f2b6-d12c-44db-9c2e-db9286239a76`
  - CMO: `24a0691a-bc8f-4724-933d-1fc4ad05a06c`
  - CTO: `68d3a6d5-471a-419a-af3d-b75acf40fc35`

---

## 4. reviewer가 반드시 확인할 동작

### 4.1 공통 응답 규칙

에이전트는 board-facing 답변에서 아래 원칙을 따르도록 유도되어야 한다.

- 비기술 사용자 기준으로 쓴다.
- plain-language summary를 먼저 둔다.
- 가능하면 아래 순서를 따른다.
  1. what this means
  2. current status or decision
  3. what the board should do next, or no action needed
- internal id / workflow label / control-plane jargon은 2차 정보로 밀린다.
- 한국어 thread에서는 `쉽게 말하면`, `지금 상태`, `다음 할 일` 같은 쉬운 라벨을 우선한다.

### 4.2 기본 에이전트 지침

기본 AGENTS 지침에도 아래가 들어가야 한다.

- 사람이 읽기 쉽게 쓸 것
- 긴 formal template를 강요하지 않을 것
- `STU-51` 같은 id는 설명 뒤에 둘 것

### 4.3 CEO 전용 지침

CEO는 특히 board-facing 답변에서:

- 결정의 의미를 사람말로 먼저 설명하고
- process word보다 answer를 먼저 주고
- executive-friendly 하게 짧게 써야 한다.

### 4.4 런타임 실제 반영

지금 인스턴스에서 CEO/CMO/CTO bundle도 바뀌었어야 한다.

즉 코드만 바뀌고 live agent bundle이 그대로면 이번 작업은 체감상 미완료다.

---

## 5. 반려 기준

아래 중 하나라도 보이면 반려한다.

- `STU-51`, `approval flow`, `owner`, `gate`, `snapshot` 같은 내부 용어를 먼저 늘어놓고 사람말 설명이 뒤로 감
- 답변이 "결국 무슨 뜻인지"를 한두 문장 안에 설명하지 못함
- 다음 행동이 있는지 없는지 명확히 말하지 않음
- 기본 AGENTS 지침에는 바뀌었는데 현재 회사 CEO/CMO/CTO live bundle에는 반영되지 않음
- 테스트/타입체크 결과가 문서와 다름

---

## 6. reviewer가 반드시 볼 파일

- [server-utils.ts](/mnt/d/project/paperclipai/packages/adapter-utils/src/server-utils.ts)
- [default AGENTS.md](/mnt/d/project/paperclipai/server/src/onboarding-assets/default/AGENTS.md)
- [CEO AGENTS.md](/mnt/d/project/paperclipai/server/src/onboarding-assets/ceo/AGENTS.md)
- [CEO HEARTBEAT.md](/mnt/d/project/paperclipai/server/src/onboarding-assets/ceo/HEARTBEAT.md)
- [paperclip-skill-utils.test.ts](/mnt/d/project/paperclipai/server/src/__tests__/paperclip-skill-utils.test.ts)

런타임 확인용:

- `GET /api/agents/:id/instructions-bundle/file?path=AGENTS.md`
- `GET /api/agents/:id/instructions-bundle/file?path=HEARTBEAT.md` (CEO만)

---

## 7. 검증 방법

### 7.1 코드 검증

```bash
pnpm --filter @paperclipai/server exec vitest run src/__tests__/paperclip-skill-utils.test.ts
pnpm -r typecheck
```

### 7.2 런타임 검증

전제:

- dev 서버가 떠 있어야 한다.
- 현재 기본 인스턴스는 `local_trusted`라 이 검증에는 별도 auth header가 필요하지 않았다.

다음 둘 중 하나로 확인한다.

1. API로 현재 CEO/CMO/CTO bundle 읽기
2. 실제로 board가 CEO/CMO/CTO에게 댓글/질문을 던지고 새 답변을 확인하기

실제 답변에서 reviewer는 아래를 본다.

- 사람이 바로 이해할 수 있는 첫 문장인지
- 현재 상태와 다음 행동이 짧게 보이는지
- 내부 번호가 제목처럼 앞에 나오지 않는지

---

## 8. 이번 턴에서 실제 확인한 결과

### 8.1 코드 검증

- `pnpm --filter @paperclipai/server exec vitest run src/__tests__/paperclip-skill-utils.test.ts` 통과
  - `1 file passed`
  - `3 tests passed`
- `pnpm -r typecheck` 통과

### 8.2 런타임 검증

이번 턴에서 아래 런타임 검증도 실제로 수행했다.

- `http://127.0.0.1:3100/api/health` 정상
- `http://localhost:3100/api/health` 정상
- `STUDIOJUN` / `outo jun` 회사 조회 정상
- 두 회사의 CEO/CMO/CTO `AGENTS.md` bundle 확인
  - 사람말 우선 규칙 포함 확인
- 두 회사 CEO의 `HEARTBEAT.md` bundle 확인
  - `human meaning first` / `what this means -> current status -> next action` 취지 규칙 포함 확인

런타임 검증 결과:

- `STUDIOJUN` CEO / CMO / CTO bundle 반영 확인
- `outo jun` CEO / CMO / CTO bundle 반영 확인

### 8.3 이번 턴에서 다시 실행하지 않은 것

- `pnpm build`
- `pnpm test:run`

---

## 9. reviewer 전달용 프롬프트

```text
Paperclip 에이전트 답변을 더 쉽게 이해되게 만드는 변경을 교차검증해 주세요.

기준 문서:
- doc/plans/2026-04-09-agent-language-clarity-cross-verification.md

이번 변경의 핵심은 기능 변경이 아니라 board-facing writing 규칙 변경입니다.

꼭 봐야 할 점:
1. 에이전트가 내부 id(STU-51 등)보다 사람말 설명을 먼저 하도록 prompt/instructions가 바뀌었는지
2. 가능하면 `무슨 뜻인지 -> 지금 상태 -> 다음 할 일` 순서를 따르도록 유도하는지
3. 기본 AGENTS, CEO AGENTS, CEO HEARTBEAT, 공통 response language note가 서로 일관되는지
4. 현재 dev 인스턴스의 STUDIOJUN / outo jun CEO/CMO/CTO live instruction bundle에도 반영됐는지

반려 기준:
- 내부 용어를 먼저 늘어놓고 사람말 설명이 뒤로 감
- 다음 행동이 명확하지 않음
- 코드 지침은 바뀌었는데 live bundle 반영이 안 되어 있음

실행 검증은 최소 아래를 기준으로 확인해 주세요:
- pnpm --filter @paperclipai/server exec vitest run src/__tests__/paperclip-skill-utils.test.ts
- pnpm -r typecheck
```
