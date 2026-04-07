ALTER TABLE "issue_meeting_round_participants" ADD COLUMN "reminded_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_meeting_round_participants" ADD COLUMN "skip_reason" text;--> statement-breakpoint
ALTER TABLE "issue_meeting_round_participants" ADD COLUMN "last_error_code" text;--> statement-breakpoint
ALTER TABLE "issue_meeting_round_participants" ADD COLUMN "dispatched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "issue_meeting_round_participants" ADD COLUMN "deadline_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "issue_meeting_round_participants" ADD COLUMN "timed_out_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "issue_meeting_round_participants" ADD COLUMN "skipped_at" timestamp with time zone;