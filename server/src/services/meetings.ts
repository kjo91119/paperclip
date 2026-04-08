import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
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
  IssueMeetingRoundParticipantStatus,
  IssueMeetingStatus,
  MeetingRoomDTO,
  RequestMeetingSummary,
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

type TranscriptRootSystemComment = {
  id: string;
  body: string;
  createdAt: Date;
  authorKind: "system";
  systemCommentKind: string | null;
};

type TranscriptRootUserComment = {
  id: string;
  body: string;
  createdAt: Date;
};

type TranscriptRoundParticipantRow = {
  roundId: string;
  roundNumber: number;
  roundKind: MeetingRoomDTO["rounds"][number]["kind"];
  status: IssueMeetingRoundParticipantStatus;
  participantId: string;
  agentId: string;
  childIssueId: string;
  speakingOrder: number;
  dispatchPromptCommentId: string | null;
  responseCommentId: string | null;
  lateResponseCommentId: string | null;
  respondedAt: Date | null;
};

type TranscriptAgentComment = {
  id: string;
  issueId: string;
  authorAgentId: string | null;
  body: string;
  createdAt: Date;
};

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
  const stageLabel = input.roundNumber === 1 ? "1차 의견 수집" : `${input.roundNumber}차 토론`;
  return [
    `라운드 ${input.roundNumber} 시작`,
    "",
    `이번 라운드는 전체회의 ${stageLabel} 단계입니다.`,
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
  operatorComments: string[];
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

  appendOperatorCommentsSection(lines, input.operatorComments);

  lines.push(
    "",
    "답변 형식:",
    "1. 한줄 결론",
    "2. 핵심 근거 3개 이내",
    "3. 가장 큰 리스크 1개",
  );

  return lines.join("\n");
}

function discussionPromptBody(input: {
  roundNumber: number;
  agenda: string;
  participantNames: string[];
  facilitatorName: string | null;
  referencePath: string | null;
  priorRoundSummary: string | null;
  ownPreviousResponse: string | null;
  operatorComments: string[];
}) {
  const lines = [
    `전체회의 라운드 ${input.roundNumber} 토론 요청`,
    "",
    "이번 라운드에서는 다른 참가자의 핵심 주장에 반응해 주세요.",
    "동의/반대/보완을 분명히 하고, 실행 가능한 절충안을 제안해 주세요.",
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

  if (input.priorRoundSummary) {
    lines.push("", "이전 라운드 요약:", input.priorRoundSummary.trim());
  }

  if (input.ownPreviousResponse) {
    lines.push("", "당신의 이전 입장:", input.ownPreviousResponse.trim());
  }

  appendOperatorCommentsSection(lines, input.operatorComments);

  lines.push(
    "",
    "답변 형식:",
    "1. 동의하는 주장",
    "2. 반대하거나 보완할 주장",
    "3. 지금 바로 가능한 절충안",
  );

  return lines.join("\n");
}

function finalSummaryPromptBody(input: {
  agenda: string;
  referencePath: string | null;
  facilitatorName: string | null;
  summaryBodies: string[];
  operatorComments: string[];
}) {
  const lines = [
    "전체회의 최종 요약 요청",
    "",
    "지금까지의 라운드 요약을 바탕으로 최종 결론을 정리해 주세요.",
    "전체 transcript를 다시 길게 반복하지 말고, 실행 가능한 결론과 남은 리스크를 분리해 주세요.",
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

  if (input.summaryBodies.length > 0) {
    lines.push("", "이전 라운드 요약:");
    for (const [index, body] of input.summaryBodies.entries()) {
      lines.push("", `### 라운드 ${index + 1}`, body.trim());
    }
  }

  appendOperatorCommentsSection(lines, input.operatorComments);

  lines.push(
    "",
    "답변 형식:",
    "1. 권장 결론",
    "2. 이유",
    "3. 반대 의견 또는 남은 리스크",
    "4. 바로 실행할 액션 3~5개",
  );

  return lines.join("\n");
}

function appendOperatorCommentsSection(lines: string[], operatorComments: string[]) {
  if (operatorComments.length === 0) return;

  lines.push("", "운영자 코멘트:");
  for (const [index, comment] of operatorComments.entries()) {
    lines.push("", `### 운영자 코멘트 ${index + 1}`, comment.trim());
  }
  lines.push("", "위 운영자 코멘트를 반영해 답변해 주세요.");
}

function operatorCommentsForRoundPrompt(input: {
  meetingCreatedAt: Date;
  roundKind: MeetingRoomDTO["rounds"][number]["kind"];
  roundCreatedAt: Date;
  roundStartedAt: Date | null;
  previousRoundCreatedAt: Date | null;
  previousRoundStartedAt: Date | null;
  previousRoundCompletedAt: Date | null;
  previousRoundSummaryCreatedAt: Date | null;
  comments: Array<{ body: string; createdAt: Date }>;
}) {
  const lowerBoundMs = input.roundKind === "summary"
    ? input.meetingCreatedAt.getTime()
    : input.roundKind === "opening"
      ? (input.roundStartedAt ?? input.roundCreatedAt).getTime()
      : (
        input.previousRoundSummaryCreatedAt ??
        input.previousRoundCompletedAt ??
        input.previousRoundStartedAt ??
        input.previousRoundCreatedAt ??
        input.meetingCreatedAt
      ).getTime();

  return input.comments
    .filter((comment) => {
      const createdAtMs = comment.createdAt.getTime();
      return createdAtMs >= lowerBoundMs;
    })
    .map((comment) => comment.body);
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

function meetingCompletedBody(input: { status: "completed" | "partial_completed" }) {
  if (input.status === "partial_completed") {
    return [
      "전체회의가 부분 완료 상태로 종료되었습니다.",
      "",
      "최종 요약은 준비되었지만, 일부 참가자 응답 누락 또는 재시도/예외 상황이 있었습니다.",
      "최종 결론과 남은 리스크를 확인해 주세요.",
    ].join("\n");
  }

  return [
    "전체회의가 완료되었습니다.",
    "",
    "최종 요약과 실행안을 확인해 주세요.",
  ].join("\n");
}

function operatorAttentionBody(input: {
  roundNumber: number;
  responded: number;
  total: number;
  blockedOrFailed?: number;
  reason: "round_complete" | "timeout_zero" | "partial_timeout" | "dispatch_blocked";
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

  if (input.reason === "dispatch_blocked") {
    return [
      `라운드 ${input.roundNumber} dispatch 중 운영자 확인이 필요합니다.`,
      "",
      `응답 수: ${input.responded}/${input.total}`,
      `실행 불가 참가자 수: ${input.blockedOrFailed ?? 0}`,
      "",
      "예산 차단, 에이전트 일시중지, 실행 실패 등으로 일부 참가자가 시작되지 못했습니다.",
      "재촉(remind), 제외 후 계속, 또는 회의 중단 중 하나를 선택해 주세요.",
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

function uniqueIds(ids: Array<string | null | undefined>) {
  return [...new Set(ids.filter((value): value is string => Boolean(value)))];
}

function requestedByUserId(actor: MeetingActor) {
  return actor.actorType === "user" ? actor.actorId : null;
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
    const currentRoundParticipants = currentRound
      ? await db
        .select({
          id: issueMeetingRoundParticipants.id,
          participantId: issueMeetingRoundParticipants.participantId,
          agentId: issueMeetingRoundParticipants.agentId,
          childIssueId: issueMeetingRoundParticipants.childIssueId,
          speakingOrder: issueMeetingParticipants.speakingOrder,
          status: issueMeetingRoundParticipants.status,
          remindedCount: issueMeetingRoundParticipants.remindedCount,
          deadlineAt: issueMeetingRoundParticipants.deadlineAt,
          respondedAt: issueMeetingRoundParticipants.respondedAt,
          skipReason: issueMeetingRoundParticipants.skipReason,
          failureReason: issueMeetingRoundParticipants.failureReason,
          lastErrorCode: issueMeetingRoundParticipants.lastErrorCode,
        })
        .from(issueMeetingRoundParticipants)
        .innerJoin(issueMeetingParticipants, eq(issueMeetingRoundParticipants.participantId, issueMeetingParticipants.id))
        .where(
          and(
            eq(issueMeetingRoundParticipants.roundId, currentRound.id),
            currentRound.kind === "summary" && meeting.summaryAgentId
              ? eq(issueMeetingRoundParticipants.agentId, meeting.summaryAgentId)
              : sql`true`,
          ),
        )
        .orderBy(asc(issueMeetingParticipants.speakingOrder), asc(issueMeetingRoundParticipants.createdAt))
      : [];
    const transcript = await buildMeetingTranscript({
      meeting,
      rootIssueId: rootIssue.id,
      participants,
      rounds: rounds.map((round) => ({
        ...round,
        kind: round.kind as MeetingRoomDTO["rounds"][number]["kind"],
      })),
    });

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
      currentRoundParticipants: currentRoundParticipants.map((participant) => ({
        id: participant.id,
        participantId: participant.participantId,
        agentId: participant.agentId,
        childIssueId: participant.childIssueId,
        speakingOrder: participant.speakingOrder,
        status: participant.status as MeetingRoomDTO["currentRoundParticipants"][number]["status"],
        remindedCount: participant.remindedCount,
        deadlineAt: participant.deadlineAt,
        respondedAt: participant.respondedAt,
        skipReason: participant.skipReason,
        failureReason: participant.failureReason,
        lastErrorCode: participant.lastErrorCode,
      })),
      transcript,
    };
  }

  async function buildMeetingTranscript(input: {
    meeting: MeetingRow;
    rootIssueId: string;
    participants: Array<typeof issueMeetingParticipants.$inferSelect>;
    rounds: Array<MeetingRoundRow & { kind: MeetingRoomDTO["rounds"][number]["kind"] }>;
  }): Promise<MeetingRoomDTO["transcript"]> {
    if (input.rounds.length === 0) return [];

    const [roundParticipantRows, rootSystemComments, rootUserComments, childAgentComments] = await Promise.all([
      db
        .select({
          roundId: issueMeetingRoundParticipants.roundId,
          roundNumber: issueMeetingRounds.roundNumber,
          roundKind: issueMeetingRounds.kind,
          status: issueMeetingRoundParticipants.status,
          participantId: issueMeetingRoundParticipants.participantId,
          agentId: issueMeetingRoundParticipants.agentId,
          childIssueId: issueMeetingRoundParticipants.childIssueId,
          speakingOrder: issueMeetingParticipants.speakingOrder,
          dispatchPromptCommentId: issueMeetingRoundParticipants.dispatchPromptCommentId,
          responseCommentId: issueMeetingRoundParticipants.responseCommentId,
          lateResponseCommentId: issueMeetingRoundParticipants.lateResponseCommentId,
          respondedAt: issueMeetingRoundParticipants.respondedAt,
        })
        .from(issueMeetingRoundParticipants)
        .innerJoin(issueMeetingRounds, eq(issueMeetingRoundParticipants.roundId, issueMeetingRounds.id))
        .innerJoin(issueMeetingParticipants, eq(issueMeetingRoundParticipants.participantId, issueMeetingParticipants.id))
        .where(eq(issueMeetingRoundParticipants.meetingId, input.meeting.id))
        .orderBy(
          asc(issueMeetingRounds.roundNumber),
          asc(issueMeetingParticipants.speakingOrder),
          asc(issueMeetingRoundParticipants.createdAt),
        ) as Promise<TranscriptRoundParticipantRow[]>,
      db
        .select({
          id: issueComments.id,
          body: issueComments.body,
          createdAt: issueComments.createdAt,
          authorKind: issueComments.authorKind,
          systemCommentKind: issueComments.systemCommentKind,
        })
        .from(issueComments)
        .where(
          and(
            eq(issueComments.issueId, input.rootIssueId),
            eq(issueComments.authorKind, "system"),
          ),
        )
        .orderBy(asc(issueComments.createdAt)) as Promise<TranscriptRootSystemComment[]>,
      db
        .select({
          id: issueComments.id,
          body: issueComments.body,
          createdAt: issueComments.createdAt,
        })
        .from(issueComments)
        .where(
          and(
            eq(issueComments.issueId, input.rootIssueId),
            eq(issueComments.authorKind, "user"),
          ),
        )
        .orderBy(asc(issueComments.createdAt)) as Promise<TranscriptRootUserComment[]>,
      input.participants.length === 0
        ? Promise.resolve([] as TranscriptAgentComment[])
        : db
          .select({
            id: issueComments.id,
            issueId: issueComments.issueId,
            authorAgentId: issueComments.authorAgentId,
            body: issueComments.body,
            createdAt: issueComments.createdAt,
          })
          .from(issueComments)
          .where(
            and(
              inArray(issueComments.issueId, input.participants.map((participant) => participant.childIssueId)),
              eq(issueComments.authorKind, "agent"),
            ),
          )
          .orderBy(asc(issueComments.createdAt)),
    ]);

    const referencedCommentIds = uniqueIds([
      ...input.rounds.flatMap((round) => [round.roundOpenRootCommentId, round.roundSummaryCommentId]),
      ...roundParticipantRows.flatMap((row) => [
        row.dispatchPromptCommentId,
        row.responseCommentId,
        row.lateResponseCommentId,
      ]),
    ]);

    const referencedComments = referencedCommentIds.length === 0
      ? []
      : await db
        .select({
          id: issueComments.id,
          issueId: issueComments.issueId,
          body: issueComments.body,
          createdAt: issueComments.createdAt,
          authorKind: issueComments.authorKind,
          systemCommentKind: issueComments.systemCommentKind,
        })
        .from(issueComments)
        .where(inArray(issueComments.id, referencedCommentIds));

    const commentMetaById = new Map(referencedComments.map((comment) => [comment.id, comment]));
    const rootCommentById = new Map(rootSystemComments.map((comment) => [comment.id, comment]));
    const agentCommentsByKey = new Map<string, TranscriptAgentComment[]>();
    const agentCommentById = new Map(childAgentComments.map((comment) => [comment.id, comment]));

    for (const comment of childAgentComments) {
      const key = `${comment.issueId}:${comment.authorAgentId ?? ""}`;
      const bucket = agentCommentsByKey.get(key) ?? [];
      bucket.push(comment);
      agentCommentsByKey.set(key, bucket);
    }

    const transcript: MeetingRoomDTO["transcript"] = [];
    const meetingTerminalAt = input.meeting.completedAt;
    const meetingIsTerminal = TERMINAL_MEETING_STATUSES.has(input.meeting.status as IssueMeetingStatus);

    for (const [roundIndex, round] of input.rounds.entries()) {
      const nextRound = input.rounds[roundIndex + 1] ?? null;
      const roundParticipants = roundParticipantRows.filter((row) => row.roundId === round.id);
      const roundOpenComment = round.roundOpenRootCommentId
        ? rootCommentById.get(round.roundOpenRootCommentId) ?? commentMetaById.get(round.roundOpenRootCommentId)
        : null;
      if (roundOpenComment) {
        transcript.push({
          entryKind: "round_opened",
          roundNumber: round.roundNumber,
          roundKind: round.kind,
          participantAgentId: null,
          sourceIssueId: input.rootIssueId,
          sourceCommentId: roundOpenComment.id,
          authorKind: "system",
          systemCommentKind: "round_opened",
          body: roundOpenComment.body,
          createdAt: roundOpenComment.createdAt,
          respondedAt: null,
          speakingOrder: null,
        });
      }

      const roundSummaryComment = round.roundSummaryCommentId
        ? rootCommentById.get(round.roundSummaryCommentId) ?? commentMetaById.get(round.roundSummaryCommentId)
        : null;

      const roundStartMs = (
        roundOpenComment?.createdAt ??
        round.startedAt ??
        round.createdAt
      ).getTime();
      const nextRoundOpenComment = nextRound?.roundOpenRootCommentId
        ? rootCommentById.get(nextRound.roundOpenRootCommentId) ?? commentMetaById.get(nextRound.roundOpenRootCommentId)
        : null;
      const nextRoundStartMs = nextRound
        ? (
          nextRoundOpenComment?.createdAt ??
          nextRound.startedAt ??
          nextRound.createdAt
        ).getTime()
        : Number.POSITIVE_INFINITY;
      const operatorSignals = rootSystemComments.filter((comment) =>
        comment.systemCommentKind === "operator_attention" &&
        (
          comment.body.includes(`라운드 ${round.roundNumber} `) ||
          (
            comment.createdAt.getTime() >= roundStartMs &&
            comment.createdAt.getTime() < nextRoundStartMs
          )
        )
      );
      const roundCloseMs = Math.min(
        roundSummaryComment?.createdAt.getTime() ?? Number.POSITIVE_INFINITY,
        operatorSignals[0]?.createdAt.getTime() ?? Number.POSITIVE_INFINITY,
        nextRoundStartMs,
        meetingTerminalAt?.getTime() ?? Number.POSITIVE_INFINITY,
      );

      const respondedParticipants = [...roundParticipants]
        .filter((row) => Boolean(row.responseCommentId))
        .sort((a, b) => {
          const aTime = a.respondedAt?.getTime() ?? 0;
          const bTime = b.respondedAt?.getTime() ?? 0;
          if (aTime !== bTime) return aTime - bTime;
          return a.speakingOrder - b.speakingOrder;
        });

      const nextRoundPromptTimes = new Map<string, number>();
      for (const nextRow of roundIndex < input.rounds.length - 1
        ? roundParticipantRows.filter((row) => row.roundId === nextRound?.id)
        : []) {
        const promptComment = nextRow.dispatchPromptCommentId
          ? commentMetaById.get(nextRow.dispatchPromptCommentId)
          : null;
        if (promptComment) {
          nextRoundPromptTimes.set(`${nextRow.childIssueId}:${nextRow.agentId}`, promptComment.createdAt.getTime());
        }
      }

      for (const participant of respondedParticipants) {
        const responseComment = participant.responseCommentId
          ? agentCommentById.get(participant.responseCommentId)
          : null;
        if (!responseComment) continue;

        transcript.push({
          entryKind: round.kind === "summary" ? "final_summary" : "participant_response",
          roundNumber: round.roundNumber,
          roundKind: round.kind,
          participantAgentId: participant.agentId,
          sourceIssueId: participant.childIssueId,
          sourceCommentId: responseComment.id,
          authorKind: "agent",
          systemCommentKind: null,
          body: responseComment.body,
          createdAt: responseComment.createdAt,
          respondedAt: participant.respondedAt,
          speakingOrder: participant.speakingOrder,
        });

        if (round.kind === "summary") {
          continue;
        }

        const upperBoundMs = Math.min(
          nextRoundPromptTimes.get(`${participant.childIssueId}:${participant.agentId}`) ?? Number.POSITIVE_INFINITY,
          roundCloseMs,
        );
        const extraComments = (agentCommentsByKey.get(`${participant.childIssueId}:${participant.agentId}`) ?? [])
          .filter((comment) =>
            comment.id !== responseComment.id &&
            comment.createdAt.getTime() >= responseComment.createdAt.getTime() &&
            comment.createdAt.getTime() <= upperBoundMs
          )
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

        for (const extraComment of extraComments) {
          transcript.push({
            entryKind: "participant_response_extra",
            roundNumber: round.roundNumber,
            roundKind: round.kind,
            participantAgentId: participant.agentId,
            sourceIssueId: participant.childIssueId,
            sourceCommentId: extraComment.id,
            authorKind: "agent",
            systemCommentKind: null,
            body: extraComment.body,
            createdAt: extraComment.createdAt,
            respondedAt: extraComment.createdAt,
            speakingOrder: participant.speakingOrder,
          });
        }
      }
      if (roundSummaryComment) {
        transcript.push({
          entryKind: "round_summary",
          roundNumber: round.roundNumber,
          roundKind: round.kind,
          participantAgentId: null,
          sourceIssueId: input.rootIssueId,
          sourceCommentId: roundSummaryComment.id,
          authorKind: "system",
          systemCommentKind: "round_summary",
          body: roundSummaryComment.body,
          createdAt: roundSummaryComment.createdAt,
          respondedAt: null,
          speakingOrder: null,
        });
      }
      for (const operatorSignal of operatorSignals) {
        transcript.push({
          entryKind: "operator_signal",
          roundNumber: round.roundNumber,
          roundKind: round.kind,
          participantAgentId: null,
          sourceIssueId: input.rootIssueId,
          sourceCommentId: operatorSignal.id,
          authorKind: "system",
          systemCommentKind: "operator_attention",
          body: operatorSignal.body,
          createdAt: operatorSignal.createdAt,
          respondedAt: null,
          speakingOrder: null,
        });
      }

      const operatorComments = rootUserComments.filter((comment) => {
        const createdAtMs = comment.createdAt.getTime();
        if (createdAtMs < roundStartMs || createdAtMs >= nextRoundStartMs) return false;
        if (meetingIsTerminal && meetingTerminalAt && createdAtMs > meetingTerminalAt.getTime()) return false;
        return true;
      });

      for (const operatorComment of operatorComments) {
        transcript.push({
          entryKind: "operator_comment",
          roundNumber: round.roundNumber,
          roundKind: round.kind,
          participantAgentId: null,
          sourceIssueId: input.rootIssueId,
          sourceCommentId: operatorComment.id,
          authorKind: "user",
          systemCommentKind: null,
          body: operatorComment.body,
          createdAt: operatorComment.createdAt,
          respondedAt: null,
          speakingOrder: null,
        });
      }

      const lateResponses = roundParticipants
        .filter((row) => Boolean(row.lateResponseCommentId))
        .map((row) => {
          const lateComment = row.lateResponseCommentId
            ? agentCommentById.get(row.lateResponseCommentId)
            : null;
          return lateComment
            ? {
              row,
              lateComment,
            }
            : null;
        })
        .filter((value): value is { row: TranscriptRoundParticipantRow; lateComment: TranscriptAgentComment } => Boolean(value))
        .sort((a, b) => a.lateComment.createdAt.getTime() - b.lateComment.createdAt.getTime());

      for (const late of lateResponses) {
        if (meetingIsTerminal && meetingTerminalAt && late.lateComment.createdAt.getTime() > meetingTerminalAt.getTime()) {
          continue;
        }
        transcript.push({
          entryKind: "late_response",
          roundNumber: round.roundNumber,
          roundKind: round.kind,
          participantAgentId: late.row.agentId,
          sourceIssueId: late.row.childIssueId,
          sourceCommentId: late.lateComment.id,
          authorKind: "agent",
          systemCommentKind: null,
          body: late.lateComment.body,
          createdAt: late.lateComment.createdAt,
          respondedAt: late.row.respondedAt,
          speakingOrder: late.row.speakingOrder,
        });
      }
    }

    const meetingCompletedComment = rootSystemComments.find((comment) => comment.systemCommentKind === "meeting_completed");
    if (meetingCompletedComment) {
      transcript.push({
        entryKind: "meeting_completed",
        roundNumber: input.meeting.currentRoundNumber,
        roundKind: input.rounds.find((round) => round.roundNumber === input.meeting.currentRoundNumber)?.kind ?? null,
        participantAgentId: null,
        sourceIssueId: input.rootIssueId,
        sourceCommentId: meetingCompletedComment.id,
        authorKind: "system",
        systemCommentKind: "meeting_completed",
        body: meetingCompletedComment.body,
        createdAt: meetingCompletedComment.createdAt,
        respondedAt: null,
        speakingOrder: null,
      });
    }

    return transcript;
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

  async function deriveFinalMeetingStatus(meetingId: string): Promise<"completed" | "partial_completed"> {
    const rows = await db
      .select({
        roundKind: issueMeetingRounds.kind,
        status: issueMeetingRoundParticipants.status,
      })
      .from(issueMeetingRoundParticipants)
      .innerJoin(issueMeetingRounds, eq(issueMeetingRoundParticipants.roundId, issueMeetingRounds.id))
      .where(eq(issueMeetingRoundParticipants.meetingId, meetingId));

    const hadPartialSignals = rows.some((row) =>
      row.roundKind !== "summary" &&
      ["timed_out", "blocked", "skipped", "failed", "late"].includes(row.status)
    );

    return hadPartialSignals ? "partial_completed" : "completed";
  }

  async function loadActiveParticipantChildIssueIds(
    tx: Pick<Db, "select">,
    meetingId: string,
  ): Promise<string[]> {
    return tx
      .select({ childIssueId: issueMeetingParticipants.childIssueId })
      .from(issueMeetingParticipants)
      .where(and(eq(issueMeetingParticipants.meetingId, meetingId), eq(issueMeetingParticipants.status, "active")))
      .then((rows) => rows.map((row) => row.childIssueId));
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
    const effectiveRows = round.kind === "summary"
      ? participantRows.filter((row) => row.agentId === meeting.summaryAgentId)
      : participantRows;
    const respondedCount = effectiveRows.filter((row) =>
      RESPONDED_PARTICIPANT_STATUSES.has(row.status as IssueMeetingRoundParticipantStatus)
    ).length;
    const total = effectiveRows.length;
    const timeoutAt = now();

    await db.transaction(async (tx) => {
      const issueSvcTx = issueService(db);

      const nonRespondedIds = effectiveRows
        .filter((row) => ACTIVE_PARTICIPANT_STATUSES.has(row.status as IssueMeetingRoundParticipantStatus))
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

      const previousRound = round.roundNumber > 1
        ? await tx
          .select()
          .from(issueMeetingRounds)
          .where(
            and(
              eq(issueMeetingRounds.meetingId, meetingId),
              eq(issueMeetingRounds.roundNumber, round.roundNumber - 1),
            ),
          )
          .then((rows) => rows[0] ?? null)
        : null;

      const previousRoundSummaryRow = previousRound?.roundSummaryCommentId
        ? await tx
          .select({ body: issueComments.body, createdAt: issueComments.createdAt })
          .from(issueComments)
          .where(eq(issueComments.id, previousRound.roundSummaryCommentId))
          .then((rows) => rows[0] ?? null)
        : null;
      const previousRoundSummaryBody = previousRoundSummaryRow?.body ?? null;

      const priorRoundSummaryRows = round.kind === "summary"
        ? await tx
          .select({
            roundNumber: issueMeetingRounds.roundNumber,
            body: issueComments.body,
          })
          .from(issueMeetingRounds)
          .innerJoin(issueComments, eq(issueMeetingRounds.roundSummaryCommentId, issueComments.id))
          .where(
            and(
              eq(issueMeetingRounds.meetingId, meetingId),
              inArray(issueMeetingRounds.kind, ["opening", "discussion", "followup"]),
              isNotNull(issueMeetingRounds.roundSummaryCommentId),
            ),
          )
          .orderBy(asc(issueMeetingRounds.roundNumber))
        : [];
      const rootUserComments = await tx
        .select({
          body: issueComments.body,
          createdAt: issueComments.createdAt,
        })
        .from(issueComments)
        .where(
          and(
            eq(issueComments.issueId, meeting.rootIssueId),
            eq(issueComments.authorKind, "user"),
          ),
        )
        .orderBy(asc(issueComments.createdAt));

      const previousResponseRows = previousRound
        ? await tx
          .select({
            participantId: issueMeetingRoundParticipants.participantId,
            body: issueComments.body,
          })
          .from(issueMeetingRoundParticipants)
          .innerJoin(issueComments, eq(issueMeetingRoundParticipants.responseCommentId, issueComments.id))
          .where(
            and(
              eq(issueMeetingRoundParticipants.roundId, previousRound.id),
              isNotNull(issueMeetingRoundParticipants.responseCommentId),
            ),
          )
        : [];
      const previousResponseBodyByParticipantId = new Map(
        previousResponseRows.map((row) => [row.participantId, row.body]),
      );

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
      const operatorCommentBodies = operatorCommentsForRoundPrompt({
        meetingCreatedAt: meeting.createdAt,
        roundKind: round.kind as MeetingRoomDTO["rounds"][number]["kind"],
        roundCreatedAt: round.createdAt,
        roundStartedAt: round.startedAt,
        previousRoundCreatedAt: previousRound?.createdAt ?? null,
        previousRoundStartedAt: previousRound?.startedAt ?? null,
        previousRoundCompletedAt: previousRound?.completedAt ?? null,
        previousRoundSummaryCreatedAt: previousRoundSummaryRow?.createdAt ?? null,
        comments: rootUserComments,
      });
      const rows: Array<{
        roundParticipantId: string;
        participantId: string;
        agentId: string;
        childIssueId: string;
        commentId: string;
        roundNumber: number;
      }> = [];

      for (const row of roster) {
        const promptBody = round.kind === "opening"
          ? openingPromptBody({
            agenda: meeting.agenda,
            participantNames,
            facilitatorName,
            referencePath: meeting.referencePath,
            operatorComments: operatorCommentBodies,
          })
          : round.kind === "summary"
            ? finalSummaryPromptBody({
              agenda: meeting.agenda,
              referencePath: meeting.referencePath,
              facilitatorName,
              summaryBodies: priorRoundSummaryRows.map((summaryRow) => summaryRow.body),
              operatorComments: operatorCommentBodies,
            })
          : discussionPromptBody({
            roundNumber: round.roundNumber,
            agenda: meeting.agenda,
            participantNames,
            facilitatorName,
            referencePath: meeting.referencePath,
            priorRoundSummary: previousRoundSummaryBody,
            ownPreviousResponse: previousResponseBodyByParticipantId.get(row.participantId) ?? null,
            operatorComments: operatorCommentBodies,
          });

        const promptComment = await issueSvcTx.addCommentInTx(tx, row.childIssueId, {
          body: promptBody,
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
    const dispatchResults: Array<{
      participantId: string;
      agentId: string;
      childIssueId: string;
      participantStatus: IssueMeetingRoundParticipantStatus;
    }> = [];
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

      dispatchResults.push({
        participantId: row.participantId,
        agentId: row.agentId,
        childIssueId: row.childIssueId,
        participantStatus: outcome.participantStatus,
      });
    }

    const blockedOrFailedCount = dispatchResults.filter((result) =>
      result.participantStatus === "blocked" || result.participantStatus === "failed"
    ).length;

    await db.transaction(async (tx) => {
      const issueSvcTx = issueService(db);

      if (blockedOrFailedCount > 0) {
        const participantCounts = await tx
          .select({ status: issueMeetingRoundParticipants.status })
          .from(issueMeetingRoundParticipants)
          .where(
            and(
              eq(issueMeetingRoundParticipants.roundId, roundId),
              prepared.round.kind === "summary" && prepared.meeting.summaryAgentId
                ? eq(issueMeetingRoundParticipants.agentId, prepared.meeting.summaryAgentId)
                : sql`true`,
            ),
          );
        const respondedCount = participantCounts.filter((row) => row.status === "responded").length;
        const totalCount = participantCounts.length;

        const attentionComment = await issueSvcTx.addCommentInTx(tx, prepared.meeting.rootIssueId, {
          body: operatorAttentionBody({
            roundNumber: prepared.round.roundNumber,
            responded: respondedCount,
            total: totalCount,
            blockedOrFailed: blockedOrFailedCount,
            reason: "dispatch_blocked",
          }),
          systemKey: MEETING_SYSTEM_AUTHOR_KEY,
          systemCommentKind: "operator_attention",
        });

        await tx
          .update(issueMeetingRounds)
          .set({
            status: "awaiting_operator",
            updatedAt: now(),
            transitionVersion: sql`${issueMeetingRounds.transitionVersion} + 1`,
          })
          .where(and(eq(issueMeetingRounds.id, roundId), eq(issueMeetingRounds.status, "dispatching")));

        await tx
          .update(issueMeetings)
          .set({
            status: "awaiting_operator",
            lastOperatorSignalCommentId: attentionComment.id,
            updatedAt: now(),
            transitionVersion: sql`${issueMeetings.transitionVersion} + 1`,
          })
          .where(eq(issueMeetings.id, meetingId));

        await syncRootIssueStatusMirror(tx, {
          rootIssueId: prepared.meeting.rootIssueId,
          meetingStatus: "awaiting_operator",
        });
        return;
      }

      await tx
        .update(issueMeetingRounds)
        .set({
          status: "collecting",
          updatedAt: now(),
          transitionVersion: sql`${issueMeetingRounds.transitionVersion} + 1`,
        })
        .where(and(eq(issueMeetingRounds.id, roundId), eq(issueMeetingRounds.status, "dispatching")));
    });

    if (blockedOrFailedCount > 0) {
      await logMeetingActivity(
        {
          actorType: "system",
          actorId: MEETING_SYSTEM_ACTOR_ID,
        },
        prepared.meeting.companyId,
        meetingId,
        "meeting.operator_attention_set",
        {
          roundId,
          roundNumber: prepared.round.roundNumber,
          blockedOrFailedCount,
          reason: "dispatch_blocked",
        },
      );
    }
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
      await logMeetingActivity(actor, started.meeting.companyId, meetingId, "meeting.round_opened", {
        roundId: started.round.id,
        roundNumber: started.round.roundNumber,
        roundKind: started.round.kind,
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

    const completed = await db.transaction(async (tx) => {
      const issueSvcTx = issueService(db);
      const activeChildIssueIds = await loadActiveParticipantChildIssueIds(tx, meeting.id);
      const [claimedRound] = await tx
        .update(issueMeetingRounds)
        .set({
          status: "summarizing",
          updatedAt: now(),
          transitionVersion: sql`${issueMeetingRounds.transitionVersion} + 1`,
        })
        .where(and(eq(issueMeetingRounds.id, round.id), isNull(issueMeetingRounds.roundSummaryCommentId)))
        .returning({ id: issueMeetingRounds.id });
      if (!claimedRound) {
        return null;
      }

      const totalParticipants = await tx
        .select({ count: sql<number>`count(*)` })
        .from(issueMeetingRoundParticipants)
        .where(eq(issueMeetingRoundParticipants.roundId, round.id))
        .then((rows) => Number(rows[0]?.count ?? 0));

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
          total: totalParticipants,
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
      return { respondedCount: respondedRows.length };
    });

    if (!completed) return false;

    await logMeetingActivity(actor, meeting.companyId, meeting.id, "meeting.round_completed", {
      roundId: round.id,
      roundNumber: round.roundNumber,
      respondedCount: completed.respondedCount,
    });
    return true;
  }

  async function openSummaryRound(
    meeting: MeetingRow,
    actor: MeetingActor,
    input: {
      summaryAgentId?: string | null;
      reason: "explicit_summary" | "continue_to_summary";
    },
  ) {
    const targetSummaryAgentId = input.summaryAgentId ?? meeting.summaryAgentId ?? meeting.facilitatorAgentId;
    if (!targetSummaryAgentId) {
      throw unprocessable("Summary agent is required to open a summary round");
    }

    const requestedBy = requestedByUserId(actor);
    const activeParticipants = await db
      .select()
      .from(issueMeetingParticipants)
      .where(and(eq(issueMeetingParticipants.meetingId, meeting.id), eq(issueMeetingParticipants.status, "active")))
      .orderBy(asc(issueMeetingParticipants.speakingOrder), asc(issueMeetingParticipants.createdAt));
    const participantByAgentId = new Map(activeParticipants.map((participant) => [participant.agentId, participant]));
    const targetParticipant = participantByAgentId.get(targetSummaryAgentId);
    if (!targetParticipant) {
      throw unprocessable("summaryAgentId must reference an active meeting participant");
    }

    const existingSummaryRound = await db
      .select()
      .from(issueMeetingRounds)
      .where(
        and(
          eq(issueMeetingRounds.meetingId, meeting.id),
          eq(issueMeetingRounds.kind, "summary"),
        ),
      )
      .orderBy(desc(issueMeetingRounds.roundNumber))
      .limit(1)
      .then((rows) => rows[0] ?? null);

    const prepared = await db.transaction(async (tx) => {
      const issueSvcTx = issueService(db);
      const openedAt = now();
      let summaryRound = existingSummaryRound;
      let createdNewRound = false;

      if (!summaryRound || summaryRound.status === "completed") {
        const [insertedRound] = await tx
          .insert(issueMeetingRounds)
          .values({
            companyId: meeting.companyId,
            meetingId: meeting.id,
            roundNumber: (meeting.currentRoundNumber ?? 0) + 1,
            kind: "summary",
            status: "dispatching",
            summaryRequestedByUserId: requestedBy,
            startedAt: openedAt,
            deadlineAt: new Date(openedAt.getTime() + (meeting.responseTimeoutSec * 1000)),
            createdAt: openedAt,
            updatedAt: openedAt,
          })
          .returning();
        summaryRound = insertedRound;
        createdNewRound = true;

        const roundOpenComment = await issueSvcTx.addCommentInTx(tx, meeting.rootIssueId, {
          body: roundOpenedBody({ roundNumber: insertedRound.roundNumber, agenda: meeting.agenda }),
          systemKey: MEETING_SYSTEM_AUTHOR_KEY,
          systemCommentKind: "round_opened",
        });

        await tx
          .update(issueMeetingRounds)
          .set({
            roundOpenRootCommentId: roundOpenComment.id,
            updatedAt: openedAt,
          })
          .where(eq(issueMeetingRounds.id, insertedRound.id));
      } else {
        if (!["awaiting_operator", "timed_out", "failed"].includes(summaryRound.status)) {
          throw unprocessable("Summary round is not ready for reassignment or retry");
        }
      }

      const existingRows = await tx
        .select()
        .from(issueMeetingRoundParticipants)
        .where(eq(issueMeetingRoundParticipants.roundId, summaryRound.id));

      for (const row of existingRows) {
        if (
          row.agentId !== targetSummaryAgentId &&
          ACTIVE_PARTICIPANT_STATUSES.has(row.status as IssueMeetingRoundParticipantStatus)
        ) {
          await tx
            .update(issueMeetingRoundParticipants)
            .set({
              status: "skipped",
              skipReason: "summary.reassigned",
              skippedAt: openedAt,
              updatedAt: openedAt,
            })
            .where(eq(issueMeetingRoundParticipants.id, row.id));
        }
      }

      const targetExistingRow = existingRows.find((row) => row.participantId === targetParticipant.id) ?? null;
      if (targetExistingRow) {
        await tx
          .update(issueMeetingRoundParticipants)
          .set({
            status: "pending_dispatch",
            dispatchPromptCommentId: null,
            dispatchWakeupRequestId: null,
            dispatchWakeupStatus: null,
            dispatchRunId: null,
            responseCommentId: null,
            responseRunId: null,
            lateResponseCommentId: null,
            failureReason: null,
            lastErrorCode: null,
            skipReason: null,
            skippedAt: null,
            respondedAt: null,
            timedOutAt: null,
            deadlineAt: new Date(openedAt.getTime() + (meeting.responseTimeoutSec * 1000)),
            updatedAt: openedAt,
          })
          .where(eq(issueMeetingRoundParticipants.id, targetExistingRow.id));
      } else {
        await tx.insert(issueMeetingRoundParticipants).values({
          companyId: meeting.companyId,
          meetingId: meeting.id,
          roundId: summaryRound.id,
          participantId: targetParticipant.id,
          agentId: targetParticipant.agentId,
          childIssueId: targetParticipant.childIssueId,
          status: "pending_dispatch",
          deadlineAt: new Date(openedAt.getTime() + (meeting.responseTimeoutSec * 1000)),
          createdAt: openedAt,
          updatedAt: openedAt,
        });
      }

      await tx
        .update(issueMeetingRounds)
        .set({
          status: "dispatching",
          summaryRequestedByUserId: requestedBy,
          startedAt: summaryRound.startedAt ?? openedAt,
          deadlineAt: new Date(openedAt.getTime() + (meeting.responseTimeoutSec * 1000)),
          updatedAt: openedAt,
          transitionVersion: sql`${issueMeetingRounds.transitionVersion} + 1`,
        })
        .where(eq(issueMeetingRounds.id, summaryRound.id));

      await tx
        .update(issueMeetings)
        .set({
          status: "running",
          summaryAgentId: targetSummaryAgentId,
          currentRoundNumber: summaryRound.roundNumber,
          updatedAt: openedAt,
          transitionVersion: sql`${issueMeetings.transitionVersion} + 1`,
        })
        .where(eq(issueMeetings.id, meeting.id));

      await syncRootIssueStatusMirror(tx, {
        rootIssueId: meeting.rootIssueId,
        meetingStatus: "running",
      });

      return {
        roundId: summaryRound.id,
        roundNumber: summaryRound.roundNumber,
        createdNewRound,
        requestedBy,
      };
    });

    await logMeetingActivity(actor, meeting.companyId, meeting.id, "meeting.summary_requested", {
      roundId: prepared.roundId,
      roundNumber: prepared.roundNumber,
      requestedByUserId: prepared.requestedBy,
      summaryAgentId: targetSummaryAgentId,
      reason: input.reason,
    });

    if (prepared.createdNewRound) {
      await logMeetingActivity(actor, meeting.companyId, meeting.id, "meeting.round_opened", {
        roundId: prepared.roundId,
        roundNumber: prepared.roundNumber,
        roundKind: "summary",
      });
    }

    await dispatchPendingParticipants(meeting.id, prepared.roundId, actor);
    return getById(meeting.id);
  }

  async function completeSummaryRound(meeting: MeetingRow, round: MeetingRoundRow, actor: MeetingActor) {
    const summaryParticipant = await db
      .select({
        participantId: issueMeetingRoundParticipants.participantId,
        agentId: issueMeetingRoundParticipants.agentId,
        childIssueId: issueMeetingRoundParticipants.childIssueId,
        responseCommentId: issueMeetingRoundParticipants.responseCommentId,
      })
      .from(issueMeetingRoundParticipants)
      .where(
        and(
          eq(issueMeetingRoundParticipants.roundId, round.id),
          eq(issueMeetingRoundParticipants.status, "responded"),
          isNotNull(issueMeetingRoundParticipants.responseCommentId),
        ),
      )
      .limit(1)
      .then((rows) => rows[0] ?? null);

    if (!summaryParticipant?.responseCommentId) {
      return false;
    }

    const finalStatus = await deriveFinalMeetingStatus(meeting.id);

    const completed = await db.transaction(async (tx) => {
      const issueSvcTx = issueService(db);
      const activeChildIssueIds = await loadActiveParticipantChildIssueIds(tx, meeting.id);
      const [claimedRound] = await tx
        .update(issueMeetingRounds)
        .set({
          status: "completed",
          completedAt: now(),
          updatedAt: now(),
          transitionVersion: sql`${issueMeetingRounds.transitionVersion} + 1`,
        })
        .where(and(eq(issueMeetingRounds.id, round.id), ne(issueMeetingRounds.status, "completed")))
        .returning({ id: issueMeetingRounds.id });
      if (!claimedRound) {
        return null;
      }

      const meetingCompletedComment = await issueSvcTx.addCommentInTx(tx, meeting.rootIssueId, {
        body: meetingCompletedBody({ status: finalStatus }),
        systemKey: MEETING_SYSTEM_AUTHOR_KEY,
        systemCommentKind: "meeting_completed",
      });

      await tx
        .update(issueMeetings)
        .set({
          status: finalStatus,
          completedAt: now(),
          lastOperatorSignalCommentId: meetingCompletedComment.id,
          lastRoundCompletedAt: now(),
          updatedAt: now(),
          transitionVersion: sql`${issueMeetings.transitionVersion} + 1`,
        })
        .where(eq(issueMeetings.id, meeting.id));

      await tx
        .update(issues)
        .set({
          status: "done",
          updatedAt: now(),
        })
        .where(
          inArray(
            issues.id,
            activeChildIssueIds,
          ),
        );

      await syncRootIssueStatusMirror(tx, {
        rootIssueId: meeting.rootIssueId,
        meetingStatus: finalStatus,
      });

      return { finalStatus, commentId: meetingCompletedComment.id };
    });

    if (!completed) return false;

    await logMeetingActivity(actor, meeting.companyId, meeting.id, `meeting.${completed.finalStatus}`, {
      roundId: round.id,
      roundNumber: round.roundNumber,
      summaryAgentId: summaryParticipant.agentId,
      summaryCommentId: summaryParticipant.responseCommentId,
    });

    return true;
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
    if (!round || !["collecting", "dispatching", "awaiting_operator", "timed_out"].includes(round.status)) return;

    const participantRows = await db
      .select()
      .from(issueMeetingRoundParticipants)
      .where(eq(issueMeetingRoundParticipants.roundId, round.id));
    if (participantRows.length === 0) return;

    if (round.kind === "summary") {
      const currentSummaryRow = participantRows.find((row) => row.agentId === meeting.summaryAgentId) ?? null;
      if (currentSummaryRow?.status === "responded") {
        await completeSummaryRound(meeting, round, actor);
      }
      return;
    }

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

  async function skipParticipantByIssueId(issueId: string, agentId: string, actor: MeetingActor) {
    const meeting = await findMeetingByIssueId(issueId);
    if (!meeting) throw notFound("Meeting not found");

    await refreshMeetingState(meeting.id);
    const freshMeeting = await db
      .select()
      .from(issueMeetings)
      .where(eq(issueMeetings.id, meeting.id))
      .then((rows) => rows[0] ?? null);
    if (!freshMeeting) throw notFound("Meeting not found");
    if (!["awaiting_operator", "running"].includes(freshMeeting.status)) {
      throw unprocessable("Participant skip is only allowed while the meeting is active");
    }

    const round = await getCurrentRound(freshMeeting.id, freshMeeting.currentRoundNumber);
    if (!round || !["collecting", "awaiting_operator", "timed_out"].includes(round.status)) {
      throw unprocessable("Participant skip is only allowed during collecting, awaiting_operator, or timed_out");
    }

    const participant = await db
      .select({
        roundParticipantId: issueMeetingRoundParticipants.id,
        participantId: issueMeetingRoundParticipants.participantId,
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
      throw unprocessable("Cannot skip a participant who already responded");
    }

    await db.transaction(async (tx) => {
      await tx
        .update(issueMeetingRoundParticipants)
        .set({
          status: "skipped",
          skipReason: "operator.skip",
          skippedAt: now(),
          updatedAt: now(),
        })
        .where(eq(issueMeetingRoundParticipants.id, participant.roundParticipantId));

      await tx
        .update(issueMeetingRounds)
        .set({
          status: "awaiting_operator",
          updatedAt: now(),
          transitionVersion: sql`${issueMeetingRounds.transitionVersion} + 1`,
        })
        .where(eq(issueMeetingRounds.id, round.id));

      await tx
        .update(issueMeetings)
        .set({
          status: "awaiting_operator",
          updatedAt: now(),
          transitionVersion: sql`${issueMeetings.transitionVersion} + 1`,
        })
        .where(eq(issueMeetings.id, freshMeeting.id));

      await syncRootIssueStatusMirror(tx, {
        rootIssueId: freshMeeting.rootIssueId,
        meetingStatus: "awaiting_operator",
      });
    });

    await logMeetingActivity(actor, freshMeeting.companyId, freshMeeting.id, "meeting.participant_skipped", {
      roundId: round.id,
      participantId: participant.participantId,
      agentId,
    });

    return getById(freshMeeting.id);
  }

  async function continueMeetingByIssueId(issueId: string, actor: MeetingActor) {
    const meeting = await findMeetingByIssueId(issueId);
    if (!meeting) throw notFound("Meeting not found");

    await refreshMeetingState(meeting.id);
    const freshMeeting = await db
      .select()
      .from(issueMeetings)
      .where(eq(issueMeetings.id, meeting.id))
      .then((rows) => rows[0] ?? null);
    if (!freshMeeting) throw notFound("Meeting not found");
    if (freshMeeting.status !== "awaiting_operator") {
      throw unprocessable("Meeting can only continue from awaiting_operator");
    }

    const currentRound = await getCurrentRound(freshMeeting.id, freshMeeting.currentRoundNumber);
    if (!currentRound) throw notFound("Current meeting round not found");
    if (!["completed", "awaiting_operator", "timed_out"].includes(currentRound.status)) {
      throw unprocessable("Current round is not ready to continue");
    }

    const roundParticipantRows = await db
      .select({
        status: issueMeetingRoundParticipants.status,
      })
      .from(issueMeetingRoundParticipants)
      .where(eq(issueMeetingRoundParticipants.roundId, currentRound.id));
    const respondedCount = roundParticipantRows.filter((row) => row.status === "responded").length;
    if (respondedCount === 0) {
      throw unprocessable("Cannot continue without at least one participant response");
    }

    if (!currentRound.roundSummaryCommentId) {
      await completeRoundWithSummary(freshMeeting, currentRound, actor);
    }

    const discussionRoundsUsed = await db
      .select({ kind: issueMeetingRounds.kind })
      .from(issueMeetingRounds)
      .where(eq(issueMeetingRounds.meetingId, freshMeeting.id))
      .then((rows) => rows.filter((row) => row.kind === "discussion" || row.kind === "followup").length);

    let nextRoundKind: "discussion" | "followup" | "summary";
    if (currentRound.kind === "opening") {
      nextRoundKind = "discussion";
    } else if (currentRound.kind === "discussion" || currentRound.kind === "followup") {
      if (discussionRoundsUsed >= freshMeeting.maxDiscussionRounds) {
        nextRoundKind = "summary";
      } else {
        nextRoundKind = "followup";
      }
    } else {
      throw unprocessable("Continue is not supported for the current round kind");
    }

    if (nextRoundKind === "summary") {
      return openSummaryRound(freshMeeting, actor, {
        reason: "continue_to_summary",
      });
    }

    const prepared = await db.transaction(async (tx) => {
      const issueSvcTx = issueService(db);
      const activeParticipants = await tx
        .select()
        .from(issueMeetingParticipants)
        .where(and(eq(issueMeetingParticipants.meetingId, freshMeeting.id), eq(issueMeetingParticipants.status, "active")))
        .orderBy(asc(issueMeetingParticipants.speakingOrder), asc(issueMeetingParticipants.createdAt));

      if (activeParticipants.length < 2) {
        throw unprocessable("Continuing to the next discussion round requires at least two active participants");
      }

      const openedAt = now();
      const [nextRound] = await tx
        .insert(issueMeetingRounds)
        .values({
          companyId: freshMeeting.companyId,
          meetingId: freshMeeting.id,
          roundNumber: (freshMeeting.currentRoundNumber ?? 0) + 1,
          kind: nextRoundKind,
          status: "dispatching",
          summaryRequestedByUserId: null,
          startedAt: openedAt,
          deadlineAt: new Date(openedAt.getTime() + (freshMeeting.responseTimeoutSec * 1000)),
          createdAt: openedAt,
          updatedAt: openedAt,
        })
        .returning();

      const roundOpenComment = await issueSvcTx.addCommentInTx(tx, freshMeeting.rootIssueId, {
        body: roundOpenedBody({ roundNumber: nextRound.roundNumber, agenda: freshMeeting.agenda }),
        systemKey: MEETING_SYSTEM_AUTHOR_KEY,
        systemCommentKind: "round_opened",
      });

      await tx
        .update(issueMeetingRounds)
        .set({
          roundOpenRootCommentId: roundOpenComment.id,
          updatedAt: openedAt,
        })
        .where(eq(issueMeetingRounds.id, nextRound.id));

      await tx.insert(issueMeetingRoundParticipants).values(
        activeParticipants.map((participant) => ({
          companyId: freshMeeting.companyId,
          meetingId: freshMeeting.id,
          roundId: nextRound.id,
          participantId: participant.id,
          agentId: participant.agentId,
          childIssueId: participant.childIssueId,
          status: "pending_dispatch",
          createdAt: openedAt,
          updatedAt: openedAt,
        })),
      );

      await tx
        .update(issueMeetings)
        .set({
          status: "running",
          currentRoundNumber: nextRound.roundNumber,
          updatedAt: openedAt,
          transitionVersion: sql`${issueMeetings.transitionVersion} + 1`,
        })
        .where(eq(issueMeetings.id, freshMeeting.id));

      await syncRootIssueStatusMirror(tx, {
        rootIssueId: freshMeeting.rootIssueId,
        meetingStatus: "running",
      });

      return nextRound;
    });

    await logMeetingActivity(actor, freshMeeting.companyId, freshMeeting.id, "meeting.round_opened", {
      roundId: prepared.id,
      roundNumber: prepared.roundNumber,
      roundKind: prepared.kind,
    });

    await dispatchPendingParticipants(freshMeeting.id, prepared.id, actor);
    return getById(freshMeeting.id);
  }

  async function archiveMeetingByIssueId(issueId: string, actor: MeetingActor) {
    const meeting = await findMeetingByIssueId(issueId);
    if (!meeting) throw notFound("Meeting not found");
    if (meeting.rootIssueId !== issueId) {
      throw unprocessable("Only the root meeting issue can be archived");
    }

    const archivedAt = now();

    await db.transaction(async (tx) => {
      await tx
        .update(issues)
        .set({
          hiddenAt: archivedAt,
          updatedAt: archivedAt,
        })
        .where(eq(issues.id, meeting.rootIssueId));

      await tx
        .update(issueMeetings)
        .set({
          updatedAt: archivedAt,
          transitionVersion: sql`${issueMeetings.transitionVersion} + 1`,
        })
        .where(eq(issueMeetings.id, meeting.id));
    });

    await logMeetingActivity(actor, meeting.companyId, meeting.id, "meeting.archived", {
      rootIssueId: meeting.rootIssueId,
      hiddenAt: archivedAt.toISOString(),
    });

    return {
      meetingId: meeting.id,
      rootIssueId: meeting.rootIssueId,
      hiddenAt: archivedAt,
    };
  }

  async function summaryMeetingByIssueId(
    issueId: string,
    input: RequestMeetingSummary,
    actor: MeetingActor,
  ) {
    const meeting = await findMeetingByIssueId(issueId);
    if (!meeting) throw notFound("Meeting not found");

    await refreshMeetingState(meeting.id);
    const freshMeeting = await db
      .select()
      .from(issueMeetings)
      .where(eq(issueMeetings.id, meeting.id))
      .then((rows) => rows[0] ?? null);
    if (!freshMeeting) throw notFound("Meeting not found");
    if (!["running", "awaiting_operator"].includes(freshMeeting.status)) {
      throw unprocessable("Meeting summary is only allowed while the meeting is active");
    }

    const currentRound = await getCurrentRound(freshMeeting.id, freshMeeting.currentRoundNumber);
    if (!currentRound) throw notFound("Current meeting round not found");

    if (currentRound.kind === "summary") {
      return openSummaryRound(freshMeeting, actor, {
        summaryAgentId: input.summaryAgentId ?? null,
        reason: "explicit_summary",
      });
    }

    if (!["collecting", "awaiting_operator", "timed_out", "completed"].includes(currentRound.status)) {
      throw unprocessable("Summary request is only allowed when the current round has usable responses");
    }

    const roundParticipantRows = await db
      .select({ status: issueMeetingRoundParticipants.status })
      .from(issueMeetingRoundParticipants)
      .where(eq(issueMeetingRoundParticipants.roundId, currentRound.id));
    const respondedCount = roundParticipantRows.filter((row) => row.status === "responded").length;
    if (respondedCount === 0) {
      throw unprocessable("Cannot request summary without at least one participant response");
    }

    if (!currentRound.roundSummaryCommentId) {
      await completeRoundWithSummary(freshMeeting, currentRound, actor);
    }

    const refreshedMeeting = await db
      .select()
      .from(issueMeetings)
      .where(eq(issueMeetings.id, freshMeeting.id))
      .then((rows) => rows[0] ?? null);
    if (!refreshedMeeting) throw notFound("Meeting not found");

    return openSummaryRound(refreshedMeeting, actor, {
      summaryAgentId: input.summaryAgentId ?? null,
      reason: "explicit_summary",
    });
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
    const meeting = await findMeetingByIssueId(input.issueId);
    if (!meeting) return;

    if (input.issueId === meeting.rootIssueId && input.comment.authorKind === "user") {
      await logMeetingActivity(input.actor, meeting.companyId, meeting.id, "meeting.operator_comment_added", {
        commentId: input.comment.id,
        roundNumber: meeting.currentRoundNumber,
        roundKind: meeting.currentRoundNumber
          ? await getCurrentRound(meeting.id, meeting.currentRoundNumber).then((round) => round?.kind ?? null)
          : null,
      });
      return;
    }

    if (input.comment.authorKind !== "agent" || !input.comment.authorAgentId) return;

    const round = await getCurrentRound(meeting.id, meeting.currentRoundNumber);
    if (!round || !["collecting", "dispatching", "awaiting_operator", "timed_out"].includes(round.status)) return;

    const participant = await db
      .select({
        roundParticipantId: issueMeetingRoundParticipants.id,
        status: issueMeetingRoundParticipants.status,
        childIssueId: issueMeetingRoundParticipants.childIssueId,
        lateResponseCommentId: issueMeetingRoundParticipants.lateResponseCommentId,
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

    const isLateResponse = ["timed_out", "blocked", "skipped", "failed"].includes(participant.status);

    await db.transaction(async (tx) => {
      if (isLateResponse) {
        await tx
          .update(issueMeetingRoundParticipants)
          .set({
            status: "late",
            lateResponseCommentId: participant.lateResponseCommentId ?? input.comment.id,
            respondedAt: now(),
            updatedAt: now(),
          })
          .where(eq(issueMeetingRoundParticipants.id, participant.roundParticipantId));
      } else {
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
      }

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
      late: isLateResponse,
    });

    if (!isLateResponse) {
      await maybeAdvanceRoundAfterResponse(meeting.id, {
        actorType: "system",
        actorId: MEETING_SYSTEM_ACTOR_ID,
      });
    }
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
    archiveMeetingByIssueId,
    createMeeting,
    continueMeetingByIssueId,
    getById,
    getByIssueId,
    onIssueCommentAdded,
    pauseMeetingByIssueId,
    refreshMeetingState,
    remindParticipantByIssueId,
    resumeMeetingByIssueId,
    skipParticipantByIssueId,
    summaryMeetingByIssueId,
    startMeetingById,
    startMeetingByIssueId,
    syncRootIssueStatusMirror,
  };
}
