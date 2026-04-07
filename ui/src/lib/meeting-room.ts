import type {
  IssueMeetingRoundKind,
  IssueMeetingRoundParticipantStatus,
  IssueMeetingStatus,
  MeetingCurrentRoundParticipantSummary,
  MeetingRoomDTO,
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

export function canRequestMeetingSummary(room: MeetingRoomDTO): boolean {
  return (
    (room.meeting.status === "running" || room.meeting.status === "awaiting_operator")
    && room.meeting.currentRoundKind !== "summary"
  );
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
  if (room.meeting.status === "draft") {
    return {
      tone: "neutral",
      title: "회의 시작 전입니다",
      body: "시작을 누르면 오프닝 라운드가 열리고 참가자별 응답 수집이 바로 시작됩니다.",
    };
  }
  if (room.meeting.status === "awaiting_operator") {
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
