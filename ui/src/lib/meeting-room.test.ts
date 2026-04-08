// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { MeetingRoomDTO } from "@paperclipai/shared";
import {
  canAddOperatorComment,
  canContinueMeeting,
  canPauseMeeting,
  canReopenDiscussion,
  canRemindMeetingParticipant,
  canRequestMeetingSummary,
  canResumeMeeting,
  canSkipMeetingParticipant,
  describeMeetingStatus,
  estimateMeetingExecution,
  formatMeetingDurationLabel,
  formatMeetingParticipantStatusLabel,
  formatMeetingRoundKindLabel,
  formatMeetingStatusLabel,
  meetingGuardrailNotes,
  shouldCollapseMeetingTranscriptEntry,
  summarizeMeetingTranscriptEntry,
} from "./meeting-room";

function createMeetingRoom(overrides: Partial<MeetingRoomDTO> = {}): MeetingRoomDTO {
  return {
    meeting: {
      id: "meeting-1",
      companyId: "company-1",
      rootIssueId: "issue-1",
      facilitatorAgentId: "agent-1",
      summaryAgentId: "agent-1",
      status: "awaiting_operator",
      agenda: "안건",
      referencePath: null,
      projectId: null,
      goalId: null,
      billingCode: null,
      maxDiscussionRounds: 1,
      responseTimeoutSec: 300,
      autoStart: true,
      autoContinue: false,
      currentRoundNumber: 2,
      currentRoundKind: "discussion",
      needsAttention: true,
      lastOperatorSignalCommentId: null,
      lastRoundCompletedAt: null,
      completedAt: null,
      createdAt: new Date("2026-04-07T00:00:00.000Z"),
      updatedAt: new Date("2026-04-07T00:00:00.000Z"),
    },
    rootIssue: {
      id: "issue-1",
      title: "회의",
      projectId: null,
      goalId: null,
      meetingId: "meeting-1",
      meetingMode: "orchestrated",
    },
    participants: [],
    rounds: [
      {
        id: "round-2",
        roundNumber: 2,
        kind: "discussion",
        status: "awaiting_operator",
        deadlineAt: null,
        completedAt: null,
      },
    ],
    currentRoundParticipants: [
      {
        id: "rp-1",
        participantId: "participant-1",
        agentId: "agent-1",
        childIssueId: "child-1",
        speakingOrder: 0,
        status: "timed_out",
        remindedCount: 0,
        deadlineAt: null,
        respondedAt: null,
        skipReason: null,
        failureReason: null,
        lastErrorCode: null,
      },
    ],
    transcript: [],
    ...overrides,
  };
}

describe("meeting room helpers", () => {
  it("formats labels in Korean", () => {
    expect(formatMeetingStatusLabel("partial_completed")).toBe("부분 완료");
    expect(formatMeetingRoundKindLabel("followup")).toBe("추가 토론");
    expect(formatMeetingParticipantStatusLabel("coalesced")).toBe("기존 실행 합류");
  });

  it("computes high-level control visibility", () => {
    const awaiting = createMeetingRoom();
    expect(canContinueMeeting(awaiting)).toBe(true);
    expect(canAddOperatorComment(awaiting)).toBe(true);
    expect(canPauseMeeting(awaiting)).toBe(true);
    expect(canResumeMeeting(awaiting)).toBe(false);
    expect(canRequestMeetingSummary(awaiting)).toBe(true);

    const paused = createMeetingRoom({
      meeting: { ...awaiting.meeting, status: "paused" },
    });
    expect(canAddOperatorComment(paused)).toBe(true);
    expect(canPauseMeeting(paused)).toBe(false);
    expect(canResumeMeeting(paused)).toBe(true);

    const completed = createMeetingRoom({
      meeting: { ...awaiting.meeting, status: "completed" },
    });
    expect(canAddOperatorComment(completed)).toBe(false);
  });

  it("gates remind/skip by current round and participant status", () => {
    const room = createMeetingRoom();
    const participant = room.currentRoundParticipants[0]!;
    expect(canRemindMeetingParticipant(room, participant)).toBe(true);
    expect(canSkipMeetingParticipant(room, participant)).toBe(true);

    const responded = {
      ...participant,
      status: "responded" as const,
    };
    expect(canRemindMeetingParticipant(room, responded)).toBe(false);
    expect(canSkipMeetingParticipant(room, responded)).toBe(false);

    const timedOutRound = createMeetingRoom({
      rounds: [
        {
          id: "round-2",
          roundNumber: 2,
          kind: "discussion",
          status: "timed_out",
          deadlineAt: null,
          completedAt: null,
        },
      ],
    });
    expect(canRemindMeetingParticipant(timedOutRound, participant)).toBe(true);
    expect(canSkipMeetingParticipant(timedOutRound, participant)).toBe(false);
  });

  it("computes a rough execution estimate and timeout labels", () => {
    const room = createMeetingRoom({
      participants: [
        { id: "p1", agentId: "agent-1", childIssueId: "child-1", speakingOrder: 0, status: "active", isFacilitator: true, isSummarizer: true },
        { id: "p2", agentId: "agent-2", childIssueId: "child-2", speakingOrder: 1, status: "active", isFacilitator: false, isSummarizer: false },
        { id: "p3", agentId: "agent-3", childIssueId: "child-3", speakingOrder: 2, status: "active", isFacilitator: false, isSummarizer: false },
      ],
      meeting: {
        ...createMeetingRoom().meeting,
        maxDiscussionRounds: 2,
        responseTimeoutSec: 1800,
      },
    });

    const estimate = estimateMeetingExecution(room);
    expect(estimate.estimatedTotalRounds).toBe(4);
    expect(estimate.maxResponses).toBe(10);
    expect(estimate.estimatedPromptTokensMin).toBeGreaterThan(0);
    expect(formatMeetingDurationLabel(room.meeting.responseTimeoutSec)).toBe("30분");
  });

  it("allows reopening discussion only from an awaiting-operator summary round", () => {
    const summaryRoom = createMeetingRoom({
      meeting: {
        ...createMeetingRoom().meeting,
        status: "awaiting_operator",
        currentRoundKind: "summary",
      },
    });
    expect(canReopenDiscussion(summaryRoom)).toBe(true);

    const discussionRoom = createMeetingRoom({
      meeting: {
        ...createMeetingRoom().meeting,
        status: "awaiting_operator",
        currentRoundKind: "discussion",
      },
    });
    expect(canReopenDiscussion(discussionRoom)).toBe(false);
  });

  it("produces guardrail notes and status copy for edge states", () => {
    const room = createMeetingRoom({
      participants: [
        { id: "p1", agentId: "agent-1", childIssueId: "child-1", speakingOrder: 0, status: "active", isFacilitator: true, isSummarizer: true },
        { id: "p2", agentId: "agent-2", childIssueId: "child-2", speakingOrder: 1, status: "active", isFacilitator: false, isSummarizer: false },
        { id: "p3", agentId: "agent-3", childIssueId: "child-3", speakingOrder: 2, status: "active", isFacilitator: false, isSummarizer: false },
        { id: "p4", agentId: "agent-4", childIssueId: "child-4", speakingOrder: 3, status: "active", isFacilitator: false, isSummarizer: false },
      ],
      meeting: {
        ...createMeetingRoom().meeting,
        status: "paused",
        maxDiscussionRounds: 3,
        responseTimeoutSec: 3600,
        autoContinue: false,
      },
    });

    expect(meetingGuardrailNotes(room)).toHaveLength(4);
    expect(describeMeetingStatus(room)).toEqual({
      tone: "warning",
      title: "회의가 일시중지되었습니다",
      body: "재개하기 전까지 새 라운드 전이와 자동 dispatch가 멈춰 있습니다.",
    });
  });

  it("collapses verbose round summaries by default", () => {
    const room = createMeetingRoom({
      transcript: [
        {
          entryKind: "round_summary",
          roundNumber: 1,
          roundKind: "opening",
          participantAgentId: null,
          sourceIssueId: "issue-1",
          sourceCommentId: "comment-1",
          authorKind: "system",
          systemCommentKind: "round_summary",
          body: "라운드 1 요약\n\n수집된 응답: 3건\n\n긴 본문",
          createdAt: new Date("2026-04-07T00:03:00.000Z"),
          respondedAt: null,
          speakingOrder: null,
        },
      ],
    });

    const entry = room.transcript[0]!;
    expect(shouldCollapseMeetingTranscriptEntry(entry)).toBe(true);
    expect(summarizeMeetingTranscriptEntry(entry)).toBe("라운드 1 요약 · 응답 3건 · 기본 접힘");
  });
});
