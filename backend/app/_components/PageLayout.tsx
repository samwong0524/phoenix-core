"use client";

/**
 * Phoenix-Core — 共享页面布局组件
 *
 * 统一的 page header（标题 + 返回链接）+ loading / error / empty 状态处理
 * 所有功能页面应使用此组件替代各自重复的 header + 状态处理
 *
 * 用法：
 *   <PageLayout title="技能管理" backHref="/" loading={isLoading} error={error}>
 *     <YourContent />
 *   </PageLayout>
 */

import type { ReactNode } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";

type PageLayoutProps = {
  /** 页面标题 */
  title: string;
  /** 返回链接目标，null 则不显示返回按钮 */
  backHref?: string | null;
  /** 返回链接文案 */
  backLabel?: string;
  /** 加载中状态：显示 skeleton */
  loading?: boolean;
  /** 错误状态：显示错误信息 + 重试按钮 */
  error?: string | null;
  /** 重试回调 */
  onRetry?: () => void;
  /** 空状态：显示空状态提示 */
  empty?: string | null;
  /** 空状态引导文案 */
  emptyHint?: string;
  /** header 右侧操作区（按钮等） */
  actions?: ReactNode;
  /** 页面内容 */
  children: ReactNode;
};

export function PageLayout({
  title,
  backHref = "/",
  backLabel,
  loading,
  error,
  onRetry,
  empty,
  emptyHint,
  actions,
  children,
}: PageLayoutProps) {
  const { t } = useI18n();
  const resolvedBackLabel = backLabel ?? t("common.back_home");

  if (loading) {
    return (
      <div style={pageStyle}>
        <header style={headerStyle}>
          {backHref && (
            <Link href={backHref} style={backLinkStyle}>
              {resolvedBackLabel}
            </Link>
          )}
          <h1 style={titleStyle}>{title}</h1>
        </header>
        <div style={skeletonContainerStyle}>
          <div className="skeleton-shimmer" style={skeletonStyle} />
          <div className="skeleton-shimmer" style={{ ...skeletonStyle, width: "70%" }} />
          <div className="skeleton-shimmer" style={{ ...skeletonStyle, width: "85%" }} />
          <div className="skeleton-shimmer" style={{ ...skeletonStyle, width: "60%" }} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={pageStyle}>
        <header style={headerStyle}>
          {backHref && (
            <Link href={backHref} style={backLinkStyle}>
              {resolvedBackLabel}
            </Link>
          )}
          <h1 style={titleStyle}>{title}</h1>
        </header>
        <div style={stateContainerStyle}>
          <div style={errorIconStyle}>!</div>
          <p style={errorTextStyle}>{error}</p>
          {onRetry && (
            <button onClick={onRetry} style={retryBtnStyle}>
              {t("common.retry")}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (empty) {
    return (
      <div style={pageStyle}>
        <header style={headerStyle}>
          {backHref && (
            <Link href={backHref} style={backLinkStyle}>
              {resolvedBackLabel}
            </Link>
          )}
          <h1 style={titleStyle}>{title}</h1>
          {actions && <div style={actionsStyle}>{actions}</div>}
        </header>
        <div style={stateContainerStyle}>
          <p style={emptyTextStyle}>{empty}</p>
          {emptyHint && <p style={emptyHintStyle}>{emptyHint}</p>}
        </div>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        {backHref && (
          <Link href={backHref} style={backLinkStyle}>
            {resolvedBackLabel}
          </Link>
        )}
        <h1 style={titleStyle}>{title}</h1>
        {actions && <div style={actionsStyle}>{actions}</div>}
      </header>
      <main>{children}</main>
    </div>
  );
}

/* ─── Inline styles (all referencing CSS variables via styles.ts tokens) ─── */

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "var(--bg-void)",
  color: "var(--text-primary)",
  fontFamily: "var(--font-body)",
  padding: "var(--space-5)",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-3)",
  marginBottom: "var(--space-5)",
  flexWrap: "wrap",
};

const backLinkStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  color: "var(--text-secondary)",
  fontSize: 12,
  textDecoration: "none",
  transition: "color 0.2s",
};

const titleStyle: React.CSSProperties = {
  fontFamily: "var(--font-display)",
  fontSize: 16,
  fontWeight: 600,
  letterSpacing: "0.5px",
  color: "var(--text-primary)",
  margin: 0,
};

const actionsStyle: React.CSSProperties = {
  marginLeft: "auto",
  display: "flex",
  gap: "var(--space-2)",
};

const stateContainerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  padding: "var(--space-7) var(--space-5)",
  textAlign: "center",
};

const skeletonContainerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-3)",
  padding: "var(--space-5) 0",
};

const skeletonStyle: React.CSSProperties = {
  height: 16,
  width: "100%",
};

const errorIconStyle: React.CSSProperties = {
  width: 48,
  height: 48,
  borderRadius: "50%",
  background: "var(--red-muted)",
  color: "var(--red)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 24,
  fontWeight: 700,
  marginBottom: "var(--space-3)",
};

const errorTextStyle: React.CSSProperties = {
  color: "var(--text-secondary)",
  fontSize: 14,
  marginBottom: "var(--space-4)",
  maxWidth: 400,
};

const retryBtnStyle: React.CSSProperties = {
  padding: "8px 20px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border-bright)",
  background: "var(--bg-card)",
  color: "var(--cyan)",
  fontFamily: "var(--font-body)",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
  transition: "all 0.2s",
};

const emptyTextStyle: React.CSSProperties = {
  color: "var(--text-secondary)",
  fontSize: 14,
  marginBottom: "var(--space-2)",
};

const emptyHintStyle: React.CSSProperties = {
  color: "var(--text-dim)",
  fontSize: 12,
  fontFamily: "var(--font-mono)",
};
