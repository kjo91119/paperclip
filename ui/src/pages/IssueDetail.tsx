import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { pickTextColorForPillBg } from "@/lib/color-contrast";
import { Link, useLocation, useNavigate, useParams } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { issuesApi } from "../api/issues";
import { meetingsApi } from "../api/meetings";
import { activityApi } from "../api/activity";
import { heartbeatsApi } from "../api/heartbeats";
import { agentsApi } from "../api/agents";
import { authApi } from "../api/auth";
import { projectsApi } from "../api/projects";
import { useCompany } from "../context/CompanyContext";
import { usePanel } from "../context/PanelContext";
import { useToast } from "../context/ToastContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { assigneeValueFromSelection, suggestedCommentAssigneeValue } from "../lib/assignees";
import { queryKeys } from "../lib/queryKeys";
import { createIssueDetailPath, readIssueDetailBreadcrumb } from "../lib/issueDetailBreadcrumb";
import {
  applyOptimisticIssueCommentUpdate,
  createOptimisticIssueComment,
  isQueuedIssueComment,
  mergeIssueComments,
  upsertIssueComment,
  type IssueCommentReassignment,
  type OptimisticIssueComment,
} from "../lib/optimistic-issue-comments";
import { useProjectOrder } from "../hooks/useProjectOrder";
import { relativeTime, cn, formatPriorityLabel, formatStatusLabel, formatTokens, visibleRunCostUsd } from "../lib/utils";
import { InlineEditor } from "../components/InlineEditor";
import { CommentThread } from "../components/CommentThread";
import { MeetingRoomPanel } from "../components/MeetingRoomPanel";
import { IssueDocumentsSection } from "../components/IssueDocumentsSection";
import { IssueProperties } from "../components/IssueProperties";
import { IssueWorkspaceCard } from "../components/IssueWorkspaceCard";
import { LiveRunWidget } from "../components/LiveRunWidget";
import type { MentionOption } from "../components/MarkdownEditor";
import { ScrollToBottom } from "../components/ScrollToBottom";
import { StatusIcon } from "../components/StatusIcon";
import { PriorityIcon } from "../components/PriorityIcon";
import { StatusBadge } from "../components/StatusBadge";
import { Identity } from "../components/Identity";
import { PluginSlotMount, PluginSlotOutlet, usePluginSlots } from "@/plugins/slots";
import { PluginLauncherOutlet } from "@/plugins/launchers";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Activity as ActivityIcon,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  EyeOff,
  Hexagon,
  ListTree,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Repeat,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import type { ActivityEvent } from "@paperclipai/shared";
import type { Agent, Issue, IssueAttachment, IssueComment } from "@paperclipai/shared";

type CommentReassignment = IssueCommentReassignment;
type IssueDetailComment = (IssueComment | OptimisticIssueComment) & {
  runId?: string | null;
  runAgentId?: string | null;
  interruptedRunId?: string | null;
  queueState?: "queued";
  queueTargetRunId?: string | null;
};

const ACTION_LABELS: Record<string, string> = {
  "issue.created": "이 이슈를 만들었습니다",
  "issue.updated": "이 이슈를 수정했습니다",
  "issue.checked_out": "이 이슈를 체크아웃했습니다",
  "issue.released": "이 이슈를 릴리스했습니다",
  "issue.comment_added": "댓글을 남겼습니다",
  "issue.attachment_added": "첨부파일을 추가했습니다",
  "issue.attachment_removed": "첨부파일을 제거했습니다",
  "issue.document_created": "문서를 만들었습니다",
  "issue.document_updated": "문서를 수정했습니다",
  "issue.document_deleted": "문서를 삭제했습니다",
  "issue.deleted": "이 이슈를 삭제했습니다",
  "agent.created": "에이전트를 만들었습니다",
  "agent.updated": "에이전트를 수정했습니다",
  "agent.paused": "에이전트를 일시중지했습니다",
  "agent.resumed": "에이전트를 다시 시작했습니다",
  "agent.terminated": "에이전트를 종료했습니다",
  "heartbeat.invoked": "하트비트를 실행했습니다",
  "heartbeat.cancelled": "하트비트를 취소했습니다",
  "approval.created": "승인을 요청했습니다",
  "approval.approved": "승인했습니다",
  "approval.rejected": "거절했습니다",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function usageNumber(usage: Record<string, unknown> | null, ...keys: string[]) {
  if (!usage) return 0;
  for (const key of keys) {
    const value = usage[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "\u2026";
}

function isMarkdownFile(file: File) {
  const name = file.name.toLowerCase();
  return (
    name.endsWith(".md") ||
    name.endsWith(".markdown") ||
    file.type === "text/markdown"
  );
}

function fileBaseName(filename: string) {
  return filename.replace(/\.[^.]+$/, "");
}

function slugifyDocumentKey(input: string) {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "document";
}

function titleizeFilename(input: string) {
  return input
    .split(/[-_ ]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatAction(action: string, details?: Record<string, unknown> | null): string {
  if (action === "issue.updated" && details) {
    const previous = (details._previous ?? {}) as Record<string, unknown>;
    const parts: string[] = [];

    if (details.status !== undefined) {
      const from = previous.status;
      parts.push(
        from
          ? `상태를 ${formatStatusLabel(String(from))}에서 ${formatStatusLabel(String(details.status))}로 변경했습니다`
          : `상태를 ${formatStatusLabel(String(details.status))}로 변경했습니다`
      );
    }
    if (details.priority !== undefined) {
      const from = previous.priority;
      parts.push(
        from
          ? `우선순위를 ${formatPriorityLabel(String(from))}에서 ${formatPriorityLabel(String(details.priority))}로 변경했습니다`
          : `우선순위를 ${formatPriorityLabel(String(details.priority))}로 변경했습니다`
      );
    }
    if (details.assigneeAgentId !== undefined || details.assigneeUserId !== undefined) {
      parts.push(
        details.assigneeAgentId || details.assigneeUserId
          ? "담당자를 지정했습니다"
          : "담당자를 해제했습니다",
      );
    }
    if (details.title !== undefined) parts.push("제목을 수정했습니다");
    if (details.description !== undefined) parts.push("설명을 수정했습니다");

    if (parts.length > 0) return parts.join(", ");
  }
  if (
    (action === "issue.document_created" || action === "issue.document_updated" || action === "issue.document_deleted") &&
    details
  ) {
    const key = typeof details.key === "string" ? details.key : "document";
    const title = typeof details.title === "string" && details.title ? ` (${details.title})` : "";
    return `${ACTION_LABELS[action] ?? action} ${key}${title}`;
  }
  return ACTION_LABELS[action] ?? action.replace(/[._]/g, " ");
}

function ActorIdentity({ evt, agentMap }: { evt: ActivityEvent; agentMap: Map<string, Agent> }) {
  const id = evt.actorId;
  if (evt.actorType === "agent") {
    const agent = agentMap.get(id);
    return <Identity name={agent?.name ?? id.slice(0, 8)} size="sm" />;
  }
  if (evt.actorType === "system") return <Identity name="시스템" size="sm" />;
  if (evt.actorType === "user") return <Identity name="보드" size="sm" />;
  return <Identity name={id || "알 수 없음"} size="sm" />;
}

export function IssueDetail() {
  const { issueId } = useParams<{ issueId: string }>();
  const { selectedCompanyId } = useCompany();
  const { openPanel, closePanel, panelVisible, setPanelVisible } = usePanel();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const { pushToast } = useToast();
  const [moreOpen, setMoreOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mobilePropsOpen, setMobilePropsOpen] = useState(false);
  const [detailTab, setDetailTab] = useState("comments");
  const [secondaryOpen, setSecondaryOpen] = useState({
    approvals: false,
  });
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [attachmentDragActive, setAttachmentDragActive] = useState(false);
  const [optimisticComments, setOptimisticComments] = useState<OptimisticIssueComment[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastMarkedReadIssueIdRef = useRef<string | null>(null);

  const { data: issue, isLoading, error } = useQuery({
    queryKey: queryKeys.issues.detail(issueId!),
    queryFn: () => issuesApi.get(issueId!),
    enabled: !!issueId,
  });
  const resolvedCompanyId = issue?.companyId ?? selectedCompanyId;

  const { data: comments } = useQuery({
    queryKey: queryKeys.issues.comments(issueId!),
    queryFn: () => issuesApi.listComments(issueId!),
    enabled: !!issueId && issue?.meetingMode !== "orchestrated",
  });

  const meetingRoomQuery = useQuery({
    queryKey: issue ? queryKeys.meetings.byIssue(issue.id) : ["meetings", "issue", issueId ?? "__pending__"],
    queryFn: () => meetingsApi.getByIssue(issue!.id),
    enabled: Boolean(issue?.id) && issue?.meetingMode === "orchestrated",
    refetchInterval: issue?.meetingMode === "orchestrated" ? 5000 : false,
  });

  const { data: activity } = useQuery({
    queryKey: queryKeys.issues.activity(issueId!),
    queryFn: () => activityApi.forIssue(issueId!),
    enabled: !!issueId,
  });

  const { data: linkedRuns } = useQuery({
    queryKey: queryKeys.issues.runs(issueId!),
    queryFn: () => activityApi.runsForIssue(issueId!),
    enabled: !!issueId,
    refetchInterval: 5000,
  });

  const { data: linkedApprovals } = useQuery({
    queryKey: queryKeys.issues.approvals(issueId!),
    queryFn: () => issuesApi.listApprovals(issueId!),
    enabled: !!issueId,
  });

  const { data: attachments } = useQuery({
    queryKey: queryKeys.issues.attachments(issueId!),
    queryFn: () => issuesApi.listAttachments(issueId!),
    enabled: !!issueId,
  });

  const { data: liveRuns } = useQuery({
    queryKey: queryKeys.issues.liveRuns(issueId!),
    queryFn: () => heartbeatsApi.liveRunsForIssue(issueId!),
    enabled: !!issueId,
    refetchInterval: 3000,
  });

  const { data: activeRun } = useQuery({
    queryKey: queryKeys.issues.activeRun(issueId!),
    queryFn: () => heartbeatsApi.activeRunForIssue(issueId!),
    enabled: !!issueId,
    refetchInterval: 3000,
  });

  const hasLiveRuns = (liveRuns ?? []).length > 0 || !!activeRun;
  const runningIssueRun = useMemo(
    () => (
      activeRun?.status === "running"
        ? activeRun
        : (liveRuns ?? []).find((run) => run.status === "running") ?? null
    ),
    [activeRun, liveRuns],
  );
  const sourceBreadcrumb = useMemo(
    () => readIssueDetailBreadcrumb(location.state, location.search) ?? { label: "이슈", href: "/issues" },
    [location.state, location.search],
  );

  // Filter out runs already shown by the live widget to avoid duplication
  const timelineRuns = useMemo(() => {
    const liveIds = new Set<string>();
    for (const r of liveRuns ?? []) liveIds.add(r.id);
    if (activeRun) liveIds.add(activeRun.id);
    if (liveIds.size === 0) return linkedRuns ?? [];
    return (linkedRuns ?? []).filter((r) => !liveIds.has(r.runId));
  }, [linkedRuns, liveRuns, activeRun]);

  const { data: allIssues } = useQuery({
    queryKey: queryKeys.issues.list(selectedCompanyId!),
    queryFn: () => issuesApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: session } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
  });

  const { data: projects } = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId!),
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const currentUserId = session?.user?.id ?? session?.session?.userId ?? null;
  const { orderedProjects } = useProjectOrder({
    projects: projects ?? [],
    companyId: selectedCompanyId,
    userId: currentUserId,
  });
  const { slots: issuePluginDetailSlots } = usePluginSlots({
    slotTypes: ["detailTab"],
    entityType: "issue",
    companyId: resolvedCompanyId,
    enabled: !!resolvedCompanyId,
  });
  const issuePluginTabItems = useMemo(
    () => issuePluginDetailSlots.map((slot) => ({
      value: `plugin:${slot.pluginKey}:${slot.id}`,
      label: slot.displayName,
      slot,
    })),
    [issuePluginDetailSlots],
  );
  const activePluginTab = issuePluginTabItems.find((item) => item.value === detailTab) ?? null;

  const agentMap = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const a of agents ?? []) map.set(a.id, a);
    return map;
  }, [agents]);

  const mentionOptions = useMemo<MentionOption[]>(() => {
    const options: MentionOption[] = [];
    const activeAgents = [...(agents ?? [])]
      .filter((agent) => agent.status !== "terminated")
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const agent of activeAgents) {
      options.push({
        id: `agent:${agent.id}`,
        name: agent.name,
        kind: "agent",
        agentId: agent.id,
        agentIcon: agent.icon,
      });
    }
    for (const project of orderedProjects) {
      options.push({
        id: `project:${project.id}`,
        name: project.name,
        kind: "project",
        projectId: project.id,
        projectColor: project.color,
      });
    }
    return options;
  }, [agents, orderedProjects]);

  const childIssues = useMemo(() => {
    if (!allIssues || !issue) return [];
    return allIssues
      .filter((i) => i.parentId === issue.id)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [allIssues, issue]);

  const commentReassignOptions = useMemo(() => {
    const options: Array<{ id: string; label: string; searchText?: string }> = [];
    const activeAgents = [...(agents ?? [])]
      .filter((agent) => agent.status !== "terminated")
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const agent of activeAgents) {
      options.push({ id: `agent:${agent.id}`, label: agent.name });
    }
    if (currentUserId) {
      options.push({ id: `user:${currentUserId}`, label: "나" });
    }
    return options;
  }, [agents, currentUserId]);

  const actualAssigneeValue = useMemo(
    () => assigneeValueFromSelection(issue ?? {}),
    [issue],
  );

  const suggestedAssigneeValue = useMemo(
    () =>
      suggestedCommentAssigneeValue(
        issue ?? {},
        mergeIssueComments(comments ?? [], optimisticComments),
        currentUserId,
      ),
    [issue, comments, optimisticComments, currentUserId],
  );

  const threadComments = useMemo(
    () => mergeIssueComments(comments ?? [], optimisticComments),
    [comments, optimisticComments],
  );

  const commentsWithRunMeta = useMemo<IssueDetailComment[]>(() => {
    const activeRunStartedAt = runningIssueRun?.startedAt ?? runningIssueRun?.createdAt ?? null;
    const runMetaByCommentId = new Map<string, { runId: string; runAgentId: string | null; interruptedRunId: string | null }>();
    const agentIdByRunId = new Map<string, string>();
    for (const run of linkedRuns ?? []) {
      agentIdByRunId.set(run.runId, run.agentId);
    }
    for (const evt of activity ?? []) {
      if (evt.action !== "issue.comment_added" || !evt.runId) continue;
      const details = evt.details ?? {};
      const commentId = typeof details["commentId"] === "string" ? details["commentId"] : null;
      if (!commentId || runMetaByCommentId.has(commentId)) continue;
      const interruptedRunId =
        typeof details["interruptedRunId"] === "string" ? details["interruptedRunId"] : null;
      runMetaByCommentId.set(commentId, {
        runId: evt.runId,
        runAgentId: evt.agentId ?? agentIdByRunId.get(evt.runId) ?? null,
        interruptedRunId,
      });
    }
    return threadComments.map((comment) => {
      const meta = runMetaByCommentId.get(comment.id);
      const nextComment: IssueDetailComment = meta ? { ...comment, ...meta } : { ...comment };
      if (
        isQueuedIssueComment({
          comment: nextComment,
          activeRunStartedAt,
          runId: meta?.runId ?? nextComment.runId ?? null,
          interruptedRunId: meta?.interruptedRunId ?? nextComment.interruptedRunId ?? null,
        })
      ) {
        return {
          ...nextComment,
          queueState: "queued" as const,
          queueTargetRunId: runningIssueRun?.id ?? nextComment.queueTargetRunId ?? null,
        };
      }
      return nextComment;
    });
  }, [activity, threadComments, linkedRuns, runningIssueRun]);

  const queuedComments = useMemo(
    () => commentsWithRunMeta.filter((comment) => comment.queueState === "queued"),
    [commentsWithRunMeta],
  );

  const timelineComments = useMemo(
    () => commentsWithRunMeta.filter((comment) => comment.queueState !== "queued"),
    [commentsWithRunMeta],
  );

  const issueCostSummary = useMemo(() => {
    let input = 0;
    let output = 0;
    let cached = 0;
    let cost = 0;
    let hasCost = false;
    let hasTokens = false;

    for (const run of linkedRuns ?? []) {
      const usage = asRecord(run.usageJson);
      const result = asRecord(run.resultJson);
      const runInput = usageNumber(usage, "inputTokens", "input_tokens");
      const runOutput = usageNumber(usage, "outputTokens", "output_tokens");
      const runCached = usageNumber(
        usage,
        "cachedInputTokens",
        "cached_input_tokens",
        "cache_read_input_tokens",
      );
      const runCost = visibleRunCostUsd(usage, result);
      if (runCost > 0) hasCost = true;
      if (runInput + runOutput + runCached > 0) hasTokens = true;
      input += runInput;
      output += runOutput;
      cached += runCached;
      cost += runCost;
    }

    return {
      input,
      output,
      cached,
      cost,
      totalTokens: input + output,
      hasCost,
      hasTokens,
    };
  }, [linkedRuns]);

  const invalidateIssue = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.issues.detail(issueId!) });
    queryClient.invalidateQueries({ queryKey: queryKeys.issues.activity(issueId!) });
    queryClient.invalidateQueries({ queryKey: queryKeys.issues.runs(issueId!) });
    queryClient.invalidateQueries({ queryKey: queryKeys.issues.approvals(issueId!) });
    queryClient.invalidateQueries({ queryKey: queryKeys.issues.attachments(issueId!) });
    queryClient.invalidateQueries({ queryKey: queryKeys.issues.documents(issueId!) });
    queryClient.invalidateQueries({ queryKey: queryKeys.issues.liveRuns(issueId!) });
    queryClient.invalidateQueries({ queryKey: queryKeys.issues.activeRun(issueId!) });
    if (selectedCompanyId) {
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.list(selectedCompanyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.listMineByMe(selectedCompanyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.listTouchedByMe(selectedCompanyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.listUnreadTouchedByMe(selectedCompanyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.sidebarBadges(selectedCompanyId) });
    }
  };

  const markIssueRead = useMutation({
    mutationFn: (id: string) => issuesApi.markRead(id),
    onSuccess: () => {
      if (selectedCompanyId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.issues.listMineByMe(selectedCompanyId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.issues.listTouchedByMe(selectedCompanyId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.issues.listUnreadTouchedByMe(selectedCompanyId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.sidebarBadges(selectedCompanyId) });
      }
    },
  });

  const updateIssue = useMutation({
    mutationFn: (data: Record<string, unknown>) => issuesApi.update(issueId!, data),
    onSuccess: () => {
      invalidateIssue();
    },
  });

  const addComment = useMutation({
    mutationFn: ({ body, reopen, interrupt }: { body: string; reopen?: boolean; interrupt?: boolean }) =>
      issuesApi.addComment(issueId!, body, reopen, interrupt),
    onMutate: async ({ body, reopen, interrupt }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.issues.comments(issueId!) });
      await queryClient.cancelQueries({ queryKey: queryKeys.issues.detail(issueId!) });

      const previousIssue = queryClient.getQueryData<Issue>(queryKeys.issues.detail(issueId!));
      const queuedComment = !interrupt && runningIssueRun;
      const optimisticComment = issue
        ? createOptimisticIssueComment({
            companyId: issue.companyId,
            issueId: issue.id,
            body,
            authorUserId: currentUserId,
            clientStatus: queuedComment ? "queued" : "pending",
            queueTargetRunId: queuedComment ? runningIssueRun.id : null,
          })
        : null;

      if (optimisticComment) {
        setOptimisticComments((current) => [...current, optimisticComment]);
      }
      if (previousIssue) {
        queryClient.setQueryData(
          queryKeys.issues.detail(issueId!),
          applyOptimisticIssueCommentUpdate(previousIssue, { reopen }),
        );
      }

      return {
        optimisticCommentId: optimisticComment?.clientId ?? null,
        previousIssue,
      };
    },
    onSuccess: (comment, _variables, context) => {
      if (context?.optimisticCommentId) {
        setOptimisticComments((current) =>
          current.filter((entry) => entry.clientId !== context.optimisticCommentId),
        );
      }
      queryClient.setQueryData<IssueComment[]>(
        queryKeys.issues.comments(issueId!),
        (current) => upsertIssueComment(current, comment),
      );
    },
    onError: (err, _variables, context) => {
      if (context?.optimisticCommentId) {
        setOptimisticComments((current) =>
          current.filter((entry) => entry.clientId !== context.optimisticCommentId),
        );
      }
      if (context?.previousIssue) {
        queryClient.setQueryData(queryKeys.issues.detail(issueId!), context.previousIssue);
      }
      pushToast({
        title: "댓글 등록 실패",
        body: err instanceof Error ? err.message : "댓글을 등록하지 못했습니다.",
        tone: "error",
      });
    },
    onSettled: () => {
      invalidateIssue();
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.comments(issueId!) });
    },
  });

  const addCommentAndReassign = useMutation({
    mutationFn: ({
      body,
      reopen,
      interrupt,
      reassignment,
    }: {
      body: string;
      reopen?: boolean;
      interrupt?: boolean;
      reassignment: CommentReassignment;
    }) =>
      issuesApi.update(issueId!, {
        comment: body,
        assigneeAgentId: reassignment.assigneeAgentId,
        assigneeUserId: reassignment.assigneeUserId,
        ...(reopen ? { status: "todo" } : {}),
        ...(interrupt ? { interrupt } : {}),
      }),
    onMutate: async ({ body, reopen, reassignment, interrupt }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.issues.comments(issueId!) });
      await queryClient.cancelQueries({ queryKey: queryKeys.issues.detail(issueId!) });

      const previousIssue = queryClient.getQueryData<Issue>(queryKeys.issues.detail(issueId!));
      const queuedComment = !interrupt && runningIssueRun;
      const optimisticComment = issue
        ? createOptimisticIssueComment({
            companyId: issue.companyId,
            issueId: issue.id,
            body,
            authorUserId: currentUserId,
            clientStatus: queuedComment ? "queued" : "pending",
            queueTargetRunId: queuedComment ? runningIssueRun.id : null,
          })
        : null;

      if (optimisticComment) {
        setOptimisticComments((current) => [...current, optimisticComment]);
      }
      if (previousIssue) {
        queryClient.setQueryData(
          queryKeys.issues.detail(issueId!),
          applyOptimisticIssueCommentUpdate(previousIssue, { reopen, reassignment }),
        );
      }

      return {
        optimisticCommentId: optimisticComment?.clientId ?? null,
        previousIssue,
      };
    },
    onSuccess: (result, _variables, context) => {
      if (context?.optimisticCommentId) {
        setOptimisticComments((current) =>
          current.filter((entry) => entry.clientId !== context.optimisticCommentId),
        );
      }

      const { comment, ...nextIssue } = result;
      queryClient.setQueryData(queryKeys.issues.detail(issueId!), nextIssue);
      if (comment) {
        queryClient.setQueryData<IssueComment[]>(
          queryKeys.issues.comments(issueId!),
          (current) => upsertIssueComment(current, comment),
        );
      }
    },
    onError: (err, _variables, context) => {
      if (context?.optimisticCommentId) {
        setOptimisticComments((current) =>
          current.filter((entry) => entry.clientId !== context.optimisticCommentId),
        );
      }
      if (context?.previousIssue) {
        queryClient.setQueryData(queryKeys.issues.detail(issueId!), context.previousIssue);
      }
      pushToast({
        title: "댓글 등록 실패",
        body: err instanceof Error ? err.message : "댓글을 등록하지 못했습니다.",
        tone: "error",
      });
    },
    onSettled: () => {
      invalidateIssue();
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.comments(issueId!) });
    },
  });

  const interruptQueuedComment = useMutation({
    mutationFn: (runId: string) => heartbeatsApi.cancel(runId),
    onSuccess: () => {
      invalidateIssue();
      pushToast({
        title: "중단을 요청했습니다",
        body: "현재 실행을 멈추고 대기 중인 댓글을 이어서 처리할 수 있도록 준비합니다.",
        tone: "success",
      });
    },
    onError: (err) => {
      pushToast({
        title: "중단 요청 실패",
        body: err instanceof Error ? err.message : "현재 실행을 중단하지 못했습니다.",
        tone: "error",
      });
    },
  });

  const uploadAttachment = useMutation({
    mutationFn: async (file: File) => {
      if (!selectedCompanyId) throw new Error("No company selected");
      return issuesApi.uploadAttachment(selectedCompanyId, issueId!, file);
    },
    onSuccess: () => {
      setAttachmentError(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.attachments(issueId!) });
      invalidateIssue();
    },
    onError: (err) => {
      setAttachmentError(err instanceof Error ? err.message : "업로드에 실패했습니다.");
    },
  });

  const importMarkdownDocument = useMutation({
    mutationFn: async (file: File) => {
      const baseName = fileBaseName(file.name);
      const key = slugifyDocumentKey(baseName);
      const existing = (issue?.documentSummaries ?? []).find((doc) => doc.key === key) ?? null;
      const body = await file.text();
      const inferredTitle = titleizeFilename(baseName);
      const nextTitle = existing?.title ?? inferredTitle ?? null;
      return issuesApi.upsertDocument(issueId!, key, {
        title: key === "plan" ? null : nextTitle,
        format: "markdown",
        body,
        baseRevisionId: existing?.latestRevisionId ?? null,
      });
    },
    onSuccess: () => {
      setAttachmentError(null);
      invalidateIssue();
    },
    onError: (err) => {
      setAttachmentError(err instanceof Error ? err.message : "문서를 가져오지 못했습니다.");
    },
  });

  const deleteAttachment = useMutation({
    mutationFn: (attachmentId: string) => issuesApi.deleteAttachment(attachmentId),
    onSuccess: () => {
      setAttachmentError(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.attachments(issueId!) });
      invalidateIssue();
    },
    onError: (err) => {
      setAttachmentError(err instanceof Error ? err.message : "삭제에 실패했습니다.");
    },
  });

  useEffect(() => {
    const titleLabel = issue?.title ?? issueId ?? "이슈";
    setBreadcrumbs([
      sourceBreadcrumb,
      { label: hasLiveRuns ? `🔵 ${titleLabel}` : titleLabel },
    ]);
  }, [setBreadcrumbs, sourceBreadcrumb, issue, issueId, hasLiveRuns]);

  // Redirect to identifier-based URL if navigated via UUID
  useEffect(() => {
    if (issue?.identifier && issueId !== issue.identifier) {
      navigate(createIssueDetailPath(issue.identifier, location.state, location.search), {
        replace: true,
        state: location.state,
      });
    }
  }, [issue, issueId, navigate, location.state, location.search]);

  useEffect(() => {
    if (!issue?.id) return;
    if (lastMarkedReadIssueIdRef.current === issue.id) return;
    lastMarkedReadIssueIdRef.current = issue.id;
    markIssueRead.mutate(issue.id);
  }, [issue?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (issue) {
      openPanel(
        <IssueProperties
          issue={issue}
          onUpdate={(data) => updateIssue.mutate(data)}
          readOnly={isOrchestratedMeeting}
        />
      );
    }
    return () => closePanel();
  }, [issue]); // eslint-disable-line react-hooks/exhaustive-deps

  const copyIssueToClipboard = async () => {
    if (!issue) return;
    const decodeEntities = (text: string) => {
      const el = document.createElement("textarea");
      el.innerHTML = text;
      return el.value;
    };
    const title = decodeEntities(issue.title);
    const body = decodeEntities(issue.description ?? "");
    const md = `# ${issue.identifier}: ${title}\n\n${body}`.trimEnd();
    await navigator.clipboard.writeText(md);
    setCopied(true);
    pushToast({ title: "클립보드에 복사했습니다", tone: "success" });
    setTimeout(() => setCopied(false), 2000);
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">불러오는 중...</p>;
  if (error) return <p className="text-sm text-destructive">{error.message}</p>;
  if (!issue) return null;

  const isOrchestratedMeeting = issue.meetingMode === "orchestrated";

  // Ancestors are returned oldest-first from the server (root at end, immediate parent at start)
  const ancestors = issue.ancestors ?? [];
  const handleFilePicked = async (evt: ChangeEvent<HTMLInputElement>) => {
    const files = evt.target.files;
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      if (isMarkdownFile(file)) {
        await importMarkdownDocument.mutateAsync(file);
      } else {
        await uploadAttachment.mutateAsync(file);
      }
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleAttachmentDrop = async (evt: DragEvent<HTMLDivElement>) => {
    evt.preventDefault();
    setAttachmentDragActive(false);
    const files = evt.dataTransfer.files;
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      if (isMarkdownFile(file)) {
        await importMarkdownDocument.mutateAsync(file);
      } else {
        await uploadAttachment.mutateAsync(file);
      }
    }
  };

  const isImageAttachment = (attachment: IssueAttachment) => attachment.contentType.startsWith("image/");
  const attachmentList = attachments ?? [];
  const hasAttachments = attachmentList.length > 0;
  const attachmentUploadButton = (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf,text/plain,text/markdown,application/json,text/csv,text/html,.md,.markdown"
        className="hidden"
        onChange={handleFilePicked}
        multiple
      />
      <Button
        variant="outline"
        size="sm"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploadAttachment.isPending || importMarkdownDocument.isPending}
        className={cn(
          "shadow-none",
          attachmentDragActive && "border-primary bg-primary/5",
        )}
      >
        <Paperclip className="h-3.5 w-3.5 mr-1.5" />
        {uploadAttachment.isPending || importMarkdownDocument.isPending ? "업로드 중..." : (
          <>
            <span className="hidden sm:inline">첨부 업로드</span>
            <span className="sm:hidden">업로드</span>
          </>
        )}
      </Button>
    </>
  );

  return (
    <div className="max-w-2xl space-y-6">
      {/* Parent chain breadcrumb */}
      {ancestors.length > 0 && (
        <nav className="flex items-center gap-1 text-xs text-muted-foreground flex-wrap">
          {[...ancestors].reverse().map((ancestor, i) => (
            <span key={ancestor.id} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3 shrink-0" />}
              <Link
                to={createIssueDetailPath(ancestor.identifier ?? ancestor.id, location.state, location.search)}
                state={location.state}
                className="hover:text-foreground transition-colors truncate max-w-[200px]"
                title={ancestor.title}
              >
                {ancestor.title}
              </Link>
            </span>
          ))}
          <ChevronRight className="h-3 w-3 shrink-0" />
          <span className="text-foreground/60 truncate max-w-[200px]">{issue.title}</span>
        </nav>
      )}

      {issue.hiddenAt && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <EyeOff className="h-4 w-4 shrink-0" />
          이 이슈는 숨김 처리되었습니다
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <StatusIcon
            status={issue.status}
            onChange={isOrchestratedMeeting ? undefined : (status) => updateIssue.mutate({ status })}
          />
          <PriorityIcon
            priority={issue.priority}
            onChange={(priority) => updateIssue.mutate({ priority })}
          />
          <span className="text-sm font-mono text-muted-foreground shrink-0">{issue.identifier ?? issue.id.slice(0, 8)}</span>

          {hasLiveRuns && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/30 px-2 py-0.5 text-[10px] font-medium text-cyan-600 dark:text-cyan-400 shrink-0">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-pulse absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-cyan-400" />
              </span>
              실행 중
            </span>
          )}

          {issue.originKind === "routine_execution" && issue.originId && (
            <Link
              to={`/routines/${issue.originId}`}
              className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 border border-violet-500/30 px-2 py-0.5 text-[10px] font-medium text-violet-600 dark:text-violet-400 shrink-0 hover:bg-violet-500/20 transition-colors"
            >
              <Repeat className="h-3 w-3" />
              루틴
            </Link>
          )}

          {issue.projectId ? (
            <Link
              to={`/projects/${issue.projectId}`}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors rounded px-1 -mx-1 py-0.5 min-w-0"
            >
              <Hexagon className="h-3 w-3 shrink-0" />
              <span className="truncate">{(projects ?? []).find((p) => p.id === issue.projectId)?.name ?? issue.projectId.slice(0, 8)}</span>
            </Link>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground opacity-50 px-1 -mx-1 py-0.5">
              <Hexagon className="h-3 w-3 shrink-0" />
              프로젝트 없음
            </span>
          )}

          {(issue.labels ?? []).length > 0 && (
            <div className="hidden sm:flex items-center gap-1">
              {(issue.labels ?? []).slice(0, 4).map((label) => (
                <span
                  key={label.id}
                  className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium"
                  style={{
                    borderColor: label.color,
                    color: pickTextColorForPillBg(label.color, 0.12),
                    backgroundColor: `${label.color}1f`,
                  }}
                >
                  {label.name}
                </span>
              ))}
              {(issue.labels ?? []).length > 4 && (
                <span className="text-[10px] text-muted-foreground">+{(issue.labels ?? []).length - 4}</span>
              )}
            </div>
          )}

          <div className="ml-auto flex items-center gap-0.5 md:hidden shrink-0">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={copyIssueToClipboard}
              title="이슈를 마크다운으로 복사"
            >
              {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setMobilePropsOpen(true)}
              title="속성"
            >
              <SlidersHorizontal className="h-4 w-4" />
            </Button>
          </div>

          <div className="hidden md:flex items-center md:ml-auto shrink-0">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={copyIssueToClipboard}
              title="이슈를 마크다운으로 복사"
            >
              {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              className={cn(
                "shrink-0 transition-opacity duration-200",
                panelVisible ? "opacity-0 pointer-events-none w-0 overflow-hidden" : "opacity-100",
              )}
              onClick={() => setPanelVisible(true)}
              title="속성 보기"
            >
              <SlidersHorizontal className="h-4 w-4" />
            </Button>

            {!isOrchestratedMeeting ? (
              <Popover open={moreOpen} onOpenChange={setMoreOpen}>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon-xs" className="shrink-0">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </PopoverTrigger>
              <PopoverContent className="w-44 p-1" align="end">
                <button
                  className="flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-accent/50 text-destructive"
                  onClick={() => {
                    updateIssue.mutate(
                      { hiddenAt: new Date().toISOString() },
                      { onSuccess: () => navigate("/issues/all") },
                    );
                    setMoreOpen(false);
                  }}
                >
                  <EyeOff className="h-3 w-3" />
                  이 이슈 숨기기
                </button>
              </PopoverContent>
              </Popover>
            ) : null}
          </div>
        </div>

        <InlineEditor
          value={issue.title}
          onSave={(title) => updateIssue.mutateAsync({ title })}
          as="h2"
          className="text-xl font-bold"
        />

        <InlineEditor
          value={issue.description ?? ""}
          onSave={(description) => updateIssue.mutateAsync({ description })}
          as="p"
          className="text-[15px] leading-7 text-foreground"
          placeholder="설명을 추가해보세요..."
          multiline
          mentions={mentionOptions}
          imageUploadHandler={async (file) => {
            const attachment = await uploadAttachment.mutateAsync(file);
            return attachment.contentPath;
          }}
        />
      </div>

      <PluginSlotOutlet
        slotTypes={["toolbarButton", "contextMenuItem"]}
        entityType="issue"
        context={{
          companyId: issue.companyId,
          projectId: issue.projectId ?? null,
          entityId: issue.id,
          entityType: "issue",
        }}
        className="flex flex-wrap gap-2"
        itemClassName="inline-flex"
        missingBehavior="placeholder"
      />

      <PluginLauncherOutlet
        placementZones={["toolbarButton"]}
        entityType="issue"
        context={{
          companyId: issue.companyId,
          projectId: issue.projectId ?? null,
          entityId: issue.id,
          entityType: "issue",
        }}
        className="flex flex-wrap gap-2"
        itemClassName="inline-flex"
      />

      <PluginSlotOutlet
        slotTypes={["taskDetailView"]}
        entityType="issue"
        context={{
          companyId: issue.companyId,
          projectId: issue.projectId ?? null,
          entityId: issue.id,
          entityType: "issue",
        }}
        className="space-y-3"
        itemClassName="rounded-lg border border-border p-3"
        missingBehavior="placeholder"
      />

      <IssueDocumentsSection
        issue={issue}
        canDeleteDocuments={Boolean(session?.user?.id)}
        mentions={mentionOptions}
        imageUploadHandler={async (file) => {
          const attachment = await uploadAttachment.mutateAsync(file);
          return attachment.contentPath;
        }}
        extraActions={!hasAttachments ? attachmentUploadButton : undefined}
      />

      {hasAttachments ? (
        <div
        className={cn(
          "space-y-3 rounded-lg transition-colors",
        )}
        onDragEnter={(evt) => {
          evt.preventDefault();
          setAttachmentDragActive(true);
        }}
        onDragOver={(evt) => {
          evt.preventDefault();
          setAttachmentDragActive(true);
        }}
        onDragLeave={(evt) => {
          if (evt.currentTarget.contains(evt.relatedTarget as Node | null)) return;
          setAttachmentDragActive(false);
        }}
        onDrop={(evt) => void handleAttachmentDrop(evt)}
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-muted-foreground">첨부파일</h3>
          {attachmentUploadButton}
        </div>

        {attachmentError && (
          <p className="text-xs text-destructive">{attachmentError}</p>
        )}

        <div className="space-y-2">
          {attachmentList.map((attachment) => (
            <div key={attachment.id} className="border border-border rounded-md p-2">
              <div className="flex items-center justify-between gap-2">
                <a
                  href={attachment.contentPath}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs hover:underline truncate"
                  title={attachment.originalFilename ?? attachment.id}
                >
                  {attachment.originalFilename ?? attachment.id}
                </a>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => deleteAttachment.mutate(attachment.id)}
                  disabled={deleteAttachment.isPending}
                  title="첨부 삭제"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {attachment.contentType} · {(attachment.byteSize / 1024).toFixed(1)} KB
              </p>
              {isImageAttachment(attachment) && (
                <a href={attachment.contentPath} target="_blank" rel="noreferrer">
                  <img
                    src={attachment.contentPath}
                    alt={attachment.originalFilename ?? "첨부 이미지"}
                    className="mt-2 max-h-56 rounded border border-border object-contain bg-accent/10"
                    loading="lazy"
                  />
                </a>
              )}
            </div>
          ))}
        </div>
        </div>
      ) : null}

      <IssueWorkspaceCard
        issue={issue}
        project={orderedProjects.find((p) => p.id === issue.projectId) ?? null}
        onUpdate={(data) => updateIssue.mutate(data)}
      />

      <Separator />

      <Tabs value={detailTab} onValueChange={setDetailTab} className="space-y-3">
        <TabsList variant="line" className="w-full justify-start gap-1">
          <TabsTrigger value="comments" className="gap-1.5">
            <MessageSquare className="h-3.5 w-3.5" />
            {issue.meetingMode === "orchestrated" ? "회의실" : "댓글"}
          </TabsTrigger>
          <TabsTrigger value="subissues" className="gap-1.5">
            <ListTree className="h-3.5 w-3.5" />
            하위 이슈
          </TabsTrigger>
          <TabsTrigger value="activity" className="gap-1.5">
            <ActivityIcon className="h-3.5 w-3.5" />
            활동
          </TabsTrigger>
          {issuePluginTabItems.map((item) => (
            <TabsTrigger key={item.value} value={item.value}>
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="comments">
          {issue.meetingMode === "orchestrated" ? (
            meetingRoomQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">회의실을 불러오는 중...</p>
            ) : meetingRoomQuery.error instanceof Error ? (
              <p className="text-sm text-destructive">{meetingRoomQuery.error.message}</p>
            ) : meetingRoomQuery.data ? (
              <MeetingRoomPanel issue={issue} room={meetingRoomQuery.data} agentById={agentMap} />
            ) : (
              <p className="text-sm text-muted-foreground">회의실 데이터를 찾지 못했습니다.</p>
            )
          ) : (
            <CommentThread
              comments={timelineComments}
              queuedComments={queuedComments}
              linkedRuns={timelineRuns}
              companyId={issue.companyId}
              projectId={issue.projectId}
              issueStatus={issue.status}
              agentMap={agentMap}
              draftKey={`paperclip:issue-comment-draft:${issue.id}`}
              enableReassign
              reassignOptions={commentReassignOptions}
              currentAssigneeValue={actualAssigneeValue}
              suggestedAssigneeValue={suggestedAssigneeValue}
              mentions={mentionOptions}
              onInterruptQueued={async (runId) => {
                await interruptQueuedComment.mutateAsync(runId);
              }}
              interruptingQueuedRunId={interruptQueuedComment.isPending ? runningIssueRun?.id ?? null : null}
              onAdd={async (body, reopen, reassignment) => {
                if (reassignment) {
                  await addCommentAndReassign.mutateAsync({ body, reopen, reassignment });
                  return;
                }
                await addComment.mutateAsync({ body, reopen });
              }}
              imageUploadHandler={async (file) => {
                const attachment = await uploadAttachment.mutateAsync(file);
                return attachment.contentPath;
              }}
              onAttachImage={async (file) => {
                await uploadAttachment.mutateAsync(file);
              }}
              liveRunSlot={<LiveRunWidget issueId={issueId!} companyId={issue.companyId} />}
            />
          )}
        </TabsContent>

        <TabsContent value="subissues">
          {childIssues.length === 0 ? (
            <p className="text-xs text-muted-foreground">하위 이슈가 없습니다.</p>
          ) : (
            <div className="border border-border rounded-lg divide-y divide-border">
              {childIssues.map((child) => (
                <Link
                  key={child.id}
                  to={createIssueDetailPath(child.identifier ?? child.id, location.state, location.search)}
                  state={location.state}
                  className="flex items-center justify-between px-3 py-2 text-sm hover:bg-accent/20 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <StatusIcon status={child.status} />
                    <PriorityIcon priority={child.priority} />
                    <span className="font-mono text-muted-foreground shrink-0">
                      {child.identifier ?? child.id.slice(0, 8)}
                    </span>
                    <span className="truncate">{child.title}</span>
                  </div>
                  {child.assigneeAgentId && (() => {
                    const name = agentMap.get(child.assigneeAgentId)?.name;
                    return name
                      ? <Identity name={name} size="sm" />
                      : <span className="text-muted-foreground font-mono">{child.assigneeAgentId.slice(0, 8)}</span>;
                  })()}
                </Link>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="activity">
          {linkedRuns && linkedRuns.length > 0 && (
            <div className="mb-3 px-3 py-2 rounded-lg border border-border">
              <div className="text-sm font-medium text-muted-foreground mb-1">비용 요약</div>
              {!issueCostSummary.hasCost && !issueCostSummary.hasTokens ? (
                <div className="text-xs text-muted-foreground">아직 비용 데이터가 없습니다.</div>
              ) : (
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground tabular-nums">
                  {issueCostSummary.hasCost && (
                    <span className="font-medium text-foreground">
                      ${issueCostSummary.cost.toFixed(4)}
                    </span>
                  )}
                  {issueCostSummary.hasTokens && (
                    <span>
                      토큰 {formatTokens(issueCostSummary.totalTokens)}
                      {issueCostSummary.cached > 0
                        ? ` (입력 ${formatTokens(issueCostSummary.input)}, 출력 ${formatTokens(issueCostSummary.output)}, 캐시 ${formatTokens(issueCostSummary.cached)})`
                        : ` (입력 ${formatTokens(issueCostSummary.input)}, 출력 ${formatTokens(issueCostSummary.output)})`}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
          {!activity || activity.length === 0 ? (
            <p className="text-xs text-muted-foreground">아직 활동이 없습니다.</p>
          ) : (
            <div className="space-y-1.5">
              {activity.slice(0, 20).map((evt) => (
                <div key={evt.id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <ActorIdentity evt={evt} agentMap={agentMap} />
                  <span>{formatAction(evt.action, evt.details)}</span>
                  <span className="ml-auto shrink-0">{relativeTime(evt.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {activePluginTab && (
          <TabsContent value={activePluginTab.value}>
            <PluginSlotMount
              slot={activePluginTab.slot}
              context={{
                companyId: issue.companyId,
                projectId: issue.projectId ?? null,
                entityId: issue.id,
                entityType: "issue",
              }}
              missingBehavior="placeholder"
            />
          </TabsContent>
        )}
      </Tabs>

      {linkedApprovals && linkedApprovals.length > 0 && (
        <Collapsible
          open={secondaryOpen.approvals}
          onOpenChange={(open) => setSecondaryOpen((prev) => ({ ...prev, approvals: open }))}
          className="rounded-lg border border-border"
        >
          <CollapsibleTrigger className="flex w-full items-center justify-between px-3 py-2 text-left">
            <span className="text-sm font-medium text-muted-foreground">
              연결된 승인 ({linkedApprovals.length})
            </span>
            <ChevronDown
              className={cn("h-4 w-4 text-muted-foreground transition-transform", secondaryOpen.approvals && "rotate-180")}
            />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="border-t border-border divide-y divide-border">
              {linkedApprovals.map((approval) => (
                <Link
                  key={approval.id}
                  to={`/approvals/${approval.id}`}
                  className="flex items-center justify-between px-3 py-2 text-xs hover:bg-accent/20 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <StatusBadge status={approval.status} />
                    <span className="font-medium">
                      {approval.type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                    </span>
                    <span className="font-mono text-muted-foreground">{approval.id.slice(0, 8)}</span>
                  </div>
                  <span className="text-muted-foreground">{relativeTime(approval.createdAt)}</span>
                </Link>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}


      {/* Mobile properties drawer */}
      <Sheet open={mobilePropsOpen} onOpenChange={setMobilePropsOpen}>
        <SheetContent side="bottom" className="max-h-[85dvh] pb-[env(safe-area-inset-bottom)]">
          <SheetHeader>
            <SheetTitle className="text-sm">속성</SheetTitle>
          </SheetHeader>
          <ScrollArea className="flex-1 overflow-y-auto">
            <div className="px-4 pb-4">
              <IssueProperties
                issue={issue}
                onUpdate={(data) => updateIssue.mutate(data)}
                inline
                readOnly={isOrchestratedMeeting}
              />
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>
      <ScrollToBottom />
    </div>
  );
}
