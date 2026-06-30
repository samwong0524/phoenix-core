'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { ROUTES, chatUrl } from './routes';
import { useI18n } from '@/lib/i18n/context';

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
  const { t } = useI18n();
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
    { id: 'nav-im', label: t('quickpick.nav_im'), description: t('quickpick.nav_im_desc'), icon: '💬', category: t('quickpick.cat_nav'), action: () => { window.location.href = ROUTES.CHAT; } },
    { id: 'nav-graph', label: t('quickpick.nav_graph'), description: t('quickpick.nav_graph_desc'), icon: '🔗', category: t('quickpick.cat_nav'), action: () => { window.location.href = ROUTES.GRAPH; } },
    { id: 'nav-skills', label: t('quickpick.nav_skills'), description: t('quickpick.nav_skills_desc'), icon: '⚡', category: t('quickpick.cat_nav'), action: () => { window.location.href = ROUTES.SKILLS; } },
    { id: 'nav-models', label: t('quickpick.nav_models'), description: t('quickpick.nav_models_desc'), icon: '🤖', category: t('quickpick.cat_nav'), action: () => { window.location.href = ROUTES.MODELS; } },
    { id: 'nav-pipeline', label: t('quickpick.nav_pipeline'), description: t('quickpick.nav_pipeline_desc'), icon: '🔄', category: t('quickpick.cat_nav'), action: () => { window.location.href = ROUTES.PIPELINE; } },
    { id: 'nav-observability', label: t('quickpick.nav_observability'), description: t('quickpick.nav_observability_desc'), icon: '📊', category: t('quickpick.cat_nav'), action: () => { window.location.href = ROUTES.MONITOR; } },
    { id: 'nav-home', label: t('quickpick.nav_home'), description: t('quickpick.nav_home_desc'), icon: '🏠', category: t('quickpick.cat_nav'), action: () => { window.location.href = ROUTES.HOME; } },
    { id: 'action-create', label: t('quickpick.action_create'), description: t('quickpick.action_create_desc'), icon: '➕', category: t('quickpick.cat_actions'), action: () => { setCreateMode(true); } },
  ], [t]);

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
          const groupsData = groupsRes.value as Record<string, unknown>;
          const groups = (Array.isArray(groupsData?.groups) ? groupsData.groups : []) as Record<string, unknown>[];
          for (const g of groups) {
            const gId = String(g.id ?? '');
            items.push({
              id: `group-${gId}`,
              label: String(g.name ?? '') || `Group ${gId.slice(0, 8)}`,
              description: t('quickpick.member_count', { count: g.memberCount ?? '?' }),
              icon: '👥',
              category: t('quickpick.cat_groups'),
              action: () => { window.location.href = chatUrl({ group: gId }); },
            });
          }
        }

        // Agents
        if (agentsRes.status === 'fulfilled') {
          const agentsData = agentsRes.value as Record<string, unknown>;
          const agents = (Array.isArray(agentsData?.agents) ? agentsData.agents : []) as Record<string, unknown>[];
          for (const a of agents) {
            if (a.role === 'human') continue;
            const aId = String(a.id ?? '');
            items.push({
              id: `agent-${aId}`,
              label: String(a.role ?? '') || `Agent ${aId.slice(0, 8)}`,
              description: a.status ? t('quickpick.status_label', { status: String(a.status) }) : undefined,
              icon: '🤖',
              category: t('quickpick.cat_agents'),
              action: () => { window.location.href = chatUrl({ agent: aId }); },
            });
          }
        }

        // Skills
        if (skillsRes.status === 'fulfilled') {
          const skillsData = skillsRes.value as Record<string, unknown>;
          const skillsArr = (Array.isArray(skillsData?.skills) ? skillsData.skills : Array.isArray(skillsData) ? skillsData : []) as Record<string, unknown>[];
          for (const s of skillsArr) {
            const sName = String(s.name ?? '');
            items.push({
              id: `skill-${sName}`,
              label: sName,
              description: s.description ? String(s.description) : undefined,
              icon: '⚡',
              category: t('quickpick.cat_skills'),
              action: () => { window.location.href = `${ROUTES.SKILLS}?highlight=${sName}`; },
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
  }, [isOpen, t]);

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
        window.location.href = chatUrl({ group: data.groupId });
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
            placeholder={t('quickpick.placeholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={createMode}
          />
          {loading && <span className="qp-loading">…</span>}
        </div>

        {/* Create agent sub-flow */}
        {createMode ? (
          <div className="qp-create-area">
            <div className="qp-create-label">{t('quickpick.create_label')}</div>
            <input
              ref={createInputRef}
              type="text"
              className="qp-create-input"
              placeholder="e.g. coder, reviewer, researcher"
              value={createRole}
              onChange={(e) => setCreateRole(e.target.value)}
              autoFocus
            />
            <div className="qp-create-hint">{t('quickpick.create_hint')}</div>
          </div>
        ) : (
          <>
            {/* Results */}
            <div className="qp-results">
              {filteredItems.length === 0 ? (
                <div className="qp-empty">{t('quickpick.empty')}</div>
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
              <span>{t('quickpick.footer_up')}</span>
              <span>{t('quickpick.footer_enter')}</span>
              <span>{t('quickpick.footer_esc')}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
