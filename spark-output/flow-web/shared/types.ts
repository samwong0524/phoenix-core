// =============================================
// Shared Types for IM Responsive Flow
// Phoenix-Core — AI Product Scenario
// =============================================

export interface Agent {
  id: string
  name: string
  avatar: string
  role: 'assistant' | 'human' | 'sub-agent'
  status: 'online' | 'busy' | 'offline'
}

export interface Message {
  id: string
  senderId: string
  content: string
  timestamp: string
  type: 'text' | 'tool_call' | 'system' | 'question'
  isStreaming?: boolean
  toolCalls?: ToolCall[]
}

export interface ToolCall {
  id: string
  name: string
  status: 'running' | 'completed' | 'error'
}

export interface Group {
  id: string
  name: string
  memberIds: string[]
  lastMessage?: string
  unreadCount: number
  updatedAt: string
}

export interface TaskItem {
  id: string
  name: string
  status: 'pending' | 'running' | 'completed' | 'error'
  progress?: number
}

// Responsive breakpoint types
export type Breakpoint = 'mobile' | 'tablet' | 'desktop'

export interface ResponsiveState {
  breakpoint: Breakpoint
  sidebarOpen: boolean
  rightPanelOpen: boolean
  bottomSheetOpen: boolean
}
