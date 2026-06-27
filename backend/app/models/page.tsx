"use client";

import Link from "next/link";
import { ArrowLeft, Save, Send, CheckCircle2, AlertCircle, Loader2, Eye, EyeOff } from "lucide-react";
import { useEffect, useState } from "react";

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
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);

  const fetchConfig = async () => {
    try {
      const res = await fetch("/api/settings/provider");
      const data = await res.json();
      setConfig(data);
    } catch (e) {
      console.error("Failed to fetch config", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchConfig(); }, []);

  const save = async () => {
    if (!config) return;
    setSaving(true);
    setSaved(false);
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
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      console.error("Failed to save config", e);
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

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>
        <Loader2 className="animate-spin" size={24} style={{ color: "var(--cyan)" }} />
      </div>
    );
  }

  if (!config) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "var(--red)" }}>
        Failed to load configuration
      </div>
    );
  }

  return (
    <div style={{ height: "100vh", overflowY: "auto", background: "var(--bg-void)" }}>
      {/* Top bar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 16,
        padding: "16px 24px", borderBottom: "1px solid var(--border)",
        position: "sticky", top: 0, zIndex: 10,
        background: "var(--bg-void)",
      }}>
        <Link href="/" style={{
          display: "flex", alignItems: "center", gap: 6,
          color: "var(--cyan)", textDecoration: "none", fontSize: 13, fontWeight: 600,
        }}>
          <ArrowLeft size={16} />
          Back
        </Link>
        <div style={{ width: 1, height: 20, background: "var(--border)" }} />
        <h1 style={{ margin: 0, fontSize: 15, fontFamily: "var(--font-display)", color: "var(--cyan)" }}>
          LLM Configuration
        </h1>
        {saved && (
          <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--green)" }}>
            <CheckCircle2 size={14} /> Saved
          </span>
        )}
      </div>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px 80px" }}>
        {/* Provider selection */}
        <Field label="LLM Provider">
          <select
            value={config.llmProvider}
            onChange={(e) => update("llmProvider", e.target.value)}
            style={inputStyle}
          >
            <option value="freellmapi">FreeLLMAPI</option>
            <option value="openrouter">OpenRouter</option>
            <option value="anthropic">Anthropic-compatible</option>
            <option value="ollama">Ollama</option>
          </select>
        </Field>

        {/* Base URL */}
        <Field label="API Base URL">
          <input
            type="text"
            value={config.baseUrl}
            onChange={(e) => update("baseUrl", e.target.value)}
            placeholder="http://127.0.0.1:8080/v1"
            style={inputStyle}
          />
          <p style={{ margin: "6px 0 0", fontSize: 11, color: "var(--text-secondary)" }}>
            For llama.cpp: http://127.0.0.1:8080/v1
          </p>
        </Field>

        {/* API Key */}
        <Field label="API Key">
          <div style={{ position: "relative" }}>
            <input
              type={showKey ? "text" : "password"}
              value={config.apiKey}
              onChange={(e) => update("apiKey", e.target.value)}
              placeholder={config.hasApiKey ? config.apiKeyMasked : "(empty)"}
              style={{ ...inputStyle, paddingRight: 40 }}
            />
            <button
              onClick={() => setShowKey(!showKey)}
              style={{
                position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer",
                display: "flex", padding: 4,
              }}
            >
              {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <p style={{ margin: "6px 0 0", fontSize: 11, color: "var(--text-secondary)" }}>
            Leave empty for local servers (llama.cpp). For cloud APIs, paste your key here.
          </p>
        </Field>

        {/* Model name */}
        <Field label="Model">
          <input
            type="text"
            value={config.model}
            onChange={(e) => update("model", e.target.value)}
            placeholder="auto or exact model name"
            style={inputStyle}
          />
          <p style={{ margin: "6px 0 0", fontSize: 11, color: "var(--text-secondary)" }}>
            Use "auto" for provider default, or specify exact model.
          </p>
        </Field>

        {/* Buttons */}
        <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
          <button
            onClick={save}
            disabled={saving}
            style={{
              ...btnStyle, background: saving ? "var(--text-dim)" : "var(--cyan)",
              color: saving ? "var(--text-dim)" : "#050a14",
            }}
          >
            <Save size={16} />
            {saving ? "Saving..." : "Save Config"}
          </button>
          <button
            onClick={testConnection}
            disabled={testing}
            style={{
              ...btnStyle, background: "var(--bg-card)", color: "var(--cyan)",
              border: "1px solid var(--border-bright)",
            }}
          >
            <Send size={16} />
            {testing ? "Testing..." : "Test Connection"}
          </button>
        </div>

        {/* Test result */}
        {testResult && (
          <div style={{
            marginTop: 20, padding: "14px 18px", borderRadius: 8,
            background: testResult.ok ? "rgba(0,255,136,0.06)" : "rgba(255,59,59,0.06)",
            border: `1px solid ${testResult.ok ? "var(--green-dim)" : "var(--red)" }`,
            display: "flex", alignItems: "flex-start", gap: 10,
          }}>
            {testResult.ok ? (
              <CheckCircle2 size={18} style={{ color: "var(--green)", marginTop: 2, flexShrink: 0 }} />
            ) : (
              <AlertCircle size={18} style={{ color: "var(--red)", marginTop: 2, flexShrink: 0 }} />
            )}
            <div style={{ fontSize: 12, lineHeight: 1.6 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>
                {testResult.ok ? "Connection successful" : "Connection failed"}
              </div>
              {testResult.ok && (
                <>
                  <div style={{ color: "var(--text-secondary)" }}>
                    Model: {testResult.model}
                  </div>
                  <div style={{ color: "var(--text-secondary)", marginTop: 4 }}>
                    Reply: {testResult.reply}
                  </div>
                </>
              )}
              {!testResult.ok && (
                <div style={{ color: "var(--red)", wordBreak: "break-word" }}>
                  {testResult.error}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Current status */}
        <div style={{
          marginTop: 40, padding: "16px 20px", borderRadius: 8,
          border: "1px solid var(--border)", background: "var(--bg-panel)",
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
            Current Active Config
          </div>
          <div style={{ fontSize: 12, lineHeight: 2, fontFamily: "var(--font-mono)" }}>
            <div><span style={{ color: "var(--text-dim)" }}>Provider: </span><span style={{ color: "var(--cyan)" }}>{config.llmProvider}</span></div>
            <div><span style={{ color: "var(--text-dim)" }}>URL: </span><span style={{ color: "var(--text-secondary)" }}>{config.baseUrl}</span></div>
            <div><span style={{ color: "var(--text-dim)" }}>Key: </span><span style={{ color: "var(--text-secondary)" }}>{config.hasApiKey ? config.apiKeyMasked : "(empty)"}</span></div>
            <div><span style={{ color: "var(--text-dim)" }}>Model: </span><span style={{ color: "var(--cyan)" }}>{config.model}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 14px",
  background: "var(--bg-card)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text-primary)",
  fontSize: 13,
  fontFamily: "var(--font-mono)",
  outline: "none",
  boxSizing: "border-box",
};

const btnStyle = {
  display: "inline-flex", alignItems: "center", gap: 8,
  padding: "10px 20px", borderRadius: 6, fontWeight: 600, fontSize: 13,
  border: "none", cursor: "pointer",
  transition: "opacity 0.15s ease",
};
