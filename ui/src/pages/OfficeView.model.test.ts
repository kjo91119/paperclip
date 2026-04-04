import type { Agent, Issue } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import type { LiveRunForIssue } from "../api/heartbeats";
import { deriveOfficeAgentStates, resolveOfficeViewGateState } from "./officeViewModel";

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
