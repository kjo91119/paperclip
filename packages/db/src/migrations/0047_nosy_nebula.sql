CREATE TABLE "issue_meeting_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"meeting_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"child_issue_id" uuid NOT NULL,
	"is_facilitator" boolean DEFAULT false NOT NULL,
	"is_summarizer" boolean DEFAULT false NOT NULL,
	"speaking_order" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_meeting_round_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"meeting_id" uuid NOT NULL,
	"round_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"child_issue_id" uuid NOT NULL,
	"status" text DEFAULT 'pending_dispatch' NOT NULL,
	"dispatch_attempt_count" integer DEFAULT 0 NOT NULL,
	"dispatch_prompt_comment_id" uuid,
	"dispatch_wakeup_request_id" uuid,
	"dispatch_wakeup_status" text,
	"dispatch_run_id" uuid,
	"response_comment_id" uuid,
	"response_run_id" uuid,
	"late_response_comment_id" uuid,
	"failure_reason" text,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_meeting_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"meeting_id" uuid NOT NULL,
	"round_number" integer NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"round_open_root_comment_id" uuid,
	"round_summary_comment_id" uuid,
	"summary_requested_by_user_id" text,
	"dispatch_recovery_pass_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"deadline_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"transition_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"root_issue_id" uuid NOT NULL,
	"facilitator_agent_id" uuid,
	"summary_agent_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"agenda" text NOT NULL,
	"reference_path" text,
	"project_id" uuid,
	"goal_id" uuid,
	"billing_code" text,
	"max_discussion_rounds" integer DEFAULT 1 NOT NULL,
	"response_timeout_sec" integer DEFAULT 900 NOT NULL,
	"auto_start" boolean DEFAULT true NOT NULL,
	"auto_continue" boolean DEFAULT false NOT NULL,
	"current_round_number" integer,
	"last_operator_signal_comment_id" uuid,
	"transition_version" integer DEFAULT 0 NOT NULL,
	"last_round_completed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "issue_comments" ADD COLUMN "author_kind" text;--> statement-breakpoint
ALTER TABLE "issue_comments" ADD COLUMN "author_system_key" text;--> statement-breakpoint
ALTER TABLE "issue_comments" ADD COLUMN "system_comment_kind" text;--> statement-breakpoint
ALTER TABLE "issue_meeting_participants" ADD CONSTRAINT "issue_meeting_participants_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_meeting_participants" ADD CONSTRAINT "issue_meeting_participants_meeting_id_issue_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."issue_meetings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_meeting_participants" ADD CONSTRAINT "issue_meeting_participants_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_meeting_participants" ADD CONSTRAINT "issue_meeting_participants_child_issue_id_issues_id_fk" FOREIGN KEY ("child_issue_id") REFERENCES "public"."issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_meeting_round_participants" ADD CONSTRAINT "issue_meeting_round_participants_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_meeting_round_participants" ADD CONSTRAINT "issue_meeting_round_participants_meeting_id_issue_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."issue_meetings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_meeting_round_participants" ADD CONSTRAINT "issue_meeting_round_participants_round_id_issue_meeting_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."issue_meeting_rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_meeting_round_participants" ADD CONSTRAINT "issue_meeting_round_participants_participant_id_issue_meeting_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."issue_meeting_participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_meeting_round_participants" ADD CONSTRAINT "issue_meeting_round_participants_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_meeting_round_participants" ADD CONSTRAINT "issue_meeting_round_participants_child_issue_id_issues_id_fk" FOREIGN KEY ("child_issue_id") REFERENCES "public"."issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_meeting_round_participants" ADD CONSTRAINT "issue_meeting_round_participants_dispatch_wakeup_request_id_agent_wakeup_requests_id_fk" FOREIGN KEY ("dispatch_wakeup_request_id") REFERENCES "public"."agent_wakeup_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_meeting_round_participants" ADD CONSTRAINT "issue_meeting_round_participants_dispatch_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("dispatch_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_meeting_round_participants" ADD CONSTRAINT "issue_meeting_round_participants_response_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("response_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_meeting_rounds" ADD CONSTRAINT "issue_meeting_rounds_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_meeting_rounds" ADD CONSTRAINT "issue_meeting_rounds_meeting_id_issue_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."issue_meetings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_meetings" ADD CONSTRAINT "issue_meetings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_meetings" ADD CONSTRAINT "issue_meetings_root_issue_id_issues_id_fk" FOREIGN KEY ("root_issue_id") REFERENCES "public"."issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_meetings" ADD CONSTRAINT "issue_meetings_facilitator_agent_id_agents_id_fk" FOREIGN KEY ("facilitator_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_meetings" ADD CONSTRAINT "issue_meetings_summary_agent_id_agents_id_fk" FOREIGN KEY ("summary_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_meeting_participants_company_meeting_idx" ON "issue_meeting_participants" USING btree ("company_id","meeting_id");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_meeting_participants_meeting_agent_idx" ON "issue_meeting_participants" USING btree ("meeting_id","agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_meeting_participants_meeting_child_issue_idx" ON "issue_meeting_participants" USING btree ("meeting_id","child_issue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_meeting_participants_child_issue_idx" ON "issue_meeting_participants" USING btree ("child_issue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_meeting_round_participants_round_participant_idx" ON "issue_meeting_round_participants" USING btree ("round_id","participant_id");--> statement-breakpoint
CREATE INDEX "issue_meeting_round_participants_company_meeting_round_idx" ON "issue_meeting_round_participants" USING btree ("company_id","meeting_id","round_id");--> statement-breakpoint
CREATE INDEX "issue_meeting_round_participants_agent_status_idx" ON "issue_meeting_round_participants" USING btree ("agent_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_meeting_rounds_meeting_round_number_idx" ON "issue_meeting_rounds" USING btree ("meeting_id","round_number");--> statement-breakpoint
CREATE INDEX "issue_meeting_rounds_company_meeting_status_idx" ON "issue_meeting_rounds" USING btree ("company_id","meeting_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_meetings_root_issue_id_idx" ON "issue_meetings" USING btree ("root_issue_id");--> statement-breakpoint
CREATE INDEX "issue_meetings_company_status_idx" ON "issue_meetings" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "issue_comments_company_issue_author_kind_created_at_idx" ON "issue_comments" USING btree ("company_id","issue_id","author_kind","created_at");