import type { Agent, Issue } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import type { LiveRunForIssue } from "../api/heartbeats";
import {
  createOfficeConversationPath,
  convertOfficeReferencePathToWindows,
  deriveOfficeAgentStates,
  hasOfficeReferencePathMismatch,
  extractOfficeMeetingParticipantIds,
  getOfficeConversationPreview,
  isOfficeMeetingIssue,
  listOfficeConversationIssues,
  listOfficeMeetingIssues,
  normalizeOfficeReferencePathValue,
  pickOfficeConversationTarget,
  resolveOfficeViewGateState,
  syncOfficeReferencePath,
} from "./officeViewModel";

function createAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-1",
    companyId: "company-1",
    name: "CEO",
    urlKey: "ceo",
    role: "ceo",
    title: null,
    icon: null,
    status: "active",
    reportsTo: null,
    capabilities: null,
    adapterType: "codex_local",
    adapterConfig: {},
    runtimeConfig: {},
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    pauseReason: null,
    pausedAt: null,
    permissions: { canCreateAgents: true },
    lastHeartbeatAt: null,
    metadata: null,
    createdAt: new Date("2026-04-03T00:00:00.000Z"),
    updatedAt: new Date("2026-04-03T00:00:00.000Z"),
    ...overrides,
  };
}

function createIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "issue-1",
    companyId: "company-1",
    projectId: null,
    projectWorkspaceId: null,
    goalId: null,
    parentId: null,
    title: "Issue",
    description: null,
    status: "todo",
    priority: "medium",
    assigneeAgentId: null,
    assigneeUserId: null,
    checkoutRunId: null,
    executionRunId: null,
    executionAgentNameKey: null,
    executionLockedAt: null,
    createdByAgentId: null,
    createdByUserId: null,
    issueNumber: 1,
    identifier: "STU-1",
    requestDepth: 0,
    billingCode: null,
    assigneeAdapterOverrides: null,
    executionWorkspaceId: null,
    executionWorkspacePreference: null,
    executionWorkspaceSettings: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    hiddenAt: null,
    createdAt: new Date("2026-04-03T00:00:00.000Z"),
    updatedAt: new Date("2026-04-03T00:00:00.000Z"),
    ...overrides,
  };
}

function createLiveRun(overrides: Partial<LiveRunForIssue> = {}): LiveRunForIssue {
  return {
    id: "run-1",
    status: "running",
    invocationSource: "assignment",
    triggerDetail: null,
    startedAt: "2026-04-03T00:00:00.000Z",
    finishedAt: null,
    createdAt: "2026-04-03T00:00:00.000Z",
    agentId: "agent-1",
    agentName: "CEO",
    adapterType: "codex_local",
    issueId: "issue-1",
    ...overrides,
  };
}

describe("deriveOfficeAgentStates", () => {
  it("sends running agents with live issues to the command zone", () => {
    const states = deriveOfficeAgentStates({
      agents: [createAgent({ status: "running" })],
      issues: [createIssue({ assigneeAgentId: "agent-1", status: "in_progress" })],
      liveRuns: [createLiveRun()],
      nowMs: 1_710_000_000_000,
    });

    expect(states).toHaveLength(1);
    expect(states[0]?.zoneId).toBe("command");
    expect(states[0]?.issue?.id).toBe("issue-1");
    expect(states[0]?.motion).toBe("walk");
  });

  it("maps pending approval and paused agents to their waiting zones", () => {
    const states = deriveOfficeAgentStates({
      agents: [
        createAgent({ id: "agent-approval", name: "CMO", role: "cmo", status: "pending_approval" }),
        createAgent({ id: "agent-paused", name: "CTO", role: "cto", status: "paused" }),
      ],
      issues: [],
      liveRuns: [],
      nowMs: 1_710_000_000_000,
    });

    const approval = states.find((state) => state.agent.id === "agent-approval");
    const paused = states.find((state) => state.agent.id === "agent-paused");

    expect(approval?.zoneId).toBe("approval");
    expect(paused?.zoneId).toBe("recovery");
  });

  it("places review issues in the review zone when nothing is running", () => {
    const states = deriveOfficeAgentStates({
      agents: [createAgent({ id: "agent-review", name: "Designer", role: "designer" })],
      issues: [createIssue({ id: "issue-review", assigneeAgentId: "agent-review", status: "in_review" })],
      liveRuns: [],
      nowMs: 1_710_000_000_000,
    });

    expect(states[0]?.zoneId).toBe("review");
    expect(states[0]?.position.x).toBeGreaterThan(60);
    expect(states[0]?.position.y).toBeGreaterThan(70);
  });
});

describe("resolveOfficeViewGateState", () => {
  it("treats missing selected company as onboarding or selection", () => {
    expect(
      resolveOfficeViewGateState({
        selectedCompanyId: null,
        companyCount: 0,
        isLoading: false,
        hasBlockingError: false,
        agentsCount: 0,
      }),
    ).toBe("needs_company_onboarding");

    expect(
      resolveOfficeViewGateState({
        selectedCompanyId: null,
        companyCount: 1,
        isLoading: false,
        hasBlockingError: false,
        agentsCount: 0,
      }),
    ).toBe("needs_company_selection");
  });

  it("shows errors before the empty-agent state", () => {
    expect(
      resolveOfficeViewGateState({
        selectedCompanyId: "company-1",
        companyCount: 1,
        isLoading: false,
        hasBlockingError: true,
        agentsCount: 0,
      }),
    ).toBe("error");
  });

  it("shows empty-agent state only when loading and blocking errors are absent", () => {
    expect(
      resolveOfficeViewGateState({
        selectedCompanyId: "company-1",
        companyCount: 1,
        isLoading: false,
        hasBlockingError: false,
        agentsCount: 0,
      }),
    ).toBe("empty_agents");
  });
});

describe("pickOfficeConversationTarget", () => {
  it("prefers the selected project's visible issue when the current issue belongs to another project", () => {
    const target = pickOfficeConversationTarget({
      agentId: "agent-1",
      projectId: "project-b",
      preferredIssueId: "issue-a",
      issues: [
        createIssue({
          id: "issue-a",
          projectId: "project-a",
          assigneeAgentId: "agent-1",
          status: "in_progress",
        }),
        createIssue({
          id: "issue-b",
          projectId: "project-b",
          assigneeAgentId: "agent-1",
          status: "todo",
        }),
      ],
    });

    expect(target.issue?.id).toBe("issue-b");
    expect(target.reason).toBe("selected_project");
  });

  it("keeps the current issue when it already matches the selected project", () => {
    const target = pickOfficeConversationTarget({
      agentId: "agent-1",
      projectId: "project-b",
      preferredIssueId: "issue-b",
      issues: [
        createIssue({
          id: "issue-todo",
          assigneeAgentId: "agent-1",
          status: "todo",
        }),
        createIssue({
          id: "issue-b",
          assigneeAgentId: "agent-1",
          projectId: "project-b",
          status: "todo",
          updatedAt: new Date("2026-04-03T00:01:00.000Z"),
        }),
      ],
    });

    expect(target.issue?.id).toBe("issue-b");
    expect(target.reason).toBe("current_issue");
  });

  it("prefers the current live issue when no project is selected", () => {
    const target = pickOfficeConversationTarget({
      agentId: "agent-1",
      preferredIssueId: "issue-live",
      issues: [
        createIssue({
          id: "issue-priority",
          assigneeAgentId: "agent-1",
          status: "in_progress",
        }),
        createIssue({
          id: "issue-live",
          assigneeAgentId: "agent-1",
          status: "todo",
        }),
      ],
    });

    expect(target.issue?.id).toBe("issue-live");
    expect(target.reason).toBe("current_issue");
  });

  it("falls back to the highest-priority visible assigned issue when no project is selected", () => {
    const target = pickOfficeConversationTarget({
      agentId: "agent-1",
      issues: [
        createIssue({
          id: "issue-todo",
          assigneeAgentId: "agent-1",
          status: "todo",
        }),
        createIssue({
          id: "issue-progress",
          assigneeAgentId: "agent-1",
          status: "in_progress",
        }),
      ],
    });

    expect(target.issue?.id).toBe("issue-progress");
    expect(target.reason).toBe("priority_fallback");
  });

  it("ignores hidden and completed issues", () => {
    const target = pickOfficeConversationTarget({
      agentId: "agent-1",
      issues: [
        createIssue({
          id: "issue-hidden",
          assigneeAgentId: "agent-1",
          status: "in_progress",
          hiddenAt: new Date("2026-04-03T01:00:00.000Z"),
        }),
        createIssue({
          id: "issue-done",
          assigneeAgentId: "agent-1",
          status: "done",
        }),
        createIssue({
          id: "issue-open",
          assigneeAgentId: "agent-1",
          status: "blocked",
        }),
      ],
    });

    expect(target.issue?.id).toBe("issue-open");
    expect(target.reason).toBe("priority_fallback");
  });
});

describe("office conversation lists", () => {
  it("lists visible issues assigned to the selected agent in activity order", () => {
    const issues = listOfficeConversationIssues({
      agentId: "agent-1",
      issues: [
        createIssue({
          id: "issue-done",
          assigneeAgentId: "agent-1",
          status: "done",
        }),
        createIssue({
          id: "issue-two",
          assigneeAgentId: "agent-1",
          status: "todo",
          updatedAt: new Date("2026-04-03T00:03:00.000Z"),
        }),
        createIssue({
          id: "issue-one",
          assigneeAgentId: "agent-1",
          status: "in_progress",
          updatedAt: new Date("2026-04-03T00:01:00.000Z"),
        }),
        createIssue({
          id: "issue-other-agent",
          assigneeAgentId: "agent-2",
          status: "in_progress",
        }),
      ],
    });

    expect(issues.map((issue) => issue.id)).toEqual(["issue-one", "issue-two"]);
  });

  it("recognizes and lists meeting issues by the embedded meeting format marker", () => {
    const issues = listOfficeMeetingIssues([
      createIssue({
        id: "issue-direct",
        description: "일반 협업 요청",
        updatedAt: new Date("2026-04-03T00:01:00.000Z"),
      }),
      createIssue({
        id: "issue-meeting",
        description: "회의 컨텍스트\n- 회의 형식: 전체회의\n- 진행자: CEO",
        updatedAt: new Date("2026-04-03T00:02:00.000Z"),
      }),
    ]);

    expect(isOfficeMeetingIssue(issues[0]!)).toBe(true);
    expect(issues.map((issue) => issue.id)).toEqual(["issue-meeting"]);
  });

  it("extracts meeting participant ids without duplicating the facilitator", () => {
    const issue = createIssue({
      assigneeAgentId: "agent-ceo",
      description:
        "회의 컨텍스트\n- 회의 형식: 전체회의\n- 진행자: [@CEO](agent://agent-ceo)\n- 참가자: [@CEO](agent://agent-ceo) [@CTO](agent://agent-cto) [@CMO](agent://agent-cmo)",
    });

    expect(extractOfficeMeetingParticipantIds(issue)).toEqual(["agent-cto", "agent-cmo"]);
  });

  it("builds a stable office conversation path with query params", () => {
    expect(
      createOfficeConversationPath({
        mode: "direct",
        agentId: "agent-1",
        issueId: "issue-1",
        projectId: "project-1",
      }),
    ).toBe("/office?mode=direct&agent=agent-1&issue=issue-1&project=project-1");
  });

  it("falls back to the issue title when there is no description preview", () => {
    expect(
      getOfficeConversationPreview(
        createIssue({
          title: "Preview title",
          description: null,
        }),
      ),
    ).toBe("Preview title");
  });
});

describe("syncOfficeReferencePath", () => {
  it("updates project-managed paths when the selected project changes", () => {
    expect(
      syncOfficeReferencePath({
        referencePath: "/repo-a",
        mode: "project",
        selectedProjectPath: "/repo-b",
      }),
    ).toBe("/repo-b");
  });

  it("clears a project-managed path when no project path is available", () => {
    expect(
      syncOfficeReferencePath({
        referencePath: "/repo-a",
        mode: "project",
        selectedProjectPath: "",
      }),
    ).toBe("");
  });

  it("preserves manually entered paths across project changes", () => {
    expect(
      syncOfficeReferencePath({
        referencePath: "C:\\Users\\frog5\\Desktop\\custom-notes",
        mode: "manual",
        selectedProjectPath: "/repo-b",
      }),
    ).toBe("/mnt/c/Users/frog5/Desktop/custom-notes");
  });
});

describe("hasOfficeReferencePathMismatch", () => {
  it("warns when a manual path differs from the selected project's path", () => {
    expect(
      hasOfficeReferencePathMismatch({
        selectedProjectId: "project-b",
        selectedProjectPath: "/repo-b",
        referencePath: "C:\\Users\\frog5\\Desktop\\repo-a",
        mode: "manual",
      }),
    ).toBe(true);
  });

  it("does not warn for project-managed paths", () => {
    expect(
      hasOfficeReferencePathMismatch({
        selectedProjectId: "project-b",
        selectedProjectPath: "/repo-b",
        referencePath: "/repo-b",
        mode: "project",
      }),
    ).toBe(false);
  });

  it("does not warn when a Windows path points to the same project folder", () => {
    expect(
      hasOfficeReferencePathMismatch({
        selectedProjectId: "project-b",
        selectedProjectPath: "/mnt/c/Users/frog5/Desktop/sites/jangsatok",
        referencePath: "C:\\Users\\frog5\\Desktop\\sites\\jangsatok",
        mode: "manual",
      }),
    ).toBe(false);
  });
});

describe("reference path normalization", () => {
  it("converts Windows drive paths into WSL mount paths", () => {
    expect(
      normalizeOfficeReferencePathValue("C:\\Users\\frog5\\Desktop\\사이트만들기\\클로드1\\projects\\02-jangsatok"),
    ).toBe("/mnt/c/Users/frog5/Desktop/사이트만들기/클로드1/projects/02-jangsatok");
  });

  it("converts WSL mount paths back into Windows paths when possible", () => {
    expect(
      convertOfficeReferencePathToWindows("/mnt/c/Users/frog5/Desktop/sites/jangsatok"),
    ).toBe("C:\\Users\\frog5\\Desktop\\sites\\jangsatok");
  });

  it("leaves non-mounted Linux paths without a Windows conversion", () => {
    expect(convertOfficeReferencePathToWindows("/home/junoh/projects/jangsatok")).toBeNull();
  });
});
