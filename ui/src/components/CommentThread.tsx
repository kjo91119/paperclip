import { memo, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import type { IssueComment, Agent } from "@paperclipai/shared";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Check, ChevronDown, Copy, Paperclip } from "lucide-react";
import { Identity } from "./Identity";
import { InlineEntitySelector, type InlineEntityOption } from "./InlineEntitySelector";
import { MarkdownBody } from "./MarkdownBody";
import { MarkdownEditor, type MarkdownEditorRef, type MentionOption } from "./MarkdownEditor";
import { StatusBadge } from "./StatusBadge";
import { AgentIcon } from "./AgentIconPicker";
import { formatDateTime } from "../lib/utils";
import { restoreSubmittedCommentDraft } from "../lib/comment-submit-draft";
import { buildCommentBrief } from "../lib/issue-brief";
import { PluginSlotOutlet } from "@/plugins/slots";

interface CommentWithRunMeta extends IssueComment {
  runId?: string | null;
  runAgentId?: string | null;
  clientId?: string;
  clientStatus?: "pending" | "queued";
  queueState?: "queued";
  queueTargetRunId?: string | null;
}

interface LinkedRunItem {
  runId: string;
  status: string;
  agentId: string;
  createdAt: Date | string;
  startedAt: Date | string | null;
}

interface CommentReassignment {
  assigneeAgentId: string | null;
  assigneeUserId: string | null;
}

interface CommentThreadProps {
  comments: CommentWithRunMeta[];
  queuedComments?: CommentWithRunMeta[];
  linkedRuns?: LinkedRunItem[];
  companyId?: string | null;
  projectId?: string | null;
  onAdd: (body: string, reopen?: boolean, reassignment?: CommentReassignment) => Promise<void>;
  issueStatus?: string;
  agentMap?: Map<string, Agent>;
  imageUploadHandler?: (file: File) => Promise<string>;
  /** Callback to attach an image file to the parent issue (not inline in a comment). */
  onAttachImage?: (file: File) => Promise<void>;
  draftKey?: string;
  liveRunSlot?: React.ReactNode;
  enableReassign?: boolean;
  reassignOptions?: InlineEntityOption[];
  currentAssigneeValue?: string;
  suggestedAssigneeValue?: string;
  mentions?: MentionOption[];
  onInterruptQueued?: (runId: string) => Promise<void>;
  interruptingQueuedRunId?: string | null;
}

const DRAFT_DEBOUNCE_MS = 800;

function loadDraft(draftKey: string): string {
  try {
    return localStorage.getItem(draftKey) ?? "";
  } catch {
    return "";
  }
}

function saveDraft(draftKey: string, value: string) {
  try {
    if (value.trim()) {
      localStorage.setItem(draftKey, value);
    } else {
      localStorage.removeItem(draftKey);
    }
  } catch {
    // Ignore localStorage failures.
  }
}

function clearDraft(draftKey: string) {
  try {
    localStorage.removeItem(draftKey);
  } catch {
    // Ignore localStorage failures.
  }
}

function parseReassignment(target: string): CommentReassignment | null {
  if (!target || target === "__none__") {
    return { assigneeAgentId: null, assigneeUserId: null };
  }
  if (target.startsWith("agent:")) {
    const assigneeAgentId = target.slice("agent:".length);
    return assigneeAgentId ? { assigneeAgentId, assigneeUserId: null } : null;
  }
  if (target.startsWith("user:")) {
    const assigneeUserId = target.slice("user:".length);
    return assigneeUserId ? { assigneeAgentId: null, assigneeUserId } : null;
  }
  return null;
}

function CopyMarkdownButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="text-muted-foreground hover:text-foreground transition-colors"
      title="마크다운으로 복사"
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

function CommentCard({
  comment,
  agentMap,
  companyId,
  projectId,
  highlightCommentId,
  queued = false,
}: {
  comment: CommentWithRunMeta;
  agentMap?: Map<string, Agent>;
  companyId?: string | null;
  projectId?: string | null;
  highlightCommentId?: string | null;
  queued?: boolean;
}) {
  const isHighlighted = highlightCommentId === comment.id;
  const isPending = comment.clientStatus === "pending";
  const isQueued = queued || comment.queueState === "queued" || comment.clientStatus === "queued";
  const commentBrief = useMemo(() => buildCommentBrief(comment.body), [comment.body]);
  const [rawOpen, setRawOpen] = useState(!commentBrief.showSummaryCard);

  useEffect(() => {
    setRawOpen(!commentBrief.showSummaryCard);
  }, [comment.id, commentBrief.showSummaryCard]);

  return (
    <div
      key={comment.id}
      id={`comment-${comment.id}`}
      className={`border p-3 overflow-hidden min-w-0 rounded-sm transition-colors duration-1000 ${
        isQueued
          ? "border-amber-300/70 bg-amber-50/70 dark:border-amber-500/40 dark:bg-amber-500/10"
          : isHighlighted
            ? "border-primary/50 bg-primary/5"
            : "border-border"
      } ${isPending ? "opacity-80" : ""}`}
      >
      <div className="flex items-center justify-between mb-1">
        {comment.authorKind === "agent" && comment.authorAgentId ? (
          <Link to={`/agents/${comment.authorAgentId}`} className="hover:underline">
            <Identity
              name={agentMap?.get(comment.authorAgentId)?.name ?? comment.authorAgentId.slice(0, 8)}
              size="sm"
            />
          </Link>
        ) : comment.authorKind === "system" ? (
          <Identity name="시스템" size="sm" />
        ) : (
          <Identity name="나" size="sm" />
        )}
        <span className="flex items-center gap-1.5">
          {isQueued ? (
            <span className="inline-flex items-center rounded-full border border-amber-400/60 bg-amber-100/70 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-amber-800 dark:border-amber-400/40 dark:bg-amber-500/20 dark:text-amber-200">
              대기열
            </span>
          ) : null}
          {companyId && !isPending ? (
            <PluginSlotOutlet
              slotTypes={["commentContextMenuItem"]}
              entityType="comment"
              context={{
                companyId,
                projectId: projectId ?? null,
                entityId: comment.id,
                entityType: "comment",
                parentEntityId: comment.issueId,
              }}
              className="flex flex-wrap items-center gap-1.5"
              itemClassName="inline-flex"
              missingBehavior="placeholder"
            />
          ) : null}
          {isPending ? (
            <span className="text-xs text-muted-foreground">{isQueued ? "대기열에 넣는 중..." : "전송 중..."}</span>
          ) : (
            <a
              href={`#comment-${comment.id}`}
              className="text-xs text-muted-foreground hover:text-foreground hover:underline transition-colors"
            >
              {formatDateTime(comment.createdAt)}
            </a>
          )}
          <CopyMarkdownButton text={comment.body} />
        </span>
      </div>
      {commentBrief.showSummaryCard ? (
        <div className="mb-3 rounded-lg border border-border/70 bg-background/70 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            쉽게 읽기
          </div>
          <p className="mt-2 text-sm leading-6 text-foreground">
            {commentBrief.summary}
          </p>
          {(commentBrief.statusItems.length > 0 || commentBrief.actionItems.length > 0 || commentBrief.noteItems.length > 0) ? (
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              {commentBrief.statusItems.length > 0 ? (
                <div className="space-y-1">
                  <div className="text-[11px] font-semibold text-muted-foreground">지금 상태</div>
                  <ul className="space-y-1 text-xs leading-5 text-foreground">
                    {commentBrief.statusItems.map((item) => (
                      <li key={item} className="flex gap-2">
                        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400/70" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {commentBrief.actionItems.length > 0 ? (
                <div className="space-y-1">
                  <div className="text-[11px] font-semibold text-muted-foreground">다음 할 일</div>
                  <ul className="space-y-1 text-xs leading-5 text-foreground">
                    {commentBrief.actionItems.map((item) => (
                      <li key={item} className="flex gap-2">
                        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400/70" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {commentBrief.noteItems.length > 0 ? (
                <div className="space-y-1">
                  <div className="text-[11px] font-semibold text-muted-foreground">추가 메모</div>
                  <ul className="space-y-1 text-xs leading-5 text-foreground">
                    {commentBrief.noteItems.map((item) => (
                      <li key={item} className="flex gap-2">
                        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400/70" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {commentBrief.showSummaryCard ? (
        <Collapsible open={rawOpen} onOpenChange={setRawOpen} className="rounded-lg border border-border/60">
          <CollapsibleTrigger className="flex w-full items-center justify-between px-3 py-2 text-left">
            <span className="text-xs font-medium text-muted-foreground">원문 보기</span>
            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${rawOpen ? "rotate-180" : ""}`} />
          </CollapsibleTrigger>
          <CollapsibleContent className="border-t border-border/60 px-3 py-3">
            <MarkdownBody className="text-sm">{comment.body}</MarkdownBody>
          </CollapsibleContent>
        </Collapsible>
      ) : (
        <MarkdownBody className="text-sm">{comment.body}</MarkdownBody>
      )}
      {companyId && !isPending ? (
        <div className="mt-2 space-y-2">
          <PluginSlotOutlet
            slotTypes={["commentAnnotation"]}
            entityType="comment"
            context={{
              companyId,
              projectId: projectId ?? null,
              entityId: comment.id,
              entityType: "comment",
              parentEntityId: comment.issueId,
            }}
            className="space-y-2"
            itemClassName="rounded-md"
            missingBehavior="placeholder"
          />
        </div>
      ) : null}
      {comment.runId && !isPending ? (
        <div className="mt-2 pt-2 border-t border-border/60">
          {comment.runAgentId ? (
            <Link
              to={`/agents/${comment.runAgentId}/runs/${comment.runId}`}
              className="inline-flex items-center rounded-md border border-border bg-accent/30 px-2 py-1 text-[10px] font-mono text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
            >
              실행 {comment.runId.slice(0, 8)}
            </Link>
          ) : (
            <span className="inline-flex items-center rounded-md border border-border bg-accent/30 px-2 py-1 text-[10px] font-mono text-muted-foreground">
              실행 {comment.runId.slice(0, 8)}
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}

type TimelineItem =
  | { kind: "comment"; id: string; createdAtMs: number; comment: CommentWithRunMeta }
  | { kind: "run"; id: string; createdAtMs: number; run: LinkedRunItem };

const TimelineList = memo(function TimelineList({
  timeline,
  agentMap,
  companyId,
  projectId,
  highlightCommentId,
}: {
  timeline: TimelineItem[];
  agentMap?: Map<string, Agent>;
  companyId?: string | null;
  projectId?: string | null;
  highlightCommentId?: string | null;
}) {
  if (timeline.length === 0) {
    return <p className="text-sm text-muted-foreground">아직 댓글이나 실행 기록이 없습니다.</p>;
  }

  return (
    <div className="space-y-3">
      {timeline.map((item) => {
        if (item.kind === "run") {
          const run = item.run;
          return (
            <div key={`run:${run.runId}`} className="border border-border bg-accent/20 p-3 overflow-hidden min-w-0 rounded-sm">
              <div className="flex items-center justify-between mb-2">
                <Link to={`/agents/${run.agentId}`} className="hover:underline">
                  <Identity
                    name={agentMap?.get(run.agentId)?.name ?? run.agentId.slice(0, 8)}
                    size="sm"
                  />
                </Link>
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(run.startedAt ?? run.createdAt)}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">실행</span>
                <Link
                  to={`/agents/${run.agentId}/runs/${run.runId}`}
                  className="inline-flex items-center rounded-md border border-border bg-accent/40 px-2 py-1 font-mono text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors"
                >
                  {run.runId.slice(0, 8)}
                </Link>
                <StatusBadge status={run.status} />
              </div>
            </div>
          );
        }

        const comment = item.comment;
        return (
          <CommentCard
            key={comment.id}
            comment={comment}
            agentMap={agentMap}
            companyId={companyId}
            projectId={projectId}
            highlightCommentId={highlightCommentId}
          />
        );
      })}
    </div>
  );
});

export function CommentThread({
  comments,
  queuedComments = [],
  linkedRuns = [],
  companyId,
  projectId,
  onAdd,
  agentMap,
  imageUploadHandler,
  onAttachImage,
  draftKey,
  liveRunSlot,
  enableReassign = false,
  reassignOptions = [],
  currentAssigneeValue = "",
  suggestedAssigneeValue,
  mentions: providedMentions,
  onInterruptQueued,
  interruptingQueuedRunId = null,
}: CommentThreadProps) {
  const [body, setBody] = useState("");
  const [reopen, setReopen] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const effectiveSuggestedAssigneeValue = suggestedAssigneeValue ?? currentAssigneeValue;
  const [reassignTarget, setReassignTarget] = useState(effectiveSuggestedAssigneeValue);
  const [highlightCommentId, setHighlightCommentId] = useState<string | null>(null);
  const editorRef = useRef<MarkdownEditorRef>(null);
  const attachInputRef = useRef<HTMLInputElement | null>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const location = useLocation();
  const hasScrolledRef = useRef(false);

  const timeline = useMemo<TimelineItem[]>(() => {
    const commentItems: TimelineItem[] = comments.map((comment) => ({
      kind: "comment",
      id: comment.id,
      createdAtMs: new Date(comment.createdAt).getTime(),
      comment,
    }));
    const runItems: TimelineItem[] = linkedRuns.map((run) => ({
      kind: "run",
      id: run.runId,
      createdAtMs: new Date(run.startedAt ?? run.createdAt).getTime(),
      run,
    }));
    return [...commentItems, ...runItems].sort((a, b) => {
      if (a.createdAtMs !== b.createdAtMs) return a.createdAtMs - b.createdAtMs;
      if (a.kind === b.kind) return a.id.localeCompare(b.id);
      return a.kind === "comment" ? -1 : 1;
    });
  }, [comments, linkedRuns]);

  // Build mention options from agent map (exclude terminated agents)
  const mentions = useMemo<MentionOption[]>(() => {
    if (providedMentions) return providedMentions;
    if (!agentMap) return [];
    return Array.from(agentMap.values())
      .filter((a) => a.status !== "terminated")
      .map((a) => ({
        id: `agent:${a.id}`,
        name: a.name,
        kind: "agent",
        agentId: a.id,
        agentIcon: a.icon,
      }));
  }, [agentMap, providedMentions]);

  useEffect(() => {
    if (!draftKey) return;
    setBody(loadDraft(draftKey));
  }, [draftKey]);

  useEffect(() => {
    if (!draftKey) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      saveDraft(draftKey, body);
    }, DRAFT_DEBOUNCE_MS);
  }, [body, draftKey]);

  useEffect(() => {
    return () => {
      if (draftTimer.current) clearTimeout(draftTimer.current);
    };
  }, []);

  useEffect(() => {
    setReassignTarget(effectiveSuggestedAssigneeValue);
  }, [effectiveSuggestedAssigneeValue]);

  // Scroll to comment when URL hash matches #comment-{id}
  useEffect(() => {
    const hash = location.hash;
    if (!hash.startsWith("#comment-") || comments.length + queuedComments.length === 0) return;
    const commentId = hash.slice("#comment-".length);
    // Only scroll once per hash
    if (hasScrolledRef.current) return;
    const el = document.getElementById(`comment-${commentId}`);
    if (el) {
      hasScrolledRef.current = true;
      setHighlightCommentId(commentId);
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      // Clear highlight after animation
      const timer = setTimeout(() => setHighlightCommentId(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [location.hash, comments, queuedComments]);

  async function handleSubmit() {
    const trimmed = body.trim();
    if (!trimmed) return;
    const hasReassignment = enableReassign && reassignTarget !== currentAssigneeValue;
    const reassignment = hasReassignment ? parseReassignment(reassignTarget) : null;
    const submittedBody = trimmed;

    setSubmitting(true);
    setBody("");
    try {
      // TODO: wire an explicit "send + interrupt" action through the composer if we expose it in the UI.
      await onAdd(submittedBody, reopen ? true : undefined, reassignment ?? undefined);
      if (draftKey) clearDraft(draftKey);
      setReopen(true);
      setReassignTarget(effectiveSuggestedAssigneeValue);
    } catch {
      setBody((current) =>
        restoreSubmittedCommentDraft({
          currentBody: current,
          submittedBody,
        }),
      );
      // Parent mutation handlers surface the failure and the draft is restored for retry.
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAttachFile(evt: ChangeEvent<HTMLInputElement>) {
    const file = evt.target.files?.[0];
    if (!file) return;
    setAttaching(true);
    try {
      if (imageUploadHandler) {
        const url = await imageUploadHandler(file);
        const safeName = file.name.replace(/[[\]]/g, "\\$&");
        const markdown = `![${safeName}](${url})`;
        setBody((prev) => prev ? `${prev}\n\n${markdown}` : markdown);
      } else if (onAttachImage) {
        await onAttachImage(file);
      }
    } finally {
      setAttaching(false);
      if (attachInputRef.current) attachInputRef.current.value = "";
    }
  }

  const canSubmit = !submitting && !!body.trim();

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold">댓글 및 실행 ({timeline.length + queuedComments.length})</h3>

      {timeline.length > 0 ? (
        <TimelineList
          timeline={timeline}
          agentMap={agentMap}
          companyId={companyId}
          projectId={projectId}
          highlightCommentId={highlightCommentId}
        />
      ) : null}

      {liveRunSlot}

      {queuedComments.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-700 dark:text-amber-300">
              대기 중인 댓글 ({queuedComments.length})
            </h4>
            {onInterruptQueued && queuedComments[0]?.queueTargetRunId ? (
              <Button
                size="sm"
                variant="outline"
                className="border-red-300 text-red-700 hover:bg-red-50 hover:text-red-800 dark:border-red-500/40 dark:text-red-300 dark:hover:bg-red-500/10"
                disabled={interruptingQueuedRunId === queuedComments[0].queueTargetRunId}
                onClick={() => void onInterruptQueued(queuedComments[0]!.queueTargetRunId!)}
              >
                {interruptingQueuedRunId === queuedComments[0].queueTargetRunId ? "중단 중..." : "중단"}
              </Button>
            ) : null}
          </div>
          <div className="space-y-3">
            {queuedComments.map((comment) => (
              <CommentCard
                key={comment.id}
                comment={comment}
                agentMap={agentMap}
                companyId={companyId}
                projectId={projectId}
                highlightCommentId={highlightCommentId}
                queued
              />
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <MarkdownEditor
          ref={editorRef}
          value={body}
          onChange={setBody}
          placeholder="댓글을 남겨보세요..."
          mentions={mentions}
          onSubmit={handleSubmit}
          imageUploadHandler={imageUploadHandler}
          contentClassName="min-h-[60px] text-sm"
        />
        <div className="flex items-center justify-end gap-3">
          {(imageUploadHandler || onAttachImage) && (
            <div className="mr-auto flex items-center gap-3">
              <input
                ref={attachInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={handleAttachFile}
              />
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => attachInputRef.current?.click()}
                disabled={attaching}
                title="이미지 첨부"
              >
                <Paperclip className="h-4 w-4" />
              </Button>
            </div>
          )}
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={reopen}
              onChange={(e) => setReopen(e.target.checked)}
              className="rounded border-border"
            />
            다시 열기
          </label>
          {enableReassign && reassignOptions.length > 0 && (
            <InlineEntitySelector
              value={reassignTarget}
              options={reassignOptions}
              placeholder="담당자"
              noneLabel="담당자 없음"
              searchPlaceholder="담당자 검색..."
              emptyMessage="담당자를 찾을 수 없습니다."
              onChange={setReassignTarget}
              className="text-xs h-8"
              renderTriggerValue={(option) => {
                if (!option) return <span className="text-muted-foreground">담당자</span>;
                const agentId = option.id.startsWith("agent:") ? option.id.slice("agent:".length) : null;
                const agent = agentId ? agentMap?.get(agentId) : null;
                return (
                  <>
                    {agent ? (
                      <AgentIcon icon={agent.icon} className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    ) : null}
                    <span className="truncate">{option.label}</span>
                  </>
                );
              }}
              renderOption={(option) => {
                if (!option.id) return <span className="truncate">{option.label}</span>;
                const agentId = option.id.startsWith("agent:") ? option.id.slice("agent:".length) : null;
                const agent = agentId ? agentMap?.get(agentId) : null;
                return (
                  <>
                    {agent ? (
                      <AgentIcon icon={agent.icon} className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    ) : null}
                    <span className="truncate">{option.label}</span>
                  </>
                );
              }}
            />
          )}
          <Button size="sm" disabled={!canSubmit} onClick={handleSubmit}>
            {submitting ? "등록 중..." : "댓글 달기"}
          </Button>
        </div>
      </div>
    </div>
  );
}
