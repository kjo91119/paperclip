import type {
  IssueMeetingMode,
  IssueMeetingRoundKind,
  IssueMeetingRoundStatus,
  IssueMeetingStatus,
  IssueSystemCommentKind,
} from "../constants.js";

export type MeetingTranscriptEntryKind =
  | "round_opened"
  | "participant_response"
  | "participant_response_extra"
  | "round_summary"
  | "final_summary"
  | "late_response"
  | "operator_signal"
  | "meeting_completed";

export interface MeetingSummary {
  id: string;
  companyId: string;
  rootIssueId: string;
  facilitatorAgentId: string | null;
  summaryAgentId: string | null;
  status: IssueMeetingStatus;
  agenda: string;
  referencePath: string | null;
  projectId: string | null;
  goalId: string | null;
  billingCode: string | null;
  maxDiscussionRounds: number;
  responseTimeoutSec: number;
  autoStart: boolean;
  autoContinue: boolean;
  currentRoundNumber: number | null;
  currentRoundKind: IssueMeetingRoundKind | null;
  needsAttention: boolean;
  lastOperatorSignalCommentId: string | null;
  lastRoundCompletedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MeetingParticipantSummary {
  id: string;
  agentId: string;
  childIssueId: string;
  speakingOrder: number;
  status: "active" | "removed";
  isFacilitator: boolean;
  isSummarizer: boolean;
}

export interface MeetingRoundSummary {
  id: string;
  roundNumber: number;
  kind: IssueMeetingRoundKind;
  status: IssueMeetingRoundStatus;
  deadlineAt: Date | null;
  completedAt: Date | null;
}

export interface MeetingTranscriptEntry {
  entryKind: MeetingTranscriptEntryKind;
  roundNumber: number | null;
  roundKind: IssueMeetingRoundKind | null;
  participantAgentId: string | null;
  sourceIssueId: string | null;
  sourceCommentId: string | null;
  sourceCommentIds?: string[];
  authorKind: "agent" | "user" | "system";
  systemCommentKind: IssueSystemCommentKind | null;
  body: string;
  createdAt: Date;
  respondedAt: Date | null;
  speakingOrder: number | null;
}

export interface MeetingRoomIssueSummary {
  id: string;
  title: string;
  projectId: string | null;
  goalId: string | null;
  meetingId: string;
  meetingMode: IssueMeetingMode;
}

export interface MeetingRoomDTO {
  meeting: MeetingSummary;
  rootIssue: MeetingRoomIssueSummary;
  participants: MeetingParticipantSummary[];
  rounds: MeetingRoundSummary[];
  transcript: MeetingTranscriptEntry[];
}
