import { describe, expect, it } from "vitest";

import { buildCommentBrief, buildIssueBrief } from "./issue-brief";

describe("buildIssueBrief", () => {
  it("pulls out structured sections into a simpler summary model", () => {
    const brief = buildIssueBrief({
      title: "[CTO] 운영 인력용 최소권한 admin role 분리",
      description: `## Objective

현재 admin 접근이 너무 넓습니다. 운영 리드와 콘텐츠 운영 권한을 나누는 안을 정해주세요.

## Context

- 상위 이슈: STU-51
- 현재 위험: 관리자 메뉴가 너무 넓게 열려 있음

## Deliverable

1. 역할 3개로 정리
2. 누가 어떤 메뉴를 쓰는지 정리

## Constraints

- 이번 주 운영을 막지 말 것
- 기존 admin 사용자는 바로 끄지 말 것`,
    });

    expect(brief.badge).toBe("CTO");
    expect(brief.cleanTitle).toBe("운영 인력용 최소권한 admin role 분리");
    expect(brief.summary).toContain("운영 리드와 콘텐츠 운영 권한");
    expect(brief.decisionItems).toEqual(["역할 3개로 정리", "누가 어떤 메뉴를 쓰는지 정리"]);
    expect(brief.backgroundItems[0]).toContain("상위 이슈");
    expect(brief.constraintItems[0]).toContain("이번 주 운영을 막지 말 것");
    expect(brief.hasStructuredSections).toBe(true);
  });

  it("falls back to the first paragraph when no structured headings exist", () => {
    const brief = buildIssueBrief({
      title: "장사톡 채널 운영 정리",
      description: "장사톡 운영 방향을 다시 좁혀야 합니다.\n\n지금은 사람에게 더 읽기 쉬운 구조가 필요합니다.",
    });

    expect(brief.badge).toBeNull();
    expect(brief.cleanTitle).toBe("장사톡 채널 운영 정리");
    expect(brief.summary).toBe("장사톡 운영 방향을 다시 좁혀야 합니다.");
    expect(brief.hasStructuredSections).toBe(false);
  });

  it("builds a short comment summary with status and next actions", () => {
    const brief = buildCommentBrief(`쉽게 말하면: 지금은 바로 채용이 아니라 채용 시작 승인 상태입니다.

지금 상태: 2명 first ask는 시작됐고, 아직 입사 확정은 아닙니다.
다음 할 일: 인터뷰와 오퍼 진행 상황을 다시 보고하세요.
추가 메모: 3번째 인원은 아직 포함되지 않습니다.`);

    expect(brief.summary).toContain("채용 시작 승인");
    expect(brief.statusItems[0]).toContain("2명 first ask");
    expect(brief.actionItems[0]).toContain("인터뷰와 오퍼");
    expect(brief.noteItems[0]).toContain("3번째 인원");
    expect(brief.showSummaryCard).toBe(true);
  });
});
