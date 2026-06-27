import { uuid, UUID } from "./agent-types";
import { getDb } from "@/db";
import { sql } from "drizzle-orm";
import { store } from "@/lib/storage";
import { getAgentRuntime } from "./agent-runtime";
import { safeJsonParse } from "./utils";
import { getWorkspaceUIBus } from "./ui-bus";

export type PipelineStageDef = {
  name: string;
  role: string;
  dependsOn: string[];
  input: string;
  toolGroups?: string[];
};

export type PipelineTaskDef = {
  workflowId: UUID;
  groupId: UUID;
  stages: PipelineStageDef[];
  reviewAfterStages?: string[];
};

export type StageResult = {
  stageName: string;
  status: "done" | "failed" | "review_requested";
  output: string;
  agentId: UUID | null;
  startedAt: Date;
  completedAt: Date | null;
  error: string | null;
};

export type PipelineResult = {
  pipelineId: UUID;
  workflowId: UUID;
  groupId: UUID;
  stages: StageResult[];
  overallStatus: "done" | "failed" | "partial";
  startedAt: Date;
  completedAt: Date | null;
};

const STAGE_TIMEOUT_MS = 10 * 60 * 1000;

export class PipelineDispatcher {
  private static instance: PipelineDispatcher | null = null;
  private activePipelines = new Map<UUID, PipelineResult>();

  static getInstance(): PipelineDispatcher {
    if (!PipelineDispatcher.instance) {
      PipelineDispatcher.instance = new PipelineDispatcher();
    }
    return PipelineDispatcher.instance;
  }

  async execute(taskDef: PipelineTaskDef): Promise<PipelineResult> {
    const pipelineId = uuid();
    const startedAt = new Date();
    const result: PipelineResult = {
      pipelineId,
      workflowId: taskDef.workflowId,
      groupId: taskDef.groupId,
      stages: taskDef.stages.map((s) => ({
        stageName: s.name,
        status: "done",
        output: "",
        agentId: null,
        startedAt,
        completedAt: null,
        error: null,
      })),
      overallStatus: "done",
      startedAt,
      completedAt: null,
    };

    this.activePipelines.set(pipelineId, result);
    console.info("[PipelineDispatcher] pipeline=" + pipelineId.slice(0, 8) + " stages=" + taskDef.stages.length);

    const sorted = this.topologicalSort(taskDef.stages);
    const completedOutputs = new Map<string, StageResult>();

    for (const stageDef of sorted) {
      const depFailed = stageDef.dependsOn.some((dep) => {
        const depResult = completedOutputs.get(dep);
        return depResult?.status === "failed";
      });
      if (depFailed) {
        const stageResult = result.stages.find((s) => s.stageName === stageDef.name)!;
        stageResult.status = "failed";
        stageResult.error = "Dependency failed";
        stageResult.completedAt = new Date();
        result.overallStatus = "partial";
        continue;
      }

      if (taskDef.reviewAfterStages?.includes(stageDef.name)) {
        const stageResult = result.stages.find((s) => s.stageName === stageDef.name)!;
        stageResult.status = "review_requested";
        stageResult.completedAt = new Date();
        console.info("[PipelineDispatcher] stage=" + stageDef.name + " paused for review");
      }

      const stageResult = await this.executeStage(stageDef, completedOutputs, taskDef);
      const resultStage = result.stages.find((s) => s.stageName === stageDef.name)!;
      Object.assign(resultStage, stageResult);
      completedOutputs.set(stageDef.name, stageResult);

      console.info("[PipelineDispatcher] stage_complete stage=" + stageDef.name + " status=" + stageResult.status);

      if (stageResult.status === "failed") {
        result.overallStatus = "partial";
        console.warn("[PipelineDispatcher] stage=" + stageDef.name + " failed: " + stageResult.error);
      }
    }

    result.completedAt = new Date();
        console.info("[PipelineDispatcher] pipeline.complete status=" + result.overallStatus);
    getWorkspaceUIBus().emit(taskDef.groupId, {
      event: "pipeline.complete",
      data: { pipelineId, overallStatus: result.overallStatus },
    } as any);

    void this.persistPipelineResult(result);

    console.info("[PipelineDispatcher] pipeline=" + pipelineId.slice(0, 8) + " done status=" + result.overallStatus);
    return result;
  }

  private async executeStage(
    stageDef: PipelineStageDef,
    completedOutputs: Map<string, StageResult>,
    taskDef: PipelineTaskDef,
  ): Promise<StageResult> {
    const stageStartedAt = new Date();

    console.info("[PipelineDispatcher] stage_start stage=" + stageDef.name + " role=" + stageDef.role);

    const agent = await this.findAgentByRole(taskDef.groupId, stageDef.role);
    if (!agent) {
      return {
        stageName: stageDef.name,
        status: "failed",
        output: "",
        agentId: null,
        startedAt: stageStartedAt,
        completedAt: new Date(),
        error: "No agent found with role " + stageDef.role,
      };
    }

    const contextBlock = this.buildContextBlock(stageDef, completedOutputs);
    const pipelineInstruction = [
      "PIPELINE MODE: You are executing a pipeline stage. This is NOT a group chat conversation.",
      "Pipeline: " + taskDef.workflowId.slice(0, 8),
      "Stage: " + stageDef.name,
      "Your role: " + stageDef.role,
      "",
      "## Context from previous stages:",
      contextBlock,
      "",
      "## Your task:",
      stageDef.input,
      "",
      "IMPORTANT:",
      "- Execute the task directly. Do NOT use send_group_message to report progress.",
      "- Put your final result in the output.",
      "- Use your available tools to complete the task.",
      stageDef.toolGroups ? "- You have access to tool groups: " + stageDef.toolGroups.join(", ") : "",
    ].filter(Boolean).join("\n");

    console.info("[PipelineDispatcher] stage=" + stageDef.name + " agent=" + agent.id.slice(0, 8));

    const runtime = getAgentRuntime();
    await runtime.wakeAgentWithPipeline(agent.id, {
      groupId: taskDef.groupId,
      pipelineInstruction,
      stageName: stageDef.name,
      toolGroups: stageDef.toolGroups,
    });

    const stageResult = await this.waitForStageCompletion(agent.id, taskDef.groupId, STAGE_TIMEOUT_MS);

    return {
      stageName: stageDef.name,
      status: stageResult.status,
      output: stageResult.output || "",
      agentId: agent.id,
      startedAt: stageStartedAt,
      completedAt: new Date(),
      error: stageResult.error || null,
    };
  }

  private async findAgentByRole(groupId: UUID, role: string): Promise<{ id: UUID; role: string } | null> {
    try {
      const members = await store.listGroupMemberIds({ groupId });
      for (const memberId of members) {
        const agentRole = await store.getAgentRole({ agentId: memberId }).catch(() => null);
        if (agentRole?.toLowerCase() === role.toLowerCase()) {
          const agent = await store.getAgent({ agentId: memberId });
          return { id: memberId, role: agentRole };
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  private buildContextBlock(stageDef: PipelineStageDef, completedOutputs: Map<string, StageResult>): string {
    const parts: string[] = [];
    for (const depName of stageDef.dependsOn) {
      const depResult = completedOutputs.get(depName);
      if (depResult && depResult.status === "done") {
        parts.push("### " + depName + "\n" + depResult.output.slice(0, 3000));
      }
    }
    return parts.length > 0 ? parts.join("\n\n") : "(No previous stage output)";
  }

  private async waitForStageCompletion(
    agentId: UUID,
    groupId: UUID,
    timeoutMs: number,
  ): Promise<{ status: "done" | "failed"; output: string; error: string | null }> {
    const startTime = Date.now();

    return new Promise((resolve) => {
      const checkInterval = setInterval(async () => {
        if (Date.now() - startTime > timeoutMs) {
          clearInterval(checkInterval);
          resolve({ status: "failed", output: "", error: "Stage timeout" });
          return;
        }

        try {
          const agent = await store.getAgent({ agentId });
          const history = safeJsonParse<unknown[]>(agent.llmHistory, []);
          const lastAssistant = [...history].reverse().find((m) => (m as any).role === "assistant");
          if (lastAssistant && typeof (lastAssistant as any).content === "string") {
            const content = (lastAssistant as any).content;
            if (content.includes("PIPELINE_STAGE_COMPLETE")) {
              clearInterval(checkInterval);
              const output = content.replace(/PIPELINE_STAGE_COMPLETE[\s\S]*?OUTPUT:\s*/i, "").trim();
              resolve({ status: "done", output, error: null });
              return;
            }
          }
        } catch {
          // ignore
        }
      }, 2000);
    });
  }

  private topologicalSort(stages: PipelineStageDef[]): PipelineStageDef[] {
    const graph = new Map<string, string[]>();
    const inDegree = new Map<string, number>();
    const nodeMap = new Map<string, PipelineStageDef>();

    for (const stage of stages) {
      graph.set(stage.name, []);
      inDegree.set(stage.name, 0);
      nodeMap.set(stage.name, stage);
    }

    for (const stage of stages) {
      for (const dep of stage.dependsOn) {
        if (graph.has(dep)) {
          graph.get(dep)!.push(stage.name);
          inDegree.set(stage.name, (inDegree.get(stage.name) || 0) + 1);
        }
      }
    }

    const queue: string[] = [];
    for (const [name, degree] of inDegree) {
      if (degree === 0) queue.push(name);
    }

    const sorted: PipelineStageDef[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      sorted.push(nodeMap.get(current)!);
      for (const neighbor of graph.get(current) || []) {
        inDegree.set(neighbor, inDegree.get(neighbor)! - 1);
        if (inDegree.get(neighbor) === 0) queue.push(neighbor);
      }
    }

    if (sorted.length !== stages.length) {
      console.warn("[PipelineDispatcher] cycle detected, using original order");
      return stages;
    }

    return sorted;
  }

  private async persistPipelineResult(result: PipelineResult) {
    try {
      const db = getDb();
      for (const stage of result.stages) {
        await db.execute(
          sql`INSERT INTO pipeline_executions (id, pipeline_id, workflow_id, group_id, stage_name, status, output, agent_id, started_at, completed_at, error)
              VALUES (gen_random_uuid(), ${result.pipelineId}, ${result.workflowId}, ${result.groupId}, ${stage.stageName}, ${stage.status}, ${stage.output.slice(0, 10000)}, ${stage.agentId}, ${stage.startedAt.toISOString()}, ${stage.completedAt?.toISOString()}, ${stage.error})`
        );
      }
    } catch (err) {
      console.warn("[PipelineDispatcher] persistPipelineResult failed:", err);
    }
  }

  getPipelineStatus(pipelineId: UUID): PipelineResult | undefined {
    return this.activePipelines.get(pipelineId);
  }

  cancelPipeline(pipelineId: UUID): boolean {
    const pipeline = this.activePipelines.get(pipelineId);
    if (!pipeline) return false;
    pipeline.overallStatus = "failed";
    pipeline.completedAt = new Date();
    for (const stage of pipeline.stages) {
      if (stage.status === "done") continue;
      stage.status = "failed";
      stage.error = "Pipeline cancelled";
      stage.completedAt = new Date();
    }
    this.activePipelines.delete(pipelineId);
    return true;
  }
}

export function getPipelineDispatcher(): PipelineDispatcher {
  return PipelineDispatcher.getInstance();
}
