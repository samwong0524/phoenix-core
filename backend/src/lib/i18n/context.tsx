"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import zhMessages from "./zh.json";
import enMessages from "./en.json";

// ─── Types ───────────────────────────────────────────────────

export type Locale = "zh" | "en";

type Messages = typeof zhMessages;

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: Record<string, unknown>) => string;
};

// ─── Messages lookup ─────────────────────────────────────────

const messages: Record<Locale, Messages> = {
  zh: zhMessages,
  en: enMessages,
};

// ─── Context ─────────────────────────────────────────────────

const I18nContext = createContext<I18nContextValue | null>(null);

// ─── Cookie helpers ──────────────────────────────────────────

const COOKIE_NAME = "swarm-locale";

function getCookieLocale(): Locale | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]*)`)
  );
  const val = match?.[1];
  if (val === "zh" || val === "en") return val;
  return null;
}

function setCookieLocale(locale: Locale) {
  document.cookie = `${COOKIE_NAME}=${locale};path=/;max-age=${365 * 24 * 60 * 60};SameSite=Lax`;
}

function getBrowserLocale(): Locale {
  if (typeof navigator === "undefined") return "zh";
  const lang = navigator.language?.toLowerCase();
  if (lang.startsWith("en")) return "en";
  return "zh";
}

// ─── Translation function factory ────────────────────────────

function makeT(locale: Locale) {
  const msgs = messages[locale];

  return function t(
    key: string,
    params?: Record<string, unknown>
  ): string {
    // Navigate nested keys: "im.send" → msgs.im.send
    const parts = key.split(".");
    let value: unknown = msgs;
    for (const part of parts) {
      if (value && typeof value === "object") {
        value = (value as Record<string, unknown>)[part];
      } else {
        return key; // fallback: return the key itself
      }
    }

    if (typeof value !== "string") return key;

    // Replace {placeholder} tokens
    if (!params) return value;
    return value.replace(/\{(\w+)\}/g, (_, name: string) => {
      return params[name] !== undefined ? String(params[name]) : `{${name}}`;
    });
  };
}

// ─── Provider ────────────────────────────────────────────────

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("zh");

  // Initialize locale from cookie or browser preference
  useEffect(() => {
    const cookieLocale = getCookieLocale();
    if (cookieLocale) {
      setLocaleState(cookieLocale);
    } else {
      setLocaleState(getBrowserLocale());
    }
  }, []);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    setCookieLocale(newLocale);
  }, []);

  const t = useMemo(() => makeT(locale), [locale]);

  const value = useMemo(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

// ─── Hook ────────────────────────────────────────────────────

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Fallback for components used outside provider (e.g., in tests)
    return {
      locale: "zh",
      setLocale: () => {},
      t: makeT("zh"),
    };
  }
  return ctx;
}

// ─── Language Switcher Component ─────────────────────────────

export function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, setLocale } = useI18n();

  return (
    <button
      onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
      className={className}
      title={locale === "zh" ? "Switch to English" : "切换为中文"}
      style={{
        background: "none",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)",
        color: "var(--text-secondary)",
        padding: "4px 10px",
        fontSize: 11,
        cursor: "pointer",
        fontFamily: "var(--font-body)",
        transition: "all 0.15s",
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
      }}
    >
      <span style={{ fontSize: 13 }}>🌐</span>
      {locale === "zh" ? "EN" : "中"}
    </button>
  );
}
