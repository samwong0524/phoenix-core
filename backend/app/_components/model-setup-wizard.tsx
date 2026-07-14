"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Zap, CheckCircle2, AlertCircle, Eye, EyeOff, X, ArrowRight, Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { Button } from "@/components/ui";

/** Preset configurations for popular LLM providers */
const PRESETS = [
  {
    id: "deepseek",
    provider: "anthropic",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    label: "DeepSeek",
    hint: "deepseek.com",
  },
  {
    id: "openai",
    provider: "anthropic",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    label: "OpenAI",
    hint: "openai.com",
  },
  {
    id: "zhipu",
    provider: "anthropic",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4-flash",
    label: "智谱 GLM",
    hint: "bigmodel.cn",
  },
  {
    id: "openrouter",
    provider: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "auto",
    label: "OpenRouter",
    hint: "openrouter.ai",
  },
] as const;

type Step = "choose" | "key" | "testing" | "done" | "error";

type SetupWizardProps = {
  open: boolean;
  onClose: () => void;
};

export function ModelSetupWizard({ open, onClose }: SetupWizardProps) {
  const { t } = useI18n();

  const [step, setStep] = useState<Step>("choose");
  const [selectedPreset, setSelectedPreset] = useState<(typeof PRESETS)[number] | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [testReply, setTestReply] = useState("");
  const [testError, setTestError] = useState("");

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setStep("choose");
      setSelectedPreset(null);
      setApiKey("");
      setShowKey(false);
      setTestReply("");
      setTestError("");
    }
  }, [open]);

  const selectPreset = (preset: (typeof PRESETS)[number]) => {
    setSelectedPreset(preset);
    setStep("key");
  };

  const saveAndTest = useCallback(async () => {
    if (!selectedPreset || !apiKey.trim()) return;

    setStep("testing");
    setTestError("");
    setTestReply("");

    try {
      // 1. Save config
      const saveRes = await fetch("/api/settings/provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          llmProvider: selectedPreset.provider,
          baseUrl: selectedPreset.baseUrl,
          apiKey: apiKey.trim(),
          model: selectedPreset.model,
        }),
      });

      if (!saveRes.ok) {
        throw new Error(`Save failed: ${saveRes.status}`);
      }

      // 2. Test connection
      const testRes = await fetch("/api/settings/test-connection", { method: "POST" });
      const data = await testRes.json();

      if (data.ok) {
        setTestReply(data.reply ?? "");
        setStep("done");
      } else {
        setTestError(data.error ?? t("wizard.test_fail_unknown"));
        setStep("error");
      }
    } catch (e) {
      setTestError(e instanceof Error ? e.message : String(e));
      setStep("error");
    }
  }, [selectedPreset, apiKey, t]);

  const handleSkip = () => {
    // Mark as dismissed so we don't auto-pop again
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem("wizard-dismissed", "1");
      } catch {
        // localStorage may not be available
      }
    }
    onClose();
  };

  const handleDone = () => {
    onClose();
  };

  // Keyboard: Escape to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleSkip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[9999] flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/60"
            onClick={handleSkip}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          {/* Modal */}
          <motion.div
            className="relative z-10 w-full max-w-lg mx-4 bg-panel border border-border rounded-xl overflow-hidden"
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.25, ease: [0.2, 0, 0, 1] }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-5 pb-3">
              <div className="flex items-center gap-2">
                <Zap size={16} className="text-primary" />
                <span className="text-sm font-bold">{t("wizard.title")}</span>
              </div>
              <button
                onClick={handleSkip}
                className="p-1 rounded-md hover:bg-elevated transition-colors"
                aria-label={t("common.close")}
              >
                <X size={16} className="text-text-secondary" />
              </button>
            </div>

            {/* Body */}
            <div className="px-6 pb-6">
              <AnimatePresence mode="wait">
                {/* Step 1: Choose provider */}
                {step === "choose" && (
                  <motion.div
                    key="choose"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.2 }}
                  >
                    <p className="text-xs text-text-secondary mb-4">
                      {t("wizard.choose_desc")}
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      {PRESETS.map((preset) => (
                        <button
                          key={preset.id}
                          onClick={() => selectPreset(preset)}
                          className="flex flex-col items-start gap-1 p-4 rounded-lg border border-border bg-card hover:border-primary-dim hover:bg-elevated transition-all text-left cursor-pointer"
                        >
                          <span className="text-sm font-semibold">{preset.label}</span>
                          <span className="text-[10px] font-[family-name:var(--font-mono)] text-text-dim">
                            {preset.hint}
                          </span>
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={handleSkip}
                      className="mt-4 text-xs text-text-dim hover:text-text-secondary transition-colors cursor-pointer"
                    >
                      {t("wizard.skip")}
                    </button>
                  </motion.div>
                )}

                {/* Step 2: Enter API key */}
                {step === "key" && selectedPreset && (
                  <motion.div
                    key="key"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div className="mb-4">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="w-5 h-5 rounded-full bg-primary-soft flex items-center justify-center text-[10px] font-bold text-primary">
                          {selectedPreset.label.charAt(0)}
                        </div>
                        <span className="text-sm font-semibold">{selectedPreset.label}</span>
                        <span className="text-[10px] font-[family-name:var(--font-mono)] text-text-dim">
                          {selectedPreset.model}
                        </span>
                      </div>
                      <p className="text-[11px] text-text-dim font-[family-name:var(--font-mono)]">
                        {selectedPreset.baseUrl}
                      </p>
                    </div>

                    <label className="block text-xs font-semibold text-text-secondary mb-2 uppercase tracking-wide">
                      {t("wizard.api_key_label")}
                    </label>
                    <div className="relative mb-4">
                      <input
                        type={showKey ? "text" : "password"}
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder="sk-..."
                        className="w-full px-3 py-2.5 pr-10 rounded-lg bg-void border border-border text-sm font-[family-name:var(--font-mono)] outline-none focus:border-primary-dim transition-colors"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && apiKey.trim()) saveAndTest();
                        }}
                      />
                      <button
                        onClick={() => setShowKey(!showKey)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-text-dim hover:text-text-secondary cursor-pointer"
                        aria-label={showKey ? "Hide" : "Show"}
                      >
                        {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>

                    <div className="flex gap-3">
                      <Button
                        variant="primary"
                        onClick={saveAndTest}
                        disabled={!apiKey.trim()}
                      >
                        <span className="flex items-center gap-1.5">
                          {t("wizard.test_btn")}
                          <ArrowRight size={14} />
                        </span>
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => setStep("choose")}
                      >
                        {t("common.cancel")}
                      </Button>
                    </div>
                  </motion.div>
                )}

                {/* Step 3: Testing */}
                {step === "testing" && (
                  <motion.div
                    key="testing"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex flex-col items-center py-8"
                  >
                    <Loader2 size={32} className="text-primary animate-spin mb-4" />
                    <p className="text-sm font-semibold">{t("wizard.testing")}</p>
                    <p className="text-xs text-text-dim mt-1">
                      {selectedPreset?.label} · {selectedPreset?.model}
                    </p>
                  </motion.div>
                )}

                {/* Step 4: Success */}
                {step === "done" && (
                  <motion.div
                    key="done"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex flex-col items-center py-6"
                  >
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: "spring", stiffness: 300, damping: 20, delay: 0.1 }}
                    >
                      <CheckCircle2 size={48} className="text-green-500 mb-4" />
                    </motion.div>
                    <p className="text-sm font-bold mb-1">{t("wizard.done")}</p>
                    <p className="text-xs text-text-secondary mb-3">
                      {selectedPreset?.label} · {selectedPreset?.model}
                    </p>
                    {testReply && (
                      <div className="w-full max-w-sm p-3 rounded-lg bg-void border border-border mb-4">
                        <p className="text-[11px] text-text-dim mb-1 uppercase tracking-wide font-semibold">
                          {t("wizard.test_reply")}
                        </p>
                        <p className="text-xs text-text-secondary line-clamp-3">
                          {testReply}
                        </p>
                      </div>
                    )}
                    <Button variant="primary" onClick={handleDone}>
                      {t("wizard.start_using")}
                    </Button>
                  </motion.div>
                )}

                {/* Step 5: Error */}
                {step === "error" && (
                  <motion.div
                    key="error"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div className="flex items-start gap-3 p-4 rounded-lg border border-red-500/30 bg-red-500/5 mb-4">
                      <AlertCircle size={18} className="text-red-500 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-sm font-bold mb-1">{t("wizard.error_title")}</p>
                        <p className="text-xs text-text-secondary break-words">{testError}</p>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <Button variant="primary" onClick={() => setStep("key")}>
                        {t("wizard.retry")}
                      </Button>
                      <Button variant="secondary" onClick={handleSkip}>
                        {t("wizard.skip")}
                      </Button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Hook: checks if LLM is configured and manages wizard visibility.
 * Returns { wizardOpen, openWizard, closeWizard }.
 */
export function useModelSetupWizard() {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch("/api/settings/provider");
        const data = await res.json();
        if (cancelled) return;

        // Auto-pop if no API key is configured and wizard hasn't been dismissed
        const dismissed =
          typeof window !== "undefined" &&
          (() => {
            try {
              return window.localStorage.getItem("wizard-dismissed") === "1";
            } catch {
              return false;
            }
          })();

        if (!data.hasApiKey && !dismissed) {
          setWizardOpen(true);
        }
      } catch {
        // Silently ignore — wizard won't auto-pop
      } finally {
        if (!cancelled) setChecked(true);
      }
    }

    check();
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    wizardOpen,
    checked,
    openWizard: () => setWizardOpen(true),
    closeWizard: () => setWizardOpen(false),
  };
}
