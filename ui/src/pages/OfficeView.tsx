import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "@/lib/router";
import type { Agent, Project } from "@paperclipai/shared";
import {
  Bot,
  CircleDot,
  DollarSign,
  MessageSquare,
  PanelsTopLeft,
  ShieldCheck,
} from "lucide-react";
import { activityApi } from "../api/activity";
import { agentsApi } from "../api/agents";
import { dashboardApi } from "../api/dashboard";
import { heartbeatsApi } from "../api/heartbeats";
import { issuesApi } from "../api/issues";
import { meetingsApi } from "../api/meetings";
import { projectsApi } from "../api/projects";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { Button } from "../components/ui/button";
import {
  OfficeConversationPanel,
  type OfficeSendSummaryRow,
  type OfficeTemplateAction,
} from "../components/office/OfficeConversationPanel";
import { OfficeScene } from "../components/office/OfficeScene";
import { OfficeSidebar } from "../components/office/OfficeSidebar";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { useDialog } from "../context/DialogContext";
import { useToast } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { cn, formatCents, issueUrl } from "../lib/utils";
import {
  convertOfficeReferencePathToWindows,
  createOfficeConversationPath,
  deriveOfficeAgentStates,
  hasOfficeReferencePathMismatch,
  listOfficeConversationIssues,
  listOfficeMeetingIssues,
  normalizeOfficeReferencePathValue,
  pickOfficeConversationTarget,
  resolveOfficeViewGateState,
  syncOfficeReferencePath,
  type OfficeConversationMode,
  type OfficeConversationTargetReason,
  type OfficeReferencePathMode,
} from "./officeViewModel";

const OFFICE_DRAFT_STORAGE_PREFIX = "paperclip:office-composer";

const OFFICE_MARKETING_TEMPLATES = [
  {
    label: "홍보 전략",
    build(projectName: string | null) {
      return {
        title: `${projectName ?? "프로젝트"} 홍보 전략 초안`,
        body:
          `${projectName ?? "이 프로젝트"}를 빠르게 검토하고 현실적인 홍보 전략 3가지를 제안해주세요.\n` +
          "- 핵심 고객 세그먼트\n" +
          "- 가장 먼저 써볼 채널\n" +
          "- 7일 안에 가능한 실험\n" +
          "- 지금 부족한 자료",
      };
    },
  },
  {
    label: "콘텐츠 아이디어",
    build(projectName: string | null) {
      return {
        title: `${projectName ?? "프로젝트"} 콘텐츠 아이디어`,
        body:
          `${projectName ?? "이 프로젝트"} 홍보를 위해 바로 만들 수 있는 콘텐츠 아이디어 10개를 제안해주세요.\n` +
          "- 숏폼/블로그/상세페이지/카카오톡 메시지로 나눠서\n" +
          "- 클릭을 유도할 한 줄 후크 포함\n" +
          "- 실제 제작 난이도도 함께 표시",
      };
    },
  },
  {
    label: "첫 실험안",
    build(projectName: string | null) {
      return {
        title: `${projectName ?? "프로젝트"} 첫 검증 실험안`,
        body:
          `${projectName ?? "이 프로젝트"}의 첫 홍보 검증 실험 3개를 설계해주세요.\n` +
          "- 실험 목적\n" +
          "- 준비물\n" +
          "- 측정 지표\n" +
          "- 실패했을 때 다음 대안",
      };
    },
  },
  {
    label: "경쟁사 비교",
    build(projectName: string | null) {
      return {
        title: `${projectName ?? "프로젝트"} 경쟁사 비교`,
        body:
          `${projectName ?? "이 프로젝트"}와 비슷한 서비스 관점에서 경쟁사/대체재를 가정하고,\n` +
          "- 차별점\n" +
          "- 약점\n" +
          "- 포지셔닝 문구\n" +
          "- 피해야 할 메시지\n" +
          "를 정리해주세요.",
      };
    },
  },
] as const;

function officeDraftStorageKey(companyId: string | null) {
  return companyId ? `${OFFICE_DRAFT_STORAGE_PREFIX}:${companyId}` : null;
}

function defaultOfficeIssueTitle(
  agentName: string | null,
  projectName: string | null,
  mode: OfficeConversationMode,
) {
  if (mode === "meeting") {
    if (projectName) return `${projectName} 전체회의 요청`;
    return "오피스 전체회의 요청";
  }
  if (projectName && agentName) return `${projectName} 관련 ${agentName} 협업 요청`;
  if (projectName) return `${projectName} 협업 요청`;
  if (agentName) return `${agentName} 협업 요청`;
  return "오피스 협업 요청";
}

function buildOfficeContextLines(input: {
  referencePath: string;
  project: Project | null;
}) {
  const project = input.project;
  const contextLines: string[] = [];

  if (project) {
    contextLines.push(`- 프로젝트: ${project.name}`);
  }

  const preferredPath =
    input.referencePath.trim() ||
    project?.codebase.localFolder ||
    project?.codebase.effectiveLocalFolder ||
    "";
  if (preferredPath) {
    contextLines.push(`- 로컬 경로: \`${preferredPath}\``);
  }

  if (project?.codebase.repoUrl) {
    contextLines.push(`- 저장소: ${project.codebase.repoUrl}`);
  }

  return contextLines;
}

function buildOfficeMessageBody(input: {
  body: string;
  referencePath: string;
  project: Project | null;
}) {
  const main = input.body.trim();
  const contextLines = buildOfficeContextLines(input);
  if (contextLines.length === 0) return main;
  return `${main}\n\n컨텍스트\n${contextLines.join("\n")}`;
}

function formatConversationTargetReason(reason: OfficeConversationTargetReason | null, hasLiveRun: boolean) {
  if (reason === "current_issue") {
    return hasLiveRun ? "선택 근거: 실시간 실행 중인 현재 작업" : "선택 근거: 선택한 에이전트의 현재 작업";
  }
  if (reason === "selected_project") {
    return "선택 근거: 선택한 프로젝트 기준으로 열린 이슈";
  }
  if (reason === "priority_fallback") {
    return "선택 근거: 현재 작업이 없어 열린 이슈 우선순위 기준";
  }
  return null;
}

function parseOfficeSearch(search: string) {
  const params = new URLSearchParams(search);
  return {
    mode: params.get("mode"),
    agentId: params.get("agent"),
    issueId: params.get("issue"),
    projectId: params.get("project"),
  };
}

function invalidateOfficeLists(queryClient: ReturnType<typeof useQueryClient>, companyId: string) {
  queryClient.invalidateQueries({ queryKey: queryKeys.issues.list(companyId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(companyId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.activity(companyId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.liveRuns(companyId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.issues.listMineByMe(companyId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.issues.listTouchedByMe(companyId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.issues.listUnreadTouchedByMe(companyId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.sidebarBadges(companyId) });
}

export function OfficeView() {
  const { selectedCompanyId, selectedCompany, companies } = useCompany();
  const { openOnboarding, openNewProject } = useDialog();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const messageBodyRef = useRef<HTMLTextAreaElement | null>(null);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const lastMarkedReadIssueIdRef = useRef<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [sceneCollapsed, setSceneCollapsed] = useState(false);
  const [composerMode, setComposerMode] = useState<OfficeConversationMode>("direct");
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [selectedThreadIssueId, setSelectedThreadIssueId] = useState("");
  const [meetingParticipantIds, setMeetingParticipantIds] = useState<string[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [messageTitle, setMessageTitle] = useState("");
  const [messageBody, setMessageBody] = useState("");
  const [referencePath, setReferencePath] = useState("");
  const [referencePathMode, setReferencePathMode] = useState<OfficeReferencePathMode>("manual");
  const [composerOptionsOpen, setComposerOptionsOpen] = useState(false);
  const [lastTouchedIssueId, setLastTouchedIssueId] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "오피스" }]);
  }, [setBreadcrumbs]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 850);
    return () => window.clearInterval(timer);
  }, []);

  const agentsQuery = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 20_000,
    refetchIntervalInBackground: true,
  });

  const issuesQuery = useQuery({
    queryKey: queryKeys.issues.list(selectedCompanyId!),
    queryFn: () => issuesApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 12_000,
    refetchIntervalInBackground: true,
  });

  const dashboardQuery = useQuery({
    queryKey: queryKeys.dashboard(selectedCompanyId!),
    queryFn: () => dashboardApi.summary(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 12_000,
    refetchIntervalInBackground: true,
  });

  const liveRunsQuery = useQuery({
    queryKey: queryKeys.liveRuns(selectedCompanyId!),
    queryFn: () => heartbeatsApi.liveRunsForCompany(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 4_000,
    refetchIntervalInBackground: true,
  });

  const activityQuery = useQuery({
    queryKey: queryKeys.activity(selectedCompanyId!),
    queryFn: () => activityApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
  });

  const projectsQuery = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId!),
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 20_000,
    refetchIntervalInBackground: true,
  });

  const agents = agentsQuery.data ?? [];
  const issues = issuesQuery.data ?? [];
  const dashboard = dashboardQuery.data;
  const liveRuns = liveRunsQuery.data ?? [];
  const activity = activityQuery.data ?? [];
  const projects = useMemo(
    () =>
      [...(projectsQuery.data ?? [])]
        .filter((project) => !project.archivedAt)
        .sort((a, b) => a.name.localeCompare(b.name, "ko-KR")),
    [projectsQuery.data],
  );

  const officeSearch = useMemo(() => parseOfficeSearch(location.search), [location.search]);
  const draftStorageKey = officeDraftStorageKey(selectedCompanyId);

  useEffect(() => {
    if (!draftStorageKey) return;
    try {
      const raw = localStorage.getItem(draftStorageKey);
      if (!raw) {
        setComposerMode("direct");
        setSelectedAgentId("");
        setSelectedThreadIssueId("");
        setMeetingParticipantIds([]);
        setSelectedProjectId("");
        setMessageTitle("");
        setMessageBody("");
        setReferencePath("");
        setReferencePathMode("manual");
        return;
      }
      const parsed = JSON.parse(raw) as {
        composerMode?: OfficeConversationMode;
        selectedAgentId?: string;
        selectedThreadIssueId?: string;
        meetingParticipantIds?: string[];
        selectedProjectId?: string;
        messageTitle?: string;
        messageBody?: string;
        referencePath?: string;
        referencePathMode?: OfficeReferencePathMode;
        composerOptionsOpen?: boolean;
        sceneCollapsed?: boolean;
      };
      setComposerMode(parsed.composerMode === "meeting" ? "meeting" : "direct");
      setSelectedAgentId(parsed.selectedAgentId ?? "");
      setSelectedThreadIssueId(parsed.selectedThreadIssueId ?? "");
      setMeetingParticipantIds(
        Array.isArray(parsed.meetingParticipantIds)
          ? parsed.meetingParticipantIds.filter((value): value is string => typeof value === "string")
          : [],
      );
      setSelectedProjectId(parsed.selectedProjectId ?? "");
      setMessageTitle(parsed.messageTitle ?? "");
      setMessageBody(parsed.messageBody ?? "");
      setReferencePath(parsed.referencePath ?? "");
      setReferencePathMode(parsed.referencePathMode === "project" ? "project" : "manual");
      setComposerOptionsOpen(Boolean(parsed.composerOptionsOpen));
      setSceneCollapsed(Boolean(parsed.sceneCollapsed));
    } catch {
      setComposerMode("direct");
      setSelectedAgentId("");
      setSelectedThreadIssueId("");
      setMeetingParticipantIds([]);
      setSelectedProjectId("");
      setMessageTitle("");
      setMessageBody("");
      setReferencePath("");
      setReferencePathMode("manual");
    }
  }, [draftStorageKey]);

  useEffect(() => {
    if (!draftStorageKey) return;
    try {
      localStorage.setItem(
        draftStorageKey,
        JSON.stringify({
          composerMode,
          selectedAgentId,
          selectedThreadIssueId,
          meetingParticipantIds,
          selectedProjectId,
          messageTitle,
          messageBody,
          referencePath,
          referencePathMode,
          composerOptionsOpen,
          sceneCollapsed,
        }),
      );
    } catch {
      // Ignore localStorage failures.
    }
  }, [
    composerMode,
    draftStorageKey,
    selectedAgentId,
    selectedThreadIssueId,
    meetingParticipantIds,
    selectedProjectId,
    messageTitle,
    messageBody,
    referencePath,
    referencePathMode,
    composerOptionsOpen,
    sceneCollapsed,
  ]);

  const gateState = resolveOfficeViewGateState({
    selectedCompanyId,
    companyCount: companies.length,
    isLoading:
      agentsQuery.isLoading ||
      issuesQuery.isLoading ||
      dashboardQuery.isLoading ||
      liveRunsQuery.isLoading,
    hasBlockingError: Boolean(agentsQuery.error) && agentsQuery.data === undefined,
    agentsCount: agents.length,
  });

  const agentStates = useMemo(
    () => deriveOfficeAgentStates({ agents, issues, liveRuns, nowMs }),
    [agents, issues, liveRuns, nowMs],
  );

  useEffect(() => {
    if (officeSearch.mode === "meeting" || officeSearch.mode === "direct") {
      setComposerMode(officeSearch.mode);
    }
  }, [officeSearch.mode]);

  useEffect(() => {
    if (officeSearch.agentId && agents.some((agent) => agent.id === officeSearch.agentId)) {
      setSelectedAgentId(officeSearch.agentId);
    }
  }, [officeSearch.agentId, agents]);

  useEffect(() => {
    if (officeSearch.projectId && projects.some((project) => project.id === officeSearch.projectId)) {
      setSelectedProjectId(officeSearch.projectId);
    }
  }, [officeSearch.projectId, projects]);

  useEffect(() => {
    if (officeSearch.issueId) {
      setSelectedThreadIssueId(officeSearch.issueId);
    }
  }, [officeSearch.issueId]);

  useEffect(() => {
    if (selectedAgentId && agents.some((agent) => agent.id === selectedAgentId)) return;
    setSelectedAgentId(agentStates[0]?.agent.id ?? "");
  }, [agents, agentStates, selectedAgentId]);

  useEffect(() => {
    setMeetingParticipantIds((current) =>
      current.filter((agentId) => agentId !== selectedAgentId && agents.some((agent) => agent.id === agentId)),
    );
  }, [agents, selectedAgentId]);

  useEffect(() => {
    if (selectedProjectId && projects.some((project) => project.id === selectedProjectId)) return;
    if (!selectedProjectId && projects.length !== 1) return;
    setSelectedProjectId(projects[0]?.id ?? "");
  }, [projects, selectedProjectId]);

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;
  const selectedProjectPath =
    selectedProject?.codebase.localFolder ||
    selectedProject?.codebase.effectiveLocalFolder ||
    "";

  useEffect(() => {
    const syncedReferencePath = syncOfficeReferencePath({
      referencePath,
      mode: referencePathMode,
      selectedProjectPath,
    });
    if (syncedReferencePath !== referencePath) {
      setReferencePath(syncedReferencePath);
    }
  }, [referencePath, referencePathMode, selectedProjectPath]);

  const liveIssueIds = useMemo(
    () => new Set(liveRuns.map((run) => run.issueId).filter((issueId): issueId is string => Boolean(issueId))),
    [liveRuns],
  );

  const focusIssues = useMemo(() => {
    return [...issues]
      .filter((issue) => !issue.hiddenAt && issue.status !== "done" && issue.status !== "cancelled")
      .sort((a, b) => {
        const liveDiff = Number(liveIssueIds.has(b.id)) - Number(liveIssueIds.has(a.id));
        if (liveDiff !== 0) return liveDiff;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      })
      .slice(0, 4);
  }, [issues, liveIssueIds]);

  const activeAgents = useMemo(
    () => agentStates.filter((state) => state.liveRun || state.agent.status === "running").slice(0, 6),
    [agentStates],
  );
  const recentEvents = useMemo(() => activity.slice(0, 6), [activity]);
  const error = agentsQuery.error ?? issuesQuery.error ?? dashboardQuery.error ?? liveRunsQuery.error ?? activityQuery.error;

  const agentById = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent] as const)),
    [agents],
  );
  const selectedAgentState = agentStates.find((state) => state.agent.id === selectedAgentId) ?? null;
  const directThreadIssues = useMemo(
    () => (selectedAgentId ? listOfficeConversationIssues({ issues, agentId: selectedAgentId }) : []),
    [issues, selectedAgentId],
  );
  const meetingThreadIssues = useMemo(() => listOfficeMeetingIssues(issues), [issues]);
  const threadIssues = composerMode === "meeting" ? meetingThreadIssues : directThreadIssues;
  const selectedConversationTarget = useMemo(
    () =>
      selectedAgentId
        ? pickOfficeConversationTarget({
            issues,
            agentId: selectedAgentId,
            projectId: selectedProjectId || null,
            preferredIssueId: selectedAgentState?.issue?.id ?? null,
          })
        : { issue: null, reason: null },
    [issues, selectedAgentId, selectedProjectId, selectedAgentState?.issue?.id],
  );
  const selectedConversationReasonLabel = formatConversationTargetReason(
    selectedConversationTarget.reason,
    Boolean(selectedAgentState?.liveRun),
  );

  const resolvedThreadIssue = useMemo(() => {
    if (selectedThreadIssueId) {
      const explicitIssue = threadIssues.find((issue) => issue.id === selectedThreadIssueId) ?? null;
      if (explicitIssue) return explicitIssue;
    }
    if (composerMode === "direct" && selectedConversationTarget.issue) {
      return selectedConversationTarget.issue;
    }
    return threadIssues[0] ?? null;
  }, [composerMode, selectedConversationTarget.issue, selectedThreadIssueId, threadIssues]);

  useEffect(() => {
    if (resolvedThreadIssue && selectedThreadIssueId !== resolvedThreadIssue.id) {
      setSelectedThreadIssueId(resolvedThreadIssue.id);
      return;
    }
    if (!resolvedThreadIssue && selectedThreadIssueId) {
      setSelectedThreadIssueId("");
    }
  }, [resolvedThreadIssue, selectedThreadIssueId]);

  const selectedThreadIssueIdForQuery = resolvedThreadIssue?.id ?? "";
  const threadCommentsQuery = useQuery({
    queryKey: queryKeys.issues.comments(selectedThreadIssueIdForQuery),
    queryFn: () => issuesApi.listComments(selectedThreadIssueIdForQuery),
    enabled: Boolean(selectedThreadIssueIdForQuery) && resolvedThreadIssue?.meetingMode !== "orchestrated",
  });

  const meetingRoomQuery = useQuery({
    queryKey: queryKeys.meetings.byIssue(selectedThreadIssueIdForQuery),
    queryFn: () => meetingsApi.getByIssue(selectedThreadIssueIdForQuery),
    enabled: Boolean(selectedThreadIssueIdForQuery) && resolvedThreadIssue?.meetingMode === "orchestrated",
    refetchInterval: resolvedThreadIssue?.meetingMode === "orchestrated" ? 5000 : false,
  });

  useEffect(() => {
    if (!resolvedThreadIssue?.id || !selectedCompanyId || !resolvedThreadIssue.isUnreadForMe) return;
    if (lastMarkedReadIssueIdRef.current === resolvedThreadIssue.id) return;
    lastMarkedReadIssueIdRef.current = resolvedThreadIssue.id;
    void issuesApi.markRead(resolvedThreadIssue.id)
      .then(() => {
        invalidateOfficeLists(queryClient, selectedCompanyId);
      })
      .catch(() => {
        lastMarkedReadIssueIdRef.current = null;
      });
  }, [queryClient, resolvedThreadIssue?.id, resolvedThreadIssue?.isUnreadForMe, selectedCompanyId]);

  const selectedMeetingParticipants = useMemo(
    () =>
      meetingParticipantIds
        .map((agentId) => agentById.get(agentId) ?? null)
        .filter((agent): agent is Agent => Boolean(agent)),
    [agentById, meetingParticipantIds],
  );

  const meetingParticipants = useMemo(() => {
    const resolved = [
      selectedAgentState?.agent ?? null,
      ...selectedMeetingParticipants,
    ].filter((agent): agent is Agent => Boolean(agent));
    const seen = new Set<string>();
    return resolved.filter((agent) => {
      if (seen.has(agent.id)) return false;
      seen.add(agent.id);
      return true;
    });
  }, [selectedAgentState?.agent, selectedMeetingParticipants]);

  const otherAgents = useMemo(
    () => agentStates.filter((state) => state.agent.id !== selectedAgentId),
    [agentStates, selectedAgentId],
  );

  const resolvedMessageTitle =
    messageTitle.trim() || defaultOfficeIssueTitle(
      selectedAgentState?.agent.name ?? null,
      selectedProject?.name ?? null,
      composerMode,
    );
  const effectiveReferencePath = useMemo(
    () => normalizeOfficeReferencePathValue(referencePath.trim() || selectedProjectPath),
    [referencePath, selectedProjectPath],
  );
  const windowsReferencePath = useMemo(
    () => convertOfficeReferencePathToWindows(effectiveReferencePath),
    [effectiveReferencePath],
  );
  const hasReferencePathMismatch = hasOfficeReferencePathMismatch({
    selectedProjectId: selectedProjectId || null,
    selectedProjectPath,
    referencePath,
    mode: referencePathMode,
  });
  const lastTouchedIssue = useMemo(
    () => issues.find((issue) => issue.id === lastTouchedIssueId) ?? null,
    [issues, lastTouchedIssueId],
  );

  useEffect(() => {
    if (!selectedCompanyId || gateState !== "ready") return;
    const nextPath = createOfficeConversationPath({
      mode: composerMode,
      agentId: composerMode === "direct" ? selectedAgentId || null : null,
      issueId: resolvedThreadIssue?.id ?? null,
      projectId: selectedProjectId || null,
    });
    const currentPath = `/office${location.search}`;
    if (currentPath === nextPath) return;
    navigate(nextPath, { replace: true });
  }, [
    composerMode,
    gateState,
    location.search,
    navigate,
    resolvedThreadIssue?.id,
    selectedAgentId,
    selectedCompanyId,
    selectedProjectId,
  ]);

  const clearComposer = () => {
    setMessageTitle("");
    setMessageBody("");
  };

  const focusComposer = () => {
    composerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => {
      messageBodyRef.current?.focus();
    }, 220);
  };

  const copyTextValue = (value: string, title: string) => {
    if (!navigator.clipboard?.writeText) {
      pushToast({
        title: "경로 복사에 실패했습니다",
        body: "이 환경에서는 클립보드 복사를 지원하지 않습니다.",
        tone: "error",
      });
      return;
    }

    navigator.clipboard.writeText(value)
      .then(() => {
        pushToast({ title, tone: "success" });
      })
      .catch((copyError) => {
        pushToast({
          title: "경로 복사에 실패했습니다",
          body: copyError instanceof Error ? copyError.message : "브라우저가 클립보드 복사를 허용하지 않았습니다.",
          tone: "error",
        });
      });
  };

  const invalidateOfficeData = async (issueId?: string, meetingId?: string) => {
    if (!selectedCompanyId) return;
    invalidateOfficeLists(queryClient, selectedCompanyId);
    if (issueId) {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.issues.detail(issueId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.issues.comments(issueId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.issues.activity(issueId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.issues.liveRuns(issueId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.issues.activeRun(issueId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.meetings.byIssue(issueId) }),
      ]);
    }
    if (meetingId) {
      await queryClient.invalidateQueries({ queryKey: queryKeys.meetings.detail(meetingId) });
    }
  };

  const createIssueFromOffice = useMutation({
    mutationFn: async () => {
      if (!selectedCompanyId) throw new Error("회사를 먼저 선택하세요.");
      if (!selectedAgentId) throw new Error("에이전트를 먼저 선택하세요.");
      if (!messageBody.trim()) throw new Error("보낼 내용을 입력하세요.");
      if (composerMode === "meeting" && meetingParticipants.length < 2) {
        throw new Error("전체회의는 진행자를 포함해 두 명 이상을 선택해야 합니다.");
      }

      if (composerMode === "meeting") {
        return meetingsApi.create(selectedCompanyId, {
          agenda: messageBody.trim(),
          participantAgentIds: meetingParticipants.map((agent) => agent.id),
          facilitatorAgentId: selectedAgentId,
          summaryAgentId: selectedAgentId,
          maxDiscussionRounds: 1,
          responseTimeoutSec: 900,
          ...(selectedProject ? { projectId: selectedProject.id } : {}),
          ...(effectiveReferencePath ? { referencePath: effectiveReferencePath } : {}),
          autoStart: true,
          autoContinue: false,
        });
      }

      const description = buildOfficeMessageBody({
        body: messageBody,
        referencePath: effectiveReferencePath,
        project: selectedProject,
      });

      return issuesApi.create(selectedCompanyId, {
        title: resolvedMessageTitle,
        description,
        assigneeAgentId: selectedAgentId,
        ...(selectedProject ? { projectId: selectedProject.id } : {}),
        status: "todo",
        priority: "high",
      });
    },
    onSuccess: async (created) => {
      const rootIssueId = "rootIssue" in created ? created.rootIssue.id : created.id;
      const meetingId = "rootIssue" in created ? created.meeting.id : undefined;
      const title = "rootIssue" in created ? created.rootIssue.title : created.title;
      await invalidateOfficeData(rootIssueId, meetingId);
      setLastTouchedIssueId(rootIssueId);
      setSelectedThreadIssueId(rootIssueId);
      clearComposer();
      pushToast({
        title: composerMode === "meeting" ? "전체회의 이슈를 만들었습니다" : "새 대화 이슈를 만들었습니다",
        body: `${rootIssueId.slice(0, 8)} ${title}`,
        tone: "success",
        action: { label: "이슈 열기", href: issueUrl({ id: rootIssueId }) },
      });
    },
    onError: (mutationError) => {
      pushToast({
        title: composerMode === "meeting" ? "전체회의 이슈 생성에 실패했습니다" : "이슈 생성에 실패했습니다",
        body: mutationError instanceof Error ? mutationError.message : "오피스 메시지를 이슈로 만들지 못했습니다.",
        tone: "error",
      });
    },
  });

  const commentOnSelectedIssue = useMutation({
    mutationFn: async () => {
      if (!resolvedThreadIssue) throw new Error("코멘트를 남길 스레드를 먼저 선택하세요.");
      if (resolvedThreadIssue.meetingMode === "orchestrated") {
        throw new Error("orchestrated 회의는 댓글 대신 회의 제어 버튼으로 진행해주세요.");
      }
      if (!messageBody.trim()) throw new Error("보낼 내용을 입력하세요.");
      const body = buildOfficeMessageBody({
        body: messageBody,
        referencePath: effectiveReferencePath,
        project: selectedProject,
      });
      await issuesApi.addComment(resolvedThreadIssue.id, body);
      return resolvedThreadIssue;
    },
    onSuccess: async (issue) => {
      await invalidateOfficeData(issue.id);
      setLastTouchedIssueId(issue.id);
      clearComposer();
      pushToast({
        title: composerMode === "meeting" ? "회의 스레드에 코멘트를 남겼습니다" : "현재 스레드에 코멘트를 남겼습니다",
        body: `${issue.identifier ?? issue.id.slice(0, 8)} ${issue.title}`,
        tone: "success",
        action: { label: "이슈 열기", href: issueUrl(issue) },
      });
    },
    onError: (mutationError) => {
      pushToast({
        title: "코멘트 추가에 실패했습니다",
        body: mutationError instanceof Error ? mutationError.message : "현재 스레드에 코멘트를 추가하지 못했습니다.",
        tone: "error",
      });
    },
  });

  const templates = useMemo<OfficeTemplateAction[]>(
    () =>
      OFFICE_MARKETING_TEMPLATES.map((template) => ({
        label: template.label,
        onApply: () => {
          const seed = template.build(selectedProject?.name ?? null);
          setMessageTitle(seed.title);
          setMessageBody(seed.body);
          setComposerOptionsOpen(true);
        },
      })),
    [selectedProject?.name],
  );

  const sendSummary = useMemo<OfficeSendSummaryRow[]>(() => {
    const rows: OfficeSendSummaryRow[] = [
      {
        label: "방식",
        value: composerMode === "meeting" ? "전체회의" : "개별 지시",
      },
      {
        label: composerMode === "meeting" ? "진행자" : "대상",
        value: selectedAgentState?.agent.name ?? "선택 필요",
      },
    ];

    if (composerMode === "meeting") {
      rows.push({
        label: "참가자",
        value: meetingParticipants.length >= 2
          ? meetingParticipants.map((agent) => agent.name).join(", ")
          : "진행자를 포함해 최소 2명",
      });
    } else {
      rows.push({
        label: "현재 스레드",
        value: resolvedThreadIssue
          ? `${resolvedThreadIssue.identifier ?? resolvedThreadIssue.id.slice(0, 8)} ${resolvedThreadIssue.title}`
          : "새 대화 이슈 생성 예정",
      });
    }

    rows.push({
      label: "프로젝트",
      value: selectedProject?.name ?? "프로젝트 없음",
    });

    rows.push({
      label: "경로",
      value: effectiveReferencePath || "경로 없음",
    });

    return rows;
  }, [composerMode, effectiveReferencePath, meetingParticipants, resolvedThreadIssue, selectedAgentState?.agent.name, selectedProject?.name]);

  if (gateState === "needs_company_onboarding") {
    return (
      <EmptyState
        icon={PanelsTopLeft}
        message="AI 회사 오피스를 시작하려면 첫 회사와 에이전트를 만들어야 합니다."
        action="온보딩 시작"
        onAction={openOnboarding}
      />
    );
  }

  if (gateState === "needs_company_selection") {
    return <EmptyState icon={PanelsTopLeft} message="오피스를 보려면 회사를 선택하세요." />;
  }

  if (gateState === "loading") {
    return <PageSkeleton variant="dashboard" />;
  }

  if (gateState === "error") {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        {error instanceof Error ? error.message : "오피스 상태를 불러오지 못했습니다."}
      </div>
    );
  }

  if (gateState === "empty_agents") {
    return (
      <EmptyState
        icon={PanelsTopLeft}
        message="AI 회사 오피스를 채울 에이전트가 아직 없습니다."
        action="에이전트 만들기"
        onAction={() => openOnboarding({ initialStep: 2, companyId: selectedCompanyId! })}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
            <PanelsTopLeft className="h-3.5 w-3.5" />
            Live 2D Office
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {selectedCompany?.name ?? "회사"} 오피스
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              2D 오피스와 AI 회사 메신저를 한 화면에 묶어, 에이전트 상태와 대화를 함께 운영하는 실시간 작업실입니다.
              DM은 이슈/댓글 스레드로, 전체회의는 orchestrated meeting room으로 이어집니다.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            기본 대시보드
          </Link>
          <Link
            to="/inbox/mine"
            className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            받은 편지함
          </Link>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error instanceof Error ? error.message : "오피스 상태를 불러오지 못했습니다."}
        </div>
      ) : null}

      {dashboard ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <OfficeStatCard
            icon={Bot}
            label="현장 에이전트"
            value={`${agents.length}`}
            detail={`실행 중 ${liveRuns.length}명`}
          />
          <OfficeStatCard
            icon={CircleDot}
            label="열린 작업"
            value={`${dashboard.tasks.open}`}
            detail={`진행 중 ${dashboard.tasks.inProgress}건 · 막힘 ${dashboard.tasks.blocked}건`}
          />
          <OfficeStatCard
            icon={ShieldCheck}
            label="조치 필요 승인"
            value={`${dashboard.pendingApprovals}`}
            detail={dashboard.pendingApprovals > 0 ? "승인 게이트 확인 필요" : "현재 승인 대기 없음"}
          />
          <OfficeStatCard
            icon={DollarSign}
            label="이번 달 비용"
            value={formatCents(dashboard.costs.monthSpendCents)}
            detail={
              dashboard.budgets.activeIncidents > 0
                ? `예산 사고 ${dashboard.budgets.activeIncidents}건`
                : "예산 사고 없음"
            }
          />
        </div>
      ) : null}

      <section className="sticky top-3 z-10 rounded-[24px] border border-cyan-400/20 bg-background/92 px-4 py-4 shadow-[0_18px_40px_rgba(0,0,0,0.16)] backdrop-blur supports-[backdrop-filter]:bg-background/85">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-cyan-100">
              <MessageSquare className="h-3.5 w-3.5" />
              회사 메신저
            </div>
            <p className="text-sm text-foreground">
              {composerMode === "meeting"
                ? `${selectedAgentState?.agent.name ?? "진행자"} 중심으로 전체회의를 열 수 있습니다.`
                : `${selectedAgentState?.agent.name ?? "에이전트"}와 이슈 기반 DM을 이어갈 수 있습니다.`}
            </p>
            <p className="text-xs text-muted-foreground">
              새 채팅 시스템이 아니라 기존 이슈/댓글 흐름을 메신저처럼 재구성한 화면입니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={focusComposer}>
              <MessageSquare className="mr-1 h-3.5 w-3.5" />
              메시지 창으로 이동
            </Button>
            {resolvedThreadIssue ? (
              <Link
                to={issueUrl(resolvedThreadIssue)}
                className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-accent"
              >
                현재 스레드 보기
              </Link>
            ) : null}
          </div>
        </div>
      </section>

      <div
        className={cn(
          "grid gap-4",
          sceneCollapsed
            ? "xl:grid-cols-[minmax(0,1fr)_22rem]"
            : "xl:grid-cols-[minmax(0,1.08fr)_minmax(0,1.28fr)_22rem]",
        )}
      >
        {!sceneCollapsed ? (
          <OfficeScene
            agentStates={agentStates}
            focusIssues={focusIssues}
            liveIssueIds={liveIssueIds}
            pendingApprovals={dashboard?.pendingApprovals ?? 0}
            activeBudgetIncidents={dashboard?.budgets.activeIncidents ?? 0}
          />
        ) : null}

        <div ref={composerRef}>
          <OfficeConversationPanel
            companyId={selectedCompanyId!}
            mode={composerMode}
            onModeChange={setComposerMode}
            sceneCollapsed={sceneCollapsed}
            onToggleScene={() => setSceneCollapsed((current) => !current)}
            agentStates={agentStates}
            agentById={agentById}
            selectedAgentId={selectedAgentId}
            onSelectAgent={setSelectedAgentId}
            threadIssues={threadIssues}
            selectedThreadIssue={resolvedThreadIssue}
            onSelectThread={setSelectedThreadIssueId}
            threadComments={threadCommentsQuery.data ?? []}
            threadCommentsLoading={threadCommentsQuery.isLoading}
            threadCommentsError={threadCommentsQuery.error instanceof Error ? threadCommentsQuery.error.message : null}
            threadMeetingRoom={meetingRoomQuery.data ?? null}
            threadMeetingRoomLoading={meetingRoomQuery.isLoading}
            threadMeetingRoomError={meetingRoomQuery.error instanceof Error ? meetingRoomQuery.error.message : null}
            selectedProject={selectedProject}
            selectedProjectId={selectedProjectId}
            projects={projects}
            onSelectProject={setSelectedProjectId}
            onOpenNewProject={openNewProject}
            messageTitle={messageTitle}
            onChangeTitle={setMessageTitle}
            messageBody={messageBody}
            onChangeBody={setMessageBody}
            messageBodyRef={messageBodyRef}
            composerOptionsOpen={composerOptionsOpen}
            onComposerOptionsOpenChange={setComposerOptionsOpen}
            templates={templates}
            referencePath={referencePath}
            onChangeReferencePath={(value) => {
              setReferencePath(value);
              setReferencePathMode("manual");
            }}
            effectiveReferencePath={effectiveReferencePath}
            windowsReferencePath={windowsReferencePath}
            selectedProjectPath={selectedProjectPath}
            onCopyWslPath={() => {
              if (!effectiveReferencePath) return;
              copyTextValue(effectiveReferencePath, "WSL 경로를 복사했습니다");
            }}
            onCopyWindowsPath={() => {
              if (!windowsReferencePath) return;
              copyTextValue(windowsReferencePath, "Windows 경로를 복사했습니다");
            }}
            onUseProjectPath={() => {
              setReferencePath(selectedProjectPath);
              setReferencePathMode("project");
              if (selectedProjectPath) {
                pushToast({ title: "프로젝트 경로를 메시지에 채웠습니다", tone: "success" });
              }
            }}
            hasReferencePathMismatch={hasReferencePathMismatch}
            selectedAgentState={selectedAgentState}
            selectedConversationReasonLabel={composerMode === "direct" ? selectedConversationReasonLabel : null}
            meetingParticipants={meetingParticipants}
            selectedMeetingParticipants={selectedMeetingParticipants}
            otherAgents={otherAgents}
            onToggleMeetingParticipant={(agentId) => {
              setMeetingParticipantIds((current) =>
                current.includes(agentId)
                  ? current.filter((currentId) => currentId !== agentId)
                  : [...current, agentId],
              );
            }}
            onSelectAllMeetingParticipants={() => setMeetingParticipantIds(otherAgents.map((state) => state.agent.id))}
            onClearMeetingParticipants={() => setMeetingParticipantIds([])}
            sendSummary={sendSummary}
            onCommentCurrentThread={() => commentOnSelectedIssue.mutate()}
            onCreateIssue={() => createIssueFromOffice.mutate()}
            canCommentCurrentThread={Boolean(
              resolvedThreadIssue
              && resolvedThreadIssue.meetingMode !== "orchestrated"
              && messageBody.trim(),
            )}
            canCreateIssue={
              Boolean(
                selectedAgentId &&
                messageBody.trim() &&
                (composerMode === "direct" || meetingParticipants.length >= 2),
              )
            }
            isSending={createIssueFromOffice.isPending || commentOnSelectedIssue.isPending}
            lastTouchedIssue={lastTouchedIssue}
          />
        </div>

        <OfficeSidebar
          activeAgents={activeAgents}
          focusIssues={focusIssues}
          recentEvents={recentEvents}
        />
      </div>
    </div>
  );
}

function OfficeStatCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Bot;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-[24px] border border-border bg-card px-4 py-4 shadow-[0_18px_40px_rgba(0,0,0,0.08)]">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{label}</div>
          <div className="text-2xl font-semibold text-foreground">{value}</div>
        </div>
        <div className="rounded-2xl border border-border bg-muted/40 p-2.5 text-muted-foreground">
          <Icon className="h-[18px] w-[18px]" />
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}
