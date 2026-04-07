import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  issueMeetings,
  issueMeetingParticipants,
  issueMeetingRounds,
  issues,
} from "@paperclipai/db";
import type { MeetingRoomDTO } from "@paperclipai/shared";

function deriveNeedsAttention(status: string) {
  return status === "awaiting_operator" || status === "failed";
}

function rootIssueStatusForMeetingStatus(status: string) {
  if (status === "draft") return "backlog";
  if (status === "running") return "in_progress";
  if (status === "awaiting_operator" || status === "paused" || status === "failed") return "blocked";
  if (status === "completed" || status === "partial_completed") return "done";
  if (status === "cancelled") return "cancelled";
  return "backlog";
}

export function meetingService(db: Db) {
  async function findMeetingByIssueId(issueId: string) {
    const rootMeeting = await db
      .select()
      .from(issueMeetings)
      .where(eq(issueMeetings.rootIssueId, issueId))
      .then((rows) => rows[0] ?? null);
    if (rootMeeting) return rootMeeting;

    const childMeeting = await db
      .select({ meeting: issueMeetings })
      .from(issueMeetingParticipants)
      .innerJoin(issueMeetings, eq(issueMeetingParticipants.meetingId, issueMeetings.id))
      .where(eq(issueMeetingParticipants.childIssueId, issueId))
      .then((rows) => rows[0]?.meeting ?? null);
    return childMeeting;
  }

  async function buildMeetingRoomDto(meetingId: string): Promise<MeetingRoomDTO | null> {
    const meeting = await db
      .select()
      .from(issueMeetings)
      .where(eq(issueMeetings.id, meetingId))
      .then((rows) => rows[0] ?? null);
    if (!meeting) return null;

    const [rootIssue, participants, rounds] = await Promise.all([
      db
        .select({
          id: issues.id,
          title: issues.title,
          projectId: issues.projectId,
          goalId: issues.goalId,
        })
        .from(issues)
        .where(and(eq(issues.id, meeting.rootIssueId), eq(issues.companyId, meeting.companyId)))
        .then((rows) => rows[0] ?? null),
      db
        .select()
        .from(issueMeetingParticipants)
        .where(eq(issueMeetingParticipants.meetingId, meeting.id)),
      db
        .select()
        .from(issueMeetingRounds)
        .where(eq(issueMeetingRounds.meetingId, meeting.id)),
    ]);

    if (!rootIssue) return null;
    const currentRound = rounds.find((round) => round.roundNumber === meeting.currentRoundNumber) ?? null;

    return {
      meeting: {
        id: meeting.id,
        companyId: meeting.companyId,
        rootIssueId: meeting.rootIssueId,
        facilitatorAgentId: meeting.facilitatorAgentId,
        summaryAgentId: meeting.summaryAgentId,
        status: meeting.status as MeetingRoomDTO["meeting"]["status"],
        agenda: meeting.agenda,
        referencePath: meeting.referencePath,
        projectId: meeting.projectId,
        goalId: meeting.goalId,
        billingCode: meeting.billingCode,
        maxDiscussionRounds: meeting.maxDiscussionRounds,
        responseTimeoutSec: meeting.responseTimeoutSec,
        autoStart: meeting.autoStart,
        autoContinue: meeting.autoContinue,
        currentRoundNumber: meeting.currentRoundNumber,
        currentRoundKind: (currentRound?.kind as MeetingRoomDTO["meeting"]["currentRoundKind"]) ?? null,
        needsAttention: deriveNeedsAttention(meeting.status),
        lastOperatorSignalCommentId: meeting.lastOperatorSignalCommentId,
        lastRoundCompletedAt: meeting.lastRoundCompletedAt,
        completedAt: meeting.completedAt,
        createdAt: meeting.createdAt,
        updatedAt: meeting.updatedAt,
      },
      rootIssue: {
        id: rootIssue.id,
        title: rootIssue.title,
        projectId: rootIssue.projectId,
        goalId: rootIssue.goalId,
        meetingId: meeting.id,
        meetingMode: "orchestrated",
      },
      participants: participants.map((participant) => ({
        id: participant.id,
        agentId: participant.agentId,
        childIssueId: participant.childIssueId,
        speakingOrder: participant.speakingOrder,
        status: participant.status as "active" | "removed",
        isFacilitator: participant.isFacilitator,
        isSummarizer: participant.isSummarizer,
      })),
      rounds: rounds.map((round) => ({
        id: round.id,
        roundNumber: round.roundNumber,
        kind: round.kind as MeetingRoomDTO["rounds"][number]["kind"],
        status: round.status as MeetingRoomDTO["rounds"][number]["status"],
        deadlineAt: round.deadlineAt,
        completedAt: round.completedAt,
      })),
      transcript: [],
    };
  }

  return {
    getById: buildMeetingRoomDto,
    getByIssueId: async (issueId: string) => {
      const meeting = await findMeetingByIssueId(issueId);
      if (!meeting) return null;
      return buildMeetingRoomDto(meeting.id);
    },
    syncRootIssueStatusMirror: async (
      tx: Pick<Db, "update">,
      input: { rootIssueId: string; meetingStatus: string },
    ) =>
      tx
        .update(issues)
        .set({
          status: rootIssueStatusForMeetingStatus(input.meetingStatus),
          updatedAt: new Date(),
        })
        .where(eq(issues.id, input.rootIssueId)),
  };
}
