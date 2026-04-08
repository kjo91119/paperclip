import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  activityLog,
  agents,
  companies,
  createDb,
  issueComments,
  issueMeetingParticipants,
  issueMeetingRoundParticipants,
  issueMeetingRounds,
  issueMeetings,
  issues,
  type Db,
} from "@paperclipai/db";
import { and, eq, inArray } from "drizzle-orm";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { meetingService } from "../services/meetings.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres meeting service tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

type DispatchCall = {
  participantId: string;
  agentId: string;
  childIssueId: string;
  commentId: string;
  roundId: string;
  roundNumber: number;
};

describeEmbeddedPostgres("meetingService orchestration", () => {
  let db!: Db;
  let svc!: ReturnType<typeof meetingService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let currentNow!: Date;
  let dispatchCalls!: DispatchCall[];

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-meetings-service-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  beforeEach(() => {
    currentNow = new Date("2026-04-07T00:00:00.000Z");
    dispatchCalls = [];
    svc = meetingService(db, {
      now: () => new Date(currentNow),
      dispatchWakeup: async (input) => {
        dispatchCalls.push({
          participantId: input.participantId,
          agentId: input.agentId,
          childIssueId: input.childIssueId,
          commentId: input.commentId,
          roundId: input.roundId,
          roundNumber: input.roundNumber,
        });
        return {
          wakeupRequestId: null,
          wakeupStatus: "queued",
          runId: null,
          participantStatus: "queued",
          failureReason: null,
          lastErrorCode: null,
          skipReason: null,
        };
      },
    });
  });

  afterEach(async () => {
    await db.delete(issueMeetingRoundParticipants);
    await db.delete(issueMeetingRounds);
    await db.delete(issueMeetingParticipants);
    await db.delete(issueMeetings);
    await db.delete(issueComments);
    await db.delete(activityLog);
    await db.delete(issues);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompanyWithAgents() {
    const companyId = randomUUID();
    const ceoId = randomUUID();
    const ctoId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `M${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values([
      {
        id: ceoId,
        companyId,
        name: "CEO",
        role: "ceo",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: ctoId,
        companyId,
        name: "CTO",
        role: "cto",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);

    return { companyId, ceoId, ctoId };
  }

  it("creates an auto-start meeting with hidden child issues and queued dispatch rows", async () => {
    const { companyId, ceoId, ctoId } = await seedCompanyWithAgents();

    const created = await svc.createMeeting({
      companyId,
      agenda: "에드센스 승인을 위한 사이트 구조 논의",
      participantAgentIds: [ceoId, ctoId],
      facilitatorAgentId: ceoId,
      summaryAgentId: ceoId,
      projectId: null,
      goalId: null,
      referencePath: "/docs/adsense.md",
      maxDiscussionRounds: 1,
      responseTimeoutSec: 300,
      autoStart: true,
      autoContinue: false,
    }, {
      actorType: "user",
      actorId: "board-user",
      agentId: null,
      runId: null,
    });

    expect(created).not.toBeNull();
    expect(created?.meeting.status).toBe("running");
    expect(created?.meeting.currentRoundNumber).toBe(1);
    expect(created?.rounds).toHaveLength(1);
    expect(created?.rounds[0]?.status).toBe("collecting");
    expect(dispatchCalls).toHaveLength(2);

    const rootIssue = await db
      .select()
      .from(issues)
      .where(eq(issues.id, created!.rootIssue.id))
      .then((rows) => rows[0] ?? null);

    expect(rootIssue?.assigneeAgentId).toBeNull();
    expect(rootIssue?.status).toBe("in_progress");

    const participantRows = await db
      .select()
      .from(issueMeetingParticipants)
      .where(eq(issueMeetingParticipants.meetingId, created!.meeting.id))
      .orderBy(issueMeetingParticipants.speakingOrder);

    expect(participantRows).toHaveLength(2);

    const childIssues = await db
      .select()
      .from(issues)
      .where(inArray(issues.id, participantRows.map((row) => row.childIssueId)));

    expect(childIssues).toHaveLength(2);
    for (const childIssue of childIssues) {
      expect(childIssue.hiddenAt).not.toBeNull();
      expect(childIssue.status).toBe("todo");
    }

    const round = await db
      .select()
      .from(issueMeetingRounds)
      .where(eq(issueMeetingRounds.meetingId, created!.meeting.id))
      .then((rows) => rows[0] ?? null);
    expect(round?.status).toBe("collecting");

    const roundParticipants = await db
      .select()
      .from(issueMeetingRoundParticipants)
      .where(eq(issueMeetingRoundParticipants.roundId, round!.id))
      .orderBy(issueMeetingRoundParticipants.createdAt);

    expect(roundParticipants).toHaveLength(2);
    for (const row of roundParticipants) {
      expect(row.dispatchPromptCommentId).not.toBeNull();
      expect(row.status).toBe("queued");
      expect(row.deadlineAt).not.toBeNull();
    }
  });

  it("archives the root meeting issue without deleting meeting history", async () => {
    const { companyId, ceoId, ctoId } = await seedCompanyWithAgents();

    const created = await svc.createMeeting({
      companyId,
      agenda: "오래된 회의를 오피스 목록에서 정리",
      participantAgentIds: [ceoId, ctoId],
      facilitatorAgentId: ceoId,
      summaryAgentId: ceoId,
      projectId: null,
      goalId: null,
      referencePath: null,
      maxDiscussionRounds: 1,
      responseTimeoutSec: 300,
      autoStart: true,
      autoContinue: false,
    }, {
      actorType: "user",
      actorId: "board-user",
      agentId: null,
      runId: null,
    });

    const archived = await svc.archiveMeetingByIssueId(created!.rootIssue.id, {
      actorType: "user",
      actorId: "board-user",
      agentId: null,
      runId: null,
    });

    expect(archived.rootIssueId).toBe(created!.rootIssue.id);

    const rootIssue = await db
      .select({ hiddenAt: issues.hiddenAt })
      .from(issues)
      .where(eq(issues.id, created!.rootIssue.id))
      .then((rows) => rows[0] ?? null);
    expect(rootIssue?.hiddenAt).not.toBeNull();

    const meetingRow = await db
      .select()
      .from(issueMeetings)
      .where(eq(issueMeetings.id, created!.meeting.id))
      .then((rows) => rows[0] ?? null);
    expect(meetingRow).not.toBeNull();

    const archiveActivity = await db
      .select({ action: activityLog.action })
      .from(activityLog)
      .where(and(eq(activityLog.entityId, created!.meeting.id), eq(activityLog.action, "meeting.archived")));
    expect(archiveActivity).toHaveLength(1);
  });

  it("marks participant responses and completes the round with root summary comments", async () => {
    const { companyId, ceoId, ctoId } = await seedCompanyWithAgents();
    const created = await svc.createMeeting({
      companyId,
      agenda: "온보딩 콘텐츠 우선순위 정리",
      participantAgentIds: [ceoId, ctoId],
      facilitatorAgentId: ceoId,
      summaryAgentId: ceoId,
      projectId: null,
      goalId: null,
      referencePath: null,
      maxDiscussionRounds: 1,
      responseTimeoutSec: 300,
      autoStart: true,
      autoContinue: false,
    }, {
      actorType: "user",
      actorId: "board-user",
      agentId: null,
      runId: null,
    });

    const participants = await db
      .select()
      .from(issueMeetingParticipants)
      .where(eq(issueMeetingParticipants.meetingId, created!.meeting.id))
      .orderBy(issueMeetingParticipants.speakingOrder);

    const comments = await db.insert(issueComments).values([
      {
        companyId,
        issueId: participants[0]!.childIssueId,
        authorKind: "agent",
        authorAgentId: participants[0]!.agentId,
        authorUserId: null,
        authorSystemKey: null,
        systemCommentKind: null,
        body: "CEO 입장에서는 정책 페이지와 신뢰 신호를 먼저 올리는 게 좋습니다.",
      },
      {
        companyId,
        issueId: participants[1]!.childIssueId,
        authorKind: "agent",
        authorAgentId: participants[1]!.agentId,
        authorUserId: null,
        authorSystemKey: null,
        systemCommentKind: null,
        body: "CTO 입장에서는 카테고리 구조와 저작권 안전 콘텐츠를 먼저 정리해야 합니다.",
      },
    ]).returning();

    await Promise.all([
      svc.onIssueCommentAdded({
        issueId: participants[0]!.childIssueId,
        comment: {
          id: comments[0]!.id,
          authorKind: "agent",
          authorAgentId: participants[0]!.agentId,
        },
        actor: {
          actorType: "agent",
          actorId: participants[0]!.agentId,
          agentId: participants[0]!.agentId,
          runId: null,
        },
      }),
      svc.onIssueCommentAdded({
        issueId: participants[1]!.childIssueId,
        comment: {
          id: comments[1]!.id,
          authorKind: "agent",
          authorAgentId: participants[1]!.agentId,
        },
        actor: {
          actorType: "agent",
          actorId: participants[1]!.agentId,
          agentId: participants[1]!.agentId,
          runId: null,
        },
      }),
    ]);

    const meeting = await db
      .select()
      .from(issueMeetings)
      .where(eq(issueMeetings.id, created!.meeting.id))
      .then((rows) => rows[0] ?? null);
    expect(meeting?.status).toBe("awaiting_operator");

    const round = await db
      .select()
      .from(issueMeetingRounds)
      .where(eq(issueMeetingRounds.meetingId, created!.meeting.id))
      .then((rows) => rows[0] ?? null);
    expect(round?.status).toBe("completed");
    expect(round?.roundSummaryCommentId).not.toBeNull();

    const rootComments = await db
      .select({
        id: issueComments.id,
        systemCommentKind: issueComments.systemCommentKind,
        body: issueComments.body,
      })
      .from(issueComments)
      .where(eq(issueComments.issueId, created!.rootIssue.id));

    expect(rootComments.filter((comment) => comment.systemCommentKind === "round_summary")).toHaveLength(1);
    expect(rootComments.filter((comment) => comment.systemCommentKind === "operator_attention")).toHaveLength(1);

    const refreshedChildren = await db
      .select({
        id: issues.id,
        status: issues.status,
      })
      .from(issues)
      .where(inArray(issues.id, participants.map((participant) => participant.childIssueId)));
    expect(refreshedChildren.every((issue) => issue.status === "in_review")).toBe(true);
  });

  it("projects participant_response_extra comments in transcript order", async () => {
    const { companyId, ceoId, ctoId } = await seedCompanyWithAgents();
    const created = await svc.createMeeting({
      companyId,
      agenda: "추가 의견 projection 확인",
      participantAgentIds: [ceoId, ctoId],
      facilitatorAgentId: ceoId,
      summaryAgentId: ceoId,
      projectId: null,
      goalId: null,
      referencePath: null,
      maxDiscussionRounds: 1,
      responseTimeoutSec: 300,
      autoStart: true,
      autoContinue: false,
    }, {
      actorType: "user",
      actorId: "board-user",
      agentId: null,
      runId: null,
    });

    const participants = await db
      .select()
      .from(issueMeetingParticipants)
      .where(eq(issueMeetingParticipants.meetingId, created!.meeting.id))
      .orderBy(issueMeetingParticipants.speakingOrder);

    const firstComment = await db.insert(issueComments).values({
      companyId,
      issueId: participants[0]!.childIssueId,
      authorKind: "agent",
      authorAgentId: participants[0]!.agentId,
      authorUserId: null,
      authorSystemKey: null,
      systemCommentKind: null,
      body: "CEO 1차 본응답입니다.",
    }).returning().then((rows) => rows[0]!);

    await svc.onIssueCommentAdded({
      issueId: participants[0]!.childIssueId,
      comment: {
        id: firstComment.id,
        authorKind: "agent",
        authorAgentId: participants[0]!.agentId,
      },
      actor: {
        actorType: "agent",
        actorId: participants[0]!.agentId,
        agentId: participants[0]!.agentId,
        runId: null,
      },
    });

    const extraComment = await db.insert(issueComments).values({
      companyId,
      issueId: participants[0]!.childIssueId,
      authorKind: "agent",
      authorAgentId: participants[0]!.agentId,
      authorUserId: null,
      authorSystemKey: null,
      systemCommentKind: null,
      body: "CEO 추가 보완 의견입니다.",
    }).returning().then((rows) => rows[0]!);

    await svc.onIssueCommentAdded({
      issueId: participants[0]!.childIssueId,
      comment: {
        id: extraComment.id,
        authorKind: "agent",
        authorAgentId: participants[0]!.agentId,
      },
      actor: {
        actorType: "agent",
        actorId: participants[0]!.agentId,
        agentId: participants[0]!.agentId,
        runId: null,
      },
    });

    const otherComment = await db.insert(issueComments).values({
      companyId,
      issueId: participants[1]!.childIssueId,
      authorKind: "agent",
      authorAgentId: participants[1]!.agentId,
      authorUserId: null,
      authorSystemKey: null,
      systemCommentKind: null,
      body: "CTO 응답입니다.",
    }).returning().then((rows) => rows[0]!);

    await svc.onIssueCommentAdded({
      issueId: participants[1]!.childIssueId,
      comment: {
        id: otherComment.id,
        authorKind: "agent",
        authorAgentId: participants[1]!.agentId,
      },
      actor: {
        actorType: "agent",
        actorId: participants[1]!.agentId,
        agentId: participants[1]!.agentId,
        runId: null,
      },
    });

    const dto = await svc.getById(created!.meeting.id);
    expect(dto?.transcript.map((entry) => entry.entryKind)).toContain("participant_response_extra");
    const extraEntry = dto?.transcript.find((entry) => entry.entryKind === "participant_response_extra");
    expect(extraEntry?.body).toContain("추가 보완 의견");
  });

  it("escalates zero-response timeout and redispatches a reminded participant", async () => {
    const { companyId, ceoId, ctoId } = await seedCompanyWithAgents();
    const created = await svc.createMeeting({
      companyId,
      agenda: "초기 광고 친화형 카테고리 재정렬",
      participantAgentIds: [ceoId, ctoId],
      facilitatorAgentId: ceoId,
      summaryAgentId: ceoId,
      projectId: null,
      goalId: null,
      referencePath: null,
      maxDiscussionRounds: 1,
      responseTimeoutSec: 60,
      autoStart: true,
      autoContinue: false,
    }, {
      actorType: "user",
      actorId: "board-user",
      agentId: null,
      runId: null,
    });

    currentNow = new Date("2026-04-07T00:05:00.000Z");
    await svc.refreshMeetingState(created!.meeting.id);

    const timedOutMeeting = await db
      .select()
      .from(issueMeetings)
      .where(eq(issueMeetings.id, created!.meeting.id))
      .then((rows) => rows[0] ?? null);
    expect(timedOutMeeting?.status).toBe("awaiting_operator");

    const round = await db
      .select()
      .from(issueMeetingRounds)
      .where(eq(issueMeetingRounds.meetingId, created!.meeting.id))
      .then((rows) => rows[0] ?? null);
    expect(round?.status).toBe("timed_out");

    const timedOutRows = await db
      .select()
      .from(issueMeetingRoundParticipants)
      .where(eq(issueMeetingRoundParticipants.roundId, round!.id));
    expect(timedOutRows.every((row) => row.status === "timed_out")).toBe(true);

    dispatchCalls = [];
    const reminded = await svc.remindParticipantByIssueId(created!.rootIssue.id, ceoId, {
      actorType: "user",
      actorId: "board-user",
      agentId: null,
      runId: null,
    });

    expect(reminded?.meeting.status).toBe("running");
    expect(dispatchCalls).toHaveLength(1);
    expect(dispatchCalls[0]?.agentId).toBe(ceoId);

    const refreshedRound = await db
      .select()
      .from(issueMeetingRounds)
      .where(eq(issueMeetingRounds.id, round!.id))
      .then((rows) => rows[0] ?? null);
    expect(refreshedRound?.status).toBe("collecting");

    const remindedParticipant = await db
      .select()
      .from(issueMeetingRoundParticipants)
      .where(
        and(
          eq(issueMeetingRoundParticipants.roundId, round!.id),
          eq(issueMeetingRoundParticipants.agentId, ceoId),
        ),
      )
      .then((rows) => rows[0] ?? null);
    expect(remindedParticipant?.status).toBe("queued");
    expect(remindedParticipant?.remindedCount).toBe(1);
  });

  it("escalates immediately when a participant dispatch is blocked", async () => {
    const { companyId, ceoId, ctoId } = await seedCompanyWithAgents();
    svc = meetingService(db, {
      now: () => new Date(currentNow),
      dispatchWakeup: async (input) => {
        dispatchCalls.push({
          participantId: input.participantId,
          agentId: input.agentId,
          childIssueId: input.childIssueId,
          commentId: input.commentId,
          roundId: input.roundId,
          roundNumber: input.roundNumber,
        });
        if (input.agentId === ctoId) {
          return {
            wakeupRequestId: null,
            wakeupStatus: "skipped",
            runId: null,
            participantStatus: "blocked",
            failureReason: "budget.blocked",
            lastErrorCode: "budget.blocked",
            skipReason: null,
          };
        }
        return {
          wakeupRequestId: null,
          wakeupStatus: "queued",
          runId: null,
          participantStatus: "queued",
          failureReason: null,
          lastErrorCode: null,
          skipReason: null,
        };
      },
    });

    const created = await svc.createMeeting({
      companyId,
      agenda: "예산 차단 시 즉시 운영자 개입 확인",
      participantAgentIds: [ceoId, ctoId],
      facilitatorAgentId: ceoId,
      summaryAgentId: ceoId,
      projectId: null,
      goalId: null,
      referencePath: null,
      maxDiscussionRounds: 1,
      responseTimeoutSec: 300,
      autoStart: true,
      autoContinue: false,
    }, {
      actorType: "user",
      actorId: "board-user",
      agentId: null,
      runId: null,
    });

    expect(created?.meeting.status).toBe("awaiting_operator");
    expect(created?.meeting.needsAttention).toBe(true);

    const round = await db
      .select()
      .from(issueMeetingRounds)
      .where(eq(issueMeetingRounds.meetingId, created!.meeting.id))
      .then((rows) => rows[0] ?? null);
    expect(round?.status).toBe("awaiting_operator");

    const participantRows = await db
      .select({
        agentId: issueMeetingRoundParticipants.agentId,
        status: issueMeetingRoundParticipants.status,
      })
      .from(issueMeetingRoundParticipants)
      .where(eq(issueMeetingRoundParticipants.roundId, round!.id));
    expect(participantRows.find((row) => row.agentId === ctoId)?.status).toBe("blocked");

    const rootComments = await db
      .select({
        systemCommentKind: issueComments.systemCommentKind,
      })
      .from(issueComments)
      .where(eq(issueComments.issueId, created!.rootIssue.id));
    expect(rootComments.filter((comment) => comment.systemCommentKind === "operator_attention")).toHaveLength(1);
  });

  it("continues into a discussion round with prior summary and own stance packets", async () => {
    const { companyId, ceoId, ctoId } = await seedCompanyWithAgents();
    const created = await svc.createMeeting({
      companyId,
      agenda: "에드센스 승인용 콘텐츠 방향 정리",
      participantAgentIds: [ceoId, ctoId],
      facilitatorAgentId: ceoId,
      summaryAgentId: ceoId,
      projectId: null,
      goalId: null,
      referencePath: "/docs/content.md",
      maxDiscussionRounds: 2,
      responseTimeoutSec: 300,
      autoStart: true,
      autoContinue: false,
    }, {
      actorType: "user",
      actorId: "board-user",
      agentId: null,
      runId: null,
    });

    const participants = await db
      .select()
      .from(issueMeetingParticipants)
      .where(eq(issueMeetingParticipants.meetingId, created!.meeting.id))
      .orderBy(issueMeetingParticipants.speakingOrder);

    const comments = await db.insert(issueComments).values([
      {
        companyId,
        issueId: participants[0]!.childIssueId,
        authorKind: "agent",
        authorAgentId: participants[0]!.agentId,
        authorUserId: null,
        authorSystemKey: null,
        systemCommentKind: null,
        body: "CEO는 신뢰 페이지와 운영 주체 노출을 우선해야 한다고 봅니다.",
      },
      {
        companyId,
        issueId: participants[1]!.childIssueId,
        authorKind: "agent",
        authorAgentId: participants[1]!.agentId,
        authorUserId: null,
        authorSystemKey: null,
        systemCommentKind: null,
        body: "CTO는 정책 위반 가능성이 낮은 카테고리 구조를 먼저 정리해야 한다고 봅니다.",
      },
    ]).returning();

    await Promise.all([
      svc.onIssueCommentAdded({
        issueId: participants[0]!.childIssueId,
        comment: {
          id: comments[0]!.id,
          authorKind: "agent",
          authorAgentId: participants[0]!.agentId,
        },
        actor: {
          actorType: "agent",
          actorId: participants[0]!.agentId,
          agentId: participants[0]!.agentId,
          runId: null,
        },
      }),
      svc.onIssueCommentAdded({
        issueId: participants[1]!.childIssueId,
        comment: {
          id: comments[1]!.id,
          authorKind: "agent",
          authorAgentId: participants[1]!.agentId,
        },
        actor: {
          actorType: "agent",
          actorId: participants[1]!.agentId,
          agentId: participants[1]!.agentId,
          runId: null,
        },
      }),
    ]);

    const operatorComment = await db.insert(issueComments).values({
      companyId,
      issueId: created!.rootIssue.id,
      authorKind: "user",
      authorAgentId: null,
      authorUserId: "board-user",
      authorSystemKey: null,
      systemCommentKind: null,
      body: "운영자 코멘트: 두 의견을 합쳐서 신뢰 신호와 카테고리 구조를 같이 잡는 절충안을 중심으로 다시 토론해 주세요.",
    }).returning().then((rows) => rows[0]!);

    await svc.onIssueCommentAdded({
      issueId: created!.rootIssue.id,
      comment: {
        id: operatorComment.id,
        authorKind: "user",
        authorAgentId: null,
      },
      actor: {
        actorType: "user",
        actorId: "board-user",
        agentId: null,
        runId: null,
      },
    });

    dispatchCalls = [];
    const continued = await svc.continueMeetingByIssueId(created!.rootIssue.id, {
      actorType: "user",
      actorId: "board-user",
      agentId: null,
      runId: null,
    });
    expect(continued?.meeting.status).toBe("running");
    expect(continued?.meeting.currentRoundNumber).toBe(2);
    expect(continued?.rounds.map((round) => [round.roundNumber, round.kind, round.status])).toEqual([
      [1, "opening", "completed"],
      [2, "discussion", "collecting"],
    ]);
    expect(continued?.transcript.map((entry) => entry.entryKind)).toEqual([
      "round_opened",
      "participant_response",
      "participant_response",
      "round_summary",
      "operator_signal",
      "operator_comment",
      "round_opened",
    ]);
    expect(dispatchCalls).toHaveLength(2);
    expect(continued?.transcript.some((entry) =>
      entry.entryKind === "operator_comment" && entry.body.includes("절충안")
    )).toBe(true);

    const latestPromptComments = await db
      .select({
        issueId: issueComments.issueId,
        body: issueComments.body,
        systemCommentKind: issueComments.systemCommentKind,
      })
      .from(issueComments)
      .where(and(inArray(issueComments.issueId, participants.map((participant) => participant.childIssueId)), eq(issueComments.systemCommentKind, "control_notice")))
      .orderBy(issueComments.createdAt);

    const latestBodies = latestPromptComments.slice(-2).map((comment) => comment.body);
    expect(latestBodies[0]).toContain("이전 라운드 요약:");
    expect(latestBodies[0]).toContain("당신의 이전 입장:");
    expect(latestBodies[0]).toContain("운영자 코멘트:");
    expect(latestBodies[0]).toContain("절충안");
    expect(latestBodies[0]).toContain("동의하는 주장");
    expect(latestBodies[1]).toContain("이번 라운드에서는 다른 참가자의 핵심 주장에 반응해 주세요.");

    const operatorCommentActivity = await db
      .select({ action: activityLog.action })
      .from(activityLog)
      .where(and(eq(activityLog.entityId, created!.meeting.id), eq(activityLog.action, "meeting.operator_comment_added")));
    expect(operatorCommentActivity).toHaveLength(1);
  });

  it("supports partial continue after skipping a missing participant", async () => {
    const { companyId, ceoId, ctoId } = await seedCompanyWithAgents();
    const created = await svc.createMeeting({
      companyId,
      agenda: "부분 응답 continue 확인",
      participantAgentIds: [ceoId, ctoId],
      facilitatorAgentId: ceoId,
      summaryAgentId: ceoId,
      projectId: null,
      goalId: null,
      referencePath: null,
      maxDiscussionRounds: 2,
      responseTimeoutSec: 300,
      autoStart: true,
      autoContinue: false,
    }, {
      actorType: "user",
      actorId: "board-user",
      agentId: null,
      runId: null,
    });

    const participants = await db
      .select()
      .from(issueMeetingParticipants)
      .where(eq(issueMeetingParticipants.meetingId, created!.meeting.id))
      .orderBy(issueMeetingParticipants.speakingOrder);

    const ceoComment = await db.insert(issueComments).values({
      companyId,
      issueId: participants[0]!.childIssueId,
      authorKind: "agent",
      authorAgentId: participants[0]!.agentId,
      authorUserId: null,
      authorSystemKey: null,
      systemCommentKind: null,
      body: "CEO만 먼저 응답합니다.",
    }).returning().then((rows) => rows[0]!);

    await svc.onIssueCommentAdded({
      issueId: participants[0]!.childIssueId,
      comment: {
        id: ceoComment.id,
        authorKind: "agent",
        authorAgentId: participants[0]!.agentId,
      },
      actor: {
        actorType: "agent",
        actorId: participants[0]!.agentId,
        agentId: participants[0]!.agentId,
        runId: null,
      },
    });

    const skipped = await svc.skipParticipantByIssueId(created!.rootIssue.id, ctoId, {
      actorType: "user",
      actorId: "board-user",
      agentId: null,
      runId: null,
    });
    expect(skipped?.meeting.status).toBe("awaiting_operator");

    dispatchCalls = [];
    const continued = await svc.continueMeetingByIssueId(created!.rootIssue.id, {
      actorType: "user",
      actorId: "board-user",
      agentId: null,
      runId: null,
    });

    expect(continued?.meeting.currentRoundNumber).toBe(2);
    expect(continued?.meeting.status).toBe("running");
    expect(dispatchCalls).toHaveLength(2);
  });

  it("records a timed-out participant reply as late without reopening the round", async () => {
    const { companyId, ceoId, ctoId } = await seedCompanyWithAgents();
    const created = await svc.createMeeting({
      companyId,
      agenda: "늦은 응답 처리 확인",
      participantAgentIds: [ceoId, ctoId],
      facilitatorAgentId: ceoId,
      summaryAgentId: ceoId,
      projectId: null,
      goalId: null,
      referencePath: null,
      maxDiscussionRounds: 1,
      responseTimeoutSec: 60,
      autoStart: true,
      autoContinue: false,
    }, {
      actorType: "user",
      actorId: "board-user",
      agentId: null,
      runId: null,
    });

    const participants = await db
      .select()
      .from(issueMeetingParticipants)
      .where(eq(issueMeetingParticipants.meetingId, created!.meeting.id))
      .orderBy(issueMeetingParticipants.speakingOrder);

    currentNow = new Date("2026-04-07T00:05:00.000Z");
    await svc.refreshMeetingState(created!.meeting.id);

    const lateComment = await db.insert(issueComments).values({
      companyId,
      issueId: participants[0]!.childIssueId,
      authorKind: "agent",
      authorAgentId: participants[0]!.agentId,
      authorUserId: null,
      authorSystemKey: null,
      systemCommentKind: null,
      body: "늦었지만 CEO 의견은 신뢰 페이지 선행입니다.",
    }).returning().then((rows) => rows[0]!);

    await svc.onIssueCommentAdded({
      issueId: participants[0]!.childIssueId,
      comment: {
        id: lateComment.id,
        authorKind: "agent",
        authorAgentId: participants[0]!.agentId,
      },
      actor: {
        actorType: "agent",
        actorId: participants[0]!.agentId,
        agentId: participants[0]!.agentId,
        runId: null,
      },
    });

    const round = await db
      .select()
      .from(issueMeetingRounds)
      .where(eq(issueMeetingRounds.meetingId, created!.meeting.id))
      .then((rows) => rows[0] ?? null);
    expect(round?.status).toBe("timed_out");

    const lateParticipant = await db
      .select()
      .from(issueMeetingRoundParticipants)
      .where(
        and(
          eq(issueMeetingRoundParticipants.roundId, round!.id),
          eq(issueMeetingRoundParticipants.agentId, participants[0]!.agentId),
        ),
      )
      .then((rows) => rows[0] ?? null);

    expect(lateParticipant?.status).toBe("late");
    expect(lateParticipant?.lateResponseCommentId).toBe(lateComment.id);
    expect(lateParticipant?.responseCommentId).toBeNull();

    const dto = await svc.getById(created!.meeting.id);
    expect(dto?.transcript.some((entry) => entry.entryKind === "late_response" && entry.body.includes("늦었지만 CEO 의견"))).toBe(true);
  });

  it("pauses and resumes back to awaiting_operator when the round still needs attention", async () => {
    const { companyId, ceoId, ctoId } = await seedCompanyWithAgents();
    const created = await svc.createMeeting({
      companyId,
      agenda: "pause/resume 재평가 확인",
      participantAgentIds: [ceoId, ctoId],
      facilitatorAgentId: ceoId,
      summaryAgentId: ceoId,
      projectId: null,
      goalId: null,
      referencePath: null,
      maxDiscussionRounds: 1,
      responseTimeoutSec: 60,
      autoStart: true,
      autoContinue: false,
    }, {
      actorType: "user",
      actorId: "board-user",
      agentId: null,
      runId: null,
    });

    currentNow = new Date("2026-04-07T00:05:00.000Z");
    await svc.refreshMeetingState(created!.meeting.id);

    const paused = await svc.pauseMeetingByIssueId(created!.rootIssue.id, {
      actorType: "user",
      actorId: "board-user",
      agentId: null,
      runId: null,
    });
    expect(paused?.meeting.status).toBe("paused");

    const resumed = await svc.resumeMeetingByIssueId(created!.rootIssue.id, {
      actorType: "user",
      actorId: "board-user",
      agentId: null,
      runId: null,
    });
    expect(resumed?.meeting.status).toBe("awaiting_operator");
  });

  it("opens a summary round and records summary_requested_by_user_id", async () => {
    const { companyId, ceoId, ctoId } = await seedCompanyWithAgents();
    const created = await svc.createMeeting({
      companyId,
      agenda: "최종 요약 라운드 진입 확인",
      participantAgentIds: [ceoId, ctoId],
      facilitatorAgentId: ceoId,
      summaryAgentId: ceoId,
      projectId: null,
      goalId: null,
      referencePath: "/docs/meeting.md",
      maxDiscussionRounds: 1,
      responseTimeoutSec: 300,
      autoStart: true,
      autoContinue: false,
    }, {
      actorType: "user",
      actorId: "board-user",
      agentId: null,
      runId: null,
    });

    const participants = await db
      .select()
      .from(issueMeetingParticipants)
      .where(eq(issueMeetingParticipants.meetingId, created!.meeting.id))
      .orderBy(issueMeetingParticipants.speakingOrder);

    const comments = await db.insert(issueComments).values([
      {
        companyId,
        issueId: participants[0]!.childIssueId,
        authorKind: "agent",
        authorAgentId: participants[0]!.agentId,
        authorUserId: null,
        authorSystemKey: null,
        systemCommentKind: null,
        body: "CEO 의견입니다.",
      },
      {
        companyId,
        issueId: participants[1]!.childIssueId,
        authorKind: "agent",
        authorAgentId: participants[1]!.agentId,
        authorUserId: null,
        authorSystemKey: null,
        systemCommentKind: null,
        body: "CTO 의견입니다.",
      },
    ]).returning();

    await Promise.all([
      svc.onIssueCommentAdded({
        issueId: participants[0]!.childIssueId,
        comment: {
          id: comments[0]!.id,
          authorKind: "agent",
          authorAgentId: participants[0]!.agentId,
        },
        actor: {
          actorType: "agent",
          actorId: participants[0]!.agentId,
          agentId: participants[0]!.agentId,
          runId: null,
        },
      }),
      svc.onIssueCommentAdded({
        issueId: participants[1]!.childIssueId,
        comment: {
          id: comments[1]!.id,
          authorKind: "agent",
          authorAgentId: participants[1]!.agentId,
        },
        actor: {
          actorType: "agent",
          actorId: participants[1]!.agentId,
          agentId: participants[1]!.agentId,
          runId: null,
        },
      }),
    ]);

    const operatorComment = await db.insert(issueComments).values({
      companyId,
      issueId: created!.rootIssue.id,
      authorKind: "user",
      authorAgentId: null,
      authorUserId: "board-user",
      authorSystemKey: null,
      systemCommentKind: null,
      body: "운영자 코멘트: 최종 요약에서는 광고 승인을 위한 우선순위와 실행 순서를 분명히 정리해 주세요.",
    }).returning().then((rows) => rows[0]!);

    await svc.onIssueCommentAdded({
      issueId: created!.rootIssue.id,
      comment: {
        id: operatorComment.id,
        authorKind: "user",
        authorAgentId: null,
      },
      actor: {
        actorType: "user",
        actorId: "board-user",
        agentId: null,
        runId: null,
      },
    });

    dispatchCalls = [];
    const summarized = await svc.summaryMeetingByIssueId(created!.rootIssue.id, {}, {
      actorType: "user",
      actorId: "board-user",
      agentId: null,
      runId: null,
    });

    expect(summarized?.meeting.status).toBe("running");
    expect(summarized?.meeting.currentRoundNumber).toBe(2);
    expect(summarized?.meeting.currentRoundKind).toBe("summary");
    expect(dispatchCalls).toHaveLength(1);
    expect(dispatchCalls[0]?.agentId).toBe(ceoId);

    const summaryRound = await db
      .select()
      .from(issueMeetingRounds)
      .where(and(eq(issueMeetingRounds.meetingId, created!.meeting.id), eq(issueMeetingRounds.kind, "summary")))
      .then((rows) => rows[0] ?? null);

    expect(summaryRound?.summaryRequestedByUserId).toBe("board-user");
    expect(summaryRound?.status).toBe("collecting");

    const latestPrompt = await db
      .select({ body: issueComments.body })
      .from(issueComments)
      .where(eq(issueComments.issueId, participants[0]!.childIssueId))
      .orderBy(issueComments.createdAt)
      .then((rows) => rows.at(-1)?.body ?? "");
    expect(latestPrompt).toContain("전체회의 최종 요약 요청");
    expect(latestPrompt).toContain("이전 라운드 요약:");
    expect(latestPrompt).toContain("운영자 코멘트:");
    expect(latestPrompt).toContain("우선순위와 실행 순서");
  });

  it("uses continue to transition from the last discussion round into summary", async () => {
    const { companyId, ceoId, ctoId } = await seedCompanyWithAgents();
    const created = await svc.createMeeting({
      companyId,
      agenda: "continue -> summary 전이 확인",
      participantAgentIds: [ceoId, ctoId],
      facilitatorAgentId: ceoId,
      summaryAgentId: ceoId,
      projectId: null,
      goalId: null,
      referencePath: null,
      maxDiscussionRounds: 1,
      responseTimeoutSec: 300,
      autoStart: true,
      autoContinue: false,
    }, {
      actorType: "user",
      actorId: "board-user",
      agentId: null,
      runId: null,
    });

    const participants = await db
      .select()
      .from(issueMeetingParticipants)
      .where(eq(issueMeetingParticipants.meetingId, created!.meeting.id))
      .orderBy(issueMeetingParticipants.speakingOrder);

    const openingComments = await db.insert(issueComments).values([
      {
        companyId,
        issueId: participants[0]!.childIssueId,
        authorKind: "agent",
        authorAgentId: participants[0]!.agentId,
        authorUserId: null,
        authorSystemKey: null,
        systemCommentKind: null,
        body: "CEO opening 의견",
      },
      {
        companyId,
        issueId: participants[1]!.childIssueId,
        authorKind: "agent",
        authorAgentId: participants[1]!.agentId,
        authorUserId: null,
        authorSystemKey: null,
        systemCommentKind: null,
        body: "CTO opening 의견",
      },
    ]).returning();

    await Promise.all([
      svc.onIssueCommentAdded({
        issueId: participants[0]!.childIssueId,
        comment: {
          id: openingComments[0]!.id,
          authorKind: "agent",
          authorAgentId: participants[0]!.agentId,
        },
        actor: {
          actorType: "agent",
          actorId: participants[0]!.agentId,
          agentId: participants[0]!.agentId,
          runId: null,
        },
      }),
      svc.onIssueCommentAdded({
        issueId: participants[1]!.childIssueId,
        comment: {
          id: openingComments[1]!.id,
          authorKind: "agent",
          authorAgentId: participants[1]!.agentId,
        },
        actor: {
          actorType: "agent",
          actorId: participants[1]!.agentId,
          agentId: participants[1]!.agentId,
          runId: null,
        },
      }),
    ]);

    await svc.continueMeetingByIssueId(created!.rootIssue.id, {
      actorType: "user",
      actorId: "board-user",
      agentId: null,
      runId: null,
    });

    const discussionComments = await db.insert(issueComments).values([
      {
        companyId,
        issueId: participants[0]!.childIssueId,
        authorKind: "agent",
        authorAgentId: participants[0]!.agentId,
        authorUserId: null,
        authorSystemKey: null,
        systemCommentKind: null,
        body: "CEO discussion 의견",
      },
      {
        companyId,
        issueId: participants[1]!.childIssueId,
        authorKind: "agent",
        authorAgentId: participants[1]!.agentId,
        authorUserId: null,
        authorSystemKey: null,
        systemCommentKind: null,
        body: "CTO discussion 의견",
      },
    ]).returning();

    await Promise.all([
      svc.onIssueCommentAdded({
        issueId: participants[0]!.childIssueId,
        comment: {
          id: discussionComments[0]!.id,
          authorKind: "agent",
          authorAgentId: participants[0]!.agentId,
        },
        actor: {
          actorType: "agent",
          actorId: participants[0]!.agentId,
          agentId: participants[0]!.agentId,
          runId: null,
        },
      }),
      svc.onIssueCommentAdded({
        issueId: participants[1]!.childIssueId,
        comment: {
          id: discussionComments[1]!.id,
          authorKind: "agent",
          authorAgentId: participants[1]!.agentId,
        },
        actor: {
          actorType: "agent",
          actorId: participants[1]!.agentId,
          agentId: participants[1]!.agentId,
          runId: null,
        },
      }),
    ]);

    dispatchCalls = [];
    const summarized = await svc.continueMeetingByIssueId(created!.rootIssue.id, {
      actorType: "user",
      actorId: "board-user",
      agentId: null,
      runId: null,
    });

    expect(summarized?.meeting.currentRoundKind).toBe("summary");
    expect(dispatchCalls).toHaveLength(1);

    const summaryRound = await db
      .select()
      .from(issueMeetingRounds)
      .where(and(eq(issueMeetingRounds.meetingId, created!.meeting.id), eq(issueMeetingRounds.kind, "summary")))
      .then((rows) => rows[0] ?? null);
    expect(summaryRound?.summaryRequestedByUserId).toBe("board-user");
  });

  it("reopens a followup round for all participants from an awaiting-operator summary round", async () => {
    const { companyId, ceoId, ctoId } = await seedCompanyWithAgents();
    const created = await svc.createMeeting({
      companyId,
      agenda: "운영자 코멘트 이후 전원 재토론 확인",
      participantAgentIds: [ceoId, ctoId],
      facilitatorAgentId: ceoId,
      summaryAgentId: ceoId,
      projectId: null,
      goalId: null,
      referencePath: null,
      maxDiscussionRounds: 1,
      responseTimeoutSec: 300,
      autoStart: true,
      autoContinue: false,
    }, {
      actorType: "user",
      actorId: "board-user",
      agentId: null,
      runId: null,
    });

    const participants = await db
      .select()
      .from(issueMeetingParticipants)
      .where(eq(issueMeetingParticipants.meetingId, created!.meeting.id))
      .orderBy(issueMeetingParticipants.speakingOrder);

    const openingComments = await db.insert(issueComments).values([
      {
        companyId,
        issueId: participants[0]!.childIssueId,
        authorKind: "agent",
        authorAgentId: participants[0]!.agentId,
        authorUserId: null,
        authorSystemKey: null,
        systemCommentKind: null,
        body: "CEO opening 의견",
      },
      {
        companyId,
        issueId: participants[1]!.childIssueId,
        authorKind: "agent",
        authorAgentId: participants[1]!.agentId,
        authorUserId: null,
        authorSystemKey: null,
        systemCommentKind: null,
        body: "CTO opening 의견",
      },
    ]).returning();

    await Promise.all([
      svc.onIssueCommentAdded({
        issueId: participants[0]!.childIssueId,
        comment: {
          id: openingComments[0]!.id,
          authorKind: "agent",
          authorAgentId: participants[0]!.agentId,
        },
        actor: {
          actorType: "agent",
          actorId: participants[0]!.agentId,
          agentId: participants[0]!.agentId,
          runId: null,
        },
      }),
      svc.onIssueCommentAdded({
        issueId: participants[1]!.childIssueId,
        comment: {
          id: openingComments[1]!.id,
          authorKind: "agent",
          authorAgentId: participants[1]!.agentId,
        },
        actor: {
          actorType: "agent",
          actorId: participants[1]!.agentId,
          agentId: participants[1]!.agentId,
          runId: null,
        },
      }),
    ]);

    await svc.summaryMeetingByIssueId(created!.rootIssue.id, {}, {
      actorType: "user",
      actorId: "board-user",
      agentId: null,
      runId: null,
    });

    const operatorComment = await db.insert(issueComments).values({
      companyId,
      issueId: created!.rootIssue.id,
      authorKind: "user",
      authorAgentId: null,
      authorUserId: "board-user",
      authorSystemKey: null,
      systemCommentKind: null,
      body: "운영자 코멘트: CTO 의견에 동의합니다. 다만 너무 느리게 가지 말고 최소 2주 공개 리듬은 같이 제안해 주세요.",
    }).returning().then((rows) => rows[0]!);

    await svc.onIssueCommentAdded({
      issueId: created!.rootIssue.id,
      comment: {
        id: operatorComment.id,
        authorKind: "user",
        authorAgentId: null,
      },
      actor: {
        actorType: "user",
        actorId: "board-user",
        agentId: null,
        runId: null,
      },
    });

    await svc.skipParticipantByIssueId(created!.rootIssue.id, ceoId, {
      actorType: "user",
      actorId: "board-user",
      agentId: null,
      runId: null,
    });

    dispatchCalls = [];
    const reopened = await svc.reopenDiscussionByIssueId(created!.rootIssue.id, {
      actorType: "user",
      actorId: "board-user",
      agentId: null,
      runId: null,
    });

    expect(reopened?.meeting.status).toBe("running");
    expect(reopened?.meeting.currentRoundKind).toBe("followup");
    expect(reopened?.currentRoundParticipants).toHaveLength(2);
    expect(dispatchCalls).toHaveLength(2);

    const summaryRound = await db
      .select()
      .from(issueMeetingRounds)
      .where(and(eq(issueMeetingRounds.meetingId, created!.meeting.id), eq(issueMeetingRounds.kind, "summary")))
      .then((rows) => rows[0] ?? null);
    expect(summaryRound?.status).toBe("cancelled");

    const prompts = await db
      .select({ issueId: issueComments.issueId, body: issueComments.body })
      .from(issueComments)
      .where(inArray(issueComments.issueId, participants.map((participant) => participant.childIssueId)))
      .orderBy(issueComments.createdAt);
    const followupPrompts = prompts.filter((row) =>
      row.body.includes("답변 형식:")
      && row.body.includes("운영자 코멘트:")
      && row.body.includes("1. 동의하는 주장"));
    expect(followupPrompts).toHaveLength(2);
    for (const prompt of followupPrompts) {
      expect(prompt.body).toContain("CTO 의견에 동의합니다");
      expect(prompt.body).toContain("최소 2주 공개 리듬");
    }
  });

  it("continues from a reopened followup round back into a fresh summary round", async () => {
    const { companyId, ceoId, ctoId } = await seedCompanyWithAgents();
    const created = await svc.createMeeting({
      companyId,
      agenda: "재토론 후 다시 summary 진입 확인",
      participantAgentIds: [ceoId, ctoId],
      facilitatorAgentId: ceoId,
      summaryAgentId: ceoId,
      projectId: null,
      goalId: null,
      referencePath: null,
      maxDiscussionRounds: 1,
      responseTimeoutSec: 300,
      autoStart: true,
      autoContinue: false,
    }, {
      actorType: "user",
      actorId: "board-user",
      agentId: null,
      runId: null,
    });

    const participants = await db
      .select()
      .from(issueMeetingParticipants)
      .where(eq(issueMeetingParticipants.meetingId, created!.meeting.id))
      .orderBy(issueMeetingParticipants.speakingOrder);

    const openingComments = await db.insert(issueComments).values([
      {
        companyId,
        issueId: participants[0]!.childIssueId,
        authorKind: "agent",
        authorAgentId: participants[0]!.agentId,
        authorUserId: null,
        authorSystemKey: null,
        systemCommentKind: null,
        body: "CEO opening 의견",
      },
      {
        companyId,
        issueId: participants[1]!.childIssueId,
        authorKind: "agent",
        authorAgentId: participants[1]!.agentId,
        authorUserId: null,
        authorSystemKey: null,
        systemCommentKind: null,
        body: "CTO opening 의견",
      },
    ]).returning();

    await Promise.all([
      svc.onIssueCommentAdded({
        issueId: participants[0]!.childIssueId,
        comment: {
          id: openingComments[0]!.id,
          authorKind: "agent",
          authorAgentId: participants[0]!.agentId,
        },
        actor: {
          actorType: "agent",
          actorId: participants[0]!.agentId,
          agentId: participants[0]!.agentId,
          runId: null,
        },
      }),
      svc.onIssueCommentAdded({
        issueId: participants[1]!.childIssueId,
        comment: {
          id: openingComments[1]!.id,
          authorKind: "agent",
          authorAgentId: participants[1]!.agentId,
        },
        actor: {
          actorType: "agent",
          actorId: participants[1]!.agentId,
          agentId: participants[1]!.agentId,
          runId: null,
        },
      }),
    ]);

    await svc.summaryMeetingByIssueId(created!.rootIssue.id, {}, {
      actorType: "user",
      actorId: "board-user",
      agentId: null,
      runId: null,
    });

    await svc.skipParticipantByIssueId(created!.rootIssue.id, ceoId, {
      actorType: "user",
      actorId: "board-user",
      agentId: null,
      runId: null,
    });

    dispatchCalls = [];
    const reopened = await svc.reopenDiscussionByIssueId(created!.rootIssue.id, {
      actorType: "user",
      actorId: "board-user",
      agentId: null,
      runId: null,
    });

    expect(reopened?.meeting.currentRoundKind).toBe("followup");
    expect(dispatchCalls).toHaveLength(2);

    const followupComments = await db.insert(issueComments).values([
      {
        companyId,
        issueId: participants[0]!.childIssueId,
        authorKind: "agent",
        authorAgentId: participants[0]!.agentId,
        authorUserId: null,
        authorSystemKey: null,
        systemCommentKind: null,
        body: "CEO followup 의견",
      },
      {
        companyId,
        issueId: participants[1]!.childIssueId,
        authorKind: "agent",
        authorAgentId: participants[1]!.agentId,
        authorUserId: null,
        authorSystemKey: null,
        systemCommentKind: null,
        body: "CTO followup 의견",
      },
    ]).returning();

    await Promise.all([
      svc.onIssueCommentAdded({
        issueId: participants[0]!.childIssueId,
        comment: {
          id: followupComments[0]!.id,
          authorKind: "agent",
          authorAgentId: participants[0]!.agentId,
        },
        actor: {
          actorType: "agent",
          actorId: participants[0]!.agentId,
          agentId: participants[0]!.agentId,
          runId: null,
        },
      }),
      svc.onIssueCommentAdded({
        issueId: participants[1]!.childIssueId,
        comment: {
          id: followupComments[1]!.id,
          authorKind: "agent",
          authorAgentId: participants[1]!.agentId,
        },
        actor: {
          actorType: "agent",
          actorId: participants[1]!.agentId,
          agentId: participants[1]!.agentId,
          runId: null,
        },
      }),
    ]);

    dispatchCalls = [];
    const continued = await svc.continueMeetingByIssueId(created!.rootIssue.id, {
      actorType: "user",
      actorId: "board-user",
      agentId: null,
      runId: null,
    });

    expect(continued?.meeting.status).toBe("running");
    expect(continued?.meeting.currentRoundKind).toBe("summary");
    expect(continued?.meeting.currentRoundNumber).toBe(4);
    expect(dispatchCalls).toHaveLength(1);
    expect(dispatchCalls[0]?.agentId).toBe(ceoId);

    const summaryRounds = await db
      .select()
      .from(issueMeetingRounds)
      .where(and(eq(issueMeetingRounds.meetingId, created!.meeting.id), eq(issueMeetingRounds.kind, "summary")))
      .orderBy(issueMeetingRounds.roundNumber);

    expect(summaryRounds.map((round) => [round.roundNumber, round.status])).toEqual([
      [2, "cancelled"],
      [4, "collecting"],
    ]);
  });

  it("completes the meeting when the summarizer responds", async () => {
    const { companyId, ceoId, ctoId } = await seedCompanyWithAgents();
    const created = await svc.createMeeting({
      companyId,
      agenda: "최종 요약 완료 확인",
      participantAgentIds: [ceoId, ctoId],
      facilitatorAgentId: ceoId,
      summaryAgentId: ceoId,
      projectId: null,
      goalId: null,
      referencePath: null,
      maxDiscussionRounds: 1,
      responseTimeoutSec: 300,
      autoStart: true,
      autoContinue: false,
    }, {
      actorType: "user",
      actorId: "board-user",
      agentId: null,
      runId: null,
    });

    const participants = await db
      .select()
      .from(issueMeetingParticipants)
      .where(eq(issueMeetingParticipants.meetingId, created!.meeting.id))
      .orderBy(issueMeetingParticipants.speakingOrder);

    const comments = await db.insert(issueComments).values([
      {
        companyId,
        issueId: participants[0]!.childIssueId,
        authorKind: "agent",
        authorAgentId: participants[0]!.agentId,
        authorUserId: null,
        authorSystemKey: null,
        systemCommentKind: null,
        body: "CEO 의견입니다.",
      },
      {
        companyId,
        issueId: participants[1]!.childIssueId,
        authorKind: "agent",
        authorAgentId: participants[1]!.agentId,
        authorUserId: null,
        authorSystemKey: null,
        systemCommentKind: null,
        body: "CTO 의견입니다.",
      },
    ]).returning();

    await Promise.all([
      svc.onIssueCommentAdded({
        issueId: participants[0]!.childIssueId,
        comment: {
          id: comments[0]!.id,
          authorKind: "agent",
          authorAgentId: participants[0]!.agentId,
        },
        actor: {
          actorType: "agent",
          actorId: participants[0]!.agentId,
          agentId: participants[0]!.agentId,
          runId: null,
        },
      }),
      svc.onIssueCommentAdded({
        issueId: participants[1]!.childIssueId,
        comment: {
          id: comments[1]!.id,
          authorKind: "agent",
          authorAgentId: participants[1]!.agentId,
        },
        actor: {
          actorType: "agent",
          actorId: participants[1]!.agentId,
          agentId: participants[1]!.agentId,
          runId: null,
        },
      }),
    ]);

    await svc.summaryMeetingByIssueId(created!.rootIssue.id, {}, {
      actorType: "user",
      actorId: "board-user",
      agentId: null,
      runId: null,
    });

    const finalComment = await db.insert(issueComments).values({
      companyId,
      issueId: participants[0]!.childIssueId,
      authorKind: "agent",
      authorAgentId: participants[0]!.agentId,
      authorUserId: null,
      authorSystemKey: null,
      systemCommentKind: null,
      body: "권장 결론: 신뢰 페이지와 정책 페이지를 먼저 보강합니다.\n실행안: 1) 회사 소개 2) 연락처 3) 광고정책 카테고리 정리",
    }).returning().then((rows) => rows[0]!);

    await svc.onIssueCommentAdded({
      issueId: participants[0]!.childIssueId,
      comment: {
        id: finalComment.id,
        authorKind: "agent",
        authorAgentId: participants[0]!.agentId,
      },
      actor: {
        actorType: "agent",
        actorId: participants[0]!.agentId,
        agentId: participants[0]!.agentId,
        runId: null,
      },
    });

    const meeting = await db
      .select()
      .from(issueMeetings)
      .where(eq(issueMeetings.id, created!.meeting.id))
      .then((rows) => rows[0] ?? null);
    expect(meeting?.status).toBe("completed");
    expect(meeting?.completedAt).not.toBeNull();

    const rootIssue = await db
      .select()
      .from(issues)
      .where(eq(issues.id, created!.rootIssue.id))
      .then((rows) => rows[0] ?? null);
    expect(rootIssue?.status).toBe("done");

    const rootComments = await db
      .select({ systemCommentKind: issueComments.systemCommentKind })
      .from(issueComments)
      .where(eq(issueComments.issueId, created!.rootIssue.id));
    expect(rootComments.filter((comment) => comment.systemCommentKind === "meeting_completed")).toHaveLength(1);

    const dto = await svc.getById(created!.meeting.id);
    expect(dto?.transcript.some((entry) => entry.entryKind === "final_summary" && entry.body.includes("권장 결론"))).toBe(true);
    expect(dto?.transcript.at(-1)?.entryKind).toBe("meeting_completed");

    const completionActivity = await db
      .select({ action: activityLog.action })
      .from(activityLog)
      .where(and(eq(activityLog.entityId, created!.meeting.id), eq(activityLog.action, "meeting.completed")));
    expect(completionActivity).toHaveLength(1);
  });

  it("marks final status as partial_completed after skipped participants", async () => {
    const { companyId, ceoId, ctoId } = await seedCompanyWithAgents();
    const created = await svc.createMeeting({
      companyId,
      agenda: "partial completed 확인",
      participantAgentIds: [ceoId, ctoId],
      facilitatorAgentId: ceoId,
      summaryAgentId: ceoId,
      projectId: null,
      goalId: null,
      referencePath: null,
      maxDiscussionRounds: 1,
      responseTimeoutSec: 300,
      autoStart: true,
      autoContinue: false,
    }, {
      actorType: "user",
      actorId: "board-user",
      agentId: null,
      runId: null,
    });

    const participants = await db
      .select()
      .from(issueMeetingParticipants)
      .where(eq(issueMeetingParticipants.meetingId, created!.meeting.id))
      .orderBy(issueMeetingParticipants.speakingOrder);

    const ceoComment = await db.insert(issueComments).values({
      companyId,
      issueId: participants[0]!.childIssueId,
      authorKind: "agent",
      authorAgentId: participants[0]!.agentId,
      authorUserId: null,
      authorSystemKey: null,
      systemCommentKind: null,
      body: "CEO만 먼저 답합니다.",
    }).returning().then((rows) => rows[0]!);

    await svc.onIssueCommentAdded({
      issueId: participants[0]!.childIssueId,
      comment: {
        id: ceoComment.id,
        authorKind: "agent",
        authorAgentId: participants[0]!.agentId,
      },
      actor: {
        actorType: "agent",
        actorId: participants[0]!.agentId,
        agentId: participants[0]!.agentId,
        runId: null,
      },
    });

    await svc.skipParticipantByIssueId(created!.rootIssue.id, ctoId, {
      actorType: "user",
      actorId: "board-user",
      agentId: null,
      runId: null,
    });

    await svc.summaryMeetingByIssueId(created!.rootIssue.id, {}, {
      actorType: "user",
      actorId: "board-user",
      agentId: null,
      runId: null,
    });

    const finalComment = await db.insert(issueComments).values({
      companyId,
      issueId: participants[0]!.childIssueId,
      authorKind: "agent",
      authorAgentId: participants[0]!.agentId,
      authorUserId: null,
      authorSystemKey: null,
      systemCommentKind: null,
      body: "권장 결론: 현 단계에서는 CEO 의견 기준으로 진행합니다.",
    }).returning().then((rows) => rows[0]!);

    await svc.onIssueCommentAdded({
      issueId: participants[0]!.childIssueId,
      comment: {
        id: finalComment.id,
        authorKind: "agent",
        authorAgentId: participants[0]!.agentId,
      },
      actor: {
        actorType: "agent",
        actorId: participants[0]!.agentId,
        agentId: participants[0]!.agentId,
        runId: null,
      },
    });

    const meeting = await db
      .select()
      .from(issueMeetings)
      .where(eq(issueMeetings.id, created!.meeting.id))
      .then((rows) => rows[0] ?? null);
    expect(meeting?.status).toBe("partial_completed");

    const partialActivity = await db
      .select({ action: activityLog.action })
      .from(activityLog)
      .where(and(eq(activityLog.entityId, created!.meeting.id), eq(activityLog.action, "meeting.partial_completed")));
    expect(partialActivity).toHaveLength(1);
  });

  it("reassigns the summary round across participants without duplicating history rows", async () => {
    const { companyId, ceoId, ctoId } = await seedCompanyWithAgents();
    const created = await svc.createMeeting({
      companyId,
      agenda: "요약자 재할당 확인",
      participantAgentIds: [ceoId, ctoId],
      facilitatorAgentId: ceoId,
      summaryAgentId: ceoId,
      projectId: null,
      goalId: null,
      referencePath: null,
      maxDiscussionRounds: 1,
      responseTimeoutSec: 60,
      autoStart: true,
      autoContinue: false,
    }, {
      actorType: "user",
      actorId: "board-user",
      agentId: null,
      runId: null,
    });

    const participants = await db
      .select()
      .from(issueMeetingParticipants)
      .where(eq(issueMeetingParticipants.meetingId, created!.meeting.id))
      .orderBy(issueMeetingParticipants.speakingOrder);

    const comments = await db.insert(issueComments).values([
      {
        companyId,
        issueId: participants[0]!.childIssueId,
        authorKind: "agent",
        authorAgentId: participants[0]!.agentId,
        authorUserId: null,
        authorSystemKey: null,
        systemCommentKind: null,
        body: "CEO 의견입니다.",
      },
      {
        companyId,
        issueId: participants[1]!.childIssueId,
        authorKind: "agent",
        authorAgentId: participants[1]!.agentId,
        authorUserId: null,
        authorSystemKey: null,
        systemCommentKind: null,
        body: "CTO 의견입니다.",
      },
    ]).returning();

    await Promise.all([
      svc.onIssueCommentAdded({
        issueId: participants[0]!.childIssueId,
        comment: {
          id: comments[0]!.id,
          authorKind: "agent",
          authorAgentId: participants[0]!.agentId,
        },
        actor: {
          actorType: "agent",
          actorId: participants[0]!.agentId,
          agentId: participants[0]!.agentId,
          runId: null,
        },
      }),
      svc.onIssueCommentAdded({
        issueId: participants[1]!.childIssueId,
        comment: {
          id: comments[1]!.id,
          authorKind: "agent",
          authorAgentId: participants[1]!.agentId,
        },
        actor: {
          actorType: "agent",
          actorId: participants[1]!.agentId,
          agentId: participants[1]!.agentId,
          runId: null,
        },
      }),
    ]);

    await svc.summaryMeetingByIssueId(created!.rootIssue.id, { summaryAgentId: ceoId }, {
      actorType: "user",
      actorId: "board-user",
      agentId: null,
      runId: null,
    });

    currentNow = new Date("2026-04-07T00:05:00.000Z");
    await svc.refreshMeetingState(created!.meeting.id);

    await svc.summaryMeetingByIssueId(created!.rootIssue.id, { summaryAgentId: ctoId }, {
      actorType: "user",
      actorId: "board-user",
      agentId: null,
      runId: null,
    });

    currentNow = new Date("2026-04-07T00:10:00.000Z");
    await svc.refreshMeetingState(created!.meeting.id);

    await svc.summaryMeetingByIssueId(created!.rootIssue.id, { summaryAgentId: ceoId }, {
      actorType: "user",
      actorId: "board-user",
      agentId: null,
      runId: null,
    });

    const summaryRound = await db
      .select()
      .from(issueMeetingRounds)
      .where(and(eq(issueMeetingRounds.meetingId, created!.meeting.id), eq(issueMeetingRounds.kind, "summary")))
      .then((rows) => rows[0] ?? null);

    const summaryRows = await db
      .select({
        agentId: issueMeetingRoundParticipants.agentId,
        status: issueMeetingRoundParticipants.status,
      })
      .from(issueMeetingRoundParticipants)
      .where(eq(issueMeetingRoundParticipants.roundId, summaryRound!.id));

    expect(summaryRows).toHaveLength(2);
    expect(summaryRows.filter((row) => row.agentId === ceoId)).toHaveLength(1);
    expect(summaryRows.filter((row) => row.agentId === ctoId)).toHaveLength(1);
    expect(summaryRows.find((row) => row.agentId === ceoId)?.status).toBe("queued");
    expect(summaryRows.find((row) => row.agentId === ctoId)?.status).toBe("timed_out");
  });
});
