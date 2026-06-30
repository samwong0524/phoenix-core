"use client";

import { CheckCircle2, AlertCircle, Eye, EyeOff } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { corporateVariants } from "@/lib/motion";
import { useI18n } from "@/lib/i18n/context";
import { Button, Card, Input, toast } from "@/components/ui";
import { PageLayout } from "../_components/PageLayout";
import { ROUTES } from "../_components/routes";

type Config = {
  llmProvider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  apiKeyMasked: string;
  hasApiKey: boolean;
};

type TestResult = {
  ok: boolean;
  status: number;
  reply?: string;
  model?: string;
  error?: string;
};

export default function ModelsPage() {
  const { t } = useI18n();
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchConfig = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/settings/provider");
      const data = await res.json();
      setConfig(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  const save = async () => {
    if (!config) return;
    setSaving(true);
    try {
      await fetch("/api/settings/provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          llmProvider: config.llmProvider,
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          model: config.model,
        }),
      });
      toast.success(t("models.saved"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/settings/test-connection", { method: "POST" });
      const data = await res.json();
      setTestResult(data);
    } catch (e) {
      setTestResult({ ok: false, status: 0, error: String(e) });
    } finally {
      setTesting(false);
    }
  };

  const update = (key: keyof Config, value: string) => {
    setConfig((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  return (
    <PageLayout
      title={t("models.title")}
      backHref={ROUTES.SETTINGS}
      backLabel={`← ${t("common.back_home")}`}
      loading={loading}
      error={error}
      onRetry={fetchConfig}
    >
      <motion.div
        variants={corporateVariants.staggerContainer}
        initial="hidden"
        animate="visible"
        style={{ maxWidth: 600, display: "flex", flexDirection: "column", gap: 0 }}
      >
        {/* Provider selection */}
        <FormField label={t("models.provider")}>
          <select
            value={config?.llmProvider ?? ""}
            onChange={(e) => update("llmProvider", e.target.value)}
            className="models-input"
          >
            <option value="freellmapi">FreeLLMAPI</option>
            <option value="openrouter">OpenRouter</option>
            <option value="anthropic">Anthropic-compatible</option>
            <option value="ollama">Ollama</option>
          </select>
        </FormField>

        {/* Base URL */}
        <FormField label={t("models.api_base")}>
          <Input
            variant="mono"
            value={config?.baseUrl ?? ""}
            onChange={(e) => update("baseUrl", e.target.value)}
            placeholder="http://127.0.0.1:8080/v1"
          />
          <p style={{ margin: "6px 0 0", fontSize: 11, color: "var(--text-secondary)" }}>
            {t("models.api_base_hint")}
          </p>
        </FormField>

        {/* API Key */}
        <FormField label={t("models.api_key")}>
          <div style={{ position: "relative" }}>
            <Input
              type={showKey ? "text" : "password"}
              variant="mono"
              value={config?.apiKey ?? ""}
              onChange={(e) => update("apiKey", e.target.value)}
              placeholder={config?.hasApiKey ? config.apiKeyMasked : t("models.api_key_empty")}
              style={{ paddingRight: 40 }}
            />
            <button
              onClick={() => setShowKey(!showKey)}
              className="models-eye-btn"
              style={{
                position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer",
                display: "flex", padding: 4,
              }}
              aria-label={showKey ? "Hide API key" : "Show API key"}
            >
              {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <p style={{ margin: "6px 0 0", fontSize: 11, color: "var(--text-secondary)" }}>
            {t("models.api_key_hint")}
          </p>
        </FormField>

        {/* Model name */}
        <FormField label={t("models.model")}>
          <Input
            variant="mono"
            value={config?.model ?? ""}
            onChange={(e) => update("model", e.target.value)}
            placeholder="auto or exact model name"
          />
          <p style={{ margin: "6px 0 0", fontSize: 11, color: "var(--text-secondary)" }}>
            {t("models.model_hint")}
          </p>
        </FormField>

        {/* Buttons */}
        <motion.div
          variants={corporateVariants.staggerItem}
          style={{ display: "flex", gap: 12, marginTop: 24 }}
        >
          <Button variant="primary" onClick={save} disabled={saving} loading={saving}>
            {saving ? t("models.saving") : t("models.save")}
          </Button>
          <Button variant="secondary" onClick={testConnection} disabled={testing}>
            {testing ? t("models.testing") : t("models.test")}
          </Button>
        </motion.div>

        {/* Test result */}
        <AnimatePresence>
          {testResult && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25, ease: [0.2, 0, 0, 1] }}
              style={{
                marginTop: 20, padding: "14px 18px", borderRadius: 8,
                background: testResult.ok ? "rgba(0,255,136,0.06)" : "rgba(255,59,59,0.06)",
                border: `1px solid ${testResult.ok ? "var(--green-dim)" : "var(--red)"}`,
                display: "flex", alignItems: "flex-start", gap: 10,
              }}
            >
              {testResult.ok ? (
                <CheckCircle2 size={18} style={{ color: "var(--green)", marginTop: 2, flexShrink: 0 }} />
              ) : (
                <AlertCircle size={18} style={{ color: "var(--red)", marginTop: 2, flexShrink: 0 }} />
              )}
              <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>
                  {testResult.ok ? t("models.test_ok") : t("models.test_fail")}
                </div>
                {testResult.ok && (
                  <>
                    <div style={{ color: "var(--text-secondary)" }}>
                      {t("models.test_model")} {testResult.model}
                    </div>
                    <div style={{ color: "var(--text-secondary)", marginTop: 4 }}>
                      {t("models.test_reply")} {testResult.reply}
                    </div>
                  </>
                )}
                {!testResult.ok && (
                  <div style={{ color: "var(--red)", wordBreak: "break-word" }}>
                    {testResult.error}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Current active config */}
        <motion.div variants={corporateVariants.staggerItem}>
          <Card padding="16px 20px" borderRadius="var(--radius-sm)">
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
              {t("models.active_config")}
            </div>
            <div style={{ fontSize: 12, lineHeight: 2, fontFamily: "var(--font-mono)" }}>
              <div><span style={{ color: "var(--text-dim)" }}>{t("models.cfg_provider")} </span><span style={{ color: "var(--cyan)" }}>{config?.llmProvider}</span></div>
              <div><span style={{ color: "var(--text-dim)" }}>{t("models.cfg_url")} </span><span style={{ color: "var(--text-secondary)" }}>{config?.baseUrl}</span></div>
              <div><span style={{ color: "var(--text-dim)" }}>{t("models.cfg_key")} </span><span style={{ color: "var(--text-secondary)" }}>{config?.hasApiKey ? config.apiKeyMasked : t("models.api_key_empty")}</span></div>
              <div><span style={{ color: "var(--text-dim)" }}>{t("models.cfg_model")} </span><span style={{ color: "var(--cyan)" }}>{config?.model}</span></div>
            </div>
          </Card>
        </motion.div>
      </motion.div>
    </PageLayout>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <motion.div variants={corporateVariants.staggerItem} style={{ marginBottom: 20 }}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </label>
      {children}
    </motion.div>
  );
}
