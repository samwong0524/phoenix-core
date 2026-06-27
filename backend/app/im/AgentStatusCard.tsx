'use client';

import Link from 'next/link';

type AgentStatus = 'idle' | 'working' | 'waiting' | 'error' | 'paused';

const statusConfig: Record<AgentStatus, { icon: string; color: string; label: string }> = {
  idle: { icon: '\u26AA', color: '#888', label: '\u7A7A\u95F2' },
  working: { icon: '\u{1F504}', color: '#4a4', label: '\u8FD0\u884C\u4E2D' },
  waiting: { icon: '\u23F8', color: '#cc0', label: '\u7B49\u5F85\u4E2D' },
  error: { icon: '\u274C', color: '#f44', label: '\u51FA\u9519' },
  paused: { icon: '\u23F9', color: '#fa0', label: '\u5DF2\u6682\u505C' },
};

interface AgentStatusCardProps {
  status: AgentStatus;
  agentName?: string;
  currentStage?: string;
  elapsedSeconds?: number;
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m + '\u5206' + s.toString().padStart(2, '0') + '\u79D2';
}

export default function AgentStatusCard({ status, agentName, currentStage, elapsedSeconds = 0 }: AgentStatusCardProps) {
  const config = statusConfig[status];

  return (
    <Link href="/pipeline" style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px',
      padding: '6px 12px',
      borderRadius: '8px',
      background: '#1a1a1a',
      border: '1px solid #333',
      textDecoration: 'none',
      cursor: 'pointer',
    }}>
      <span style={{ fontSize: '14px' }}>{config.icon}</span>
      <div>
        <div style={{ fontSize: '12px', color: config.color, fontWeight: 500 }}>
          {agentName && <span>{agentName} \u00B7 </span>}
          {config.label}
        </div>
        {currentStage && (
          <div style={{ fontSize: '11px', color: '#888' }}>{currentStage}</div>
        )}
        {elapsedSeconds > 0 && status === 'working' && (
          <div style={{ fontSize: '11px', color: '#666' }}>{formatElapsed(elapsedSeconds)}</div>
        )}
      </div>
    </Link>
  );
}
