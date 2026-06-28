/**
 * Phoenix-Core — 共享 inline style 常量
 *
 * 给必须使用 inline style 的场景（如 framer-motion 组件、动态计算样式）
 * 所有值引用 globals.css 的 CSS 变量，确保主题一致性
 */

export const colors = {
  void: "var(--bg-void)",
  panel: "var(--bg-panel)",
  card: "var(--bg-card)",
  hover: "var(--bg-hover)",

  text: "var(--text-primary)",
  textSecondary: "var(--text-secondary)",
  textDim: "var(--text-dim)",

  cyan: "var(--cyan)",
  cyanDim: "var(--cyan-dim)",
  cyanGlow: "var(--cyan-glow)",
  magenta: "var(--magenta)",
  purple: "var(--purple)",
  green: "var(--green)",
  yellow: "var(--yellow)",
  red: "var(--red)",

  success: "var(--color-success)",
  warning: "var(--color-warning)",
  error: "var(--color-error)",
  info: "var(--color-info)",

  border: "var(--border)",
  borderBright: "var(--border-bright)",
} as const;

export const spacing = {
  xs: "var(--space-1)",   // 4px
  sm: "var(--space-2)",   // 8px
  md: "var(--space-3)",   // 12px
  lg: "var(--space-4)",   // 16px
  xl: "var(--space-5)",   // 24px
  xxl: "var(--space-6)",  // 32px
  xxxl: "var(--space-7)", // 48px
} as const;

export const radii = {
  sm: "var(--radius-sm)",   // 6px
  md: "var(--radius-md)",   // 10px
  lg: "var(--radius-lg)",   // 14px
  full: "var(--radius-full)", // 999px
} as const;

export const fonts = {
  display: "var(--font-display)",
  body: "var(--font-body)",
  mono: "var(--font-mono)",
} as const;

/** 常用复合样式 */
export const styles = {
  page: {
    minHeight: "100vh",
    background: colors.void,
    color: colors.text,
    fontFamily: fonts.body,
    padding: spacing.xl,
  },
  container: {
    maxWidth: 1200,
    margin: "0 auto",
  },
  card: {
    background: colors.card,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.lg,
    padding: spacing.xl,
  },
  heading: {
    fontFamily: fonts.display,
    fontSize: 15,
    fontWeight: 600,
    letterSpacing: "0.5px",
    color: colors.text,
  },
  subtext: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  dimText: {
    fontSize: 11,
    color: colors.textDim,
    fontFamily: fonts.mono,
  },
} as const;
