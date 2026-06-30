// =============================================
// FLOW: IM Responsive Chat (4 screens)
// Phoenix-Core — AI Product Scenario
// Component Library: shadcn/ui + Tailwind
// =============================================
//
// This flow demonstrates responsive adaptation of
// the IM workspace across desktop (≥1024px),
// tablet (768-1023px), and mobile (<768px) breakpoints.

'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Menu,
  X,
  Send,
  ChevronUp,
  MessageSquare,
  Bot,
  User,
  Play,
  CheckCircle2,
  Circle,
  Loader2,
} from 'lucide-react'

// ─── Types ───────────────────────────────────
type Breakpoint = 'mobile' | 'tablet' | 'desktop'

interface Message {
  id: string
  sender: 'user' | 'agent'
  senderName: string
  avatar: string
  content: string
  timestamp: string
  toolCalls?: { name: string; status: 'done' | 'running' }[]
}

interface Group {
  id: string
  name: string
  lastMessage: string
  unread: number
}

interface TaskItem {
  id: string
  name: string
  status: 'done' | 'running' | 'pending'
  progress?: number
}

// ─── useMediaQuery Hook ──────────────────────
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    const media = window.matchMedia(query)
    setMatches(media.matches)
    const listener = (e: MediaQueryListEvent) => setMatches(e.matches)
    media.addEventListener('change', listener)
    return () => media.removeEventListener('change', listener)
  }, [query])

  return matches
}

function useBreakpoint(): Breakpoint {
  const isMobile = useMediaQuery('(max-width: 767px)')
  const isTablet = useMediaQuery('(min-width: 768px) and (max-width: 1023px)')

  if (isMobile) return 'mobile'
  if (isTablet) return 'tablet'
  return 'desktop'
}

// ─── Mock Data ───────────────────────────────
const groups: Group[] = [
  { id: 'g1', name: '购物车改版', lastMessage: '已完成支付模块代码审查', unread: 3 },
  { id: 'g2', name: 'API 重构', lastMessage: 'TypeScript 类型检查通过', unread: 0 },
  { id: 'g3', name: '性能优化', lastMessage: 'Lighthouse 分数已更新', unread: 1 },
  { id: 'g4', name: '文档更新', lastMessage: 'README 已同步', unread: 0 },
]

const messages: Message[] = [
  {
    id: 'm1',
    sender: 'user',
    senderName: '陈昊',
    avatar: '👤',
    content: '帮我检查一下购物车页面的性能问题',
    timestamp: '10:25',
  },
  {
    id: 'm2',
    sender: 'agent',
    senderName: 'Phoenix',
    avatar: '🔥',
    content:
      '正在分析购物车页面的性能指标...\n\n发现以下问题：\n1. 首屏加载时间 3.2s（目标 < 2s）\n2. 商品列表组件存在不必要的重渲染\n3. 图片未使用懒加载',
    timestamp: '10:25',
    toolCalls: [
      { name: 'Lighthouse', status: 'done' },
      { name: 'CodeAnalysis', status: 'done' },
    ],
  },
  {
    id: 'm3',
    sender: 'agent',
    senderName: 'CodeWriter',
    avatar: '✍️',
    content:
      '已生成优化建议代码：\n\n```tsx\nconst ProductItem = memo(({ product }) => (\n  <div className="product-card">\n    <img loading="lazy" src={product.image} />\n    <h3>{product.name}</h3>\n  </div>\n))\n```',
    timestamp: '10:26',
  },
  {
    id: 'm4',
    sender: 'agent',
    senderName: 'Phoenix',
    avatar: '🔥',
    content: '已完成支付模块的代码审查，性能评分提升至 82 分。',
    timestamp: '10:30',
  },
]

const tasks: TaskItem[] = [
  { id: 't1', name: '性能分析', status: 'done', progress: 100 },
  { id: 't2', name: '代码优化', status: 'running', progress: 65 },
  { id: 't3', name: '单元测试', status: 'pending' },
  { id: 't4', name: '构建验证', status: 'pending' },
]

// ─── Animation Variants ──────────────────────
const drawerVariants = {
  closed: { x: -280, opacity: 0 },
  open: { x: 0, opacity: 1 },
}

const sheetVariants = {
  closed: { y: '100%' },
  open: { y: 0 },
}

const overlayVariants = {
  closed: { opacity: 0 },
  open: { opacity: 1 },
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SCREEN 1 of 4: Desktop Full Layout (≥1024px)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ENTRY:  用户打开 /im 页面，viewport ≥ 1024px
// EXIT:   窗口缩小至 <1024px → SCREEN 2
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function DesktopLayout({
  selectedGroup,
  onSelectGroup,
}: {
  selectedGroup: string
  onSelectGroup: (id: string) => void
}) {
  return (
    <div className="flex h-screen bg-slate-950 text-slate-100">
      {/* Sidebar — 220px fixed */}
      <aside className="w-[220px] flex-shrink-0 border-r border-slate-800 bg-slate-900 flex flex-col">
        <div className="p-4 border-b border-slate-800">
          <h2 className="text-sm font-semibold text-slate-300">工作区</h2>
        </div>
        <nav className="flex-1 overflow-y-auto p-2 space-y-1">
          {groups.map((g) => (
            <button
              key={g.id}
              onClick={() => onSelectGroup(g.id)}
              className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors min-h-[44px] flex items-center justify-between ${
                selectedGroup === g.id
                  ? 'bg-cyan-500/10 text-cyan-400'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              <span className="truncate">{g.name}</span>
              {g.unread > 0 && (
                <span className="bg-cyan-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                  {g.unread}
                </span>
              )}
            </button>
          ))}
        </nav>
      </aside>

      {/* Chat Area — flex-1 */}
      <ChatArea />

      {/* Right Panel — 280px fixed */}
      <TaskPanel />
    </div>
  )
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SCREEN 2 of 4: Tablet Layout (768-1023px)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ENTRY:  窗口 768-1023px 或从 Screen 1/3 resize
// EXIT:   点击汉堡菜单 → SCREEN 2A (drawer open)
//         resize ≥1024 → SCREEN 1, <768 → SCREEN 3
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function TabletLayout({
  sidebarOpen,
  onToggleSidebar,
  selectedGroup,
  onSelectGroup,
}: {
  sidebarOpen: boolean
  onToggleSidebar: (open: boolean) => void
  selectedGroup: string
  onSelectGroup: (id: string) => void
}) {
  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 relative">
      {/* Drawer Overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            className="fixed inset-0 bg-black/50 z-40"
            variants={overlayVariants}
            initial="closed"
            animate="open"
            exit="closed"
            onClick={() => onToggleSidebar(false)}
          />
        )}
      </AnimatePresence>

      {/* Drawer Sidebar */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.aside
            className="fixed left-0 top-0 bottom-0 w-[280px] bg-slate-900 border-r border-slate-800 z-50 flex flex-col"
            variants={drawerVariants}
            initial="closed"
            animate="open"
            exit="closed"
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          >
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-300">工作区</h2>
              <button
                onClick={() => onToggleSidebar(false)}
                className="p-2 rounded-lg hover:bg-slate-800 min-w-[44px] min-h-[44px] flex items-center justify-center"
                aria-label="关闭侧栏"
              >
                <X size={18} />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto p-2 space-y-1">
              {groups.map((g) => (
                <button
                  key={g.id}
                  onClick={() => {
                    onSelectGroup(g.id)
                    onToggleSidebar(false)
                  }}
                  className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors min-h-[44px] flex items-center justify-between ${
                    selectedGroup === g.id
                      ? 'bg-cyan-500/10 text-cyan-400'
                      : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                  }`}
                >
                  <span className="truncate">{g.name}</span>
                  {g.unread > 0 && (
                    <span className="bg-cyan-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                      {g.unread}
                    </span>
                  )}
                </button>
              ))}
            </nav>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Main Area: Chat + Collapsed Panel Toggle */}
      <div className="flex-1 flex flex-col">
        {/* Top Bar with hamburger */}
        <header className="h-12 border-b border-slate-800 flex items-center px-4 gap-3">
          <button
            onClick={() => onToggleSidebar(true)}
            className="p-2 rounded-lg hover:bg-slate-800 min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label="打开侧栏"
          >
            <Menu size={20} />
          </button>
          <span className="text-sm font-medium text-slate-300">
            {groups.find((g) => g.id === selectedGroup)?.name}
          </span>
        </header>
        <ChatArea />
      </div>

      {/* Right Panel — collapsed to icon strip on tablet */}
      <div className="w-12 border-l border-slate-800 flex flex-col items-center py-3 gap-2">
        <button
          className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 min-w-[44px] min-h-[44px] flex items-center justify-center"
          aria-label="任务面板"
        >
          <Play size={16} />
        </button>
      </div>
    </div>
  )
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SCREEN 2A: Tablet Drawer Open
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// (Integrated into TabletLayout above via AnimatePresence)
// ENTRY:  点击汉堡菜单 / 从左边缘右滑
// EXIT:   选择群组 → 自动关闭 drawer → SCREEN 2
//         点击 overlay → 关闭 drawer → SCREEN 2
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SCREEN 3 of 4: Mobile Layout (<768px)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ENTRY:  窗口 <768px 或从 Screen 2 resize
// EXIT:   点击汉堡菜单 → drawer open (同 Tablet drawer)
//         点击任务按钮 → SCREEN 4 (bottom sheet)
//         resize ≥768 → SCREEN 2
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function MobileLayout({
  sidebarOpen,
  onToggleSidebar,
  onOpenSheet,
  selectedGroup,
  onSelectGroup,
}: {
  sidebarOpen: boolean
  onToggleSidebar: (open: boolean) => void
  onOpenSheet: () => void
  selectedGroup: string
  onSelectGroup: (id: string) => void
}) {
  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 relative">
      {/* Drawer (same pattern as tablet) */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div
              className="fixed inset-0 bg-black/50 z-40"
              variants={overlayVariants}
              initial="closed"
              animate="open"
              exit="closed"
              onClick={() => onToggleSidebar(false)}
            />
            <motion.aside
              className="fixed left-0 top-0 bottom-0 w-[85vw] max-w-[320px] bg-slate-900 border-r border-slate-800 z-50 flex flex-col"
              variants={drawerVariants}
              initial="closed"
              animate="open"
              exit="closed"
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            >
              <div className="p-4 border-b border-slate-800 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-300">工作区</h2>
                <button
                  onClick={() => onToggleSidebar(false)}
                  className="p-2 rounded-lg hover:bg-slate-800 min-w-[44px] min-h-[44px] flex items-center justify-center"
                  aria-label="关闭侧栏"
                >
                  <X size={18} />
                </button>
              </div>
              <nav className="flex-1 overflow-y-auto p-2 space-y-1">
                {groups.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => {
                      onSelectGroup(g.id)
                      onToggleSidebar(false)
                    }}
                    className={`w-full text-left px-3 py-3 rounded-lg text-sm transition-colors min-h-[48px] flex items-center justify-between ${
                      selectedGroup === g.id
                        ? 'bg-cyan-500/10 text-cyan-400'
                        : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                    }`}
                  >
                    <span className="truncate">{g.name}</span>
                    {g.unread > 0 && (
                      <span className="bg-cyan-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                        {g.unread}
                      </span>
                    )}
                  </button>
                ))}
              </nav>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Mobile: Single column */}
      <div className="flex-1 flex flex-col">
        {/* Mobile Header */}
        <header className="h-14 border-b border-slate-800 flex items-center px-3 gap-2">
          <button
            onClick={() => onToggleSidebar(true)}
            className="p-2.5 rounded-lg hover:bg-slate-800 min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label="打开侧栏"
          >
            <Menu size={20} />
          </button>
          <span className="text-sm font-medium text-slate-200 truncate flex-1">
            {groups.find((g) => g.id === selectedGroup)?.name}
          </span>
          <button
            onClick={onOpenSheet}
            className="p-2.5 rounded-lg hover:bg-slate-800 text-slate-400 min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label="查看任务"
          >
            <Play size={16} />
          </button>
        </header>

        {/* Chat fills remaining space */}
        <ChatArea mobile />
      </div>
    </div>
  )
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SCREEN 4 of 4: Mobile Bottom Sheet
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ENTRY:  移动端点击任务按钮
// EXIT:   下滑 / 点击关闭 → SCREEN 3
//         点击任务项 → 展开详情（sheet 内）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function BottomSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 bg-black/50 z-40"
            variants={overlayVariants}
            initial="closed"
            animate="open"
            exit="closed"
            onClick={onClose}
          />

          {/* Sheet */}
          <motion.div
            className="fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-700 rounded-t-2xl z-50 max-h-[60vh] flex flex-col"
            variants={sheetVariants}
            initial="closed"
            animate="open"
            exit="closed"
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          >
            {/* Drag Handle */}
            <div className="flex justify-center py-3">
              <div className="w-10 h-1 rounded-full bg-slate-600" />
            </div>

            {/* Sheet Header */}
            <div className="px-4 pb-3 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-200">任务监控</h3>
              <button
                onClick={onClose}
                className="p-2 rounded-lg hover:bg-slate-800 min-w-[44px] min-h-[44px] flex items-center justify-center"
                aria-label="关闭面板"
              >
                <X size={16} />
              </button>
            </div>

            {/* Task List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/50 min-h-[48px]"
                >
                  {task.status === 'done' && (
                    <CheckCircle2 size={18} className="text-emerald-400 flex-shrink-0" />
                  )}
                  {task.status === 'running' && (
                    <Loader2 size={18} className="text-cyan-400 animate-spin flex-shrink-0" />
                  )}
                  {task.status === 'pending' && (
                    <Circle size={18} className="text-slate-500 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-200 truncate">{task.name}</p>
                    {task.status === 'running' && task.progress != null && (
                      <div className="mt-1.5 h-1 bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-cyan-500 rounded-full transition-all"
                          style={{ width: `${task.progress}%` }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

// ─── Shared Components ───────────────────────

function ChatArea({ mobile = false }: { mobile?: boolean }) {
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Messages */}
      <div className={`flex-1 overflow-y-auto ${mobile ? 'p-3' : 'p-4'} space-y-4`}>
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex gap-3 ${msg.sender === 'user' ? 'flex-row-reverse' : ''}`}
          >
            {/* Avatar */}
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0 ${
                msg.sender === 'user' ? 'bg-slate-700' : 'bg-cyan-500/20'
              }`}
            >
              {msg.avatar}
            </div>

            {/* Bubble */}
            <div
              className={`max-w-[80%] ${mobile ? 'max-w-[85%]' : ''} rounded-2xl px-4 py-2.5 ${
                msg.sender === 'user'
                  ? 'bg-cyan-600 text-white'
                  : 'bg-slate-800 text-slate-200'
              }`}
            >
              {/* Sender name (agent messages only) */}
              {msg.sender === 'agent' && (
                <p className="text-xs text-cyan-400 font-medium mb-1">{msg.senderName}</p>
              )}

              {/* Content */}
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>

              {/* Tool calls */}
              {msg.toolCalls && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {msg.toolCalls.map((tc) => (
                    <span
                      key={tc.name}
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        tc.status === 'done'
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : 'bg-yellow-500/20 text-yellow-400'
                      }`}
                    >
                      {tc.status === 'done' ? '✓' : '⟳'} {tc.name}
                    </span>
                  ))}
                </div>
              )}

              {/* Timestamp */}
              <p
                className={`text-xs mt-1.5 ${
                  msg.sender === 'user' ? 'text-cyan-200/60' : 'text-slate-500'
                }`}
              >
                {msg.timestamp}
              </p>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div className={`border-t border-slate-800 ${mobile ? 'p-3' : 'p-4'}`}>
        <div className="flex items-end gap-2 bg-slate-800 rounded-2xl px-4 py-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="输入消息..."
            className="flex-1 bg-transparent text-sm text-slate-200 placeholder:text-slate-500 resize-none outline-none max-h-32 min-h-[24px]"
            rows={1}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                // send
              }
            }}
          />
          <button
            className="p-2 rounded-xl bg-cyan-500 text-white hover:bg-cyan-400 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center disabled:opacity-40"
            disabled={!input.trim()}
            aria-label="发送"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}

function TaskPanel() {
  return (
    <aside className="w-[280px] flex-shrink-0 border-l border-slate-800 bg-slate-900 flex flex-col">
      <div className="p-4 border-b border-slate-800">
        <h3 className="text-sm font-semibold text-slate-300">任务监控</h3>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {tasks.map((task) => (
          <div
            key={task.id}
            className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/50"
          >
            {task.status === 'done' && (
              <CheckCircle2 size={16} className="text-emerald-400 flex-shrink-0" />
            )}
            {task.status === 'running' && (
              <Loader2 size={16} className="text-cyan-400 animate-spin flex-shrink-0" />
            )}
            {task.status === 'pending' && (
              <Circle size={16} className="text-slate-500 flex-shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm text-slate-300 truncate">{task.name}</p>
              {task.status === 'running' && task.progress != null && (
                <div className="mt-1 h-1 bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-cyan-500 rounded-full transition-all"
                    style={{ width: `${task.progress}%` }}
                  />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </aside>
  )
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Main Export — Responsive Router
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function IMResponsiveChat() {
  const breakpoint = useBreakpoint()
  const [selectedGroup, setSelectedGroup] = useState('g1')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)

  return (
    <>
      {/* STATE: default — layout auto-selected by viewport */}
      {breakpoint === 'desktop' && (
        <DesktopLayout
          selectedGroup={selectedGroup}
          onSelectGroup={setSelectedGroup}
        />
      )}

      {/* STATE: tablet — sidebar hidden, drawer on demand */}
      {breakpoint === 'tablet' && (
        <TabletLayout
          sidebarOpen={sidebarOpen}
          onToggleSidebar={setSidebarOpen}
          selectedGroup={selectedGroup}
          onSelectGroup={setSelectedGroup}
        />
      )}

      {/* STATE: mobile — single column, drawer + bottom sheet */}
      {breakpoint === 'mobile' && (
        <MobileLayout
          sidebarOpen={sidebarOpen}
          onToggleSidebar={setSidebarOpen}
          onOpenSheet={() => setSheetOpen(true)}
          selectedGroup={selectedGroup}
          onSelectGroup={setSelectedGroup}
        />
      )}

      {/* Bottom Sheet (mobile only) */}
      <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </>
  )
}

// ─── Exit States ─────────────────────────────
// ✅ Success: 所有断点布局正确渲染，侧栏 0.3s 展开/收起，触摸目标 ≥ 44px
// ❌ Error: SSE 断开 → 统一 Toast 提示 + 自动重连
// ↩ Abandon: 关闭浏览器 → 聊天历史自动保存，下次恢复最后阅读位置
