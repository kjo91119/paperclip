import type {
  IssueMeetingRoundKind,
  IssueMeetingRoundParticipantStatus,
  IssueMeetingStatus,
  MeetingCurrentRoundParticipantSummary,
  MeetingRoomDTO,
  MeetingTranscriptEntry,
} from "@paperclipai/shared";

export interface MeetingExecutionEstimate {
  participantCount: number;
  maxDiscussionRounds: number;
  estimatedTotalRounds: number;
  maxResponses: number;
  estimatedPromptTokensMin: number;
  estimatedPromptTokensMax: number;
}

export interface MeetingStatusNotice {
  tone: "neutral" | "warning" | "success" | "error";
  title: string;
  body: string;
}

export interface MeetingOverview {
  conclusion: string;
  currentDecision: string;
  nextAction: string;
  ownerKind: "operator" | "summary_agent" | "current_round_participants";
  ownerAgentIds: string[];
}

function cleanMeetingSummaryLine(line: string): string {
  return line
    .replace(/^[#>*\-\d.\s]+/u, "")
    .replace(/\[(.*?)\]\((.*?)\)/gu, "$1")
    .replace(/\*\*(.*?)\*\*/gu, "$1")
    .trim();
}

function firstMeaningfulMeetingLine(body: string): string | null {
  const lines = body.split(/\r?\n/u).map(cleanMeetingSummaryLine);
  return lines.find((line) => line.length > 0) ?? null;
}

function findMeetingSectionLine(body: string, headings: string[]): string | null {
  const lines = body.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const normalized = cleanMeetingSummaryLine(lines[index] ?? "");
    if (!normalized) continue;
    const matchedHeading = headings.find((heading) => normalized.startsWith(heading));
    if (!matchedHeading) continue;

    const inlineValue = normalized.slice(matchedHeading.length).replace(/^[:：]\s*/u, "").trim();
    if (inlineValue) {
      return inlineValue;
    }

    for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
      const nextLine = cleanMeetingSummaryLine(lines[nextIndex] ?? "");
      if (nextLine) {
        return nextLine;
      }
    }
  }

  return null;
}

export function formatMeetingStatusLabel(status: IssueMeetingStatus): string {
  if (status === "draft") return "준비 중";
  if (status === "running") return "진행 중";
  if (status === "awaiting_operator") return "운영자 판단 필요";
  if (status === "paused") return "일시중지";
  if (status === "completed") return "완료";
  if (status === "partial_completed") return "부분 완료";
  if (status === "failed") return "실패";
  if (status === "cancelled") return "취소됨";
  return status;
}

export function formatMeetingRoundKindLabel(kind: IssueMeetingRoundKind | null): string {
  if (kind === "opening") return "오프닝";
  if (kind === "discussion") return "토론";
  if (kind === "followup") return "추가 토론";
  if (kind === "summary") return "최종 요약";
  return "라운드 없음";
}

export function formatMeetingParticipantStatusLabel(status: IssueMeetingRoundParticipantStatus): string {
  if (status === "pending_dispatch") return "대기";
  if (status === "queued") return "호출 대기";
  if (status === "coalesced") return "기존 실행 합류";
  if (status === "deferred") return "지연됨";
  if (status === "running") return "실행 중";
  if (status === "responded") return "응답 완료";
  if (status === "timed_out") return "시간 초과";
  if (status === "blocked") return "막힘";
  if (status === "skipped") return "건너뜀";
  if (status === "failed") return "실패";
  if (status === "late") return "지연 응답";
  return status;
}

export function canStartMeeting(room: MeetingRoomDTO): boolean {
  return room.meeting.status === "draft";
}

export function canPauseMeeting(room: MeetingRoomDTO): boolean {
  return room.meeting.status === "running" || room.meeting.status === "awaiting_operator";
}

export function canResumeMeeting(room: MeetingRoomDTO): boolean {
  return room.meeting.status === "paused";
}

export function canContinueMeeting(room: MeetingRoomDTO): boolean {
  return room.meeting.status === "awaiting_operator" && room.meeting.currentRoundKind !== "summary";
}

export function canReopenDiscussion(room: MeetingRoomDTO): boolean {
  return room.meeting.status === "awaiting_operator" && room.meeting.currentRoundKind === "summary";
}

export function canFinalizeMeeting(room: MeetingRoomDTO): boolean {
  const currentRound = room.rounds.find((round) => round.roundNumber === room.meeting.currentRoundNumber) ?? null;
  return (
    room.meeting.status === "awaiting_operator"
    && currentRound?.kind === "summary"
    && currentRound.status === "completed"
  );
}

export function continueMeetingLabel(room: MeetingRoomDTO): string {
  if (room.meeting.currentRoundKind === "opening") {
    return "토론으로 진행";
  }

  const discussionRoundsUsed = room.rounds.filter((round) => round.kind === "discussion" || round.kind === "followup").length;
  if (
    (room.meeting.currentRoundKind === "discussion" || room.meeting.currentRoundKind === "followup")
    && discussionRoundsUsed >= room.meeting.maxDiscussionRounds
  ) {
    return "최종 요약으로 진행";
  }

  return "다음 토론 라운드";
}

export function canRequestMeetingSummary(room: MeetingRoomDTO): boolean {
  return (
    (room.meeting.status === "running" || room.meeting.status === "awaiting_operator")
    && room.meeting.currentRoundKind !== "summary"
  );
}

export function canAddOperatorComment(room: MeetingRoomDTO): boolean {
  return (
    room.meeting.status !== "draft"
    && room.meeting.status !== "completed"
    && room.meeting.status !== "partial_completed"
    && room.meeting.status !== "failed"
    && room.meeting.status !== "cancelled"
  );
}

export function shouldCollapseMeetingTranscriptEntry(entry: MeetingTranscriptEntry): boolean {
  return entry.entryKind === "round_summary";
}

export function summarizeMeetingTranscriptEntry(entry: MeetingTranscriptEntry): string {
  if (entry.entryKind !== "round_summary") return "";

  const respondedCount = entry.body.match(/수집된 응답:\s*(\d+)건/u)?.[1] ?? null;
  const parts = [`라운드 ${entry.roundNumber ?? "?"} 정리`];
  if (respondedCount) {
    parts.push(`응답 ${respondedCount}건`);
  }
  return parts.join(" · ");
}

export function summarizeCurrentRoundPanel(room: MeetingRoomDTO): string {
  const total = room.currentRoundParticipants.length;
  if (total === 0) {
    return "지금 볼 참가자 상태가 없습니다";
  }

  const responded = room.currentRoundParticipants.filter((participant) => participant.status === "responded").length;
  if (responded === total) {
    return `모두 응답했습니다 (${responded}/${total})`;
  }

  const attentionCount = room.currentRoundParticipants.filter((participant) =>
    participant.status === "blocked"
    || participant.status === "failed"
    || participant.status === "timed_out"
    || participant.status === "late",
  ).length;
  const waiting = total - responded;

  if (attentionCount > 0) {
    return `응답 ${responded}/${total} · 확인 필요 ${attentionCount}`;
  }

  return `응답 ${responded}/${total} · 대기 ${waiting}`;
}

export function shouldAutoCollapseCurrentRoundPanel(room: MeetingRoomDTO): boolean {
  const total = room.currentRoundParticipants.length;
  if (total === 0) {
    return true;
  }

  const responded = room.currentRoundParticipants.filter((participant) => participant.status === "responded").length;
  if (responded === total) {
    return true;
  }

  return room.meeting.status === "completed" || room.meeting.status === "partial_completed";
}

export function describeMeetingOverview(room: MeetingRoomDTO): MeetingOverview {
  const currentRound = room.rounds.find((round) => round.roundNumber === room.meeting.currentRoundNumber) ?? null;
  const totalParticipants = room.currentRoundParticipants.length;
  const respondedParticipants = room.currentRoundParticipants.filter((participant) => participant.status === "responded").length;
  const transcriptNewestFirst = [...room.transcript].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const finalSummaryEntry = transcriptNewestFirst.find((entry) => entry.entryKind === "final_summary") ?? null;
  const operatorCommentEntry = transcriptNewestFirst.find((entry) => entry.entryKind === "operator_comment") ?? null;
  const roundSummaryEntry = transcriptNewestFirst.find((entry) => entry.entryKind === "round_summary") ?? null;

  const conclusion = finalSummaryEntry
    ? (
      findMeetingSectionLine(finalSummaryEntry.body, ["최종 결론", "권장 결론", "한 줄 결론", "한줄 결론"])
      ?? firstMeaningfulMeetingLine(finalSummaryEntry.body)
      ?? "최종 정리가 준비되었습니다."
    )
    : operatorCommentEntry
      ? (
        findMeetingSectionLine(operatorCommentEntry.body, ["한 줄 결론", "한줄 결론"])
        ?? firstMeaningfulMeetingLine(operatorCommentEntry.body)
        ?? "내 의견이 추가되었습니다."
      )
      : roundSummaryEntry
        ? summarizeMeetingTranscriptEntry(roundSummaryEntry)
        : room.meeting.status === "running"
          ? "참가자 의견을 모으는 중입니다."
          : room.meeting.status === "awaiting_operator"
            ? "현재까지 모인 의견을 보고 다음 행동을 정할 단계입니다."
            : room.meeting.status === "completed" || room.meeting.status === "partial_completed"
              ? "회의 결론이 정리되었습니다."
              : "회의 준비 상태를 먼저 확인해 주세요.";

  let currentDecision = "현재 상태를 확인해 주세요.";
  if (room.meeting.status === "draft") {
    currentDecision = "아직 회의를 시작하지 않았습니다.";
  } else if (room.meeting.status === "running") {
    currentDecision = totalParticipants > 0
      ? `현재 ${formatMeetingRoundKindLabel(room.meeting.currentRoundKind)} 라운드에서 응답 ${respondedParticipants}/${totalParticipants}건을 모으는 중입니다.`
      : "현재 라운드가 열려 있지만 아직 표시할 참가자 상태가 없습니다.";
  } else if (room.meeting.status === "awaiting_operator") {
    if (canFinalizeMeeting(room)) {
      currentDecision = "최종 요약은 준비됐고, 회의는 아직 닫히지 않았습니다.";
    } else if (currentRound?.kind === "summary") {
      currentDecision = "최종 요약을 보고 종료할지, 다시 토론할지 운영자가 정할 차례입니다.";
    } else if (totalParticipants > 0) {
      currentDecision = `현재 라운드 응답은 ${respondedParticipants}/${totalParticipants}건까지 확인됐습니다.`;
    } else {
      currentDecision = "현재까지 모인 의견을 검토한 뒤 다음 단계를 정할 수 있습니다.";
    }
  } else if (room.meeting.status === "paused") {
    currentDecision = "회의가 잠시 멈춰 있고, 재개 전까지 새 응답은 더 진행되지 않습니다.";
  } else if (room.meeting.status === "failed") {
    currentDecision = "진행 실패 상태라 원인 확인과 다음 조치 판단이 필요합니다.";
  } else if (room.meeting.status === "completed" || room.meeting.status === "partial_completed") {
    currentDecision = "회의는 종료됐고, 결론과 후속 작업만 정리하면 됩니다.";
  }

  let nextAction = "현재 상태를 확인해 다음 행동을 정하세요.";
  if (canStartMeeting(room)) {
    nextAction = "회의 시작을 눌러 첫 의견 수집을 시작하세요.";
  } else if (canFinalizeMeeting(room)) {
    nextAction = "요약을 확인한 뒤 회의를 종료하거나, 더 논의가 필요하면 전원 재토론을 여세요.";
  } else if (canReopenDiscussion(room)) {
    nextAction = "지금 결론으로 충분하면 회의를 종료하고, 더 얘기해야 하면 전원 재토론을 여세요.";
  } else if (canContinueMeeting(room)) {
    nextAction = `${continueMeetingLabel(room)} 버튼으로 자연스럽게 이어가세요.`;
  } else if (canRequestMeetingSummary(room)) {
    nextAction = "토론이 충분하면 최종 요약으로 넘기고, 더 필요하면 조금 더 기다리세요.";
  } else if (room.meeting.status === "running") {
    nextAction = "응답이 더 들어올 때까지 기다리거나, 필요하면 일시중지로 흐름을 조절하세요.";
  } else if (room.meeting.status === "paused") {
    nextAction = "준비되면 재개를 눌러 토론을 다시 이어가세요.";
  } else if (room.meeting.status === "completed" || room.meeting.status === "partial_completed") {
    nextAction = "결론을 확인하고 필요한 후속 작업만 정리하면 됩니다.";
  } else if (room.meeting.status === "failed") {
    nextAction = "최근 진행 안내를 확인한 뒤 재시도 여부를 판단하세요.";
  }

  if (canFinalizeMeeting(room) || currentRound?.kind === "summary") {
    return {
      conclusion,
      currentDecision,
      nextAction,
      ownerKind: "summary_agent",
      ownerAgentIds: room.meeting.summaryAgentId ? [room.meeting.summaryAgentId] : [],
    };
  }

  if (room.meeting.status === "running" && room.currentRoundParticipants.length > 0) {
    const waitingAgentIds = room.currentRoundParticipants
      .filter((participant) => participant.status !== "responded")
      .map((participant) => participant.agentId);
    return {
      conclusion,
      currentDecision,
      nextAction,
      ownerKind: "current_round_participants",
      ownerAgentIds: waitingAgentIds.length > 0 ? waitingAgentIds : room.currentRoundParticipants.map((participant) => participant.agentId),
    };
  }

  return {
    conclusion,
    currentDecision,
    nextAction,
    ownerKind: "operator",
    ownerAgentIds: [],
  };
}

export function canRemindMeetingParticipant(
  room: MeetingRoomDTO,
  participant: MeetingCurrentRoundParticipantSummary,
): boolean {
  const currentRound = room.rounds.find((round) => round.roundNumber === room.meeting.currentRoundNumber) ?? null;
  if (!currentRound) return false;
  if (!["collecting", "awaiting_operator", "timed_out"].includes(currentRound.status)) return false;
  return participant.status !== "responded";
}

export function canSkipMeetingParticipant(
  room: MeetingRoomDTO,
  participant: MeetingCurrentRoundParticipantSummary,
): boolean {
  const currentRound = room.rounds.find((round) => round.roundNumber === room.meeting.currentRoundNumber) ?? null;
  if (!currentRound) return false;
  if (!["collecting", "awaiting_operator"].includes(currentRound.status)) return false;
  return participant.status !== "responded";
}

export function estimateMeetingExecution(room: MeetingRoomDTO): MeetingExecutionEstimate {
  const participantCount = room.participants.length;
  const maxDiscussionRounds = room.meeting.maxDiscussionRounds;
  const estimatedTotalRounds = 1 + maxDiscussionRounds + 1;
  const maxResponses = participantCount * (1 + maxDiscussionRounds) + 1;
  const estimatedPromptTokensMin = participantCount * (1 + maxDiscussionRounds) * 350 + 700;
  const estimatedPromptTokensMax = participantCount * (1 + maxDiscussionRounds) * 900 + 1600;
  return {
    participantCount,
    maxDiscussionRounds,
    estimatedTotalRounds,
    maxResponses,
    estimatedPromptTokensMin,
    estimatedPromptTokensMax,
  };
}

export function formatMeetingDurationLabel(responseTimeoutSec: number): string {
  if (responseTimeoutSec % 3600 === 0) return `${responseTimeoutSec / 3600}시간`;
  if (responseTimeoutSec % 60 === 0) return `${responseTimeoutSec / 60}분`;
  return `${responseTimeoutSec}초`;
}

export function meetingGuardrailNotes(room: MeetingRoomDTO): string[] {
  const notes: string[] = [];
  if (room.participants.length > 3) {
    notes.push("참가자가 4명 이상이라 응답 수와 비용이 빠르게 늘어날 수 있습니다.");
  }
  if (room.meeting.maxDiscussionRounds > 1) {
    notes.push("토론 라운드가 2회 이상이면 회의 시간이 길어지고 최종 요약 입력도 커집니다.");
  }
  if (room.meeting.responseTimeoutSec > 30 * 60) {
    notes.push("응답 마감이 30분을 넘어서 진행 중 상태가 오래 유지될 수 있습니다.");
  }
  if (!room.meeting.autoContinue) {
    notes.push("자동 진행이 꺼져 있어 라운드 사이마다 운영자 판단이 필요할 수 있습니다.");
  }
  return notes;
}

export function describeMeetingStatus(room: MeetingRoomDTO): MeetingStatusNotice {
  const currentRound = room.rounds.find((round) => round.roundNumber === room.meeting.currentRoundNumber) ?? null;
  if (room.meeting.status === "draft") {
    return {
      tone: "neutral",
      title: "회의 시작 전입니다",
      body: "시작을 누르면 오프닝 라운드가 열리고 참가자별 응답 수집이 바로 시작됩니다.",
    };
  }
  if (room.meeting.status === "awaiting_operator") {
    if (currentRound?.kind === "summary" && currentRound.status === "completed") {
      return {
        tone: "warning",
        title: "최종 요약이 준비되었습니다",
        body: "요약 결론을 검토한 뒤 회의를 종료하거나, 더 논의가 필요하면 전원 재토론을 다시 여세요.",
      };
    }
    return {
      tone: "warning",
      title: "운영자 판단이 필요합니다",
      body: "재촉, 건너뛰기, 다음 라운드 진행, 최종 요약 중 현재 상황에 맞는 액션을 선택하세요.",
    };
  }
  if (room.meeting.status === "paused") {
    return {
      tone: "warning",
      title: "회의가 일시중지되었습니다",
      body: "재개하기 전까지 새 라운드 전이와 자동 dispatch가 멈춰 있습니다.",
    };
  }
  if (room.meeting.status === "failed") {
    return {
      tone: "error",
      title: "회의 진행이 실패했습니다",
      body: "최근 운영자 신호와 참가자 상태를 확인한 뒤 재시도 경로를 판단해야 합니다.",
    };
  }
  if (room.meeting.status === "partial_completed") {
    return {
      tone: "success",
      title: "회의가 부분 완료로 종료되었습니다",
      body: "최종 요약은 생성됐지만 일부 참가자는 timeout, skip, failure 이력이 남아 있습니다.",
    };
  }
  if (room.meeting.status === "completed") {
    return {
      tone: "success",
      title: "회의가 완료되었습니다",
      body: "최종 요약이 정리됐고 더 이상 새 라운드는 열리지 않습니다.",
    };
  }
  return {
    tone: "neutral",
    title: "회의가 진행 중입니다",
    body: "현재 라운드 응답과 운영자 신호를 보면서 다음 전이를 준비하세요.",
  };
}
