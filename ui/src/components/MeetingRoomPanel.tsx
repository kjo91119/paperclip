import { useMemo } from "react";
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
import { useToast } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import {
  canStartMeeting,
  canContinueMeeting,
  canPauseMeeting,
  canRemindMeetingParticipant,
  canRequestMeetingSummary,
  canResumeMeeting,
  canSkipMeetingParticipant,
  formatMeetingParticipantStatusLabel,
  formatMeetingRoundKindLabel,
  formatMeetingStatusLabel,
} from "../lib/meeting-room";
import { cn, formatDateTime, relativeTime } from "../lib/utils";
import { Button } from "./ui/button";
import { MarkdownBody } from "./MarkdownBody";
import { Identity } from "./Identity";

type MeetingRoomAction =
  | { kind: "start" }
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "continue" }
  | { kind: "summary" }
  | { kind: "remind"; agentId: string }
  | { kind: "skip"; agentId: string };

function transcriptEntryLabel(entry: MeetingRoomDTO["transcript"][number]) {
  if (entry.entryKind === "round_opened") return "라운드 시작";
  if (entry.entryKind === "round_summary") return "라운드 요약";
  if (entry.entryKind === "final_summary") return "최종 요약";
  if (entry.entryKind === "meeting_completed") return "회의 종료";
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
  if (entry.authorKind === "user") return "보드";
  if (entry.participantAgentId) return agentById.get(entry.participantAgentId)?.name ?? "에이전트";
  return "에이전트";
}

function controlActionLabel(action: MeetingRoomAction["kind"]) {
  if (action === "start") return "회의 시작";
  if (action === "pause") return "회의 일시중지";
  if (action === "resume") return "회의 재개";
  if (action === "continue") return "다음 라운드 진행";
  if (action === "summary") return "최종 요약 요청";
  if (action === "remind") return "참가자 재촉";
  return "참가자 건너뛰기";
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
  const currentRound = room.rounds.find((round) => round.roundNumber === room.meeting.currentRoundNumber) ?? null;
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
      ]),
      queryClient.invalidateQueries({ queryKey: queryKeys.meetings.detail(room.meeting.id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.list(room.meeting.companyId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.sidebarBadges(room.meeting.companyId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(room.meeting.companyId) }),
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

  const compactClass = compact ? "grid-cols-1" : "xl:grid-cols-[minmax(0,1.7fr)_18rem]";

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
                아직 표시할 회의 transcript가 없습니다.
              </div>
            ) : transcript.map((entry) => {
              const authorName = transcriptAuthorName(entry, agentById);
              const isSystem = entry.authorKind === "system";
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
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-background/70">
            <div className="border-b border-border px-4 py-3">
              <div className="text-sm font-semibold text-foreground">현재 라운드 상태</div>
            </div>
            <div className="space-y-3 p-4">
              {room.currentRoundParticipants.length === 0 ? (
                <p className="text-sm text-muted-foreground">현재 라운드 참가자 상태가 없습니다.</p>
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
              {room.participants.map((participant) => {
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
