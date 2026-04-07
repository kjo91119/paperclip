import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agentWakeupRequests,
  agents,
  issueComments,
  issueMeetingParticipants,
  issueMeetingRoundParticipants,
  issueMeetingRounds,
  issueMeetings,
  issues,
} from "@paperclipai/db";
import type {
  CreateMeeting,
  IssueMeetingRoundKind,
  IssueMeetingRoundParticipantStatus,
  IssueMeetingStatus,
  IssueSystemCommentKind,
  MeetingRoomDTO,
} from "@paperclipai/shared";
import { conflict, notFound, unprocessable } from "../errors.js";
import { logActivity } from "./activity-log.js";
import { heartbeatService } from "./heartbeat.js";
import { issueService } from "./issues.js";

const MEETING_SYSTEM_AUTHOR_KEY = "meeting_orchestrator";
const MEETING_SYSTEM_ACTOR_ID = "meeting_orchestrator";
const ACTIVE_PARTICIPANT_STATUSES = new Set<IssueMeetingRoundParticipantStatus>([
  "pending_dispatch",
  "queued",
  "deferred",
  "coalesced",
  "running",
]);
const RESPONDED_PARTICIPANT_STATUSES = new Set<IssueMeetingRoundParticipantStatus>(["responded"]);
const TERMINAL_MEETING_STATUSES = new Set<IssueMeetingStatus>([
  "completed",
  "partial_completed",
  "failed",
  "cancelled",
]);

type MeetingActor = {
  actorType: "user" | "agent" | "system";
  actorId: string;
  agentId?: string | null;
  runId?: string | null;
};

type MeetingDispatchWakeupInput = {
  companyId: string;
  meetingId: string;
  roundId: string;
  roundNumber: number;
  participantId: string;
  agentId: string;
  childIssueId: string;
  commentId: string;
  idempotencyKey: string;
  actor: MeetingActor;
};

type MeetingDispatchWakeupResult = {
  wakeupRequestId: string | null;
  wakeupStatus: string | null;
  runId: string | null;
  participantStatus: IssueMeetingRoundParticipantStatus;
  failureReason: string | null;
  lastErrorCode: string | null;
  skipReason: string | null;
};

type MeetingServiceDeps = {
  now?: () => Date;
  dispatchWakeup?: (input: MeetingDispatchWakeupInput) => Promise<MeetingDispatchWakeupResult>;
};

type MeetingRow = typeof issueMeetings.$inferSelect;
type MeetingRoundRow = typeof issueMeetingRounds.$inferSelect;

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

function actorForLog(actor: MeetingActor) {
  return {
    actorType: actor.actorType,
    actorId: actor.actorId,
    agentId: actor.agentId ?? null,
    runId: actor.runId ?? null,
  };
}

function meetingTitleFromAgenda(agenda: string) {
  const compact = agenda.replace(/\s+/g, " ").trim();
  return `[전체회의] ${compact.slice(0, 120)}`;
}

function meetingRootDescription(input: { agenda: string; participantNames: string[]; referencePath: string | null }) {
  const lines = [
    "회의 형식: 오케스트레이트 전체회의",
    "",
    "안건:",
    input.agenda.trim(),
  ];

  if (input.referencePath) {
    lines.push("", "참고 경로:", input.referencePath);
  }

  if (input.participantNames.length > 0) {
    lines.push("", "참가자:");
    for (const name of input.participantNames) {
      lines.push(`- ${name}`);
    }
  }

  return lines.join("\n");
}

function childIssueTitle(agentName: string, agenda: string) {
  const compact = agenda.replace(/\s+/g, " ").trim();
  return `[회의][${agentName}] ${compact.slice(0, 96)} 응답`;
}

function roundOpenedBody(input: { roundNumber: number; agenda: string }) {
  return [
    `라운드 ${input.roundNumber} 시작`,
    "",
    "이번 라운드는 전체회의 1차 의견 수집 단계입니다.",
    "",
    "안건:",
    input.agenda.trim(),
  ].join("\n");
}

function openingPromptBody(input: {
  agenda: string;
  participantNames: string[];
  facilitatorName: string | null;
  referencePath: string | null;
}) {
  const lines = [
    "전체회의 라운드 1 응답 요청",
    "",
    "이 라운드에서는 다른 참가자의 의견을 추측하지 말고, 당신의 독립적인 1차 의견만 답해 주세요.",
    "",
    "안건:",
    input.agenda.trim(),
  ];

  if (input.referencePath) {
    lines.push("", "참고 경로:", input.referencePath);
  }

  if (input.facilitatorName) {
    lines.push("", `진행자: ${input.facilitatorName}`);
  }

  if (input.participantNames.length > 0) {
    lines.push("", "참가자:");
    for (const name of input.participantNames) {
      lines.push(`- ${name}`);
    }
  }

  lines.push(
    "",
    "답변 형식:",
    "1. 한줄 결론",
    "2. 핵심 근거 3개 이내",
    "3. 가장 큰 리스크 1개",
  );

  return lines.join("\n");
}

function roundSummaryBody(input: {
  roundNumber: number;
  agenda: string;
  entries: Array<{ agentName: string; body: string }>;
}) {
  const lines = [
    `라운드 ${input.roundNumber} 요약`,
    "",
    "이 요약은 참가자 응답을 기계적으로 정리한 projection입니다.",
    "",
    "안건:",
    input.agenda.trim(),
    "",
    `수집된 응답: ${input.entries.length}건`,
  ];

  for (const entry of input.entries) {
    lines.push("", `### ${entry.agentName}`, entry.body.trim());
  }

  return lines.join("\n");
}

function operatorAttentionBody(input: {
  roundNumber: number;
  responded: number;
  total: number;
  reason: "round_complete" | "timeout_zero" | "partial_timeout";
}) {
  if (input.reason === "round_complete") {
    return [
      `라운드 ${input.roundNumber} 수집이 완료되었습니다.`,
      "",
      `응답 수: ${input.responded}/${input.total}`,
      "",
      "다음 단계 결정을 위해 운영자 확인이 필요합니다.",
    ].join("\n");
  }

  if (input.reason === "timeout_zero") {
    return [
      `라운드 ${input.roundNumber} 응답 시간이 종료되었습니다.`,
      "",
      `응답 수: 0/${input.total}`,
      "",
      "재촉(remind) 또는 회의 취소 중 하나를 선택해 주세요.",
    ].join("\n");
  }

  return [
    `라운드 ${input.roundNumber} 응답 시간이 종료되었습니다.`,
    "",
    `응답 수: ${input.responded}/${input.total}`,
    "",
    "부분 응답 상태입니다. 재촉(remind), 이후 단계 진행, 또는 취소 중 하나를 선택해 주세요.",
  ].join("\n");
}

function participantStatusFromWakeupRequest(request: typeof agentWakeupRequests.$inferSelect | null): MeetingDispatchWakeupResult {
  if (!request) {
    return {
      wakeupRequestId: null,
      wakeupStatus: null,
      runId: null,
      participantStatus: "failed",
      failureReason: "Dispatch wakeup request was not persisted",
      lastErrorCode: "wakeup.request.missing",
      skipReason: null,
    };
  }

  if (request.status === "queued") {
    return {
      wakeupRequestId: request.id,
      wakeupStatus: request.status,
      runId: request.runId ?? null,
      participantStatus: "queued",
      failureReason: null,
      lastErrorCode: null,
      skipReason: null,
    };
  }

  if (request.status === "coalesced") {
    return {
      wakeupRequestId: request.id,
      wakeupStatus: request.status,
      runId: request.runId ?? null,
      participantStatus: "coalesced",
      failureReason: null,
      lastErrorCode: null,
      skipReason: null,
    };
  }

  if (request.status === "deferred_issue_execution") {
    return {
      wakeupRequestId: request.id,
      wakeupStatus: request.status,
      runId: request.runId ?? null,
      participantStatus: "deferred",
      failureReason: null,
      lastErrorCode: null,
      skipReason: null,
    };
  }

  if (request.status === "skipped") {
    const blocked = request.reason === "budget.blocked";
    return {
      wakeupRequestId: request.id,
      wakeupStatus: request.status,
      runId: request.runId ?? null,
      participantStatus: blocked ? "blocked" : "skipped",
      failureReason: blocked ? request.reason ?? "Dispatch blocked" : null,
      lastErrorCode: blocked ? "budget.blocked" : null,
      skipReason: blocked ? null : request.reason ?? "wakeup.skipped",
    };
  }

  return {
    wakeupRequestId: request.id,
    wakeupStatus: request.status,
    runId: request.runId ?? null,
    participantStatus: request.runId ? "running" : "failed",
    failureReason: request.error ?? null,
    lastErrorCode: request.status,
    skipReason: null,
  };
}

function uniqueParticipantIds(ids: string[]) {
  return [...new Set(ids)];
}

export function meetingService(db: Db, deps: MeetingServiceDeps = {}) {
  const issueSvc = issueService(db);
  const heartbeat = heartbeatService(db);
  const now = deps.now ?? (() => new Date());

  async function syncRootIssueStatusMirror(
    tx: Pick<Db, "update">,
    input: { rootIssueId: string; meetingStatus: string },
  ) {
    await tx
      .update(issues)
      .set({
        status: rootIssueStatusForMeetingStatus(input.meetingStatus),
        updatedAt: now(),
      })
      .where(eq(issues.id, input.rootIssueId));
  }

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

  async function getCurrentRound(meetingId: string, currentRoundNumber: number | null) {
    if (!currentRoundNumber) return null;
    return db
      .select()
      .from(issueMeetingRounds)
      .where(and(eq(issueMeetingRounds.meetingId, meetingId), eq(issueMeetingRounds.roundNumber, currentRoundNumber)))
      .then((rows) => rows[0] ?? null);
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
        .where(eq(issueMeetingParticipants.meetingId, meeting.id))
        .orderBy(asc(issueMeetingParticipants.speakingOrder), asc(issueMeetingParticipants.createdAt)),
      db
        .select()
        .from(issueMeetingRounds)
        .where(eq(issueMeetingRounds.meetingId, meeting.id))
        .orderBy(asc(issueMeetingRounds.roundNumber)),
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

  async function logMeetingActivity(
    actor: MeetingActor,
    companyId: string,
    meetingId: string,
    action: string,
    details: Record<string, unknown> | null = null,
  ) {
    await logActivity(db, {
      companyId,
      ...actorForLog(actor),
      action,
      entityType: "issue_meeting",
      entityId: meetingId,
      details,
    });
  }

  async function loadParticipantRoster(meetingId: string) {
    return db
      .select({
        participantId: issueMeetingParticipants.id,
        agentId: issueMeetingParticipants.agentId,
        childIssueId: issueMeetingParticipants.childIssueId,
        speakingOrder: issueMeetingParticipants.speakingOrder,
        isFacilitator: issueMeetingParticipants.isFacilitator,
        isSummarizer: issueMeetingParticipants.isSummarizer,
        agentName: agents.name,
      })
      .from(issueMeetingParticipants)
      .innerJoin(agents, eq(issueMeetingParticipants.agentId, agents.id))
      .where(eq(issueMeetingParticipants.meetingId, meetingId))
      .orderBy(asc(issueMeetingParticipants.speakingOrder), asc(issueMeetingParticipants.createdAt));
  }

  async function defaultDispatchWakeup(input: MeetingDispatchWakeupInput): Promise<MeetingDispatchWakeupResult> {
    try {
      await heartbeat.wakeup(input.agentId, {
        source: "automation",
        triggerDetail: "system",
        reason: "meeting_round_dispatch",
        payload: {
          meetingId: input.meetingId,
          roundId: input.roundId,
          roundNumber: input.roundNumber,
          issueId: input.childIssueId,
          commentId: input.commentId,
          participantId: input.participantId,
        },
        idempotencyKey: input.idempotencyKey,
        requestedByActorType: input.actor.actorType,
        requestedByActorId: input.actor.actorId,
        contextSnapshot: {
          meetingId: input.meetingId,
          roundId: input.roundId,
          roundNumber: input.roundNumber,
          participantId: input.participantId,
          issueId: input.childIssueId,
          taskId: input.childIssueId,
          commentId: input.commentId,
          wakeCommentId: input.commentId,
          wakeReason: "meeting_round_dispatch",
          source: "meeting.round.dispatch",
        },
      });
    } catch (err) {
      const request = await db
        .select()
        .from(agentWakeupRequests)
        .where(
          and(
            eq(agentWakeupRequests.companyId, input.companyId),
            eq(agentWakeupRequests.agentId, input.agentId),
            eq(agentWakeupRequests.idempotencyKey, input.idempotencyKey),
          ),
        )
        .orderBy(desc(agentWakeupRequests.requestedAt))
        .limit(1)
        .then((rows) => rows[0] ?? null);

      if (request) {
        return participantStatusFromWakeupRequest(request);
      }

      return {
        wakeupRequestId: null,
        wakeupStatus: null,
        runId: null,
        participantStatus: "failed",
        failureReason: err instanceof Error ? err.message : "Dispatch wakeup failed",
        lastErrorCode: "wakeup.exception",
        skipReason: null,
      };
    }

    const request = await db
      .select()
      .from(agentWakeupRequests)
      .where(
        and(
          eq(agentWakeupRequests.companyId, input.companyId),
          eq(agentWakeupRequests.agentId, input.agentId),
          eq(agentWakeupRequests.idempotencyKey, input.idempotencyKey),
        ),
      )
      .orderBy(desc(agentWakeupRequests.requestedAt))
      .limit(1)
      .then((rows) => rows[0] ?? null);

    return participantStatusFromWakeupRequest(request);
  }

  async function refreshMeetingState(meetingId: string) {
    const meeting = await db
      .select()
      .from(issueMeetings)
      .where(eq(issueMeetings.id, meetingId))
      .then((rows) => rows[0] ?? null);
    if (!meeting || TERMINAL_MEETING_STATUSES.has(meeting.status as IssueMeetingStatus) || meeting.status === "paused") {
      return meeting;
    }

    const round = await getCurrentRound(meeting.id, meeting.currentRoundNumber);
    if (!round || round.status !== "collecting" || !round.deadlineAt) return meeting;

    if (round.deadlineAt.getTime() > now().getTime()) return meeting;

    const participantRows = await db
      .select()
      .from(issueMeetingRoundParticipants)
      .where(eq(issueMeetingRoundParticipants.roundId, round.id));
    const respondedCount = participantRows.filter((row) =>
      RESPONDED_PARTICIPANT_STATUSES.has(row.status as IssueMeetingRoundParticipantStatus)
    ).length;
    const total = participantRows.length;
    const timeoutAt = now();

    await db.transaction(async (tx) => {
      const issueSvcTx = issueService(db);

      const nonRespondedIds = participantRows
        .filter((row) => !RESPONDED_PARTICIPANT_STATUSES.has(row.status as IssueMeetingRoundParticipantStatus))
        .map((row) => row.id);

      if (nonRespondedIds.length > 0) {
        await tx
          .update(issueMeetingRoundParticipants)
          .set({
            status: "timed_out",
            timedOutAt: timeoutAt,
            updatedAt: timeoutAt,
            lastErrorCode: "round.timeout",
          })
          .where(inArray(issueMeetingRoundParticipants.id, nonRespondedIds));
      }

      const attentionComment = await issueSvcTx.addCommentInTx(tx, meeting.rootIssueId, {
        body: operatorAttentionBody({
          roundNumber: round.roundNumber,
          responded: respondedCount,
          total,
          reason: respondedCount === 0 ? "timeout_zero" : "partial_timeout",
        }),
        systemKey: MEETING_SYSTEM_AUTHOR_KEY,
        systemCommentKind: "operator_attention",
      });

      await tx
        .update(issueMeetingRounds)
        .set({
          status: respondedCount === 0 ? "timed_out" : "awaiting_operator",
          completedAt: respondedCount === 0 ? null : timeoutAt,
          updatedAt: timeoutAt,
          transitionVersion: sql`${issueMeetingRounds.transitionVersion} + 1`,
        })
        .where(eq(issueMeetingRounds.id, round.id));

      await tx
        .update(issueMeetings)
        .set({
          status: "awaiting_operator",
          lastOperatorSignalCommentId: attentionComment.id,
          updatedAt: timeoutAt,
          transitionVersion: sql`${issueMeetings.transitionVersion} + 1`,
        })
        .where(eq(issueMeetings.id, meeting.id));

      await syncRootIssueStatusMirror(tx, {
        rootIssueId: meeting.rootIssueId,
        meetingStatus: "awaiting_operator",
      });
    });

    await logMeetingActivity(
      {
        actorType: "system",
        actorId: MEETING_SYSTEM_ACTOR_ID,
      },
      meeting.companyId,
      meeting.id,
      "meeting.operator_attention_set",
      {
        roundId: round.id,
        roundNumber: round.roundNumber,
        respondedCount,
        totalParticipants: total,
        reason: respondedCount === 0 ? "timeout_zero" : "partial_timeout",
      },
    );

    return db
      .select()
      .from(issueMeetings)
      .where(eq(issueMeetings.id, meeting.id))
      .then((rows) => rows[0] ?? null);
  }

  async function dispatchPendingParticipants(
    meetingId: string,
    roundId: string,
    actor: MeetingActor,
    participantIds?: string[],
  ) {
    const prepared = await db.transaction(async (tx) => {
      const issueSvcTx = issueService(db);
      const meeting = await tx
        .select()
        .from(issueMeetings)
        .where(eq(issueMeetings.id, meetingId))
        .then((rows) => rows[0] ?? null);
      if (!meeting) throw notFound("Meeting not found");

      const round = await tx
        .select()
        .from(issueMeetingRounds)
        .where(eq(issueMeetingRounds.id, roundId))
        .then((rows) => rows[0] ?? null);
      if (!round) throw notFound("Meeting round not found");
      if (round.status !== "dispatching") {
        return { meeting, round, rows: [] as Array<{
          roundParticipantId: string;
          participantId: string;
          agentId: string;
          childIssueId: string;
          commentId: string;
          roundNumber: number;
        }> };
      }

      const roster = await tx
        .select({
          roundParticipantId: issueMeetingRoundParticipants.id,
          participantId: issueMeetingRoundParticipants.participantId,
          agentId: issueMeetingRoundParticipants.agentId,
          childIssueId: issueMeetingRoundParticipants.childIssueId,
          speakingOrder: issueMeetingParticipants.speakingOrder,
          agentName: agents.name,
          isFacilitator: issueMeetingParticipants.isFacilitator,
        })
        .from(issueMeetingRoundParticipants)
        .innerJoin(issueMeetingParticipants, eq(issueMeetingRoundParticipants.participantId, issueMeetingParticipants.id))
        .innerJoin(agents, eq(issueMeetingRoundParticipants.agentId, agents.id))
        .where(
          and(
            eq(issueMeetingRoundParticipants.roundId, roundId),
            eq(issueMeetingRoundParticipants.status, "pending_dispatch"),
            participantIds?.length ? inArray(issueMeetingRoundParticipants.participantId, participantIds) : sql`true`,
          ),
        )
        .orderBy(asc(issueMeetingParticipants.speakingOrder), asc(issueMeetingRoundParticipants.createdAt));

      const participantNames = roster.map((row) => row.agentName);
      const facilitatorName = roster.find((row) => row.isFacilitator)?.agentName ?? null;
      const dispatchedAt = now();
      const rows: Array<{
        roundParticipantId: string;
        participantId: string;
        agentId: string;
        childIssueId: string;
        commentId: string;
        roundNumber: number;
      }> = [];

      for (const row of roster) {
        const promptComment = await issueSvcTx.addCommentInTx(tx, row.childIssueId, {
          body: openingPromptBody({
            agenda: meeting.agenda,
            participantNames,
            facilitatorName,
            referencePath: meeting.referencePath,
          }),
          systemKey: MEETING_SYSTEM_AUTHOR_KEY,
          systemCommentKind: "control_notice",
        });

        await tx
          .update(issues)
          .set({
            status: "todo",
            updatedAt: dispatchedAt,
          })
          .where(eq(issues.id, row.childIssueId));

        await tx
          .update(issueMeetingRoundParticipants)
          .set({
            dispatchPromptCommentId: promptComment.id,
            dispatchedAt,
            deadlineAt: round.deadlineAt,
            updatedAt: dispatchedAt,
          })
          .where(eq(issueMeetingRoundParticipants.id, row.roundParticipantId));

        rows.push({
          roundParticipantId: row.roundParticipantId,
          participantId: row.participantId,
          agentId: row.agentId,
          childIssueId: row.childIssueId,
          commentId: promptComment.id,
          roundNumber: round.roundNumber,
        });
      }

      return { meeting, round, rows };
    });

    const dispatchWakeup = deps.dispatchWakeup ?? defaultDispatchWakeup;
    for (const row of prepared.rows) {
      const idempotencyKey = `meeting:${meetingId}:round:${roundId}:participant:${row.participantId}:attempt:${Date.now()}:${row.commentId}`;
      const outcome = await dispatchWakeup({
        companyId: prepared.meeting.companyId,
        meetingId,
        roundId,
        roundNumber: row.roundNumber,
        participantId: row.participantId,
        agentId: row.agentId,
        childIssueId: row.childIssueId,
        commentId: row.commentId,
        idempotencyKey,
        actor,
      });

      await db
        .update(issueMeetingRoundParticipants)
        .set({
          status: outcome.participantStatus,
          dispatchAttemptCount: sql`${issueMeetingRoundParticipants.dispatchAttemptCount} + 1`,
          dispatchWakeupRequestId: outcome.wakeupRequestId,
          dispatchWakeupStatus: outcome.wakeupStatus,
          dispatchRunId: outcome.runId,
          failureReason: outcome.failureReason,
          lastErrorCode: outcome.lastErrorCode,
          skipReason: outcome.skipReason,
          skippedAt: outcome.participantStatus === "skipped" ? now() : null,
          updatedAt: now(),
        })
        .where(eq(issueMeetingRoundParticipants.id, row.roundParticipantId));

      await logMeetingActivity(actor, prepared.meeting.companyId, meetingId, "meeting.participant_dispatched", {
        roundId,
        participantId: row.participantId,
        agentId: row.agentId,
        childIssueId: row.childIssueId,
        dispatchWakeupStatus: outcome.wakeupStatus,
        participantStatus: outcome.participantStatus,
      });
    }

    await db
      .update(issueMeetingRounds)
      .set({
        status: "collecting",
        updatedAt: now(),
        transitionVersion: sql`${issueMeetingRounds.transitionVersion} + 1`,
      })
      .where(eq(issueMeetingRounds.id, roundId));
  }

  async function startMeetingById(meetingId: string, actor: MeetingActor) {
    const started = await db.transaction(async (tx) => {
      const issueSvcTx = issueService(db);
      const meeting = await tx
        .select()
        .from(issueMeetings)
        .where(eq(issueMeetings.id, meetingId))
        .then((rows) => rows[0] ?? null);
      if (!meeting) throw notFound("Meeting not found");

      const round = await getCurrentRound(meeting.id, meeting.currentRoundNumber);
      if (!round) throw conflict("Opening round not found");
      if (meeting.status !== "draft") {
        return { meeting, round, didStart: false };
      }

      const startedAt = now();
      const roundOpenComment = round.roundOpenRootCommentId
        ? { id: round.roundOpenRootCommentId }
        : await issueSvcTx.addCommentInTx(tx, meeting.rootIssueId, {
          body: roundOpenedBody({ roundNumber: round.roundNumber, agenda: meeting.agenda }),
          systemKey: MEETING_SYSTEM_AUTHOR_KEY,
          systemCommentKind: "round_opened",
        });

      await tx
        .update(issueMeetings)
        .set({
          status: "running",
          currentRoundNumber: round.roundNumber,
          updatedAt: startedAt,
          transitionVersion: sql`${issueMeetings.transitionVersion} + 1`,
        })
        .where(eq(issueMeetings.id, meeting.id));

      await tx
        .update(issueMeetingRounds)
        .set({
          status: "dispatching",
          startedAt: round.startedAt ?? startedAt,
          deadlineAt: round.deadlineAt ?? new Date(startedAt.getTime() + (meeting.responseTimeoutSec * 1000)),
          roundOpenRootCommentId: roundOpenComment.id,
          updatedAt: startedAt,
          transitionVersion: sql`${issueMeetingRounds.transitionVersion} + 1`,
        })
        .where(eq(issueMeetingRounds.id, round.id));

      await syncRootIssueStatusMirror(tx, {
        rootIssueId: meeting.rootIssueId,
        meetingStatus: "running",
      });

      return { meeting, round, didStart: true };
    });

    if (started.didStart) {
      await logMeetingActivity(actor, started.meeting.companyId, meetingId, "meeting.started", {
        roundId: started.round.id,
        roundNumber: started.round.roundNumber,
      });
      await dispatchPendingParticipants(meetingId, started.round.id, actor);
    }

    return getById(meetingId);
  }

  async function completeRoundWithSummary(meeting: MeetingRow, round: MeetingRoundRow, actor: MeetingActor) {
    const respondedRows = await db
      .select({
        participantId: issueMeetingRoundParticipants.participantId,
        responseCommentId: issueMeetingRoundParticipants.responseCommentId,
        childIssueId: issueMeetingRoundParticipants.childIssueId,
        speakingOrder: issueMeetingParticipants.speakingOrder,
        agentName: agents.name,
      })
      .from(issueMeetingRoundParticipants)
      .innerJoin(issueMeetingParticipants, eq(issueMeetingRoundParticipants.participantId, issueMeetingParticipants.id))
      .innerJoin(agents, eq(issueMeetingRoundParticipants.agentId, agents.id))
      .where(
        and(
          eq(issueMeetingRoundParticipants.roundId, round.id),
          isNotNull(issueMeetingRoundParticipants.responseCommentId),
        ),
      )
      .orderBy(asc(issueMeetingParticipants.speakingOrder), asc(issueMeetingRoundParticipants.createdAt));

    const responseCommentIds = respondedRows
      .map((row) => row.responseCommentId)
      .filter((id): id is string => Boolean(id));

    const commentMap = responseCommentIds.length > 0
      ? await db
        .select({ id: issueComments.id, body: issueComments.body })
        .from(issueComments)
        .where(inArray(issueComments.id, responseCommentIds))
        .then((rows) => new Map(rows.map((row) => [row.id, row.body])))
      : new Map<string, string>();

    await db.transaction(async (tx) => {
      const issueSvcTx = issueService(db);
      const summaryComment = await issueSvcTx.addCommentInTx(tx, meeting.rootIssueId, {
        body: roundSummaryBody({
          roundNumber: round.roundNumber,
          agenda: meeting.agenda,
          entries: respondedRows.map((row) => ({
            agentName: row.agentName,
            body: commentMap.get(row.responseCommentId ?? "") ?? "",
          })),
        }),
        systemKey: MEETING_SYSTEM_AUTHOR_KEY,
        systemCommentKind: "round_summary",
      });

      const attentionComment = await issueSvcTx.addCommentInTx(tx, meeting.rootIssueId, {
        body: operatorAttentionBody({
          roundNumber: round.roundNumber,
          responded: respondedRows.length,
          total: respondedRows.length,
          reason: "round_complete",
        }),
        systemKey: MEETING_SYSTEM_AUTHOR_KEY,
        systemCommentKind: "operator_attention",
      });

      await tx
        .update(issueMeetingRounds)
        .set({
          status: "completed",
          completedAt: now(),
          roundSummaryCommentId: summaryComment.id,
          updatedAt: now(),
          transitionVersion: sql`${issueMeetingRounds.transitionVersion} + 1`,
        })
        .where(eq(issueMeetingRounds.id, round.id));

      await tx
        .update(issueMeetings)
        .set({
          status: "awaiting_operator",
          lastOperatorSignalCommentId: attentionComment.id,
          lastRoundCompletedAt: now(),
          updatedAt: now(),
          transitionVersion: sql`${issueMeetings.transitionVersion} + 1`,
        })
        .where(eq(issueMeetings.id, meeting.id));

      await tx
        .update(issues)
        .set({
          status: "in_review",
          updatedAt: now(),
        })
        .where(
          inArray(
            issues.id,
            respondedRows.map((row) => row.childIssueId),
          ),
        );

      await syncRootIssueStatusMirror(tx, {
        rootIssueId: meeting.rootIssueId,
        meetingStatus: "awaiting_operator",
      });
    });

    await logMeetingActivity(actor, meeting.companyId, meeting.id, "meeting.round_completed", {
      roundId: round.id,
      roundNumber: round.roundNumber,
      respondedCount: respondedRows.length,
    });
  }

  async function maybeAdvanceRoundAfterResponse(meetingId: string, actor: MeetingActor) {
    const meeting = await db
      .select()
      .from(issueMeetings)
      .where(eq(issueMeetings.id, meetingId))
      .then((rows) => rows[0] ?? null);
    if (!meeting || meeting.status === "paused" || TERMINAL_MEETING_STATUSES.has(meeting.status as IssueMeetingStatus)) {
      return;
    }

    const round = await getCurrentRound(meeting.id, meeting.currentRoundNumber);
    if (!round || !["collecting", "dispatching"].includes(round.status)) return;

    const participantRows = await db
      .select()
      .from(issueMeetingRoundParticipants)
      .where(eq(issueMeetingRoundParticipants.roundId, round.id));
    if (participantRows.length === 0) return;

    const respondedCount = participantRows.filter((row) => row.status === "responded").length;
    if (respondedCount === participantRows.length && !round.roundSummaryCommentId) {
      await completeRoundWithSummary(meeting, round, actor);
    }
  }

  async function createMeeting(input: { companyId: string } & CreateMeeting, actor: MeetingActor) {
    const participantAgentIds = uniqueParticipantIds(input.participantAgentIds);
    if (participantAgentIds.length < 2) {
      throw unprocessable("Meeting requires at least two distinct participants");
    }

    const participantAgents = await db
      .select({
        id: agents.id,
        companyId: agents.companyId,
        name: agents.name,
        status: agents.status,
      })
      .from(agents)
      .where(and(eq(agents.companyId, input.companyId), inArray(agents.id, participantAgentIds)));

    if (participantAgents.length !== participantAgentIds.length) {
      throw notFound("One or more participant agents were not found");
    }

    const participantsById = new Map(participantAgents.map((agent) => [agent.id, agent]));
    const orderedParticipants = participantAgentIds.map((id) => participantsById.get(id)!);

    for (const participant of orderedParticipants) {
      if (participant.status === "pending_approval" || participant.status === "terminated") {
        throw conflict("Meeting participants must be invokable agents", { agentId: participant.id, status: participant.status });
      }
    }

    const facilitatorAgentId = input.facilitatorAgentId ?? orderedParticipants[0]!.id;
    if (!participantAgentIds.includes(facilitatorAgentId)) {
      throw unprocessable("facilitatorAgentId must be one of participantAgentIds");
    }

    const summaryAgentId = input.summaryAgentId ?? facilitatorAgentId;
    if (!participantAgentIds.includes(summaryAgentId)) {
      throw unprocessable("summaryAgentId must be one of participantAgentIds");
    }

    const created = await db.transaction(async (tx) => {
      const issueSvcTx = issueService(db);
      const createdBy = actor.actorType === "agent"
        ? { createdByAgentId: actor.actorId, createdByUserId: null }
        : { createdByAgentId: null, createdByUserId: actor.actorId };
      const createdAt = now();

      const rootIssue = await issueSvcTx.createInTx(tx, input.companyId, {
        title: meetingTitleFromAgenda(input.agenda),
        description: meetingRootDescription({
          agenda: input.agenda,
          participantNames: orderedParticipants.map((participant) => participant.name),
          referencePath: input.referencePath ?? null,
        }),
        status: "backlog",
        priority: "medium",
        projectId: input.projectId ?? null,
        goalId: input.goalId ?? null,
        billingCode: null,
        ...createdBy,
      });

      const [meeting] = await tx
        .insert(issueMeetings)
        .values({
          companyId: input.companyId,
          rootIssueId: rootIssue.id,
          facilitatorAgentId,
          summaryAgentId,
          status: "draft",
          agenda: input.agenda.trim(),
          referencePath: input.referencePath ?? null,
          projectId: input.projectId ?? null,
          goalId: input.goalId ?? null,
          billingCode: null,
          maxDiscussionRounds: input.maxDiscussionRounds,
          responseTimeoutSec: input.responseTimeoutSec,
          autoStart: input.autoStart,
          autoContinue: input.autoContinue,
          currentRoundNumber: 1,
          createdAt,
          updatedAt: createdAt,
        })
        .returning();

      const participantRows: Array<{ participantId: string; childIssueId: string; agentId: string }> = [];
      for (const [index, participant] of orderedParticipants.entries()) {
        const childIssue = await issueSvcTx.createInTx(tx, input.companyId, {
          title: childIssueTitle(participant.name, input.agenda),
          description: null,
          status: "backlog",
          priority: "medium",
          assigneeAgentId: participant.id,
          projectId: input.projectId ?? null,
          goalId: input.goalId ?? null,
          billingCode: null,
          parentId: rootIssue.id,
          hiddenAt: createdAt,
          ...createdBy,
        });

        const [participantRow] = await tx
          .insert(issueMeetingParticipants)
          .values({
            companyId: input.companyId,
            meetingId: meeting.id,
            agentId: participant.id,
            childIssueId: childIssue.id,
            isFacilitator: participant.id === facilitatorAgentId,
            isSummarizer: participant.id === summaryAgentId,
            speakingOrder: index,
            status: "active",
            createdAt,
            updatedAt: createdAt,
          })
          .returning();

        participantRows.push({
          participantId: participantRow.id,
          childIssueId: childIssue.id,
          agentId: participant.id,
        });
      }

      const [openingRound] = await tx
        .insert(issueMeetingRounds)
        .values({
          companyId: input.companyId,
          meetingId: meeting.id,
          roundNumber: 1,
          kind: "opening",
          status: "pending",
          createdAt,
          updatedAt: createdAt,
        })
        .returning();

      await tx.insert(issueMeetingRoundParticipants).values(
        participantRows.map((row) => ({
          companyId: input.companyId,
          meetingId: meeting.id,
          roundId: openingRound.id,
          participantId: row.participantId,
          agentId: row.agentId,
          childIssueId: row.childIssueId,
          status: "pending_dispatch",
          createdAt,
          updatedAt: createdAt,
        })),
      );

      await syncRootIssueStatusMirror(tx, {
        rootIssueId: rootIssue.id,
        meetingStatus: "draft",
      });

      return { meetingId: meeting.id, rootIssueId: rootIssue.id };
    });

    await logMeetingActivity(actor, input.companyId, created.meetingId, "meeting.created", {
      rootIssueId: created.rootIssueId,
      participantCount: participantAgentIds.length,
      autoStart: input.autoStart,
    });

    if (input.autoStart) {
      return startMeetingById(created.meetingId, actor);
    }
    return getById(created.meetingId);
  }

  async function startMeetingByIssueId(issueId: string, actor: MeetingActor) {
    const meeting = await findMeetingByIssueId(issueId);
    if (!meeting) throw notFound("Meeting not found");
    return startMeetingById(meeting.id, actor);
  }

  async function pauseMeetingByIssueId(issueId: string, actor: MeetingActor) {
    const meeting = await findMeetingByIssueId(issueId);
    if (!meeting) throw notFound("Meeting not found");
    if (!["running", "awaiting_operator"].includes(meeting.status)) {
      throw unprocessable("Meeting can only be paused from running or awaiting_operator");
    }

    await db.transaction(async (tx) => {
      await tx
        .update(issueMeetings)
        .set({
          status: "paused",
          updatedAt: now(),
          transitionVersion: sql`${issueMeetings.transitionVersion} + 1`,
        })
        .where(eq(issueMeetings.id, meeting.id));

      await syncRootIssueStatusMirror(tx, {
        rootIssueId: meeting.rootIssueId,
        meetingStatus: "paused",
      });
    });

    await logMeetingActivity(actor, meeting.companyId, meeting.id, "meeting.paused", null);
    return getById(meeting.id);
  }

  async function resumeMeetingByIssueId(issueId: string, actor: MeetingActor) {
    const meeting = await findMeetingByIssueId(issueId);
    if (!meeting) throw notFound("Meeting not found");
    if (meeting.status !== "paused") {
      throw unprocessable("Meeting can only be resumed from paused");
    }

    const round = await getCurrentRound(meeting.id, meeting.currentRoundNumber);
    const resumedStatus: IssueMeetingStatus =
      round && ["awaiting_operator", "timed_out", "completed"].includes(round.status)
        ? "awaiting_operator"
        : "running";

    await db.transaction(async (tx) => {
      await tx
        .update(issueMeetings)
        .set({
          status: resumedStatus,
          updatedAt: now(),
          transitionVersion: sql`${issueMeetings.transitionVersion} + 1`,
        })
        .where(eq(issueMeetings.id, meeting.id));

      await syncRootIssueStatusMirror(tx, {
        rootIssueId: meeting.rootIssueId,
        meetingStatus: resumedStatus,
      });
    });

    await logMeetingActivity(actor, meeting.companyId, meeting.id, "meeting.resumed", {
      resumedStatus,
    });
    return getById(meeting.id);
  }

  async function remindParticipantByIssueId(issueId: string, agentId: string, actor: MeetingActor) {
    const meeting = await findMeetingByIssueId(issueId);
    if (!meeting) throw notFound("Meeting not found");

    await refreshMeetingState(meeting.id);
    const freshMeeting = await db
      .select()
      .from(issueMeetings)
      .where(eq(issueMeetings.id, meeting.id))
      .then((rows) => rows[0] ?? null);
    if (!freshMeeting) throw notFound("Meeting not found");

    const round = await getCurrentRound(freshMeeting.id, freshMeeting.currentRoundNumber);
    if (!round || !["collecting", "awaiting_operator", "timed_out"].includes(round.status)) {
      throw unprocessable("Participant remind is only allowed during collecting, awaiting_operator, or timed_out");
    }

    const participant = await db
      .select({
        roundParticipantId: issueMeetingRoundParticipants.id,
        participantId: issueMeetingRoundParticipants.participantId,
        childIssueId: issueMeetingRoundParticipants.childIssueId,
        status: issueMeetingRoundParticipants.status,
      })
      .from(issueMeetingRoundParticipants)
      .where(
        and(
          eq(issueMeetingRoundParticipants.roundId, round.id),
          eq(issueMeetingRoundParticipants.agentId, agentId),
        ),
      )
      .then((rows) => rows[0] ?? null);

    if (!participant) throw notFound("Meeting participant not found");
    if (participant.status === "responded") {
      throw unprocessable("Cannot remind a participant who already responded");
    }

    await db.transaction(async (tx) => {
      const nextDeadlineAt = new Date(now().getTime() + (freshMeeting.responseTimeoutSec * 1000));

      await tx
        .update(issueMeetingRoundParticipants)
        .set({
          status: "pending_dispatch",
          remindedCount: sql`${issueMeetingRoundParticipants.remindedCount} + 1`,
          dispatchWakeupRequestId: null,
          dispatchWakeupStatus: null,
          dispatchRunId: null,
          failureReason: null,
          lastErrorCode: null,
          skipReason: null,
          skippedAt: null,
          timedOutAt: null,
          updatedAt: now(),
        })
        .where(eq(issueMeetingRoundParticipants.id, participant.roundParticipantId));

      await tx
        .update(issueMeetingRounds)
        .set({
          status: "dispatching",
          deadlineAt: nextDeadlineAt,
          updatedAt: now(),
          transitionVersion: sql`${issueMeetingRounds.transitionVersion} + 1`,
        })
        .where(eq(issueMeetingRounds.id, round.id));

      await tx
        .update(issueMeetings)
        .set({
          status: "running",
          updatedAt: now(),
          transitionVersion: sql`${issueMeetings.transitionVersion} + 1`,
        })
        .where(eq(issueMeetings.id, freshMeeting.id));

      await syncRootIssueStatusMirror(tx, {
        rootIssueId: freshMeeting.rootIssueId,
        meetingStatus: "running",
      });
    });

    await logMeetingActivity(actor, freshMeeting.companyId, freshMeeting.id, "meeting.participant_reminded", {
      roundId: round.id,
      agentId,
      participantId: participant.participantId,
    });

    await dispatchPendingParticipants(freshMeeting.id, round.id, actor, [participant.participantId]);
    return getById(freshMeeting.id);
  }

  async function onIssueCommentAdded(input: {
    issueId: string;
    comment: {
      id: string;
      authorKind: "agent" | "user" | "system";
      authorAgentId: string | null;
    };
    actor: MeetingActor;
  }) {
    if (input.comment.authorKind !== "agent" || !input.comment.authorAgentId) return;

    const meeting = await findMeetingByIssueId(input.issueId);
    if (!meeting) return;

    const round = await getCurrentRound(meeting.id, meeting.currentRoundNumber);
    if (!round || !["collecting", "dispatching"].includes(round.status)) return;

    const participant = await db
      .select({
        roundParticipantId: issueMeetingRoundParticipants.id,
        status: issueMeetingRoundParticipants.status,
        childIssueId: issueMeetingRoundParticipants.childIssueId,
      })
      .from(issueMeetingRoundParticipants)
      .where(
        and(
          eq(issueMeetingRoundParticipants.roundId, round.id),
          eq(issueMeetingRoundParticipants.childIssueId, input.issueId),
          eq(issueMeetingRoundParticipants.agentId, input.comment.authorAgentId),
        ),
      )
      .then((rows) => rows[0] ?? null);

    if (!participant || participant.status === "responded") return;

    await db.transaction(async (tx) => {
      await tx
        .update(issueMeetingRoundParticipants)
        .set({
          status: "responded",
          responseCommentId: input.comment.id,
          responseRunId: input.actor.runId ?? null,
          respondedAt: now(),
          updatedAt: now(),
        })
        .where(eq(issueMeetingRoundParticipants.id, participant.roundParticipantId));

      await tx
        .update(issues)
        .set({
          status: "in_review",
          updatedAt: now(),
        })
        .where(eq(issues.id, participant.childIssueId));
    });

    await logMeetingActivity(input.actor, meeting.companyId, meeting.id, "meeting.participant_responded", {
      roundId: round.id,
      commentId: input.comment.id,
      agentId: input.comment.authorAgentId,
      childIssueId: input.issueId,
    });

    await maybeAdvanceRoundAfterResponse(meeting.id, {
      actorType: "system",
      actorId: MEETING_SYSTEM_ACTOR_ID,
    });
  }

  async function getById(meetingId: string) {
    await refreshMeetingState(meetingId);
    return buildMeetingRoomDto(meetingId);
  }

  async function getByIssueId(issueId: string) {
    const meeting = await findMeetingByIssueId(issueId);
    if (!meeting) return null;
    await refreshMeetingState(meeting.id);
    return buildMeetingRoomDto(meeting.id);
  }

  return {
    createMeeting,
    getById,
    getByIssueId,
    onIssueCommentAdded,
    pauseMeetingByIssueId,
    refreshMeetingState,
    remindParticipantByIssueId,
    resumeMeetingByIssueId,
    startMeetingById,
    startMeetingByIssueId,
    syncRootIssueStatusMirror,
  };
}
