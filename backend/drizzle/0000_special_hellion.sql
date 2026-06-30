CREATE TABLE "agent_assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agent_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"workflow_id" uuid,
	"task_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"assigned_at" timestamp with time zone NOT NULL,
	"released_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agent_id" uuid NOT NULL,
	"group_id" uuid,
	"workspace_id" uuid,
	"decision_type" text NOT NULL,
	"target_type" text,
	"target_id" uuid,
	"input_summary" text,
	"output_summary" text,
	"human_feedback" text,
	"success" boolean,
	"confidence" double precision,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"role" text NOT NULL,
	"parent_id" uuid,
	"llm_history" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"data" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_members" (
	"group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"last_read_message_id" uuid,
	"joined_at" timestamp with time zone NOT NULL,
	CONSTRAINT "group_members_group_id_user_id_pk" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text,
	"creator_id" uuid,
	"context_tokens" integer DEFAULT 0,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_archive" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"content_type" text NOT NULL,
	"content_preview" text NOT NULL,
	"content_full" text,
	"send_time" timestamp with time zone NOT NULL,
	"archived_at" timestamp with time zone NOT NULL,
	"storage_tier" text DEFAULT 'warm'
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"content_type" text NOT NULL,
	"content" text NOT NULL,
	"send_time" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_executions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"stage_name" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"output" text,
	"agent_id" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "session_archives" (
	"id" uuid PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"session_type" text NOT NULL,
	"title" text,
	"summary" text,
	"key_decisions" jsonb,
	"start_time" timestamp with time zone,
	"end_time" timestamp with time zone,
	"archived_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_usage" (
	"id" uuid PRIMARY KEY NOT NULL,
	"skill_name" text NOT NULL,
	"agent_id" uuid NOT NULL,
	"success" boolean NOT NULL,
	"used_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"event_data" text,
	"actor_id" uuid,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workflow_id" uuid NOT NULL,
	"node_id" text,
	"name" text NOT NULL,
	"description" text,
	"assignee_role" text,
	"assignee_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"depends_on" text[] DEFAULT '{}',
	"expected_output" text,
	"result" text,
	"review_notes" text,
	"review_count" integer DEFAULT 0,
	"max_revisions" integer DEFAULT 3,
	"error" text,
	"created_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" text,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"icon" text DEFAULT '📋' NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"tags" text[] DEFAULT '{}',
	"dsl" jsonb NOT NULL,
	"node_count" integer DEFAULT 0 NOT NULL,
	"edge_count" integer DEFAULT 0 NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"is_builtin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" uuid PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"creator_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"layout_data" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_assignments" ADD CONSTRAINT "agent_assignments_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_assignments" ADD CONSTRAINT "agent_assignments_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_assignments" ADD CONSTRAINT "agent_assignments_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_assignments" ADD CONSTRAINT "agent_assignments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_executions" ADD CONSTRAINT "pipeline_executions_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_executions" ADD CONSTRAINT "pipeline_executions_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_executions" ADD CONSTRAINT "pipeline_executions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_logs" ADD CONSTRAINT "task_logs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_logs" ADD CONSTRAINT "task_logs_actor_id_agents_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_agents_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_creator_id_agents_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agents_workspace_idx" ON "agents" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "group_members_user_idx" ON "group_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "groups_workspace_idx" ON "groups" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "messages_group_idx" ON "messages" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "messages_workspace_idx" ON "messages" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "pipeline_exec_pipeline_idx" ON "pipeline_executions" USING btree ("pipeline_id");--> statement-breakpoint
CREATE INDEX "pipeline_exec_workflow_idx" ON "pipeline_executions" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "workflows_group_idx" ON "workflows" USING btree ("group_id");