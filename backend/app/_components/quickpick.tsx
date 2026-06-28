'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';

// ── Types ──
interface QuickPickItem {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  shortcut?: string;
  category: string;
  action: () => void;
}

interface QuickPickProps {
  isOpen: boolean;
  onClose: () => void;
}

// ── Session helper ──
const SESSION_KEY = 'agent-wechat.session.v1';
function getSession(): { workspaceId: string; humanAgentId: string } | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

// ── Component ──
export default function QuickPick({ isOpen, onClose }: QuickPickProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [dynamicItems, setDynamicItems] = useState<QuickPickItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [createMode, setCreateMode] = useState(false);
  const [createRole, setCreateRole] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const createInputRef = useRef<HTMLInputElement>(null);

  // Static navigation + action commands
  const staticItems: QuickPickItem[] = useMemo(() => [
    { id: 'nav-im', label: 'Agent 对话', description: '进入 IM 聊天界面', icon: '💬', category: '导航', action: () => { window.location.href = '/im'; } },
    { id: 'nav-graph', label: '通信拓扑图', description: '查看 Agent 通信关系', icon: '🔗', category: '导航', action: () => { window.location.href = '/graph'; } },
    { id: 'nav-skills', label: '技能市场', description: '浏览和管理技能', icon: '⚡', category: '导航', action: () => { window.location.href = '/skills'; } },
    { id: 'nav-models', label: '模型配置', description: '配置 LLM 模型和 API Key', icon: '🤖', category: '导航', action: () => { window.location.href = '/models'; } },
    { id: 'nav-pipeline', label: '流水线监控', description: '查看工作流执行进度', icon: '🔄', category: '导航', action: () => { window.location.href = '/pipeline'; } },
    { id: 'nav-observability', label: '可观测性面板', description: '系统指标和成本监控', icon: '📊', category: '导航', action: () => { window.location.href = '/observability'; } },
    { id: 'nav-home', label: '返回首页', description: '工作区列表和总览', icon: '🏠', category: '导航', action: () => { window.location.href = '/'; } },
    { id: 'action-create', label: '创建 Agent', description: '输入角色名创建新 Agent', icon: '➕', category: '操作', action: () => { setCreateMode(true); } },
  ], []);

  // Fetch dynamic data when opened
  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setDynamicItems([]);
      setCreateMode(false);
      setCreateRole('');
      return;
    }
    // Focus input after render
    requestAnimationFrame(() => inputRef.current?.focus());
    // Fetch groups, agents, skills in parallel
    const session = getSession();
    if (!session) return;
    setLoading(true);
    const { workspaceId, humanAgentId } = session;

    const fetchAll = async () => {
      const items: QuickPickItem[] = [];
      try {
        const [groupsRes, agentsRes, skillsRes] = await Promise.allSettled([
          fetch(`/api/groups?workspaceId=${encodeURIComponent(workspaceId)}&agentId=${encodeURIComponent(humanAgentId)}`).then(r => r.json()),
          fetch(`/api/agents?workspaceId=${encodeURIComponent(workspaceId)}&meta=true`).then(r => r.json()),
          fetch(`/api/skills`).then(r => r.json()),
        ]);

        // Groups
        if (groupsRes.status === 'fulfilled') {
          const groups = (groupsRes.value as any)?.groups ?? [];
          for (const g of groups) {
            items.push({
              id: `group-${g.id}`,
              label: g.name || `群 ${g.id.slice(0, 8)}`,
              description: `${g.memberCount ?? '?'} 成员`,
              icon: '👥',
              category: '群组',
              action: () => { window.location.href = `/im?group=${g.id}`; },
            });
          }
        }

        // Agents
        if (agentsRes.status === 'fulfilled') {
          const agents = (agentsRes.value as any)?.agents ?? [];
          for (const a of agents) {
            if (a.role === 'human') continue;
            items.push({
              id: `agent-${a.id}`,
              label: a.role || `Agent ${a.id.slice(0, 8)}`,
              description: a.status ? `状态: ${a.status}` : undefined,
              icon: '🤖',
              category: 'Agent',
              action: () => { window.location.href = `/im?agent=${a.id}`; },
            });
          }
        }

        // Skills
        if (skillsRes.status === 'fulfilled') {
          const skills = (skillsRes.value as any)?.skills ?? (skillsRes.value as any) ?? [];
          for (const s of skills) {
            items.push({
              id: `skill-${s.name}`,
              label: s.name,
              description: s.description,
              icon: '⚡',
              category: '技能',
              action: () => { window.location.href = `/skills?highlight=${s.name}`; },
            });
          }
        }
      } catch (err) {
        console.warn('[QuickPick] fetch error:', err);
      }
      setDynamicItems(items);
      setLoading(false);
    };
    void fetchAll();
  }, [isOpen]);

  // All items combined
  const allItems = useMemo(() => [...staticItems, ...dynamicItems], [staticItems, dynamicItems]);

  // Filter by query
  const filteredItems = useMemo(() => {
    if (!query.trim()) return allItems;
    const q = query.toLowerCase();
    return allItems.filter((item) =>
      item.label.toLowerCase().includes(q) ||
      item.description?.toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q)
    );
  }, [allItems, query]);

  // Reset selection when filter changes
  useEffect(() => { setSelectedIndex(0); }, [query]);

  // Handle create agent flow
  const handleCreateAgent = useCallback(async () => {
    const role = createRole.trim();
    if (!role) return;
    const session = getSession();
    if (!session) return;
    try {
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: session.workspaceId,
          creatorId: session.humanAgentId,
          role,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        onClose();
        window.location.href = `/im?group=${data.groupId}`;
      }
    } catch (err) {
      console.warn('[QuickPick] create agent failed:', err);
    }
  }, [createRole, onClose]);

  // Keyboard handler
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (createMode) {
      if (e.key === 'Enter') { e.preventDefault(); void handleCreateAgent(); }
      if (e.key === 'Escape') { e.preventDefault(); setCreateMode(false); setCreateRole(''); inputRef.current?.focus(); }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, filteredItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = filteredItems[selectedIndex];
      if (item) { item.action(); if (!createMode) onClose(); }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }, [createMode, filteredItems, selectedIndex, handleCreateAgent, onClose]);

  // Scroll selected item into view
  useEffect(() => {
    const el = document.querySelector(`[data-qp-idx="${selectedIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (!isOpen) return null;

  // Group by category
  const grouped = new Map<string, QuickPickItem[]>();
  for (const item of filteredItems) {
    const arr = grouped.get(item.category) || [];
    arr.push(item);
    grouped.set(item.category, arr);
  }

  let flatIdx = 0;

  return (
    <div className="qp-overlay" onClick={onClose}>
      <div className="qp-panel" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        {/* Search input */}
        <div className="qp-input-area">
          <span className="qp-input-icon">⌘</span>
          <input
            ref={inputRef}
            type="text"
            className="qp-input"
            placeholder="输入命令、搜索群组 / Agent / 技能…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={createMode}
          />
          {loading && <span className="qp-loading">…</span>}
        </div>

        {/* Create agent sub-flow */}
        {createMode ? (
          <div className="qp-create-area">
            <div className="qp-create-label">输入 Agent 角色名：</div>
            <input
              ref={createInputRef}
              type="text"
              className="qp-create-input"
              placeholder="e.g. coder, reviewer, researcher"
              value={createRole}
              onChange={(e) => setCreateRole(e.target.value)}
              autoFocus
            />
            <div className="qp-create-hint">Enter 创建 · Esc 返回</div>
          </div>
        ) : (
          <>
            {/* Results */}
            <div className="qp-results">
              {filteredItems.length === 0 ? (
                <div className="qp-empty">未找到匹配的命令</div>
              ) : (
                Array.from(grouped.entries()).map(([category, items]) => (
                  <div key={category} className="qp-category">
                    <div className="qp-category-title">{category}</div>
                    {items.map((item) => {
                      const idx = flatIdx++;
                      const isSelected = idx === selectedIndex;
                      return (
                        <div
                          key={item.id}
                          data-qp-idx={idx}
                          className={`qp-item${isSelected ? ' selected' : ''}`}
                          onClick={() => { item.action(); onClose(); }}
                          onMouseEnter={() => setSelectedIndex(idx)}
                        >
                          {item.icon && <span className="qp-item-icon">{item.icon}</span>}
                          <div className="qp-item-text">
                            <div className="qp-item-label">{item.label}</div>
                            {item.description && <div className="qp-item-desc">{item.description}</div>}
                          </div>
                          {item.shortcut && <kbd className="qp-shortcut">{item.shortcut}</kbd>}
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </div>

            {/* Footer */}
            <div className="qp-footer">
              <span>↑↓ 选择</span>
              <span>↵ 执行</span>
              <span>Esc 关闭</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
