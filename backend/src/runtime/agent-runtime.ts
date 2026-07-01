// agent-runtime.ts — AgentRunner + AgentRuntime (orchestration core)
// Sub-module imports: constants, types, keys, scheduler, helpers, providers, tools, security

import { store } from "@/lib/storage";
import { GLMStreamAssembler, parseSSEJsonLines, GLMAssembledState } from "@/lib/glm-stream";
import { OpenAIStreamAssembler, OpenAIAssembledState } from "@/lib/openai-stream";
import { getSetting } from "@/lib/settings";

import { AgentEventBus } from "./event-bus";
import { createDeferred, safeJsonParse } from "./utils";
import { getWorkspaceUIBus } from "./ui-bus";
import { getMcpRegistry } from "./mcp";
import { getSandboxConfig, isDockerAvailable, execInSandbox, execOnHost } from "./bash-sandbox";
import { appendAgentHistorySnapshot, appendAgentLlmRequestRaw, appendAgentStreamEvent } from "./agent-logger";
import { formatSkillPrompt, getSkillLoader, getSkillDirectory, invalidateSkillCache, FRONTMATTER_RE, parseFrontmatter } from "./skill-loader";
import { parseSkillReferences } from "@/lib/skill-utils";
import { analyzeForSkillSuggestions } from "./skill-discovery";
import { getMetricsCollector, estimateCost } from "../observability/metrics-collector";

// Sub-module imports
import {
  MAX_LLM_RETRIES, LLM_RETRY_BASE_MS, LLM_REQUEST_TIMEOUT_MS,
  MAX_CONCURRENT_LLM, MIN_LLM_INTERVAL_MS,
  NUDGE_INTERVAL, MAX_AUTO_SKILLS_PER_AGENT_PER_DAY,
  COMPRESS_PROTECT_FIRST, COMPRESS_PROTECT_LAST, COMPRESS_TRIGGER, COMPRESS_MAX_CONTENT,
  SKILL_STALE_DAYS, SKILL_ARCHIVE_DAYS, SKILL_MERGE_SIMILARITY,
} from "./agent-constants";

import type {
  UUID, MultimodalContentPart, HistoryMessage, ToolCall,
} from "./agent-types";
import {
  uuid, EXT_TO_MEDIA, SKILLS_MARKER, SOUL_MARKER,
  MAX_TOOL_RESULT_CHARS, SEND_TOOL_NAMES, CREATE_TOOL_NAMES, REPLY_TOOL_NAMES,
  MAX_AGENT_TURNS, groupAgentTurnCount,
} from "./agent-types";

import { KeyPool, invalidateKeyPools } from "./agent-keys";

import {
  llmFetch, isLlmCircuitOpen, recordLlmFailure, recordLlmSuccess,
} from "./agent-scheduler";

import {
  historyHasTool, historyHasSuccessfulTool, buildTextArray,
  buildSkillsBlock, invalidateSoulCache, loadSoulMd,
  historyHasSoul, historyHasSkills,
  compressHistory, mapOpenRouterMessages,
  setRuntimeSetting, getRuntimeSetting,
} from "./agent-helpers";

import {
  getGlmConfig, getFreellmapiConfig, getLlmProvider, isProviderConfigured,
  getProviderChain, getProviderHandler,
  getOpenRouterConfig, getAnthropicConfig, getOllamaConfig,
  PROVIDER_REGISTRY,
} from "./agent-providers";
import type { LlmProvider, StreamContext, LlmStreamResult } from "./agent-providers";

import {
  TOOL_AVAILABILITY, getAgentTools, BUILTIN_TOOL_NAMES,
} from "./agent-tools";
import type { ToolContext } from "./agent-tools";

import {
  searchGitHubSkills, searchLocalSkills,
  toRawGitHubUrl, fetchSkillContent, scanSkillContent,
} from "./agent-security";

// Re-export for backward compatibility (external consumers: settings/model route)
export { setRuntimeSetting, getRuntimeSetting } from "./agent-helpers";

import { getDb } from "@/db";
import { sql, inArray } from "drizzle-orm";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";

type StreamAssembledState = OpenAIAssembledState | GLMAssembledState;

export class AgentRunner {
  private wake = createDeferred<void>();
  private started = false;
  private running = false;
  private interruptRequested = false;
  private static readonly MAX_PROCESS_ITERATIONS = 3;
  private turnToolFailures = new Map<string, number>();
  // Guardrail: consecutive failure count for same tool + params
  private exactFailureCount = new Map<string, number>();
  // Guardrail: total failure count for same tool
  private sameToolFailureCount = new Map<string, number>();
  // Tools blocked due to exact failures >= 5
  private blockedTools = new Set<string>();
  // Agent paused due to total failures >= 8
  private agentPaused = false;
  // Agent is waiting for user response to a structured question (ask_user)
  private pendingUserQuestion = false;
  // Free mode memory search cache: query -> results (design doc 搂6.5)
  private memoryCache = new Map<string, Array<Record<string, unknown>>>();
  // Track last activity time for cleanup
  private lastActiveTime = Date.now();
  // Memory snapshot flag —injected once per fresh session to stabilize prompt caching
  private memorySnapshotAdded = false;
  // Tool context for check_fn availability filtering (updated each turn)
  private toolContext: ToolContext | null = null;
  // Nudge Engine: round counter for periodic background analysis
  private nudgeCounter = 0;
  // Auto-skill trigger: count of meaningful actions since last skill nudge
  private meaningfulActions = 0;
  private static readonly SKILL_AUTO_TRIGGER_AFTER = 3;
  // search_skill per-turn call counter (reset in resetForTurn)
  private _searchCountThisTurn = 0;
  // search_skill query cache: query -> { results, timestamp }
  private static _searchCache = new Map<string, { results: unknown[]; ts: number }>();
  private static _SEARCH_CACHE_MAX = 100;
  // === Skill Proposal Approval Gate: pending proposals awaiting user confirmation ===
  private static _pendingProposals = new Map<string, {
    action: "create" | "patch";
    skillName: string;
    skillDescription: string;
    skillContent: string;
    createdAt: string;
    source: "nudge" | "workflow";
  }>();
  // Pipeline context: when agent is woken via pipeline (not group message), store the instruction here
  private pipelineContext: { groupId: string; instruction: string; stageName: string } | null = null;
  // === Cognitive Pipeline: per-turn tracking for verification gate ===
  // Tracks bash commands that look like verification (tsc, vitest, etc.)
  private verificationToolsCalled = new Set<string>();
  // Tracks whether any code-modifying operations happened this turn
  private codeModificationsThisTurn = false;
  // Cumulative count of code modifications across all rounds (for proactive nudge)
  private codeModificationCount = 0;
  // Tracks if verification was run but had errors (for "fix before continuing" injection)
  private verificationHadErrors = false;
  // Stores the last verification error summary for injection
  private verificationErrorSummary = "";
  // Safety valve: count of verification gate blocks to prevent deadlock
  private verificationGateBlocks = 0;

  /**
   * Record a structured decision event for self-learning.
   * Design: extract structured events at decision points, not from raw history.
   * Inspired by human memory: encode at the moment of decision, not replay later.
   */
  async recordDecision(input: {
    groupId?: string;
    decisionType: string;
    targetType?: string;
    targetId?: string;
    inputSummary?: string;
    outputSummary?: string;
    success?: boolean;
  }) {
    try {
      const { v4: uuid } = await import("uuid");
      const db = getDb();
      // Get workspace_id
      const wsRows = await db.execute(
        sql`SELECT workspace_id FROM agents WHERE id = ${this.agentId} LIMIT 1`
      );
      const ws = (wsRows as unknown as Array<{ workspace_id: string }>)[0];
      if (!ws) return;

      const MAX_SUMMARY = 200;
      await db.execute(
        sql`INSERT INTO agent_decisions (id, agent_id, group_id, workspace_id, decision_type, target_type, target_id, input_summary, output_summary, success, created_at)
            VALUES (${uuid()}, ${this.agentId}, ${input.groupId ?? null}, ${ws.workspace_id}, ${input.decisionType}, ${input.targetType ?? null}, ${input.targetId ?? null}, ${(input.inputSummary ?? "").slice(0, MAX_SUMMARY)}, ${(input.outputSummary ?? "").slice(0, MAX_SUMMARY)}, ${input.success ?? null}, ${new Date()})`
      );
    } catch {
      // best-effort —table may not exist or decision extraction is non-critical
    }
  }

  /**
   * Archive a completed session —generate summary and clear llm_history.
   * Inspired by human episodic memory: distill events into a structured summary,
   * don't keep the raw conversation forever.
   */
  async archiveSession(input: {
    groupId: string;
    sessionType: string;
    title: string;
    summary: string;
    keyDecisions?: Record<string, unknown>[];
  }) {
    try {
      const { v4: uuid } = await import("uuid");
      const db = getDb();
      const wsRows = await db.execute(
        sql`SELECT workspace_id FROM agents WHERE id = ${this.agentId} LIMIT 1`
      );
      const ws = (wsRows as unknown as Array<{ workspace_id: string }>)[0];
      if (!ws) return;

      await db.execute(
        sql`INSERT INTO session_archives (id, group_id, workspace_id, session_type, title, summary, key_decisions, archived_at)
            VALUES (${uuid()}, ${input.groupId}, ${ws.workspace_id}, ${input.sessionType}, ${input.title.slice(0,100)}, ${input.summary.slice(0,2000)}, ${JSON.stringify(input.keyDecisions ?? [])}, ${new Date()})`
      );

      // Clear llm_history but keep system messages (soul, skills, rules)
      const agent = await store.getAgent({ agentId: this.agentId });
      const parsed = safeJsonParse<unknown>(agent.llmHistory, {});
      const history = Array.isArray(parsed) ? (parsed as HistoryMessage[]) : [];
      const systemMsgs = history.filter((m) => m.role === "system").slice(-3);
      await store.setAgentHistory({
        agentId: this.agentId,
        llmHistory: JSON.stringify(systemMsgs),
      });
      console.info(`[archiveSession] archived "${input.title}" for group ${input.groupId.slice(0,8)}`);
    } catch (err) {
      console.warn(`[archiveSession] failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  constructor(
    private readonly agentId: UUID,
    private readonly bus: AgentEventBus,
    private readonly ensureRunner: (agentId: UUID) => void,
    private readonly wakeAgent: (agentId: UUID) => void,
    private readonly stopRunner: (agentId: UUID) => void
  ) {}

  start() {
    if (this.started) return;
    this.started = true;
    void this.ensureSkillsLoaded();
    void this.loop();
  }

  /**
   * Check if runner has been idle for longer than timeoutMs
   */
  isIdleTooLong(timeoutMs: number): boolean {
    if (this.running) return false; // Currently processing, not idle
    return Date.now() - this.lastActiveTime > timeoutMs;
  }

  private touchActive() {
    this.lastActiveTime = Date.now();
  }

  private async ensureSkillsLoaded() {
    try {
      const agent = await store.getAgent({ agentId: this.agentId });
      const parsed = safeJsonParse<unknown>(agent.llmHistory, {});
      const history = Array.isArray(parsed) ? (parsed as HistoryMessage[]) : [];
      if (historyHasSkills(history)) return;
      const skillsBlock = await buildSkillsBlock(agent.role);
      if (!skillsBlock) return;
      history.push({ role: "system", content: skillsBlock });
      await store.setAgentHistory({
        agentId: this.agentId,
        llmHistory: JSON.stringify(history),
      });
    } catch {
      // best-effort only
    }
  }

  wakeup(reason: "manual" | "group_message" | "direct_message" | "context_stream" = "manual") {
    console.info(`[AgentRunner:wakeup] agent=${this.agentId} reason=${reason}`);
    // Run skill evaluation on wakeup —async, non-blocking (design doc 搂11.4)
    void this.evaluateSkills();
    this.wake.resolve();
    this.wake = createDeferred<void>();
    this.bus.emit(this.agentId, {
      event: "agent.wakeup",
      data: { agentId: this.agentId, reason },
    });
  }

  requestInterrupt() {
    console.info(`[AgentRunner:requestInterrupt] agent=${this.agentId.slice(0,8)} setting interrupt flag`);
    this.interruptRequested = true;
    this.wake.resolve();
    this.wake = createDeferred<void>();
  }

  setPipelineContext(ctx: { groupId: string; instruction: string; stageName: string; toolGroups?: string[] } | null) {
    this.pipelineContext = ctx;
  }

  private consumeInterruptRequest() {
    if (!this.interruptRequested) return false;
    // Don't clear the flag here — it should persist until explicitly cleared
    // via clearInterrupt(). This prevents agents from auto-restarting after
    // user clicks "Stop All Agents" and then receives new messages.
    console.info(`[AgentRunner:consumeInterruptRequest] agent=${this.agentId.slice(0,8)} interrupt flag is set, returning early`);
    return true;
  }

  /** Clear the interrupt flag. Called when user explicitly resumes the agent. */
  clearInterrupt() {
    console.info(`[AgentRunner:clearInterrupt] agent=${this.agentId.slice(0,8)} clearing interrupt flag`);
    this.interruptRequested = false;
  }

  private async loop() {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        // Safety timeout: if no wakeup within 600s, agent is orphaned —stop
        const timeoutMs = 600_000;
        let woke = false;
        await Promise.race([
          this.wake.promise.then(() => { woke = true; }),
          new Promise<void>((r) => setTimeout(r, timeoutMs)),
        ]);
        if (!woke) {
          console.info(`[AgentRunner:loop] wakeup timeout ${timeoutMs}ms, stopping runner`);
          this.stopRunner(this.agentId);
        }
        if (!this.started) continue; // stopRunner set started=false
        if (this.running) continue;
        this.running = true;
        this.touchActive();
        const iterationStart = Date.now();
        let hadWork = false;
        try {
          hadWork = await this.processUntilIdle();
        } catch (err) {
          this.bus.emit(this.agentId, {
            event: "agent.error",
            data: { message: err instanceof Error ? err.message : String(err) },
          });
          const message = err instanceof Error ? err.message : String(err);
          void appendAgentStreamEvent({
            agentId: this.agentId,
            kind: "error",
            error: message,
          });
        } finally {
          // Trim history BEFORE releasing the running lock to prevent race conditions
          await this.trimHistoryIfNeeded();
          this.running = false;
        }
      // Hermes idle timeout: 450s idle (no messages) / 1200s active (processing).
      // If processUntilIdle did no work and total elapsed exceeds idle budget, stop.
      const elapsed = Date.now() - iterationStart;
      if (!hadWork && elapsed >= 450_000) {
        console.info(`[AgentRunner:loop] idle timeout after ${elapsed}ms, stopping runner`);
        this.stopRunner(this.agentId);
      } else if (hadWork && elapsed >= 1_200_000) {
        console.info(`[AgentRunner:loop] active timeout after ${elapsed}ms, stopping runner`);
        this.stopRunner(this.agentId);
      }
      } catch (err) {
        // Isolate agent crashes from crashing the entire runtime
        console.error(`[AgentRunner:loop] agent ${this.agentId.slice(0,8)} crashed:`, err);
        this.bus.emit(this.agentId, {
          event: "agent.error",
          data: { message: `Agent crashed: ${err instanceof Error ? err.message : String(err)}` },
        });
        // Wait before restarting to prevent crash loops
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  /**
   * Trim agent history to prevent unbounded growth.
   * Keep system messages + last 30 conversation messages.
   * Runs async, best-effort —never blocks the loop.
   */
  private async trimHistoryIfNeeded() {
    const MAX_CONVERSATION_MSGS = 30;
    try {
      const agent = await store.getAgent({ agentId: this.agentId });
      const history = safeJsonParse<HistoryMessage[]>(agent.llmHistory, []);
      if (!Array.isArray(history)) return;
      if (history.length <= MAX_CONVERSATION_MSGS + 2) return; // already small

      // Keep all system messages + last N non-system messages
      const systemMsgs = history.filter((m) => m.role === "system");
      const convMsgs = history.filter((m) => m.role !== "system");
      const trimmedConvMsgs = convMsgs.slice(-MAX_CONVERSATION_MSGS);
      const trimmed = [...systemMsgs, ...trimmedConvMsgs];

      if (trimmed.length >= history.length) return; // nothing to trim

      const trimmedJson = JSON.stringify(trimmed);
      if (trimmedJson.length < 50_000) {
        // Only trim if result is under 50KB
        await store.setAgentHistory({ agentId: this.agentId, llmHistory: trimmedJson });
        console.info(`[trimHistory] agent=${this.agentId.slice(0,8)} ${history.length}→{trimmed.length} msgs, ${agent.llmHistory.length}→{trimmedJson.length} chars`);
      }
    } catch {
      // best-effort
    }
  }

  private async processUntilIdle(): Promise<boolean> {
    const role = await store.getAgentRole({ agentId: this.agentId }).catch(() => null);
    if (role === "human" || role === null) return false;
    if (this.consumeInterruptRequest()) return false;
    let iterations = 0;
    let hadWork = false;
    let workspaceId: string | null = null;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (iterations >= AgentRunner.MAX_PROCESS_ITERATIONS) break;
      iterations++;
      if (this.consumeInterruptRequest()) break;
      const batches = await store.listUnreadByGroup({ agentId: this.agentId });
      console.info(`[processUntilIdle] agent=${this.agentId} iterations=${iterations} batches=${batches.length}`);
      // Pipeline mode: check for pending pipeline instruction first (Phase 1 - deterministic execution)
      if (this.pipelineContext) {
        console.info(`[processUntilIdle] agent=${this.agentId} processing pipeline stage="${this.pipelineContext.stageName}"`);
        // Emit working.start for pipeline mode
        if (!workspaceId && batches.length > 0) {
          workspaceId = await store.getGroupWorkspaceId({ groupId: batches[0].groupId });
          getWorkspaceUIBus().emit(workspaceId, { event: "ui.agent.working.start", data: { workspaceId, agentId: this.agentId } });
        }
        try {
          await this.processPipelineInstruction(this.pipelineContext.groupId, this.pipelineContext.instruction);
          hadWork = true;
        } catch (err) {
          console.error(`[processUntilIdle] Pipeline processing failed:`, err);
        }
        this.pipelineContext = null; // clear after processing
        break;
      }

      if (batches.length === 0) break;

      // Emit working.start on first batch with actual work
      if (!workspaceId) {
        workspaceId = await store.getGroupWorkspaceId({ groupId: batches[0].groupId });
        getWorkspaceUIBus().emit(workspaceId, { event: "ui.agent.working.start", data: { workspaceId, agentId: this.agentId } });
      }

      this.bus.emit(this.agentId, {
        event: "agent.unread",
        data: {
          agentId: this.agentId,
          batches: batches.map((batch) => ({
            groupId: batch.groupId,
            messageIds: batch.messages.map((m) => m.id),
          })),
        },
      });

      for (const batch of batches) {
        console.info(`[processUntilIdle] Processing batch group=${batch.groupId} messages=${batch.messages.length}`);
        if (this.consumeInterruptRequest()) break;
        try {
          await this.processGroupUnread(batch.groupId, batch.messages);
          hadWork = true;
        } catch (err) {
          console.error(`[processUntilIdle] Error processing group=${batch.groupId}:`, err);
        }
        console.info(`[processUntilIdle] Done processing batch group=${batch.groupId}`);
        if (this.consumeInterruptRequest()) break;
      }
    }

    // Emit working.done when processing cycle finishes
    if (workspaceId) {
      getWorkspaceUIBus().emit(workspaceId, { event: "ui.agent.working.done", data: { workspaceId, agentId: this.agentId } });
    }

    return hadWork;
  }

  private async processGroupUnread(
    groupId: UUID,
    unreadMessages: Array<{
      id: UUID;
      senderId: UUID;
      content: string;
      contentType: string;
      sendTime: string;
    }>
  ) {
    console.info(`[processGroupUnread] group=${groupId} msgs=${unreadMessages.length}`);
    const workspaceId = await store.getGroupWorkspaceId({ groupId });
    console.info(`[processGroupUnread] workspaceId=${workspaceId}`);
    const agent = await store.getAgent({ agentId: this.agentId });
    console.info(`[processGroupUnread] agent role=${agent.role}`);

    // Check for active workflow in this group (includes draft for free-mode detection)
    let wfRow: { id: string; status: string; name: string; creator_id: string } | null = null;
    try {
      const db = getDb();
      console.info(`[processGroupUnread] db connected, checking workflow`);
      const wfRows = await db.execute(
        sql`SELECT id, status, name, creator_id FROM workflows WHERE group_id = ${groupId} ORDER BY updated_at DESC LIMIT 1`
      );
      const rows = wfRows as unknown as Array<{ id: string; status: string; name: string; creator_id: string }>;
      wfRow = rows[0] ?? null;
    } catch (err) {
      console.error(`[processGroupUnread] workflow check error:`, err);
    }

    // 缇や富 = coordinator锛堥搧寰?#6锛夈€傝皝鍒涘缓鐨勭兢/宸ヤ綔娴侊紝璋佸氨鏄?coordinator
    const isCoordinator = wfRow ? wfRow.creator_id === this.agentId : false;
    // Free mode: no workflow or only draft →all agents respond freely
    const isFreeMode = wfRow === null || wfRow.status === "draft";

    // activeWf: only non-draft workflows count as "active workflow mode"
    const activeWf = (wfRow && wfRow.status !== "draft")
      ? { id: wfRow.id, status: wfRow.status, name: wfRow.name }
      : null;
    console.info(`[processGroupUnread] activeWf=${activeWf ? `${activeWf.id}(${activeWf.status})` : "none"}, isCoordinator=${isCoordinator}, freeMode=${isFreeMode}`);

    // Resolve sender roles once (deduplicated), reused for hasHumanSender + coordinator check + user content
    const uniqueSenderIds = [...new Set(unreadMessages.map((m) => m.senderId))];
    const senderRoleCache = new Map<string, string | null>();
    await Promise.all(
      uniqueSenderIds.map(async (sid) => {
        const role = await store.getAgentRole({ agentId: sid }).catch(() => null);
        senderRoleCache.set(sid, role);
      })
    );
    const hasHumanSender = [...senderRoleCache.values()].some((r) => r === "human");

    // Update tool context for check_fn filtering
    this.toolContext = {
      agentId: this.agentId,
      isCoordinator,
      hasActiveWorkflow: activeWf !== null,
      shellEnabled: process.env.DISABLE_SHELL !== "true",
      hasHumanSender,
    };

    // If workflow is paused and this agent is not coordinator, skip
    if (activeWf && activeWf.status === "paused" && !isCoordinator) { console.info('[processGroupUnread] SKIP: workflow paused, not coordinator'); return; }

    // If workflow active and this is the coordinator: check if human just spoke →auto-pause
    if (activeWf && activeWf.status === "active" && isCoordinator) {
      if (hasHumanSender) {
        console.info('[processGroupUnread] SKIP: human spoke during active workflow, auto-pause');
        await getDb().execute(
          sql`UPDATE workflows SET status = 'paused', updated_at = ${new Date().toISOString()} WHERE id = ${activeWf.id}`
        );
        return;
      }
    }

    // If workflow is active and agent is not the assigned task owner, skip
    if (activeWf && activeWf.status === "active" && !isCoordinator) {
      const assignRows = await getDb().execute(
        sql`SELECT id FROM agent_assignments WHERE agent_id = ${this.agentId} AND group_id = ${groupId} AND status = 'active' AND task_id IS NOT NULL LIMIT 1`
      );
      if ((assignRows as unknown as Array<{ id: string }>)[0] === undefined) { console.info('[processGroupUnread] SKIP: workflow active, not assigned'); return; }
    }

    const parsed = safeJsonParse<unknown>(agent.llmHistory, {});
    const history = Array.isArray(parsed) ? (parsed as HistoryMessage[]) : [];

    // Proactive compression: trim bloated history before LLM call to reduce token usage
    if (history.length > COMPRESS_TRIGGER) {
      try {
        compressHistory(history);
        console.info(`[processGroupUnread] compressed history: ${history.length} messages`);
      } catch (err) {
        console.warn(`[processGroupUnread] compression failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    const skillsBlock = await buildSkillsBlock();
    const soulBlock = await loadSoulMd();
    const hasSkills = historyHasSkills(history);
    const hasSoul = historyHasSoul(history);

    if (history.length === 0) {
      const role = agent.role;
      const members = await store.listGroupMemberIds({ groupId });
      const memberRoles: Array<{ id: string; role: string | null }> = await Promise.all(
        members.map(async (mid) => ({
          id: mid,
          role: mid === this.agentId ? "YOU" : await store.getAgentRole({ agentId: mid }).catch(() => null),
        }))
      );
      const membersList = memberRoles
        .filter((m) => m.role !== "human")
        .map((m) => `${m.id.substring(0, 8)}(${m.role})`)
        .join(", ");

      // Load role template from disk (design doc 搂11.1 D20)
      const roleTemplatePath = path.join(__dirname, "..", "prompts", "roles", `${role}.md`);
      let roleContent = "";
      try {
        roleContent = await fs.readFile(roleTemplatePath, "utf-8");
      } catch {
        // No template for this role —continue with default prompt
      }

      const workflowContext = activeWf
        ? `\n\nThere is an active workflow: "${activeWf.name}" (status: ${activeWf.status}). ` +
          (isCoordinator
            ? "You are the coordinator. Monitor workflow progress, review task results, and assign next tasks."
            : "You are a worker. Only execute when assigned a task by the coordinator. Check get_workflow_status before acting.")
        : "";

      const systemContent =
        `You are an agent in an IM system. Agent ID: ${this.agentId}, workspace: ${workspaceId}, role: ${role}.\n` +
        `Group members: [${membersList}]. Reference agents by role only.\n` +
        `Act as your role. Replies are NOT auto-delivered —use send_group_message or send_direct_message.\n` +
        `When creating groups, always include 'human' in memberIds.\n` +
        `Use bash for shell commands. Save solved patterns as skills with create_skill.` +
        workflowContext +
        (skillsBlock ? `\n\n${skillsBlock}` : "");

      // Inject working directory context if configured
      const workDir = process.env.AGENT_WORKDIR || process.env.WORKING_DIR || "";
      const workDirBlock = workDir
        ? `\n\n## Working Directory\nYour working directory is \`${workDir}\`. This is the project root. Use this path for reading/writing files and running bash commands. Always resolve relative paths against this directory.`
        : "";

      // Inject role template before the system prompt if available
      const finalSystemContent = roleContent
        ? `${roleContent}\n\n---\n\n${systemContent}${workDirBlock}`
        : `${systemContent}${workDirBlock}`;

      history.push({
        role: "system",
        content: finalSystemContent,
      });

      // Inject memory snapshot for prompt stability (once per fresh session)
      if (!this.memorySnapshotAdded) {
        const memSnapshot = await this.buildMemorySnapshot();
        if (memSnapshot) {
          history.push({ role: "system", content: memSnapshot });
          this.memorySnapshotAdded = true;
        }
      }
    } else {
      if (soulBlock && !hasSoul) {
        history.push({ role: "system", content: soulBlock });
      }
      if (skillsBlock && !hasSkills) {
        history.push({ role: "system", content: skillsBlock });
      }
    }

    // Build user content with sender roles so agents know who's speaking
    // For image messages, use multimodal content so the LLM can see them
    const hasImages = unreadMessages.some((m) => m.contentType === "image");

    if (hasImages) {
      const parts: MultimodalContentPart[] = [];
      for (const m of unreadMessages) {
        const senderLabel = senderRoleCache.get(m.senderId) ?? m.senderId.substring(0, 8);

        if (m.contentType === "image") {
          let parsed: { url?: string } | null = null;
          try { parsed = JSON.parse(m.content); } catch {}

          if (parsed?.url) {
            try {
              const imgData = await this.fetchImageAsBase64(parsed.url);
              parts.push({
                type: "text",
                text: `[group:${groupId}] ${senderLabel} (发送了一张图片):`,
              });
              parts.push({
                type: "image_url",
                image_url: { url: `data:${imgData.mediaType};base64,${imgData.data}` },
              });
              continue;
            } catch (err) {
              console.warn(`[processGroupUnread] image fetch failed: ${parsed.url}`);
            }
          }
          parts.push({ type: "text", text: `[group:${groupId}] ${senderLabel}: [鍥剧墖] ${m.content}` });
        } else {
          parts.push({ type: "text", text: `[group:${groupId}] ${senderLabel}: ${m.content}` });
        }
      }
      history.push({ role: "user", content: parts });
    } else {
      const userContent = unreadMessages
        .map((m) => `[group:${groupId}] ${senderRoleCache.get(m.senderId) ?? m.senderId.substring(0, 8)}: ${m.content}`)
        .join("\n");
      history.push({ role: "user", content: userContent });
    }

    // === @skill hint injection: detect @skill-name references and guide agent ===
    const allUserText = unreadMessages
      .filter((m) => m.contentType === "text" || !m.contentType)
      .map((m) => m.content)
      .join(" ");
    const rawRefs = parseSkillReferences(allUserText);
    if (rawRefs.length > 0) {
      try {
        const loader = await getSkillLoader();
        const availableSkills = await loader.listSkills();
        const validRefs = rawRefs.filter((ref) =>
          availableSkills.some((s: string) => s.toLowerCase() === ref)
        );
        if (validRefs.length > 0) {
          const skillList = validRefs.map((s) => `"${s}"`).join(", ");
          history.push({
            role: "system",
            content: `[Skill Hint] 用户引用了 skill: ${skillList}。请调用 get_skill(${validRefs.map((s) => `"${s}"`).join(" / ")}) 加载并遵循其指导。`,
          });
        }
      } catch (err) {
        console.warn("[processGroupUnread] skill hint injection failed:", err);
      }
    }

    // === Cognitive Pipeline Layer 1: Task Classification + Risk Assessment + Decision Routing ===
    // For Worker agents (non-coordinator in active workflow), inject structured thinking guide
    // This ensures each Worker goes through classification → risk assessment → decision routing before executing
    const isWorker = !isCoordinator && !isFreeMode;
    if (isWorker && !hasHumanSender) {
      history.push({
        role: "system",
        content:
          `[Cognitive Pipeline — Task Intake & Decision Routing]\n` +
          `Before executing any tools, output a brief structured assessment:\n` +
          `1. **Task Type:** modify | create | analyze | debug | review\n` +
          `2. **Complexity:** simple | moderate | complex\n` +
          `3. **Risk Level:** low | medium | high (consider: file count, dangerous ops, DB writes)\n` +
          `4. **Decision Route** — choose ONE based on your assessment:\n` +
          `   - **Direct** (complexity=simple AND risk=low): proceed with tool calls immediately.\n` +
          `   - **Clarify** (task is ambiguous, missing key info, or requirements unclear): call ask_user or send_group_message to the coordinator BEFORE executing.\n` +
          `   - **Escalate** (risk=high, scope=5+ files, involves DB migration, or beyond your role): send_group_message to the coordinator explaining why, and wait for guidance.\n` +
          `Output your assessment + chosen route, THEN proceed accordingly.`,
      });
    }

    const lastId = unreadMessages[unreadMessages.length - 1]?.id;

    // === Cascade prevention: per-group agent turn counter ===
    if (hasHumanSender) {
      groupAgentTurnCount.set(groupId, 0);
    } else {
      // Skip cascade counter when workflow is active —workflow has its own coordinator review
      if (activeWf && activeWf.status === "active") {
        // Active workflow: managed by coordinator, no cascade limit needed
      } else {
        const currentTurns = groupAgentTurnCount.get(groupId) ?? 0;
        if (currentTurns >= MAX_AGENT_TURNS) {
          return;
        }
      }
      // Free mode: allow agents to respond naturally without requiring direct mentions.
      // The LLM decides based on context. The turn counter (MAX_AGENT_TURNS) is the
      // ultimate safety net against infinite loops.
    }

    let assistantText = "";
    let assistantThinking = "";
    let didSend = false;

    try {
      const result = await this.runWithTools({
        groupId,
        workspaceId,
        history,
        hasHumanSender,
        isWorker,
      });
      assistantText = result.assistantText;
      assistantThinking = result.assistantThinking;
      didSend = result.didSend;
    } catch (llmErr) {
      const errMsg = llmErr instanceof Error ? llmErr.message : String(llmErr);
      console.error(`[processGroupUnread] LLM call failed for agent ${this.agentId}: ${errMsg}`);
      // When LLM is unavailable (429 quota, etc.), send a short notice to human so they
      // aren't left wondering why the agent is silently BUSY.
      if (hasHumanSender && !this.interruptRequested) {
        assistantText = `[系统: LLM 服务暂不可用 (${errMsg.slice(0, 80)}), 请稍后再试]`;
        await store.sendMessage({
          groupId,
          senderId: this.agentId,
          content: assistantText,
          contentType: "text",
        });
      }
      // Still save what we have so the agent can retry on next wake
      history.push({
        role: "assistant",
        content: assistantText || "[LLM call failed]",
      });
      await store.setAgentHistory({
        agentId: this.agentId,
        llmHistory: JSON.stringify(history),
        workspaceId,
      });
      return;
    }

    if (didSend) {
      const currentTurns = groupAgentTurnCount.get(groupId) ?? 0;
      groupAgentTurnCount.set(groupId, currentTurns + 1);
    }

    history.push({
      role: "assistant",
      content: assistantText,
      reasoning_content: assistantThinking || undefined,
    });

    // If the message was from a human and agent didn't send any reply, auto-send the assistant text.
    // When assistantText is empty, send a short system notice so the human isn't left waiting.
    if (hasHumanSender && !didSend && !this.interruptRequested) {
      const content = assistantText.trim()
        || `[系统: ${this.agentId.substring(0, 8)} 本轮无法回复，请检查上下文或重试]`;
      const members = await store.listGroupMemberIds({ groupId });
      const result = await store.sendMessage({
        groupId,
        senderId: this.agentId,
        content,
        contentType: "text",
      });
      getWorkspaceUIBus().emit(workspaceId, {
        event: "ui.message.created",
        data: {
          workspaceId,
          groupId,
          memberIds: members,
          message: { id: result.id, senderId: this.agentId, sendTime: result.sendTime },
        },
      });
      for (let i = 0; i < members.length; i++) {
        if (members[i] === this.agentId) continue;
        const role = await store.getAgentRole({ agentId: members[i] }).catch(() => null);
        if (role === "human" || role === null) continue;
        const idx = i;
        const delay = 500 * idx + Math.floor(Math.random() * 500);
        (async () => {
          await new Promise((r) => setTimeout(r, delay));
          this.ensureRunner(members[idx]);
          this.wakeAgent(members[idx]);
        })();
      }
      didSend = true;
      const currentTurns = groupAgentTurnCount.get(groupId) ?? 0;
      groupAgentTurnCount.set(groupId, currentTurns + 1);
    }

    // If agent created agents but never successfully replied to a group, inject a reminder
    // into history WITHOUT calling LLM again (saves an entire LLM call cycle).
    // The next wakeup will see the reminder and act on it.
    const needsHumanReply = historyHasTool(history, CREATE_TOOL_NAMES) &&
      !historyHasSuccessfulTool(history, REPLY_TOOL_NAMES);

    if ((!didSend || needsHumanReply) && !this.interruptRequested) {
      const reminder = needsHumanReply
        ? "Reminder: created agents but no reply sent. Use send_group_message."
        : "Reminder: no send_* called this turn. Decide if reply is needed.";
      history.push({
        role: "user",
        content: reminder,
      });
      console.info(`[processGroupUnread] injected reminder (no LLM call) for agent ${this.agentId}`);
    }

    // Auto-skill trigger: after N meaningful sends, nudge the LLM to create a skill
    if (didSend) {
      this.meaningfulActions++;
      if (this.meaningfulActions >= AgentRunner.SKILL_AUTO_TRIGGER_AFTER) {
        this.meaningfulActions = 0;
        history.push({
          role: "system",
          content: `[Self-Learning] Patterns discovered —save with create_skill if worth preserving.`,
        });
        console.info(`[processGroupUnread] injected skill auto-trigger nudge for agent ${this.agentId}`);
      }
    }

    // === Skill Proposal Approval Gate: notify agent about pending proposals ===
    const pendingProposal = AgentRunner._pendingProposals.get(this.agentId);
    if (pendingProposal) {
      const preview = pendingProposal.skillContent.slice(0, 300).replace(/\n/g, " ");
      history.push({
        role: "system",
        content: [
          `[Skill Proposal — Pending User Approval]`,
          `The system identified a reusable pattern and prepared a skill ${pendingProposal.action === "patch" ? "update" : "creation"}:`,
          `- Name: "${pendingProposal.skillName}"`,
          `- Description: ${pendingProposal.skillDescription}`,
          `- Source: ${pendingProposal.source === "workflow" ? "completed workflow" : "conversation analysis"}`,
          `- Content preview: ${preview}...`,
          ``,
          `IMPORTANT: Do NOT create/patch this skill automatically.`,
          `1. Relay this proposal to the user via send_group_message.`,
          `2. Wait for explicit user approval ("approve", "go ahead", "可以", "好的").`,
          `3. Then call approve_skill_proposal(action: "${pendingProposal.action}") to execute.`,
          `4. If the user declines, the proposal will be discarded.`,
        ].join("\n"),
      });
    }

    if (lastId) {
      await store.markGroupReadToMessage({ groupId, readerId: this.agentId, messageId: lastId });
    }
    await store.setAgentHistory({
      agentId: this.agentId,
      llmHistory: JSON.stringify(history),
      workspaceId,
    });

    // Session archive: archive the conversation for cross-session FTS search (design doc 搂6.3).
    void this.archiveSessionToDb(history, groupId, workspaceId);

    try {
      await appendAgentHistorySnapshot({
        agentId: this.agentId,
        workspaceId,
        groupId,
        history,
      });
    } catch {
      // best-effort logging
    }
    getWorkspaceUIBus().emit(workspaceId, {
      event: "ui.agent.history.persisted",
      data: { workspaceId, agentId: this.agentId, groupId, historyLength: history.length },
    });
  }

  private async fetchImageAsBase64(url: string): Promise<{ data: string; mediaType: string }> {
    const fullUrl = url.startsWith("http") ? url : `http://127.0.0.1:${process.env.PORT ?? 3017}${url}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(fullUrl, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      const ext = url.split(".").pop()?.toLowerCase() ?? "png";
      const mediaType = EXT_TO_MEDIA[ext] ?? "image/png";
      return { data: buffer.toString("base64"), mediaType };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Archive the current LLM history to session_archives for cross-session retrieval.
   * Async, best-effort —does not block the main loop.
   * Called after every LLM turn (design doc 搂6.3).
   */
  private async archiveSessionToDb(
    history: HistoryMessage[],
    groupId: string,
    workspaceId: string,
  ) {
    try {
      const { v4: uuid } = await import("uuid");
      const db = getDb();

      // Extract key actions from history
      const assistantMsgs = history.filter((m) => m.role === "assistant" && m.content);
      const toolMsgs = history.filter((m) => m.role === "tool");
      const keyActions = toolMsgs
        .filter((m) => m.name && !["list_groups", "list_agents"].includes(m.name as string))
        .slice(-5)
        .map((m) => ({ tool: m.name, result: (m.content as string)?.slice(0, 100) }));

      const summary = assistantMsgs.map((m) => (m.content as string).slice(0, 200)).join(" ");
      const startTime = history[0]?.content ? new Date().toISOString() : null;

      await db.execute(
        sql`INSERT INTO session_archives (id, group_id, workspace_id, session_type, title, summary, key_decisions, start_time, end_time, archived_at)
            VALUES (${uuid()}, ${groupId}, ${workspaceId}, 'llm_turn', 'Auto archive', ${summary.slice(0, 2000)}, ${JSON.stringify(keyActions)}, ${startTime}, ${new Date()}, ${new Date()})`
      );
    } catch {
      // best-effort; table may not exist yet
    }
  }

  /**
   * Reset per-turn guardrail state. Called at the start of each runWithTools round.
   */
  private resetForTurn() {
    this.turnToolFailures.clear();
    this.exactFailureCount.clear();
    this.sameToolFailureCount.clear();
    this.memoryCache.clear();
    this._searchCountThisTurn = 0;
    this.pendingUserQuestion = false;
    // Cognitive Pipeline: reset per-turn tracking
    this.verificationToolsCalled.clear();
    this.codeModificationsThisTurn = false;
    this.codeModificationCount = 0;
    this.verificationHadErrors = false;
    this.verificationErrorSummary = "";
    this.verificationGateBlocks = 0;
  }

  private async runWithTools(input: {
    groupId: UUID;
    workspaceId: UUID;
    history: HistoryMessage[];
    hasHumanSender?: boolean; // when true, agent MUST reply to the human
    isPipeline?: boolean; // when true, pipeline mode: direct execution, no group messages
    isWorker?: boolean; // when true, agent is a Worker in an active workflow (cognitive pipeline)
  }) {
    const maxToolRounds = 10;
    let assistantText = "";
    let assistantThinking = "";
    let didSend = false;
    this.resetForTurn();

    // Trim history before LLM call: keep system msgs + last 30 conv msgs
    // Saves 70%+ token on each LLM call without losing relevant context.
    const systemMsgs = input.history.filter((m) => m.role === "system");
    const convMsgs = input.history.filter((m) => m.role !== "system");
    const MAX_HISTORY_MSGS = 30;
    if (convMsgs.length > MAX_HISTORY_MSGS) {
      input.history = [...systemMsgs, ...convMsgs.slice(-MAX_HISTORY_MSGS)];
    }

    for (let round = 0; round < maxToolRounds; round++) {
      const senderHint = input.isPipeline
        ? "Pipeline mode: execute the task directly. Mark PIPELINE_STAGE_COMPLETE and OUTPUT: when done."
        : input.hasHumanSender
        ? "Human waiting —fulfill request then confirm with send_group_message."
        : "No human input —stay silent unless meaningful reason to speak.";
      input.history.push({
        role: "system",
        content: `[turn ${round}] ${senderHint}. One action per message.`,
      });

      const res = await this.callLlmStreaming(input.history, {
        workspaceId: input.workspaceId,
        groupId: input.groupId,
        round,
      });
      assistantText = res.assistantText;
      assistantThinking = res.assistantThinking;

      if (res.toolCalls.length === 0) {
        return { assistantText, assistantThinking, didSend };
      }

      input.history.push({
        role: "assistant",
        content: res.assistantText,
        tool_calls: res.toolCalls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: JSON.stringify(safeJsonParse(c.argumentsText, {})) },
        })),
        reasoning_content: res.assistantThinking || undefined,
      });

      // Phase 1: Execute tool calls — parallel for non-bash tools, sequential when bash is present
      const hasBash = res.toolCalls.some((c) => c.name === "bash");

      type ToolExecItem = { call: ToolCall; callKey: string; isBlocked: boolean; isSend: boolean; result: unknown };
      let toolExecs: ToolExecItem[];

      const executeOne = async (call: ToolCall): Promise<{ callKey: string; isBlocked: boolean; isSend: boolean; result: unknown }> => {
        const callKey = call.name
          ? `${call.name}:${JSON.stringify(safeJsonParse(call.argumentsText, {}))}`
          : "";
        const isBlocked = !!(call.name && this.blockedTools.has(callKey));
        const isSend = !!(call.name && SEND_TOOL_NAMES.has(call.name));
        const result = isBlocked ? null : await this.executeToolCall({ groupId: input.groupId, call });
        return { callKey, isBlocked, isSend, result };
      };

      if (hasBash) {
        // Bash present — execute sequentially for safety (shell state must not overlap)
        toolExecs = [];
        for (const call of res.toolCalls) {
          const { callKey, isBlocked, isSend, result } = await executeOne(call);
          toolExecs.push({ call, callKey, isBlocked, isSend, result });
        }
      } else {
        // No bash — execute independent tools in parallel via allSettled
        const settled = await Promise.allSettled(res.toolCalls.map((call) => executeOne(call)));
        toolExecs = settled.map((s, i) => {
          if (s.status === "fulfilled") {
            return { call: res.toolCalls[i], ...s.value };
          }
          // Tool threw — surface error as result so Phase 2 guardrails still track it
          return {
            call: res.toolCalls[i],
            callKey: "",
            isBlocked: false,
            isSend: false,
            result: { ok: false, error: s.reason instanceof Error ? s.reason.message : String(s.reason) },
          };
        });
      }

      // Phase 2: Process results serially (guardrails, events, history)
      for (const { call, callKey, isBlocked, isSend, result } of toolExecs) {
        if (this.agentPaused) {
          input.history.push({
            role: "system",
            content: `Agent is paused due to repeated tool failures. Do not attempt further tool calls until the issue is resolved.`,
          });
          break;
        }
        if (isBlocked) {
          input.history.push({
            role: "system",
            content: `Tool "${call.name}" with these parameters has failed too many times and is blocked. Use different parameters or a different approach.`,
          });
          continue;
        }

        if (isSend) didSend = true;

        // Guardrails: track failures
        const toolOk = (result as Record<string, unknown> | undefined)?.ok !== false;
        if (!toolOk && call.name) {
          const prev = this.turnToolFailures.get(call.name) ?? 0;
          this.turnToolFailures.set(call.name, prev + 1);

          const exactPrev = this.exactFailureCount.get(callKey) ?? 0;
          this.exactFailureCount.set(callKey, exactPrev + 1);
          if (exactPrev + 1 >= 5) {
            this.blockedTools.add(callKey);
            console.warn(`[AgentRunner] blocked tool ${callKey} after 5 exact failures`);
          }

          const sameToolPrev = this.sameToolFailureCount.get(call.name) ?? 0;
          this.sameToolFailureCount.set(call.name, sameToolPrev + 1);
          if (sameToolPrev + 1 >= 8) {
            this.agentPaused = true;
            console.warn(`[AgentRunner] agent paused after 8 total failures of ${call.name}`);
          }
        }

        // Persist skill usage
        const ok = (result as Record<string, unknown> | undefined)?.ok ?? true;
        if (call.name) void this.recordSkillUsage(call.name, ok === true);

        // === Cognitive Pipeline: track verification & code modification tools ===
        if (call.name === "bash" && ok) {
          const bashArgs = safeJsonParse<{ command?: string }>(call.argumentsText, {});
          const cmd = (bashArgs.command ?? "").trim();
          // Track verification commands (tsc, vitest, jest, etc.)
          const verifyMatch = cmd.match(/\b(npx\s+tsc|npx\s+vitest|tsc|vitest|jest|npm\s+test|npm\s+run\s+test|next\s+build|npm\s+run\s+build)\b/);
          if (verifyMatch) {
            this.verificationToolsCalled.add(verifyMatch[1]);
            // Parse verification result for errors
            const resultStr = typeof result === "string" ? result : JSON.stringify(result);
            const isTsc = /\btsc\b/.test(cmd);
            const isVitest = /\bvitest\b|npm\s+(run\s+)?test\b/.test(cmd);
            if (isTsc) {
              // tsc: look for "error TS" or non-zero exit
              const tscErrors = resultStr.match(/error TS\d+/g);
              const exitCode = resultStr.match(/exit code[:\s]+(\d+)/i);
              if (tscErrors && tscErrors.length > 0) {
                this.verificationHadErrors = true;
                this.verificationErrorSummary = `tsc: ${tscErrors.length} type error(s) — ${tscErrors.slice(0, 3).join(", ")}${tscErrors.length > 3 ? "..." : ""}`;
              } else if (exitCode && parseInt(exitCode[1]) !== 0) {
                this.verificationHadErrors = true;
                this.verificationErrorSummary = `tsc: exited with code ${exitCode[1]}`;
              }
            }
            if (isVitest) {
              // vitest: look for failed tests
              const failedMatch = resultStr.match(/(\d+)\s*failed/);
              if (failedMatch && parseInt(failedMatch[1]) > 0) {
                this.verificationHadErrors = true;
                this.verificationErrorSummary = `vitest: ${failedMatch[1]} test(s) failed`;
              }
            }
          }
          // Track code-modifying operations
          if (/\b(sed\s+-i|tee\s|mkdir|npm\s+run\s+build|next\s+build)\b/.test(cmd) ||
              /\b(echo\s+.*>|cat\s+.*>|printf\s+.*>|>>)/.test(cmd)) {
            this.codeModificationsThisTurn = true;
            this.codeModificationCount++;
          }
        }
        // Track file writing/editing tools (MCP or built-in)
        if (call.name && (call.name === "write_file" || call.name === "edit_file" || call.name === "patch_file" || call.name === "create_backup")) {
          this.codeModificationsThisTurn = true;
          this.codeModificationCount++;
        }

        // Emit tool result event (streaming to UI)
        this.bus.emit(this.agentId, {
          event: "agent.stream",
          data: {
            kind: "tool_result",
            delta: JSON.stringify(result),
            tool_call_id: call.id,
            tool_call_name: call.name,
          },
        });
        void appendAgentStreamEvent({
          agentId: this.agentId,
          round,
          kind: "tool_result",
          delta: JSON.stringify(result),
          tool_call_id: call.id,
          tool_call_name: call.name,
        });

        // Push result to history (serialized, in order)
        const resultStr = JSON.stringify(result);
        const truncatedResult = resultStr.length > MAX_TOOL_RESULT_CHARS
          ? resultStr.slice(0, MAX_TOOL_RESULT_CHARS) + `\n...[truncated, ${resultStr.length - MAX_TOOL_RESULT_CHARS} chars omitted. Use more specific tool parameters or get_message_detail for full content.]`
          : resultStr;
        input.history.push({
          role: "tool",
          content: truncatedResult,
          tool_call_id: call.id,
          name: call.name,
        });

        // Context compression: when a task is done, trim old tool exchanges
        if ((result as Record<string, unknown> | undefined)?.taskDone === true) {
          try { compressHistory(input.history); } catch { /* best-effort */ }
          void this.autoCreateSkillFromWorkflow(input.groupId);
        }
      }

      // === Cognitive Pipeline Layer 2: Execution Plan Check ===
      // On first round, if Worker jumped into tools without outputting a plan, nudge for next round
      if (round === 0 && input.isWorker && res.toolCalls.length > 0) {
        const planIndicators = /\b(plan|steps?|approach|strategy|classify|task type|risk|complexity|assessment|will|going to)\b/i;
        const hasPlan = assistantText.length > 80 && planIndicators.test(assistantText);
        if (!hasPlan) {
          input.history.push({
            role: "system",
            content:
              `[Cognitive Pipeline — Plan Required]\n` +
              `You jumped into tool calls without outputting an execution plan. ` +
              `Before your next tool call, briefly state:\n` +
              `1. What you are trying to accomplish\n` +
              `2. The steps you will take\n` +
              `3. How you will verify success\n` +
              `This helps the coordinator review your approach before you invest effort.`,
          });
        }

        // === Decision Routing Check ===
        // If Worker assessed high risk/complex but used only execution tools (no ask_user, no send to coordinator),
        // nudge them to consider Clarify or Escalate paths
        const highRiskIndicators = /\b(high\s*(risk|complexity)|complex|risk\s*[:=]\s*high|dangerous|critical|5\+\s*files|database\s*migrat|db\s*migrat)\b/i;
        const assessedHighRisk = highRiskIndicators.test(assistantText);
        const hasCommTool = res.toolCalls.some((c) =>
          c.name === "ask_user" || c.name === "send_group_message" || c.name === "send_direct_message"
        );
        if (assessedHighRisk && !hasCommTool) {
          input.history.push({
            role: "system",
            content:
              `[Cognitive Pipeline — Decision Routing Alert]\n` +
              `Your assessment indicates high risk or complexity, but you jumped directly into execution tools.\n` +
              `Consider your decision route:\n` +
              `- **Clarify**: If requirements are ambiguous, call ask_user or send_group_message to coordinator.\n` +
              `- **Escalate**: If risk is high (DB migration, 5+ files, irreversible ops), send_group_message to coordinator explaining concerns and wait for guidance.\n` +
              `Only choose **Direct** if you are confident the task is well-defined and within your role scope.`,
          });
        }
      }

      // === Cognitive Pipeline: Proactive Verification Loop ===
      // (a) After 3+ code modifications without verification, nudge agent to run checks now
      if (input.isWorker && this.codeModificationCount >= 3 && this.verificationToolsCalled.size === 0) {
        input.history.push({
          role: "system",
          content:
            `[Verification Reminder] You have made ${this.codeModificationCount} code modifications without running any verification.\n` +
            `Please run verification now before continuing:\n` +
            `1. bash({ command: "npx tsc --noEmit" }) — type check\n` +
            `2. bash({ command: "npx vitest run" }) — unit tests\n` +
            `Fix any failures before making more changes.`,
        });
      }
      // (b) Verification was run but had errors — block further tool calls until fixed
      if (this.verificationHadErrors && this.verificationErrorSummary) {
        input.history.push({
          role: "system",
          content:
            `[Verification Failed — Fix Required]\n` +
            `${this.verificationErrorSummary}\n` +
            `You MUST fix these errors before continuing with more changes or reporting completion.\n` +
            `Do NOT make additional code modifications until the above errors are resolved.\n` +
            `After fixing, re-run the verification command to confirm the fix.`,
        });
        // Reset so we don't keep injecting on subsequent rounds if agent fixes it
        this.verificationHadErrors = false;
        this.verificationErrorSummary = "";
      }

      // ask_user pause check: if agent sent a structured question, stop the loop
      if (this.pendingUserQuestion) {
        this.pendingUserQuestion = false;
        input.history.push({
          role: "system",
          content: "[System] 你向用户提了一个问题，正在等待回复。停止生成，用户回复后会继续。",
        });
        return { assistantText, assistantThinking, didSend };
      }

      // Inject failure alert when a tool keeps failing — triggers agent self-learning
      for (const [toolName, count] of this.turnToolFailures) {
        if (count >= 3) {
          const bt = "`";
          input.history.push({
            role: "system",
            content:
              `Tool "${toolName}" has failed ${count} times in this turn. Your current approach is not working. Options:\n` +
              `1. Call ${bt}search_skill("<problem domain>")${bt} to search GitHub for relevant skills\n` +
              `2. Call ${bt}get_skill("<name>")${bt} to load an existing local skill\n` +
              `3. Call ${bt}install_skill("<name>", "<source_url>")${bt} to install a remote skill\n` +
              `4. Call ${bt}create_skill${bt} to document a new fix pattern\n` +
              `5. Try a completely different approach`,
          });
          break;
        }
      }

      // 3-round output nudge: prevent silent exploration without reply
      if ((round + 1) % 3 === 0 && round < maxToolRounds - 1) {
        const nudgeMsg = input.hasHumanSender
          ? `[System] You have completed ${round + 1} tool rounds without producing a user-visible reply. You MUST call send_group_message NOW with your current findings or analysis. Do NOT make more tool calls without replying first.`
          : `[System] You have completed ${round + 1} tool rounds. Summarize your progress via send_group_message before continuing.`;
        input.history.push({
          role: "system",
          content: nudgeMsg,
        });
      }

    }

    // Nudge Engine: trigger periodic background analysis after tool loop completes
    this.nudgeCounter++;
    if (this.nudgeCounter >= NUDGE_INTERVAL) {
      this.nudgeCounter = 0;
      void this.nudgeAnalysis(input.groupId);
      void this.skillMaintenance();
    }

    // Force reply: if human was waiting and agent never sent anything, auto-send
    if (input.hasHumanSender && !didSend) {
      const fallbackText = assistantText || assistantThinking || "(Agent completed analysis but did not generate a response)";
      try {
        await store.sendMessage({
          groupId: input.groupId,
          senderId: this.agentId,
          content: fallbackText,
          contentType: "text",
        });
        didSend = true;
        console.warn(`[AgentRunner] forced reply for ${this.agentId.slice(0, 8)}: loop ended without send_group_message`);
      } catch (err) {
        console.error(`[AgentRunner] failed to force reply:`, err);
      }
    }

    return { assistantText, assistantThinking, didSend };
  }

  /**
   * Process a pipeline instruction directly (Phase 1 - deterministic execution).
   * Unlike processGroupUnread, this uses the pipeline instruction as the user message
   * and does NOT rely on group messages. Results are captured via the agent history.
   */
  private async processPipelineInstruction(groupId: UUID, instruction: string) {
    console.info(`[processPipelineInstruction] agent=${this.agentId.slice(0,8)} stage="${this.pipelineContext?.stageName}"`);
    try {
      const workspaceId = await store.getGroupWorkspaceId({ groupId });
      const agent = await store.getAgent({ agentId: this.agentId });
      const history = safeJsonParse<HistoryMessage[]>(agent.llmHistory, []);

      // Inject pipeline instruction as user message
      history.push({
        role: "user",
        content: instruction,
      });

      // Save updated history
      await store.setAgentHistory({ agentId: this.agentId, llmHistory: JSON.stringify(history), workspaceId });

      // Call LLM with tools (same as normal flow but pipeline context)
      const result = await this.runWithTools({
        groupId,
        workspaceId,
        history,
        hasHumanSender: false, // pipeline mode: no human waiting
        isPipeline: true,
      });

      // Update history with assistant response
      history.push({
        role: "assistant",
        content: result.assistantText,
        reasoning_content: result.assistantThinking || undefined,
      });
      await store.setAgentHistory({ agentId: this.agentId, llmHistory: JSON.stringify(history), workspaceId });

      // Emit pipeline completion event
      this.bus.emit(this.agentId, {
        event: "pipeline.stage_done",
        data: {
          agentId: this.agentId,
          groupId,
          stageName: this.pipelineContext?.stageName,
          output: result.assistantText.slice(0, 3000),
        },
      });

      console.info(`[processPipelineInstruction] done output=${result.assistantText.slice(0, 100)}...`);
    } catch (err) {
      // Pipeline stage failed — emit error so waitForStageCompletion can exit immediately
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[processPipelineInstruction] failed: ${msg}`);
      this.bus.emit(this.agentId, {
        event: "agent.error",
        data: { agentId: this.agentId, message: msg },
      });
      throw err; // re-throw so processUntilIdle catches it too
    }
  }

  /**
   * Auto-create a skill when all tasks in a workflow are complete.
   * Best-effort —failures are silently ignored.
   * Triggered after update_task returns taskDone === true.
   */
  private async autoCreateSkillFromWorkflow(groupId: UUID) {
    try {
      const db = getDb();

      // Find active workflow for this group
      const wfRows = await db.execute(
        sql`SELECT id, name, description FROM workflows WHERE group_id = ${groupId} AND status IN ('active', 'paused') ORDER BY updated_at DESC LIMIT 1`
      );
      const wfArr = wfRows as unknown as Array<{ id: string; name: string; description: string | null }>;
      if (wfArr.length === 0) return;
      const wf = wfArr[0];

      // Check if all tasks are in terminal state
      const taskRows = await db.execute(
        sql`SELECT status, result, name FROM tasks WHERE workflow_id = ${wf.id}`
      );
      const tasks = taskRows as unknown as Array<{ status: string; result: string | null; name: string }>;
      if (tasks.length === 0) return;

      const terminalStates = new Set(["done", "approved", "blocked", "failed"]);
      const allDone = tasks.every((t) => terminalStates.has(t.status));
      if (!allDone) return;

      // Daily auto-skill limit: max 3 per agent
      const today = new Date().toISOString().slice(0, 10);
      const usageRows = await db.execute(
        sql`SELECT COUNT(*) as cnt FROM skill_usage WHERE agent_id = ${this.agentId} AND used_at >= ${today} AND skill_name LIKE 'auto-%'`
      );
      const usageArr = usageRows as unknown as Array<{ cnt: number }>;
      if (usageArr.length > 0 && Number(usageArr[0].cnt) >= 3) return;

      // Generate skill name from workflow name
      const wfName = wf.name.trim();
      const skillName = `auto-${wfName.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-").replace(/^-|-$/g, "").slice(0, 60)}`;

      const doneTasks = tasks.filter((t) => t.status === "done" || t.status === "approved");
      if (doneTasks.length === 0) return;

      const taskSummaries = doneTasks
        .map((t) => {
          const resultPreview = (t.result ?? "").slice(0, 300);
          return `- **${t.name}**: ${resultPreview || "(no result recorded)"}`;
        })
        .join("\n");

      const totalTasks = tasks.length;
      const successCount = doneTasks.length;
      const skillDescription = `Auto-generated skill from workflow "${wfName}" (${successCount}/${totalTasks} tasks successful)`;
      const skillContent = [
        `# ${wfName}`,
        "",
        "## Overview",
        "",
        `Workflow completed with ${successCount}/${totalTasks} tasks successful.`,
        "",
        "## Tasks",
        "",
        taskSummaries,
        "",
        "## Notes",
        "",
        "- This skill was auto-generated from a completed workflow.",
        "- Review and update the content for reusability.",
      ].join("\n");

      // === Approval Gate: store as proposal instead of direct execution ===
      AgentRunner._pendingProposals.set(this.agentId, {
        action: "create",
        skillName,
        skillDescription: skillDescription.slice(0, 200),
        skillContent,
        createdAt: new Date().toISOString(),
        source: "workflow",
      });
      console.info(`[autoCreateSkillFromWorkflow] stored CREATE proposal for "${skillName}" (pending user approval)`);
    } catch {
      // best-effort — workflow skill proposals should never block the agent
    }
  }

  /**
   * Nudge Engine: full LLM-based background analysis of recent conversation.
   * Runs every NUDGE_INTERVAL rounds. Fire-and-forget —never blocks the agent.
   *
   * Sends recent history to the primary LLM provider for semantic analysis,
   * asking it to identify reusable patterns, fix recipes, and improvement
   * suggestions. Creates skills from the LLM's recommendations.
   */
  private async nudgeAnalysis(groupId: UUID) {
    try {
      const agent = await store.getAgent({ agentId: this.agentId });
      const parsed = safeJsonParse<unknown>(agent.llmHistory, {});
      const history = Array.isArray(parsed) ? (parsed as HistoryMessage[]) : [];
      if (history.length < 6) return;

      // Check daily limit (shared with autoCreateSkillFromWorkflow)
      const db = getDb();
      const today = new Date().toISOString().slice(0, 10);
      const usageRows = await db.execute(
        sql`SELECT COUNT(*) as cnt FROM skill_usage WHERE agent_id = ${this.agentId} AND used_at >= ${today} AND skill_name LIKE 'auto-%'`
      );
      const usageArr = usageRows as unknown as Array<{ cnt: number }>;
      const usedToday = usageArr.length > 0 ? Number(usageArr[0].cnt) : 0;
      if (usedToday >= MAX_AUTO_SKILLS_PER_AGENT_PER_DAY) {
        // Still try patching: patching reuses existing skill_usage slot
        // Only skip if usedToday >= limit AND there's nothing to patch
      }

      // Discover existing skills for potential patching
      const { getSkillLoader } = await import("./skill-loader");
      const skillLoader = await getSkillLoader();
      const existingSkills = await skillLoader.listAutoLoadSkills();
      const existingSkillsBlock = existingSkills.length > 0
        ? `\nExisting skills available for patching:\n${existingSkills.map((s) => `  - ${s.name}: ${s.description}`).join("\n")}\n\nIf the detected pattern relates to an existing skill, set action to "patch" and skillName to the existing skill's name. The full content will be replaced with your skillContent.`
        : "";

      // Build a condensed view of recent history for the LLM
      const recentHistory = history.slice(-30);
      const historySummary = recentHistory.map((m) => {
        const role = m.role;
        const name = "name" in m && m.name ? `(${m.name})` : "";
        let content: string;
        if (typeof m.content === "string") {
          content = m.content.slice(0, 300);
        } else if (m.content && typeof m.content === "object") {
          content = JSON.stringify(m.content).slice(0, 300);
        } else {
          content = "";
        }
        const toolCalls = m.role !== "tool" && m.tool_calls
          ? (m.tool_calls as Array<{ function: { name: string } }>).map((tc) => tc.function.name).join(", ")
          : "";
        return `[${role}]${name} ${content}${toolCalls ? ` | calls: ${toolCalls}` : ""}`;
      }).join("\n");

      const systemPrompt = [
        "You are analyzing an AI agent conversation to find reusable patterns. Your task:",
        "",
        "1. Identify tool failures that were later resolved (valuable fix recipes)",
        "2. Identify repeated successful tool usage patterns (potential automation)",
        "3. Identify any other reusable knowledge (workflow steps, debugging tricks)",
        "",
        "Respond with a JSON object only (no markdown, no extra text):",
        JSON.stringify({
          hasPattern: false,
          action: "create", // "create" for new skill, "patch" to update existing, null if no pattern
          skillName: "kebab-case-name-or-null",
          skillDescription: "one-line summary or null",
          skillContent: "full markdown content or null",
          patchSummary: "what changed or null",
        }),
        "",
        "Only set hasPattern=true if you found a genuinely reusable pattern.",
        "skillContent should be concise, actionable markdown (< 1000 chars).",
        'When action is "patch", skillName must match an existing skill name exactly.',
        'When action is "patch", the existing skill\'s SKILL.md will be fully replaced with your skillContent.',
        "Prefer patching an existing skill over creating a new one when the pattern relates to known knowledge.",
        'If no pattern found, respond with {"hasPattern":false}.',
        existingSkillsBlock,
      ].join("\n");

      // Make non-streaming LLM call through the global rate limiter (llmScheduler)
      const provider = getLlmProvider();
      let url: string;
      let apiKey: string;
      let model: string;
      let backupModel: string;
      let keyPool: KeyPool | null = null;

      switch (provider) {
        case "openrouter": {
          const cfg = getOpenRouterConfig();
          url = cfg.baseUrl;
          apiKey = cfg.apiKey;
          model = cfg.model || "google/gemini-2.0-flash-001";
          backupModel = cfg.backupModel;
          keyPool = cfg.keyPool;
          break;
        }
        case "anthropic": {
          const cfg = getAnthropicConfig();
          url = cfg.baseUrl || "https://api.anthropic.com/v1/messages";
          apiKey = cfg.apiKey;
          model = cfg.model;
          backupModel = cfg.backupModel;
          keyPool = cfg.keyPool;
          break;
        }
        case "glm": {
          const cfg = getGlmConfig();
          url = cfg.baseUrl;
          apiKey = cfg.apiKey;
          model = cfg.model;
          backupModel = cfg.backupModel;
          keyPool = cfg.keyPool;
          break;
        }
        case "ollama": {
          const cfg = getOllamaConfig();
          url = cfg.baseUrl;
          apiKey = "";
          model = cfg.model;
          backupModel = cfg.backupModel;
          break;
        }
        default:
          return;
      }

      const nudgeOpts = { backupModel, keyPool: keyPool ?? undefined };

      // Anthropic uses a different non-OpenAI format; use OpenAI-compatible for all others
      let respText: string;
      if (provider === "anthropic") {
        const resp = await llmFetch(url, {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            max_tokens: 2048,
            system: systemPrompt,
            messages: [{ role: "user", content: historySummary }],
          }),
        }, "Nudge-Anthropic", nudgeOpts);
        if (!resp.ok) return;
        const data = await resp.json() as { content?: Array<{ text?: string }> };
        respText = data.content?.[0]?.text ?? "";
      } else {
        // OpenAI-compatible (OpenRouter, GLM, Ollama)
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

        const resp = await llmFetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: historySummary },
            ],
            temperature: 0.1,
            max_tokens: 2048,
            stream: false,
          }),
        }, "Nudge", nudgeOpts);
        if (!resp.ok) return;
        const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
        respText = data.choices?.[0]?.message?.content ?? "";
      }

      if (!respText) return;

      // Parse structured response
      const result = safeJsonParse(respText, null) as {
        hasPattern?: boolean;
        action?: "create" | "patch";
        skillName?: string | null;
        skillDescription?: string | null;
        skillContent?: string | null;
        patchSummary?: string | null;
      } | null;

      if (!result || !result.hasPattern || !result.skillContent) return;

      const action = result.action === "patch" ? "patch" : "create";

      // === Approval Gate: store as proposal instead of direct execution ===
      // The agent will be notified and must get user confirmation before creating/patching.
      if (action === "patch") {
        const existingSkill = existingSkills.find((s) => s.name === result.skillName);
        if (existingSkill) {
          AgentRunner._pendingProposals.set(this.agentId, {
            action: "patch",
            skillName: existingSkill.name,
            skillDescription: (result.skillDescription ?? existingSkill.description).slice(0, 200),
            skillContent: result.skillContent,
            createdAt: new Date().toISOString(),
            source: "nudge",
          });
          console.info(`[nudgeAnalysis] stored PATCH proposal for "${existingSkill.name}" (pending user approval)`);
          return;
        }
        // Skill not found — fall through to create proposal
      }

      // Create proposal (default, or fallback from failed patch)
      const skillName = `auto-nudge-${(result.skillName ?? "pattern")
        .toLowerCase()
        .replace(/[^a-z0-9一-龥]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 60)}`;

      if (usedToday >= MAX_AUTO_SKILLS_PER_AGENT_PER_DAY) return;

      AgentRunner._pendingProposals.set(this.agentId, {
        action: "create",
        skillName,
        skillDescription: (result.skillDescription ?? "Auto-generated skill from nudge analysis").slice(0, 200),
        skillContent: result.skillContent,
        createdAt: new Date().toISOString(),
        source: "nudge",
      });
      console.info(`[nudgeAnalysis] stored CREATE proposal for "${skillName}" (pending user approval)`);

      // ── Skill Auto-Discovery (A-05): emit suggestions via UI bus ──
      // Runs after the existing LLM-based nudge analysis. Non-blocking, best-effort.
      const suggestions = analyzeForSkillSuggestions(history);
      if (suggestions.length > 0) {
        const workspaceId = await store.getGroupWorkspaceId({ groupId });
        for (const s of suggestions) {
          getWorkspaceUIBus().emit(workspaceId, {
            event: "ui.skill.suggestion",
            data: {
              workspaceId,
              agentId: this.agentId,
              groupId,
              skillName: s.skillName,
              confidence: s.confidence,
              reason: s.reason,
              triggerPattern: s.triggerPattern,
            },
          });
        }
        console.info(`[nudgeAnalysis] emitted ${suggestions.length} skill suggestion(s) for agent ${this.agentId.slice(0, 8)}`);
      }
    } catch {
      // best-effort —nudge analysis should never block the agent
    }
  }

  /**
   * Skill lifecycle maintenance: detect stale skills, archive old ones,
   * and merge duplicates. Runs once per nudge cycle as best-effort.
   * (design doc 搂11.4 —skill lifecycle)
   */
  private async skillMaintenance() {
    try {
      const { getSkillLoader, getSkillDirectory, invalidateSkillCache } = await import("./skill-loader");
      const db = getDb();
      const loader = await getSkillLoader();
      const allSkills = await loader.listAutoLoadSkills();
      if (allSkills.length === 0) return;

      const now = new Date();
      const staleThreshold = new Date(now.getTime() - SKILL_STALE_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const archiveThreshold = new Date(now.getTime() - SKILL_ARCHIVE_DAYS * 24 * 60 * 60 * 1000).toISOString();

      // Query last usage date for each skill
      const skillNames = allSkills.map(s => s.name);
      const rows = await db.execute(
        sql`SELECT skill_name, MAX(used_at) as last_used FROM skill_usage WHERE skill_name = ANY(${skillNames}) GROUP BY skill_name`
      );
      const lastUsageMap = new Map<string, string>();
      for (const row of rows as Array<Record<string, unknown>>) {
        lastUsageMap.set(row.skill_name as string, row.last_used as string);
      }

      for (const skill of allSkills) {
        // Check for `patched` date in frontmatter as fallback
        const patchedDate = skill.metadata?.patched as string | undefined;
        const lastUsed = lastUsageMap.get(skill.name) ?? patchedDate ?? null;

        if (!lastUsed) continue;

        // Archive: no usage in 90 days
        if (lastUsed < archiveThreshold) {
          const archivedDir = path.join(getSkillDirectory(), `_archived-${skill.name}`);
          try {
            await fs.rename(skill.skillDir, archivedDir);
            await db.execute(
              sql`UPDATE skill_usage SET status = 'archived' WHERE skill_name = ${skill.name} AND status != 'archived'`
            );
            console.info(`[skillMaintenance] archived skill "${skill.name}" (last used ${lastUsed.slice(0, 10)})`);
          } catch {
            // best-effort —skill archiving should not break anything
          }
          invalidateSkillCache();
        }
        // Stale: no usage in 30 days —add usage hint for future nudge analysis
        else if (lastUsed < staleThreshold) {
          console.info(`[skillMaintenance] skill "${skill.name}" is stale (last used ${lastUsed.slice(0, 10)}) —consider merging or removing`);
        }
      }

      // Dedup: find skills with overlapping descriptions
      const descs = allSkills.map(s => ({ name: s.name, desc: (s.description ?? "").toLowerCase() }));
      for (let i = 0; i < descs.length; i++) {
        for (let j = i + 1; j < descs.length; j++) {
          const a = descs[i];
          const b = descs[j];
          if (!a.desc || !b.desc) continue;
          // Simple word overlap check
          const aWords = new Set(a.desc.split(/\s+/));
          const bWords = new Set(b.desc.split(/\s+/));
          const overlap = [...aWords].filter(w => bWords.has(w)).length;
          const union = new Set([...aWords, ...bWords]).size;
          if (union > 3 && overlap / union >= SKILL_MERGE_SIMILARITY) {
            console.info(`[skillMaintenance] potential duplicate skills: "${a.name}" and "${b.name}" —consider merging`);
          }
        }
      }
    } catch {
      // best-effort —skill maintenance should never block the agent
    }
  }

  /**
   * Per-turn file-mutation verifier: after a file-write tool call,
   * read back the target file to confirm it actually exists and has content.
   * Best-effort —failures are logged, not surfaced to the agent.
   * (design doc 搂11.5)
   */
  private async verifyFileMutation(args: Record<string, unknown>, resultContent: string) {
    try {
      // Extract file path from common argument patterns
      const filePath = (args.file_path ?? args.path ?? args.filename ?? args.filePath ?? "") as string;
      if (!filePath || typeof filePath !== "string") return;

      const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
      const stat = await fs.stat(resolved).catch(() => null);
      if (!stat?.isFile()) {
        console.warn(`[verifyFileMutation] file not found after write: ${filePath}`);
        return;
      }
      // Verify file is not empty
      if (stat.size === 0) {
        console.warn(`[verifyFileMutation] file is empty after write: ${filePath}`);
        return;
      }
      // Log successful verification
      console.info(`[verifyFileMutation] verified: ${filePath} (${stat.size} bytes)`);
    } catch {
      // best-effort
    }
  }

  /**
   * Build a memory snapshot —top N important memories frozen at session start.
   * Injected as a system message to stabilize prompt caching.
   * Best-effort —returns null on failure or if no memories exist.
   */
  private async buildMemorySnapshot(): Promise<string | null> {
    try {
      const db = getDb();

      const rows = await db.execute(
        sql`SELECT content, importance, source FROM memories WHERE agent_id = ${this.agentId} ORDER BY importance DESC, created_at DESC LIMIT 20`
      ) as unknown as Array<{ content: string; importance: number | null; source: string | null }>;

      if (!rows || rows.length === 0) return null;

      const lines = rows.map((r, i) => {
        const imp = r.importance ?? 3;
        const source = r.source ? ` (source: ${r.source})` : "";
        return `${i + 1}. [${"#".repeat(Math.min(5, imp))}${"-".repeat(5 - Math.min(5, imp))}] ${r.content}${source}`;
      });

      return [
        "## Memory Snapshot (session start)",
        "",
        "Key facts from prior sessions, ordered by importance:",
        "",
        ...lines,
        "",
        "---",
      ].join("\n");
    } catch {
      return null; // best-effort
    }
  }

  /**
   * Resolve an array of agent identifiers to UUIDs.
   * Values that are already valid UUIDs pass through unchanged.
   * Non-UUID values are looked up by agent role in the given agent list.
   * Unresolvable values are silently dropped.
   */
  private resolveAgentIds(
    ids: string[],
    agents: Array<{ id: UUID; role: string }>
  ): UUID[] {
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const validUuids = new Set<UUID>(agents.map((a) => a.id));
    const roleIndex = new Map<string, UUID>();
    for (const a of agents) {
      if (!roleIndex.has(a.role)) {
        roleIndex.set(a.role, a.id);
      }
    }
    const result: UUID[] = [];
    for (const id of ids) {
      if (uuidRe.test(id) && validUuids.has(id)) {
        result.push(id);
      } else {
        const uuid = roleIndex.get(id);
        if (uuid) result.push(uuid);
      }
    }
    return result;
  }

  /**
   * Record a skill/tool usage for self-evolution tracking.
   * Best-effort —failures are silently ignored.
   */
  private async recordSkillUsage(skillName: string, success: boolean) {
    try {
      const db = getDb();
      await db.execute(
        sql`INSERT INTO skill_usage (id, skill_name, agent_id, success, used_at)
            VALUES (gen_random_uuid(), ${skillName}, ${this.agentId}, ${success}, ${new Date()})`
      );
    } catch {
      // best-effort; table may not exist yet in fresh databases
    }
  }

  /**
   * Evaluate all skills based on usage history and classify them into tiers.
   * Bayesian smoothed scoring: score = (success + 1) / (total + 2)
   * Tiers: >90% excellent, 70-90% good, 30-70% needs_improve, <30% deprecated
   * Design doc 搂11.4 skill evolution loop.
   */
  private async evaluateSkills() {
    try {
      const db = getDb();

      // Aggregate success/failure per skill
      const rows = await db.execute(
        sql`SELECT skill_name,
                   COUNT(*) FILTER (WHERE success = true) as success_count,
                   COUNT(*) FILTER (WHERE success = false) as failure_count
            FROM skill_usage
            GROUP BY skill_name`
      );

      const skillStats = rows as Array<Record<string, unknown>>;
      for (const row of skillStats) {
        const skillName = row.skill_name as string;
        const successCount = Number(row.success_count ?? 0);
        const failureCount = Number(row.failure_count ?? 0);
        const total = successCount + failureCount;
        if (total === 0) continue;

        // Bayesian smoothing
        const score = (successCount + 1) / (total + 2);
        const percentage = score * 100;

        let newStatus: string;
        if (percentage > 90) {
          newStatus = "active";
        } else if (percentage >= 70) {
          newStatus = "active";
        } else if (percentage >= 30) {
          newStatus = "improving";
        } else {
          newStatus = "deprecated";
        }

        // Update status for this agent's records
        await db.execute(
          sql`UPDATE skill_usage SET status = ${newStatus}
              WHERE skill_name = ${skillName} AND status = 'active' AND agent_id = ${this.agentId}`
        );
      }
    } catch {
      // best-effort; table may not exist
    }
  }

  private async executeToolCall(input: { groupId: UUID; call: ToolCall }) {
    const name = input.call.name ?? "";
    const workspaceId = await store.getGroupWorkspaceId({ groupId: input.groupId });
    const toolMeta = { toolCallId: input.call.id, toolName: input.call.name };

    getWorkspaceUIBus().emit(workspaceId, {
      event: "ui.agent.tool_call.start",
      data: {
        workspaceId,
        agentId: this.agentId,
        groupId: input.groupId,
        toolCallId: toolMeta.toolCallId,
        toolName: toolMeta.toolName,
      },
    });

    const emitToolDone = (ok: boolean) => {
      getWorkspaceUIBus().emit(workspaceId, {
        event: "ui.agent.tool_call.done",
        data: {
          workspaceId,
          agentId: this.agentId,
          groupId: input.groupId,
          toolCallId: toolMeta.toolCallId,
          toolName: toolMeta.toolName,
          ok,
        },
      });
    };

    // check_fn: if tool is filtered by availability, return clear error
    if (this.toolContext) {
      const check = TOOL_AVAILABILITY[name];
      if (check && !check(this.toolContext)) {
        emitToolDone(false);
        return { ok: false, error: `Tool "${name}" is not available in the current context.` };
      }
    }

    if (name === "self") {
      const role = await store.getAgentRole({ agentId: this.agentId }).catch(() => null);
      emitToolDone(true);
      return { ok: true, agentId: this.agentId, workspaceId, role };
    }

    if (name === "get_skill") {
      const args = safeJsonParse<{ skill_name?: string; name?: string }>(
        input.call.argumentsText,
        {}
      );
      const skillName = (args.skill_name ?? args.name ?? "").trim();
      if (!skillName) {
        emitToolDone(false);
        return { ok: false, error: "Missing skill_name" };
      }

      const loader = await getSkillLoader();
      const skill = await loader.getSkill(skillName);
      if (!skill) {
        emitToolDone(false);
        return { ok: false, error: `Unknown skill: ${skillName}`, available: await loader.listSkills() };
      }

      emitToolDone(true);
      return { ok: true, content: formatSkillPrompt(skill) };
    }

    if (name === "create_skill") {
      const args = safeJsonParse<{
        name?: string;
        description?: string;
        content?: string;
        autoLoad?: boolean;
        roles?: string[];
        requires?: string[];
      }>(input.call.argumentsText, {});
      const skillName = (args.name ?? "").trim();
      const description = (args.description ?? "").trim();
      const content = (args.content ?? "").trim();
      if (!skillName || !description || !content) {
        emitToolDone(false);
        return { ok: false, error: "Missing required fields: name, description, content" };
      }

      // Frequency limit: max 3 skills per day per agent (design doc 搂11.4)
      try {
        const db = getDb();
        const rows = await db.execute(
          sql`SELECT COUNT(*) as cnt FROM skill_usage WHERE agent_id = ${this.agentId} AND used_at >= NOW() - INTERVAL '24 hours'`
        );
        const count = (rows as Array<Record<string, unknown>>)[0]?.cnt as number;
        if (count >= 3) {
          emitToolDone(false);
          return { ok: false, error: "Daily skill creation limit reached (3 per day). Try again tomorrow." };
        }
      } catch {
        // best-effort; table may not exist —proceed without limit
      }

      const skillsDir = getSkillDirectory();
      const skillDir = path.join(skillsDir, skillName);

      try {
        // Conflict detection: check if skill already exists
        const existing = await fs.stat(skillDir).catch(() => null);
        if (existing?.isDirectory()) {
          // Mark conflict in skill_usage table
          try {
            const db = getDb();
            await db.execute(
              sql`INSERT INTO skill_usage (id, skill_name, agent_id, success, used_at, status)
                  VALUES (gen_random_uuid(), ${skillName}, ${this.agentId}, false, ${new Date().toISOString()}, 'conflict')`
            );
          } catch {
            // best-effort
          }
          emitToolDone(false);
          return { ok: false, error: `Skill "${skillName}" already exists. Status: conflict. Use a different name or update the existing skill.`, conflict: true };
        }

        await fs.mkdir(skillDir, { recursive: true });
        const frontmatter = [
          "---",
          `name: ${skillName}`,
          `description: ${description}`,
          args.autoLoad ? "auto-load: true" : "",
          args.roles && args.roles.length > 0 ? `metadata:\n  roles: [${args.roles.join(", ")}]` : "",
          args.requires && args.requires.length > 0 ? `requires: [${args.requires.join(", ")}]` : "",
          "---",
          "",
          content,
        ].filter(Boolean).join("\n");

        await fs.writeFile(path.join(skillDir, "SKILL.md"), frontmatter, "utf-8");
        invalidateSkillCache();

        emitToolDone(true);
        return { ok: true, path: path.join(skillDir, "SKILL.md") };
      } catch (err: unknown) {
        emitToolDone(false);
        return { ok: false, error: err instanceof Error ? err.message : "Failed to create skill" };
      }
    }

    // -----------------------------------------------------------------------
    // search_skill: GitHub code search for SKILL.md files
    // -----------------------------------------------------------------------
    if (name === "search_skill") {
      const args = safeJsonParse<{ query?: string; maxResults?: number }>(
        input.call.argumentsText, {}
      );
      const query = (args.query ?? "").trim();
      if (!query) {
        emitToolDone(false);
        return { ok: false, error: "Missing query parameter" };
      }

      const maxResults = Math.min(args.maxResults ?? 5, 10);

      // Guard: prevent infinite search loops within a single tool turn
      if (this._searchCountThisTurn >= 2) {
        emitToolDone(false);
        return { ok: false, error: "search_skill has been called too many times this turn. Try a different approach or use install_skill with a known source." };
      }
      this._searchCountThisTurn++;

      // Guard: cache same query within 5 minutes
      const cacheKey = query.toLowerCase();
      const now = Date.now();
      const CACHE_TTL = 5 * 60 * 1000;
      const lastSearch = AgentRunner._searchCache.get(cacheKey);
      if (lastSearch && (now - lastSearch.ts) < CACHE_TTL) {
        emitToolDone(true);
        return { ok: true, results: lastSearch.results, cached: true };
      }

      try {
        const results = await searchGitHubSkills(query, maxResults);
        // Cache the result with eviction
        AgentRunner._searchCache.set(cacheKey, { results, ts: now });
        // Evict oldest entries if cache exceeds max size
        if (AgentRunner._searchCache.size > AgentRunner._SEARCH_CACHE_MAX) {
          const entries = [...AgentRunner._searchCache.entries()];
          entries.sort((a, b) => a[1].ts - b[1].ts);
          const toRemove = entries.slice(0, Math.floor(entries.length / 2));
          for (const [key] of toRemove) AgentRunner._searchCache.delete(key);
        }

        emitToolDone(true);
        return { ok: true, results, count: results.length };
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        // GitHub API rate limit or network error →fallback to local skills
        if (errMsg.includes("403") || errMsg.includes("429") || errMsg.includes("rate")) {
          const localResults = await searchLocalSkills(query);
          emitToolDone(true);
          return { ok: true, results: localResults, count: localResults.length, fallback: "GitHub API rate limited, showing local skills" };
        }
        emitToolDone(false);
        return { ok: false, error: `search_skill failed: ${errMsg.slice(0, 200)}` };
      }
    }

    // -----------------------------------------------------------------------
    // install_skill: Download and install a skill from GitHub
    // -----------------------------------------------------------------------
    if (name === "install_skill") {
      const args = safeJsonParse<{ name?: string; source_url?: string }>(
        input.call.argumentsText, {}
      );
      const skillName = (args.name ?? "").trim();
      const sourceUrl = (args.source_url ?? "").trim();
      if (!skillName || !sourceUrl) {
        emitToolDone(false);
        return { ok: false, error: "Missing required fields: name, source_url" };
      }

      // Validate skill name: only alphanumeric, hyphens, underscores
      if (!/^[a-z0-9_-]+$/.test(skillName)) {
        emitToolDone(false);
        return { ok: false, error: "Invalid skill name. Only lowercase letters, numbers, hyphens, and underscores allowed." };
      }

      // Validate URL: must be a GitHub URL
      if (!sourceUrl.startsWith("https://github.com") && !sourceUrl.startsWith("https://raw.githubusercontent.com")) {
        emitToolDone(false);
        return { ok: false, error: "source_url must be a GitHub URL (github.com or raw.githubusercontent.com)" };
      }

      // Check if already installed
      const skillsDir = getSkillDirectory();
      const skillDir = path.join(skillsDir, skillName);
      if (existsSync(skillDir)) {
        emitToolDone(true);
        return { ok: true, message: `Skill "${skillName}" is already installed at ${skillDir}`, skip: true };
      }

      try {
        // Download SKILL.md
        const rawUrl = toRawGitHubUrl(sourceUrl);
        const skillContent = await fetchSkillContent(rawUrl);

        // Validate YAML frontmatter
        const frontmatterMatch = skillContent.match(FRONTMATTER_RE);
        if (!frontmatterMatch) {
          emitToolDone(false);
          return { ok: false, error: "Invalid skill file: missing YAML frontmatter" };
        }
        const frontmatter = parseFrontmatter(frontmatterMatch[1]);
        if (!frontmatter || !frontmatter.name || !frontmatter.description) {
          emitToolDone(false);
          return { ok: false, error: "Invalid skill file: missing name or description in frontmatter" };
        }

        // Security scan: reject dangerous content
        const scanResult = scanSkillContent(skillContent);
        if (!scanResult.ok) {
          emitToolDone(false);
          return { ok: false, error: `Security scan failed: ${scanResult.reason}` };
        }

        // Save skill
        await fs.mkdir(skillDir, { recursive: true });
        await fs.writeFile(path.join(skillDir, "SKILL.md"), skillContent, "utf-8");
        invalidateSkillCache();

        emitToolDone(true);
        return { ok: true, skill_name: skillName, path: path.join(skillDir, "SKILL.md") };
      } catch (err: unknown) {
        emitToolDone(false);
        return { ok: false, error: err instanceof Error ? err.message : "Failed to install skill" };
      }
    }

    // -----------------------------------------------------------------------
    // approve_skill_proposal: Execute a pending skill proposal after user approval
    // -----------------------------------------------------------------------
    if (name === "approve_skill_proposal") {
      const proposal = AgentRunner._pendingProposals.get(this.agentId);
      if (!proposal) {
        emitToolDone(false);
        return { ok: false, error: "No pending skill proposal to approve." };
      }
      AgentRunner._pendingProposals.delete(this.agentId);

      const { getSkillDirectory, getSkillLoader, invalidateSkillCache } = await import("./skill-loader");
      const skillsDir = getSkillDirectory();

      try {
        if (proposal.action === "patch") {
          const skillLoader = await getSkillLoader();
          const existingSkill = await skillLoader.getSkill(proposal.skillName);
          if (!existingSkill) {
            emitToolDone(false);
            return { ok: false, error: `Skill "${proposal.skillName}" not found for patching.` };
          }
          const patchVersion = new Date().toISOString().slice(0, 10);
          const frontmatter = [
            "---",
            `name: ${existingSkill.name}`,
            `description: ${proposal.skillDescription}`,
            `version: ${patchVersion}`,
            "---",
            "",
            proposal.skillContent,
          ].join("\n");
          await fs.writeFile(path.join(existingSkill.skillDir, "SKILL.md"), frontmatter, "utf-8");
        } else {
          const skillDirPath = path.join(skillsDir, proposal.skillName);
          const existing = existsSync(skillDirPath);
          if (existing) {
            emitToolDone(false);
            return { ok: false, error: `Skill "${proposal.skillName}" already exists.` };
          }
          await fs.mkdir(skillDirPath, { recursive: true });
          const frontmatter = [
            "---",
            `name: ${proposal.skillName}`,
            `description: ${proposal.skillDescription}`,
            "---",
            "",
            proposal.skillContent,
          ].join("\n");
          await fs.writeFile(path.join(skillDirPath, "SKILL.md"), frontmatter, "utf-8");
        }

        invalidateSkillCache();

        // Record skill usage
        const db = getDb();
        await db.execute(
          sql`INSERT INTO skill_usage (id, skill_name, agent_id, success, used_at, status)
              VALUES (gen_random_uuid(), ${proposal.skillName}, ${this.agentId}, true, ${new Date().toISOString()}, 'active')`
        ).catch((err) => console.warn(`[approve_skill_proposal] skill_usage INSERT failed: ${err}`));

        emitToolDone(true);
        return { ok: true, action: proposal.action, skillName: proposal.skillName };
      } catch (err: unknown) {
        emitToolDone(false);
        return { ok: false, error: err instanceof Error ? err.message : "Failed to execute skill proposal" };
      }
    }

    if (name === "bash") {
      const args = safeJsonParse<{
        command?: string;
        cwd?: string;
        timeoutMs?: number;
        maxOutputKB?: number;
      }>(input.call.argumentsText, {});
      const command = (args.command ?? "").trim();
      if (!command) {
        emitToolDone(false);
        return { ok: false, error: "Missing command" };
      }

      // Destructive/dangerous command blacklist — code-level guard, cannot be bypassed by prompt
      const DENIED_COMMANDS: RegExp[] = [
        /\brm\s+(-[a-zA-Z]*rf?)/,           // rm -rf
        /\bdel\s+\/[sfa]/i,                  // del /s /q /f
        /\bformat\b/,                        // format disk
        /\bmkfs\b/,                          // format filesystem
        /\bshutdown\b/,                      // shutdown system
        /\breboot\b/,                        // reboot
        /\bpowershell\s+.*-[eE]x/,           // powershell -exec bypass
        /\bcurl\s+.*\|\s*(bash|sh\b|pwsh|powershell)/, // curl | bash (remote code execution)
        /\bchmod\s+777\b/,                   // chmod 777
        /\bsudo\b/,                          // sudo (privilege escalation)
        /\bnet\s+user\b/,                    // create/delete Windows users
        /\bschtasks\b/,                      // scheduled tasks
        /\btaskkill\b(?!.*\/IM\s+.*LOStudio)/,   // kill running processes (except LOStudio restart)
        /(?<!LOStudio.*)\bStop-Process\b/,        // PowerShell kill (except LOStudio restart)
        /\bpython[23]?\s+-c\b/,              // python -c (arbitrary code execution)
        /\bnode\s+-[ep]\b/,                  // node -e/-p (arbitrary code execution)
        /\bruby\s+-e\b/,                     // ruby -e (arbitrary code execution)
        /\bperl\s+-e\b/,                     // perl -e (arbitrary code execution)
        /\blua\s+-e\b/,                      // lua -e (arbitrary code execution)
        /\bphp\s+-r\b/,                      // php -r (arbitrary code execution)
        /\bwget\s+.*\|\s*(bash|sh\b|pwsh)/, // wget | bash (remote code execution)
        /\breg\s+(add|delete|export)\b/i,    // Windows registry manipulation
        /\bbitsadmin\b/,                     // Windows BITS persistence
        /\bregsvr32\b/,                      // DLL registration (often used in attacks)
        /\bmsiexec\b/,                       // Windows Installer (can execute remote payloads)
      ];

      for (const pattern of DENIED_COMMANDS) {
        if (pattern.test(command)) {
          emitToolDone(false);
          return { ok: false, error: `Command blocked: potentially destructive pattern detected. Use safer alternatives.` };
        }
      }

      // Audit log: record every bash attempt before execution
      const auditLogPath = path.join(process.cwd(), ".agent_stream_logs", "bash-audit.log");
      const auditLine = `${new Date().toISOString()} | ${this.agentId.substring(0, 8)} | ${command.slice(0, 200).replace(/\n/g, "\\n")} | PENDING\n`;
      void fs.appendFile(auditLogPath, auditLine);

      const workspaceRoot = process.env.AGENT_WORKDIR ?? process.cwd();
      const requestedCwd = (args.cwd ?? "").trim();
      let finalCwd = workspaceRoot;
      if (requestedCwd) {
        const resolved = path.isAbsolute(requestedCwd)
          ? requestedCwd
          : path.resolve(workspaceRoot, requestedCwd);
        const rootResolved = path.resolve(workspaceRoot);
        if (!resolved.startsWith(rootResolved)) {
          emitToolDone(false);
          return { ok: false, error: "cwd must be within workspace root", workspaceRoot };
        }
        finalCwd = resolved;
      }

      const timeoutMs = Number(args.timeoutMs) > 0 ? Number(args.timeoutMs) : 120000;
      const maxOutputKB = Number(args.maxOutputKB) > 0 ? Number(args.maxOutputKB) : 1024;
      const maxBuffer = Math.max(64 * 1024, Math.floor(maxOutputKB * 1024));

      // ── E-07: Sandbox-aware execution ──────────────────────────────
      const sandboxCfg = getSandboxConfig();
      let stdout = "";
      let stderr = "";
      let exitCode: number | null = 0;
      let signal: string | null = null;
      let execError: string | undefined;

      try {
        if (sandboxCfg.enabled) {
          // Sandbox is ON — choose docker or host mode
          if (sandboxCfg.mode === "docker" && await isDockerAvailable()) {
            const result = await execInSandbox(command, finalCwd, sandboxCfg);
            stdout = result.stdout;
            stderr = result.stderr;
            exitCode = result.exitCode;
          } else {
            // host mode (or docker requested but unavailable — graceful fallback)
            const result = await execOnHost(command, finalCwd, timeoutMs, maxOutputKB);
            stdout = result.stdout;
            stderr = result.stderr;
            exitCode = result.exitCode;
          }
          if (exitCode !== 0) {
            execError = `exit code ${exitCode}`;
          }
        } else {
          // Sandbox is OFF — original behaviour (backward compatible)
          const execAsync = promisify(exec);
          try {
            const res = await execAsync(command, {
              cwd: finalCwd,
              timeout: timeoutMs,
              maxBuffer,
              shell: process.platform === "win32" ? "cmd.exe" : "/bin/bash",
              windowsHide: true,
            });
            stdout = res.stdout;
            stderr = res.stderr;
            exitCode = 0;
          } catch (err: any) {
            stdout = err?.stdout ?? "";
            stderr = err?.stderr ?? "";
            exitCode = typeof err?.code === "number" ? err.code : null;
            signal = typeof err?.signal === "string" ? err.signal : null;
            execError = String(err?.message ?? err);
            throw err; // re-throw so outer catch handles audit + return
          }
        }

        // ── Success path ─────────────────────────────────────────────
        const successLine = `${new Date().toISOString()} | ${this.agentId.substring(0, 8)} | ${command.slice(0, 200).replace(/\n/g, "\\n")} | OK | exit:${exitCode}\n`;
        void fs.appendFile(auditLogPath, successLine);

        // Record to agent_decisions (best-effort)
        void this.recordDecision({
          decisionType: "execute",
          targetType: "bash",
          inputSummary: command.slice(0, 200),
          outputSummary: `exit:${exitCode} stdout:${(stdout || "").slice(0, 100)}`,
          success: exitCode === 0,
        });

        emitToolDone(true);
        return { ok: true, stdout, stderr, exitCode, cwd: finalCwd };
      } catch (err: any) {
        // ── Failure path ─────────────────────────────────────────────
        const errorLine = `${new Date().toISOString()} | ${this.agentId.substring(0, 8)} | ${command.slice(0, 200).replace(/\n/g, "\\n")} | FAIL | exit:${exitCode ?? "null"}\n`;
        void fs.appendFile(auditLogPath, errorLine);

        // Record failure to agent_decisions (best-effort)
        void this.recordDecision({
          decisionType: "execute",
          targetType: "bash",
          inputSummary: command.slice(0, 200),
          outputSummary: `exit:${exitCode ?? "null"} err:${(execError ?? "").slice(0, 100)}`,
          success: false,
        });

        emitToolDone(false);
        return {
          ok: false,
          stdout,
          stderr,
          exitCode,
          signal,
          cwd: finalCwd,
          error: execError ?? String(err?.message ?? err),
        };
      }
    }

    if (name === "read_file") {
      const args = safeJsonParse<{ path?: string; offset?: number; limit?: number }>(input.call.argumentsText, {});
      const filePath = (args.path ?? "").trim();
      const offset = Math.max(1, args.offset ?? 1);
      const limit = Math.min(1000, Math.max(1, args.limit ?? 200));

      if (!filePath) {
        emitToolDone(false);
        return { ok: false, error: "Missing path" };
      }

      // Resolve path
      const workDir = process.env.AGENT_WORKDIR || process.cwd();
      const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(workDir, filePath);

      // Security: must be within workDir
      if (!resolvedPath.startsWith(workDir)) {
        emitToolDone(false);
        return { ok: false, error: "Path traversal not allowed" };
      }

      try {
        const content = await fs.readFile(resolvedPath, "utf-8");
        const lines = content.split("\n");
        const startIdx = offset - 1;
        const endIdx = Math.min(startIdx + limit, lines.length);
        const slice = lines.slice(startIdx, endIdx);
        const numbered = slice.map((line, i) => `${startIdx + i + 1}\t${line}`).join("\n");
        const totalLines = lines.length;
        const truncated = endIdx < totalLines ? `\n... [${totalLines - endIdx} more lines, use offset=${endIdx + 1} to continue]` : "";

        emitToolDone(true);
        return { ok: true, content: numbered + truncated, totalLines, linesRead: slice.length };
      } catch (err: any) {
        emitToolDone(false);
        return { ok: false, error: err.message ?? "Failed to read file" };
      }
    }

    // === edit_file: precise string replacement (aligned with QoderWork CN Edit tool) ===
    if (name === "edit_file") {
      const args = safeJsonParse<{ path?: string; old_string?: string; new_string?: string; replace_all?: boolean }>(
        input.call.argumentsText, {}
      );
      const filePath = (args.path ?? "").trim();
      const oldStr = args.old_string ?? "";
      const newStr = args.new_string ?? "";
      const replaceAll = args.replace_all === true;

      if (!filePath) { emitToolDone(false); return { ok: false, error: "Missing path" }; }
      if (oldStr === "") { emitToolDone(false); return { ok: false, error: "old_string cannot be empty" }; }

      const workDir = process.env.AGENT_WORKDIR || process.cwd();
      const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(workDir, filePath);
      if (!resolvedPath.startsWith(workDir)) {
        emitToolDone(false);
        return { ok: false, error: "Path traversal not allowed" };
      }

      try {
        const content = await fs.readFile(resolvedPath, "utf-8");
        const occurrences = content.split(oldStr).length - 1;

        if (occurrences === 0) {
          emitToolDone(false);
          return { ok: false, error: `old_string not found in file. Make sure it matches exactly (including whitespace and indentation).` };
        }
        if (!replaceAll && occurrences > 1) {
          emitToolDone(false);
          return { ok: false, error: `old_string found ${occurrences} times. It must be unique, or set replace_all=true to replace all.` };
        }

        const newContent = replaceAll ? content.split(oldStr).join(newStr) : content.replace(oldStr, newStr);
        await fs.writeFile(resolvedPath, newContent, "utf-8");

        // Calculate modified region for response
        const beforeLines = content.split("\n");
        const afterLines = newContent.split("\n");
        const firstChangeIdx = beforeLines.findIndex((l) => oldStr.includes(l.trim()) || oldStr.split("\n")[0] === l);
        const startLine = Math.max(1, (firstChangeIdx >= 0 ? firstChangeIdx : 0));
        const contextLines = 3;
        const regionStart = Math.max(0, startLine - contextLines);
        const regionEnd = Math.min(afterLines.length, startLine + newStr.split("\n").length + contextLines);
        const region = afterLines.slice(regionStart, regionEnd)
          .map((line, i) => `${regionStart + i + 1}\t${line}`).join("\n");

        emitToolDone(true);
        return {
          ok: true,
          message: `Successfully ${replaceAll ? `replaced all ${occurrences} occurrences` : "replaced"} in ${path.basename(resolvedPath)}`,
          modifiedRegion: region,
          linesChanged: afterLines.length - beforeLines.length,
        };
      } catch (err: any) {
        emitToolDone(false);
        return { ok: false, error: err.message ?? "Failed to edit file" };
      }
    }

    // === write_file: create or overwrite file with auto mkdir ===
    if (name === "write_file") {
      const args = safeJsonParse<{ path?: string; content?: string }>(input.call.argumentsText, {});
      const filePath = (args.path ?? "").trim();
      const content = args.content ?? "";

      if (!filePath) { emitToolDone(false); return { ok: false, error: "Missing path" }; }

      const workDir = process.env.AGENT_WORKDIR || process.cwd();
      const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(workDir, filePath);
      if (!resolvedPath.startsWith(workDir)) {
        emitToolDone(false);
        return { ok: false, error: "Path traversal not allowed" };
      }

      try {
        // Auto-create parent directories
        const dir = path.dirname(resolvedPath);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(resolvedPath, content, "utf-8");

        const lines = content.split("\n").length;
        const sizeBytes = Buffer.byteLength(content, "utf-8");
        emitToolDone(true);
        return {
          ok: true,
          message: `Wrote ${lines} lines (${sizeBytes} bytes) to ${path.relative(workDir, resolvedPath) || path.basename(resolvedPath)}`,
          path: resolvedPath,
          lines,
          sizeBytes,
        };
      } catch (err: any) {
        emitToolDone(false);
        return { ok: false, error: err.message ?? "Failed to write file" };
      }
    }

    // === search_files: glob pattern file search ===
    if (name === "search_files") {
      const args = safeJsonParse<{ pattern?: string; cwd?: string; maxResults?: number }>(
        input.call.argumentsText, {}
      );
      const pattern = (args.pattern ?? "").trim();
      const maxResults = Math.min(200, Math.max(1, args.maxResults ?? 50));

      if (!pattern) { emitToolDone(false); return { ok: false, error: "Missing pattern" }; }

      const workDir = process.env.AGENT_WORKDIR || process.cwd();
      const searchRoot = args.cwd
        ? (path.isAbsolute(args.cwd) ? args.cwd : path.resolve(workDir, args.cwd))
        : workDir;
      if (!searchRoot.startsWith(workDir)) {
        emitToolDone(false);
        return { ok: false, error: "Path traversal not allowed" };
      }

      try {
        // Use find command with -name for glob matching, sorted by mtime
        const { execSync } = await import("node:child_process");
        const escapedPattern = pattern.replace(/'/g, "'\\''");
        const cmd = `find '${searchRoot}' -path '*/node_modules' -prune -o -path '*/.git' -prune -o -name '${escapedPattern}' -print 2>/dev/null | head -${maxResults}`;
        const output = execSync(cmd, { encoding: "utf-8", timeout: 10000, maxBuffer: 1024 * 512 }).trim();
        const files = output ? output.split("\n").filter(Boolean) : [];

        emitToolDone(true);
        return {
          ok: true,
          files,
          count: files.length,
          truncated: files.length >= maxResults,
        };
      } catch (err: any) {
        emitToolDone(false);
        return { ok: false, error: err.message ?? "search_files failed" };
      }
    }

    // === search_content: regex content search (like grep -rn) ===
    if (name === "search_content") {
      const args = safeJsonParse<{ pattern?: string; path?: string; include?: string; caseSensitive?: boolean; maxResults?: number }>(
        input.call.argumentsText, {}
      );
      const searchPattern = (args.pattern ?? "").trim();
      const maxResults = Math.min(200, Math.max(1, args.maxResults ?? 50));

      if (!searchPattern) { emitToolDone(false); return { ok: false, error: "Missing pattern" }; }

      const workDir = process.env.AGENT_WORKDIR || process.cwd();
      const searchPath = args.path
        ? (path.isAbsolute(args.path) ? args.path : path.resolve(workDir, args.path))
        : workDir;
      if (!searchPath.startsWith(workDir)) {
        emitToolDone(false);
        return { ok: false, error: "Path traversal not allowed" };
      }

      try {
        const { execSync } = await import("node:child_process");
        const caseFlag = args.caseSensitive === false ? "-i" : "";
        const includeFlag = args.include ? `--include='${args.include.replace(/'/g, "'\\''")}'` : "";
        const escapedPattern = searchPattern.replace(/'/g, "'\\''").replace(/"/g, '\\"');
        const cmd = `grep -rn ${caseFlag} ${includeFlag} --exclude-dir=node_modules --exclude-dir=.git -m 5 '${escapedPattern}' '${searchPath}' 2>/dev/null | head -${maxResults}`;
        const output = execSync(cmd, { encoding: "utf-8", timeout: 15000, maxBuffer: 1024 * 512 }).trim();
        const matches = output ? output.split("\n").filter(Boolean) : [];

        emitToolDone(true);
        return {
          ok: true,
          matches,
          count: matches.length,
          truncated: matches.length >= maxResults,
        };
      } catch (err: any) {
        // grep returns exit code 1 when no matches found — that's not an error
        if (err.status === 1) {
          emitToolDone(true);
          return { ok: true, matches: [], count: 0, truncated: false };
        }
        emitToolDone(false);
        return { ok: false, error: err.message ?? "search_content failed" };
      }
    }

    if (name === "create") {
      const args = safeJsonParse<{ role?: string; guidance?: string }>(input.call.argumentsText, {});
      const role = (args.role ?? "").trim();
      const guidance = (args.guidance ?? "").trim();
      if (!role) {
        emitToolDone(false);
        return { ok: false, error: "Missing role" };
      }

      const created = await store.createSubAgentWithP2P({
        workspaceId,
        creatorId: this.agentId,
        role,
        guidance,
      });
      this.ensureRunner(created.agentId);
      getWorkspaceUIBus().emit(workspaceId, {
        event: "ui.agent.created",
        data: { workspaceId, agent: { id: created.agentId, role, parentId: this.agentId } },
      });
      emitToolDone(true);
      return { ok: true, agentId: created.agentId, role, groupId: created.groupId };
    }

    if (name === "list_agents") {
      const agents = await store.listAgentsMeta({ workspaceId });
      emitToolDone(true);
      return { ok: true, agents };
    }

    if (name === "send") {
      const args = safeJsonParse<{ to?: string; content?: string }>(input.call.argumentsText, {});
      const to = (args.to ?? "").trim();
      const content = (args.content ?? "").trim();
      if (!to) {
        emitToolDone(false);
        return { ok: false, error: "Missing to" };
      }
      if (!content) {
        emitToolDone(false);
        return { ok: false, error: "Missing content" };
      }

      const delivered = await store.sendDirectMessage({
        workspaceId,
        fromId: this.agentId,
        toId: to,
        // Do not auto-add the human into agent鈫攁gent threads; sidebar only shows human-participant chats.
        content,
        contentType: "text",
        groupName: null,
      });

      const directMembers = await store.listGroupMemberIds({ groupId: delivered.groupId });
      getWorkspaceUIBus().emit(workspaceId, {
        event: "ui.message.created",
        data: {
          workspaceId,
          groupId: delivered.groupId,
          memberIds: directMembers,
          message: { id: delivered.messageId, senderId: this.agentId, sendTime: delivered.sendTime },
        },
      });

      const toRole = await store.getAgentRole({ agentId: to }).catch(() => null);
      if (toRole && toRole !== "human") {
        this.ensureRunner(to);
        this.wakeAgent(to);
      }

      emitToolDone(true);
      return { ok: true, ...delivered };
    }

    if (name === "list_groups") {
      const groups = await store.listGroups({ workspaceId, agentId: this.agentId });
      emitToolDone(true);
      return { ok: true, groups };
    }

    if (name === "list_group_members") {
      const args = safeJsonParse<{ groupId?: string }>(input.call.argumentsText, {});
      const groupId = (args.groupId ?? "").trim();
      if (!groupId) {
        emitToolDone(false);
        return { ok: false, error: "Missing groupId" };
      }
      const members = await store.listGroupMemberIds({ groupId });
      if (!members.includes(this.agentId)) {
        emitToolDone(false);
        return { ok: false, error: "Access denied" };
      }
      emitToolDone(true);
      return { ok: true, members };
    }

    if (name === "create_group") {
      const args = safeJsonParse<{ memberIds?: string[]; name?: string }>(input.call.argumentsText, {});
      let memberIds = this.resolveAgentIds(
        (args.memberIds ?? []).map((id) => id.trim()).filter(Boolean),
        await store.listAgentsMeta({ workspaceId })
      );
      if (memberIds.length < 2) {
        emitToolDone(false);
        return { ok: false, error: "memberIds must have >= 2 members" };
      }
      if (!memberIds.includes(this.agentId)) {
        memberIds = [...memberIds, this.agentId];
      }
      let groupId = "";
      let groupName: string | null = args.name ?? null;
      const isNewGroup = memberIds.length > 2; // Only create workflow for multi-member groups, not P2P

      if (memberIds.length === 2) {
        const existing = await store.findLatestExactP2PGroupId({
          workspaceId,
          memberA: memberIds[0]!,
          memberB: memberIds[1]!,
          preferredName: args.name ?? null,
        });
        groupId =
          (await store.mergeDuplicateExactP2PGroups({
            workspaceId,
            memberA: memberIds[0]!,
            memberB: memberIds[1]!,
            preferredName: args.name ?? null,
          })) ??
          (
            await store.createGroup({
              workspaceId,
              memberIds,
              name: args.name ?? undefined,
              creatorId: this.agentId,
            })
          ).id;
        if (!existing) {
          getWorkspaceUIBus().emit(workspaceId, {
            event: "ui.group.created",
            data: { workspaceId, group: { id: groupId, name: groupName, memberIds } },
          });
        }
      } else {
        const created = await store.createGroup({ workspaceId, memberIds, name: args.name ?? undefined, creatorId: this.agentId });
        groupId = created.id;
        groupName = created.name;
        getWorkspaceUIBus().emit(workspaceId, {
          event: "ui.group.created",
          data: { workspaceId, group: { id: groupId, name: groupName, memberIds } },
        });

        // 閾佸緥 #6: 缇や富 = coordinator
        // Auto-create a draft workflow with the group creator as coordinator
        const now = new Date().toISOString();
        const workflowId = crypto.randomUUID();
        await getDb().execute(
          sql`INSERT INTO workflows (id, group_id, name, creator_id, status, created_at, updated_at)
              VALUES (${workflowId}, ${groupId}, ${groupName ?? 'Group Workflow'}, ${this.agentId}, 'draft', ${now}, ${now})`
        );
      }
      emitToolDone(true);
      return { ok: true, groupId, name: groupName };
    }

    if (name === "add_group_members") {
      const args = safeJsonParse<{ groupId?: string; memberIds?: string[] }>(input.call.argumentsText, {});
      const groupId = (args.groupId ?? "").trim();
      const rawIds = (args.memberIds ?? []).map((id) => id.trim()).filter(Boolean);
      if (!groupId) {
        emitToolDone(false);
        return { ok: false, error: "Missing groupId" };
      }
      const memberIds = this.resolveAgentIds(rawIds, await store.listAgentsMeta({ workspaceId }));
      if (memberIds.length === 0) {
        emitToolDone(false);
        return { ok: false, error: "memberIds must have >= 1 member" };
      }
      const existingMembers = await store.listGroupMemberIds({ groupId });
      if (!existingMembers.includes(this.agentId)) {
        emitToolDone(false);
        return { ok: false, error: "Access denied" };
      }
      const newMembers = memberIds.filter((id) => !existingMembers.includes(id));
      if (newMembers.length === 0) {
        emitToolDone(false);
        return { ok: false, error: "All specified members are already in the group" };
      }
      await store.addGroupMembers({ groupId, userIds: newMembers });
      const allMembers = await store.listGroupMemberIds({ groupId });
      getWorkspaceUIBus().emit(workspaceId, {
        event: "ui.group.member_added",
        data: { workspaceId, groupId, addedMemberIds: newMembers, memberIds: allMembers },
      });
      emitToolDone(true);
      return { ok: true, groupId, addedMembers: newMembers };
    }

    if (name === "delete_agent") {
      const args = safeJsonParse<{ agentRole?: string; confirm?: boolean }>(
        input.call.argumentsText,
        {}
      );
      const agentRole = (args.agentRole ?? "").trim();
      if (!agentRole) {
        emitToolDone(false);
        return { ok: false, error: "Missing agentRole" };
      }
      if (!args.confirm) {
        emitToolDone(false);
        return { ok: false, error: "Must set confirm=true to delete. This operation is irreversible." };
      }

      const db = getDb();
      const agents = await store.listAgentsMeta({ workspaceId });

      // Resolve role name to UUID
      const resolved = this.resolveAgentIds([agentRole], agents);
      if (resolved.length === 0) {
        emitToolDone(false);
        return { ok: false, error: `Agent not found: "${agentRole}"` };
      }
      const targetId = resolved[0]!;

      // Cannot delete human
      const targetAgent = agents.find((a) => a.id === targetId);
      if (!targetAgent) {
        emitToolDone(false);
        return { ok: false, error: "Agent not found" };
      }
      if (targetAgent.role === "human") {
        emitToolDone(false);
        return { ok: false, error: "Cannot delete the human agent" };
      }

      // Authorization: target must be a direct child of the calling agent
      const targetParentId = agents.find((a) => a.id === targetId)?.parentId;
      if (targetParentId !== this.agentId) {
        emitToolDone(false);
        return { ok: false, error: "Access denied: you can only delete agents that you created" };
      }

      // Check if target has sub-agents
      const subAgents = agents.filter((a) => a.parentId === targetId);
      if (subAgents.length > 0) {
        emitToolDone(false);
        return { ok: false, error: `Cannot delete: this agent has ${subAgents.length} sub-agent(s). Delete them first.` };
      }

      // Collect all groups this agent is a member of
      const allGroups = await store.listGroups({ workspaceId, agentId: targetId });
      const groupIds = allGroups.map((g) => g.id);

      // For multi-member groups, only remove membership (don't delete the group)
      // For P2P groups where this agent is one of two members, delete the entire group
      const multiMemberGroupIds: string[] = [];
      const p2pGroupIds: string[] = [];
      for (const g of allGroups) {
        if (g.memberIds.length === 2) {
          p2pGroupIds.push(g.id);
        } else {
          multiMemberGroupIds.push(g.id);
        }
      }

      try {
        await db.transaction(async (tx) => {
          // 1. Delete workflows and their tasks/task_logs for P2P groups
          for (const gid of p2pGroupIds) {
            await tx.execute(sql`DELETE FROM task_logs WHERE task_id IN (SELECT id FROM tasks WHERE workflow_id IN (SELECT id FROM workflows WHERE group_id = ${gid}))`);
            await tx.execute(sql`DELETE FROM tasks WHERE workflow_id IN (SELECT id FROM workflows WHERE group_id = ${gid})`);
            await tx.execute(sql`DELETE FROM agent_assignments WHERE group_id = ${gid}`);
            await tx.execute(sql`DELETE FROM workflows WHERE group_id = ${gid}`);
            await tx.execute(sql`DELETE FROM messages WHERE group_id = ${gid}`);
            await tx.execute(sql`DELETE FROM group_members WHERE group_id = ${gid}`);
            await tx.execute(sql`DELETE FROM groups WHERE id = ${gid}`);
          }

          // 2. For multi-member groups: remove membership only
          for (const gid of multiMemberGroupIds) {
            await tx.execute(sql`DELETE FROM group_members WHERE group_id = ${gid} AND user_id = ${targetId}`);
          }

          // 3. Delete workflows where this agent is the creator (in any remaining group)
          await tx.execute(sql`DELETE FROM task_logs WHERE task_id IN (SELECT id FROM tasks WHERE workflow_id IN (SELECT id FROM workflows WHERE creator_id = ${targetId}))`);
          await tx.execute(sql`DELETE FROM tasks WHERE workflow_id IN (SELECT id FROM workflows WHERE creator_id = ${targetId})`);
          await tx.execute(sql`DELETE FROM agent_assignments WHERE workflow_id IN (SELECT id FROM workflows WHERE creator_id = ${targetId})`);
          await tx.execute(sql`DELETE FROM workflows WHERE creator_id = ${targetId}`);

          // 4. Delete the agent
          await tx.execute(sql`DELETE FROM agents WHERE id = ${targetId}`);
        });

        // Stop the agent's runner if it's running
        this.stopRunner(targetId);

        getWorkspaceUIBus().emit(workspaceId, {
          event: "ui.agent.deleted",
          data: { workspaceId, agentId: targetId, role: targetAgent.role },
        });

        emitToolDone(true);
        return { ok: true, agentId: targetId, role: targetAgent.role, message: "Agent deleted" };
      } catch (err) {
        console.error(`[delete_agent] Transaction failed for agent=${targetId}:`, err);
        emitToolDone(false);
        return { ok: false, error: "Failed to delete agent" };
      }
    }

    if (name === "delete_group") {
      const args = safeJsonParse<{ groupId?: string; confirm?: boolean }>(
        input.call.argumentsText,
        {}
      );
      const groupId = (args.groupId ?? "").trim();
      if (!groupId) {
        emitToolDone(false);
        return { ok: false, error: "Missing groupId" };
      }
      if (!args.confirm) {
        emitToolDone(false);
        return { ok: false, error: "Must set confirm=true to delete. This operation is irreversible." };
      }

      const db = getDb();

      // Authorization: groups table has no creator_id column.
      // Multi-member groups have a workflow →only the workflow creator (coordinator) can delete.
      // P2P groups have no workflow →any member can delete.
      const wfRows = await db.execute(
        sql`SELECT creator_id FROM workflows WHERE group_id = ${groupId} ORDER BY created_at DESC LIMIT 1`
      );
      const wfRowsArr = wfRows as unknown as Array<{ creator_id: string }>;
      const wfRow = wfRowsArr[0] ?? null;
      if (wfRow && wfRow.creator_id !== this.agentId) {
        emitToolDone(false);
        return { ok: false, error: "Only the group creator (coordinator) can delete a group" };
      }

      // Verify membership (required for P2P groups without workflows)
      const members = await store.listGroupMemberIds({ groupId });
      if (!members.includes(this.agentId)) {
        emitToolDone(false);
        return { ok: false, error: "Access denied" };
      }

      // Collect workflow IDs for cascade delete
      const workflowIds = await db.execute(
        sql`SELECT id FROM workflows WHERE group_id = ${groupId}`
      );
      const wfIds = (workflowIds as unknown as Array<{ id: string }>).map((r) => r.id);

      // Cascade delete: task_logs →tasks →agent_assignments →workflows →messages →group_members →session_archive →groups
      try {
        await db.transaction(async (tx) => {
          if (wfIds.length > 0) {
            // 1. task_logs
            await tx.execute(
              sql`DELETE FROM task_logs WHERE task_id IN (SELECT id FROM tasks WHERE workflow_id IN (${sql.join(wfIds, sql`, `)}))`
            );
            // 2. tasks
            await tx.execute(
              sql`DELETE FROM tasks WHERE workflow_id IN (${sql.join(wfIds, sql`, `)})`
            );
          }
          // 3. agent_assignments
          await tx.execute(sql`DELETE FROM agent_assignments WHERE group_id = ${groupId}`);
          // 4. workflows
          await tx.execute(sql`DELETE FROM workflows WHERE group_id = ${groupId}`);
          // 5. messages
          await tx.execute(sql`DELETE FROM messages WHERE group_id = ${groupId}`);
          // 6. group_members
          await tx.execute(sql`DELETE FROM group_members WHERE group_id = ${groupId}`);
          // 7. session_archive
          await tx.execute(sql`DELETE FROM session_archive WHERE group_id = ${groupId}`);
          // 8. group
          await tx.execute(sql`DELETE FROM groups WHERE id = ${groupId}`);
        });
      } catch (err) {
        console.error(`[delete_group] Transaction failed for group=${groupId}:`, err);
        emitToolDone(false);
        return { ok: false, error: "Failed to delete group" };
      }

      emitToolDone(true);
      return { ok: true, groupId, message: "Group and all associated data deleted" };
    }

    if (name === "send_group_message") {
      const args = safeJsonParse<{ groupId?: string; content?: string; contentType?: string }>(
        input.call.argumentsText,
        {}
      );
      const groupId = (args.groupId ?? "").trim();
      const content = (args.content ?? "").trim();
      if (!groupId) {
        emitToolDone(false);
        return { ok: false, error: "Missing groupId" };
      }
      if (!content) {
        emitToolDone(false);
        return { ok: false, error: "Missing content" };
      }

      // Resolve groupId: if not a valid UUID, try to find by name
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      let resolvedGroupId = groupId;
      if (!uuidRegex.test(groupId)) {
        const groups = await store.listGroups({ workspaceId, agentId: this.agentId });
        const found = groups.find((g) => g.name === groupId);
        if (!found) {
          emitToolDone(false);
          return { ok: false, error: `Group not found: "${groupId}". Use the group UUID, not the name.` };
        }
        resolvedGroupId = found.id;
      }

      const members = await store.listGroupMemberIds({ groupId: resolvedGroupId });
      if (!members.includes(this.agentId)) {
        emitToolDone(false);
        return { ok: false, error: "Access denied" };
      }

      // === Cognitive Pipeline Layer 3: Verification Gate ===
      // Block Worker agents from reporting task completion if they modified code but didn't run verification.
      // Safety valve: allow bypass after 2 blocks to prevent deadlock.
      const isWorkerCtx = this.toolContext && !this.toolContext.isCoordinator && this.toolContext.hasActiveWorkflow;
      const completionRe = /\b(done|complete|finished|completed|完成|已完成|搞定了|做好了|完毕)\b/i;
      const isCompletionMsg = completionRe.test(content) && !this.pipelineContext;
      if (isWorkerCtx && isCompletionMsg && this.codeModificationsThisTurn && this.verificationToolsCalled.size === 0) {
        this.verificationGateBlocks++;
        if (this.verificationGateBlocks < 2) {
          console.warn(`[CognitivePipeline] verification gate blocked Worker ${this.agentId.slice(0, 8)} (block ${this.verificationGateBlocks}/2)`);
          emitToolDone(false);
          return {
            ok: false,
            error:
              `[Verification Gate] You are reporting task completion after modifying code, but have NOT run verification.\n` +
              `Before sending this message, you MUST run:\n` +
              `1. bash({ command: "npx tsc --noEmit" }) — type check\n` +
              `2. bash({ command: "npx vitest run" }) — unit tests\n` +
              `Run these, fix any failures, THEN send your completion message with the verification results.`,
          };
        }
        // Safety valve: allow send after 2 blocks, but log warning
        console.warn(`[CognitivePipeline] verification gate bypassed for ${this.agentId.slice(0, 8)} after 2 blocks`);
        this.verificationGateBlocks = 0;
      }

      const result = await store.sendMessage({
        groupId: resolvedGroupId,
        senderId: this.agentId,
        content,
        contentType: args.contentType ?? "text",
      });

      getWorkspaceUIBus().emit(workspaceId, {
        event: "ui.message.created",
        data: {
          workspaceId,
          groupId: resolvedGroupId,
          memberIds: members,
          message: { id: result.id, senderId: this.agentId, sendTime: result.sendTime },
        },
      });

      for (const memberId of members) {
        if (memberId === this.agentId) continue;
        const role = await store.getAgentRole({ agentId: memberId }).catch(() => null);
        if (role === "human" || role === null) continue;
        this.ensureRunner(memberId);
        this.wakeAgent(memberId);
      }

      emitToolDone(true);
      return { ok: true, ...result };
    }

    if (name === "send_direct_message") {
      const args = safeJsonParse<{ toAgentId?: string; content?: string; contentType?: string }>(
        input.call.argumentsText,
        {}
      );
      const toAgentId = (args.toAgentId ?? "").trim();
      const content = (args.content ?? "").trim();
      if (!toAgentId) {
        emitToolDone(false);
        return { ok: false, error: "Missing toAgentId" };
      }
      if (!content) {
        emitToolDone(false);
        return { ok: false, error: "Missing content" };
      }

      const delivered = await store.sendDirectMessage({
        workspaceId,
        fromId: this.agentId,
        toId: toAgentId,
        content,
        contentType: args.contentType ?? "text",
        groupName: null,
      });
      const groupId = delivered.groupId;
      const channel = delivered.channel;
      const directMembers = await store.listGroupMemberIds({ groupId });
      getWorkspaceUIBus().emit(workspaceId, {
        event: "ui.message.created",
        data: {
          workspaceId,
          groupId,
          memberIds: directMembers,
          message: { id: delivered.messageId, senderId: this.agentId, sendTime: delivered.sendTime },
        },
      });

      this.ensureRunner(toAgentId);
      this.wakeAgent(toAgentId);

      emitToolDone(true);
      return {
        ok: true,
        channel,
        groupId,
        messageId: delivered.messageId,
        sendTime: delivered.sendTime,
      };
    }

    if (name === "get_group_messages") {
      const args = safeJsonParse<{ groupId?: string; limit?: number }>(input.call.argumentsText, {});
      const groupId = (args.groupId ?? "").trim();
      if (!groupId) {
        emitToolDone(false);
        return { ok: false, error: "Missing groupId" };
      }
      const members = await store.listGroupMemberIds({ groupId });
      if (!members.includes(this.agentId)) {
        emitToolDone(false);
        return { ok: false, error: "Access denied" };
      }
      const msgLimit = args.limit && args.limit > 0 && args.limit <= 50 ? args.limit : 20;
      const messages = await store.listMessages({ groupId, limit: msgLimit });

      // Return summary cards (library catalog pattern —metadata only, not full content)
      const cards = messages.map(m => ({
        id: m.id,
        sender: m.senderId,
        time: m.sendTime,
        type: m.contentType,
        preview: m.content.length > 100 ? m.content.slice(0, 100) + "..." : m.content,
      }));
      emitToolDone(true);
      return { ok: true, messages: cards, total: cards.length };
    }

    if (name === "get_message_detail") {
      const args = safeJsonParse<{ messageId?: string }>(input.call.argumentsText, {});
      const messageId = (args.messageId ?? "").trim();
      if (!messageId) {
        emitToolDone(false);
        return { ok: false, error: "Missing messageId" };
      }
      const msg = await store.getMessage({ messageId });
      if (!msg) {
        emitToolDone(false);
        return { ok: false, error: "Message not found" };
      }
      // Verify access: check if agent is in the group this message belongs to
      const groupRows = await getDb().execute(
        sql`SELECT group_id FROM messages WHERE id = ${messageId}`
      );
      const msgGroup = (groupRows as unknown as Array<{ group_id: string }>)[0];
      if (!msgGroup) {
        emitToolDone(false);
        return { ok: false, error: "Message not found" };
      }
      const members = await store.listGroupMemberIds({ groupId: msgGroup.group_id });
      if (!members.includes(this.agentId)) {
        emitToolDone(false);
        return { ok: false, error: "Access denied" };
      }
      emitToolDone(true);
      return { ok: true, message: msg };
    }

    if (name === "create_workflow") {
      const args = safeJsonParse<{
        groupId?: string;
        name?: string;
        description?: string;
        tasks?: Array<{
          name?: string;
          description?: string;
          assigneeRole?: string;
          dependsOn?: string[];
          expectedOutput?: string;
          maxRevisions?: number;
        }>;
        autoActivate?: boolean;
      }>(input.call.argumentsText, {});
      const groupId = (args.groupId ?? "").trim();
      const wfName = (args.name ?? "").trim();
      if (!groupId || !wfName) {
        emitToolDone(false);
        return { ok: false, error: "Missing groupId or name" };
      }
      const tasks = args.tasks ?? [];
      if (tasks.length === 0) {
        emitToolDone(false);
        return { ok: false, error: "tasks must have at least 1 item" };
      }

      const wfId = uuid();
      const now = new Date();
      const initialStatus = args.autoActivate ? "active" : "draft";
      const db = getDb();

      try {
        await db.execute(
          sql`INSERT INTO workflows (id, group_id, name, description, creator_id, status, created_at, updated_at) VALUES (${wfId}, ${groupId}, ${wfName}, ${args.description ?? null}, ${this.agentId}, ${initialStatus}, ${now}, ${now})`
        );

        for (const t of tasks) {
          const tId = uuid();
          const dependsOn = (t.dependsOn ?? []).map((d) => d.trim()).filter(Boolean);
          await db.execute(
            sql`INSERT INTO tasks (id, workflow_id, name, description, assignee_role, expected_output, status, depends_on, max_revisions, created_at) VALUES (${tId}, ${wfId}, ${t.name ?? "unnamed"}, ${t.description ?? null}, ${t.assigneeRole ?? null}, ${t.expectedOutput ?? null}, 'pending', ${dependsOn}, ${t.maxRevisions ?? 3}, ${now})`
          );
        }
      } catch (err: unknown) {
        emitToolDone(false);
        return { ok: false, error: err instanceof Error ? err.message : "Failed to create workflow" };
      }

      emitToolDone(true);
      const result: Record<string, unknown> = { ok: true, workflowId: wfId, taskCount: tasks.length };

      // Record decision: workflow creation
      void this.recordDecision({
        groupId: input.groupId,
        decisionType: "create",
        targetType: "workflow",
        targetId: wfId,
        inputSummary: `Created workflow "${wfName}" with ${tasks.length} tasks`,
        outputSummary: `Workflow ${wfId} created, status: ${initialStatus}`,
        success: true,
      });

      // Auto-retrieve relevant memories for this workflow (design doc 搂6.5)
      try {
        const searchQuery = [wfName, args.description ?? ""].filter(Boolean).join(" ");
        const memRows = await db.execute(
          sql`SELECT id, content, tags, importance, source FROM memories
              WHERE agent_id = ${this.agentId}
              AND content ILIKE ${`%${searchQuery}%`}
              ORDER BY importance DESC, created_at DESC
              LIMIT 5`
        );
        const relatedMemories = (memRows as Array<Record<string, unknown>>).map((r) => ({
          id: r.id,
          content: r.content,
          tags: r.tags,
          importance: r.importance,
        }));
        if (relatedMemories.length > 0) {
          result.relatedMemories = relatedMemories;
        }
      } catch {
        // best-effort; table may not exist
      }

      return result;
    }

    if (name === "update_task") {
      const args = safeJsonParse<{
        taskId?: string;
        status?: string;
        result?: string;
        error?: string;
      }>(input.call.argumentsText, {});
      const taskId = (args.taskId ?? "").trim();
      const status = (args.status ?? "").trim();
      if (!taskId || !status) {
        emitToolDone(false);
        return { ok: false, error: "Missing taskId or status" };
      }
      const validStatuses = new Set(["in_progress", "review", "done", "failed", "approved", "rejected", "blocked"]);
      if (!validStatuses.has(status)) {
        emitToolDone(false);
        return { ok: false, error: `Invalid status: ${status}` };
      }

      const db = getDb();
      const now = new Date();

      // When submitting for review, check max_revisions before allowing
      let finalStatus = status;
      if (status === "review") {
        const taskRows = await db.execute(
          sql`SELECT review_count, max_revisions FROM tasks WHERE id = ${taskId}`
        );
        const taskArr = taskRows as Array<Record<string, unknown>>;
        if (taskArr.length > 0) {
          const currentReviewCount = (taskArr[0].review_count as number) ?? 0;
          const maxRevisions = (taskArr[0].max_revisions as number) ?? 3;
          if (currentReviewCount + 1 >= maxRevisions) {
            finalStatus = "blocked";
          }
        }
      }

      const updateParts: ReturnType<typeof sql>[] = [];
      updateParts.push(sql`status = ${finalStatus}`);
      if (finalStatus === "in_progress") updateParts.push(sql`started_at = ${now}`);
      if (finalStatus === "review") updateParts.push(sql`reviewed_at = ${now}`);
      if (finalStatus === "done") updateParts.push(sql`completed_at = ${now}`);
      if (finalStatus === "approved") updateParts.push(sql`completed_at = ${now}`);
      if (args.result) updateParts.push(sql`result = ${args.result}`);
      if (args.error) updateParts.push(sql`error = ${args.error}`);
      if (finalStatus === "review") updateParts.push(sql`review_count = review_count + 1`);
      if (finalStatus === "blocked") updateParts.push(sql`review_count = review_count + 1`);

      try {
        await db.execute(
          sql`UPDATE tasks SET ${sql.join(updateParts, sql`, `)} WHERE id = ${taskId}`
        );

        // Log task status change
        await db.execute(
          sql`INSERT INTO task_logs (id, task_id, event_type, event_data, actor_id, created_at)
              VALUES (gen_random_uuid(), ${taskId}, ${`task_${finalStatus}`},
                      jsonb_build_object('status', ${finalStatus}, 'result', ${args.result ?? null}),
                      ${this.agentId}, ${now})`
        );
      } catch (err: unknown) {
        emitToolDone(false);
        return { ok: false, error: err instanceof Error ? err.message : "Failed to update task" };
      }

      emitToolDone(true);
      // Record decision: task status change (approve/reject/fix)
      const decisionMap: Record<string, string> = {
        done: "approve", approved: "approve", rejected: "reject",
        failed: "fix", blocked: "escalate", review: "approve",
      };
      const decisionType = decisionMap[finalStatus] ?? "fix";
      void this.recordDecision({
        groupId: input.groupId,
        decisionType,
        targetType: "task",
        targetId: taskId,
        inputSummary: `Task ${taskId} →${finalStatus}`,
        outputSummary: args.result?.slice(0, 200) ?? finalStatus,
        success: finalStatus === "done" || finalStatus === "approved",
      });
      return { ok: true, taskId, status: finalStatus, taskDone: finalStatus === "done" || finalStatus === "approved" };
    }

    if (name === "get_workflow_status") {
      const args = safeJsonParse<{ workflowId?: string; groupId?: string }>(
        input.call.argumentsText,
        {}
      );
      let workflowId = (args.workflowId ?? "").trim();

      const db = getDb();

      if (!workflowId) {
        const groupId = (args.groupId ?? "").trim();
        if (!groupId) {
          emitToolDone(false);
          return { ok: false, error: "Missing workflowId or groupId" };
        }
        const wfRows = await db.execute(
          sql`SELECT id, status FROM workflows WHERE group_id = ${groupId} AND status IN ('draft', 'active', 'paused') ORDER BY created_at DESC LIMIT 1`
        );
        const wfArr = wfRows as unknown as Array<{ id: string; status: string }>;
        if (wfArr.length === 0) {
          emitToolDone(true);
          return { ok: true, workflow: null };
        }
        workflowId = wfArr[0].id;
      }

      const wfRows = await db.execute(
        sql`SELECT id, name, description, status, created_at, updated_at FROM workflows WHERE id = ${workflowId}`
      );
      const wfArr = wfRows as Array<Record<string, unknown>>;
      if (wfArr.length === 0) {
        emitToolDone(false);
        return { ok: false, error: "Workflow not found" };
      }
      const wf = wfArr[0];

      const tRows = await db.execute(
        sql`SELECT id, name, status, assignee_role, assignee_id, review_count, max_revisions, result, error FROM tasks WHERE workflow_id = ${workflowId} ORDER BY created_at`
      );
      const tasks = (tRows as Array<Record<string, unknown>>).map((t) => ({
        id: t.id,
        name: t.name,
        status: t.status,
        assigneeRole: t.assignee_role,
        assigneeId: t.assignee_id,
        reviewCount: t.review_count,
        maxRevisions: t.max_revisions,
        result: t.result,
        error: t.error,
      }));

      emitToolDone(true);
      return { ok: true, workflow: wf, tasks };
    }

    if (name === "assign_agent") {
      const args = safeJsonParse<{
        agentId?: string;
        groupId?: string;
        workflowId?: string;
        taskId?: string;
        action?: string;
      }>(input.call.argumentsText, {});
      const agentId = (args.agentId ?? "").trim();
      const groupId = (args.groupId ?? "").trim();
      const action = (args.action ?? "").trim();
      if (!agentId || !groupId || !action) {
        emitToolDone(false);
        return { ok: false, error: "Missing agentId, groupId, or action" };
      }

      const db = getDb();
      const now = new Date();

      if (action === "assign") {
        const wfId = (args.workflowId ?? "").trim() || null;
        const tId = (args.taskId ?? "").trim() || null;
        const assignId = uuid();

        try {
          // Release any existing assignment for this agent
          await db.execute(
            sql`UPDATE agent_assignments SET status = 'released', released_at = ${now} WHERE agent_id = ${agentId} AND status = 'active'`
          );

          await db.execute(
            sql`INSERT INTO agent_assignments (id, agent_id, group_id, workflow_id, task_id, status, assigned_at) VALUES (${assignId}, ${agentId}, ${groupId}, ${wfId}, ${tId}, 'active', ${now})`
          );
        } catch (err: unknown) {
          emitToolDone(false);
          return { ok: false, error: err instanceof Error ? err.message : "Failed to assign agent" };
        }

        emitToolDone(true);
        // Record decision: agent delegation
        void this.recordDecision({
          groupId,
          decisionType: "delegate",
          targetType: "agent",
          targetId: agentId,
          inputSummary: `Assign ${agentId} to group ${groupId.slice(0,8)} task ${(args.taskId ?? "").slice(0,8) || "(none)"}`,
          outputSummary: `Assigned, assignmentId: ${assignId.slice(0,8)}`,
          success: true,
        });
        return { ok: true, assignmentId: assignId };
      }

      if (action === "release") {
        try {
          await db.execute(
            sql`UPDATE agent_assignments SET status = 'released', released_at = ${now} WHERE agent_id = ${agentId} AND group_id = ${groupId} AND status = 'active'`
          );
        } catch (err: unknown) {
          emitToolDone(false);
          return { ok: false, error: err instanceof Error ? err.message : "Failed to release agent" };
        }
        emitToolDone(true);
        return { ok: true };
      }

      emitToolDone(false);
      return { ok: false, error: `Invalid action: ${action}` };
    }

    if (name === "reload_soul") {
      invalidateSoulCache();
      invalidateSkillCache();
      const newSoul = await loadSoulMd();
      const loader = await getSkillLoader();
      invalidateSkillCache();
      await loader.discoverSkills();
      emitToolDone(true);
      return { ok: true, message: "Soul and skills reloaded from disk" };
    }

    // --- Memory tools (C Module) ---

    if (name === "memory_add") {
      const args = safeJsonParse<{
        content?: string;
        tags?: string[];
        importance?: number;
        source?: string;
      }>(input.call.argumentsText, {});
      const content = (args.content ?? "").trim();
      if (!content) {
        emitToolDone(false);
        return { ok: false, error: "Missing content" };
      }

      try {
        const db = getDb();
        const memId = uuid();
        const now = new Date();
        const tagsArr = args.tags ?? [];
        const importance = Math.min(5, Math.max(1, args.importance ?? 3));
        const source = (args.source ?? "").trim() || null;

        // First get workspace_id
        const wsRows = await db.execute(
          sql`SELECT workspace_id FROM agents WHERE id = ${this.agentId} LIMIT 1`
        );
        const ws = (wsRows as unknown as Array<{ workspace_id: string }>)[0];
        if (!ws) {
          emitToolDone(false);
          return { ok: false, error: "Agent not found" };
        }

        const nowIso = now.toISOString();
        const tagsSql = tagsArr.length > 0
          ? buildTextArray(tagsArr)
          : sql`ARRAY[]::text[]`;

        await db.execute(
          sql`INSERT INTO memories (id, agent_id, workspace_id, content, tags, created_at, accessed_at, importance, source) VALUES (${memId}, ${this.agentId}, ${ws.workspace_id}, ${content}, ${tagsSql}, ${nowIso}, ${nowIso}, ${importance}, ${source})`
        );

        emitToolDone(true);
        return { ok: true, id: memId };
      } catch (err: unknown) {
        console.error("[memory_add] INSERT failed:", err);
        emitToolDone(false);
        return { ok: false, error: err instanceof Error ? err.message : "Failed to add memory" };
      }
    }

    if (name === "memory_search") {
      const args = safeJsonParse<{
        query?: string;
        tags?: string[];
        limit?: number;
      }>(input.call.argumentsText, {});
      const query = (args.query ?? "").trim();
      if (!query) {
        emitToolDone(false);
        return { ok: false, error: "Missing query" };
      }

      // Free mode: check cache to avoid repeated searches in same cycle (design doc 搂6.5)
      const cacheKey = `${query}:${(args.tags ?? []).sort().join(",")}:${args.limit ?? 10}`;
      const cached = this.memoryCache.get(cacheKey);
      if (cached) {
        emitToolDone(true);
        return { ok: true, memories: cached, count: cached.length, cached: true };
      }

      try {
        const db = getDb();
        const limit = Math.min(50, args.limit ?? 10);
        const filterTags = args.tags ?? [];

        // Layer 1: Keyword + tag exact match (design doc 搂6.1)
        let layer1Rows;
        if (filterTags.length > 0) {
          const filterTagsSql = buildTextArray(filterTags);
          layer1Rows = await db.execute(
            sql`SELECT id, content, tags, importance, source, created_at
                FROM memories WHERE agent_id = ${this.agentId}
                AND (content ILIKE ${`%${query}%`} OR tags && ${filterTagsSql})
                ORDER BY importance DESC, created_at DESC`
          );
        } else {
          layer1Rows = await db.execute(
            sql`SELECT id, content, tags, importance, source, created_at
                FROM memories WHERE agent_id = ${this.agentId}
                AND content ILIKE ${`%${query}%`}
                ORDER BY importance DESC, created_at DESC`
          );
        }

        const layer1 = (layer1Rows as Array<Record<string, unknown>>).map((r) => ({
          id: String(r.id),
          content: String(r.content),
          tags: r.tags as string[] | null,
          importance: Number(r.importance ?? 1),
          source: r.source as string | null,
        }));

        // Layer 2: TagMemo Spike propagation —tag co-occurrence expansion (design doc 搂6.2)
        // Extract tags from layer 1 results, find memories with co-occurring tags
        const layer1Tags = new Set<string>();
        for (const mem of layer1) {
          if (Array.isArray(mem.tags)) {
            for (const t of mem.tags) layer1Tags.add(t);
          }
        }

        let layer2: typeof layer1 = [];
        if (layer1Tags.size > 0) {
          const tagArr = Array.from(layer1Tags);
          // Find memories sharing tags with layer 1 results, excluding layer 1 itself
          const layer1Ids = layer1.map((m) => m.id);
          const spikeThreshold = Math.max(2, Math.floor(limit * 0.3)); // up to 30% extra from spike

          if (layer1Ids.length > 0) {
            // Exclude layer1 IDs using parameterized IN clause
            const excludedIds = layer1Ids.slice(0, 50);
            const tagArrSql = tagArr.length > 0
              ? buildTextArray(tagArr)
              : sql`ARRAY[]::text[]`;
            const layer2Rows = await db.execute(
              sql`SELECT id, content, tags, importance, source, created_at
                  FROM memories WHERE agent_id = ${this.agentId}
                  AND id NOT IN (${sql.join(excludedIds.map((id) => sql`${id}`), sql`, `)})
                  AND tags && ${tagArrSql}
                  ORDER BY importance DESC, created_at DESC
                  LIMIT ${spikeThreshold}`
            );
            layer2 = (layer2Rows as Array<Record<string, unknown>>).map((r) => ({
              id: String(r.id),
              content: String(r.content),
              tags: r.tags as string[] | null,
              importance: Number(r.importance ?? 1),
              source: r.source as string | null,
            }));
          }
        }

        // Merge layer 1 + layer 2, then residual pyramid (dedup by content similarity)
        const merged = [...layer1, ...layer2];
        const seenIds = new Set<string>();
        const deduped: typeof merged = [];
        for (const mem of merged) {
          if (seenIds.has(mem.id)) continue;
          // Simple content dedup: skip if content prefix (first 50 chars) already seen
          const contentKey = mem.content.slice(0, 50).toLowerCase();
          const isDuplicate = deduped.some((d) => d.content.slice(0, 50).toLowerCase() === contentKey);
          if (!isDuplicate) {
            seenIds.add(mem.id);
            deduped.push(mem);
          }
        }

        // Apply limit, sort by importance desc
        const final = deduped
          .sort((a, b) => b.importance - a.importance)
          .slice(0, limit);

        const resultMemories = final.map((m) => ({
          id: m.id,
          content: m.content,
          tags: m.tags,
          importance: m.importance,
          source: m.source,
        }));

        // Cache for free-mode reuse (design doc 搂6.5)
        this.memoryCache.set(cacheKey, resultMemories);

        emitToolDone(true);
        return {
          ok: true,
          memories: resultMemories,
          count: resultMemories.length,
        };
      } catch (err: unknown) {
        emitToolDone(false);
        return { ok: false, error: err instanceof Error ? err.message : "Failed to search memories", memories: [] };
      }
    }

    if (name === "memory_replace") {
      const args = safeJsonParse<{
        id?: string;
        content?: string;
        tags?: string[];
      }>(input.call.argumentsText, {});
      const id = (args.id ?? "").trim();
      const content = (args.content ?? "").trim();
      if (!id || !content) {
        emitToolDone(false);
        return { ok: false, error: "Missing id or content" };
      }

      try {
        const db = getDb();

        if (args.tags) {
          await db.execute(
            sql`UPDATE memories SET content = ${content}, tags = ${args.tags} WHERE id = ${id} AND agent_id = ${this.agentId}`
          );
        } else {
          await db.execute(
            sql`UPDATE memories SET content = ${content} WHERE id = ${id} AND agent_id = ${this.agentId}`
          );
        }

        emitToolDone(true);
        return { ok: true, id };
      } catch (err: unknown) {
        emitToolDone(false);
        return { ok: false, error: err instanceof Error ? err.message : "Failed to update memory" };
      }
    }

    if (name === "memory_remove") {
      const args = safeJsonParse<{ id?: string }>(input.call.argumentsText, {});
      const id = (args.id ?? "").trim();
      if (!id) {
        emitToolDone(false);
        return { ok: false, error: "Missing id" };
      }

      try {
        const db = getDb();
        await db.execute(
          sql`DELETE FROM memories WHERE id = ${id} AND agent_id = ${this.agentId}`
        );
        emitToolDone(true);
        return { ok: true, id };
      } catch (err: unknown) {
        emitToolDone(false);
        return { ok: false, error: err instanceof Error ? err.message : "Failed to remove memory" };
      }
    }

    if (name === "session_search") {
      const args = safeJsonParse<{
        query?: string;
        agentId?: string;
        limit?: number;
      }>(input.call.argumentsText, {});
      const query = (args.query ?? "").trim();
      if (!query) {
        emitToolDone(false);
        return { ok: false, error: "Missing query" };
      }

      try {
        const db = getDb();
        const wsRows = await db.execute(
          sql`SELECT workspace_id FROM agents WHERE id = ${this.agentId} LIMIT 1`
        );
        const ws = (wsRows as unknown as Array<{ workspace_id: string }>)[0];
        if (!ws) {
          emitToolDone(false);
          return { ok: false, error: "Agent not found" };
        }
        const limit = Math.min(50, args.limit ?? 10);

        let rows;
        rows = await db.execute(
          sql`SELECT id, group_id, summary, key_decisions, archived_at
              FROM session_archives
              WHERE workspace_id = ${ws.workspace_id}
              AND (summary ILIKE ${`%${query}%`} OR session_type ILIKE ${`%${query}%`})
              ORDER BY archived_at DESC LIMIT ${limit}`
        );

        const sessions = (rows as Array<Record<string, unknown>>).map((r) => ({
          id: r.id,
          groupId: r.group_id,
          summary: r.summary,
          keyDecisions: r.key_decisions,
          archivedAt: r.archived_at,
        }));

        emitToolDone(true);
        return { ok: true, sessions, count: sessions.length };
      } catch (err: unknown) {
        emitToolDone(false);
        return { ok: false, error: err instanceof Error ? err.message : "Failed to search sessions", sessions: [] };
      }
    }

    if (name === "create_backup") {
      try {
        const { store } = await import("@/lib/storage");
        const result = await store.backupWorkspace({ workspaceId });
        emitToolDone(true);
        return { ok: true, backupId: result.id, createdAt: result.createdAt };
      } catch (err: unknown) {
        emitToolDone(false);
        return { ok: false, error: err instanceof Error ? err.message : "Failed to create backup" };
      }
    }

    if (name === "list_backups") {
      try {
        const { store } = await import("@/lib/storage");
        const backups = await store.listBackups({ workspaceId });
        emitToolDone(true);
        return { ok: true, backups };
      } catch (err: unknown) {
        emitToolDone(false);
        return { ok: false, error: err instanceof Error ? err.message : "Failed to list backups" };
      }
    }

    if (name === "restore_backup") {
      const args = safeJsonParse<{ backupId?: string; confirm?: boolean }>(input.call.argumentsText, {});
      const backupId = (args.backupId ?? "").trim();
      if (!backupId) {
        emitToolDone(false);
        return { ok: false, error: "Missing backupId" };
      }
      if (!args.confirm) {
        emitToolDone(false);
        return { ok: false, error: "Must set confirm=true to restore. This operation is irreversible." };
      }

      try {
        const { store } = await import("@/lib/storage");
        const result = await store.restoreBackup({ backupId });
        emitToolDone(true);
        return { ok: true, workspaceId: result.workspaceId, restoredAt: result.restoredAt };
      } catch (err: unknown) {
        emitToolDone(false);
        return { ok: false, error: err instanceof Error ? err.message : "Failed to restore backup" };
      }
    }

    if (name === "dispatch_pipeline") {
      const args = safeJsonParse<{ stages?: Array<{ name?: string; role?: string; dependsOn?: string[]; input?: string }> }>(input.call.argumentsText, {});
      if (!args.stages || args.stages.length === 0) {
        emitToolDone(false);
        return { ok: false, error: "Missing stages: provide at least one pipeline stage with name, role, dependsOn, and input" };
      }
      for (const stage of args.stages) {
        if (!stage.name || !stage.role || !stage.input) {
          emitToolDone(false);
          return { ok: false, error: "Each stage requires name, role, and input fields" };
        }
        if (!stage.dependsOn) stage.dependsOn = [];
      }

      const { getPipelineDispatcher } = await import("./pipeline-dispatcher");
      const dispatcher = getPipelineDispatcher();
      const pipelineResult = await dispatcher.execute({
        workflowId: input.groupId,
        groupId: input.groupId,
        stages: args.stages.map(s => ({ name: s.name!, role: s.role!, dependsOn: s.dependsOn!, input: s.input! })),
      });

      emitToolDone(pipelineResult.overallStatus !== "failed");
      return {
        ok: pipelineResult.overallStatus !== "failed",
        pipelineId: pipelineResult.pipelineId,
        status: pipelineResult.overallStatus,
        stages: pipelineResult.stages.map(s => ({ name: s.stageName, status: s.status, output: s.output.slice(0, 500) })),
      };
    }

    if (name === "ask_user") {
      const args = safeJsonParse<{
        question?: string;
        options?: Array<{ label?: string; description?: string }>;
      }>(input.call.argumentsText, {});
      const question = (args.question ?? "").trim();
      const options = (args.options ?? []).filter((o) => o?.label?.trim());
      if (!question || options.length === 0) {
        emitToolDone(false);
        return { ok: false, error: "Missing required fields: question and options (with at least one option containing a label)" };
      }

      // Send the question as a structured message to the group
      const questionPayload = JSON.stringify({ question, options: options.map((o) => ({ label: o.label!.trim(), description: o.description?.trim() })) });
      try {
        const result = await store.sendMessage({
          groupId: input.groupId,
          senderId: this.agentId,
          content: questionPayload,
          contentType: "question",
        });
        const memberIds = await store.listGroupMemberIds({ groupId: input.groupId });
        getWorkspaceUIBus().emit(workspaceId, {
          event: "ui.message.created",
          data: {
            workspaceId,
            groupId: input.groupId,
            memberIds,
            message: { id: result.id, senderId: this.agentId, sendTime: result.sendTime },
          },
        });
      } catch (err) {
        emitToolDone(false);
        return { ok: false, error: `Failed to send question: ${err instanceof Error ? err.message : String(err)}` };
      }

      // Set flag to pause the agent loop after this round
      this.pendingUserQuestion = true;
      emitToolDone(true);
      return { ok: true, status: "waiting_for_user", message: "Question sent to user. Waiting for response." };
    }

    const mcp = await getMcpRegistry(BUILTIN_TOOL_NAMES);
    if (mcp.hasTool(name)) {
      const args = safeJsonParse<Record<string, unknown>>(input.call.argumentsText, {});
      const result = await mcp.callTool(name, args);
      emitToolDone(result.ok);

      // Per-turn file-mutation verifier: after file-write operations,
      // read back the file to confirm content was actually persisted.
      // (design doc 搂11.5 —file-mutation verifier)
      const fileWriteTools = new Set(["write_file", "edit_file", "write", "str_replace_editor", "write_to_file", "create_file"]);
      if (fileWriteTools.has(name) && result.ok && result.content) {
        void this.verifyFileMutation(args, result.content);
      }

      return result;
    }

    emitToolDone(false);
    return { ok: false, error: `Unknown tool: ${name}` };
  }

  /**
   * Extract deltas from assembler state changes (reasoning, content, tool calls)
   * and emit bus + stream events for each.
   */
  private processSseDeltas(
    prevState: StreamAssembledState,
    nextState: StreamAssembledState,
    ctx: { workspaceId: UUID; groupId: UUID; round: number },
    rawEvt: unknown
  ): StreamAssembledState {
    const reasoningDelta = nextState.reasoningContent.slice(prevState.reasoningContent.length);
    const contentDelta = nextState.content.slice(prevState.content.length);
    const toolCallDeltas = extractToolCallDeltas(rawEvt as any, prevState, nextState);

    if (reasoningDelta) {
      this.bus.emit(this.agentId, { event: "agent.stream", data: { kind: "reasoning", delta: reasoningDelta } });
      void appendAgentStreamEvent({ agentId: this.agentId, round: ctx.round, kind: "reasoning", delta: reasoningDelta });
    }
    if (contentDelta) {
      this.bus.emit(this.agentId, { event: "agent.stream", data: { kind: "content", delta: contentDelta } });
      void appendAgentStreamEvent({ agentId: this.agentId, round: ctx.round, kind: "content", delta: contentDelta });
    }
    for (const delta of toolCallDeltas) {
      this.bus.emit(this.agentId, { event: "agent.stream", data: { kind: "tool_calls", delta: delta.delta, tool_call_id: delta.tool_call_id, tool_call_name: delta.tool_call_name } });
      void appendAgentStreamEvent({ agentId: this.agentId, round: ctx.round, kind: "tool_calls", delta: delta.delta, tool_call_id: delta.tool_call_id, tool_call_name: delta.tool_call_name });
    }

    return nextState;
  }

  /**
   * Run the SSE event loop, emitting deltas to bus + DB as they arrive.
   * Returns the final assembled state.
   */
  private async runSseLoop(
    body: ReadableStream<Uint8Array>,
    assembler: { push(evt: unknown): StreamAssembledState; snapshot(): StreamAssembledState },
    ctx: { workspaceId: UUID; groupId: UUID; round: number }
  ): Promise<StreamAssembledState> {
    let prev = assembler.snapshot();
    for await (const evt of parseSSEJsonLines(body)) {
      prev = this.processSseDeltas(prev, assembler.push(evt as any), ctx, evt);
    }
    return prev;
  }

  /** Emit agent.done events + DB bookkeeping after SSE loop completes. */
  private emitAgentDone(
    ctx: { workspaceId: UUID; groupId: UUID; round: number },
    finishReason: string | null
  ) {
    this.bus.emit(this.agentId, { event: "agent.done", data: { finishReason: finishReason ?? undefined } });
    void appendAgentStreamEvent({ agentId: this.agentId, round: ctx.round, kind: "done", finishReason });
    getWorkspaceUIBus().emit(ctx.workspaceId, { event: "ui.agent.llm.done", data: { workspaceId: ctx.workspaceId, agentId: this.agentId, groupId: ctx.groupId, round: ctx.round, finishReason: finishReason ?? undefined } });
  }

  /** Save token usage to group context (best-effort). */
  private async saveTokenUsage(groupId: UUID, totalTokens: number) {
    if (totalTokens <= 0) return;
    try {
      await store.setGroupContextTokens({ groupId, tokens: totalTokens });
    } catch { /* Best effort */ }
  }

  private async callLlmStreaming(
    history: HistoryMessage[],
    ctx: { workspaceId: UUID; groupId: UUID; round: number }
  ) {
    // Circuit breaker: skip if too many consecutive failures
    if (isLlmCircuitOpen()) {
      console.warn(`[callLlmStreaming] circuit breaker open —skipping LLM call`);
      throw new Error("LLM circuit breaker open: too many consecutive failures");
    }

    const chain = getProviderChain();
    const errors: string[] = [];
    const startTime = Date.now();

    for (let i = 0; i < chain.length; i++) {
      const provider = chain[i];
      const isFallback = i > 0;
      try {
        const result = await this.callLlmProvider(provider, history, ctx);
        recordLlmSuccess();

        // Record metrics (fire-and-forget)
        const latencyMs = Date.now() - startTime;
        const model = this.getModelForProvider(provider);
        const usage = result.usage;
        void getMetricsCollector().recordLLMRequest({
          requestId: crypto.randomUUID(),
          agentId: this.agentId,
          groupId: ctx.groupId,
          workspaceId: ctx.workspaceId,
          provider,
          model,
          isFallback,
          tokensPrompt: usage?.promptTokens ?? 0,
          tokensCompletion: usage?.completionTokens ?? 0,
          tokensTotal: usage?.totalTokens ?? 0,
          tokensCached: 0,
          latencyMs,
          queueWaitMs: 0,
          finishReason: result.finishReason ?? "stop",
          toolCallCount: result.toolCalls.length,
          costUsd: usage ? estimateCost(model, usage.promptTokens, usage.completionTokens) : 0,
        });

        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Only retry on 429 (rate limit). 401/403/500 are fatal - no point wasting tokens on fallback.
        const is429 = msg.includes("429");

        // Record error metrics (fire-and-forget)
        const latencyMs = Date.now() - startTime;
        const model = this.getModelForProvider(provider);
        void getMetricsCollector().recordLLMRequest({
          requestId: crypto.randomUUID(),
          agentId: this.agentId,
          groupId: ctx.groupId,
          workspaceId: ctx.workspaceId,
          provider,
          model,
          isFallback,
          tokensPrompt: 0,
          tokensCompletion: 0,
          tokensTotal: 0,
          tokensCached: 0,
          latencyMs,
          queueWaitMs: 0,
          finishReason: "error",
          toolCallCount: 0,
          errorMessage: msg,
          costUsd: 0,
        });

        if (!is429) throw err;
        recordLlmFailure();
        errors.push(`${provider}: ${msg}`);
        console.warn(`[callLlmStreaming] ${provider} 429, trying next provider. Chain: ${chain.join(" → ")}`);
        // Keep streaming to the UI so the user sees the fallback
        getWorkspaceUIBus().emit(ctx.workspaceId, {
          event: "ui.agent.llm.fallback",
          data: {
            workspaceId: ctx.workspaceId,
            agentId: this.agentId,
            groupId: ctx.groupId,
            from: provider,
            to: chain[chain.indexOf(provider) + 1] ?? "none",
          },
        });
      }
    }

    throw new Error(`All providers returned 429: ${errors.join("; ")}`);
  }

  /** Resolve the active model name for a given provider (best-effort, never throws). */
  private getModelForProvider(provider: string): string {
    try {
      switch (provider) {
        case "glm": return getGlmConfig().model;
        case "openrouter": return getOpenRouterConfig().model;
        case "anthropic": return getAnthropicConfig().model;
        case "ollama": return getOllamaConfig().model;
        case "freellmapi": return getFreellmapiConfig().model;
        default: return "unknown";
      }
    } catch {
      return "unknown";
    }
  }

  private async callLlmProvider(
    provider: LlmProvider,
    history: HistoryMessage[],
    ctx: { workspaceId: UUID; groupId: UUID; round: number }
  ) {
    const handler = getProviderHandler(provider);
    if (!handler) {
      throw new Error(`Unknown LLM provider: "${provider}". Add it to PROVIDER_REGISTRY.`);
    }
    return handler(this, history, ctx);
  }

  /* internal */ async callOpenRouterStreaming(
    history: HistoryMessage[],
    ctx: { workspaceId: UUID; groupId: UUID; round: number }
  ) {
    const { apiKey, baseUrl, model, backupModel, httpReferer, appTitle, keyPool } = getOpenRouterConfig();

    getWorkspaceUIBus().emit(ctx.workspaceId, {
      event: "ui.agent.llm.start",
      data: {
        workspaceId: ctx.workspaceId,
        agentId: this.agentId,
        groupId: ctx.groupId,
        round: ctx.round,
      },
    });
    void appendAgentStreamEvent({
      agentId: this.agentId,
      round: ctx.round,
      kind: "start",
    });

    const tools = await getAgentTools(this.toolContext ?? undefined);
    const payload: Record<string, unknown> = {
      // Preserve reasoning for OpenRouter using the canonical "reasoning" field.
      messages: mapOpenRouterMessages(history),
      stream: true,
      stream_options: { include_usage: true },
    };
    if (model) payload.model = model;
    if (tools.length > 0) {
      payload.tools = tools;
      payload.tool_choice = "auto";
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    if (httpReferer) headers["HTTP-Referer"] = httpReferer;
    if (appTitle) headers["X-Title"] = appTitle;

    const requestBody = JSON.stringify(payload);
    void appendAgentLlmRequestRaw({ agentId: this.agentId, body: requestBody });

    const upstream = await llmFetch(baseUrl, {
      method: "POST",
      headers,
      body: requestBody,
    }, "OpenRouter", { backupModel, keyPool });

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => "");
      if (upstream.status === 429) {
        getWorkspaceUIBus().emit(ctx.workspaceId, {
          event: "llm.429",
          data: { agentId: this.agentId, workspaceId: ctx.workspaceId, retryAfter: 30 },
        });
      }
      throw new Error(`OpenRouter upstream error: ${upstream.status} ${text}`);
    }

    const assembler = new OpenAIStreamAssembler();
    const finalState = await this.runSseLoop(upstream.body, assembler, ctx);

    this.emitAgentDone(ctx, finalState.finishReason ?? null);
    await this.saveTokenUsage(ctx.groupId, finalState.usage?.totalTokens ?? 0);

    return {
      assistantText: finalState.content,
      assistantThinking: finalState.reasoningContent,
      toolCalls: (finalState.toolCalls ?? []) as ToolCall[],
      finishReason: finalState.finishReason ?? null,
      usage: finalState.usage ?? null,
    };
  }

  /* internal */ async callAnthropicStreaming(
    history: HistoryMessage[],
    ctx: { workspaceId: UUID; groupId: UUID; round: number }
  ) {
    const { apiKey, baseUrl, model, backupModel, keyPool } = getAnthropicConfig();

    getWorkspaceUIBus().emit(ctx.workspaceId, {
      event: "ui.agent.llm.start",
      data: {
        workspaceId: ctx.workspaceId,
        agentId: this.agentId,
        groupId: ctx.groupId,
        round: ctx.round,
      },
    });
    void appendAgentStreamEvent({
      agentId: this.agentId,
      round: ctx.round,
      kind: "start",
    });

    const tools = await getAgentTools(this.toolContext ?? undefined);

    // --- Anthropic Prompt Caching ---
    // Separate system messages from conversation, send as `system` param with cache_control.
    // Strategy: "system_and_3" —cache breakpoints on system prompt + last 3 messages.
    const systemMessages = history.filter((m) => m.role === "system");
    const chatMessages = history.filter((m) => m.role !== "system");

    // Build system parameter with cache_control (Anthropic API requirement)
    const systemParam = systemMessages.map((m) => ({
      type: "text" as const,
      text: typeof m.content === "string" ? m.content : String(m.content ?? ""),
      cache_control: { type: "ephemeral" as const },
    }));

    // Build messages array with cache_control on last 3 chat messages
    // Convert image_url (OpenAI format) to image (Anthropic format) for multimodal content
    const messages = chatMessages.map((msg, i) => {
      let content = msg.content;
      if (Array.isArray(content)) {
        content = (content as MultimodalContentPart[]).map((part) => {
          if (part.type === "image_url" && part.image_url?.url?.startsWith("data:")) {
            const url = part.image_url.url;
            const [header, data] = url.split(",");
            const mediaType = header.replace("data:", "").replace(";base64", "");
            return {
              type: "image" as const,
              source: { type: "base64" as const, media_type: mediaType, data },
            };
          }
          return part;
        }) as unknown as MultimodalContentPart[];
      }
      return {
        role: msg.role as "user" | "assistant",
        content,
        ...(i >= chatMessages.length - 3 ? { cache_control: { type: "ephemeral" as const } } : {}),
      };
    });

    const payload: Record<string, unknown> = {
      model,
      messages,
      max_tokens: 8192,
      stream: true,
    };
    if (systemParam.length > 0) {
      payload.system = systemParam;
    }
    if (tools.length > 0) {
      payload.tools = tools.map((t: any) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));
    }

    const requestBody = JSON.stringify(payload);
    void appendAgentLlmRequestRaw({ agentId: this.agentId, body: requestBody });

    const headers: Record<string, string> = {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "prompt-caching-2024-07-31",
    };

    const upstream = await llmFetch(baseUrl, {
      method: "POST",
      headers,
      body: requestBody,
    }, "Anthropic", { backupModel, keyPool });

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => "");
      if (upstream.status === 429) {
        getWorkspaceUIBus().emit(ctx.workspaceId, {
          event: "llm.429",
          data: { agentId: this.agentId, workspaceId: ctx.workspaceId, retryAfter: 30 },
        });
      }
      throw new Error(`Anthropic upstream error: ${upstream.status} ${text}`);
    }

    const decoder = new TextDecoder();
    let contentDelta = "";
    const toolCalls: ToolCall[] = [];
    let currentToolId = "";
    let currentToolName = "";
    let currentToolArgs = "";
    let buffer = "";

    const reader = upstream.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;

        try {
          const data = JSON.parse(trimmed.slice(6));
          if (data.type === "content_block_delta") {
            if (data.delta?.type === "text_delta") {
              contentDelta += data.delta.text;
              this.bus.emit(this.agentId, {
                event: "agent.stream",
                data: { kind: "content", delta: data.delta.text },
              });
              void appendAgentStreamEvent({
                agentId: this.agentId,
                round: ctx.round,
                kind: "content",
                delta: data.delta.text,
              });
            } else if (data.delta?.type === "input_json_delta") {
              currentToolArgs += data.delta.partial_json;
            }
          } else if (data.type === "content_block_start") {
            if (data.content_block?.type === "tool_use") {
              currentToolId = data.content_block.id;
              currentToolName = data.content_block.name;
              currentToolArgs = "";
              this.bus.emit(this.agentId, {
                event: "agent.stream",
                data: {
                  kind: "tool_calls",
                  delta: JSON.stringify({ name: currentToolName, id: currentToolId }),
                  tool_call_id: currentToolId,
                  tool_call_name: currentToolName,
                },
              });
              void appendAgentStreamEvent({
                agentId: this.agentId,
                round: ctx.round,
                kind: "tool_calls",
                delta: JSON.stringify({ name: currentToolName, id: currentToolId }),
                tool_call_id: currentToolId,
                tool_call_name: currentToolName,
              });
            }
          } else if (data.type === "content_block_stop") {
            if (currentToolId && currentToolName) {
              toolCalls.push({
                index: toolCalls.length,
                id: currentToolId,
                name: currentToolName,
                argumentsText: currentToolArgs,
              });
            }
            currentToolId = "";
            currentToolName = "";
            currentToolArgs = "";
          } else if (data.type === "message_delta") {
            // stop_reason available here
          } else if (data.type === "message_start") {
            // message started
          }
        } catch {
          // skip malformed SSE data
        }
      }
    }
    reader.releaseLock();

    const finishReason = toolCalls.length > 0 ? "tool_calls" : "stop";

    this.bus.emit(this.agentId, {
      event: "agent.done",
      data: { finishReason },
    });
    void appendAgentStreamEvent({
      agentId: this.agentId,
      round: ctx.round,
      kind: "done",
      finishReason,
    });
    getWorkspaceUIBus().emit(ctx.workspaceId, {
      event: "ui.agent.llm.done",
      data: {
        workspaceId: ctx.workspaceId,
        agentId: this.agentId,
        groupId: ctx.groupId,
        round: ctx.round,
        finishReason,
      },
    });

    return {
      assistantText: contentDelta,
      assistantThinking: "",
      toolCalls,
      finishReason,
      usage: null,
    };
  }

  /* internal */ async callGlmStreaming(
    history: HistoryMessage[],
    ctx: { workspaceId: UUID; groupId: UUID; round: number }
  ) {
    const { apiKey, baseUrl, model, backupModel, keyPool } = getGlmConfig();

    getWorkspaceUIBus().emit(ctx.workspaceId, {
      event: "ui.agent.llm.start",
      data: {
        workspaceId: ctx.workspaceId,
        agentId: this.agentId,
        groupId: ctx.groupId,
        round: ctx.round,
      },
    });
    void appendAgentStreamEvent({
      agentId: this.agentId,
      round: ctx.round,
      kind: "start",
    });

    const glmPayload: Record<string, unknown> = {
      model,
      messages: history,
      tools: await getAgentTools(this.toolContext ?? undefined),
      tool_choice: "auto",
      stream: true,
      tool_stream: true,
    };
    const requestBody = JSON.stringify(glmPayload);
    void appendAgentLlmRequestRaw({ agentId: this.agentId, body: requestBody });

    const upstream = await llmFetch(baseUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: requestBody,
    }, "GLM", { backupModel, keyPool });

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => "");
      // Emit 429 rate-limit event for UI notification
      if (upstream.status === 429) {
        getWorkspaceUIBus().emit(ctx.workspaceId, {
          event: "llm.429",
          data: { agentId: this.agentId, workspaceId: ctx.workspaceId, retryAfter: 30 },
        });
      }
      throw new Error(`GLM upstream error: ${upstream.status} ${text}`);
    }

    const assembler = new GLMStreamAssembler();
    const finalState = await this.runSseLoop(upstream.body, assembler, ctx);

    this.emitAgentDone(ctx, finalState.finishReason ?? null);
    await this.saveTokenUsage(ctx.groupId, finalState.usage?.totalTokens ?? 0);

    return {
      assistantText: finalState.content,
      assistantThinking: finalState.reasoningContent,
      toolCalls: (finalState.toolCalls ?? []) as ToolCall[],
      finishReason: finalState.finishReason ?? null,
      usage: finalState.usage ?? null,
    };
  }

  /* internal */ async callOllamaStreaming(
    history: HistoryMessage[],
    ctx: { workspaceId: UUID; groupId: UUID; round: number }
  ) {
    const { baseUrl, model, backupModel } = getOllamaConfig();

    getWorkspaceUIBus().emit(ctx.workspaceId, {
      event: "ui.agent.llm.start",
      data: {
        workspaceId: ctx.workspaceId,
        agentId: this.agentId,
        groupId: ctx.groupId,
        round: ctx.round,
      },
    });
    void appendAgentStreamEvent({
      agentId: this.agentId,
      round: ctx.round,
      kind: "start",
    });

    const tools = await getAgentTools(this.toolContext ?? undefined);
    const payload: Record<string, unknown> = {
      messages: mapOpenRouterMessages(history),
      model,
      stream: true,
      stream_options: { include_usage: true },
    };
    if (tools.length > 0) {
      payload.tools = tools;
      payload.tool_choice = "auto";
    }

    const requestBody = JSON.stringify(payload);
    void appendAgentLlmRequestRaw({ agentId: this.agentId, body: requestBody });

    const upstream = await llmFetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: requestBody,
    }, "Ollama", { backupModel });

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => "");
      if (upstream.status === 429) {
        getWorkspaceUIBus().emit(ctx.workspaceId, {
          event: "llm.429",
          data: { agentId: this.agentId, workspaceId: ctx.workspaceId, retryAfter: 30 },
        });
      }
      throw new Error(`Ollama upstream error: ${upstream.status} ${text}`);
    }

    const assembler = new OpenAIStreamAssembler();
    const finalState = await this.runSseLoop(upstream.body, assembler, ctx);

    this.emitAgentDone(ctx, finalState.finishReason ?? null);
    await this.saveTokenUsage(ctx.groupId, finalState.usage?.totalTokens ?? 0);

    return {
      assistantText: finalState.content,
      assistantThinking: finalState.reasoningContent,
      toolCalls: (finalState.toolCalls ?? []) as ToolCall[],
      finishReason: finalState.finishReason ?? null,
      usage: finalState.usage ?? null,
    };
  }

  /* internal */ async callFreellmapiStreaming(
    history: HistoryMessage[],
    ctx: { workspaceId: UUID; groupId: UUID; round: number }
  ) {
    const { baseUrl, apiKey, model, keyPool } = getFreellmapiConfig();

    getWorkspaceUIBus().emit(ctx.workspaceId, {
      event: "ui.agent.llm.start",
      data: {
        workspaceId: ctx.workspaceId,
        agentId: this.agentId,
        groupId: ctx.groupId,
        round: ctx.round,
      },
    });
    void appendAgentStreamEvent({
      agentId: this.agentId,
      round: ctx.round,
      kind: "start",
    });

  const tools = await getAgentTools(this.toolContext ?? undefined);
  const payload: Record<string, unknown> = {
    messages: mapOpenRouterMessages(history),
    stream: true,
    max_tokens: 4096,
    temperature: 0.7,
  };
    if (model) payload.model = model;
    if (tools.length > 0) {
      payload.tools = tools;
      payload.tool_choice = "auto";
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const requestBody = JSON.stringify(payload);
    void appendAgentLlmRequestRaw({ agentId: this.agentId, body: requestBody });

    const upstream = await llmFetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: requestBody,
    }, "FreeLLMAPI", { keyPool });

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => "");
      if (upstream.status === 429) {
        getWorkspaceUIBus().emit(ctx.workspaceId, {
          event: "llm.429",
          data: { agentId: this.agentId, workspaceId: ctx.workspaceId, retryAfter: 30 },
        });
      }
      throw new Error(`FreeLLMAPI upstream error: ${upstream.status} ${text}`);
    }

    const assembler = new OpenAIStreamAssembler();
    const finalState = await this.runSseLoop(upstream.body, assembler, ctx);

    this.emitAgentDone(ctx, finalState.finishReason ?? null);
    await this.saveTokenUsage(ctx.groupId, finalState.usage?.totalTokens ?? 0);

    return {
      assistantText: finalState.content,
      assistantThinking: finalState.reasoningContent,
      toolCalls: (finalState.toolCalls ?? []) as ToolCall[],
      finishReason: finalState.finishReason ?? null,
      usage: finalState.usage ?? null,
    };
  }
}

function extractToolCallDeltas(
  chunk: {
    choices?: Array<{
      delta?: {
        tool_calls?: Array<{
          index?: number;
          id?: string;
          function?: { name?: string; arguments?: string };
        }>;
      };
    }>;
  },
  prevState: { toolCalls: Array<{ index: number; id?: string; name?: string; argumentsText: string }> },
  nextState: { toolCalls: Array<{ index: number; id?: string; name?: string; argumentsText: string }> }
): Array<{ delta: string; tool_call_id?: string; tool_call_name?: string }> {
  const deltas: Array<{ delta: string; tool_call_id?: string; tool_call_name?: string }> = [];
  const toolCalls = chunk.choices?.[0]?.delta?.tool_calls ?? [];
  if (toolCalls.length === 0) return deltas;

  const prevByIndex = new Map(prevState.toolCalls.map((call) => [call.index, call]));
  const nextByIndex = new Map(nextState.toolCalls.map((call) => [call.index, call]));

  for (const call of toolCalls) {
    const index = call.index ?? 0;
    const prev = prevByIndex.get(index);
    const next = nextByIndex.get(index);
    const name = call.function?.name ?? next?.name;
    const id = call.id ?? next?.id;
    const argsChunk = call.function?.arguments ?? "";

    if (argsChunk) {
      deltas.push({ delta: argsChunk, tool_call_id: id, tool_call_name: name });
      continue;
    }

    if (name && name !== prev?.name) {
      deltas.push({ delta: "", tool_call_id: id, tool_call_name: name });
    }
  }

  return deltas;
}

export class AgentRuntime {
  private readonly runners = new Map<UUID, AgentRunner>();
  public readonly bus = new AgentEventBus();
  private bootstrapped = false;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  static readonly VERSION = 3;
  private static readonly RUNNER_IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 min idle timeout
  private static readonly CLEANUP_INTERVAL_MS = 60 * 1000; // 1 min cleanup interval

  async bootstrap(workspaceId?: UUID) {
    if (this.bootstrapped) return;
    this.bootstrapped = true;

    // Start periodic cleanup timer
    this.startCleanupTimer();

    // Start observability metrics timers (hourly rollup, daily cost, alert eval)
    getMetricsCollector().startTimers();

    const agents = workspaceId
      ? await store.listAgents({ workspaceId })
      : await store.listAgents();
    for (const a of agents) {
      if (a.role === "human") continue;
      this.ensureRunner(a.id);
    }
  }

  private startCleanupTimer() {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      this.cleanupIdleRunners();
    }, AgentRuntime.CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref(); // Don't keep process alive
  }

  private cleanupIdleRunners() {
    const now = Date.now();
    let cleaned = 0;
    for (const [id, runner] of this.runners) {
      if (runner.isIdleTooLong(AgentRuntime.RUNNER_IDLE_TIMEOUT_MS)) {
        this.stopRunner(id);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      console.info(`[AgentRuntime] Cleaned up ${cleaned} idle runners, ${this.runners.size} remaining`);
    }
  }

  ensureRunner(agentId: UUID) {
    const existing = this.runners.get(agentId);
    if (existing) return existing;
    const runner = new AgentRunner(
      agentId,
      this.bus,
      (id) => {
        this.ensureRunner(id);
      },
      (id) => {
        this.ensureRunner(id).wakeup("manual");
      },
      (id) => {
        this.stopRunner(id);
      }
    );
    this.runners.set(agentId, runner);
    runner.start();
    return runner;
  }

  async wakeAgentsForGroup(groupId: UUID, senderId: UUID) {
    await this.bootstrap();
    const memberIds = await store.listGroupMemberIds({ groupId });
    console.info(`[wakeAgentsForGroup] group=${groupId}, members=${memberIds.join(",")}, sender=${senderId}`);

    // Selective wakeup: only wake coordinator, not workers
    // Workers are woken by the coordinator via assign_agent or send_group_message
    // This saves 70%+ token waste from unnecessary worker LLM calls.
    const coordinatorId = await this.findCoordinator(groupId);

    if (coordinatorId && coordinatorId !== senderId) {
      try {
        const role = await store.getAgentRole({ agentId: coordinatorId });
        if (role !== "human" && role !== null) {
          console.info(`[wakeAgentsForGroup] Waking coordinator ${coordinatorId} (${role}) immediately`);
          this.ensureRunner(coordinatorId).wakeup("group_message");
          return; // workers will be woken by coordinator's response (send_group_message)
        }
      } catch (err) {
        console.error(`[wakeAgentsForGroup] Failed to wake coordinator ${coordinatorId}:`, err);
      }
    }

    // If no coordinator found, wake all non-human members (legacy fallback)
    for (const memberId of memberIds) {
      if (memberId === senderId) continue;
      const role = await store.getAgentRole({ agentId: memberId }).catch(() => null);
      if (role === "human" || role === null) continue;
      this.ensureRunner(memberId).wakeup("group_message");
    }
  }

  /**
   * Find the coordinator (group creator) for a given group.
   */
  private async findCoordinator(groupId: UUID): Promise<string | null> {
    try {
      const db = getDb();
      const rows = await db.execute(
        sql`SELECT creator_id FROM groups WHERE id = ${groupId} LIMIT 1`
      );
      const result = (rows as unknown as Array<{ creator_id: string }>)[0];
      return result?.creator_id ?? null;
    } catch {
      return null;
    }
  }

  async wakeAgent(agentId: UUID, reason: "direct_message" | "context_stream" = "direct_message") {
    await this.bootstrap();
    const role = await store.getAgentRole({ agentId }).catch(() => null);
    if (role === "human" || role === null) return;
    this.ensureRunner(agentId).wakeup(reason);
  }


  /**
   * Wake an agent with a pipeline instruction (Phase 1 - deterministic execution).
   * Instead of reading group messages, the agent processes the pipeline instruction directly.
   */
  async wakeAgentWithPipeline(agentId: UUID, input: { groupId: UUID; pipelineInstruction: string; stageName: string; toolGroups?: string[] }) {
    await this.bootstrap();
    const role = await store.getAgentRole({ agentId }).catch(() => null);
    if (role === "human" || role === null) return;
    // Stop any existing runner
    this.stopRunner(agentId);
    // Create a fresh runner with pipeline context
    const newRunner = this.ensureRunner(agentId);
    console.info(`[wakeAgentWithPipeline] set pipeline context for agent=${agentId.slice(0,8)} stage=${input.stageName}`);
    newRunner.setPipelineContext({
      groupId: input.groupId,
      instruction: input.pipelineInstruction,
      stageName: input.stageName,
      toolGroups: input.toolGroups,
    });
    // Set pipeline context first, then start the loop
    newRunner.start();
    // Give the loop time to enter Promise.race before waking
    await new Promise(r => setTimeout(r, 100));
    newRunner.wakeup("direct_message");
  }
  async interruptAll(input?: { workspaceId?: UUID }) {
    await this.bootstrap();
    const workspaceId = input?.workspaceId?.trim();
    const agents = await store.listAgents(workspaceId ? { workspaceId } : undefined);
    const agentIds = agents.filter((agent) => agent.role !== "human").map((agent) => agent.id);

    for (const agentId of agentIds) {
      this.ensureRunner(agentId).requestInterrupt();
    }

    return { interrupted: agentIds.length, agentIds };
  }

  /** Resume a single agent by clearing its interrupt flag. */
  resumeAgent(agentId: UUID) {
    const runner = this.runners.get(agentId);
    if (runner) {
      runner.clearInterrupt();
    }
  }

  /** Resume all agents in a workspace by clearing their interrupt flags. */
  async resumeAll(input?: { workspaceId?: UUID }) {
    await this.bootstrap();
    const workspaceId = input?.workspaceId?.trim();
    const agents = await store.listAgents(workspaceId ? { workspaceId } : undefined);
    const agentIds = agents.filter((agent) => agent.role !== "human").map((agent) => agent.id);

    for (const agentId of agentIds) {
      const runner = this.runners.get(agentId);
      if (runner) {
        runner.clearInterrupt();
      }
    }

    return { resumed: agentIds.length, agentIds };
  }

  stopRunner(agentId: UUID) {
    const runner = this.runners.get(agentId);
    if (runner) {
      runner.requestInterrupt();
      this.runners.delete(agentId);
    }
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __agentWechatRuntime: AgentRuntime | undefined;
  // eslint-disable-next-line no-var
  var __agentWechatRuntimeVersion: number | undefined;
}

export function getAgentRuntime() {
  if (
    globalThis.__agentWechatRuntime &&
    globalThis.__agentWechatRuntimeVersion === AgentRuntime.VERSION
  ) {
    return globalThis.__agentWechatRuntime;
  }

  globalThis.__agentWechatRuntime = new AgentRuntime();
  globalThis.__agentWechatRuntimeVersion = AgentRuntime.VERSION;
  return globalThis.__agentWechatRuntime;
}
