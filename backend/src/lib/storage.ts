import { and, desc, eq, gt, inArray, ne, sql as dsql } from "drizzle-orm";

import { getDb } from "@/db";
import { agents, backups, groupMembers, groups, messages, workspaces } from "@/db/schema";

type UUID = string;

function now() {
  return new Date();
}

function uuid(): UUID {
  return crypto.randomUUID();
}

async function initialAgentHistory(input: {
  agentId: UUID;
  workspaceId: UUID;
  role: string;
  guidance?: string;
}) {
  const { buildSystemPrompt } = await import("@/runtime/soul");
  const systemContent = await buildSystemPrompt(input.role, input.guidance);

  const meta = `Your agent_id is: ${input.agentId}.\nYour workspace_id is: ${input.workspaceId}.\nYour role is: ${input.role}.\nYour replies are NOT automatically delivered to humans.\nTo send messages, you MUST call tools like send_group_message or send_direct_message.`;

  const history: Array<{ role: "system"; content: string }> = [
    { role: "system", content: `${systemContent}\n\n${meta}` },
  ];
  return JSON.stringify(history);
}

async function emitDbWrite(input: {
  workspaceId: UUID;
  table: string;
  action: "insert" | "update" | "delete";
  recordId?: UUID | null;
}) {
  try {
    const { getWorkspaceUIBus } = await import("@/runtime/ui-bus");
    getWorkspaceUIBus().emit(input.workspaceId, {
      event: "ui.db.write",
      data: {
        workspaceId: input.workspaceId,
        table: input.table,
        action: input.action,
        recordId: input.recordId ?? null,
      },
    });
  } catch {
    // best-effort only
  }
}

export const store = {
  async findLatestExactP2PGroupId(input: {
    workspaceId: UUID;
    memberA: UUID;
    memberB: UUID;
    preferredName?: string | null;
  }): Promise<UUID | null> {
    const db = getDb();
    const a = input.memberA;
    const b = input.memberB;
    if (!a || !b || a === b) return null;

    const rows = await db
      .select({
        id: groups.id,
        name: groups.name,
        createdAt: groups.createdAt,
        lastMessageTime: dsql<Date | null>`max(${messages.sendTime})`,
      })
      .from(groups)
      .innerJoin(groupMembers, eq(groupMembers.groupId, groups.id))
      .leftJoin(messages, eq(messages.groupId, groups.id))
      .where(eq(groups.workspaceId, input.workspaceId))
      .groupBy(groups.id)
      .having(
        dsql`count(distinct ${groupMembers.userId}) = 2 and sum(case when ${groupMembers.userId} = ${a} or ${groupMembers.userId} = ${b} then 1 else 0 end) = 2`
      );

    if (rows.length === 0) return null;

    const preferred = (input.preferredName ?? null) || null;
    const toDate = (v: Date | string | undefined | null): Date =>
      v instanceof Date ? v : v ? new Date(v) : new Date(0);

    rows.sort((x, y) => {
      const xName = x.name ?? null;
      const yName = y.name ?? null;
      const xMatch = preferred && xName === preferred ? 1 : 0;
      const yMatch = preferred && yName === preferred ? 1 : 0;
      if (xMatch !== yMatch) return yMatch - xMatch;

      const xNamed = xName ? 1 : 0;
      const yNamed = yName ? 1 : 0;
      if (xNamed !== yNamed) return yNamed - xNamed;

      const xUpdated = toDate(x.lastMessageTime ?? x.createdAt).getTime();
      const yUpdated = toDate(y.lastMessageTime ?? y.createdAt).getTime();
      if (xUpdated !== yUpdated) return yUpdated - xUpdated;

      return toDate(y.createdAt).getTime() - toDate(x.createdAt).getTime();
    });

    return rows[0]!.id;
  },

  async mergeDuplicateExactP2PGroups(input: {
    workspaceId: UUID;
    memberA: UUID;
    memberB: UUID;
    preferredName?: string | null;
  }): Promise<UUID | null> {
    const db = getDb();
    const a = input.memberA;
    const b = input.memberB;
    if (!a || !b || a === b) return null;

    const createdAt = now();

    return await db.transaction(async (tx) => {
      const rows = await tx
        .select({
          id: groups.id,
          name: groups.name,
          createdAt: groups.createdAt,
          lastMessageTime: dsql<Date | null>`max(${messages.sendTime})`,
        })
        .from(groups)
        .innerJoin(groupMembers, eq(groupMembers.groupId, groups.id))
        .leftJoin(messages, eq(messages.groupId, groups.id))
        .where(eq(groups.workspaceId, input.workspaceId))
        .groupBy(groups.id)
        .having(
          dsql`count(distinct ${groupMembers.userId}) = 2 and sum(case when ${groupMembers.userId} = ${a} or ${groupMembers.userId} = ${b} then 1 else 0 end) = 2`
        );

      const preferred = (input.preferredName ?? null) || null;

      const pickBest = (candidates: typeof rows) => {
        const toDate = (v: Date | string | undefined | null): Date =>
          v instanceof Date ? v : v ? new Date(v) : new Date(0);

        const sorted = [...candidates];
        sorted.sort((x, y) => {
          const xName = x.name ?? null;
          const yName = y.name ?? null;
          const xMatch = preferred && xName === preferred ? 1 : 0;
          const yMatch = preferred && yName === preferred ? 1 : 0;
          if (xMatch !== yMatch) return yMatch - xMatch;

          const xNamed = xName ? 1 : 0;
          const yNamed = yName ? 1 : 0;
          if (xNamed !== yNamed) return yNamed - xNamed;

          const xUpdated = toDate(x.lastMessageTime ?? x.createdAt).getTime();
          const yUpdated = toDate(y.lastMessageTime ?? y.createdAt).getTime();
          if (xUpdated !== yUpdated) return yUpdated - xUpdated;

          return toDate(y.createdAt).getTime() - toDate(x.createdAt).getTime();
        });
        return sorted[0]!;
      };

      let keepId: UUID | null = null;

      if (rows.length === 0) {
        keepId = uuid();
        await tx.insert(groups).values({
          id: keepId,
          workspaceId: input.workspaceId,
          name: preferred || null,
          createdAt,
        });
        await tx.insert(groupMembers).values([
          { groupId: keepId, userId: a, joinedAt: createdAt },
          { groupId: keepId, userId: b, joinedAt: createdAt },
        ]);
        return keepId;
      }

      const best = pickBest(rows);
      keepId = best.id;

      const others = rows.filter((r) => r.id !== keepId).map((r) => r.id);
      for (const otherId of others) {
        await tx
          .update(messages)
          .set({ groupId: keepId })
          .where(and(eq(messages.workspaceId, input.workspaceId), eq(messages.groupId, otherId)));

        await tx.delete(groupMembers).where(eq(groupMembers.groupId, otherId));
        await tx.delete(groups).where(eq(groups.id, otherId));
      }

      if (preferred && (best.name ?? null) !== preferred) {
        await tx.update(groups).set({ name: preferred }).where(eq(groups.id, keepId));
      }

      return keepId;
    });
  },

  async listWorkspaces(): Promise<Array<{ id: UUID; name: string; createdAt: string }>> {
    const db = getDb();
    const rows = await db
      .select({ id: workspaces.id, name: workspaces.name, createdAt: workspaces.createdAt })
      .from(workspaces)
      .orderBy(desc(workspaces.createdAt));

    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  },

  async createAgent(input: {
    workspaceId: UUID;
    role: string;
    parentId?: UUID | null;
    llmHistory?: string;
    guidance?: string;
  }) {
    const db = getDb();
    const agentId = uuid();
    const createdAt = now();

    const workspace = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, input.workspaceId))
      .limit(1);
    if (workspace.length === 0) throw new Error("workspace not found");

    await db.insert(agents).values({
      id: agentId,
      workspaceId: input.workspaceId,
      role: input.role,
      parentId: input.parentId ?? null,
      llmHistory:
        input.llmHistory ??
        (await initialAgentHistory({
          agentId,
          workspaceId: input.workspaceId,
          role: input.role,
          guidance: input.guidance,
        })),
      createdAt,
    });

    await emitDbWrite({
      workspaceId: input.workspaceId,
      table: "agents",
      action: "insert",
      recordId: agentId,
    });

    return { id: agentId, role: input.role, createdAt: createdAt.toISOString() };
  },

  async listAgentsMeta(
    input: { workspaceId: UUID }
  ): Promise<Array<{ id: UUID; role: string; parentId: UUID | null; createdAt: string }>> {
    const db = getDb();
    const rows = await db
      .select({
        id: agents.id,
        role: agents.role,
        parentId: agents.parentId,
        createdAt: agents.createdAt,
      })
      .from(agents)
      .where(eq(agents.workspaceId, input.workspaceId))
      .orderBy(desc(agents.createdAt));

    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  },

  async getDefaultHumanAgentId(input: { workspaceId: UUID }): Promise<UUID | null> {
    const agents = await this.listAgentsMeta({ workspaceId: input.workspaceId });
    return agents.find((a) => a.role === "human")?.id ?? null;
  },

  async createWorkspaceWithDefaults(input: { name: string }) {
    const db = getDb();
    const workspaceId = uuid();
    const humanAgentId = uuid();
    const assistantAgentId = uuid();
    const defaultGroupId = uuid();
    const createdAt = now();

    const humanHistory = await initialAgentHistory({
      agentId: humanAgentId,
      workspaceId,
      role: "human",
    });
    const assistantHistory = await initialAgentHistory({
      agentId: assistantAgentId,
      workspaceId,
      role: "assistant",
    });

    await db.transaction(async (tx) => {
      await tx.insert(workspaces).values({
        id: workspaceId,
        name: input.name,
        createdAt,
      });

      await tx.insert(agents).values([
        {
          id: humanAgentId,
          workspaceId,
          role: "human",
          parentId: null,
          llmHistory: humanHistory,
          createdAt,
        },
        {
          id: assistantAgentId,
          workspaceId,
          role: "assistant",
          parentId: null,
          llmHistory: assistantHistory,
          createdAt,
        },
      ]);

      await tx.insert(groups).values({
        id: defaultGroupId,
        workspaceId,
        name: null,
        createdAt,
      });

      await tx.insert(groupMembers).values([
        {
          groupId: defaultGroupId,
          userId: humanAgentId,
          joinedAt: createdAt,
        },
        {
          groupId: defaultGroupId,
          userId: assistantAgentId,
          joinedAt: createdAt,
        },
      ]);
    });

    await emitDbWrite({
      workspaceId,
      table: "workspaces",
      action: "insert",
      recordId: workspaceId,
    });
    await emitDbWrite({
      workspaceId,
      table: "agents",
      action: "insert",
    });
    await emitDbWrite({
      workspaceId,
      table: "groups",
      action: "insert",
      recordId: defaultGroupId,
    });
    await emitDbWrite({
      workspaceId,
      table: "group_members",
      action: "insert",
    });

    return { workspaceId, humanAgentId, assistantAgentId, defaultGroupId };
  },

  async ensureWorkspaceDefaults(input: { workspaceId: UUID }) {
    const db = getDb();
    const createdAt = now();

    const workspace = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, input.workspaceId))
      .limit(1);
    if (workspace.length === 0) throw new Error("workspace not found");

    let createdHuman = false;
    let createdAssistant = false;
    let createdGroup = false;

    const result = await db.transaction(async (tx) => {
      const existingAgents = await tx
        .select({ id: agents.id, role: agents.role })
        .from(agents)
        .where(eq(agents.workspaceId, input.workspaceId));

      let humanAgentId = existingAgents.find((a) => a.role === "human")?.id ?? null;
      let assistantAgentId =
        existingAgents.find((a) => a.role === "assistant")?.id ?? null;

      if (!humanAgentId) {
        humanAgentId = uuid();
        const humanHistory = await initialAgentHistory({
          agentId: humanAgentId,
          workspaceId: input.workspaceId,
          role: "human",
        });
        await tx.insert(agents).values({
          id: humanAgentId,
          workspaceId: input.workspaceId,
          role: "human",
          parentId: null,
          llmHistory: humanHistory,
          createdAt,
        });
        createdHuman = true;
      }

      if (!assistantAgentId) {
        assistantAgentId = uuid();
        const assistantHistory = await initialAgentHistory({
          agentId: assistantAgentId,
          workspaceId: input.workspaceId,
          role: "assistant",
        });
        await tx.insert(agents).values({
          id: assistantAgentId,
          workspaceId: input.workspaceId,
          role: "assistant",
          parentId: null,
          llmHistory: assistantHistory,
          createdAt,
        });
        createdAssistant = true;
      }

      const candidate = await tx
        .select({ id: groups.id })
        .from(groups)
        .innerJoin(groupMembers, eq(groupMembers.groupId, groups.id))
        .where(eq(groups.workspaceId, input.workspaceId))
        .groupBy(groups.id)
        .having(
          dsql`count(*) = 2 and sum(case when ${groupMembers.userId} = ${humanAgentId} or ${groupMembers.userId} = ${assistantAgentId} then 1 else 0 end) = 2`
        )
        .orderBy(desc(groups.createdAt))
        .limit(1);

      let defaultGroupId = candidate[0]?.id ?? null;

      if (!defaultGroupId) {
        defaultGroupId = uuid();
        await tx.insert(groups).values({
          id: defaultGroupId,
          workspaceId: input.workspaceId,
          name: null,
          createdAt,
        });

        await tx.insert(groupMembers).values([
          {
            groupId: defaultGroupId,
            userId: humanAgentId,
            lastReadMessageId: null,
            joinedAt: createdAt,
          },
          {
            groupId: defaultGroupId,
            userId: assistantAgentId,
            lastReadMessageId: null,
            joinedAt: createdAt,
          },
        ]);
        createdGroup = true;
      }

      return { workspaceId: input.workspaceId, humanAgentId, assistantAgentId, defaultGroupId };
    });

    if (createdHuman) {
      await emitDbWrite({
        workspaceId: input.workspaceId,
        table: "agents",
        action: "insert",
      });
    }
    if (createdAssistant) {
      await emitDbWrite({
        workspaceId: input.workspaceId,
        table: "agents",
        action: "insert",
      });
    }
    if (createdGroup) {
      await emitDbWrite({
        workspaceId: input.workspaceId,
        table: "groups",
        action: "insert",
        recordId: result.defaultGroupId,
      });
      await emitDbWrite({
        workspaceId: input.workspaceId,
        table: "group_members",
        action: "insert",
        recordId: result.defaultGroupId,
      });
    }

    return result;
  },

  async createSubAgentWithP2P(input: {
    workspaceId: UUID;
    creatorId: UUID;
    role: string;
    guidance?: string;
  }) {
    const db = getDb();
    const createdAt = now();
    const agentId = uuid();
    const groupId = uuid();

    const defaults = await store.ensureWorkspaceDefaults({ workspaceId: input.workspaceId });
    const humanAgentId = defaults.humanAgentId;

    const workspace = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, input.workspaceId))
      .limit(1);
    if (workspace.length === 0) throw new Error("workspace not found");

    const agentHistory = await initialAgentHistory({
      agentId,
      workspaceId: input.workspaceId,
      role: input.role,
      guidance: input.guidance,
    });

    await db.transaction(async (tx) => {
      await tx.insert(agents).values({
        id: agentId,
        workspaceId: input.workspaceId,
        role: input.role,
        parentId: input.creatorId,
        llmHistory: agentHistory,
        createdAt,
      });

      await tx.insert(groups).values({
        id: groupId,
        workspaceId: input.workspaceId,
        name: input.role,
        createdAt,
      });

      await tx.insert(groupMembers).values([
        {
          groupId,
          userId: humanAgentId,
          joinedAt: createdAt,
        },
        {
          groupId,
          userId: agentId,
          joinedAt: createdAt,
        },
      ]);
    });

    await emitDbWrite({
      workspaceId: input.workspaceId,
      table: "agents",
      action: "insert",
      recordId: agentId,
    });
    await emitDbWrite({
      workspaceId: input.workspaceId,
      table: "groups",
      action: "insert",
      recordId: groupId,
    });
    await emitDbWrite({
      workspaceId: input.workspaceId,
      table: "group_members",
      action: "insert",
      recordId: groupId,
    });

    return { agentId, groupId, createdAt: createdAt.toISOString() };
  },

  async addGroupMembers(input: { groupId: UUID; userIds: UUID[] }) {
    const db = getDb();
    const joinedAt = now();

    if (input.userIds.length === 0) return;

    const group = await db
      .select({ workspaceId: groups.workspaceId })
      .from(groups)
      .where(eq(groups.id, input.groupId))
      .limit(1);
    if (group.length === 0) throw new Error("group not found");

    await db
      .insert(groupMembers)
      .values(
        input.userIds.map((userId) => ({
          groupId: input.groupId,
          userId,
          joinedAt,
        }))
      )
      .onConflictDoNothing();

    await emitDbWrite({
      workspaceId: group[0]!.workspaceId,
      table: "group_members",
      action: "insert",
      recordId: input.groupId,
    });
  },

  async createGroup(input: { workspaceId: UUID; memberIds: UUID[]; name?: string }) {
    const db = getDb();
    const groupId = uuid();
    const createdAt = now();

    await db.transaction(async (tx) => {
      await tx.insert(groups).values({
        id: groupId,
        workspaceId: input.workspaceId,
        name: input.name ?? null,
        createdAt,
      });

      await tx.insert(groupMembers).values(
        input.memberIds.map((userId) => ({
          groupId,
          userId,
          joinedAt: createdAt,
        }))
      );
    });

    await emitDbWrite({
      workspaceId: input.workspaceId,
      table: "groups",
      action: "insert",
      recordId: groupId,
    });
    await emitDbWrite({
      workspaceId: input.workspaceId,
      table: "group_members",
      action: "insert",
      recordId: groupId,
    });

    return { id: groupId, name: input.name ?? null, createdAt: createdAt.toISOString() };
  },

  async findLatestExactGroupId(input: { workspaceId: UUID; memberIds: UUID[] }): Promise<UUID | null> {
    const db = getDb();
    const ids = [...new Set(input.memberIds)].filter(Boolean);
    if (ids.length === 0) return null;

    const rows = await db
      .select({
        id: groups.id,
        createdAt: groups.createdAt,
        lastMessageTime: dsql<Date | null>`max(${messages.sendTime})`,
      })
      .from(groups)
      .innerJoin(groupMembers, eq(groupMembers.groupId, groups.id))
      .leftJoin(messages, eq(messages.groupId, groups.id))
      .where(and(eq(groups.workspaceId, input.workspaceId), inArray(groupMembers.userId, ids)))
      .groupBy(groups.id)
      .having(
        dsql`count(distinct ${groupMembers.userId}) = ${ids.length}`
      )
      .orderBy(desc(dsql`coalesce(max(${messages.sendTime}), ${groups.createdAt})`))
      .limit(1);

    return rows[0]?.id ?? null;
  },

  async listMessages(input: { groupId: UUID; limit?: number; since?: string }) {
    const db = getDb();
    // Use DESC order + limit, then reverse to return oldest-first for chat UI
    const rows = await (input.since
      ? db
          .select({
            id: messages.id,
            senderId: messages.senderId,
            content: messages.content,
            contentType: messages.contentType,
            sendTime: messages.sendTime,
          })
          .from(messages)
          .where(and(eq(messages.groupId, input.groupId), gt(messages.sendTime, new Date(input.since))))
          .orderBy(desc(messages.sendTime))
          .limit(input.limit ?? 200)
      : db
          .select({
            id: messages.id,
            senderId: messages.senderId,
            content: messages.content,
            contentType: messages.contentType,
            sendTime: messages.sendTime,
          })
          .from(messages)
          .where(eq(messages.groupId, input.groupId))
          .orderBy(desc(messages.sendTime))
          .limit(input.limit ?? 200)
    );
    // Reverse to chronological order (oldest first)
    return rows.reverse().map((m) => ({ ...m, sendTime: m.sendTime.toISOString() }));
  },

  async getMessage(input: { messageId: UUID }) {
    const db = getDb();
    const rows = await db
      .select({
        id: messages.id,
        senderId: messages.senderId,
        content: messages.content,
        contentType: messages.contentType,
        sendTime: messages.sendTime,
      })
      .from(messages)
      .where(eq(messages.id, input.messageId))
      .limit(1);

    if (rows.length === 0) return null;
    const m = rows[0];
    return { ...m, sendTime: m.sendTime.toISOString() };
  },

  async sendMessage(input: {
    groupId: UUID;
    senderId: UUID;
    content: string;
    contentType: string;
  }) {
    const db = getDb();
    const group = await db
      .select({ workspaceId: groups.workspaceId })
      .from(groups)
      .where(eq(groups.id, input.groupId))
      .limit(1);

    if (group.length === 0) throw new Error("group not found");

    const messageId = uuid();
    const sendTime = now();

    await db.insert(messages).values({
      id: messageId,
      workspaceId: group[0]!.workspaceId,
      groupId: input.groupId,
      senderId: input.senderId,
      contentType: input.contentType,
      content: input.content,
      sendTime,
    });

    await emitDbWrite({
      workspaceId: group[0]!.workspaceId,
      table: "messages",
      action: "insert",
      recordId: messageId,
    });

    return { id: messageId, sendTime: sendTime.toISOString() };
  },

  async sendDirectMessage(input: {
    workspaceId: UUID;
    fromId: UUID;
    toId: UUID;
    observerHumanId?: UUID | null;
    content: string;
    contentType?: string;
    groupName?: string | null;
    newThread?: boolean;
  }) {
    const memberIds = [
      input.fromId,
      input.toId,
      input.observerHumanId && input.observerHumanId !== input.fromId && input.observerHumanId !== input.toId
        ? input.observerHumanId
        : null,
    ].filter(Boolean) as UUID[];

    let groupId: UUID;
    let channel: "new_thread" | "new_group" | "reuse_existing_group";
    if (input.newThread === true) {
      groupId = (
        await this.createGroup({
          workspaceId: input.workspaceId,
          memberIds,
          name: input.groupName ?? undefined,
        })
      ).id;
      channel = "new_thread";
    } else if (memberIds.length === 2) {
      const existing = await this.findLatestExactP2PGroupId({
        workspaceId: input.workspaceId,
        memberA: memberIds[0]!,
        memberB: memberIds[1]!,
        preferredName: input.groupName ?? null,
      });
      groupId =
        (await this.mergeDuplicateExactP2PGroups({
          workspaceId: input.workspaceId,
          memberA: memberIds[0]!,
          memberB: memberIds[1]!,
          preferredName: input.groupName ?? null,
        })) ??
        (
          await this.createGroup({
            workspaceId: input.workspaceId,
            memberIds,
            name: input.groupName ?? undefined,
          })
        ).id;
      channel = existing ? "reuse_existing_group" : "new_group";
    } else {
      const existing = await this.findLatestExactGroupId({
        workspaceId: input.workspaceId,
        memberIds,
      });
      groupId =
        existing ??
        (
          await this.createGroup({
            workspaceId: input.workspaceId,
            memberIds,
            name: input.groupName ?? undefined,
          })
        ).id;
      channel = existing ? "reuse_existing_group" : "new_group";
    }

    const message = await this.sendMessage({
      groupId,
      senderId: input.fromId,
      content: input.content,
      contentType: input.contentType ?? "text",
    });

    return { groupId, messageId: message.id, sendTime: message.sendTime, channel };
  },

  async getGroupWorkspaceId(input: { groupId: UUID }): Promise<UUID> {
    const db = getDb();
    const group = await db
      .select({ workspaceId: groups.workspaceId })
      .from(groups)
      .where(eq(groups.id, input.groupId))
      .limit(1);
    if (group.length === 0) throw new Error("group not found");
    return group[0]!.workspaceId;
  },

  async markGroupRead(input: { groupId: UUID; readerId: UUID }) {
    const db = getDb();
    const last = await db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.groupId, input.groupId))
      .orderBy(desc(messages.sendTime))
      .limit(1);

    await db
      .update(groupMembers)
      .set({ lastReadMessageId: last[0]?.id ?? null })
      .where(
        dsql`${groupMembers.groupId} = ${input.groupId} and ${groupMembers.userId} = ${input.readerId}`
      );

    const group = await db
      .select({ workspaceId: groups.workspaceId })
      .from(groups)
      .where(eq(groups.id, input.groupId))
      .limit(1);
    if (group.length > 0) {
      await emitDbWrite({
        workspaceId: group[0]!.workspaceId,
        table: "group_members",
        action: "update",
        recordId: input.groupId,
      });
    }
  },

  async markGroupReadToMessage(input: { groupId: UUID; readerId: UUID; messageId: UUID }) {
    const db = getDb();
    await db
      .update(groupMembers)
      .set({ lastReadMessageId: input.messageId })
      .where(
        dsql`${groupMembers.groupId} = ${input.groupId} and ${groupMembers.userId} = ${input.readerId}`
      );

    const group = await db
      .select({ workspaceId: groups.workspaceId })
      .from(groups)
      .where(eq(groups.id, input.groupId))
      .limit(1);
    if (group.length > 0) {
      await emitDbWrite({
        workspaceId: group[0]!.workspaceId,
        table: "group_members",
        action: "update",
        recordId: input.groupId,
      });
    }
  },

  async listGroupMemberIds(input: { groupId: UUID }): Promise<UUID[]> {
    const db = getDb();
    const rows = await db
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(eq(groupMembers.groupId, input.groupId));
    return rows.map((r) => r.userId);
  },

  async listAgents(
    input?: { workspaceId?: UUID }
  ): Promise<Array<{ id: UUID; workspaceId: UUID; role: string; llmHistory: string }>> {
    const db = getDb();
    const rows = await db
      .select({
        id: agents.id,
        workspaceId: agents.workspaceId,
        role: agents.role,
        llmHistory: agents.llmHistory,
      })
      .from(agents)
      .where(input?.workspaceId ? eq(agents.workspaceId, input.workspaceId) : undefined)
      .orderBy(desc(agents.createdAt));

    return rows;
  },

  async getAgent(input: { agentId: UUID }): Promise<{ id: UUID; role: string; llmHistory: string }> {
    const db = getDb();
    const rows = await db
      .select({ id: agents.id, role: agents.role, llmHistory: agents.llmHistory })
      .from(agents)
      .where(eq(agents.id, input.agentId))
      .limit(1);
    if (rows.length === 0) throw new Error("agent not found");
    return rows[0]!;
  },

  async getAgentRole(input: { agentId: UUID }): Promise<string> {
    const agent = await this.getAgent(input);
    return agent.role;
  },

  async setAgentHistory(input: { agentId: UUID; llmHistory: string; workspaceId?: UUID }) {
    const db = getDb();
    await db.update(agents).set({ llmHistory: input.llmHistory }).where(eq(agents.id, input.agentId));

    const workspaceId =
      input.workspaceId ??
      (
        await db
          .select({ workspaceId: agents.workspaceId })
          .from(agents)
          .where(eq(agents.id, input.agentId))
          .limit(1)
      )[0]?.workspaceId;
    if (workspaceId) {
      await emitDbWrite({
        workspaceId,
        table: "agents",
        action: "update",
        recordId: input.agentId,
      });
    }
  },

  async listUnreadByGroup(input: { agentId: UUID }): Promise<
    Array<{
      groupId: UUID;
      messages: Array<{
        id: UUID;
        senderId: UUID;
        contentType: string;
        content: string;
        sendTime: string;
      }>;
    }>
  > {
    const db = getDb();
    const memberships = await db
      .select({ groupId: groupMembers.groupId, lastReadMessageId: groupMembers.lastReadMessageId })
      .from(groupMembers)
      .where(eq(groupMembers.userId, input.agentId));

    const result = [];

    for (const m of memberships) {
      let cutoff = new Date(0);
      if (m.lastReadMessageId) {
        const last = await db
          .select({ sendTime: messages.sendTime })
          .from(messages)
          .where(eq(messages.id, m.lastReadMessageId))
          .limit(1);
        cutoff = last[0]?.sendTime ?? cutoff;
      }

      const rows = await db
        .select({
          id: messages.id,
          senderId: messages.senderId,
          content: messages.content,
          contentType: messages.contentType,
          sendTime: messages.sendTime,
        })
        .from(messages)
        .where(
          and(eq(messages.groupId, m.groupId), gt(messages.sendTime, cutoff), ne(messages.senderId, input.agentId))
        )
        .orderBy(messages.sendTime);

      if (rows.length === 0) continue;

      result.push({
        groupId: m.groupId,
        messages: rows.map((row) => ({ ...row, sendTime: row.sendTime.toISOString() })),
      });
    }

    return result;
  },

  async listGroups(input: { workspaceId?: UUID; agentId?: UUID }) {
    const db = getDb();
    const viewerRole =
      input.agentId
        ? (
            await db
              .select({ role: agents.role })
              .from(agents)
              .where(eq(agents.id, input.agentId))
              .limit(1)
          )[0]?.role ?? null
        : null;

    const rows = input.agentId
      ? await db
          .select({
            id: groups.id,
            name: groups.name,
            workspaceId: groups.workspaceId,
            contextTokens: groups.contextTokens,
            createdAt: groups.createdAt,
          })
          .from(groups)
          .innerJoin(groupMembers, eq(groupMembers.groupId, groups.id))
          .where(
            input.workspaceId
              ? and(eq(groups.workspaceId, input.workspaceId), eq(groupMembers.userId, input.agentId))
              : eq(groupMembers.userId, input.agentId)
          )
          .orderBy(desc(groups.createdAt))
      : await db
          .select({
            id: groups.id,
            name: groups.name,
            workspaceId: groups.workspaceId,
            contextTokens: groups.contextTokens,
            createdAt: groups.createdAt,
          })
          .from(groups)
          .where(input.workspaceId ? eq(groups.workspaceId, input.workspaceId) : undefined)
          .orderBy(desc(groups.createdAt));

    if (rows.length === 0) return [];

    const groupIds = rows.map((g) => g.id);

    // ---- Batch: all members for all groups (1 query instead of N) ----
    const allMemberRows = await db
      .select({ groupId: groupMembers.groupId, userId: groupMembers.userId })
      .from(groupMembers)
      .where(inArray(groupMembers.groupId, groupIds));

    const membersByGroup = new Map<string, typeof allMemberRows>();
    for (const m of allMemberRows) {
      let arr = membersByGroup.get(m.groupId);
      if (!arr) {
        arr = [];
        membersByGroup.set(m.groupId, arr);
      }
      arr.push(m);
    }

    // ---- Batch: latest message per group (DISTINCT ON, 1 query instead of N) ----
    let lastMessageRows: Array<{
      id: string; sender_id: string; content: string; content_type: string; send_time: Date; group_id: string;
    }> = [];
    try {
      const groupIdList = dsql.join(
        groupIds.map((gid) => dsql`${gid}::uuid`),
        dsql`, `
      );
      const raw = await db.execute(
        dsql`
          SELECT DISTINCT ON (m.group_id)
            m.id, m.sender_id, m.content, m.content_type, m.send_time, m.group_id
          FROM messages m
          WHERE m.group_id IN (${groupIdList})
          ORDER BY m.group_id, m.send_time DESC
        `
      );
      lastMessageRows = raw as unknown as typeof lastMessageRows;
    } catch {
      // If the subquery fails (e.g. no messages at all), leave empty
    }
    const lastMsgByGroup = new Map<string, typeof lastMessageRows[0]>();
    for (const lm of lastMessageRows) {
      lastMsgByGroup.set(lm.group_id, lm);
    }

    // ---- Batch: unread counts (1 or 2 queries instead of N) ----
    let unreadByGroup = new Map<string, number>();
    if (input.agentId) {
      // Get read positions for this agent across all groups
      const readStates = await db
        .select({ groupId: groupMembers.groupId, lastReadMessageId: groupMembers.lastReadMessageId })
        .from(groupMembers)
        .where(and(inArray(groupMembers.groupId, groupIds), eq(groupMembers.userId, input.agentId)));

      // Get send times of all last-read messages (batch)
      const readMsgIds = readStates.map((r) => r.lastReadMessageId).filter(Boolean) as string[];
      const readTimes = new Map<string, Date>();
      if (readMsgIds.length > 0) {
        const msgTimes = await db
          .select({ id: messages.id, sendTime: messages.sendTime })
          .from(messages)
          .where(inArray(messages.id, readMsgIds));
        for (const mt of msgTimes) {
          readTimes.set(mt.id, mt.sendTime);
        }
      }

      // Build per-group cutoff
      const cutoffByGroup = new Map<string, Date | null>();
      const readStateMap = new Map<string, { lastReadMessageId: string | null }>();
      for (const rs of readStates) {
        readStateMap.set(rs.groupId, rs);
      }
      for (const gid of groupIds) {
        const rs = readStateMap.get(gid);
        if (!rs || !rs.lastReadMessageId) {
          cutoffByGroup.set(gid, null); // count all
        } else {
          cutoffByGroup.set(gid, readTimes.get(rs.lastReadMessageId) ?? new Date(0));
        }
      }

      // Batch unread count using a VALUES join or per-group approach
      // Since each group has a different cutoff, batch by cutoff category
      const noCutoffGroups: string[] = [];
      const cutoffMap = new Map<string, string>(); // groupId → ISO timestamp
      for (const [gid, cutoff] of cutoffByGroup) {
        if (cutoff === null) {
          noCutoffGroups.push(gid);
        } else {
          cutoffMap.set(gid, cutoff.toISOString());
        }
      }

      // Groups with no prior read: count all messages not from self
      if (noCutoffGroups.length > 0) {
        const noCutoffList = dsql.join(
          noCutoffGroups.map((gid) => dsql`${gid}::uuid`),
          dsql`, `
        );
        const counts = await db.execute(
          dsql`
            SELECT m.group_id, count(*)::int as cnt
            FROM messages m
            WHERE m.group_id IN (${noCutoffList})
              AND m.sender_id != ${input.agentId}
            GROUP BY m.group_id
          `
        );
        for (const row of (counts as unknown as Array<{ group_id: string; cnt: number }>)) {
          unreadByGroup.set(row.group_id, row.cnt);
        }
      }

      // Groups with a cutoff: count messages after the cutoff
      for (const [gid, cutoffStr] of cutoffMap) {
        const counts = await db.execute(
          dsql`
            SELECT count(*)::int as cnt
            FROM messages m
            WHERE m.group_id = ${gid}
              AND m.sender_id != ${input.agentId}
              AND m.send_time > ${cutoffStr}::timestamptz
          `
        );
        const row = (counts as unknown as Array<{ cnt: number }>)[0];
        unreadByGroup.set(gid, row?.cnt ?? 0);
      }
    }

    // ---- Build result ----
    const result = [];
    for (const g of rows) {
      const members = (membersByGroup.get(g.id) ?? []).map((m) => m.userId);
      const lastMsg = lastMsgByGroup.get(g.id);
      const unreadCount = unreadByGroup.get(g.id) ?? 0;
      const updatedAt = lastMsg?.send_time ?? g.createdAt;

      result.push({
        id: g.id,
        name: g.name,
        memberIds: members,
        unreadCount,
        contextTokens: g.contextTokens ?? 0,
        lastMessage: lastMsg
          ? {
              content: lastMsg.content,
              contentType: lastMsg.content_type,
              sendTime: new Date(lastMsg.send_time).toISOString(),
              senderId: lastMsg.sender_id,
            }
          : undefined,
        updatedAt: new Date(updatedAt).toISOString(),
        createdAt: g.createdAt.toISOString(),
      });
    }

    return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  async setGroupContextTokens(input: { groupId: UUID; tokens: number }) {
    const db = getDb();
    const group = await db
      .select({ workspaceId: groups.workspaceId, contextTokens: groups.contextTokens })
      .from(groups)
      .where(eq(groups.id, input.groupId))
      .limit(1);
    if (group.length === 0) throw new Error("group not found");

    await db.update(groups).set({ contextTokens: input.tokens }).where(eq(groups.id, input.groupId));

    await emitDbWrite({
      workspaceId: group[0]!.workspaceId,
      table: "groups",
      action: "update",
      recordId: input.groupId,
    });

    return { contextTokens: input.tokens };
  },

  async listRecentWorkspaceMessages(input: { workspaceId: UUID; limit?: number }) {
    const db = getDb();
    const limit = Math.max(1, Math.min(5000, input.limit ?? 2000));
    const rows = await db
      .select({
        id: messages.id,
        groupId: messages.groupId,
        senderId: messages.senderId,
        sendTime: messages.sendTime,
      })
      .from(messages)
      .where(eq(messages.workspaceId, input.workspaceId))
      .orderBy(desc(messages.sendTime))
      .limit(limit);

    return rows.map((m) => ({
      id: m.id,
      groupId: m.groupId,
      senderId: m.senderId,
      sendTime: m.sendTime.toISOString(),
    }));
  },

  async backupWorkspace(input: { workspaceId: UUID }) {
    const db = getDb();

    const workspace = await db
      .select({ id: workspaces.id, name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.id, input.workspaceId))
      .limit(1);
    if (workspace.length === 0) throw new Error("workspace not found");

    const allAgents = await db
      .select({
        id: agents.id,
        workspaceId: agents.workspaceId,
        role: agents.role,
        parentId: agents.parentId,
        llmHistory: agents.llmHistory,
        createdAt: agents.createdAt,
      })
      .from(agents)
      .where(eq(agents.workspaceId, input.workspaceId));

    const allGroups = await db
      .select({
        id: groups.id,
        workspaceId: groups.workspaceId,
        name: groups.name,
        contextTokens: groups.contextTokens,
        createdAt: groups.createdAt,
      })
      .from(groups)
      .where(eq(groups.workspaceId, input.workspaceId));

    const groupIds = allGroups.map((g) => g.id);
    let allMembers: Array<{ groupId: UUID; userId: UUID; lastReadMessageId: UUID | null; joinedAt: Date }> = [];
    if (groupIds.length > 0) {
      allMembers = await db
        .select({
          groupId: groupMembers.groupId,
          userId: groupMembers.userId,
          lastReadMessageId: groupMembers.lastReadMessageId,
          joinedAt: groupMembers.joinedAt,
        })
        .from(groupMembers)
        .where(inArray(groupMembers.groupId, groupIds));
    }

    let allMessages: Array<{
      id: UUID;
      workspaceId: UUID;
      groupId: UUID;
      senderId: UUID;
      contentType: string;
      content: string;
      sendTime: Date;
    }> = [];
    if (groupIds.length > 0) {
      allMessages = await db
        .select({
          id: messages.id,
          workspaceId: messages.workspaceId,
          groupId: messages.groupId,
          senderId: messages.senderId,
          contentType: messages.contentType,
          content: messages.content,
          sendTime: messages.sendTime,
        })
        .from(messages)
        .where(and(eq(messages.workspaceId, input.workspaceId), inArray(messages.groupId, groupIds)))
        .orderBy(messages.sendTime);
    }

    const backupData = {
      workspace: { id: input.workspaceId, name: workspace[0]!.name },
      agents: allAgents,
      groups: allGroups,
      groupMembers: allMembers,
      messages: allMessages,
    };

    const backupId = uuid();
    const createdAt = now();

    await db.insert(backups).values({
      id: backupId,
      workspaceId: input.workspaceId,
      data: JSON.stringify(backupData),
      createdAt,
    });

    return { id: backupId, createdAt: createdAt.toISOString() };
  },

  async restoreBackup(input: { backupId: UUID }) {
    const db = getDb();

    const result = await db.execute(
      dsql`SELECT workspace_id, data FROM backups WHERE id = ${input.backupId}`
    );
    const rows = result as unknown as Array<{ workspace_id: string; data: string }>;
    if (rows.length === 0) throw new Error("backup not found");

    const workspaceId = rows[0].workspace_id;
    const parsed = JSON.parse(rows[0].data);

    await db.transaction(async (tx) => {
      await tx.execute(dsql`DELETE FROM messages WHERE workspace_id = ${workspaceId}`);

      const allGroups = await tx
        .select({ id: groups.id })
        .from(groups)
        .where(eq(groups.workspaceId, workspaceId));
      const groupIds = allGroups.map((g) => g.id);
      if (groupIds.length > 0) {
        await tx.delete(groupMembers).where(inArray(groupMembers.groupId, groupIds));
      }
      await tx.delete(groups).where(eq(groups.workspaceId, workspaceId));

      await tx.delete(agents).where(eq(agents.workspaceId, workspaceId));

      for (const agent of parsed.agents) {
        const createdDate = agent.createdAt instanceof Date ? agent.createdAt : new Date(agent.createdAt);
        await tx.insert(agents).values({
          id: agent.id,
          workspaceId: agent.workspaceId,
          role: agent.role,
          parentId: agent.parentId,
          llmHistory: agent.llmHistory,
          createdAt: createdDate,
        });
      }

      for (const group of parsed.groups) {
        const createdDate = group.createdAt instanceof Date ? group.createdAt : new Date(group.createdAt);
        await tx.insert(groups).values({
          id: group.id,
          workspaceId: group.workspaceId,
          name: group.name,
          contextTokens: group.contextTokens ?? 0,
          createdAt: createdDate,
        });
      }

      for (const member of parsed.groupMembers) {
        const joinedDate = member.joinedAt instanceof Date ? member.joinedAt : new Date(member.joinedAt);
        await tx.insert(groupMembers).values({
          groupId: member.groupId,
          userId: member.userId,
          lastReadMessageId: member.lastReadMessageId,
          joinedAt: joinedDate,
        });
      }

      for (const msg of parsed.messages) {
        const sendDate = msg.sendTime instanceof Date ? msg.sendTime : new Date(msg.sendTime);
        await tx.insert(messages).values({
          id: msg.id,
          workspaceId: msg.workspaceId,
          groupId: msg.groupId,
          senderId: msg.senderId,
          contentType: msg.contentType,
          content: msg.content,
          sendTime: sendDate,
        });
      }
    });

    await emitDbWrite({
      workspaceId,
      table: "agents",
      action: "update",
    });
    await emitDbWrite({
      workspaceId,
      table: "groups",
      action: "update",
    });
    await emitDbWrite({
      workspaceId,
      table: "messages",
      action: "update",
    });

    return { workspaceId, restoredAt: new Date().toISOString() };
  },

  async listBackups(input: { workspaceId?: UUID }) {
    const db = getDb();

    let result;
    if (input.workspaceId) {
      result = await db.execute(
        dsql`SELECT id, workspace_id, created_at FROM backups WHERE workspace_id = ${input.workspaceId} ORDER BY created_at DESC`
      );
    } else {
      result = await db.execute(
        dsql`SELECT id, workspace_id, created_at FROM backups ORDER BY created_at DESC`
      );
    }

    return (result as unknown as Array<{ id: string; workspace_id: string; created_at: string | Date }>).map((row) => ({
      id: row.id as UUID,
      workspaceId: row.workspace_id as UUID,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
    }));
  },

  async getBackupData(input: { backupId: UUID }) {
    const db = getDb();

    const result = await db.execute(
      dsql`SELECT id, workspace_id, data, created_at FROM backups WHERE id = ${input.backupId}`
    );
    const rows = result as unknown as Array<{ id: string; workspace_id: string; data: string | Record<string, unknown>; created_at: string | Date }>;
    if (rows.length === 0) throw new Error("backup not found");

    const raw = rows[0].data;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;

    return {
      id: rows[0].id as UUID,
      workspaceId: rows[0].workspace_id as UUID,
      data: parsed,
      createdAt: rows[0].created_at instanceof Date ? rows[0].created_at.toISOString() : new Date(rows[0].created_at).toISOString(),
    };
  },
};
