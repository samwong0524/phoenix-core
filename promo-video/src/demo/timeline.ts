import type {
  DemoEdge,
  DemoEdgePulse,
  DemoGroup,
  DemoMessage,
  DemoNode,
  DemoNodeStatus,
  DemoPanelItem,
  DemoState,
} from "./types";

const workspaceId = "ws_demo_001";
const humanId = "human_001";
const assistantId = "assistant_001";
const coderId = "coder_001";

const toFrames = (fps: number, seconds: number) => Math.round(seconds * fps);

export function getDemoState(frame: number, fps: number): DemoState {
  const sequenceStart = toFrames(fps, 4);

  const tHumanMessage = 0;
  const assistantBusyStart = tHumanMessage;
  const assistantBusyEnd = assistantBusyStart + toFrames(fps, 1);

  const childACreate = assistantBusyEnd + toFrames(fps, 0.2);
  const childBCreate = childACreate + toFrames(fps, 0.2);
  const messageToChildA = childACreate + toFrames(fps, 0.25);
  const messageToChildB = childBCreate + toFrames(fps, 0.25);

  const childABusyEnd = messageToChildA + toFrames(fps, 1);
  const childBBusyEnd = messageToChildB + toFrames(fps, 1);
  const grandACreate = childABusyEnd + toFrames(fps, 0.2);
  const grandBCreate = childBBusyEnd + toFrames(fps, 0.2);
  const messageToGrandA = grandACreate + toFrames(fps, 0.2);
  const messageToGrandB = grandBCreate + toFrames(fps, 0.2);
  const grandABusyEnd = messageToGrandA + toFrames(fps, 1);
  const grandBBusyEnd = messageToGrandB + toFrames(fps, 1);
  const greatACreate = grandABusyEnd + toFrames(fps, 0.2);
  const greatBCreate = grandBBusyEnd + toFrames(fps, 0.2);
  const messageToGreatA = greatACreate + toFrames(fps, 0.2);
  const messageToGreatB = greatBCreate + toFrames(fps, 0.2);

  const groups: DemoGroup[] = [
    {
      id: "g-human",
      title: "human ↔ assistant",
      subtitle: "最近：创建 coder",
      appearAt: 0,
    },
    {
      id: "g-coder",
      title: "assistant ↔ coder",
      subtitle: "最近：汇报进度",
      appearAt: sequenceStart + assistantBusyEnd,
    },
  ];

  const messages: DemoMessage[] = [
    {
      id: "m1",
      from: "human",
      content: "创建一个 coder 代理",
      senderId: humanId,
      contentType: "text",
      sendTime: "10:01",
      appearAt: sequenceStart + tHumanMessage,
    },
    {
      id: "m2",
      from: "assistant",
      content: "已创建 coder，并建立对话",
      senderId: assistantId,
      contentType: "text",
      sendTime: "10:01",
      appearAt: sequenceStart + assistantBusyEnd + toFrames(fps, 0.2),
    },
    {
      id: "m3",
      from: "human",
      content: "让 coder 汇报进度",
      senderId: humanId,
      contentType: "text",
      sendTime: "10:02",
      appearAt: sequenceStart + toFrames(fps, 2.1),
    },
    {
      id: "m4",
      from: "assistant",
      content: "coder 已回复：任务完成 40%",
      senderId: assistantId,
      contentType: "text",
      sendTime: "10:02",
      appearAt: sequenceStart + toFrames(fps, 2.8),
    },
  ];

  const nodes: DemoNode[] = [
    { id: "human", label: "human", x: 120, y: 110, appearAt: 0 },
    { id: "assistant", label: "assistant", x: 260, y: 110, appearAt: 0 },
    { id: "child_a", label: "child-1", x: 360, y: 60, appearAt: childACreate },
    { id: "child_b", label: "child-2", x: 360, y: 160, appearAt: childBCreate },
    { id: "grand_a", label: "child-1a", x: 440, y: 30, appearAt: grandACreate },
    { id: "grand_b", label: "child-2a", x: 440, y: 190, appearAt: grandBCreate },
    { id: "great_a", label: "child-1a-1", x: 520, y: 10, appearAt: greatACreate },
    { id: "great_b", label: "child-2a-1", x: 520, y: 210, appearAt: greatBCreate },
  ];

  const edges: DemoEdge[] = [
    { id: "e1", from: "human", to: "assistant", appearAt: 0 },
    { id: "e2", from: "assistant", to: "child_a", appearAt: childACreate },
    { id: "e3", from: "assistant", to: "child_b", appearAt: childBCreate },
    { id: "e4", from: "child_a", to: "grand_a", appearAt: grandACreate },
    { id: "e5", from: "child_b", to: "grand_b", appearAt: grandBCreate },
    { id: "e6", from: "grand_a", to: "great_a", appearAt: greatACreate },
    { id: "e7", from: "grand_b", to: "great_b", appearAt: greatBCreate },
  ];

  const graphNodes: DemoNode[] = [
    { id: "human", label: "human", x: -360, y: 0, appearAt: 0 },
    { id: "assistant", label: "assistant", x: -80, y: 0, appearAt: 0 },
    { id: "child_a", label: "child-1", x: 180, y: -140, appearAt: childACreate },
    { id: "child_b", label: "child-2", x: 180, y: 140, appearAt: childBCreate },
    { id: "grand_a", label: "child-1a", x: 420, y: -220, appearAt: grandACreate },
    { id: "grand_b", label: "child-2a", x: 420, y: 220, appearAt: grandBCreate },
    { id: "great_a", label: "child-1a-1", x: 660, y: -300, appearAt: greatACreate },
    { id: "great_b", label: "child-2a-1", x: 660, y: 300, appearAt: greatBCreate },
  ];

  const graphEdges: DemoEdge[] = [
    { id: "ge1", from: "human", to: "assistant", appearAt: 0 },
    { id: "ge2", from: "assistant", to: "child_a", appearAt: childACreate },
    { id: "ge3", from: "assistant", to: "child_b", appearAt: childBCreate },
    { id: "ge4", from: "child_a", to: "grand_a", appearAt: grandACreate },
    { id: "ge5", from: "child_b", to: "grand_b", appearAt: grandBCreate },
    { id: "ge6", from: "grand_a", to: "great_a", appearAt: greatACreate },
    { id: "ge7", from: "grand_b", to: "great_b", appearAt: greatBCreate },
  ];

  const edgePulses: DemoEdgePulse[] = [
    {
      id: "p1",
      from: "human",
      to: "assistant",
      start: tHumanMessage,
      end: tHumanMessage + toFrames(fps, 0.6),
    },
    {
      id: "p2",
      from: "assistant",
      to: "child_a",
      start: messageToChildA,
      end: messageToChildA + toFrames(fps, 0.6),
    },
    {
      id: "p3",
      from: "assistant",
      to: "child_b",
      start: messageToChildB,
      end: messageToChildB + toFrames(fps, 0.6),
    },
    {
      id: "p4",
      from: "child_a",
      to: "grand_a",
      start: messageToGrandA,
      end: messageToGrandA + toFrames(fps, 0.6),
    },
    {
      id: "p5",
      from: "child_b",
      to: "grand_b",
      start: messageToGrandB,
      end: messageToGrandB + toFrames(fps, 0.6),
    },
    {
      id: "p6",
      from: "grand_a",
      to: "great_a",
      start: messageToGreatA,
      end: messageToGreatA + toFrames(fps, 0.6),
    },
    {
      id: "p7",
      from: "grand_b",
      to: "great_b",
      start: messageToGreatB,
      end: messageToGreatB + toFrames(fps, 0.6),
    },
  ];

  const nodeStatusTimeline: DemoNodeStatus[] = [
    { id: "assistant", start: assistantBusyStart, end: assistantBusyEnd },
    { id: "child_a", start: messageToChildA, end: childABusyEnd },
    { id: "child_b", start: messageToChildB, end: childBBusyEnd },
    { id: "grand_a", start: messageToGrandA, end: grandABusyEnd },
    { id: "grand_b", start: messageToGrandB, end: grandBBusyEnd },
  ];

  const historyItems: DemoPanelItem[] = [
    { id: "h1", label: "system: 初始化角色与上下文", appearAt: 0 },
    { id: "h2", label: "assistant: 创建 coder 代理", appearAt: sequenceStart + assistantBusyEnd },
    { id: "h3", label: "assistant: 汇总 coder 回复", appearAt: sequenceStart + toFrames(fps, 2.8) },
  ];

  const toolItems: DemoPanelItem[] = [
    { id: "t1", label: "create(role=\"coder\")", appearAt: sequenceStart + assistantBusyEnd },
    { id: "t2", label: "send_direct_message()", appearAt: sequenceStart + toFrames(fps, 2.3) },
  ];

  const selectedGroupId = frame < sequenceStart + toFrames(fps, 1.6) ? "g-human" : "g-coder";
  const activeTitle = selectedGroupId === "g-human" ? "human ↔ assistant" : "assistant ↔ coder";

  const contentText =
    frame < sequenceStart + assistantBusyEnd
      ? "等待用户输入..."
      : frame < sequenceStart + toFrames(fps, 2.8)
        ? "已创建 coder，并建立对话。"
        : "coder 已回复：任务完成 40%。";

  const reasoningText =
    frame < sequenceStart + assistantBusyEnd
      ? "分析用户意图，准备创建子 agent。"
      : frame < sequenceStart + toFrames(fps, 2.8)
        ? "创建 coder 并建立 P2P 群组。"
        : "汇总 coder 回复并反馈给用户。";

  const agentRoleById = new Map([
    [humanId, "human"],
    [assistantId, "assistant"],
    [coderId, "coder"],
    ["child_a", "productmanager"],
    ["child_b", "coder"],
    ["grand_a", "assistant"],
    ["grand_b", "assistant"],
    ["great_a", "assistant"],
    ["great_b", "assistant"],
  ]);

  const historyEntries = historyItems.map((item) => ({ id: item.id, role: "assistant", content: item.label }));

  const historyRole = (entry: any) => (typeof entry?.role === "string" ? entry.role : "unknown");
  const historyAccent = (role?: string) => {
    if (!role) return "#94a3b8";
    if (role === "human") return "#f8fafc";
    if (role === "assistant") return "#38bdf8";
    if (role === "productmanager") return "#fb7185";
    if (role === "coder") return "#34d399";
    if (role === "tool") return "#fbbf24";
    if (role === "system") return "#a78bfa";
    return "#94a3b8";
  };
  const summarizeHistoryEntry = (entry: any, index: number) => {
    const contentText = typeof entry?.content === "string" ? entry.content : "";
    return `#${index + 1} — ${contentText}`;
  };

  return {
    workspaceId,
    humanId,
    assistantId,
    activeTitle,
    draft:
      frame < sequenceStart
        ? ""
        : frame < sequenceStart + toFrames(fps, 1.2)
          ? "创建一个 coder 代理"
          : "",
    agentRoleById,
    groups: groups.filter((g) => frame >= g.appearAt),
    selectedGroupId,
    messages: messages.filter((m) => frame >= m.appearAt),
    nodes: nodes.filter((n) => frame >= sequenceStart + n.appearAt),
    edges: edges.filter((e) => frame >= sequenceStart + e.appearAt),
    graphNodes,
    graphEdges,
    edgePulses,
    nodeStatusTimeline,
    sequenceStart,
    historyItems: historyItems.filter((h) => frame >= h.appearAt),
    historyEntries: historyEntries.filter((_, idx) => frame >= historyItems[idx]?.appearAt),
    historyRole,
    historyAccent,
    summarizeHistoryEntry,
    toolItems: toolItems.filter((t) => frame >= t.appearAt),
    toolTimeline: toolItems,
    contentText,
    reasoningText,
  };
}
