// =============================================
// Mock Data for IM Responsive Flow
// Phoenix-Core — AI Product Scenario
// =============================================

import type { Agent, Group, Message, TaskItem } from './types'

export const mockAgents: Agent[] = [
  {
    id: 'agent-1',
    name: 'Phoenix',
    avatar: '🔥',
    role: 'assistant',
    status: 'online',
  },
  {
    id: 'agent-2',
    name: 'CodeWriter',
    avatar: '✍️',
    role: 'sub-agent',
    status: 'busy',
  },
  {
    id: 'human-1',
    name: '陈昊',
    avatar: '👤',
    role: 'human',
    status: 'online',
  },
]

export const mockGroups: Group[] = [
  {
    id: 'group-1',
    name: '购物车改版',
    memberIds: ['agent-1', 'agent-2', 'human-1'],
    lastMessage: '已完成支付模块的代码审查',
    unreadCount: 3,
    updatedAt: '2026-06-30T10:30:00Z',
  },
  {
    id: 'group-2',
    name: 'API 重构',
    memberIds: ['agent-1', 'human-1'],
    lastMessage: 'TypeScript 类型检查通过',
    unreadCount: 0,
    updatedAt: '2026-06-30T09:15:00Z',
  },
  {
    id: 'group-3',
    name: '性能优化',
    memberIds: ['agent-2', 'human-1'],
    lastMessage: 'Lighthouse 分数已更新',
    unreadCount: 1,
    updatedAt: '2026-06-29T18:00:00Z',
  },
]

export const mockMessages: Message[] = [
  {
    id: 'msg-1',
    senderId: 'human-1',
    content: '帮我检查一下购物车页面的性能问题',
    timestamp: '2026-06-30T10:25:00Z',
    type: 'text',
  },
  {
    id: 'msg-2',
    senderId: 'agent-1',
    content: '正在分析购物车页面的性能指标...\n\n发现以下问题：\n1. 首屏加载时间 3.2s（目标 < 2s）\n2. 商品列表组件存在不必要的重渲染\n3. 图片未使用懒加载',
    timestamp: '2026-06-30T10:25:30Z',
    type: 'text',
    toolCalls: [
      { id: 'tc-1', name: 'Lighthouse', status: 'completed' },
      { id: 'tc-2', name: 'CodeAnalysis', status: 'completed' },
    ],
  },
  {
    id: 'msg-3',
    senderId: 'agent-2',
    content: '已生成优化建议代码，需要确认是否应用：\n\n```tsx\n// 添加 React.memo 避免重渲染\nconst ProductItem = memo(({ product }) => (\n  <div className="product-card">\n    <img loading="lazy" src={product.image} />\n    <h3>{product.name}</h3>\n  </div>\n))\n```',
    timestamp: '2026-06-30T10:26:00Z',
    type: 'text',
  },
  {
    id: 'msg-4',
    senderId: 'agent-1',
    content: '已完成支付模块的代码审查',
    timestamp: '2026-06-30T10:30:00Z',
    type: 'text',
  },
]

export const mockTasks: TaskItem[] = [
  { id: 'task-1', name: '性能分析', status: 'completed', progress: 100 },
  { id: 'task-2', name: '代码优化', status: 'running', progress: 65 },
  { id: 'task-3', name: '单元测试', status: 'pending' },
  { id: 'task-4', name: '构建验证', status: 'pending' },
]
