'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';

type StageStatus = 'pending' | 'running' | 'done' | 'failed' | 'review_requested';
type AgentStatus = 'idle' | 'working' | 'waiting' | 'error' | 'paused';

type Stage = {
  name: string;
  role: string;
  status: StageStatus;
  output: string;
  error?: string;
  agentId?: string;
};

type PipelineEvent = {
  event: string;
  data: unknown;
};

type AgentInfo = {
  id: string;
  name: string;
  role: string;
  status: AgentStatus;
  currentStage?: string;
  elapsed?: number;
  toolCalls?: number;
};

const statusIcon: Record<StageStatus, string> = {
  pending: '⏳',
  running: '⚡',
  done: '✓',
  failed: '✗',
  review_requested: '👀',
};

const statusText: Record<StageStatus, string> = {
  pending: '等待中',
  running: '运行中',
  done: '已完成',
  failed: '失败',
  review_requested: '待审查',
};

const agentStatusIcon: Record<AgentStatus, string> = {
  idle: '💤',
  working: '🔧',
  waiting: '⏸️',
  error: '🔴',
  paused: '⏯️',
};

const agentStatusText: Record<AgentStatus, string> = {
  idle: '空闲',
  working: '工作中',
  waiting: '等待中',
  error: '错误',
  paused: '已暂停',
};

export default function PipelinePage() {
  const [stages, setStages] = useState<Stage[]>([]);
  const [events, setEvents] = useState<PipelineEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [overallStatus, setOverallStatus] = useState<string>('');
  const [elapsed, setElapsed] = useState(0);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [rateLimitAlert, setRateLimitAlert] = useState<string | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const eventEndRef = useRef<HTMLDivElement>(null);
  // Timer for overall elapsed
  useEffect(() => {
    const timer = setInterval(() => {
      if (startTimeRef.current) {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }
      // Update agent elapsed times
      setAgents(prev => prev.map(a => ({
        ...a,
        elapsed: a.status === 'working'
          ? (a.elapsed || 0) + 1
          : a.elapsed,
      })));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Auto-scroll event log
  useEffect(() => {
    eventEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events]);

  const formatElapsed = useCallback((seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m + '分' + s.toString().padStart(2, '0') + '秒';
  }, []);

  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const connectionTimeRef = useRef<number>(0);

  // Get workspaceId + initial agents list
  useEffect(() => {
    fetch('/api/workspaces')
      .then(r => r.json())
      .then(d => {
        const ws = d.workspaces?.[0];
        if (ws) {
          setWorkspaceId(ws.id);
          // Fetch agents on mount (SSE replay may not include all)
          fetch(`/api/agents?workspaceId=${encodeURIComponent(ws.id)}&meta=true`)
            .then(r => r.json())
            .then(a => {
              setAgents((a.agents || []).map((ag: any) => ({
                id: ag.id, name: ag.role, role: ag.role,
                status: 'idle' as AgentStatus, elapsed: 0, toolCalls: 0,
              })));
              // Mark connection time — skip SSE history replay events
              connectionTimeRef.current = Date.now();
            })
            .catch(() => {});
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!workspaceId) return;
    const es = new EventSource(`/api/ui-stream?workspaceId=${encodeURIComponent(workspaceId)}`);
    es.onopen = () => setIsConnected(true);
    es.onerror = () => setIsConnected(false);
    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as PipelineEvent;
        // Skip SSE history replay events — only process live events after connection
        if (event.data && typeof event.data === 'object' && 'at' in (event.data as any)) {
          const eventTime = (event.data as any).at;
          if (eventTime < connectionTimeRef.current) return;
        }
        setEvents((prev) => [...prev.slice(-200), event]);
        handleEvent(event);
      } catch {
        // ignore parse errors
      }
    };
    return () => { es.close(); };
  }, [workspaceId]);

  const handleEvent = useCallback((event: PipelineEvent) => {
    switch (event.event) {
      case 'pipeline.start': {
        const d = event.data as any;
        setOverallStatus('running');
        startTimeRef.current = Date.now();
        setStages(d.stageNames?.map((name: string) => ({
          name, role: '', status: 'pending' as StageStatus, output: '',
        })) || []);
        break;
      }
      case 'pipeline.stage_start': {
        const d = event.data as any;
        setStages((prev) => prev.map((s) => s.name === d.stageName ? { ...s, status: 'running', role: d.role } : s));
        // Update agent status to working
        if (d.agentId) {
          setAgents(prev => {
            const existing = prev.find(a => a.id === d.agentId);
            if (existing) {
              return prev.map(a => a.id === d.agentId ? { ...a, status: 'working' as AgentStatus, currentStage: d.stageName, elapsed: 0 } : a);
            }
            return [...prev, { id: d.agentId, name: d.agentName || 'Agent', role: d.role, status: 'working' as AgentStatus, currentStage: d.stageName, elapsed: 0, toolCalls: 0 }];
          });
        }
        break;
      }
      case 'pipeline.stage_complete':
      case 'pipeline.stage_done': {
        const d = event.data as any;
        setStages((prev) => prev.map((s) => s.name === d.stageName ? { ...s, status: d.status, output: d.output } : s));
        // Mark agent as idle
        if (d.agentId) {
          setAgents(prev => prev.map(a => a.id === d.agentId ? { ...a, status: 'idle' as AgentStatus, currentStage: undefined } : a));
        }
        break;
      }
      case 'pipeline.complete': {
        const d = event.data as any;
        setOverallStatus(d.overallStatus);
        setAgents(prev => prev.map(a => ({ ...a, status: 'idle' as AgentStatus, currentStage: undefined })));
        break;
      }
      case 'pipeline.review': {
        const d = event.data as any;
        setStages((prev) => prev.map((s) => s.name === d.stageName ? { ...s, status: 'review_requested', output: d.output } : s));
        // Mark agent as waiting for review
        if (d.agentId) {
          setAgents(prev => prev.map(a => a.id === d.agentId ? { ...a, status: 'waiting' as AgentStatus } : a));
        }
        break;
      }
      case 'agent.error': {
        const d = event.data as any;
        setAgents(prev => {
          const idx = prev.findIndex(a => a.id === d.agentId);
          if (idx >= 0) {
            return prev.map(a => a.id === d.agentId ? { ...a, status: 'error' as AgentStatus } : a);
          }
          return [...prev, { id: d.agentId, name: d.agentName || 'Agent', role: '', status: 'error' as AgentStatus, elapsed: 0, toolCalls: 0 }];
        });
        break;
      }
      case 'agent.wakeup': {
        const d = event.data as any;
        setAgents(prev => {
          const existing = prev.find(a => a.id === d.agentId);
          if (existing) {
            return prev.map(a => a.id === d.agentId ? { ...a, status: 'working' as AgentStatus } : a);
          }
          return [...prev, { id: d.agentId, name: d.agentName || 'Agent', role: '', status: 'working' as AgentStatus, elapsed: 0, toolCalls: 0 }];
        });
        break;
      }
      case 'agent.tool_call': {
        const d = event.data as any;
        setAgents(prev => prev.map(a =>
          a.id === d.agentId ? { ...a, toolCalls: (a.toolCalls || 0) + 1 } : a
        ));
        break;
      }
      case 'llm.429': {
        const d = event.data as any;
        const retryAfter = d.retryAfter || 30;
        setRateLimitAlert(`模型限流中，正在排队，预计等待 ${retryAfter} 秒`);
        setTimeout(() => setRateLimitAlert(null), retryAfter * 1000);
        break;
      }

      // ui.agent.* events (IM chat — not pipeline mode)
      case 'ui.agent.llm.start': {
        const d = event.data as any;
        if (d.agentId) {
          setAgents(prev => {
            const existing = prev.find(a => a.id === d.agentId);
            if (existing) return prev.map(a => a.id === d.agentId ? { ...a, status: 'working' as AgentStatus, elapsed: 0 } : a);
            return [...prev, { id: d.agentId, name: 'Agent', role: '', status: 'working' as AgentStatus, elapsed: 0, toolCalls: 0 }];
          });
        }
        break;
      }
      case 'ui.agent.llm.done': {
        const d = event.data as any;
        if (d.agentId) {
          setAgents(prev => prev.map(a => a.id === d.agentId ? { ...a, status: 'idle' as AgentStatus } : a));
        }
        break;
      }
      case 'ui.agent.tool_call.start': {
        const d = event.data as any;
        if (d.agentId) {
          setAgents(prev => prev.map(a =>
            a.id === d.agentId ? { ...a, status: 'working' as AgentStatus, toolCalls: (a.toolCalls || 0) + 1 } : a
          ));
        }
        break;
      }
      case 'ui.message.created': {
        const d = event.data as any;
        // When a human sends a message, show it as an event
        if (d.message?.senderId) {
          setAgents(prev => {
            const existing = prev.find(a => a.id === d.message.senderId);
            if (!existing) {
              return [...prev, { id: d.message.senderId, name: 'Human', role: 'human', status: 'idle' as AgentStatus, elapsed: 0, toolCalls: 0 }];
            }
            return prev;
          });
        }
        break;
      }
      case 'ui.agent.created': {
        const d = event.data as any;
        if (d.agent?.id) {
          setAgents(prev => {
            if (prev.some(a => a.id === d.agent.id)) return prev;
            return [...prev, { id: d.agent.id, name: d.agent.role || 'Agent', role: d.agent.role || '', status: 'idle' as AgentStatus, elapsed: 0, toolCalls: 0 }];
          });
        }
        break;
      }
    }
  }, []);

  // Dismiss review for a stage (simulate approve for now — real coordinator UI later)
  const handleReview = useCallback((stageName: string, action: 'approve' | 'reject') => {
    // In production this would emit to the EventBus via an API call
    setStages(prev => prev.map(s =>
      s.name === stageName
        ? { ...s, status: action === 'approve' ? 'done' as StageStatus : 'failed' as StageStatus }
        : s
    ));
  }, []);

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#0a0a0f', color: '#e0e0e0', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Left sidebar: stages + agents */}
      <div style={{ width: '300px', borderRight: '1px solid #2a2a3a', padding: '16px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Connection status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: isConnected ? '#4ade80' : '#f87171', display: 'inline-block' }} />
          <span style={{ color: '#888' }}>{isConnected ? '已连接' : '断开'}</span>
          {overallStatus === 'running' && <span style={{ marginLeft: 'auto', color: '#aaa', fontSize: '12px' }}>{formatElapsed(elapsed)}</span>}
        </div>

        {/* 429 rate limit alert */}
        {rateLimitAlert && (
          <div style={{
            padding: '10px 12px', borderRadius: '8px', background: '#2a1a0a',
            border: '1px solid #f59e0b', fontSize: '13px', color: '#fbbf24',
            display: 'flex', alignItems: 'center', gap: '8px',
          }}>
            <span>⚠️</span>
            <span>{rateLimitAlert}</span>
          </div>
        )}

        {/* Pipeline stages */}
        <div>
          <h2 style={{ margin: '0 0 12px', fontSize: '15px', color: '#fff', fontWeight: 600 }}>流水线阶段</h2>
          {stages.length === 0 ? (
            <p style={{ color: '#555', fontSize: '13px', margin: 0 }}>暂无流水线运行</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {stages.map((stage, i) => (
                <div key={stage.name} style={{
                  padding: '10px 12px', borderRadius: '8px',
                  background: stage.status === 'running' ? 'rgba(74,222,128,0.08)' : stage.status === 'done' ? 'rgba(59,130,246,0.08)' : stage.status === 'failed' ? 'rgba(239,68,68,0.08)' : stage.status === 'review_requested' ? 'rgba(251,191,36,0.08)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${stage.status === 'running' ? 'rgba(74,222,128,0.3)' : stage.status === 'review_requested' ? 'rgba(251,191,36,0.3)' : 'rgba(255,255,255,0.06)'}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '14px' }}>{statusIcon[stage.status]}</span>
                    <span style={{ fontWeight: 500, fontSize: '13px', color: '#fff' }}>{stage.name}</span>
                  </div>
                  <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                    {stage.role && <span>{stage.role} · </span>}
                    {statusText[stage.status]}
                  </div>
                  {stage.error && (
                    <div style={{ fontSize: '11px', color: '#f87171', marginTop: '4px' }}>{stage.error}</div>
                  )}
                  {stage.status === 'review_requested' && (
                    <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                      <button onClick={() => handleReview(stage.name, 'approve')} style={{
                        padding: '4px 10px', borderRadius: '4px', background: '#065f46', color: '#6ee7b7',
                        border: 'none', cursor: 'pointer', fontSize: '12px',
                      }}>通过</button>
                      <button onClick={() => handleReview(stage.name, 'reject')} style={{
                        padding: '4px 10px', borderRadius: '4px', background: '#7f1d1d', color: '#fca5a5',
                        border: 'none', cursor: 'pointer', fontSize: '12px',
                      }}>驳回</button>
                    </div>
                  )}
                  {i < stages.length - 1 && (
                    <div style={{ fontSize: '10px', color: '#333', marginTop: '6px', textAlign: 'center' }}>↓</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Agent status cards */}
        {agents.length > 0 && (
          <div>
            <h2 style={{ margin: '0 0 12px', fontSize: '15px', color: '#fff', fontWeight: 600 }}>Agent 状态</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {agents.map(a => (
                <div key={a.id} style={{
                  padding: '10px 12px', borderRadius: '8px',
                  background: a.status === 'error' ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${a.status === 'error' ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.06)'}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span>{agentStatusIcon[a.status]}</span>
                    <span style={{ fontWeight: 500, fontSize: '13px', color: '#fff' }}>{a.role || a.name}</span>
                    <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#888' }}>{agentStatusText[a.status]}</span>
                  </div>
                  <div style={{ fontSize: '11px', color: '#555', marginTop: '4px', display: 'flex', gap: '12px' }}>
                    {a.currentStage && <span>阶段: {a.currentStage}</span>}
                    {a.elapsed != null && <span>用时: {formatElapsed(a.elapsed)}</span>}
                    {a.toolCalls != null && <span>工具: {a.toolCalls}次</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <Link href="/im" style={{
          display: 'block', marginTop: 'auto', padding: '8px 12px',
          borderRadius: '6px', background: 'rgba(255,255,255,0.05)', color: '#888',
          textDecoration: 'none', fontSize: '13px', textAlign: 'center',
          border: '1px solid rgba(255,255,255,0.08)',
        }}>
          ← 返回 IM
        </Link>
      </div>

      {/* Center: event stream */}
      <div style={{ flex: 1, borderRight: '1px solid #2a2a3a', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #2a2a3a', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <h2 style={{ margin: 0, fontSize: '15px', color: '#fff', fontWeight: 600 }}>实时执行流</h2>
          <span style={{ fontSize: '11px', color: '#555' }}>({events.length} events)</span>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
          {events.length === 0 ? (
            <p style={{ color: '#555', fontSize: '13px' }}>等待事件...</p>
          ) : (
            events.map((evt, i) => {
              const isError = evt.event.includes('error');
              const isDone = evt.event.includes('done') || evt.event.includes('complete');
              const isPipeline = evt.event.startsWith('pipeline.');
              return (
                <div key={i} style={{
                  padding: '6px 10px', marginBottom: '3px', borderRadius: '6px',
                  background: isError ? 'rgba(239,68,68,0.1)' : isDone ? 'rgba(59,130,246,0.06)' : 'transparent',
                  borderLeft: isError ? '2px solid #ef4444' : isPipeline ? '2px solid #6366f1' : '2px solid transparent',
                  fontSize: '12px', fontFamily: 'JetBrains Mono, monospace',
                }}>
                  <span style={{ color: '#6366f1', fontWeight: 500 }}>{evt.event}</span>
                  {!!evt.data && (
                    <span style={{ color: '#888', marginLeft: '8px' }}>
                      {String(JSON.stringify(evt.data as Record<string, unknown>)).slice(0, 180)}
                    </span>
                  )}
                </div>
              );
            })
          )}
          <div ref={eventEndRef} />
        </div>
      </div>

      {/* Right: output preview */}
      <div style={{ width: '420px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #2a2a3a' }}>
          <h2 style={{ margin: 0, fontSize: '15px', color: '#fff', fontWeight: 600 }}>产物预览</h2>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
          {stages.filter((s) => s.output).map((stage) => (
            <div key={stage.name} style={{ marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                <span>{statusIcon[stage.status]}</span>
                <h3 style={{ margin: 0, fontSize: '13px', color: '#aaa', fontWeight: 500 }}>{stage.name}</h3>
                {stage.role && <span style={{ fontSize: '11px', color: '#555' }}>({stage.role})</span>}
              </div>
              <pre style={{
                margin: 0, padding: '12px', borderRadius: '8px', background: 'rgba(255,255,255,0.03)',
                fontSize: '12px', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                color: '#ccc', maxHeight: '250px', overflowY: 'auto',
                border: '1px solid rgba(255,255,255,0.06)', lineHeight: 1.5,
              }}>
                {stage.output.slice(0, 3000)}
              </pre>
            </div>
          ))}
          {stages.filter((s) => s.output).length === 0 && (
            <p style={{ color: '#555', fontSize: '13px' }}>暂无产物输出</p>
          )}
        </div>
      </div>
    </div>
  );
}
