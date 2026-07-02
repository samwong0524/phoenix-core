"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Globe, Palette, Cpu, Info } from "lucide-react";
import { motion } from "framer-motion";
import { corporateVariants } from "@/lib/motion";
import { useI18n } from "@/lib/i18n/context";
import { toast } from "@/components/ui";
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

  useEffect(() => {
    const saved = getCookie("swarm-theme") as Theme | null;
    if (saved && ["dark", "light", "system"].includes(saved)) {
      setThemeState(saved);
    }
  }, []);

  const handleThemeChange = useCallback(
    (next: Theme) => {
      setThemeState(next);
      setCookie("swarm-theme", next);
      applyTheme(next);
      toast.success(t("settings.saved"));
    },
    [t],
  );

  const handleLocaleChange = useCallback(
    (next: "zh" | "en") => {
      setLocale(next);
      toast.success(t("settings.saved"));
    },
    [setLocale, t],
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
      <motion.div
        variants={corporateVariants.staggerContainer}
        initial="hidden"
        animate="visible"
        className="max-w-[600px] flex flex-col gap-6"
      >
        {/* Language */}
        <SettingsSection icon={Globe} title={t("settings.language")} desc={t("settings.language_desc")}>
          <SegmentedControl
            options={locales}
            value={locale}
            onChange={(v) => handleLocaleChange(v as "zh" | "en")}
            label={t("settings.language")}
          />
        </SettingsSection>

        {/* Theme */}
        <SettingsSection icon={Palette} title={t("settings.theme")} desc={t("settings.theme_desc")}>
          <SegmentedControl
            options={themes}
            value={theme}
            onChange={(v) => handleThemeChange(v as Theme)}
            label={t("settings.theme")}
          />
        </SettingsSection>

        {/* LLM Config link */}
        <SettingsSection icon={Cpu} title={t("settings.llm")} desc={t("settings.llm_desc")}>
          <Link
            href={ROUTES.MODELS}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[var(--radius-sm)] border border-border bg-elevated text-primary text-[13px] font-[family-name:var(--font-mono)] no-underline transition-colors hover:border-bright"
          >
            {t("settings.llm_goto")} →
          </Link>
        </SettingsSection>

        {/* About */}
        <SettingsSection icon={Info} title={t("settings.about")} desc="">
          <div className="text-[13px] text-text-secondary font-[family-name:var(--font-mono)]">
            {t("settings.version")}: <span className="text-text">1.0.0</span>
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
      className="bg-card border border-border rounded-[var(--radius-sm)] px-6 py-5"
    >
      <div className={`flex items-center gap-2.5 ${desc ? "mb-1.5" : "mb-3"}`}>
        <Icon size={16} className="text-primary shrink-0" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-text m-0">{title}</h2>
      </div>
      {desc && (
        <p className="text-[13px] text-text-secondary ml-[26px] mb-3 leading-[1.5] mt-0">
          {desc}
        </p>
      )}
      <div className="ml-[26px]">{children}</div>
    </motion.section>
  );
}

function SegmentedControl({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    let nextIndex = index;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      nextIndex = (index + 1) % options.length;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      nextIndex = (index - 1 + options.length) % options.length;
    }
    if (nextIndex !== index) {
      onChange(options[nextIndex].value);
      // Focus the newly selected button
      const parent = (e.target as HTMLElement).parentElement;
      const buttons = parent?.querySelectorAll<HTMLElement>('[role="radio"]');
      buttons?.[nextIndex]?.focus();
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex rounded-[var(--radius-sm)] border border-border overflow-hidden"
    >
      {options.map((opt, index) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            className={`px-4 py-1.5 text-[13px] font-[family-name:var(--font-mono)] border-0 cursor-pointer transition-all ${
              active
                ? "bg-primary text-black font-semibold"
                : "bg-elevated text-text-secondary font-normal"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
