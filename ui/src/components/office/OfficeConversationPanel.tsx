import { useMemo, type ReactNode, type RefObject } from "react";
import { Link } from "@/lib/router";
import type { Agent, Issue, IssueComment, Project } from "@paperclipai/shared";
import {
  ArrowUpRight,
  Bot,
  ChevronLeft,
  Copy,
  FolderKanban,
  MessageSquare,
  PanelsTopLeft,
  Send,
  Sparkles,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { MarkdownBody } from "../MarkdownBody";
import { LiveRunWidget } from "../LiveRunWidget";
import { cn, formatDateTime, formatStatusLabel, issueUrl, projectUrl, relativeTime } from "../../lib/utils";
import {
  extractOfficeMeetingParticipantIds,
  getOfficeConversationPreview,
  officeIssueActivityTimestamp,
  type OfficeAgentState,
  type OfficeConversationMode,
} from "../../pages/officeViewModel";

export interface OfficeTemplateAction {
  label: string;
  onApply: () => void;
}

export interface OfficeSendSummaryRow {
  label: string;
  value: string;
}

export function OfficeConversationPanel({
  companyId,
  mode,
  onModeChange,
  sceneCollapsed,
  onToggleScene,
  agentStates,
  agentById,
  selectedAgentId,
  onSelectAgent,
  threadIssues,
  selectedThreadIssue,
  onSelectThread,
  threadComments,
  threadCommentsLoading,
  threadCommentsError,
  selectedProject,
  selectedProjectId,
  projects,
  onSelectProject,
  onOpenNewProject,
  messageTitle,
  onChangeTitle,
  messageBody,
  onChangeBody,
  messageBodyRef,
  composerOptionsOpen,
  onComposerOptionsOpenChange,
  templates,
  referencePath,
  onChangeReferencePath,
  effectiveReferencePath,
  windowsReferencePath,
  selectedProjectPath,
  onCopyWslPath,
  onCopyWindowsPath,
  onUseProjectPath,
  hasReferencePathMismatch,
  selectedAgentState,
  selectedConversationReasonLabel,
  meetingParticipants,
  selectedMeetingParticipants,
  otherAgents,
  onToggleMeetingParticipant,
  onSelectAllMeetingParticipants,
  onClearMeetingParticipants,
  sendSummary,
  onCommentCurrentThread,
  onCreateIssue,
  canCommentCurrentThread,
  canCreateIssue,
  isSending,
  lastTouchedIssue,
}: {
  companyId: string;
  mode: OfficeConversationMode;
  onModeChange: (mode: OfficeConversationMode) => void;
  sceneCollapsed: boolean;
  onToggleScene: () => void;
  agentStates: OfficeAgentState[];
  agentById: Map<string, Agent>;
  selectedAgentId: string;
  onSelectAgent: (agentId: string) => void;
  threadIssues: Issue[];
  selectedThreadIssue: Issue | null;
  onSelectThread: (issueId: string) => void;
  threadComments: IssueComment[];
  threadCommentsLoading: boolean;
  threadCommentsError: string | null;
  selectedProject: Project | null;
  selectedProjectId: string;
  projects: Project[];
  onSelectProject: (projectId: string) => void;
  onOpenNewProject: () => void;
  messageTitle: string;
  onChangeTitle: (value: string) => void;
  messageBody: string;
  onChangeBody: (value: string) => void;
  messageBodyRef: RefObject<HTMLTextAreaElement | null>;
  composerOptionsOpen: boolean;
  onComposerOptionsOpenChange: (open: boolean) => void;
  templates: OfficeTemplateAction[];
  referencePath: string;
  onChangeReferencePath: (value: string) => void;
  effectiveReferencePath: string;
  windowsReferencePath: string | null;
  selectedProjectPath: string;
  onCopyWslPath: () => void;
  onCopyWindowsPath: () => void;
  onUseProjectPath: () => void;
  hasReferencePathMismatch: boolean;
  selectedAgentState: OfficeAgentState | null;
  selectedConversationReasonLabel: string | null;
  meetingParticipants: Agent[];
  selectedMeetingParticipants: Agent[];
  otherAgents: OfficeAgentState[];
  onToggleMeetingParticipant: (agentId: string) => void;
  onSelectAllMeetingParticipants: () => void;
  onClearMeetingParticipants: () => void;
  sendSummary: OfficeSendSummaryRow[];
  onCommentCurrentThread: () => void;
  onCreateIssue: () => void;
  canCommentCurrentThread: boolean;
  canCreateIssue: boolean;
  isSending: boolean;
  lastTouchedIssue: Issue | null;
}) {
  const selectedThreadProject = useMemo(() => {
    if (!selectedThreadIssue?.projectId) return null;
    return projects.find((project) => project.id === selectedThreadIssue.projectId) ?? null;
  }, [projects, selectedThreadIssue?.projectId]);

  const threadEntries = useMemo(() => {
    if (!selectedThreadIssue) return [];

    const entries: Array<{
      id: string;
      body: string;
      authorAgentId: string | null;
      authorUserId: string | null;
      createdAt: Date | string;
      kind: "description" | "comment";
    }> = [];

    if (selectedThreadIssue.description?.trim()) {
      entries.push({
        id: `${selectedThreadIssue.id}:description`,
        body: selectedThreadIssue.description,
        authorAgentId: selectedThreadIssue.createdByAgentId,
        authorUserId: selectedThreadIssue.createdByUserId,
        createdAt: selectedThreadIssue.createdAt,
        kind: "description",
      });
    }

    for (const comment of threadComments) {
      entries.push({
        id: comment.id,
        body: comment.body,
        authorAgentId: comment.authorAgentId,
        authorUserId: comment.authorUserId,
        createdAt: comment.createdAt,
        kind: "comment",
      });
    }

    return entries.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [selectedThreadIssue, threadComments]);

  return (
    <section className="rounded-[30px] border border-border bg-card shadow-[0_24px_80px_rgba(0,0,0,0.14)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div className="space-y-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            AI Company Messenger
          </div>
          <h2 className="text-sm font-semibold text-foreground">대화 패널</h2>
          <p className="max-w-3xl text-xs text-muted-foreground">
            이슈/댓글 모델은 유지한 채, 에이전트 DM과 전체회의를 채팅형으로 렌더링합니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onToggleScene}>
            <PanelsTopLeft className="mr-1 h-3.5 w-3.5" />
            {sceneCollapsed ? "2D 오피스 펼치기" : "2D 오피스 접기"}
          </Button>
          {selectedThreadIssue ? (
            <Link
              to={issueUrl(selectedThreadIssue)}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-accent"
            >
              이슈 상세 열기
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          ) : null}
        </div>
      </div>

      <div className="border-b border-border px-5 py-3">
        <div className="flex flex-wrap gap-2">
          {agentStates.map((state) => {
            const selected = mode === "direct" && selectedAgentId === state.agent.id;
            const live = Boolean(state.liveRun);
            return (
              <button
                key={state.agent.id}
                type="button"
                onClick={() => {
                  onModeChange("direct");
                  onSelectAgent(state.agent.id);
                }}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-medium transition-colors",
                  selected
                    ? "border-cyan-400/40 bg-cyan-400/10 text-foreground"
                    : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <span className={cn("h-2 w-2 rounded-full", live ? "bg-emerald-400" : "bg-muted-foreground/40")} />
                {state.agent.name}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => onModeChange("meeting")}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-medium transition-colors",
              mode === "meeting"
                ? "border-cyan-400/40 bg-cyan-400/10 text-foreground"
                : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Users className="h-3.5 w-3.5" />
            전체회의
          </button>
        </div>
      </div>

      <div className="grid gap-5 px-5 py-5 xl:grid-cols-[18rem_minmax(0,1fr)]">
        <div className="space-y-4">
          <ConversationSelectionCard
            mode={mode}
            selectedAgentState={selectedAgentState}
            meetingParticipants={meetingParticipants}
            otherAgents={otherAgents}
            selectedMeetingParticipants={selectedMeetingParticipants}
            onToggleMeetingParticipant={onToggleMeetingParticipant}
            onSelectAllMeetingParticipants={onSelectAllMeetingParticipants}
            onClearMeetingParticipants={onClearMeetingParticipants}
          />

          <ThreadList
            mode={mode}
            issues={threadIssues}
            selectedIssueId={selectedThreadIssue?.id ?? null}
            onSelectIssue={onSelectThread}
          />
        </div>

        <div className="space-y-4">
          <ThreadHeader
            mode={mode}
            issue={selectedThreadIssue}
            agentById={agentById}
            selectedProject={selectedThreadProject}
            selectedConversationReasonLabel={selectedConversationReasonLabel}
          />

          <ThreadTimeline
            companyId={companyId}
            issue={selectedThreadIssue}
            entries={threadEntries}
            commentsLoading={threadCommentsLoading}
            commentsError={threadCommentsError}
            agentById={agentById}
          />

          {selectedThreadIssue ? (
            <LiveRunWidget issueId={selectedThreadIssue.id} companyId={companyId} />
          ) : null}

          <OfficeComposer
            mode={mode}
            selectedThreadIssue={selectedThreadIssue}
            selectedProject={selectedProject}
            selectedProjectId={selectedProjectId}
            projects={projects}
            onSelectProject={onSelectProject}
            onOpenNewProject={onOpenNewProject}
            messageTitle={messageTitle}
            onChangeTitle={onChangeTitle}
            messageBody={messageBody}
            onChangeBody={onChangeBody}
            messageBodyRef={messageBodyRef}
            composerOptionsOpen={composerOptionsOpen}
            onComposerOptionsOpenChange={onComposerOptionsOpenChange}
            templates={templates}
            referencePath={referencePath}
            onChangeReferencePath={onChangeReferencePath}
            effectiveReferencePath={effectiveReferencePath}
            windowsReferencePath={windowsReferencePath}
            selectedProjectPath={selectedProjectPath}
            onCopyWslPath={onCopyWslPath}
            onCopyWindowsPath={onCopyWindowsPath}
            onUseProjectPath={onUseProjectPath}
            hasReferencePathMismatch={hasReferencePathMismatch}
            sendSummary={sendSummary}
            onCommentCurrentThread={onCommentCurrentThread}
            onCreateIssue={onCreateIssue}
            canCommentCurrentThread={canCommentCurrentThread}
            canCreateIssue={canCreateIssue}
            isSending={isSending}
            lastTouchedIssue={lastTouchedIssue}
          />
        </div>
      </div>
    </section>
  );
}

function ConversationSelectionCard({
  mode,
  selectedAgentState,
  meetingParticipants,
  otherAgents,
  selectedMeetingParticipants,
  onToggleMeetingParticipant,
  onSelectAllMeetingParticipants,
  onClearMeetingParticipants,
}: {
  mode: OfficeConversationMode;
  selectedAgentState: OfficeAgentState | null;
  meetingParticipants: Agent[];
  otherAgents: OfficeAgentState[];
  selectedMeetingParticipants: Agent[];
  onToggleMeetingParticipant: (agentId: string) => void;
  onSelectAllMeetingParticipants: () => void;
  onClearMeetingParticipants: () => void;
}) {
  return (
    <div className="rounded-[24px] border border-border bg-background/70 px-4 py-4">
      {mode === "meeting" ? (
        <div className="space-y-3">
          <div>
            <div className="text-sm font-semibold text-foreground">전체회의 준비</div>
            <p className="mt-1 text-xs text-muted-foreground">
              진행자 1명은 실제 assignee로 유지하고, 나머지는 멘션 참가자로 회의 이슈에 포함합니다.
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-card px-3 py-3 text-sm text-foreground">
            <div className="font-medium">진행자</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {selectedAgentState ? `${selectedAgentState.agent.name} · ${selectedAgentState.agent.role}` : "진행자를 선택하세요"}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" disabled={otherAgents.length === 0} onClick={onSelectAllMeetingParticipants}>
              전체 초대
            </Button>
            <Button variant="ghost" size="sm" disabled={selectedMeetingParticipants.length === 0} onClick={onClearMeetingParticipants}>
              선택 해제
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {otherAgents.map((state) => {
              const selected = selectedMeetingParticipants.some((agent) => agent.id === state.agent.id);
              return (
                <button
                  key={state.agent.id}
                  type="button"
                  onClick={() => onToggleMeetingParticipant(state.agent.id)}
                  className={cn(
                    "rounded-full border px-3 py-2 text-xs font-medium transition-colors",
                    selected
                      ? "border-cyan-400/40 bg-cyan-400/10 text-foreground"
                      : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {state.agent.name}
                </button>
              );
            })}
          </div>
          <div className="rounded-2xl border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
            {meetingParticipants.length >= 2
              ? `현재 ${meetingParticipants.map((agent) => agent.name).join(", ")} 참여 예정`
              : "전체회의는 진행자를 포함해 최소 두 명 이상이 필요합니다."}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-sm font-semibold text-foreground">현재 대화 대상</div>
          {selectedAgentState ? (
            <>
              <div className="flex items-center gap-2">
                <span className={cn("h-2.5 w-2.5 rounded-full", selectedAgentState.liveRun ? "bg-emerald-400" : "bg-muted-foreground/40")} />
                <span className="font-medium text-foreground">{selectedAgentState.agent.name}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  {selectedAgentState.agent.role}
                </span>
              </div>
              <div className="rounded-2xl border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
                {selectedAgentState.issue ? selectedAgentState.issue.title : "열린 이슈 없이 다음 작업을 기다리는 상태입니다."}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">에이전트를 선택하면 현재 열린 스레드와 상태를 보여줍니다.</p>
          )}
        </div>
      )}
    </div>
  );
}

function ThreadList({
  mode,
  issues,
  selectedIssueId,
  onSelectIssue,
}: {
  mode: OfficeConversationMode;
  issues: Issue[];
  selectedIssueId: string | null;
  onSelectIssue: (issueId: string) => void;
}) {
  return (
    <div className="rounded-[24px] border border-border bg-background/70">
      <div className="border-b border-border px-4 py-3">
        <div className="text-sm font-semibold text-foreground">
          {mode === "meeting" ? "회의 목록" : "대화 스레드"}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {mode === "meeting"
            ? "회의 형식 규약이 들어간 이슈를 채팅형으로 엽니다."
            : "서로 다른 이슈의 댓글을 합치지 않고, 각 이슈를 독립된 대화로 취급합니다."}
        </p>
      </div>
      <ScrollArea className="h-[340px]">
        <div className="space-y-2 p-3">
          {issues.length > 0 ? (
            issues.map((issue) => {
              const selected = selectedIssueId === issue.id;
              return (
                <button
                  key={issue.id}
                  type="button"
                  onClick={() => onSelectIssue(issue.id)}
                  className={cn(
                    "w-full rounded-2xl border px-3 py-3 text-left transition-colors",
                    selected
                      ? "border-cyan-400/40 bg-cyan-400/10 text-foreground"
                      : "border-border bg-card text-foreground hover:bg-accent/60",
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-xs text-muted-foreground">
                      {issue.identifier ?? issue.id.slice(0, 8)}
                    </span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      {formatStatusLabel(issue.status)}
                    </span>
                  </div>
                  <div className="mt-2 line-clamp-2 text-sm font-medium">{issue.title}</div>
                  <div className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                    {getOfficeConversationPreview(issue)}
                  </div>
                  <div className="mt-2 text-[11px] text-muted-foreground">
                    {relativeTime(issue.lastExternalCommentAt ?? issue.updatedAt)}
                  </div>
                </button>
              );
            })
          ) : (
            <div className="rounded-2xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
              {mode === "meeting"
                ? "아직 회의 이슈가 없습니다. 아래에서 새 회의를 시작할 수 있습니다."
                : "이 에이전트에게 열린 이슈가 없습니다. 아래에서 새 대화를 시작해보세요."}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function ThreadHeader({
  mode,
  issue,
  agentById,
  selectedProject,
  selectedConversationReasonLabel,
}: {
  mode: OfficeConversationMode;
  issue: Issue | null;
  agentById: Map<string, Agent>;
  selectedProject: Project | null;
  selectedConversationReasonLabel: string | null;
}) {
  if (!issue) {
    return (
      <div className="rounded-[24px] border border-border bg-background/70 px-4 py-4">
        <div className="text-sm font-semibold text-foreground">
          {mode === "meeting" ? "회의를 선택하거나 새로 시작하세요" : "대화를 선택하거나 새로 시작하세요"}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {mode === "meeting"
            ? "진행자와 참가자를 정한 뒤 새 회의 이슈를 만들면 여기서 그룹 채팅처럼 이어집니다."
            : "새 이슈를 만들면 이후 댓글이 채팅처럼 이어지고, 자세한 작업 화면은 이슈 상세에서 볼 수 있습니다."}
        </p>
      </div>
    );
  }

  const facilitatorName = issue.assigneeAgentId ? agentById.get(issue.assigneeAgentId)?.name ?? issue.assigneeAgentId : null;
  const participantNames = extractOfficeMeetingParticipantIds(issue)
    .map((agentId) => agentById.get(agentId)?.name ?? null)
    .filter((name): name is string => Boolean(name));

  return (
    <div className="rounded-[24px] border border-border bg-background/70 px-4 py-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <button type="button" className="inline-flex items-center gap-1 text-muted-foreground">
              <ChevronLeft className="h-3.5 w-3.5" />
              현재 스레드
            </button>
            <span className="font-mono">{issue.identifier ?? issue.id.slice(0, 8)}</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-[0.18em]">
              {formatStatusLabel(issue.status)}
            </span>
          </div>
          <div>
            <h3 className="text-base font-semibold text-foreground">{issue.title}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {selectedProject ? <span>프로젝트 {selectedProject.name}</span> : null}
              <span>{relativeTime(new Date(officeIssueActivityTimestamp(issue)))} 업데이트</span>
              {selectedConversationReasonLabel && mode === "direct" ? <span>{selectedConversationReasonLabel}</span> : null}
            </div>
            {mode === "meeting" ? (
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {facilitatorName ? <span>진행자 {facilitatorName}</span> : null}
                {participantNames.length > 0 ? <span>참가자 {participantNames.join(", ")}</span> : null}
              </div>
            ) : null}
          </div>
        </div>
        <Link
          to={issueUrl(issue)}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium transition-colors hover:bg-accent"
        >
          이슈 상세
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}

function ThreadTimeline({
  companyId,
  issue,
  entries,
  commentsLoading,
  commentsError,
  agentById,
}: {
  companyId: string;
  issue: Issue | null;
  entries: Array<{
    id: string;
    body: string;
    authorAgentId: string | null;
    authorUserId: string | null;
    createdAt: Date | string;
    kind: "description" | "comment";
  }>;
  commentsLoading: boolean;
  commentsError: string | null;
  agentById: Map<string, Agent>;
}) {
  if (!issue) return null;

  return (
    <div className="rounded-[24px] border border-border bg-background/70">
      <div className="border-b border-border px-4 py-3">
        <div className="text-sm font-semibold text-foreground">대화 스레드</div>
        <p className="mt-1 text-xs text-muted-foreground">
          이슈 설명과 댓글을 채팅형으로 렌더링합니다. 고급 편집/첨부/재할당은 이슈 상세에서 계속 지원됩니다.
        </p>
      </div>

      {commentsError ? (
        <div className="border-b border-border px-4 py-3 text-sm text-destructive">{commentsError}</div>
      ) : null}

      <ScrollArea className="h-[420px]">
        <div className="space-y-4 p-4">
          {commentsLoading ? (
            <div className="rounded-2xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
              대화 스레드를 불러오는 중입니다...
            </div>
          ) : entries.length > 0 ? (
            entries.map((entry) => {
              const authorName =
                entry.authorAgentId
                  ? agentById.get(entry.authorAgentId)?.name ?? "에이전트"
                  : "나";
              const isUser = !entry.authorAgentId;

              return (
                <div
                  key={entry.id}
                  className={cn("flex", isUser ? "justify-end" : "justify-start")}
                >
                  <div className={cn("max-w-[min(90%,44rem)] space-y-2", isUser ? "items-end" : "items-start")}>
                    <div className={cn("flex flex-wrap items-center gap-2 text-xs text-muted-foreground", isUser ? "justify-end" : "justify-start")}>
                      <span className="font-medium text-foreground">{authorName}</span>
                      {entry.kind === "description" ? (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                          초기 요청
                        </span>
                      ) : null}
                      <span>{formatDateTime(entry.createdAt)}</span>
                    </div>
                    <div
                      className={cn(
                        "rounded-[20px] border px-4 py-3 text-sm shadow-[0_8px_24px_rgba(0,0,0,0.08)]",
                        isUser
                          ? "border-cyan-400/30 bg-cyan-400/10 text-foreground"
                          : "border-border bg-card text-foreground",
                      )}
                    >
                      <MarkdownBody className="text-sm">{entry.body}</MarkdownBody>
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="rounded-2xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
              아직 댓글이 없습니다. 아래에서 첫 메시지를 이어서 보낼 수 있습니다.
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function OfficeComposer({
  mode,
  selectedThreadIssue,
  selectedProject,
  selectedProjectId,
  projects,
  onSelectProject,
  onOpenNewProject,
  messageTitle,
  onChangeTitle,
  messageBody,
  onChangeBody,
  messageBodyRef,
  composerOptionsOpen,
  onComposerOptionsOpenChange,
  templates,
  referencePath,
  onChangeReferencePath,
  effectiveReferencePath,
  windowsReferencePath,
  selectedProjectPath,
  onCopyWslPath,
  onCopyWindowsPath,
  onUseProjectPath,
  hasReferencePathMismatch,
  sendSummary,
  onCommentCurrentThread,
  onCreateIssue,
  canCommentCurrentThread,
  canCreateIssue,
  isSending,
  lastTouchedIssue,
}: {
  mode: OfficeConversationMode;
  selectedThreadIssue: Issue | null;
  selectedProject: Project | null;
  selectedProjectId: string;
  projects: Project[];
  onSelectProject: (projectId: string) => void;
  onOpenNewProject: () => void;
  messageTitle: string;
  onChangeTitle: (value: string) => void;
  messageBody: string;
  onChangeBody: (value: string) => void;
  messageBodyRef: RefObject<HTMLTextAreaElement | null>;
  composerOptionsOpen: boolean;
  onComposerOptionsOpenChange: (open: boolean) => void;
  templates: OfficeTemplateAction[];
  referencePath: string;
  onChangeReferencePath: (value: string) => void;
  effectiveReferencePath: string;
  windowsReferencePath: string | null;
  selectedProjectPath: string;
  onCopyWslPath: () => void;
  onCopyWindowsPath: () => void;
  onUseProjectPath: () => void;
  hasReferencePathMismatch: boolean;
  sendSummary: OfficeSendSummaryRow[];
  onCommentCurrentThread: () => void;
  onCreateIssue: () => void;
  canCommentCurrentThread: boolean;
  canCreateIssue: boolean;
  isSending: boolean;
  lastTouchedIssue: Issue | null;
}) {
  return (
    <div className="rounded-[24px] border border-border bg-background/70">
      <div className="border-b border-border px-4 py-3">
        <div className="text-sm font-semibold text-foreground">메시지 컴포저</div>
        <p className="mt-1 text-xs text-muted-foreground">
          현재 스레드에 이어서 말하거나, 필요하면 새 {mode === "meeting" ? "회의 이슈" : "이슈"}를 만들 수 있습니다.
        </p>
      </div>

      <div className="space-y-4 p-4">
        <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-3 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-100">전송 미리보기</div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {sendSummary.map((item) => (
              <div key={item.label} className="rounded-xl border border-cyan-400/10 bg-black/10 px-3 py-2">
                <div className="text-[10px] uppercase tracking-[0.18em] text-cyan-100/70">{item.label}</div>
                <div className="mt-1 text-xs text-cyan-50">{item.value}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
          <label className="space-y-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              새 이슈 제목
            </span>
            <Input
              value={messageTitle}
              onChange={(event) => onChangeTitle(event.target.value)}
              placeholder={mode === "meeting" ? "전체회의 요청" : "협업 요청"}
            />
          </label>
          <div className="flex items-end">
            <Collapsible open={composerOptionsOpen} onOpenChange={onComposerOptionsOpenChange}>
              <CollapsibleTrigger asChild>
                <Button variant="outline" size="sm">
                  <Sparkles className="mr-1 h-3.5 w-3.5" />
                  추가 옵션
                </Button>
              </CollapsibleTrigger>
            </Collapsible>
          </div>
        </div>

        <Collapsible open={composerOptionsOpen} onOpenChange={onComposerOptionsOpenChange}>
          <CollapsibleContent className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
              <label className="space-y-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  대상 프로젝트
                </span>
                <Select value={selectedProjectId || "__none__"} onValueChange={(value) => onSelectProject(value === "__none__" ? "" : value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="프로젝트 없이 보내기" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">프로젝트 없이 보내기</SelectItem>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <div className="flex items-end">
                {selectedProject ? (
                  <Link
                    to={projectUrl(selectedProject)}
                    className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium transition-colors hover:bg-accent"
                  >
                    <FolderKanban className="h-4 w-4" />
                    프로젝트 열기
                  </Link>
                ) : (
                  <Button variant="outline" size="sm" className="h-10" onClick={onOpenNewProject}>
                    프로젝트 만들기
                  </Button>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                빠른 템플릿
              </div>
              <div className="flex flex-wrap gap-2">
                {templates.map((template) => (
                  <button
                    key={template.label}
                    type="button"
                    onClick={template.onApply}
                    className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-accent"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
                    {template.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
              <label className="space-y-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  참고 경로
                </span>
                <Input
                  value={referencePath}
                  onChange={(event) => onChangeReferencePath(event.target.value)}
                  placeholder="C:\\Users\\... 또는 /mnt/c/Users/..."
                />
              </label>
              <div className="flex flex-wrap items-end gap-2">
                <Button variant="outline" size="sm" disabled={!effectiveReferencePath} onClick={onCopyWslPath}>
                  <Copy className="mr-1 h-3.5 w-3.5" />
                  WSL 복사
                </Button>
                <Button variant="outline" size="sm" disabled={!windowsReferencePath} onClick={onCopyWindowsPath}>
                  <Copy className="mr-1 h-3.5 w-3.5" />
                  Windows 복사
                </Button>
                <Button variant="ghost" size="sm" disabled={!selectedProjectPath} onClick={onUseProjectPath}>
                  프로젝트 경로 사용
                </Button>
              </div>
            </div>

            {referencePath.trim() ? (
              <div className="rounded-2xl border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
                참고 경로는 WSL 기준으로 정규화되어 전송됩니다.
                {windowsReferencePath ? ` 필요하면 Windows 경로(${windowsReferencePath})로도 다시 복사할 수 있습니다.` : ""}
              </div>
            ) : null}

            {hasReferencePathMismatch ? (
              <div className="rounded-2xl border border-amber-300/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
                현재 참고 경로가 선택한 프로젝트와 다릅니다. 이 상태로 보내면 수동 입력한 경로가 우선 전송됩니다.
              </div>
            ) : null}
          </CollapsibleContent>
        </Collapsible>

        <label className="space-y-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            메시지 본문
          </span>
          <Textarea
            ref={messageBodyRef}
            value={messageBody}
            onChange={(event) => onChangeBody(event.target.value)}
            className="min-h-[180px]"
            placeholder={
              mode === "meeting"
                ? "예: 장사톡 프로젝트 기준으로 CEO, CTO, CMO가 함께 논의할 안건과 원하는 결과물을 정리해주세요."
                : "예: 장사톡 프로젝트를 보고 첫 홍보 전략, 타깃 고객, 실험 채널, 필요한 자료를 정리해주세요."
            }
          />
        </label>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={!canCommentCurrentThread || isSending} onClick={onCommentCurrentThread}>
            <MessageSquare className="mr-1 h-3.5 w-3.5" />
            {mode === "meeting" ? "현재 회의에 코멘트" : "현재 작업에 코멘트"}
          </Button>
          <Button size="sm" variant="outline" disabled={!canCreateIssue || isSending} onClick={onCreateIssue}>
            <Send className="mr-1 h-3.5 w-3.5" />
            {mode === "meeting" ? "새 회의 이슈 만들기" : "새 이슈로 보내기"}
          </Button>
          {isSending ? (
            <span className="inline-flex items-center rounded-full bg-muted px-3 py-2 text-xs text-muted-foreground">
              전송 중...
            </span>
          ) : null}
          {lastTouchedIssue ? (
            <Link
              to={issueUrl(lastTouchedIssue)}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium transition-colors hover:bg-accent"
            >
              마지막 이슈 열기
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
