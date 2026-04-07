import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  boolean as pgBoolean,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";
import { agents } from "./agents.js";
import { heartbeatRuns } from "./heartbeat_runs.js";
import { agentWakeupRequests } from "./agent_wakeup_requests.js";

export const issueMeetings = pgTable(
  "issue_meetings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    rootIssueId: uuid("root_issue_id").notNull().references(() => issues.id),
    facilitatorAgentId: uuid("facilitator_agent_id").references(() => agents.id),
    summaryAgentId: uuid("summary_agent_id").references(() => agents.id),
    status: text("status").notNull().default("draft"),
    agenda: text("agenda").notNull(),
    referencePath: text("reference_path"),
    projectId: uuid("project_id"),
    goalId: uuid("goal_id"),
    billingCode: text("billing_code"),
    maxDiscussionRounds: integer("max_discussion_rounds").notNull().default(1),
    responseTimeoutSec: integer("response_timeout_sec").notNull().default(900),
    autoStart: pgBoolean("auto_start").notNull().default(true),
    autoContinue: pgBoolean("auto_continue").notNull().default(false),
    currentRoundNumber: integer("current_round_number"),
    lastOperatorSignalCommentId: uuid("last_operator_signal_comment_id"),
    transitionVersion: integer("transition_version").notNull().default(0),
    lastRoundCompletedAt: timestamp("last_round_completed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    rootIssueIdx: uniqueIndex("issue_meetings_root_issue_id_idx").on(table.rootIssueId),
    companyStatusIdx: index("issue_meetings_company_status_idx").on(table.companyId, table.status),
  }),
);

export const issueMeetingParticipants = pgTable(
  "issue_meeting_participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    meetingId: uuid("meeting_id").notNull().references(() => issueMeetings.id),
    agentId: uuid("agent_id").notNull().references(() => agents.id),
    childIssueId: uuid("child_issue_id").notNull().references(() => issues.id),
    isFacilitator: pgBoolean("is_facilitator").notNull().default(false),
    isSummarizer: pgBoolean("is_summarizer").notNull().default(false),
    speakingOrder: integer("speaking_order").notNull().default(0),
    status: text("status").notNull().default("active"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyMeetingIdx: index("issue_meeting_participants_company_meeting_idx").on(table.companyId, table.meetingId),
    meetingAgentIdx: uniqueIndex("issue_meeting_participants_meeting_agent_idx").on(table.meetingId, table.agentId),
    meetingChildIssueIdx: uniqueIndex("issue_meeting_participants_meeting_child_issue_idx").on(table.meetingId, table.childIssueId),
    childIssueIdx: uniqueIndex("issue_meeting_participants_child_issue_idx").on(table.childIssueId),
  }),
);

export const issueMeetingRounds = pgTable(
  "issue_meeting_rounds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    meetingId: uuid("meeting_id").notNull().references(() => issueMeetings.id),
    roundNumber: integer("round_number").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("pending"),
    roundOpenRootCommentId: uuid("round_open_root_comment_id"),
    roundSummaryCommentId: uuid("round_summary_comment_id"),
    summaryRequestedByUserId: text("summary_requested_by_user_id"),
    dispatchRecoveryPassCount: integer("dispatch_recovery_pass_count").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    transitionVersion: integer("transition_version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    meetingRoundNumberIdx: uniqueIndex("issue_meeting_rounds_meeting_round_number_idx").on(
      table.meetingId,
      table.roundNumber,
    ),
    companyMeetingStatusIdx: index("issue_meeting_rounds_company_meeting_status_idx").on(
      table.companyId,
      table.meetingId,
      table.status,
    ),
  }),
);

export const issueMeetingRoundParticipants = pgTable(
  "issue_meeting_round_participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    meetingId: uuid("meeting_id").notNull().references(() => issueMeetings.id),
    roundId: uuid("round_id").notNull().references(() => issueMeetingRounds.id),
    participantId: uuid("participant_id").notNull().references(() => issueMeetingParticipants.id),
    agentId: uuid("agent_id").notNull().references(() => agents.id),
    childIssueId: uuid("child_issue_id").notNull().references(() => issues.id),
    status: text("status").notNull().default("pending_dispatch"),
    dispatchAttemptCount: integer("dispatch_attempt_count").notNull().default(0),
    remindedCount: integer("reminded_count").notNull().default(0),
    dispatchPromptCommentId: uuid("dispatch_prompt_comment_id"),
    dispatchWakeupRequestId: uuid("dispatch_wakeup_request_id").references(() => agentWakeupRequests.id, { onDelete: "set null" }),
    dispatchWakeupStatus: text("dispatch_wakeup_status"),
    dispatchRunId: uuid("dispatch_run_id").references(() => heartbeatRuns.id, { onDelete: "set null" }),
    responseCommentId: uuid("response_comment_id"),
    responseRunId: uuid("response_run_id").references(() => heartbeatRuns.id, { onDelete: "set null" }),
    lateResponseCommentId: uuid("late_response_comment_id"),
    skipReason: text("skip_reason"),
    failureReason: text("failure_reason"),
    lastErrorCode: text("last_error_code"),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    timedOutAt: timestamp("timed_out_at", { withTimezone: true }),
    skippedAt: timestamp("skipped_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    roundParticipantIdx: uniqueIndex("issue_meeting_round_participants_round_participant_idx").on(
      table.roundId,
      table.participantId,
    ),
    companyMeetingRoundIdx: index("issue_meeting_round_participants_company_meeting_round_idx").on(
      table.companyId,
      table.meetingId,
      table.roundId,
    ),
    agentStatusIdx: index("issue_meeting_round_participants_agent_status_idx").on(
      table.agentId,
      table.status,
    ),
  }),
);
