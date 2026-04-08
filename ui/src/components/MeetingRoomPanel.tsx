import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Agent, Issue, MeetingCurrentRoundParticipantSummary, MeetingRoomDTO } from "@paperclipai/shared";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Pause,
  Play,
  RotateCcw,
  SkipForward,
  Sparkles,
} from "lucide-react";
import { meetingsApi } from "../api/meetings";
import { issuesApi } from "../api/issues";
import { useToast } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import {
  canAddOperatorComment,
  canStartMeeting,
  canContinueMeeting,
  canPauseMeeting,
  canReopenDiscussion,
  canRemindMeetingParticipant,
  canRequestMeetingSummary,
  canResumeMeeting,
  canSkipMeetingParticipant,
  describeMeetingStatus,
  estimateMeetingExecution,
  formatMeetingDurationLabel,
  formatMeetingParticipantStatusLabel,
  formatMeetingRoundKindLabel,
  formatMeetingStatusLabel,
  meetingGuardrailNotes,
  shouldCollapseMeetingTranscriptEntry,
  summarizeMeetingTranscriptEntry,
} from "../lib/meeting-room";
import { cn, formatDateTime, relativeTime } from "../lib/utils";
import { Button } from "./ui/button";
import { MarkdownBody } from "./MarkdownBody";
import { Identity } from "./Identity";
import { Textarea } from "./ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";

type MeetingRoomAction =
  | { kind: "start" }
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "continue" }
  | { kind: "reopen_discussion" }
  | { kind: "summary" }
  | { kind: "remind"; agentId: string }
  | { kind: "skip"; agentId: string };

function transcriptEntryLabel(entry: MeetingRoomDTO["transcript"][number]) {
  if (entry.entryKind === "round_opened") return "라운드 시작";
  if (entry.entryKind === "round_summary") return "라운드 요약";
  if (entry.entryKind === "final_summary") return "최종 요약";
  if (entry.entryKind === "meeting_completed") return "회의 종료";
  if (entry.entryKind === "operator_comment") return "운영자 코멘트";
  if (entry.entryKind === "operator_signal") return "운영자 신호";
  if (entry.entryKind === "late_response") return "지연 응답";
  if (entry.entryKind === "participant_response_extra") return "추가 의견";
  return "응답";
}

function transcriptAuthorName(
  entry: MeetingRoomDTO["transcript"][number],
  agentById: Map<string, Agent>,
) {
  if (entry.authorKind === "system") return "시스템";
  if (entry.authorKind === "user") return "운영자";
  if (entry.participantAgentId) return agentById.get(entry.participantAgentId)?.name ?? "에이전트";
  return "에이전트";
}

function controlActionLabel(action: MeetingRoomAction["kind"]) {
  if (action === "start") return "회의 시작";
  if (action === "pause") return "회의 일시중지";
  if (action === "resume") return "회의 재개";
  if (action === "continue") return "다음 라운드 진행";
  if (action === "reopen_discussion") return "전원 재토론";
  if (action === "summary") return "최종 요약 요청";
  if (action === "remind") return "참가자 재촉";
  return "참가자 건너뛰기";
}

function statusNoticeToneClass(tone: ReturnType<typeof describeMeetingStatus>["tone"]) {
  if (tone === "warning") return "border-amber-500/30 bg-amber-500/10 text-amber-100";
  if (tone === "success") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-100";
  if (tone === "error") return "border-rose-500/30 bg-rose-500/10 text-rose-100";
  return "border-border bg-card text-foreground";
}

function statusNoticeIcon(tone: ReturnType<typeof describeMeetingStatus>["tone"]) {
  if (tone === "warning") return <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />;
  if (tone === "success") return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />;
  if (tone === "error") return <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />;
  return <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />;
}

export function MeetingRoomPanel({
  issue,
  room,
  agentById,
  compact = false,
}: {
  issue: Issue;
  room: MeetingRoomDTO;
  agentById: Map<string, Agent>;
  compact?: boolean;
}) {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [operatorCommentBody, setOperatorCommentBody] = useState("");
  const currentRound = room.rounds.find((round) => round.roundNumber === room.meeting.currentRoundNumber) ?? null;
  const statusNotice = describeMeetingStatus(room);
  const executionEstimate = estimateMeetingExecution(room);
  const timeoutLabel = formatMeetingDurationLabel(room.meeting.responseTimeoutSec);
  const guardrailNotes = meetingGuardrailNotes(room);
  const transcript = useMemo(
    () => [...room.transcript].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [room.transcript],
  );

  const invalidateMeetingQueries = async () => {
    const issueRefs = [issue.id, issue.identifier].filter((value): value is string => Boolean(value));
    await Promise.all([
      ...issueRefs.flatMap((issueRef) => [
        queryClient.invalidateQueries({ queryKey: queryKeys.issues.detail(issueRef) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.meetings.byIssue(issueRef) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.issues.comments(issueRef) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.issues.activity(issueRef) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.issues.runs(issueRef) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.issues.liveRuns(issueRef) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.issues.activeRun(issueRef) }),
      ]),
      queryClient.invalidateQueries({ queryKey: queryKeys.meetings.detail(room.meeting.id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.list(room.meeting.companyId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.sidebarBadges(room.meeting.companyId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(room.meeting.companyId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.activity(room.meeting.companyId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.listMineByMe(room.meeting.companyId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.listTouchedByMe(room.meeting.companyId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.listUnreadTouchedByMe(room.meeting.companyId) }),
    ]);
  };

  const controlMutation = useMutation({
    mutationFn: async (action: MeetingRoomAction) => {
      if (action.kind === "start") return meetingsApi.start(issue.id);
      if (action.kind === "pause") return meetingsApi.pause(issue.id);
      if (action.kind === "resume") return meetingsApi.resume(issue.id);
      if (action.kind === "continue") return meetingsApi.continue(issue.id);
      if (action.kind === "reopen_discussion") return meetingsApi.reopenDiscussion(issue.id);
      if (action.kind === "summary") return meetingsApi.summary(issue.id);
      if (action.kind === "remind") return meetingsApi.remind(issue.id, action.agentId);
      return meetingsApi.skip(issue.id, action.agentId);
    },
    onSuccess: async (_dto, action) => {
      await invalidateMeetingQueries();
      pushToast({
        title: controlActionLabel(action.kind),
        body: "회의 화면을 최신 상태로 갱신했습니다.",
        tone: "success",
      });
    },
    onError: (error, action) => {
      pushToast({
        title: `${controlActionLabel(action.kind)} 실패`,
        body: error instanceof Error ? error.message : "회의 제어 요청을 처리하지 못했습니다.",
        tone: "error",
      });
    },
  });

  const operatorCommentMutation = useMutation({
    mutationFn: async (body: string) => issuesApi.addComment(issue.id, body),
    onSuccess: async () => {
      setOperatorCommentBody("");
      await invalidateMeetingQueries();
      pushToast({
        title: "운영자 코멘트 추가",
        body: "회의 transcript와 다음 라운드 컨텍스트를 최신 상태로 갱신했습니다.",
        tone: "success",
      });
    },
    onError: (error) => {
      pushToast({
        title: "운영자 코멘트 추가 실패",
        body: error instanceof Error ? error.message : "회의 코멘트를 저장하지 못했습니다.",
        tone: "error",
      });
    },
  });

  const compactClass = compact ? "grid-cols-1" : "xl:grid-cols-[minmax(0,1.7fr)_18rem]";
  const transcriptEmptyMessage =
    room.meeting.status === "draft"
      ? "아직 transcript가 없습니다. 회의를 시작하면 오프닝 라운드와 응답이 여기부터 쌓입니다."
      : room.meeting.status === "paused"
        ? "회의가 일시중지되어 새 transcript가 잠시 멈춘 상태입니다."
        : room.meeting.status === "failed"
          ? "회의가 실패 상태라 transcript가 더 진행되지 않았습니다. 최근 운영자 신호를 먼저 확인하세요."
          : "아직 표시할 회의 transcript가 없습니다.";
  const roundEmptyMessage =
    room.meeting.status === "draft"
      ? "회의를 시작하면 현재 라운드 참가자 상태가 채워집니다."
      : room.meeting.status === "completed" || room.meeting.status === "partial_completed"
        ? "현재 진행 중인 라운드가 없어 참가자 상태 패널이 비어 있습니다."
        : room.meeting.status === "failed"
          ? "회의가 실패 상태라 현재 라운드 상태를 더 진행할 수 없습니다."
          : "현재 라운드 참가자 상태가 없습니다.";
  const canComposeOperatorComment = canAddOperatorComment(room);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-background/70 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono">{issue.identifier ?? issue.id.slice(0, 8)}</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground">
                {formatMeetingStatusLabel(room.meeting.status)}
              </span>
              {room.meeting.needsAttention ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  운영자 판단 필요
                </span>
              ) : null}
            </div>
            <div>
              <h3 className="text-base font-semibold text-foreground">{room.meeting.agenda}</h3>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>
                  현재 라운드 {room.meeting.currentRoundNumber ?? "-"} · {formatMeetingRoundKindLabel(room.meeting.currentRoundKind)}
                </span>
                <span>응답 마감 {timeoutLabel}</span>
                {currentRound?.deadlineAt ? <span>마감 {relativeTime(currentRound.deadlineAt)}</span> : null}
                {room.meeting.completedAt ? <span>종료 {formatDateTime(room.meeting.completedAt)}</span> : null}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canPauseMeeting(room) ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => controlMutation.mutate({ kind: "pause" })}
                disabled={controlMutation.isPending}
              >
                <Pause className="mr-1 h-3.5 w-3.5" />
                일시중지
              </Button>
            ) : null}
            {canResumeMeeting(room) ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => controlMutation.mutate({ kind: "resume" })}
                disabled={controlMutation.isPending}
              >
                <Play className="mr-1 h-3.5 w-3.5" />
                재개
              </Button>
            ) : null}
            {canContinueMeeting(room) ? (
              <Button
                size="sm"
                onClick={() => controlMutation.mutate({ kind: "continue" })}
                disabled={controlMutation.isPending}
              >
                <ChevronRight className="mr-1 h-3.5 w-3.5" />
                다음 라운드
              </Button>
            ) : null}
            {canReopenDiscussion(room) ? (
              <Button
                size="sm"
                onClick={() => controlMutation.mutate({ kind: "reopen_discussion" })}
                disabled={controlMutation.isPending}
              >
                <RotateCcw className="mr-1 h-3.5 w-3.5" />
                전원 재토론
              </Button>
            ) : null}
            {canRequestMeetingSummary(room) ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => controlMutation.mutate({ kind: "summary" })}
                disabled={controlMutation.isPending}
              >
                <Sparkles className="mr-1 h-3.5 w-3.5" />
                최종 요약
              </Button>
            ) : null}
            {canStartMeeting(room) ? (
              <Button
                size="sm"
                onClick={() => controlMutation.mutate({ kind: "start" })}
                disabled={controlMutation.isPending}
              >
                <Play className="mr-1 h-3.5 w-3.5" />
                시작
              </Button>
            ) : null}
          </div>
        </div>
        <div className={cn("mt-4 flex gap-3 rounded-2xl border px-4 py-3", statusNoticeToneClass(statusNotice.tone))}>
          {statusNoticeIcon(statusNotice.tone)}
          <div className="min-w-0">
            <div className="text-sm font-semibold">{statusNotice.title}</div>
            <p className="mt-1 text-sm/6 opacity-90">{statusNotice.body}</p>
          </div>
        </div>
      </div>

      <div className={cn("grid gap-4", compactClass)}>
        <div className="rounded-2xl border border-border bg-background/70">
        <div className="border-b border-border px-4 py-3">
          <div className="text-sm font-semibold text-foreground">회의 transcript</div>
          <p className="mt-1 text-xs text-muted-foreground">
            raw 댓글이 아니라 orchestrator가 정규화한 transcript 기준으로 표시합니다.
          </p>
        </div>
          <div className="space-y-4 p-4">
            {transcript.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                {transcriptEmptyMessage}
              </div>
            ) : transcript.map((entry) => {
              const authorName = transcriptAuthorName(entry, agentById);
              const isSystem = entry.authorKind === "system";
              const collapseByDefault = shouldCollapseMeetingTranscriptEntry(entry);
              return (
                <div key={`${entry.entryKind}:${entry.sourceCommentId ?? entry.createdAt.toString()}`} className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{authorName}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-[0.16em]">
                      {transcriptEntryLabel(entry)}
                    </span>
                    {entry.roundNumber ? (
                      <span>
                        R{entry.roundNumber} · {formatMeetingRoundKindLabel(entry.roundKind)}
                      </span>
                    ) : null}
                    <span>{formatDateTime(entry.createdAt)}</span>
                  </div>
                  {collapseByDefault ? (
                    <Collapsible className="rounded-[18px] border border-border bg-card text-foreground" defaultOpen={false}>
                      <div className="flex flex-col gap-3 px-4 py-3">
                        <div className="text-sm text-muted-foreground">
                          {summarizeMeetingTranscriptEntry(entry)}
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs text-muted-foreground">
                            CEO/CTO/CMO 원문을 다시 길게 반복하지 않도록 기본 접힘 상태로 보여줍니다.
                          </div>
                          <CollapsibleTrigger asChild>
                            <Button type="button" size="sm" variant="outline">
                              자세히 보기
                            </Button>
                          </CollapsibleTrigger>
                        </div>
                        <CollapsibleContent className="pt-1">
                          <div className="rounded-[16px] border border-border/80 bg-background/60 px-4 py-3 text-sm">
                            <MarkdownBody className="text-sm">{entry.body}</MarkdownBody>
                          </div>
                        </CollapsibleContent>
                      </div>
                    </Collapsible>
                  ) : (
                    <div
                      className={cn(
                        "rounded-[18px] border px-4 py-3 text-sm",
                        isSystem
                          ? "border-border bg-card text-foreground"
                          : "border-cyan-400/20 bg-cyan-400/10 text-foreground",
                      )}
                    >
                      <MarkdownBody className="text-sm">{entry.body}</MarkdownBody>
                    </div>
                  )}
                </div>
              );
            })}
            <div className="rounded-xl border border-border bg-card/70 p-3">
              <div className="text-sm font-semibold text-foreground">운영자 코멘트</div>
              <p className="mt-1 text-xs text-muted-foreground">
                방금 읽은 회의 글 아래에서 바로 답글처럼 남길 수 있습니다. 저장된 코멘트는 transcript에 보이고, 이후 재촉·다음 라운드·최종 요약 요청 시 프롬프트에도 함께 반영됩니다.
              </p>
              <Textarea
                value={operatorCommentBody}
                onChange={(event) => setOperatorCommentBody(event.target.value)}
                className="mt-3 min-h-[110px]"
                rows={compact ? 4 : 5}
                placeholder="예: CTO 의견에는 동의해. 다만 너무 느리게 가지 말고 첫 2주는 최소 공개 리듬도 같이 제안해줘."
                disabled={!canComposeOperatorComment || operatorCommentMutation.isPending}
              />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs text-muted-foreground">
                  {canComposeOperatorComment
                    ? "현재 라운드를 바로 바꾸지는 않지만, 다음 회의 전이에서 운영자 의견으로 반영됩니다."
                    : "완료되었거나 종료된 회의에는 새 운영자 코멘트를 추가할 수 없습니다."}
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => operatorCommentMutation.mutate(operatorCommentBody.trim())}
                  disabled={!canComposeOperatorComment || !operatorCommentBody.trim() || operatorCommentMutation.isPending}
                >
                  {operatorCommentMutation.isPending ? "등록 중…" : "운영자 코멘트 추가"}
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-background/70 p-4">
            <div className="text-sm font-semibold text-foreground">실행 규모와 가드레일</div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-border px-3 py-2">
                <div className="text-[11px] text-muted-foreground">참가자</div>
                <div className="mt-1 text-lg font-semibold text-foreground">{executionEstimate.participantCount}명</div>
              </div>
              <div className="rounded-xl border border-border px-3 py-2">
                <div className="text-[11px] text-muted-foreground">토론 라운드 수</div>
                <div className="mt-1 text-lg font-semibold text-foreground">{executionEstimate.maxDiscussionRounds}회</div>
              </div>
              <div className="rounded-xl border border-border px-3 py-2">
                <div className="text-[11px] text-muted-foreground">예상 총 라운드</div>
                <div className="mt-1 text-lg font-semibold text-foreground">{executionEstimate.estimatedTotalRounds}회</div>
              </div>
              <div className="rounded-xl border border-border px-3 py-2">
                <div className="text-[11px] text-muted-foreground">최대 응답 수</div>
                <div className="mt-1 text-lg font-semibold text-foreground">{executionEstimate.maxResponses.toLocaleString("ko-KR")}</div>
              </div>
            </div>
            <div className="mt-3 rounded-xl border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
              <div>
                거친 프롬프트 입력 규모는 약{" "}
                <span className="font-medium text-foreground">
                  {executionEstimate.estimatedPromptTokensMin.toLocaleString("ko-KR")} - {executionEstimate.estimatedPromptTokensMax.toLocaleString("ko-KR")} 토큰
                </span>
                {" "}수준입니다.
              </div>
              <div className="mt-1">참가자당 응답 마감은 {timeoutLabel}이고, 자동 진행은 {room.meeting.autoContinue ? "켜짐" : "꺼짐"} 상태입니다.</div>
            </div>
            <div className="mt-3 space-y-2">
              {guardrailNotes.length === 0 ? (
                <div className="rounded-xl border border-border px-3 py-2 text-sm text-muted-foreground">
                  현재 설정은 기본 권장 범위 안에 있습니다.
                </div>
              ) : guardrailNotes.map((note) => (
                <div
                  key={note}
                  className="flex gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-100"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{note}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-background/70">
            <div className="border-b border-border px-4 py-3">
              <div className="text-sm font-semibold text-foreground">현재 라운드 상태</div>
            </div>
            <div className="space-y-3 p-4">
              {room.currentRoundParticipants.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
                  {roundEmptyMessage}
                </div>
              ) : room.currentRoundParticipants.map((participant) => {
                const agentName = agentById.get(participant.agentId)?.name ?? participant.agentId;
                return (
                  <MeetingParticipantStatusCard
                    key={participant.id}
                    room={room}
                    participant={participant}
                    agentName={agentName}
                    isPending={controlMutation.isPending}
                    onRemind={() => controlMutation.mutate({ kind: "remind", agentId: participant.agentId })}
                    onSkip={() => controlMutation.mutate({ kind: "skip", agentId: participant.agentId })}
                  />
                );
              })}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-background/70 p-4">
            <div className="text-sm font-semibold text-foreground">참가자</div>
            <div className="mt-3 space-y-2">
              {room.participants.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
                  아직 참가자가 없습니다. 최소 두 명 이상을 넣어야 정상적인 전체회의 토론이 가능합니다.
                </div>
              ) : room.participants.map((participant) => {
                const agent = agentById.get(participant.agentId);
                return (
                  <div key={participant.id} className="flex items-center justify-between gap-2 rounded-xl border border-border px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Identity name={agent?.name ?? participant.agentId} size="sm" />
                      <div className="text-sm text-foreground">{agent?.name ?? participant.agentId}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                      {participant.isFacilitator ? <span className="rounded-full bg-muted px-2 py-0.5">진행자</span> : null}
                      {participant.isSummarizer ? <span className="rounded-full bg-muted px-2 py-0.5">요약자</span> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MeetingParticipantStatusCard({
  room,
  participant,
  agentName,
  isPending,
  onRemind,
  onSkip,
}: {
  room: MeetingRoomDTO;
  participant: MeetingCurrentRoundParticipantSummary;
  agentName: string;
  isPending: boolean;
  onRemind: () => void;
  onSkip: () => void;
}) {
  const responded = participant.respondedAt ? formatDateTime(participant.respondedAt) : null;
  const deadline = participant.deadlineAt ? relativeTime(participant.deadlineAt) : null;

  return (
    <div className="rounded-xl border border-border px-3 py-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-medium text-foreground">{agentName}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px]">
              {formatMeetingParticipantStatusLabel(participant.status)}
            </span>
            {responded ? <span>응답 {responded}</span> : null}
            {deadline ? <span>마감 {deadline}</span> : null}
          </div>
          {participant.failureReason || participant.lastErrorCode || participant.skipReason ? (
            <div className="mt-2 text-xs text-muted-foreground">
              {[participant.failureReason, participant.lastErrorCode, participant.skipReason].filter(Boolean).join(" · ")}
            </div>
          ) : null}
        </div>
        {participant.status === "responded" ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {canRemindMeetingParticipant(room, participant) ? (
          <Button type="button" variant="outline" size="sm" onClick={onRemind} disabled={isPending}>
            <RotateCcw className="mr-1 h-3.5 w-3.5" />
            재촉
          </Button>
        ) : null}
        {canSkipMeetingParticipant(room, participant) ? (
          <Button type="button" variant="outline" size="sm" onClick={onSkip} disabled={isPending}>
            <SkipForward className="mr-1 h-3.5 w-3.5" />
            건너뛰기
          </Button>
        ) : null}
      </div>
    </div>
  );
}
