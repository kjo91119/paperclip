import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import type { Issue } from "@paperclipai/shared";
import { IssueRow } from "./IssueRow";

vi.mock("@/lib/router", () => ({
  Link: ({ children, className, ...props }: ComponentProps<"a">) => (
    <a className={className} {...props}>{children}</a>
  ),
}));

function createIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "issue-1",
    identifier: "PAP-1",
    companyId: "company-1",
    projectId: null,
    projectWorkspaceId: null,
    goalId: null,
    parentId: null,
    title: "Inbox item",
    description: null,
    status: "todo",
    priority: "medium",
    assigneeAgentId: null,
    assigneeUserId: null,
    createdByAgentId: null,
    createdByUserId: null,
    issueNumber: 1,
    requestDepth: 0,
    billingCode: null,
    assigneeAdapterOverrides: null,
    executionWorkspaceId: null,
    executionWorkspacePreference: null,
    executionWorkspaceSettings: null,
    checkoutRunId: null,
    executionRunId: null,
    executionAgentNameKey: null,
    executionLockedAt: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    hiddenAt: null,
    createdAt: new Date("2026-03-11T00:00:00.000Z"),
    updatedAt: new Date("2026-03-11T00:00:00.000Z"),
    labels: [],
    labelIds: [],
    myLastTouchAt: null,
    lastExternalCommentAt: null,
    isUnreadForMe: false,
    ...overrides,
  };
}

function renderIssueRowMarkup(props: ComponentProps<typeof IssueRow>) {
  return renderToStaticMarkup(<IssueRow {...props} />);
}

describe("IssueRow", () => {
  it("suppresses accent hover styling when the row is selected", () => {
    const html = renderIssueRowMarkup({ issue: createIssue(), selected: true });

    expect(html).toContain("data-inbox-issue-link");
    expect(html).toContain("hover:bg-transparent");
    expect(html).not.toContain("hover:bg-accent/50");
  });

  it("neutralizes selected status and unread dot accents", () => {
    const html = renderIssueRowMarkup({
      issue: createIssue(),
      selected: true,
      unreadState: "visible",
    });

    expect(html).toContain('aria-label="Mark as read"');
    expect(html).toContain("hover:bg-muted/80");
    expect(html).not.toContain("hover:bg-blue-500/20");
    expect(html).toContain("bg-muted-foreground/70");
    expect(html).not.toContain("bg-blue-600");
    expect(html).toContain("!border-muted-foreground");
    expect(html).toContain("!text-muted-foreground");
  });

  it("shows a human summary line and de-emphasized work number", () => {
    const html = renderIssueRowMarkup({
      issue: createIssue({
        title: "[CTO] 운영 인력용 최소권한 admin role 분리",
        description: `## Objective

운영 리드와 콘텐츠 운영 권한을 나누는 안을 정해주세요.

## Deliverable

        - 역할 3개로 정리`,
      }),
    });

    expect(html).toContain("운영 인력용 최소권한 admin role 분리");
    expect(html).toContain("운영 리드와 콘텐츠 운영 권한을 나누는 안을 정해주세요.");
    expect(html).toContain("작업 #1");
  });
});
