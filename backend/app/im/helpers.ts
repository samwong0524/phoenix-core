"use client";

import type { WorkspaceDefaults } from "./types";

export const SESSION_KEY = "agent-wechat.session.v1";

// Layout constants for the IM page panels
export const RIGHT_PANEL_MIN_HEIGHT = 120;
export const RIGHT_PANEL_HEADER_HEIGHT = 32;
export const MID_CHAT_MIN_HEIGHT = 0;
export const MID_GRAPH_MIN_HEIGHT = 160;
export const MID_SPLITTER_SIZE = 6;

export function loadSession(): WorkspaceDefaults | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as WorkspaceDefaults;
  } catch {
    return null;
  }
}

export function saveSession(session: WorkspaceDefaults) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText} ${text}`);
  }
  return (await res.json()) as T;
}

export function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit" });
}

export function cx(...classes: Array<string | false | undefined | null>) {
  return classes.filter(Boolean).join(" ");
}