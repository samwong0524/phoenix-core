"use client";

import { useState, FormEvent, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ROUTES } from "@/app/_components/routes";

// ── Types ─────────────────────────────────────────────────────

type OAuthProviderInfo = { id: string; name: string };

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  oauth_state_mismatch: "会话已过期，请重试",
  oauth_no_code: "认证已取消",
  oauth_provider_not_found: "OAuth 提供商未配置",
  oauth_token_exchange_failed: "认证失败，请重试",
  oauth_userinfo_failed: "无法获取用户信息",
};

// ── Styles ────────────────────────────────────────────────────

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "var(--bg-void)",
  padding: 16,
};

const containerStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 400,
};

const logoStyle: React.CSSProperties = {
  textAlign: "center",
  marginBottom: 32,
};

const logoTitleStyle: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 700,
  fontFamily: "var(--font-display)",
  letterSpacing: "0.12em",
  color: "var(--color-primary)",
  margin: 0,
};

const logoSubtitleStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--text-secondary)",
  marginTop: 8,
  fontFamily: "var(--font-body)",
};

const cardStyle: React.CSSProperties = {
  background: "var(--bg-panel)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  padding: 28,
  backdropFilter: "blur(20px)",
};

const cardTitleStyle: React.CSSProperties = {
  fontSize: 17,
  fontWeight: 600,
  color: "var(--text-primary)",
  marginBottom: 20,
  fontFamily: "var(--font-body)",
};

const oauthButtonBase: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  width: "100%",
  padding: "10px 0",
  borderRadius: "var(--radius-md)",
  fontSize: 13,
  fontWeight: 600,
  fontFamily: "var(--font-body)",
  textDecoration: "none",
  transition: "all 0.2s cubic-bezier(0.2, 0, 0, 1)",
  cursor: "pointer",
};

const oauthGithub: React.CSSProperties = {
  ...oauthButtonBase,
  background: "#24292e",
  color: "#ffffff",
  border: "1px solid rgba(255,255,255,0.15)",
};

const oauthGoogle: React.CSSProperties = {
  ...oauthButtonBase,
  background: "#ffffff",
  color: "#1f2937",
  border: "1px solid rgba(0,0,0,0.15)",
};

const dividerRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  marginTop: 16,
  marginBottom: 16,
};

const dividerLine: React.CSSProperties = {
  flex: 1,
  height: 1,
  background: "var(--border)",
};

const dividerText: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-dim)",
  fontFamily: "var(--font-mono)",
};

const fieldGroup: React.CSSProperties = {
  marginBottom: 16,
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 500,
  color: "var(--text-secondary)",
  marginBottom: 6,
  fontFamily: "var(--font-body)",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: "var(--radius-md)",
  fontSize: 13,
  fontFamily: "var(--font-body)",
  background: "var(--bg-void)",
  border: "1px solid var(--border)",
  color: "var(--text-primary)",
  outline: "none",
  transition: "border-color 0.2s",
  boxSizing: "border-box",
};

const submitStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 0",
  borderRadius: "var(--radius-md)",
  fontSize: 13,
  fontWeight: 600,
  fontFamily: "var(--font-body)",
  border: "none",
  cursor: "pointer",
  transition: "all 0.2s cubic-bezier(0.2, 0, 0, 1)",
  background: "var(--color-primary)",
  color: "var(--bg-void)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
};

const submitDisabledStyle: React.CSSProperties = {
  ...submitStyle,
  opacity: 0.5,
  cursor: "not-allowed",
};

const toggleStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--color-primary)",
  fontSize: 12,
  cursor: "pointer",
  fontFamily: "var(--font-body)",
  padding: 0,
};

const errorStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: "var(--radius-md)",
  background: "var(--red-soft)",
  border: "1px solid var(--red-muted)",
  color: "var(--red-text)",
  fontSize: 12,
  lineHeight: 1.5,
  marginBottom: 16,
};

const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-dim)",
  textAlign: "center",
  marginTop: 12,
};

const spinnerStyle: React.CSSProperties = {
  display: "inline-block",
  width: 14,
  height: 14,
  border: "2px solid currentColor",
  borderTopColor: "transparent",
  borderRadius: "50%",
  animation: "phx-spin 0.6s linear infinite",
};

// ── Component ─────────────────────────────────────────────────

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [oauthProviders, setOAuthProviders] = useState<OAuthProviderInfo[]>([]);

  useEffect(() => {
    fetch("/api/auth/oauth/providers")
      .then((res) => res.json())
      .then((data) => setOAuthProviders(data.providers ?? []))
      .catch(() => {});

    const urlError = searchParams.get("error");
    if (urlError) {
      setError(OAUTH_ERROR_MESSAGES[urlError] ?? "OAuth 认证失败");
    }
  }, [searchParams]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const body =
        mode === "login"
          ? { email, password }
          : { email, password, name: name || undefined };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "发生错误");
        return;
      }

      router.push(ROUTES.HOME);
      router.refresh();
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={pageStyle}>
      <div style={containerStyle}>
        {/* Logo */}
        <div style={logoStyle}>
          <h1 style={logoTitleStyle}>PHOENIX</h1>
          <p style={logoSubtitleStyle}>多智能体协作平台</p>
        </div>

        {/* Card */}
        <div style={cardStyle}>
          <h2 style={cardTitleStyle}>
            {mode === "login" ? "登录" : "创建账号"}
          </h2>

          {/* OAuth */}
          {oauthProviders.length > 0 && (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                {oauthProviders.map((p) => (
                  <a
                    key={p.id}
                    href={`/api/auth/oauth/${p.id}`}
                    style={p.id === "github" ? oauthGithub : oauthGoogle}
                  >
                    {p.id === "github" && (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                      </svg>
                    )}
                    {p.id === "google" && (
                      <svg width="18" height="18" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                      </svg>
                    )}
                    {p.id === "github" ? `通过 ${p.name} 登录` : `通过 ${p.name} 登录`}
                  </a>
                ))}
              </div>

              <div style={dividerRow}>
                <div style={dividerLine} />
                <span style={dividerText}>或</span>
                <div style={dividerLine} />
              </div>
            </>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit}>
            {mode === "register" && (
              <div style={fieldGroup}>
                <label htmlFor="name" style={labelStyle}>
                  姓名（可选）
                </label>
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="你的名字"
                  style={inputStyle}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = "var(--color-primary-dim)";
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = "var(--border)";
                  }}
                />
              </div>
            )}

            <div style={fieldGroup}>
              <label htmlFor="email" style={labelStyle}>
                邮箱
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                style={inputStyle}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "var(--color-primary-dim)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = "var(--border)";
                }}
              />
            </div>

            <div style={fieldGroup}>
              <label htmlFor="password" style={labelStyle}>
                密码
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === "register" ? "至少 6 个字符" : "你的密码"}
                required
                minLength={mode === "register" ? 6 : undefined}
                style={inputStyle}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "var(--color-primary-dim)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = "var(--border)";
                }}
              />
            </div>

            {error && (
              <div style={errorStyle}>{error}</div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={loading ? submitDisabledStyle : submitStyle}
            >
              {loading && <span style={spinnerStyle} />}
              {loading
                ? "请稍候…"
                : mode === "login"
                  ? "登录"
                  : "创建账号"}
            </button>
          </form>

          {/* Mode toggle */}
          <div style={{ marginTop: 16, textAlign: "center" }}>
            <button
              onClick={() => {
                setMode(mode === "login" ? "register" : "login");
                setError("");
              }}
              style={toggleStyle}
            >
              {mode === "login" ? "没有账号？注册" : "已有账号？登录"}
            </button>
          </div>

          {mode === "register" && (
            <p style={hintStyle}>
              第一个注册的用户将自动成为管理员
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
