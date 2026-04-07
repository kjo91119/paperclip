import { z } from "zod";
import {
  ISSUE_MEETING_ROUND_KINDS,
  ISSUE_MEETING_ROUND_STATUSES,
  ISSUE_MEETING_STATUSES,
} from "../constants.js";

export const createMeetingSchema = z.object({
  agenda: z.string().trim().min(1),
  projectId: z.string().uuid().nullable().optional(),
  goalId: z.string().uuid().nullable().optional(),
  referencePath: z.string().trim().nullable().optional(),
  facilitatorAgentId: z.string().uuid().nullable().optional(),
  summaryAgentId: z.string().uuid().nullable().optional(),
  participantAgentIds: z.array(z.string().uuid()).min(2),
  maxDiscussionRounds: z.number().int().min(1).max(3).optional().default(1),
  responseTimeoutSec: z.number().int().min(30).max(60 * 60 * 12).optional().default(900),
  autoStart: z.boolean().optional().default(true),
  autoContinue: z.boolean().optional().default(false),
});

export type CreateMeeting = z.infer<typeof createMeetingSchema>;

export const requestMeetingSummarySchema = z.object({
  summaryAgentId: z.string().uuid().nullable().optional(),
}).default({});

export type RequestMeetingSummary = z.infer<typeof requestMeetingSummarySchema>;

export const meetingStatusSchema = z.enum(ISSUE_MEETING_STATUSES);
export const meetingRoundKindSchema = z.enum(ISSUE_MEETING_ROUND_KINDS);
export const meetingRoundStatusSchema = z.enum(ISSUE_MEETING_ROUND_STATUSES);
