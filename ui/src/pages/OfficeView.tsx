import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import { buildAgentMentionHref, type ActivityEvent, type Agent, type Issue, type Project } from "@paperclipai/shared";
import {
  AlertTriangle,
  ArrowUpRight,
  Bot,
  CircleDot,
  Clock3,
  Copy,
  DollarSign,
  FolderKanban,
  MessageSquare,
  PanelsTopLeft,
  PauseCircle,
  Send,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { activityApi } from "../api/activity";
import { agentsApi } from "../api/agents";
import { dashboardApi } from "../api/dashboard";
import { heartbeatsApi } from "../api/heartbeats";
import { issuesApi } from "../api/issues";
import { projectsApi } from "../api/projects";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { useDialog } from "../context/DialogContext";
import { useToast } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { agentUrl, cn, formatCents, formatStatusLabel, issueUrl, projectUrl, relativeTime } from "../lib/utils";
import {
  convertOfficeReferencePathToWindows,
  deriveOfficeAgentStates,
  hasOfficeReferencePathMismatch,
  normalizeOfficeReferencePathValue,
  pickOfficeConversationTarget,
  resolveOfficeViewGateState,
  syncOfficeReferencePath,
  type OfficeReferencePathMode,
  type OfficeConversationTargetReason,
  type OfficeAgentState,
  type OfficeZoneId,
} from "./officeViewModel";

const ISSUE_STATUS_RANK: Record<string, number> = {
  in_progress: 0,
  blocked: 1,
  in_review: 2,
  todo: 3,
  backlog: 4,
  done: 5,
  cancelled: 6,
};

const ISSUE_TICKET_POSITIONS = [
  { x: 60, y: 12 },
  { x: 70, y: 18 },
  { x: 69, y: 67 },
  { x: 78, y: 73 },
];

const DESK_DECORATIONS = [
  { x: 24, y: 37, label: "Desk A" },
  { x: 34, y: 37, label: "Desk B" },
  { x: 72, y: 37, label: "Desk C" },
  { x: 82, y: 37, label: "Desk D" },
  { x: 24, y: 63, label: "Desk E" },
  { x: 34, y: 63, label: "Desk F" },
  { x: 72, y: 63, label: "Desk G" },
  { x: 82, y: 63, label: "Desk H" },
];

const OFFICE_DRAFT_STORAGE_PREFIX = "paperclip:office-composer";
type OfficeComposerMode = "direct" | "meeting";

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
  mode: OfficeComposerMode,
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

function buildAgentMention(agent: Agent): string {
  return `[@${agent.name}](${buildAgentMentionHref(agent.id, agent.icon ?? null)})`;
}

function buildOfficeMeetingBody(input: {
  body: string;
  referencePath: string;
  project: Project | null;
  facilitator: Agent | null;
  participants: Agent[];
}) {
  const main = input.body.trim();
  const allParticipants = input.facilitator
    ? [input.facilitator, ...input.participants.filter((agent) => agent.id !== input.facilitator?.id)]
    : input.participants;
  const contextLines = [
    "- 회의 형식: 전체회의",
    input.facilitator ? `- 진행자: ${buildAgentMention(input.facilitator)}` : null,
    allParticipants.length > 0
      ? `- 참가자: ${allParticipants.map((agent) => buildAgentMention(agent)).join(" ")}`
      : null,
    ...buildOfficeContextLines(input),
  ].filter((line): line is string => Boolean(line));

  return `${main}\n\n회의 컨텍스트\n${contextLines.join("\n")}`;
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

export function OfficeView() {
  const { selectedCompanyId, selectedCompany, companies } = useCompany();
  const { openOnboarding, openNewProject } = useDialog();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [composerMode, setComposerMode] = useState<OfficeComposerMode>("direct");
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [meetingParticipantIds, setMeetingParticipantIds] = useState<string[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [messageTitle, setMessageTitle] = useState("");
  const [messageBody, setMessageBody] = useState("");
  const [referencePath, setReferencePath] = useState("");
  const [referencePathMode, setReferencePathMode] = useState<OfficeReferencePathMode>("manual");
  const [lastTouchedIssueId, setLastTouchedIssueId] = useState<string | null>(null);
  const messageDockRef = useRef<HTMLElement | null>(null);
  const messageBodyRef = useRef<HTMLTextAreaElement | null>(null);

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

  const draftStorageKey = officeDraftStorageKey(selectedCompanyId);

  useEffect(() => {
    if (!draftStorageKey) return;
    try {
      const raw = localStorage.getItem(draftStorageKey);
      if (!raw) {
        setComposerMode("direct");
        setSelectedAgentId("");
        setMeetingParticipantIds([]);
        setSelectedProjectId("");
        setMessageTitle("");
        setMessageBody("");
        setReferencePath("");
        setReferencePathMode("manual");
        return;
      }
      const parsed = JSON.parse(raw) as {
        composerMode?: OfficeComposerMode;
        selectedAgentId?: string;
        meetingParticipantIds?: string[];
        selectedProjectId?: string;
        messageTitle?: string;
        messageBody?: string;
        referencePath?: string;
        referencePathMode?: OfficeReferencePathMode;
      };
      setComposerMode(parsed.composerMode === "meeting" ? "meeting" : "direct");
      setSelectedAgentId(parsed.selectedAgentId ?? "");
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
    } catch {
      setComposerMode("direct");
      setSelectedAgentId("");
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
          meetingParticipantIds,
          selectedProjectId,
          messageTitle,
          messageBody,
          referencePath,
          referencePathMode,
        }),
      );
    } catch {
      // Ignore localStorage failures.
    }
  }, [
    composerMode,
    draftStorageKey,
    selectedAgentId,
    meetingParticipantIds,
    selectedProjectId,
    messageTitle,
    messageBody,
    referencePath,
    referencePathMode,
  ]);

  const agentStates = useMemo(
    () => deriveOfficeAgentStates({ agents, issues, liveRuns, nowMs }),
    [agents, issues, liveRuns, nowMs],
  );

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

  const agentById = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent])),
    [agents],
  );
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
        const statusDiff = (ISSUE_STATUS_RANK[a.status] ?? 99) - (ISSUE_STATUS_RANK[b.status] ?? 99);
        if (statusDiff !== 0) return statusDiff;
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
  const selectedAgentState = agentStates.find((state) => state.agent.id === selectedAgentId) ?? null;
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
  const selectedConversationIssue = selectedConversationTarget.issue;
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
  const composedMessageBody = buildOfficeMessageBody({
    body: messageBody,
    referencePath: effectiveReferencePath,
    project: selectedProject,
  });
  const composedMeetingBody = buildOfficeMeetingBody({
    body: messageBody,
    referencePath: effectiveReferencePath,
    project: selectedProject,
    facilitator: selectedAgentState?.agent ?? null,
    participants: selectedMeetingParticipants,
  });
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

  const clearComposer = () => {
    setMessageTitle("");
    setMessageBody("");
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

  const focusMessageDock = () => {
    messageDockRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => {
      messageBodyRef.current?.focus();
    }, 220);
  };

  const toggleMeetingParticipant = (agentId: string) => {
    setMeetingParticipantIds((current) =>
      current.includes(agentId)
        ? current.filter((currentId) => currentId !== agentId)
        : [...current, agentId],
    );
  };

  const invalidateOfficeData = async (issueId?: string) => {
    if (!selectedCompanyId) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.list(selectedCompanyId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(selectedCompanyId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.activity(selectedCompanyId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.liveRuns(selectedCompanyId) }),
      ...(issueId
        ? [
            queryClient.invalidateQueries({ queryKey: queryKeys.issues.detail(issueId) }),
            queryClient.invalidateQueries({ queryKey: queryKeys.issues.comments(issueId) }),
          ]
        : []),
    ]);
  };

  const createIssueFromOffice = useMutation({
    mutationFn: async () => {
      if (!selectedCompanyId) throw new Error("회사를 먼저 선택하세요.");
      if (!selectedAgentId) throw new Error("에이전트를 먼저 선택하세요.");
      if (!messageBody.trim()) throw new Error("보낼 내용을 입력하세요.");
      if (composerMode === "meeting" && meetingParticipants.length < 2) {
        throw new Error("전체회의는 진행자를 포함해 두 명 이상을 선택해야 합니다.");
      }

      return issuesApi.create(selectedCompanyId, {
        title: resolvedMessageTitle,
        description: composerMode === "meeting" ? composedMeetingBody : composedMessageBody,
        assigneeAgentId: selectedAgentId,
        ...(selectedProject ? { projectId: selectedProject.id } : {}),
        status: "todo",
        priority: "high",
      });
    },
    onSuccess: async (issue) => {
      await invalidateOfficeData(issue.id);
      setLastTouchedIssueId(issue.id);
      clearComposer();
      pushToast({
        title: composerMode === "meeting" ? "전체회의 요청 이슈를 만들었습니다" : "오피스 메시지를 새 이슈로 보냈습니다",
        body: `${issue.identifier ?? issue.id.slice(0, 8)} ${issue.title}`,
        tone: "success",
        action: { label: "이슈 열기", href: issueUrl(issue) },
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
      if (!selectedConversationIssue) throw new Error("코멘트를 남길 현재 작업이 없습니다.");
      if (!messageBody.trim()) throw new Error("보낼 내용을 입력하세요.");
      await issuesApi.addComment(selectedConversationIssue.id, composedMessageBody);
      return selectedConversationIssue;
    },
    onSuccess: async (issue) => {
      await invalidateOfficeData(issue.id);
      setLastTouchedIssueId(issue.id);
      clearComposer();
      pushToast({
        title: "현재 작업에 코멘트를 남겼습니다",
        body: `${issue.identifier ?? issue.id.slice(0, 8)} ${issue.title}`,
        tone: "success",
        action: { label: "이슈 열기", href: issueUrl(issue) },
      });
    },
    onError: (mutationError) => {
      pushToast({
        title: "코멘트 추가에 실패했습니다",
        body: mutationError instanceof Error ? mutationError.message : "현재 작업에 코멘트를 추가하지 못했습니다.",
        tone: "error",
      });
    },
  });

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

  if (gateState === "needs_company_onboarding") {
      return (
        <EmptyState
          icon={PanelsTopLeft}
          message="2D 오피스를 시작하려면 첫 회사와 에이전트를 만들어야 합니다."
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
        message="2D 오피스를 채울 에이전트가 아직 없습니다."
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
              기존 Paperclip 데이터를 그대로 사용해, 에이전트가 어디에서 일하고 있는지 2D 공간으로 보여주는 실시간 뷰입니다.
              무거운 3D 대신 상태 변화와 작업 흐름을 한눈에 읽는 데 집중했습니다.
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
            to="/issues"
            className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            이슈 열기
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error instanceof Error ? error.message : "오피스 상태를 불러오지 못했습니다."}
        </div>
      )}

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
              메시지 독 바로가기
            </div>
            <p className="text-sm text-foreground">
              {selectedAgentState
                ? composerMode === "meeting"
                  ? `${selectedAgentState.agent.name}를 진행자로 전체회의를 준비할 수 있습니다.`
                  : `${selectedAgentState.agent.name}에게 바로 지시를 보낼 수 있습니다.`
                : "에이전트를 선택하면 바로 메시지를 보낼 수 있습니다."}
            </p>
            <p className="text-xs text-muted-foreground">
              {selectedProject
                ? composerMode === "meeting"
                  ? `${selectedProject.name} 프로젝트 기준 안건과 참가자를 묶어 회의 이슈로 만들 수 있습니다.`
                  : `${selectedProject.name} 프로젝트 컨텍스트와 경로를 함께 붙여 보낼 수 있습니다.`
                : "프로젝트를 고르면 장사톡 같은 실제 코드베이스 경로를 같이 붙여 보낼 수 있습니다."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={focusMessageDock}>
              <MessageSquare className="mr-1 h-3.5 w-3.5" />
              메시지 독 열기
            </Button>
            {selectedConversationIssue ? (
              <Link
                to={issueUrl(selectedConversationIssue)}
                className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-accent"
              >
                현재 작업 보기
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            ) : null}
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.75fr)_23rem]">
        <section className="overflow-hidden rounded-[30px] border border-border bg-card shadow-[0_24px_80px_rgba(0,0,0,0.18)]">
          <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground">스튜디오 플로어</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                라이브 런은 지휘 보드 주변을 순환하고, 검토/승인/복구 상태는 별도 구역으로 이동합니다.
              </p>
              <p className="mt-2 text-[11px] text-muted-foreground sm:hidden">
                좁은 화면에서는 장면을 좌우로 스크롤해 확인하세요.
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/80" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
              </span>
              실시간 갱신
            </div>
          </div>

          <div className="p-4">
            <div className="overflow-x-auto pb-2">
              <div className="office-scene relative min-h-[620px] min-w-[760px] overflow-hidden rounded-[28px] border border-white/10 bg-slate-950 text-slate-100 lg:min-w-0">
              <div className="absolute left-1/2 top-[6%] z-10 w-[300px] max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-[22px] border border-cyan-400/20 bg-slate-950/85 p-4 shadow-[0_0_0_1px_rgba(34,211,238,0.08),0_16px_60px_rgba(8,145,178,0.18)] lg:left-[39%] lg:w-[22%] lg:min-w-[220px] lg:max-w-none lg:translate-x-0">
                <div className="text-[10px] font-semibold uppercase tracking-[0.25em] text-cyan-200/70">
                  Command Screen
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <CommandMetric label="Live" value={String(liveRuns.length)} />
                  <CommandMetric label="Open" value={String(dashboard?.tasks.open ?? 0)} />
                  <CommandMetric label="Alerts" value={String(dashboard?.budgets.activeIncidents ?? 0)} />
                </div>
                <div className="mt-3 rounded-2xl border border-cyan-400/15 bg-cyan-400/8 px-3 py-2 text-[11px] text-cyan-50/80">
                  {dashboard?.pendingApprovals
                    ? `승인 게이트에 ${dashboard.pendingApprovals}건이 대기 중입니다.`
                    : "지금은 승인 대기 없이 흐름이 매끈합니다."}
                </div>
              </div>

              <OfficeZoneCard
                title="복구 구역"
                subtitle="일시중지 · 오류"
                className="left-[4%] top-[8%] w-[170px] lg:w-[19%]"
                tone="recovery"
              />
              <OfficeZoneCard
                title="집중 데스크"
                subtitle="일반 작업"
                className="left-[8%] top-[25%] h-[46%] w-[228px] lg:w-[30%]"
                tone="desk"
              />
              <OfficeZoneCard
                title="집중 데스크"
                subtitle="병렬 작업"
                className="right-[8%] top-[25%] h-[46%] w-[228px] lg:w-[30%]"
                tone="desk"
              />
              <OfficeZoneCard
                title="검토 테이블"
                subtitle="리뷰 · 정리"
                className="right-[9%] bottom-[8%] w-[220px] lg:w-[27%]"
                tone="review"
              />
              <OfficeZoneCard
                title="승인 게이트"
                subtitle="조치 필요"
                className="right-[4%] top-[8%] w-[170px] lg:w-[18%]"
                tone="approval"
              />
              <OfficeZoneCard
                title="라운지"
                subtitle="대기 · 준비"
                className="left-[6%] bottom-[8%] w-[190px] lg:w-[24%]"
                tone="lounge"
              />

              {DESK_DECORATIONS.map((desk) => (
                <OfficeDesk key={desk.label} x={desk.x} y={desk.y} label={desk.label} />
              ))}

              {focusIssues.map((issue, index) => (
                <IssueTicket
                  key={issue.id}
                  issue={issue}
                  x={ISSUE_TICKET_POSITIONS[index]?.x ?? 70}
                  y={ISSUE_TICKET_POSITIONS[index]?.y ?? 20}
                  live={liveIssueIds.has(issue.id)}
                />
              ))}

              {dashboard && dashboard.pendingApprovals > 0 ? (
                <div className="absolute right-[7%] top-[18%] z-20 flex items-center gap-2 rounded-full border border-amber-300/30 bg-amber-400/14 px-3 py-1.5 text-xs font-medium text-amber-50">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  승인 {dashboard.pendingApprovals}건
                </div>
              ) : null}

              {dashboard && dashboard.budgets.activeIncidents > 0 ? (
                <div className="absolute left-[9%] top-[18%] z-20 flex items-center gap-2 rounded-full border border-red-300/30 bg-red-400/14 px-3 py-1.5 text-xs font-medium text-red-50">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  예산 사고 {dashboard.budgets.activeIncidents}건
                </div>
              ) : null}

              {agentStates.map((state) => (
                <AgentMarker key={state.agent.id} state={state} />
              ))}
            </div>
            </div>
          </div>
        </section>

        <aside className="space-y-4">
          <InfoCard
            title="라이브 런"
            icon={Clock3}
            description={activeAgents.length > 0 ? "지금 움직이는 에이전트" : "현재는 모두 자리에서 대기 중입니다."}
          >
            <div className="space-y-3">
              {activeAgents.length > 0 ? (
                activeAgents.map((state) => (
                  <Link
                    key={state.agent.id}
                    to={agentUrl(state.agent)}
                    className="flex items-start justify-between gap-3 rounded-2xl border border-border bg-background/70 px-3 py-3 transition-colors hover:bg-accent/60"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                        <span className="text-sm font-medium text-foreground">{state.agent.name}</span>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                          {state.agent.role}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {state.issue ? state.issue.title : "실행 중인 작업 감시"}
                      </p>
                    </div>
                    <ArrowUpRight className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  </Link>
                ))
              ) : (
                <p className="rounded-2xl border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                  지금은 라이브 런이 없습니다. 다음 heartbeat가 시작되면 여기에서 바로 움직임이 보입니다.
                </p>
              )}
            </div>
          </InfoCard>

          <InfoCard
            title="작업 큐"
            icon={CircleDot}
            description="현재 오피스에서 눈에 띄는 작업"
          >
            <div className="space-y-3">
              {focusIssues.length > 0 ? (
                focusIssues.map((issue) => (
                  <Link
                    key={issue.id}
                    to={issueUrl(issue)}
                    className="block rounded-2xl border border-border bg-background/70 px-3 py-3 transition-colors hover:bg-accent/60"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm font-medium text-foreground">
                        {issue.identifier ?? issue.id.slice(0, 8)}
                      </span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                        {formatStatusLabel(issue.status)}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{issue.title}</p>
                  </Link>
                ))
              ) : (
                <p className="rounded-2xl border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                  열려 있는 작업이 없습니다.
                </p>
              )}
            </div>
          </InfoCard>

          <InfoCard
            title="최근 활동"
            icon={PauseCircle}
            description="오피스에 방금 반영된 변화"
          >
            <div className="space-y-3">
              {recentEvents.length > 0 ? (
                recentEvents.map((event) => (
                  <ActivitySnippet key={event.id} event={event} />
                ))
              ) : (
                <p className="rounded-2xl border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                  최근 활동이 아직 없습니다.
                </p>
              )}
            </div>
          </InfoCard>
        </aside>
      </div>

      <section
        id="office-message-dock"
        ref={messageDockRef}
        className="rounded-[30px] border border-border bg-card shadow-[0_24px_80px_rgba(0,0,0,0.14)]"
      >
        <div className="flex flex-col gap-3 border-b border-border px-5 py-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
              <MessageSquare className="h-3.5 w-3.5" />
              Office Message Dock
            </div>
            <h2 className="text-sm font-semibold text-foreground">오피스 메시지 독</h2>
            <p className="max-w-3xl text-xs text-muted-foreground">
              선택한 에이전트에게 새 업무를 보내거나, 지금 진행 중인 이슈에 바로 코멘트를 남길 수 있습니다.
              전체회의 모드에서는 진행자 1명을 정하고, 나머지 참가자를 멘션으로 함께 초대합니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {selectedProjectPath ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setReferencePath(selectedProjectPath);
                  setReferencePathMode("project");
                  pushToast({ title: "프로젝트 경로를 메시지에 채웠습니다", tone: "success" });
                }}
              >
                <FolderKanban className="mr-1 h-3.5 w-3.5" />
                프로젝트 경로 삽입
              </Button>
            ) : null}
            {selectedProject ? (
              <Link
                to={projectUrl(selectedProject)}
                className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-accent"
              >
                프로젝트 열기
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            ) : (
              <Button variant="outline" size="sm" onClick={openNewProject}>
                프로젝트 만들기
              </Button>
            )}
          </div>
        </div>

        <div className="grid gap-5 px-5 py-5 xl:grid-cols-[minmax(0,1.45fr)_22rem]">
          <div className="space-y-5">
            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                작업 방식
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setComposerMode("direct")}
                  className={cn(
                    "rounded-full border px-3 py-2 text-xs font-medium transition-colors",
                    composerMode === "direct"
                      ? "border-cyan-400/50 bg-cyan-400/10 text-foreground"
                      : "border-border bg-background text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  )}
                >
                  개별 지시
                </button>
                <button
                  type="button"
                  onClick={() => setComposerMode("meeting")}
                  className={cn(
                    "rounded-full border px-3 py-2 text-xs font-medium transition-colors",
                    composerMode === "meeting"
                      ? "border-cyan-400/50 bg-cyan-400/10 text-foreground"
                      : "border-border bg-background text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  )}
                >
                  전체회의
                </button>
              </div>
              {composerMode === "meeting" ? (
                <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-3 py-2 text-xs text-cyan-100">
                  현재 버전에서는 진행자 1명에게 이슈를 할당하고, 다른 참가자는 멘션으로 초대합니다.
                </div>
              ) : null}
            </div>

            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                {composerMode === "meeting" ? "회의 진행자" : "대상 에이전트"}
              </div>
              <div className="flex flex-wrap gap-2">
                {agentStates.map((state) => (
                  <button
                    key={state.agent.id}
                    type="button"
                    onClick={() => setSelectedAgentId(state.agent.id)}
                    className={cn(
                      "rounded-2xl border px-3 py-2 text-left transition-colors",
                      selectedAgentId === state.agent.id
                        ? "border-cyan-400/50 bg-cyan-400/10 text-foreground"
                        : "border-border bg-background text-foreground hover:bg-accent/60",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{state.agent.name}</span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                        {state.agent.role}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {state.issue ? state.issue.title : fallbackZoneLabel(state.zoneId)}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {composerMode === "meeting" ? (
              <div className="space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    회의 참가자
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={otherAgents.length === 0}
                      onClick={() => setMeetingParticipantIds(otherAgents.map((state) => state.agent.id))}
                    >
                      전체 초대
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={meetingParticipantIds.length === 0}
                      onClick={() => setMeetingParticipantIds([])}
                    >
                      선택 해제
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {otherAgents.map((state) => {
                    const selected = meetingParticipantIds.includes(state.agent.id);
                    return (
                      <button
                        key={state.agent.id}
                        type="button"
                        onClick={() => toggleMeetingParticipant(state.agent.id)}
                        className={cn(
                          "rounded-2xl border px-3 py-2 text-left transition-colors",
                          selected
                            ? "border-cyan-400/50 bg-cyan-400/10 text-foreground"
                            : "border-border bg-background text-foreground hover:bg-accent/60",
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{state.agent.name}</span>
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                            {state.agent.role}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {selected ? "회의에 초대됨" : "클릭하면 회의에 초대"}
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div className="rounded-2xl border border-border bg-background/60 px-3 py-2 text-xs text-muted-foreground">
                  {meetingParticipants.length >= 2
                    ? `현재 ${meetingParticipants.map((agent) => agent.name).join(", ")} 참여 예정`
                    : "전체회의는 진행자를 포함해 최소 두 명 이상이 필요합니다."}
                </div>
              </div>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <label className="space-y-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  대상 프로젝트
                </span>
                <select
                  value={selectedProjectId}
                  onChange={(event) => setSelectedProjectId(event.target.value)}
                  className="border-input dark:bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 h-10 w-full rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-[3px]"
                >
                  <option value="">프로젝트 없이 보내기</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  새 이슈 제목
                </span>
                <Input
                  value={messageTitle}
                  onChange={(event) => setMessageTitle(event.target.value)}
                  placeholder={defaultOfficeIssueTitle(
                    selectedAgentState?.agent.name ?? null,
                    selectedProject?.name ?? null,
                    composerMode,
                  )}
                />
              </label>
            </div>

            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                빠른 템플릿
              </div>
              <div className="flex flex-wrap gap-2">
                {OFFICE_MARKETING_TEMPLATES.map((template) => {
                  const seed = template.build(selectedProject?.name ?? null);
                  return (
                    <button
                      key={template.label}
                      type="button"
                      onClick={() => {
                        setMessageTitle(seed.title);
                        setMessageBody(seed.body);
                      }}
                      className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-accent"
                    >
                      <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
                      {template.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
              <label className="space-y-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  참고 경로
                </span>
                <Input
                  value={referencePath}
                  onChange={(event) => {
                    setReferencePath(event.target.value);
                    setReferencePathMode("manual");
                  }}
                  placeholder="C:\\Users\\frog5\\Desktop\\... 또는 /mnt/c/Users/..."
                />
              </label>
              <div className="flex flex-wrap items-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!effectiveReferencePath}
                  onClick={() => {
                    if (!effectiveReferencePath) return;
                    copyTextValue(effectiveReferencePath, "WSL 경로를 복사했습니다");
                  }}
                >
                  <Copy className="mr-1 h-3.5 w-3.5" />
                  WSL 경로 복사
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!windowsReferencePath}
                  onClick={() => {
                    if (!windowsReferencePath) return;
                    copyTextValue(windowsReferencePath, "Windows 경로를 복사했습니다");
                  }}
                >
                  <Copy className="mr-1 h-3.5 w-3.5" />
                  Windows 경로 복사
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!selectedProjectPath}
                  onClick={() => {
                    setReferencePath(selectedProjectPath);
                    setReferencePathMode("project");
                  }}
                >
                  프로젝트 경로 사용
                </Button>
              </div>
            </div>

            {referencePathMode === "manual" && referencePath.trim() ? (
              <div className="rounded-2xl border border-border bg-background/60 px-3 py-2 text-xs text-muted-foreground">
                참고 경로는 WSL 기준으로 정규화되어 전송됩니다.
                {windowsReferencePath ? ` 필요하면 Windows 경로(${windowsReferencePath})로도 다시 복사할 수 있습니다.` : ""}
              </div>
            ) : null}

            {referencePathMode === "project" && selectedProject ? (
              <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-3 py-2 text-xs text-cyan-100">
                현재 참고 경로는 선택한 프로젝트의 로컬 폴더와 자동으로 동기화됩니다.
              </div>
            ) : null}

            {hasReferencePathMismatch ? (
              <div className="rounded-2xl border border-amber-300/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
                현재 참고 경로가 선택한 프로젝트의 로컬 폴더와 다릅니다. 이 상태로 보내면 수동 입력한 경로가 우선 전송됩니다.
              </div>
            ) : null}

            {projectsQuery.error instanceof Error ? (
              <p className="text-xs text-destructive">{projectsQuery.error.message}</p>
            ) : null}

            <label className="space-y-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                메시지 본문
              </span>
              <Textarea
                ref={messageBodyRef}
                value={messageBody}
                onChange={(event) => setMessageBody(event.target.value)}
                className="min-h-[180px]"
                placeholder={
                  composerMode === "meeting"
                    ? "예: 장사톡 프로젝트를 기준으로 CEO, CTO, CMO가 함께 논의할 안건과 원하는 결과물을 정리해주세요."
                    : "예: 장사톡 프로젝트를 보고 첫 홍보 전략, 타깃 고객, 실험 채널, 필요한 자료를 정리해주세요."
                }
              />
            </label>

            <div className="flex flex-wrap gap-2">
              {composerMode === "direct" ? (
                <Button
                  size="sm"
                  disabled={!selectedConversationIssue || !messageBody.trim() || createIssueFromOffice.isPending || commentOnSelectedIssue.isPending}
                  onClick={() => commentOnSelectedIssue.mutate()}
                >
                  <MessageSquare className="mr-1 h-3.5 w-3.5" />
                  현재 작업에 코멘트
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="outline"
                disabled={
                  !selectedAgentId ||
                  !messageBody.trim() ||
                  createIssueFromOffice.isPending ||
                  commentOnSelectedIssue.isPending ||
                  (composerMode === "meeting" && meetingParticipants.length < 2)
                }
                onClick={() => createIssueFromOffice.mutate()}
              >
                <Send className="mr-1 h-3.5 w-3.5" />
                {composerMode === "meeting" ? "회의 이슈 만들기" : "새 이슈로 보내기"}
              </Button>
              {(createIssueFromOffice.isPending || commentOnSelectedIssue.isPending) ? (
                <span className="inline-flex items-center rounded-full bg-muted px-3 py-2 text-xs text-muted-foreground">
                  오피스 메시지 전송 중...
                </span>
              ) : null}
              {lastTouchedIssue ? (
                <Link
                  to={issueUrl(lastTouchedIssue)}
                  className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-accent"
                >
                  마지막 이슈 열기
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
              ) : null}
            </div>
          </div>

          <div className="space-y-4">
            <OfficeDockCard
              title={composerMode === "meeting" ? "회의 진행자" : "선택한 에이전트"}
              icon={Bot}
              description={
                selectedAgentState
                  ? composerMode === "meeting"
                    ? "지금 이 에이전트가 회의를 진행하도록 지정되어 있습니다."
                    : "지금 이 에이전트에게 바로 말을 거는 중입니다."
                  : "먼저 에이전트를 선택하세요."
              }
            >
              {selectedAgentState ? (
                <div className="space-y-2 text-sm">
                  <div className="font-medium text-foreground">{selectedAgentState.agent.name}</div>
                  <div className="text-xs text-muted-foreground">
                    역할: {selectedAgentState.agent.role} · 현재 구역: {fallbackZoneLabel(selectedAgentState.zoneId)}
                  </div>
                  <div className="rounded-2xl border border-border bg-background/70 px-3 py-2 text-xs text-muted-foreground">
                    {selectedAgentState.issue ? selectedAgentState.issue.title : "열린 이슈 없이 다음 작업을 기다리고 있습니다."}
                  </div>
                  {selectedAgentState.liveRun ? (
                    <div className="text-[11px] text-cyan-300">실시간 실행 기준으로 현재 작업을 추적 중입니다.</div>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">에이전트를 선택하면 현재 상태와 연결 가능한 작업을 보여줍니다.</p>
              )}
            </OfficeDockCard>

            <OfficeDockCard
              title={composerMode === "meeting" ? "회의 초대 상태" : "코멘트 대상"}
              icon={composerMode === "meeting" ? Users : MessageSquare}
              description={
                composerMode === "meeting"
                  ? "회의 진행자 1명과 참가자 멘션으로 전체회의 이슈를 만드는 흐름입니다."
                  : "현재 작업이 있으면 여기에 코멘트를 붙이고, 없으면 새 이슈를 만드는 흐름입니다."
              }
            >
              {composerMode === "meeting" ? (
                <div className="space-y-3">
                  <div className="rounded-2xl border border-border bg-background/70 px-3 py-3 text-sm text-foreground">
                    {meetingParticipants.length >= 2
                      ? meetingParticipants.map((agent) => agent.name).join(", ")
                      : "진행자를 포함해 최소 두 명 이상을 선택하면 전체회의 이슈를 만들 수 있습니다."}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    현재 버전은 단일 담당자 모델을 유지하므로, 진행자는 한 명만 지정되고 나머지는 멘션으로 초대됩니다.
                  </div>
                </div>
              ) : selectedConversationIssue ? (
                <Link
                  to={issueUrl(selectedConversationIssue)}
                  className="block rounded-2xl border border-border bg-background/70 px-3 py-3 transition-colors hover:bg-accent/60"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-foreground">
                      {selectedConversationIssue.identifier ?? selectedConversationIssue.id.slice(0, 8)}
                    </span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      {formatStatusLabel(selectedConversationIssue.status)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{selectedConversationIssue.title}</p>
                  {formatConversationTargetReason(selectedConversationTarget.reason, Boolean(selectedAgentState?.liveRun)) ? (
                    <p className="mt-2 text-[11px] text-cyan-300">
                      {formatConversationTargetReason(selectedConversationTarget.reason, Boolean(selectedAgentState?.liveRun))}
                    </p>
                  ) : null}
                </Link>
              ) : (
                <div className="rounded-2xl border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                  {selectedProject
                    ? "이 프로젝트 기준으로 붙일 현재 이슈가 없어, 새 이슈 생성이 더 안전합니다."
                    : "붙일 현재 이슈가 없어 새 이슈 생성 흐름으로 보낼 준비를 합니다."}
                </div>
              )}
            </OfficeDockCard>

            <OfficeDockCard
              title="프로젝트 컨텍스트"
              icon={FolderKanban}
              description="에이전트가 읽을 수 있는 로컬 폴더와 저장소 정보를 함께 확인합니다."
            >
              {selectedProject ? (
                <div className="space-y-2 text-sm">
                  <div className="font-medium text-foreground">{selectedProject.name}</div>
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <div>로컬 폴더: {selectedProjectPath || "아직 연결되지 않음"}</div>
                    <div>저장소: {selectedProject.codebase.repoUrl ?? "아직 연결되지 않음"}</div>
                  </div>
                  {!selectedProjectPath && !selectedProject.codebase.repoUrl ? (
                    <div className="rounded-2xl border border-amber-300/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
                      아직 코드베이스가 연결되지 않았습니다. 프로젝트 상세에서 로컬 폴더나 GitHub repo를 연결하면 에이전트가 더 잘 협업할 수 있습니다.
                    </div>
                  ) : null}
                </div>
              ) : projects.length > 0 ? (
                <p className="text-sm text-muted-foreground">프로젝트를 선택하면 장사톡 같은 실제 작업 폴더와 저장소를 함께 보낼 수 있습니다.</p>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">아직 프로젝트가 없습니다. 새 프로젝트를 만들고 로컬 폴더를 연결해두면 협업이 훨씬 쉬워집니다.</p>
                  <Button variant="outline" size="sm" onClick={openNewProject}>
                    프로젝트 만들기
                  </Button>
                </div>
              )}
            </OfficeDockCard>
          </div>
        </div>
      </section>
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

function OfficeDockCard({
  title,
  icon: Icon,
  description,
  children,
}: {
  title: string;
  icon: typeof Bot;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[24px] border border-border bg-background/70 px-4 py-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-2xl border border-border bg-muted/40 p-2.5 text-muted-foreground">
          <Icon className="h-[18px] w-[18px]" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function InfoCard({
  title,
  icon: Icon,
  description,
  children,
}: {
  title: string;
  icon: typeof Bot;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[28px] border border-border bg-card px-4 py-4 shadow-[0_18px_40px_rgba(0,0,0,0.08)]">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-2xl border border-border bg-muted/40 p-2.5 text-muted-foreground">
          <Icon className="h-[18px] w-[18px]" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function CommandMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-cyan-400/[0.08] px-2.5 py-2">
      <div className="text-[9px] uppercase tracking-[0.22em] text-cyan-100/60">{label}</div>
      <div className="mt-1 text-lg font-semibold text-cyan-50">{value}</div>
    </div>
  );
}

function OfficeZoneCard({
  title,
  subtitle,
  className,
  tone,
}: {
  title: string;
  subtitle: string;
  className: string;
  tone: "desk" | "approval" | "review" | "recovery" | "lounge";
}) {
  const toneClass =
    tone === "approval" ? "border-amber-300/16 bg-amber-400/[0.06] text-amber-50"
      : tone === "review" ? "border-cyan-300/18 bg-cyan-400/[0.05] text-cyan-50"
      : tone === "recovery" ? "border-red-300/18 bg-red-400/[0.05] text-red-50"
      : tone === "lounge" ? "border-emerald-300/16 bg-emerald-400/[0.05] text-emerald-50"
      : "border-white/10 bg-white/[0.03] text-slate-100";

  return (
    <div className={cn("pointer-events-none absolute rounded-[24px] border px-4 py-3", toneClass, className)}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.24em]">{title}</div>
      <div className="mt-1 text-xs opacity-75">{subtitle}</div>
    </div>
  );
}

function OfficeDesk({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <div
      className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${x}%`, top: `${y}%` }}
    >
      <div className="rounded-[16px] border border-white/10 bg-slate-900/80 px-3 py-2 shadow-[0_10px_35px_rgba(0,0,0,0.35)]">
        <div className="mx-auto h-4 w-12 rounded-[6px] border border-cyan-400/20 bg-cyan-300/10" />
        <div className="mx-auto mt-1 h-1.5 w-4 rounded-full bg-cyan-100/20" />
        <div className="mt-2 h-3 w-14 rounded-[6px] bg-[#4c3120]" />
      </div>
      <div className="mt-1 text-center font-mono text-[9px] uppercase tracking-[0.22em] text-slate-400/70">
        {label}
      </div>
    </div>
  );
}

function IssueTicket({
  issue,
  x,
  y,
  live,
}: {
  issue: Issue;
  x: number;
  y: number;
  live: boolean;
}) {
  return (
    <Link
      to={issueUrl(issue)}
      className={cn(
        "absolute z-20 w-40 -translate-x-1/2 -translate-y-1/2 rounded-[18px] border px-3 py-2 text-left shadow-[0_18px_44px_rgba(0,0,0,0.28)] transition-transform hover:-translate-y-[55%]",
        live
          ? "border-cyan-300/25 bg-cyan-400/[0.11] text-cyan-50"
          : "border-white/10 bg-slate-900/85 text-slate-100",
      )}
      style={{ left: `${x}%`, top: `${y}%` }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[10px] font-semibold uppercase tracking-[0.22em]">
          {issue.identifier ?? issue.id.slice(0, 8)}
        </span>
        <span className="rounded-full bg-black/25 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.18em]">
          {formatStatusLabel(issue.status)}
        </span>
      </div>
      <p className="mt-1 line-clamp-2 text-xs leading-relaxed opacity-85">{issue.title}</p>
    </Link>
  );
}

function AgentMarker({ state }: { state: OfficeAgentState }) {
  const zoneTone = markerTone(state.zoneId);

  return (
    <Link
      to={agentUrl(state.agent)}
      className="absolute z-30 block -translate-x-1/2 -translate-y-1/2 transition-all duration-700 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      style={{ left: `${state.position.x}%`, top: `${state.position.y}%` }}
    >
      <div className="flex flex-col items-center gap-2">
        <div
          className={cn(
            "office-agent-sprite relative flex h-16 w-14 items-end justify-center",
            state.motion === "walk" ? "office-agent-walk" : state.motion === "alert" ? "office-agent-alert" : "office-agent-float",
          )}
        >
          <span className={cn("absolute inset-x-3 bottom-1 h-2 rounded-full blur-md", zoneTone.shadow)} />
          <span className={cn("absolute bottom-10 h-4 w-4 rounded-[6px] border", zoneTone.head)} />
          <span className={cn("absolute bottom-2 h-10 w-5 rounded-t-[6px] border", zoneTone.body)} />
          <span className={cn("absolute bottom-8 left-1 h-1.5 w-4 rounded-full", zoneTone.accent)} />
          {state.liveRun ? (
            <span className="absolute right-0 top-0 flex h-5 w-5 items-center justify-center rounded-full border border-emerald-300/30 bg-emerald-400/15 text-[10px] text-emerald-50">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300/40" />
              <span className="relative h-2 w-2 rounded-full bg-emerald-300" />
            </span>
          ) : null}
        </div>
        <div className="min-w-[110px] rounded-[16px] border border-white/10 bg-slate-950/88 px-3 py-2 text-center shadow-[0_16px_36px_rgba(0,0,0,0.35)]">
          <div className="truncate text-sm font-semibold text-slate-50">{state.agent.name}</div>
          <div className="mt-1 truncate text-[10px] uppercase tracking-[0.22em] text-slate-400">
            {state.agent.role}
          </div>
          <div className="mt-2 rounded-full bg-white/5 px-2 py-1 text-[10px] text-slate-200">
            {state.issue ? state.issue.title : fallbackZoneLabel(state.zoneId)}
          </div>
        </div>
      </div>
    </Link>
  );
}

function ActivitySnippet({ event }: { event: ActivityEvent }) {
  return (
    <div className="rounded-2xl border border-border bg-background/70 px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          {event.entityType}
        </span>
        <span className="text-xs text-muted-foreground">{relativeTime(event.createdAt)}</span>
      </div>
      <p className="mt-2 text-sm font-medium text-foreground">{humanizeActivity(event)}</p>
    </div>
  );
}

function markerTone(zoneId: OfficeZoneId) {
  if (zoneId === "approval") {
    return {
      head: "border-amber-200/60 bg-amber-300/70",
      body: "border-amber-200/60 bg-amber-500/50",
      accent: "bg-amber-100/70",
      shadow: "bg-amber-400/35",
    };
  }

  if (zoneId === "recovery") {
    return {
      head: "border-red-200/60 bg-red-300/70",
      body: "border-red-200/60 bg-red-500/50",
      accent: "bg-red-100/70",
      shadow: "bg-red-400/35",
    };
  }

  if (zoneId === "review") {
    return {
      head: "border-cyan-200/60 bg-cyan-200/75",
      body: "border-cyan-200/60 bg-cyan-500/50",
      accent: "bg-cyan-100/70",
      shadow: "bg-cyan-400/35",
    };
  }

  if (zoneId === "command") {
    return {
      head: "border-emerald-200/60 bg-emerald-200/75",
      body: "border-emerald-200/60 bg-emerald-500/55",
      accent: "bg-emerald-100/70",
      shadow: "bg-emerald-400/35",
    };
  }

  return {
    head: "border-slate-200/60 bg-slate-200/70",
    body: "border-slate-200/60 bg-violet-400/50",
    accent: "bg-slate-100/70",
    shadow: "bg-slate-300/25",
  };
}

function fallbackZoneLabel(zoneId: OfficeZoneId): string {
  if (zoneId === "command") return "지휘 보드 순찰 중";
  if (zoneId === "approval") return "승인 대기 중";
  if (zoneId === "recovery") return "복구 구역 대기";
  if (zoneId === "review") return "검토 테이블 정리";
  if (zoneId === "desks") return "집중 데스크 작업";
  return "다음 작업 준비";
}

function humanizeActivity(event: ActivityEvent): string {
  const entity = event.entityType === "issue" ? "이슈"
    : event.entityType === "agent" ? "에이전트"
    : event.entityType === "approval" ? "승인"
    : "항목";
  const action = event.action.replaceAll("_", " ");
  return `${entity}에서 ${action} 변화가 있었습니다.`;
}
