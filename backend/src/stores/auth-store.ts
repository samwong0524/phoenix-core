"use client";

import { create } from "zustand";

// ── Types ─────────────────────────────────────────────────────

export type UserRole = "owner" | "admin" | "member" | "viewer";

export type AuthUser = {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
};

type AuthState = {
  user: AuthUser | null;
  status: "idle" | "loading" | "authenticated" | "unauthenticated";
  error: string | null;
};

type AuthActions = {
  fetchUser: () => Promise<void>;
  setUser: (user: AuthUser | null) => void;
  clear: () => void;
  hasRole: (minRole: UserRole) => boolean;
};

type AuthStore = AuthState & AuthActions;

// ── Role hierarchy ────────────────────────────────────────────

const ROLE_LEVEL: Record<UserRole, number> = {
  owner: 100,
  admin: 80,
  member: 50,
  viewer: 10,
};

// ── Store ─────────────────────────────────────────────────────

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: null,
  status: "idle",
  error: null,

  fetchUser: async () => {
    set({ status: "loading", error: null });
    try {
      const res = await fetch("/api/auth/me");
      if (!res.ok) {
        set({ user: null, status: "unauthenticated", error: null });
        return;
      }
      const data = await res.json();
      set({
        user: {
          id: data.id,
          email: data.email,
          name: data.name ?? null,
          role: data.role as UserRole,
        },
        status: "authenticated",
        error: null,
      });
    } catch (e) {
      set({
        user: null,
        status: "unauthenticated",
        error: e instanceof Error ? e.message : "Failed to fetch user",
      });
    }
  },

  setUser: (user) => {
    set({ user, status: user ? "authenticated" : "unauthenticated" });
  },

  clear: () => {
    set({ user: null, status: "unauthenticated", error: null });
  },

  hasRole: (minRole) => {
    const user = get().user;
    if (!user) return false;
    return ROLE_LEVEL[user.role] >= ROLE_LEVEL[minRole];
  },
}));
