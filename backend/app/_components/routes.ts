/**
 * Centralized route constants for Phoenix-Core.
 * All internal navigation paths should reference these constants
 * instead of hardcoded strings.
 */
export const ROUTES = {
  /** 首页（重定向到对话页） */
  HOME: "/",
  /** Agent 对话 */
  CHAT: "/im",
  /** 工作流编辑器 */
  WORKFLOW: "/workflow",
  /** 工作流模板市场 */
  TEMPLATES: "/workflow/templates",
  /** 流水线编排 */
  PIPELINE: "/pipeline",
  /** Agent 通信拓扑 */
  GRAPH: "/graph",
  /** 运维监控仪表盘 */
  MONITOR: "/observability",
  /** 会话历史 */
  HISTORY: "/history",
  /** 模型管理 */
  MODELS: "/models",
  /** 技能管理 */
  SKILLS: "/skills",
  /** 登录/注册 */
  LOGIN: "/login",
  /** 测试页（开发用） */
  TEST: "/test",
} as const;

/** Build a chat URL with optional query params */
export function chatUrl(params?: {
  workspaceId?: string;
  group?: string;
  agent?: string;
}): string {
  if (!params) return ROUTES.CHAT;
  const qs = new URLSearchParams();
  if (params.workspaceId) qs.set("workspaceId", params.workspaceId);
  if (params.group) qs.set("group", params.group);
  if (params.agent) qs.set("agent", params.agent);
  const str = qs.toString();
  return str ? `${ROUTES.CHAT}?${str}` : ROUTES.CHAT;
}

/** Build a workflow URL with optional query params */
export function workflowUrl(params?: {
  workspaceId?: string;
  workflowId?: string;
}): string {
  if (!params) return ROUTES.WORKFLOW;
  const qs = new URLSearchParams();
  if (params.workspaceId) qs.set("workspaceId", params.workspaceId);
  if (params.workflowId) qs.set("workflowId", params.workflowId);
  const str = qs.toString();
  return str ? `${ROUTES.WORKFLOW}?${str}` : ROUTES.WORKFLOW;
}

/** Build a templates URL with optional workspaceId */
export function templatesUrl(workspaceId?: string): string {
  if (!workspaceId) return ROUTES.TEMPLATES;
  return `${ROUTES.TEMPLATES}?workspaceId=${encodeURIComponent(workspaceId)}`;
}
