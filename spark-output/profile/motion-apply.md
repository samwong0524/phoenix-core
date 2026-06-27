# React Bits — Project Profile
_Auto-maintained by motion-apply skill. Edit manually to override._

## Stack
- Variant: TS-TW
- Animation engine: framer-motion ^11.2.10 (already installed)
- React version: 19.2.4
- Framework: Next.js 16.1.6
- TypeScript: 5.9.3
- Tailwind: v4.1.18
- Path aliases: `@/lib/*` → `src/lib/*`

## Scene
- Detected: DASHBOARD
- Intensity ceiling: subtle/functional only
- Source: motion-plan-link (Corporate personality, user-confirmed)
- Override: user can say "这个页面是 landing page" to unlock high-impact components for that specific task

## Tonality (from motion-plan)
- Personality: Corporate (user-confirmed)
- Style: clean, professional, business, dashboard
- Signature easing: cubic-bezier(0.2, 0, 0, 1) — Material Design 3
- Duration palette: quick=200ms, standard=300ms, slow=400ms
- Overshoot: 0-3%
- Color: dark theme, cyan accent (#00f0ff), monospace + Orbitron fonts
- Font: Orbitron (display), Exo 2 (body), JetBrains Mono (mono)

## History
- 2026-06-28: Created motion system — CSS button press + card stagger + framer-motion message entrance
  → No ReactBits components installed (framer-motion already sufficient for current needs)
  → Shared variants module at src/lib/motion.ts with 10 variants
  → Graph page uses Canvas (TopoAnimCanvas.tsx) — framer-motion cannot target canvas elements
  → Settings/Onboarding pages not yet created — variants pre-defined for future use

## Preferences (derived)
- Lean: framer-motion for complex animations, CSS for simple transitions
- Avoid: installing ReactBits components unless they provide functionality framer-motion can't (e.g., canvas-based effects, particle systems)
- Dashboard-first: all animations must pass DASHBOARD scene compliance

## Tailwind Version Notes
- Project uses Tailwind v4 with `@config` directive pointing to tailwind.config.js
- CSS uses `@import "tailwindcss"` (v4 syntax)
- shadcn init would write v4 syntax — compatible with this project

## Known Issues
- `app/api/observability/dashboard/route.ts` has pre-existing TS error (db import) — unrelated to motion system
- Graph topology visualization uses Canvas 2D API — cannot use DOM-based animation libraries for node/edge rendering
