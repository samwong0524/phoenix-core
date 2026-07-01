'use client';

import { useEffect, useState, useCallback } from 'react';

interface SlotConfig {
  id: string;
  title: string;
  content: string;
  actionUrl?: string;
  iframeUrl?: string;
  frequency: string;
  width?: number;
  height?: number;
  enabled: boolean;
}

interface ActivitySlotProps {
  slotId: string;
  sessionId?: string;
}

export default function ActivitySlot({ slotId, sessionId }: ActivitySlotProps) {
  const [config, setConfig] = useState<SlotConfig | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (config?.frequency === 'session') {
      const dismissedKey = 'activity-dismissed:' + slotId + ':' + new Date().toDateString();
      if (sessionStorage.getItem(dismissedKey)) {
        setDismissed(true);
        return;
      }
    } else if (config?.frequency === 'remember') {
      const dismissedKey = 'activity-dismissed:' + slotId;
      if (localStorage.getItem(dismissedKey)) {
        setDismissed(true);
        return;
      }
    }
  }, [config, slotId]);

  useEffect(() => {
    const loadSlot = async () => {
      try {
        const res = await fetch('/api/activity/slots/' + slotId);
        if (res.ok) {
          const data = await res.json();
          setConfig(data);
          if (sessionId) {
            navigator.sendBeacon?.('/api/activity/expose', JSON.stringify({ slotId, sessionId }));
          }
        }
      } catch {
        // ignore
      }
    };
    loadSlot();
  }, [slotId, sessionId]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    if (config?.frequency === 'session') {
      sessionStorage.setItem('activity-dismissed:' + slotId + ':' + new Date().toDateString(), '1');
    } else if (config?.frequency === 'remember') {
      localStorage.setItem('activity-dismissed:' + slotId, '1');
    }
  }, [config, slotId]);

  const handleClick = useCallback(() => {
    if (config?.actionUrl) {
      window.open(config.actionUrl, '_blank');
      if (sessionId) {
        navigator.sendBeacon?.('/api/activity/click', JSON.stringify({ slotId, sessionId, actionUrl: config.actionUrl }));
      }
    }
  }, [config, sessionId, slotId]);

  if (!config || !config.enabled || dismissed) return null;

  const containerStyle: React.CSSProperties = {
    padding: '8px 12px',
    borderRadius: '8px',
    background: 'var(--bg-panel)',
    border: '1px solid var(--border)',
    cursor: config.actionUrl ? 'pointer' : 'default',
    width: config.width ? config.width + 'px' : '100%',
    height: config.height ? config.height + 'px' : undefined,
    position: 'relative',
  };

  return (
    <div style={containerStyle} onClick={handleClick}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginBottom: '2px' }}>{config.title}</div>
          <div style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{config.content}</div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); handleDismiss(); }}
          style={{
            background: 'none', border: 'none', color: 'var(--text-dim)',
            cursor: 'pointer', fontSize: '14px', padding: '0 4px',
          }}
          title="关闭"
        >
          ×
        </button>
      </div>
      {config.iframeUrl && (
        <iframe
          src={config.iframeUrl}
          style={{ width: '100%', height: '200px', border: 'none', borderRadius: '4px', marginTop: '8px' }}
          sandbox="allow-scripts allow-same-origin"
        />
      )}
    </div>
  );
}
