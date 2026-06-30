"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Globe, Palette, Cpu, Info, Check } from "lucide-react";
import { motion } from "framer-motion";
import { corporateVariants } from "@/lib/motion";
import { useI18n } from "@/lib/i18n/context";
import { PageLayout } from "../_components/PageLayout";
import { ROUTES } from "../_components/routes";

type Theme = "dark" | "light" | "system";

function getCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function setCookie(name: string, value: string, days = 365) {
  const d = new Date();
  d.setTime(d.getTime() + days * 864e5);
  document.cookie = `${name}=${encodeURIComponent(value)};expires=${d.toUTCString()};path=/;SameSite=Lax`;
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", theme);
  }
}

export default function SettingsPage() {
  const { locale, setLocale, t } = useI18n();
  const [theme, setThemeState] = useState<Theme>("system");
  const [toast, setToast] = useState(false);

  useEffect(() => {
    const saved = getCookie("swarm-theme") as Theme | null;
    if (saved && ["dark", "light", "system"].includes(saved)) {
      setThemeState(saved);
    }
  }, []);

  const showToast = useCallback(() => {
    setToast(true);
    setTimeout(() => setToast(false), 2000);
  }, []);

  const handleThemeChange = useCallback(
    (next: Theme) => {
      setThemeState(next);
      setCookie("swarm-theme", next);
      applyTheme(next);
      showToast();
    },
    [showToast],
  );

  const handleLocaleChange = useCallback(
    (next: "zh" | "en") => {
      setLocale(next);
      showToast();
    },
    [setLocale, showToast],
  );

  const themes: { value: Theme; label: string }[] = [
    { value: "dark", label: t("settings.theme_dark") },
    { value: "light", label: t("settings.theme_light") },
    { value: "system", label: t("settings.theme_system") },
  ];

  const locales: { value: "zh" | "en"; label: string }[] = [
    { value: "zh", label: "中文" },
    { value: "en", label: "English" },
  ];

  return (
    <PageLayout title={t("settings.title")} backHref={ROUTES.CHAT}>
      {/* Toast */}
      {toast && (
        <motion.div
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 16 }}
          transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
          style={{
            position: "fixed",
            top: 16,
            right: 16,
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 16px",
            borderRadius: "var(--radius-sm)",
            background: "rgba(0, 200, 120, 0.15)",
            border: "1px solid rgba(0, 200, 120, 0.3)",
            color: "#00c878",
            fontSize: 13,
            fontFamily: "var(--font-mono)",
          }}
        >
          <Check size={14} />
          {t("settings.saved")}
        </motion.div>
      )}

      <motion.div
        variants={corporateVariants.staggerContainer}
        initial="hidden"
        animate="visible"
        style={{ maxWidth: 600, display: "flex", flexDirection: "column", gap: 24 }}
      >
        {/* Language */}
        <SettingsSection icon={Globe} title={t("settings.language")} desc={t("settings.language_desc")}>
          <SegmentedControl
            options={locales}
            value={locale}
            onChange={(v) => handleLocaleChange(v as "zh" | "en")}
          />
        </SettingsSection>

        {/* Theme */}
        <SettingsSection icon={Palette} title={t("settings.theme")} desc={t("settings.theme_desc")}>
          <SegmentedControl
            options={themes}
            value={theme}
            onChange={(v) => handleThemeChange(v as Theme)}
          />
        </SettingsSection>

        {/* LLM Config link */}
        <SettingsSection icon={Cpu} title={t("settings.llm")} desc={t("settings.llm_desc")}>
          <Link
            href={ROUTES.MODELS}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 16px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)",
              background: "var(--bg-elevated)",
              color: "var(--accent-cyan)",
              fontSize: 13,
              fontFamily: "var(--font-mono)",
              textDecoration: "none",
              transition: "border-color 0.15s",
            }}
          >
            {t("settings.llm_goto")} →
          </Link>
        </SettingsSection>

        {/* About */}
        <SettingsSection icon={Info} title={t("settings.about")} desc="">
          <div
            style={{
              fontSize: 13,
              color: "var(--text-secondary)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {t("settings.version")}: <span style={{ color: "var(--text-primary)" }}>1.0.0</span>
          </div>
        </SettingsSection>
      </motion.div>
    </PageLayout>
  );
}

/* ── Shared sub-components ── */

function SettingsSection({
  icon: Icon,
  title,
  desc,
  children,
}: {
  icon: React.ElementType;
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <motion.section
      variants={corporateVariants.staggerItem}
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)",
        padding: "20px 24px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: desc ? 6 : 12 }}>
        <Icon size={16} style={{ color: "var(--accent-cyan)", flexShrink: 0 }} />
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{title}</span>
      </div>
      {desc && (
        <p
          style={{
            fontSize: 13,
            color: "var(--text-secondary)",
            margin: "0 0 12px 26px",
            lineHeight: 1.5,
          }}
        >
          {desc}
        </p>
      )}
      <div style={{ marginLeft: 26 }}>{children}</div>
    </motion.section>
  );
}

function SegmentedControl({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--border)",
        overflow: "hidden",
      }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            style={{
              padding: "6px 16px",
              fontSize: 13,
              fontFamily: "var(--font-mono)",
              border: "none",
              cursor: "pointer",
              transition: "all 0.15s",
              background: active ? "var(--accent-cyan)" : "var(--bg-elevated)",
              color: active ? "#000" : "var(--text-secondary)",
              fontWeight: active ? 600 : 400,
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
