'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import Link from 'next/link';

interface QuickPickItem {
  id: string;
  label: string;
  description?: string;
  shortcut?: string;
  action: () => void;
  category: string;
}

interface QuickPickProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function QuickPick({ isOpen, onClose }: QuickPickProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const defaultItems: QuickPickItem[] = [
    { id: 'new-chat', label: '\u65B0\u5EFA\u5BF9\u8BDD', description: '\u5F00\u59CB\u65B0\u7684 Agent \u5BF9\u8BDD', shortcut: '\u2318N', action: () => window.location.href = '/im', category: '\u5BF9\u8BDD' },
    { id: 'pipeline', label: '\u7BA1\u7EBF\u6267\u884C', description: '\u67E5\u770B\u6D41\u6C34\u7EBF\u6267\u884C\u8FDB\u5EA6', shortcut: '\u2318P', action: () => window.location.href = '/pipeline', category: '\u5DE5\u4F5C\u6D41' },
    { id: 'skills', label: '\u6280\u80FD\u5E02\u573A', description: '\u6D4F\u89C8\u548C\u5B89\u88C5\u6280\u80FD', shortcut: '\u2318S', action: () => window.location.href = '/skills', category: '\u63D2\u4EF6' },
    { id: 'models', label: '\u6A21\u578B\u7BA1\u7406', description: '\u914D\u7F6E LLM \u6A21\u578B', action: () => window.location.href = '/models', category: '\u8BBE\u7F6E' },
    { id: 'settings', label: '\u7CFB\u7EDF\u8BBE\u7F6E', description: '\u5168\u5C40\u914D\u7F6E\u9879', shortcut: '\u2318,', action: () => window.location.href = '/settings', category: '\u8BBE\u7F6E' },
    { id: 'dispatch-pipeline', label: '\u5206\u6D3E\u7BA1\u7EBF', description: '\u521B\u5EFA\u591A\u9636\u6BB5\u4EFB\u52A1\u7BA1\u7EBF', action: () => {}, category: '\u5DE5\u4F5C\u6D41' },
    { id: 'compact-context', label: '\u538B\u7F29\u4E0A\u4E0B\u6587', description: '\u6E05\u7406\u5F53\u524D\u4F1A\u8BDD\u5197\u4F59\u5386\u53F2', action: () => {}, category: '\u5DE5\u5177' },
    { id: 'reload-soul', label: '\u91CD\u8F7D\u7075\u9B42', description: '\u91CD\u65B0\u52A0\u8F7D soul.md \u548C\u89D2\u8272\u6A21\u677F', action: () => {}, category: '\u5DE5\u5177' },
  ];

  const filteredItems = query
    ? defaultItems.filter((item) =>
        item.label.toLowerCase().includes(query.toLowerCase()) ||
        item.description?.toLowerCase().includes(query.toLowerCase())
      )
    : defaultItems;

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
    setSelectedIndex(0);
  }, [isOpen, query]);

  // Keyboard shortcut to open
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, filteredItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && filteredItems[selectedIndex]) {
      e.preventDefault();
      filteredItems[selectedIndex].action();
      onClose();
    } else if (e.key === 'Escape') {
      onClose();
    }
  }, [filteredItems, selectedIndex, onClose]);

  if (!isOpen) return null;

  // Group by category
  const grouped = new Map<string, QuickPickItem[]>();
  for (const item of filteredItems) {
    const items = grouped.get(item.category) || [];
    items.push(item);
    grouped.set(item.category, items);
  }

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-start',
      justifyContent: 'center', paddingTop: '15vh', zIndex: 'var(--z-modal)',
    }} onClick={onClose}>
      <div style={{
        width: '560px', maxHeight: '60vh', background: '#1a1a1a',
        borderRadius: '12px', border: '1px solid #333', overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      }} onClick={(e) => e.stopPropagation()}>
        {/* Search input */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #333' }}>
          <input
            ref={inputRef}
            type='text'
            placeholder='\u641C\u7D22\u547D\u4EE4...'
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{
              width: '100%', background: 'transparent', border: 'none',
              outline: 'none', color: '#e0e0e0', fontSize: '15px',
              padding: '4px 0',
            }}
          />
        </div>

        {/* Results */}
        <div style={{ overflowY: 'auto', maxHeight: '50vh', padding: '8px' }}>
          {filteredItems.length === 0 ? (
            <div style={{ padding: '16px', textAlign: 'center', color: '#888' }}>
              \u672A\u627E\u5230\u5339\u914D\u7684\u547D\u4EE4
            </div>
          ) : (
            Array.from(grouped.entries()).map(([category, items]) => (
              <div key={category}>
                <div style={{
                  padding: '4px 12px', fontSize: '11px', color: '#666',
                  textTransform: 'uppercase', letterSpacing: '0.5px',
                }}>
                  {category}
                </div>
                {items.map((item, idx) => {
                  const globalIdx = filteredItems.indexOf(item);
                  const isSelected = globalIdx === selectedIndex;
                  return (
                    <div
                      key={item.id}
                      onClick={() => { item.action(); onClose(); }}
                      onMouseEnter={() => setSelectedIndex(globalIdx)}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '8px 12px', borderRadius: '6px',
                        background: isSelected ? '#2a2a2a' : 'transparent',
                        cursor: 'pointer', marginBottom: '2px',
                      }}
                    >
                      <div>
                        <div style={{ fontSize: '14px', color: '#e0e0e0' }}>{item.label}</div>
                        {item.description && (
                          <div style={{ fontSize: '12px', color: '#888' }}>{item.description}</div>
                        )}
                      </div>
                      {item.shortcut && (
                        <kbd style={{
                          padding: '2px 6px', borderRadius: '4px',
                          background: '#333', color: '#aaa', fontSize: '11px',
                          fontFamily: 'monospace',
                        }}>
                          {item.shortcut}
                        </kbd>
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div style={{
          padding: '8px 16px', borderTop: '1px solid #333',
          display: 'flex', gap: '16px', fontSize: '11px', color: '#666',
        }}>
          <span>\u2191\u2193 \u9009\u62E9</span>
          <span>\u23CE \u6267\u884C</span>
          <span>ESC \u5173\u95ED</span>
        </div>
      </div>
    </div>
  );
}
