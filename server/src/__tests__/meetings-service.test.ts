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

describeEmbeddedPostgres("meetingService phase B", () => {
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

    await svc.onIssueCommentAdded({
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
    });

    await svc.onIssueCommentAdded({
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
    });

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

    expect(rootComments.some((comment) => comment.systemCommentKind === "round_summary")).toBe(true);
    expect(rootComments.some((comment) => comment.systemCommentKind === "operator_attention")).toBe(true);

    const refreshedChildren = await db
      .select({
        id: issues.id,
        status: issues.status,
      })
      .from(issues)
      .where(inArray(issues.id, participants.map((participant) => participant.childIssueId)));
    expect(refreshedChildren.every((issue) => issue.status === "in_review")).toBe(true);
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
});
