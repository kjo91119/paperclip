import type {
  IssueMeetingRoundKind,
  IssueMeetingRoundParticipantStatus,
  IssueMeetingStatus,
  MeetingCurrentRoundParticipantSummary,
  MeetingRoomDTO,
} from "@paperclipai/shared";

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
