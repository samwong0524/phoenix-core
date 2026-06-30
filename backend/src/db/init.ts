import { getSql } from "./client";

export async function ensureSchema() {
  const sql = getSql();

  // ─── Auth: Users ──────────────────────────────────
  await sql/* sql */ `
    create table if not exists users (
      id uuid primary key,
      email varchar(255) not null,
      name text,
      password_hash text not null,
      role text not null default 'member',
      created_at timestamptz not null
    );
  `;
  await sql/* sql */ `
    create index if not exists users_email_idx on users (email);
  `;

  await sql/* sql */ `
    create table if not exists workspaces (
      id uuid primary key,
      name text not null,
      owner_id uuid references users(id),
      created_at timestamptz not null
    );
  `;

  // Add owner_id column for existing databases that already have the workspaces table
  await sql/* sql */ `
    alter table workspaces add column if not exists owner_id uuid references users(id);
  `;

  await sql/* sql */ `
    create table if not exists workspace_members (
      id uuid primary key,
      workspace_id uuid not null references workspaces(id) on delete cascade,
      user_id uuid not null references users(id) on delete cascade,
      role text not null default 'member',
      created_at timestamptz not null
    );
  `;

  await sql/* sql */ `
    create unique index if not exists workspace_members_unique_idx
    on workspace_members (workspace_id, user_id);
  `;

  await sql/* sql */ `
    create index if not exists workspace_members_user_idx
    on workspace_members (user_id);
  `;

  await sql/* sql */ `
    create table if not exists agents (
      id uuid primary key,
      workspace_id uuid not null references workspaces(id),
      role text not null,
      parent_id uuid null,
      llm_history text not null,
      created_at timestamptz not null
    );
  `;

  await sql/* sql */ `
    create table if not exists groups (
      id uuid primary key,
      workspace_id uuid not null references workspaces(id),
      name text null,
      context_tokens integer default 0,
      created_at timestamptz not null
    );
  `;

  await sql/* sql */ `
    create table if not exists group_members (
      group_id uuid not null references groups(id),
      user_id uuid not null,
      last_read_message_id uuid null,
      joined_at timestamptz not null,
      primary key (group_id, user_id)
    );
  `;

  await sql/* sql */ `
    create table if not exists messages (
      id uuid primary key,
      workspace_id uuid not null references workspaces(id),
      group_id uuid not null references groups(id),
      sender_id uuid not null,
      content_type text not null,
      content text not null,
      send_time timestamptz not null
    );
  `;

  await sql/* sql */ `
    create table if not exists workflows (
      id uuid primary key,
      group_id uuid not null references groups(id),
      name text not null,
      description text,
      creator_id uuid not null references agents(id),
      status text not null default 'draft',
      created_at timestamptz not null,
      updated_at timestamptz not null
    );
  `;

  await sql/* sql */ `
    create table if not exists tasks (
      id uuid primary key,
      workflow_id uuid not null references workflows(id),
      name text not null,
      description text,
      assignee_role text,
      assignee_id uuid references agents(id),
      status text not null default 'pending',
      depends_on text[] default '{}',
      expected_output text,
      result text,
      review_notes text,
      review_count integer default 0,
      max_revisions integer default 3,
      error text,
      created_at timestamptz not null,
      started_at timestamptz,
      reviewed_at timestamptz,
      completed_at timestamptz
    );
  `;

  await sql/* sql */ `
    create table if not exists task_logs (
      id uuid primary key,
      task_id uuid not null references tasks(id),
      event_type text not null,
      event_data jsonb,
      actor_id uuid references agents(id),
      created_at timestamptz not null
    );
  `;

  await sql/* sql */ `
    create table if not exists agent_assignments (
      id uuid primary key,
      agent_id uuid not null references agents(id),
      group_id uuid not null references groups(id),
      workflow_id uuid references workflows(id),
      task_id uuid references tasks(id),
      status text not null default 'active',
      assigned_at timestamptz not null,
      released_at timestamptz,
      constraint agent_one_group unique (agent_id, group_id)
    );
  `;

  await sql/* sql */ `
    create table if not exists backups (
      id uuid primary key,
      workspace_id uuid not null,
      data jsonb not null,
      created_at timestamptz not null
    );
  `;

  // ─── Agent Decisions (audit trail for bash sandbox & other actions) ──
  await sql/* sql */ `
    create table if not exists agent_decisions (
      id uuid primary key,
      agent_id uuid not null,
      group_id uuid,
      workspace_id uuid,
      decision_type text not null,
      target_type text,
      target_id uuid,
      input_summary text,
      output_summary text,
      human_feedback text,
      success boolean,
      confidence double precision,
      created_at timestamptz not null
    );
  `;

  await sql/* sql */ `
    create table if not exists skill_usage (
      id uuid primary key,
      skill_name text not null,
      agent_id uuid not null,
      success boolean not null,
      used_at timestamptz not null,
      version text default '1.0',
      status text default 'active'
    );
  `;

  await sql/* sql */ `
    create table if not exists memories (
      id uuid primary key,
      agent_id uuid not null,
      workspace_id uuid references workspaces(id),
      content text not null,
      tags text[] default '{}',
      created_at timestamptz not null,
      accessed_at timestamptz,
      importance integer default 1,
      source text
    );
  `;

  await sql/* sql */ `
    create table if not exists session_archive (
      id uuid primary key,
      agent_id uuid not null,
      workspace_id uuid not null,
      group_id uuid references groups(id),
      archived_at timestamptz not null,
      content text not null,
      tags text[] default '{}',
      summary text
    );
  `;

  await sql/* sql */ `
    create table if not exists agent_forum (
      id uuid primary key,
      agent_id uuid not null,
      content text not null,
      created_at timestamptz not null,
      updated_at timestamptz
    );
  `;

  await sql/* sql */ `
    create table if not exists agent_diary (
      id uuid primary key,
      agent_id uuid not null,
      entry text not null,
      mood text,
      created_at timestamptz not null
    );
  `;
}
