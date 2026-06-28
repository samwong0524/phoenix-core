/**
 * Phoenix-Core — 事件翻译器
 *
 * 将 raw VizEvent 翻译为人类可读的活动描述
 * 为 i18n 做准备：所有翻译文本集中在此文件
 */

/** VizEvent shape (defined in page.tsx, re-declared here to avoid circular import) */
type VizEventKind = "agent" | "message" | "llm" | "tool" | "db";

type Locale = "zh" | "en";

/**
 * 将 VizEvent 翻译为人类可读文本
 * 输入：vizEvent（kind + label）+ agent role
 * 输出：{ text: string, icon: string }
 */
export function translateEvent(
  evt: { kind: VizEventKind; label: string },
  locale: Locale = "zh"
): { text: string; icon: string } {
  const isZh = locale === "zh";

  switch (evt.kind) {
    case "agent": {
      // label patterns: "创建 coordinator", "停止全部 Agent"
      if (evt.label.startsWith("创建")) {
        const role = evt.label.replace("创建", "").trim();
        return {
          text: isZh ? `${roleName(role, isZh)} 已加入协作` : `${roleName(role, isZh)} joined`,
          icon: "➕",
        };
      }
      if (evt.label.includes("停止")) {
        return {
          text: isZh ? "已停止所有 Agent 当前循环" : "All agents stopped",
          icon: "⏹",
        };
      }
      return { text: evt.label, icon: "🤖" };
    }

    case "message": {
      // label pattern: "消息: coordinator"
      const sender = evt.label.replace("消息:", "").replace("消息: ", "").trim();
      return {
        text: isZh
          ? `${roleName(sender, isZh)} 发送了消息`
          : `${roleName(sender, isZh)} sent a message`,
        icon: "💬",
      };
    }

    case "llm": {
      // label patterns: "llm.start coordinator", "llm.done coder"
      const parts = evt.label.split(/\s+/);
      const action = parts[0] ?? "";
      const role = parts[1] ?? "";
      if (action.includes("start")) {
        return {
          text: isZh
            ? `${roleName(role, isZh)} 正在思考...`
            : `${roleName(role, isZh)} is thinking...`,
          icon: "🧠",
        };
      }
      if (action.includes("done")) {
        return {
          text: isZh
            ? `${roleName(role, isZh)} 完成了思考`
            : `${roleName(role, isZh)} finished thinking`,
          icon: "✅",
        };
      }
      return { text: evt.label, icon: "🧠" };
    }

    case "tool": {
      // label patterns: "tool.start coder:read_file", "tool.done coder:search"
      const parts = evt.label.split(/\s+/);
      const action = parts[0] ?? "";
      const rest = parts.slice(1).join(" ");
      const [role, toolName] = rest.split(":");
      const displayName = toolName?.replace(/_/g, " ") ?? "";

      if (action.includes("start")) {
        return {
          text: isZh
            ? `${roleName(role, isZh)} 正在使用 ${displayName}`
            : `${roleName(role, isZh)} is using ${displayName}`,
          icon: "🔧",
        };
      }
      if (action.includes("done")) {
        return {
          text: isZh
            ? `${roleName(role, isZh)} 完成了 ${displayName}`
            : `${roleName(role, isZh)} finished ${displayName}`,
          icon: "✅",
        };
      }
      return { text: evt.label, icon: "🔧" };
    }

    case "db": {
      // label pattern: "DB write: agents"
      return {
        text: isZh ? `数据更新: ${evt.label.replace("DB ", "")}` : `Data: ${evt.label.replace("DB ", "")}`,
        icon: "💾",
      };
    }

    default:
      return { text: evt.label, icon: "•" };
  }
}

/**
 * Agent 角色名本地化
 */
function roleName(role: string, isZh: boolean): string {
  const zhNames: Record<string, string> = {
    coordinator: "协调者",
    productmanager: "产品经理",
    pm: "产品经理",
    manager: "经理",
    researcher: "研究员",
    specialist: "专家",
    coder: "程序员",
    developer: "开发者",
    worker: "工作者",
    assistant: "助手",
    creator: "创作者",
    editor: "编辑",
    reviewer: "审核员",
    human: "用户",
  };
  if (isZh && zhNames[role.toLowerCase()]) {
    return zhNames[role.toLowerCase()];
  }
  // Capitalize first letter for English
  return role.charAt(0).toUpperCase() + role.slice(1);
}

/**
 * Agent 状态文本
 */
export function statusText(
  status: string | undefined,
  locale: Locale = "zh"
): string {
  const isZh = locale === "zh";
  switch (status) {
    case "IDLE":
      return isZh ? "在线" : "Online";
    case "BUSY":
      return isZh ? "忙碌" : "Busy";
    case "WAKING":
      return isZh ? "唤醒中" : "Waking";
    default:
      return isZh ? "空闲" : "Idle";
  }
}

/**
 * Agent 状态颜色
 */
export function statusColor(status: string | undefined): string {
  switch (status) {
    case "IDLE":
      return "var(--green)";
    case "BUSY":
      return "var(--magenta)";
    case "WAKING":
      return "var(--yellow)";
    default:
      return "var(--text-dim)";
  }
}
