'use client';

import { memo } from 'react';
import Link from 'next/link';
import { ROUTES } from "@/app/_components/routes";

type AgentStatus = 'idle' | 'working' | 'waiting' | 'error' | 'paused';

const statusConfig: Record<AgentStatus, { icon: string; color: string; label: string }> = {
  idle: { icon: '\u26AA', color: 'var(--text-dim)', label: '\u7A7A\u95F2' },
  working: { icon: '\u{1F504}', color: 'var(--green)', label: '\u8FD0\u884C\u4E2D' },
  waiting: { icon: '\u23F8', color: 'var(--yellow)', label: '\u7B49\u5F85\u4E2D' },
  error: { icon: '\u274C', color: 'var(--red)', label: '\u51FA\u9519' },
  paused: { icon: '\u23F9', color: 'var(--yellow)', label: '\u5DF2\u6682\u505C' },
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

export default memo(function AgentStatusCard({ status, agentName, currentStage, elapsedSeconds = 0 }: AgentStatusCardProps) {
  const config = statusConfig[status];

  return (
    <Link href={ROUTES.PIPELINE} style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px',
      padding: '6px 12px',
      borderRadius: '8px',
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      textDecoration: 'none',
      cursor: 'pointer',
    }}>
      <span style={{ fontSize: '14px' }} aria-hidden="true">{config.icon}</span>
      <span className="sr-only">{config.label}</span>
      <div>
        <div style={{ fontSize: '12px', color: config.color, fontWeight: 500 }}>
          {agentName && <span>{agentName} \u00B7 </span>}
          {config.label}
        </div>
        {currentStage && (
          <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>{currentStage}</div>
        )}
        {elapsedSeconds > 0 && status === 'working' && (
          <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>{formatElapsed(elapsedSeconds)}</div>
        )}
      </div>
    </Link>
  );
});
