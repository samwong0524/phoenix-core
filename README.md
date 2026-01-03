# Agent Wechat: Minimal Primitives, Massive Scale.

> **NO MORE LANGGRAPH.**  
> If human society can organize billions of people through simple IM interfaces like WeChat, AI Agents should not be locked in complex, rigid graph structures (DAGs).  
> 如果人类社会可以通过“微信”这种简单的 IM 界面组织起数十亿人的协作，那么 AI Agents 也不应该被锁死在复杂的图结构（DAG）中。

---

## 🏛 The Philosophy / 核心哲学

Traditional Multi-Agent frameworks often force developers to pre-define every edge and node in a static workflow. We believe that **organization should be emergent, not prescribed.**
传统的多智能体框架通常强迫开发者在静态工作流中预定义每一个节点和连线。我们相信：**组织应当是自发演化的，而非被预设的。**

**Agent Wechat** returns to the fundamental logic of communication. By providing just two core primitives, we enable agents to autonomously build, expand, and manage their own collaborative topologies.
**Agent Wechat** 回归了沟通的最底层逻辑。通过仅提供两个核心原语，我们让 Agent 能够自主地构建、扩张并管理它们自己的协作拓扑。

---

## ⚡ The Primitives / 核心原语

All complex multi-agent systems can be expressed through just two functions:  
所有的 Multi-Agent 系统，都可以通过两个原语表达：

### 1. `create(role)`
Instantly hire or clone a new Agent and get its unique `agent_id`.  
瞬间雇佣或克隆一个新的 Agent 并获得其唯一的 `agent_id`。

### 2. `send(agent_id, message)`
Send an asynchronous message to any known ID in the system.  
向系统内任何已知的 ID 发送异步消息。

**That is all an Agent is. 这就是 Agent 的全部。**

---

## 🚀 Key Features / 核心特性

- **Liquid Topology (液态拓扑):** No predefined graphs. Agents decide when to hire subordinates and how to route tasks based on real-time complexity.  
  没有预设的图。Agent 根据实时任务复杂度自主决定何时雇佣下属以及如何分发任务。
- **Universal IM Interface (统一 IM 接口):** Every Agent (and Human) has a "Mailbox". This enables asynchronous buffering, "Wake-on-Message" logic, and a unified audit trail.  
  每个 Agent（以及人类）都有一个“信箱”。这实现了异步缓冲、“见信唤醒”逻辑以及统一的审计追踪。
- **Flat Intervention (扁平协作):** Humans are not just top-level observers. Through the IM node, you can intervene at **any level** of the tree to override sub-logic directly.  
  人类不再只是顶层观察者。通过 IM 节点，你可以直接介入树状结构的**任何层级**，直接覆盖子逻辑。

---

## 🛠 Project Structure / 项目结构

- `/whitepaper-site`: The official interactive manifesto and simulation demo (Next.js + Framer Motion).  
  官方交互式宣言与仿真演示。
- `/Mini-Agent`: The core implementation of the "Minimal Primitive" architecture.  
  “极简原语”架构的核心代码实现。

---

## 🌐 Connectivity / 连接

- **Manifesto & Demo:** [https://agent-wechat.vercel.app](https://agent-wechat.vercel.app)
- **Discord:** [Join our community](https://discord.gg/NQBg63b8A5)
- **GitHub:** [https://github.com/chmod777john/agent-wechat](https://github.com/chmod777john/agent-wechat)

---

## 📄 License / 许可证

© 2026 Agent Wechat Project. 
Decentralizing intelligence to protect ideas.