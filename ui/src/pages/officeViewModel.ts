import type { Agent, Issue } from "@paperclipai/shared";
import type { LiveRunForIssue } from "../api/heartbeats";

export type OfficeZoneId = "command" | "desks" | "review" | "approval" | "recovery" | "lounge";

export interface OfficePoint {
  x: number;
  y: number;
}

export interface OfficeAgentState {
  agent: Agent;
  issue: Issue | null;
  liveRun: LiveRunForIssue | null;
  zoneId: OfficeZoneId;
  position: OfficePoint;
  motion: "float" | "walk" | "alert";
}

export type OfficeConversationTargetReason = "current_issue" | "selected_project" | "priority_fallback";

export interface OfficeConversationTarget {
  issue: Issue | null;
  reason: OfficeConversationTargetReason | null;
}

export type OfficeReferencePathMode = "manual" | "project";

const WINDOWS_DRIVE_PATH_RE = /^([a-zA-Z]):[\\/]*(.*)$/;
const WSL_MOUNT_PATH_RE = /^\/mnt\/([a-zA-Z])(?:\/(.*))?$/;
const WSL_UNC_PATH_RE = /^\\\\wsl\$\\[^\\]+\\(.*)$/i;

export type OfficeViewGateState =
  | "needs_company_onboarding"
  | "needs_company_selection"
  | "loading"
  | "error"
  | "empty_agents"
  | "ready";

const ROLE_WEIGHT: Record<string, number> = {
  ceo: 0,
  cto: 1,
  cmo: 2,
  cfo: 3,
  pm: 4,
  engineer: 5,
  designer: 6,
  qa: 7,
  devops: 8,
  researcher: 9,
  general: 10,
};

const ISSUE_STATUS_WEIGHT: Record<string, number> = {
  in_progress: 0,
  blocked: 1,
  in_review: 2,
  todo: 3,
  backlog: 4,
  done: 5,
  cancelled: 6,
};

const COMMAND_PATHS: OfficePoint[][] = [
  [
    { x: 44, y: 24 },
    { x: 50, y: 20 },
    { x: 57, y: 24 },
    { x: 60, y: 31 },
    { x: 53, y: 35 },
    { x: 46, y: 31 },
  ],
  [
    { x: 40, y: 30 },
    { x: 45, y: 23 },
    { x: 53, y: 21 },
    { x: 58, y: 27 },
    { x: 55, y: 34 },
    { x: 46, y: 35 },
  ],
  [
    { x: 48, y: 36 },
    { x: 42, y: 30 },
    { x: 47, y: 22 },
    { x: 57, y: 22 },
    { x: 62, y: 31 },
    { x: 56, y: 37 },
  ],
];

const DESK_POINTS: OfficePoint[] = [
  { x: 24, y: 35 },
  { x: 34, y: 35 },
  { x: 72, y: 35 },
  { x: 82, y: 35 },
  { x: 24, y: 61 },
  { x: 34, y: 61 },
  { x: 72, y: 61 },
  { x: 82, y: 61 },
];

const REVIEW_POINTS: OfficePoint[] = [
  { x: 71, y: 78 },
  { x: 79, y: 78 },
  { x: 87, y: 78 },
];

const APPROVAL_POINTS: OfficePoint[] = [
  { x: 83, y: 16 },
  { x: 90, y: 22 },
  { x: 86, y: 29 },
];

const RECOVERY_POINTS: OfficePoint[] = [
  { x: 16, y: 16 },
  { x: 10, y: 24 },
  { x: 17, y: 30 },
];

const LOUNGE_POINTS: OfficePoint[] = [
  { x: 15, y: 80 },
  { x: 24, y: 83 },
  { x: 34, y: 79 },
  { x: 20, y: 69 },
];

function issueWeight(issue: Issue): number {
  return ISSUE_STATUS_WEIGHT[issue.status] ?? 99;
}

function compareIssues(a: Issue, b: Issue): number {
  const statusDiff = issueWeight(a) - issueWeight(b);
  if (statusDiff !== 0) return statusDiff;
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

function sortedAgents(agents: Agent[]): Agent[] {
  return [...agents].sort((a, b) => {
    const roleDiff = (ROLE_WEIGHT[a.role] ?? 99) - (ROLE_WEIGHT[b.role] ?? 99);
    if (roleDiff !== 0) return roleDiff;
    return a.name.localeCompare(b.name, "ko-KR");
  });
}

function visibleIssues(issues: Issue[]): Issue[] {
  return issues
    .filter((issue) => !issue.hiddenAt && issue.status !== "done" && issue.status !== "cancelled")
    .sort(compareIssues);
}

export function pickOfficeConversationTarget(params: {
  issues: Issue[];
  agentId: string;
  projectId?: string | null;
  preferredIssueId?: string | null;
}): OfficeConversationTarget {
  const assigned = visibleIssues(params.issues).filter((issue) => issue.assigneeAgentId === params.agentId);
  const preferredIssue = params.preferredIssueId ? assigned.find((issue) => issue.id === params.preferredIssueId) ?? null : null;

  if (params.projectId) {
    if (preferredIssue?.projectId === params.projectId) {
      return { issue: preferredIssue, reason: "current_issue" };
    }

    const projectIssue = assigned.find((issue) => issue.projectId === params.projectId) ?? null;
    return {
      issue: projectIssue,
      reason: projectIssue ? "selected_project" : null,
    };
  }

  if (preferredIssue) {
    return { issue: preferredIssue, reason: "current_issue" };
  }

  return {
    issue: assigned[0] ?? null,
    reason: assigned[0] ? "priority_fallback" : null,
  };
}

export function pickOfficeConversationIssue(params: {
  issues: Issue[];
  agentId: string;
  projectId?: string | null;
  preferredIssueId?: string | null;
}): Issue | null {
  return pickOfficeConversationTarget(params).issue;
}

function normalizeSlashPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/+/g, "/");
}

export function normalizeOfficeReferencePathValue(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "";

  const uncMatch = trimmed.match(WSL_UNC_PATH_RE);
  if (uncMatch) {
    const uncBody = normalizeSlashPath(uncMatch[1] ?? "");
    return uncBody.startsWith("/") ? uncBody : `/${uncBody}`;
  }

  const windowsMatch = trimmed.match(WINDOWS_DRIVE_PATH_RE);
  if (windowsMatch) {
    const drive = windowsMatch[1]!.toLowerCase();
    const remainder = normalizeSlashPath(windowsMatch[2] ?? "").replace(/^\/+/, "");
    return remainder ? `/mnt/${drive}/${remainder}` : `/mnt/${drive}`;
  }

  if (trimmed.startsWith("/mnt/")) {
    return normalizeSlashPath(trimmed);
  }

  return trimmed;
}

export function convertOfficeReferencePathToWindows(path: string): string | null {
  const normalized = normalizeOfficeReferencePathValue(path);
  const match = normalized.match(WSL_MOUNT_PATH_RE);
  if (!match) return null;
  const drive = match[1]!.toUpperCase();
  const remainder = (match[2] ?? "").replaceAll("/", "\\");
  return remainder ? `${drive}:\\${remainder}` : `${drive}:\\`;
}

export function syncOfficeReferencePath(params: {
  referencePath: string;
  mode: OfficeReferencePathMode;
  selectedProjectPath?: string | null;
}): string {
  if (params.mode !== "project") {
    return normalizeOfficeReferencePathValue(params.referencePath);
  }
  return normalizeOfficeReferencePathValue(params.selectedProjectPath?.trim() ?? "");
}

export function hasOfficeReferencePathMismatch(params: {
  selectedProjectId?: string | null;
  selectedProjectPath?: string | null;
  referencePath: string;
  mode: OfficeReferencePathMode;
}): boolean {
  const selectedProjectPath = normalizeOfficeReferencePathValue(params.selectedProjectPath?.trim() ?? "");
  const referencePath = normalizeOfficeReferencePathValue(params.referencePath);
  if (!params.selectedProjectId || !selectedProjectPath || !referencePath) return false;
  if (params.mode === "project") return false;
  return referencePath !== selectedProjectPath;
}

function pickSlot(points: OfficePoint[], slotIndex: number): OfficePoint {
  const point = points[slotIndex % points.length] ?? points[0] ?? { x: 50, y: 50 };
  const cycle = Math.floor(slotIndex / points.length);
  const xOffset = cycle === 0 ? 0 : cycle * 2;
  const yOffset = cycle === 0 ? 0 : cycle * 1.4;
  return { x: point.x + xOffset, y: point.y + yOffset };
}

function withDrift(point: OfficePoint, seed: number, nowMs: number, amplitude: number): OfficePoint {
  const driftX = Math.sin(nowMs / 750 + seed * 0.9) * amplitude;
  const driftY = Math.cos(nowMs / 930 + seed * 1.3) * (amplitude * 0.7);
  return {
    x: Number((point.x + driftX).toFixed(2)),
    y: Number((point.y + driftY).toFixed(2)),
  };
}

function positionForZone(zoneId: OfficeZoneId, zoneIndex: number, globalIndex: number, nowMs: number): OfficePoint {
  if (zoneId === "command") {
    const path = COMMAND_PATHS[zoneIndex % COMMAND_PATHS.length] ?? COMMAND_PATHS[0]!;
    const step = Math.floor(nowMs / 820 + zoneIndex * 1.3) % path.length;
    return withDrift(path[step]!, globalIndex, nowMs, 0.9);
  }

  const point =
    zoneId === "desks" ? pickSlot(DESK_POINTS, zoneIndex)
      : zoneId === "review" ? pickSlot(REVIEW_POINTS, zoneIndex)
      : zoneId === "approval" ? pickSlot(APPROVAL_POINTS, zoneIndex)
      : zoneId === "recovery" ? pickSlot(RECOVERY_POINTS, zoneIndex)
      : pickSlot(LOUNGE_POINTS, zoneIndex);

  const amplitude = zoneId === "approval" || zoneId === "recovery" ? 0.45 : 0.8;
  return withDrift(point, globalIndex, nowMs, amplitude);
}

function zoneForAgent(agent: Agent, issue: Issue | null, liveRun: LiveRunForIssue | null): OfficeZoneId {
  if (agent.status === "pending_approval") return "approval";
  if (agent.status === "paused" || agent.status === "error" || agent.status === "terminated") return "recovery";
  if (liveRun || agent.status === "running") return "command";
  if (issue?.status === "in_review") return "review";
  if (issue || agent.status === "active") return "desks";
  return "lounge";
}

function motionForZone(zoneId: OfficeZoneId): OfficeAgentState["motion"] {
  if (zoneId === "command") return "walk";
  if (zoneId === "approval" || zoneId === "recovery") return "alert";
  return "float";
}

export function deriveOfficeAgentStates({
  agents,
  issues,
  liveRuns,
  nowMs,
}: {
  agents: Agent[];
  issues: Issue[];
  liveRuns: LiveRunForIssue[];
  nowMs?: number;
}): OfficeAgentState[] {
  const effectiveNow = nowMs ?? Date.now();
  const issueById = new Map(issues.map((issue) => [issue.id, issue] as const));
  const runByAgentId = new Map(liveRuns.map((run) => [run.agentId, run] as const));
  const assignedIssues = new Map<string, Issue[]>();

  for (const issue of visibleIssues(issues)) {
    if (!issue.assigneeAgentId) continue;
    const list = assignedIssues.get(issue.assigneeAgentId) ?? [];
    list.push(issue);
    assignedIssues.set(issue.assigneeAgentId, list);
  }

  const zoneCounts: Record<OfficeZoneId, number> = {
    command: 0,
    desks: 0,
    review: 0,
    approval: 0,
    recovery: 0,
    lounge: 0,
  };

  return sortedAgents(agents).map((agent, globalIndex) => {
    const liveRun = runByAgentId.get(agent.id) ?? null;
    const assigned = [...(assignedIssues.get(agent.id) ?? [])].sort(compareIssues);
    const issueFromRun = liveRun?.issueId ? issueById.get(liveRun.issueId) ?? null : null;
    const issue = issueFromRun ?? assigned[0] ?? null;
    const zoneId = zoneForAgent(agent, issue, liveRun);
    const zoneIndex = zoneCounts[zoneId]++;

    return {
      agent,
      issue,
      liveRun,
      zoneId,
      position: positionForZone(zoneId, zoneIndex, globalIndex, effectiveNow),
      motion: motionForZone(zoneId),
    };
  });
}

export function resolveOfficeViewGateState(params: {
  selectedCompanyId: string | null;
  companyCount: number;
  isLoading: boolean;
  hasBlockingError: boolean;
  agentsCount: number;
}): OfficeViewGateState {
  if (!params.selectedCompanyId) {
    return params.companyCount === 0 ? "needs_company_onboarding" : "needs_company_selection";
  }

  if (params.isLoading) return "loading";
  if (params.hasBlockingError) return "error";
  if (params.agentsCount === 0) return "empty_agents";
  return "ready";
}
