/**
 * Built-in workflow template seeds.
 * Inserted on first GET /api/workflow-templates when table is empty.
 */

import type { WorkflowDSL } from "./workflow-types";

export interface SeedWorkflowTemplate {
  name: string;
  description: string;
  icon: string;
  category: string;
  tags: string[];
  dsl: WorkflowDSL;
}

// ── Helper: build a linear chain ────────────────────────────────

function linearChain(
  steps: Array<{ role: string; label: string; description: string; output: string }>
): WorkflowDSL {
  const nodes: WorkflowDSL["nodes"] = [
    { id: "start", type: "start", position: { x: 80, y: 200 }, data: { label: "Start" } },
  ];
  const edges: WorkflowDSL["edges"] = [];
  let prevId = "start";

  steps.forEach((s, i) => {
    const id = `agent-${i + 1}`;
    nodes.push({
      id,
      type: "agent",
      position: { x: 250 + i * 250, y: 200 },
      data: {
        label: s.label,
        role: s.role,
        description: s.description,
        expectedOutput: s.output,
        executionStatus: "idle",
      },
    });
    edges.push({ id: `e-${prevId}-${id}`, source: prevId, target: id });
    prevId = id;
  });

  const endX = 250 + steps.length * 250 + 100;
  nodes.push({ id: "end", type: "end", position: { x: endX, y: 200 }, data: { label: "End" } });
  edges.push({ id: `e-${prevId}-end`, source: prevId, target: "end" });

  return { nodes, edges };
}

// ── 1. Research Pipeline ────────────────────────────────────────

const researchPipeline: SeedWorkflowTemplate = {
  name: "Research Pipeline",
  description: "Three-step research workflow: gather information, analyze findings, and produce a structured report.",
  icon: "🔬",
  category: "research",
  tags: ["research", "analysis", "report"],
  dsl: linearChain([
    { role: "researcher", label: "Research", description: "Gather relevant information from available sources", output: "Raw research data and source list" },
    { role: "specialist", label: "Analyze", description: "Analyze the research data and identify key patterns", output: "Analysis summary with key findings" },
    { role: "creator", label: "Write Report", description: "Produce a structured report from the analysis", output: "Final research report document" },
  ]),
};

// ── 2. Code Review ──────────────────────────────────────────────

const codeReviewPipeline: SeedWorkflowTemplate = {
  name: "Code Review",
  description: "Review code changes with a conditional gate: approved changes proceed to deployment, while rejected changes loop back for fixes.",
  icon: "🔍",
  category: "development",
  tags: ["code-review", "quality", "deployment"],
  dsl: {
    nodes: [
      { id: "start", type: "start", position: { x: 80, y: 200 }, data: { label: "Start" } },
      { id: "agent-1", type: "agent", position: { x: 250, y: 200 }, data: { label: "Code Review", role: "reviewer", description: "Review the code changes for quality and correctness", expectedOutput: "Review feedback with approval or rejection", executionStatus: "idle" } },
      { id: "cond-1", type: "condition", position: { x: 500, y: 200 }, data: { label: "Approved?", condition: "result contains 'approved' or 'LGTM'", executionStatus: "idle" } },
      { id: "agent-2", type: "agent", position: { x: 750, y: 100 }, data: { label: "Deploy", role: "specialist", description: "Deploy the approved changes to production", expectedOutput: "Deployment confirmation", executionStatus: "idle" } },
      { id: "agent-3", type: "agent", position: { x: 750, y: 300 }, data: { label: "Fix Issues", role: "creator", description: "Address the review feedback and fix identified issues", expectedOutput: "Revised code with fixes", executionStatus: "idle" } },
      { id: "end", type: "end", position: { x: 1000, y: 200 }, data: { label: "End" } },
    ],
    edges: [
      { id: "e-start-1", source: "start", target: "agent-1" },
      { id: "e-1-cond", source: "agent-1", target: "cond-1" },
      { id: "e-cond-true", source: "cond-1", target: "agent-2", branchLabel: "true" },
      { id: "e-cond-false", source: "cond-1", target: "agent-3", branchLabel: "false" },
      { id: "e-2-end", source: "agent-2", target: "end" },
      { id: "e-3-end", source: "agent-3", target: "end" },
    ],
  },
};

// ── 3. Content Production ───────────────────────────────────────

const contentProduction: SeedWorkflowTemplate = {
  name: "Content Production",
  description: "Content creation pipeline: draft content, edit for quality, then publish to the target channel.",
  icon: "✍️",
  category: "content",
  tags: ["content", "writing", "publishing"],
  dsl: linearChain([
    { role: "creator", label: "Draft", description: "Write the initial draft of the content", output: "First draft document" },
    { role: "reviewer", label: "Edit", description: "Review and edit the draft for clarity, tone, and accuracy", output: "Edited and polished content" },
    { role: "specialist", label: "Publish", description: "Format and publish the content to the target channel", output: "Published content with link" },
  ]),
};

// ── 4. Bug Triage ───────────────────────────────────────────────

const bugTriage: SeedWorkflowTemplate = {
  name: "Bug Triage",
  description: "Triage incoming bugs by severity. Critical bugs go to development and QA, while minor issues are closed as low priority.",
  icon: "🐛",
  category: "operations",
  tags: ["bug-fix", "triage", "qa"],
  dsl: {
    nodes: [
      { id: "start", type: "start", position: { x: 80, y: 200 }, data: { label: "Start" } },
      { id: "agent-1", type: "agent", position: { x: 250, y: 200 }, data: { label: "Triage", role: "coordinator", description: "Analyze the bug report and determine severity", expectedOutput: "Severity assessment: critical or minor", executionStatus: "idle" } },
      { id: "cond-1", type: "condition", position: { x: 500, y: 200 }, data: { label: "Critical?", condition: "result contains 'critical' or 'high'", executionStatus: "idle" } },
      { id: "agent-2", type: "agent", position: { x: 750, y: 100 }, data: { label: "Fix Bug", role: "creator", description: "Develop a fix for the critical bug", expectedOutput: "Bug fix with test coverage", executionStatus: "idle" } },
      { id: "agent-3", type: "agent", position: { x: 1000, y: 100 }, data: { label: "QA Test", role: "reviewer", description: "Verify the bug fix with regression tests", expectedOutput: "Test results and verification report", executionStatus: "idle" } },
      { id: "agent-4", type: "agent", position: { x: 750, y: 300 }, data: { label: "Close", role: "coordinator", description: "Close the bug as low priority with explanation", expectedOutput: "Closure notice with reasoning", executionStatus: "idle" } },
      { id: "end", type: "end", position: { x: 1250, y: 200 }, data: { label: "End" } },
    ],
    edges: [
      { id: "e-start-1", source: "start", target: "agent-1" },
      { id: "e-1-cond", source: "agent-1", target: "cond-1" },
      { id: "e-cond-true", source: "cond-1", target: "agent-2", branchLabel: "true" },
      { id: "e-cond-false", source: "cond-1", target: "agent-4", branchLabel: "false" },
      { id: "e-2-3", source: "agent-2", target: "agent-3" },
      { id: "e-3-end", source: "agent-3", target: "end" },
      { id: "e-4-end", source: "agent-4", target: "end" },
    ],
  },
};

// ── 5. Data Analysis ────────────────────────────────────────────

const dataAnalysis: SeedWorkflowTemplate = {
  name: "Data Analysis",
  description: "Collect data, analyze for patterns, then branch: significant findings go to reporting, while inconclusive results trigger re-collection.",
  icon: "📊",
  category: "research",
  tags: ["data", "analysis", "reporting"],
  dsl: {
    nodes: [
      { id: "start", type: "start", position: { x: 80, y: 200 }, data: { label: "Start" } },
      { id: "agent-1", type: "agent", position: { x: 250, y: 200 }, data: { label: "Collect Data", role: "researcher", description: "Gather raw data from the specified sources", expectedOutput: "Raw dataset ready for analysis", executionStatus: "idle" } },
      { id: "agent-2", type: "agent", position: { x: 500, y: 200 }, data: { label: "Analyze", role: "specialist", description: "Analyze the data for patterns and anomalies", expectedOutput: "Analysis results with significance assessment", executionStatus: "idle" } },
      { id: "cond-1", type: "condition", position: { x: 750, y: 200 }, data: { label: "Significant?", condition: "result contains 'significant' or 'p < 0.05'", executionStatus: "idle" } },
      { id: "agent-3", type: "agent", position: { x: 1000, y: 100 }, data: { label: "Report", role: "creator", description: "Create a detailed report of the significant findings", expectedOutput: "Final analysis report with visualizations", executionStatus: "idle" } },
      { id: "agent-4", type: "agent", position: { x: 1000, y: 300 }, data: { label: "Re-collect", role: "researcher", description: "Collect additional data with expanded scope", expectedOutput: "Expanded dataset for re-analysis", executionStatus: "idle" } },
      { id: "end", type: "end", position: { x: 1250, y: 200 }, data: { label: "End" } },
    ],
    edges: [
      { id: "e-start-1", source: "start", target: "agent-1" },
      { id: "e-1-2", source: "agent-1", target: "agent-2" },
      { id: "e-2-cond", source: "agent-2", target: "cond-1" },
      { id: "e-cond-true", source: "cond-1", target: "agent-3", branchLabel: "true" },
      { id: "e-cond-false", source: "cond-1", target: "agent-4", branchLabel: "false" },
      { id: "e-3-end", source: "agent-3", target: "end" },
      { id: "e-4-end", source: "agent-4", target: "end" },
    ],
  },
};

// ── Registry ────────────────────────────────────────────────────

export const SEED_TEMPLATES: SeedWorkflowTemplate[] = [
  researchPipeline,
  codeReviewPipeline,
  contentProduction,
  bugTriage,
  dataAnalysis,
];
