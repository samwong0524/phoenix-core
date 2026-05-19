import {
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const agents = pgTable("agents", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  role: text("role").notNull(),
  parentId: uuid("parent_id"),
  llmHistory: text("llm_history").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const groups = pgTable("groups", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  name: text("name"),
  contextTokens: integer("context_tokens").default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const groupMembers = pgTable(
  "group_members",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id),
    userId: uuid("user_id").notNull(),
    lastReadMessageId: uuid("last_read_message_id"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.groupId, t.userId] }),
  })
);

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  groupId: uuid("group_id")
    .notNull()
    .references(() => groups.id),
  senderId: uuid("sender_id").notNull(),
  contentType: text("content_type").notNull(),
  content: text("content").notNull(),
  sendTime: timestamp("send_time", { withTimezone: true }).notNull(),
});

export const workflows = pgTable("workflows", {
  id: uuid("id").primaryKey(),
  groupId: uuid("group_id")
    .notNull()
    .references(() => groups.id),
  name: text("name").notNull(),
  description: text("description"),
  creatorId: uuid("creator_id")
    .notNull()
    .references(() => agents.id),
  status: text("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey(),
  workflowId: uuid("workflow_id")
    .notNull()
    .references(() => workflows.id),
  name: text("name").notNull(),
  description: text("description"),
  assigneeRole: text("assignee_role"),
  assigneeId: uuid("assignee_id").references(() => agents.id),
  status: text("status").notNull().default("pending"),
  dependsOn: text("depends_on").array().default([]),
  expectedOutput: text("expected_output"),
  result: text("result"),
  reviewNotes: text("review_notes"),
  reviewCount: integer("review_count").default(0),
  maxRevisions: integer("max_revisions").default(3),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const taskLogs = pgTable("task_logs", {
  id: uuid("id").primaryKey(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => tasks.id),
  eventType: text("event_type").notNull(),
  eventData: text("event_data"),
  actorId: uuid("actor_id").references(() => agents.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const agentAssignments = pgTable("agent_assignments", {
  id: uuid("id").primaryKey(),
  agentId: uuid("agent_id")
    .notNull()
    .references(() => agents.id),
  groupId: uuid("group_id")
    .notNull()
    .references(() => groups.id),
  workflowId: uuid("workflow_id").references(() => workflows.id),
  taskId: uuid("task_id").references(() => tasks.id),
  status: text("status").notNull().default("active"),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull(),
  releasedAt: timestamp("released_at", { withTimezone: true }),
});

export const backups = pgTable("backups", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  data: text("data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

// --- Data Lifecycle Management ---

export const agentDecisions = pgTable("agent_decisions", {
  id: uuid("id").primaryKey(),
  agentId: uuid("agent_id").notNull(),
  groupId: uuid("group_id"),
  workspaceId: uuid("workspace_id"),
  decisionType: text("decision_type").notNull(), // approve|reject|create|fix|delegate|escalate|pause
  targetType: text("target_type"), // task|message|skill|workflow|agent
  targetId: uuid("target_id"),
  inputSummary: text("input_summary"), // 200 chars max
  outputSummary: text("output_summary"), // 200 chars max
  humanFeedback: text("human_feedback"), // accepted|ignored|rejected|null
  success: boolean("success"),
  confidence: doublePrecision("confidence"), // LLM confidence 0-1
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const sessionArchives = pgTable("session_archives", {
  id: uuid("id").primaryKey(),
  groupId: uuid("group_id").notNull(),
  workspaceId: uuid("workspace_id").notNull(),
  sessionType: text("session_type").notNull(), // workflow_completion|free_mode_summary|task_completion
  title: text("title"), // 100 chars
  summary: text("summary"), // 2000 chars LLM-generated summary
  keyDecisions: jsonb("key_decisions"), // structured list of key decisions
  startTime: timestamp("start_time", { withTimezone: true }),
  endTime: timestamp("end_time", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }).notNull(),
});

export const messageArchive = pgTable("message_archive", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  groupId: uuid("group_id").notNull(),
  senderId: uuid("sender_id").notNull(),
  contentType: text("content_type").notNull(),
  contentPreview: text("content_preview").notNull(), // first 200 chars
  contentFull: text("content_full"), // full content, can be null if archived to disk
  sendTime: timestamp("send_time", { withTimezone: true }).notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }).notNull(),
  storageTier: text("storage_tier").default("warm"), // warm|cold
});
