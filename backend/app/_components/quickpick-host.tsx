'use client';

import { useState, useEffect } from 'react';
import QuickPick from './quickpick';

export function QuickPickHost() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return <QuickPick isOpen={open} onClose={() => setOpen(false)} />;
}
