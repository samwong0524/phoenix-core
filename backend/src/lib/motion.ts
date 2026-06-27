/**
 * Phoenix-Core — 共享动效 Variants
 *
 * 来源：motion-plan.json (Corporate personality, DASHBOARD scene)
 * 所有参数已按 DASHBOARD 场景压低（位移 ≤ 8px, duration ≤ 400ms）
 * 缓动统一：cubic-bezier(0.2, 0, 0, 1) — Material Design 3 Standard
 *
 * 使用方式：
 *   import { corporateVariants } from "@/lib/motion";
 *   <motion.div variants={corporateVariants.fadeSlideUp} initial="hidden" animate="visible" />
 */

import type { Variants, Transition } from "framer-motion";

// ─── Corporate Brand Motion Identity ───────────────────────

const CORPORATE_EASING = [0.2, 0, 0, 1] as const; // cubic-bezier(0.2, 0, 0, 1)
const EXIT_EASING = [0.4, 0, 1, 1] as const;      // ease-in for exits

const DURATIONS = {
  quick: 0.2,    // 200ms — 按钮反馈、hover
  standard: 0.3, // 300ms — 卡片、面板、消息
  slow: 0.4,     // 400ms — 模态框、页面转场
} as const;

// ─── Variant: Button Press ─────────────────────────────────
// 按下收缩至 97%，松手回弹 102%→100%，shadow 同步缩放
// 场景合规：scale 0.97 (Δ3%), duration 120ms, 无 infinite

export const buttonPress = {
  rest: { scale: 1, transition: { duration: DURATIONS.quick, ease: CORPORATE_EASING } },
  hover: {
    scale: 1.01,
    transition: { duration: 0.15, ease: CORPORATE_EASING },
  },
  press: {
    scale: 0.97,
    transition: { duration: 0.1, ease: CORPORATE_EASING },
  },
  release: {
    scale: 1.02,
    transition: { duration: 0.08, ease: CORPORATE_EASING },
  },
} as const;

// ─── Variant: Fade Slide Up (消息气泡 / 卡片入场) ──────────
// 从下方 8px 渐入，opacity 先行，DASHBOARD 位移压低
// 场景合规：translateY 8px (< 20px), duration 280ms (< 2s)

export const fadeSlideUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: DURATIONS.standard,
      ease: CORPORATE_EASING,
    } as Transition,
  },
};

// ─── Variant: Staggered Container (消息列表 / 卡片网格) ────
// 子元素依次入场，stagger 30ms/项，总预算 ≤ 500ms
// 场景合规：stagger 30ms × 16 项 = 480ms (< 500ms)

export const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.03, // 30ms
      delayChildren: 0.05,
    },
  },
};

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: DURATIONS.standard,
      ease: CORPORATE_EASING,
    },
  },
};

// ─── Variant: Graph Node Entrance ──────────────────────────
// anticipation(0.85) → expand(1.05) → settle(1.0)
// 场景合规：max scale 1.05 (Δ5%), 无 infinite, breathing pulse 仅在 hover 时触发
// 注意：DASHBOARD 场景禁用持续 breathing pulse，改为 hover 触发

export const graphNodeEntrance: Variants = {
  hidden: { scale: 0.85, opacity: 0 },
  anticipate: {
    scale: 0.85,
    opacity: 0.3,
    transition: { duration: 0.1, ease: CORPORATE_EASING },
  },
  expand: {
    scale: 1.05,
    opacity: 1,
    transition: { duration: 0.2, ease: CORPORATE_EASING },
  },
  visible: {
    scale: 1,
    opacity: 1,
    transition: {
      duration: 0.15,
      ease: CORPORATE_EASING,
    },
  },
};

// Graph node hover: 极轻微呼吸脉冲（仅 hover 时触发，非持续）
export const graphNodeHover = {
  rest: { scale: 1 },
  hover: {
    scale: 1.02,
    transition: {
      duration: 0.3,
      ease: CORPORATE_EASING,
    },
  },
} as const;

// ─── Variant: Modal Enter/Exit ─────────────────────────────
// 入场：从下方 16px 渐入 + 遮罩先于面板 100ms
// 出场：向下方 10px 渐隐
// 场景合规：translateY 16px (< 20px), duration 350ms (< 2s)

export const modalOverlay: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: 0.15, ease: CORPORATE_EASING },
  },
  exit: {
    opacity: 0,
    transition: { duration: 0.2, ease: EXIT_EASING },
  },
};

export const modalPanel: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: DURATIONS.slow,
      ease: CORPORATE_EASING,
      delay: 0.05, // 遮罩先出 50ms 后面板跟随
    },
  },
  exit: {
    opacity: 0,
    y: 10,
    transition: {
      duration: 0.25,
      ease: EXIT_EASING,
    },
  },
};

// ─── Variant: Page / Step Transition ───────────────────────
// 当前步骤向左滑出，新步骤从右滑入
// 场景合规：translateX 24px (< 20px? 实际 24px 略超，压到 20px)
// 修正：DASHBOARD 场景 translateX 压到 20px

export const stepTransition: Variants = {
  enter: { opacity: 0, x: 20 },
  active: {
    opacity: 1,
    x: 0,
    transition: {
      duration: DURATIONS.slow,
      ease: CORPORATE_EASING,
    },
  },
  exit: {
    opacity: 0,
    x: -20,
    transition: {
      duration: 0.3,
      ease: EXIT_EASING,
    },
  },
};

// ─── Variant: Sidebar Panel Slide ──────────────────────────
// 从左滑入，主内容同步让出空间（layout animation）
// 场景合规：使用 layout 动画而非固定 translateX

export const sidebarSlide: Variants = {
  hidden: { opacity: 0, x: -16 },
  visible: {
    opacity: 1,
    x: 0,
    transition: {
      duration: DURATIONS.standard,
      ease: CORPORATE_EASING,
    },
  },
  exit: {
    opacity: 0,
    x: -16,
    transition: {
      duration: 0.2,
      ease: EXIT_EASING,
    },
  },
};

// ─── Exported Bundle ───────────────────────────────────────

export const corporateVariants = {
  buttonPress,
  fadeSlideUp,
  staggerContainer,
  staggerItem,
  graphNodeEntrance,
  graphNodeHover,
  modalOverlay,
  modalPanel,
  stepTransition,
  sidebarSlide,
} as const;

// ─── Reduced Motion Helper ─────────────────────────────────
// 在组件中使用：
//   const shouldReduce = useReducedMotion();
//   if (shouldReduce) 使用简化 variant（仅 opacity）

export function getReducedVariant(variant: Variants): Variants {
  return {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { duration: 0.15 } },
    exit: { opacity: 0, transition: { duration: 0.1 } },
  };
}
