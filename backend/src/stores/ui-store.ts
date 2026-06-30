"use client";

import { create } from "zustand";

// ── Types ─────────────────────────────────────────────────────

type UIState = {
  sidebarCollapsed: boolean;
  cmdkOpen: boolean;
};

type UIActions = {
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setCmdkOpen: (open: boolean) => void;
};

type UIStore = UIState & UIActions;

// ── Persistence helpers ───────────────────────────────────────

const SIDEBAR_KEY = "phoenix-sidebar-collapsed";

function loadSidebarState(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "true";
  } catch {
    return false;
  }
}

function saveSidebarState(collapsed: boolean): void {
  try {
    if (collapsed) localStorage.setItem(SIDEBAR_KEY, "true");
    else localStorage.removeItem(SIDEBAR_KEY);
  } catch {
    // localStorage unavailable (SSR or private mode)
  }
}

// ── Store ─────────────────────────────────────────────────────

export const useUIStore = create<UIStore>((set) => ({
  sidebarCollapsed: loadSidebarState(),
  cmdkOpen: false,

  toggleSidebar: () => {
    set((state) => {
      const next = !state.sidebarCollapsed;
      saveSidebarState(next);
      return { sidebarCollapsed: next };
    });
  },

  setSidebarCollapsed: (collapsed) => {
    saveSidebarState(collapsed);
    set({ sidebarCollapsed: collapsed });
  },

  setCmdkOpen: (open) => {
    set({ cmdkOpen: open });
  },
}));
