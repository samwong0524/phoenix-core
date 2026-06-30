# Phoenix-Core Mobile Flow Design

> Mobile page flow specification for the Phoenix-Core multi-agent swarm IDE.
> Generated: 2026-06-30 | Skill: flow-mobile | Project: Phoenix-Core

---

## 1. Architecture Overview

### Two-Layer Responsive Approach

Phoenix-Core uses a two-layer responsive strategy to handle mobile viewports without a separate mobile app or codebase fork. The layers operate independently and compose together:

```
+--------------------------------------------------+
|  Layer 1: app-layout.tsx (Global Navigation)     |
|  - Hamburger toggle at z-1001                    |
|  - 220px slide-out drawer (framer-motion)        |
|  - Auto-close on route change                    |
|  - Hidden at >= 768px (desktop sidebar visible)   |
+--------------------------------------------------+
          |
          v
+--------------------------------------------------+
|  Layer 2: IMShell.tsx (IM-Specific Layout)       |
|  - 3-panel -> single-column transformation       |
|  - Dual floating buttons (hamburger + toggle)    |
|  - 280px sidebar drawer at z-1003/1004           |
|  - BottomSheet for task monitor (70vh max)       |
|  - Only active on /im route                      |
+--------------------------------------------------+
```

**Design Rationale:** The global layer handles navigation chrome shared across all pages. The IM layer handles the complex 3-panel layout specific to the chat interface, which has richer mobile requirements than other pages. This separation keeps non-IM pages lightweight while giving the IM experience full control over its mobile transformation.

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 |
| UI Library | React 19 |
| Styling | CSS variables + inline styles (Tailwind v4) |
| Animation | framer-motion 11 |
| Icons | lucide-react |
| Media Queries | Custom hooks from `@/lib/use-media-query` |

---

## 2. Breakpoint Strategy

### CSS Breakpoints (globals.css)

| Breakpoint | Grid Template | Behavior |
|-----------|--------------|----------|
| >= 1280px | `240px 1fr 300px` | Full 3-column with generous panels |
| 769-1024px | `180px 1fr 240px` | Compact 3-column with narrower panels |
| <= 768px | `1fr` | Single column; overflow hidden; left/right panels hidden; global-nav hidden |
| <= 640px | `1fr` | Compact mode: reduced chat header, messages, input; font-size 13px |

### Media Query Hooks

```
useIsMobile()   -- max-width: 768px   -- Conditional mobile UI rendering
useIsTablet()   -- max-width: 1024px  -- Tablet-specific adjustments
useIsDesktop()  -- min-width: 1025px  -- Desktop feature gating
```

Source: `@/lib/use-media-query`

**Design Decision:** The 768px threshold aligns with iPad portrait width, treating tablet-portrait and phones as "mobile" while tablet-landscape and above retain the multi-column layout. This maximizes the usable viewport for the IM 3-panel experience.

---

## 3. Flow Diagrams

### Flow 1: Global Navigation Drawer

```
[Mobile Viewport]
       |
       v
  Page loads
       |
       v
  global-nav hidden (CSS @media)
  hamburger visible at top-left (z-1001)
       |
       v
  User taps hamburger
       |
       v
  +---------+-------------------+
  | Drawer  |    Backdrop       |
  | 220px   |    (z-1001)       |
  | x:-220  |                   |
  |  -> 0   |                   |
  | (z-1002)|                   |
  +---------+-------------------+
       |
       v
  User taps nav item
       |
       v
  usePathname() detects route change
       |
       v
  Drawer auto-closes
  Backdrop fades
```

**Animation Spec:**
- Library: framer-motion
- Property: `x`
- From: `-220px` -> To: `0px`
- Easing: `[0.2, 0, 0, 1]` (fast start, gentle deceleration)

### Flow 2: IM Mobile Layout (IMShell)

```
[Mobile Viewport < 768px]
       |
       v
  IMShell renders single column
  chat fills 100vw x remaining height
       |
       v
  +------------------------------+
  | [=] hamburger    [^] toggle  |  <- Floating buttons (z-1002)
  |                              |
  |                              |
  |      Full-width chat         |
  |                              |
  |                              |
  |                              |
  +------------------------------+
       |                    |
       v                    v
  Tap hamburger       Tap panel-toggle
       |                    |
       v                    v
  +---------+          +-----------+
  | Drawer  |          |BottomSheet|
  | 280px   |          | 70vh max  |
  | z-1003  |          | spring up |
  | sidebar |          | tasks     |
  +---------+          +-----------+
  backdrop              backdrop
  z-1004                + drag
```

**IM Drawer Spec:**
- Width: 280px (wider than global 220px to accommodate IM-specific nav items)
- Animation: framer-motion slide `x: -280 -> 0`, ease `[0.2, 0, 0, 1]`
- Z-index: drawer at 1003, backdrop at 1004

### Flow 3: BottomSheet Task Monitor

```
  Panel-toggle tapped
       |
       v
  Body scroll locks (overflow: hidden)
  Backdrop fades in
       |
       v
  BottomSheet springs up
  (damping: 30, stiffness: 300)
  maxHeight: 70vh
       |
       v
  +------------------------------+
  |         Backdrop             |
  |                              |
  | +--------------------------+ |
  | |     BottomSheet          | |
  | |     (70vh max)           | |
  | |                          | |
  | |   Task Monitor Content   | |
  | |                          | |
  | |     [drag handle]        | |
  | +--------------------------+ |
  +------------------------------+
       |
       v (dismiss triggers)
       |
  +----+----+--------+----------+
  |         |        |          |
  v         v        v          v
Drag>80px  Vel>500  Backdrop  Escape
            px/s     tap       key
  |         |        |          |
  +----+----+--------+----------+
       |
       v
  Sheet springs down
  Body scroll unlocks
```

**Dismiss Thresholds:**
- Distance: drag downward > 80px
- Velocity: drag downward > 500px/s (flick gesture)
- Either threshold triggers close independently

---

## 4. Component Inventory

### 4.1 BottomSheet

| Property | Value |
|----------|-------|
| Animation Type | Spring (framer-motion) |
| Damping | 30 |
| Stiffness | 300 |
| Max Height | 70vh |
| Drag to Dismiss | > 80px distance OR > 500px/s velocity |
| Opacity | Fades with drag progress |
| Body Scroll Lock | Yes (overflow: hidden on body) |
| Close on Escape | Yes |
| Close on Backdrop | Yes |

**Usage:** Right-panel content (task monitor) on mobile IM layout. Provides a native-feeling sheet interaction without requiring a dedicated mobile page.

### 4.2 Navigation Drawers

**Global Drawer (app-layout):**

| Property | Value |
|----------|-------|
| Width | 220px |
| Animation | framer-motion slide |
| Easing | `[0.2, 0, 0, 1]` |
| Hamburger Z | 1001 |
| Drawer Z | 1002 |
| Auto-close | On route change |

**IM Drawer (IMShell):**

| Property | Value |
|----------|-------|
| Width | 280px |
| Animation | framer-motion slide |
| Easing | `[0.2, 0, 0, 1]` |
| Drawer Z | 1003 |
| Backdrop Z | 1004 |
| Auto-close | On route change / backdrop tap |

### 4.3 Toast System

| Property | Value |
|----------|-------|
| API | `toast.success()` / `toast.error()` / `toast.warning()` / `toast.info()` |
| Pattern | Unified pub-sub |
| Container | `ToastContainer` mounted in root layout |
| Mobile Behavior | Identical to desktop; overlay positioning works at all viewports |

### 4.4 Floating Action Buttons

| Button | Position | Z-Index | Action | Context |
|--------|----------|---------|--------|---------|
| Hamburger | Top-left | 1002 | Opens sidebar drawer | IM mobile |
| Panel Toggle | Top-right | 1002 | Opens BottomSheet | IM mobile |

Both buttons are conditionally rendered only in IM mobile layout (< 768px).

---

## 5. Z-Index Layer Map

```
z-index    Layer                          Context
-------    -----                          -------
1001       Global hamburger button        Always on mobile
1001       Global backdrop                When drawer open
1002       Global drawer                  When drawer open
1002       IM floating buttons            IM mobile only
1003       IM sidebar drawer              When drawer open
1004       IM sidebar backdrop            When drawer open
----       BottomSheet + backdrop         When sheet open
----       ToastContainer                 Root layout (highest)
```

**Design Decision:** IM z-index values (1003/1004) are deliberately higher than global z-index values (1001/1002) to ensure the IM-specific drawer always renders above the global navigation drawer if both are somehow active simultaneously.

---

## 6. Page Coverage Matrix

### Fully Adapted (5 pages)

| Route | Page | Mobile Mechanism | Notes |
|-------|------|-----------------|-------|
| `/im` | IM Chat | IMShell 3-panel -> single-column + drawer + BottomSheet | Primary mobile experience |
| `/skills` | Skills | Single-column card grid | Natural CSS reflow |
| `/models` | Models | Form stacking | Natural CSS reflow |
| `/settings` | Settings | Form stacking | Natural CSS reflow |
| `/login` | Login | Centered form | Natural CSS reflow |

### Partially Adapted (1 page)

| Route | Page | Current State | Gap |
|-------|------|--------------|-----|
| `/observability` | Observability | Chart dashboard renders but charts need resize/layout adaptation | Charts may overflow or become unreadable on narrow viewports |

### Not Adapted (3 pages)

| Route | Page | Current State | Gap | Priority |
|-------|------|--------------|-----|----------|
| `/workflow` | Workflow Editor | DAG canvas editor requires min 780px | Unusable below 780px; no mobile layout | P0 (read-only mode planned) |
| `/pipeline` | Pipeline | No responsive work started | Unknown mobile viability | TBD |
| `/graph` | Graph | @xyflow interactive canvas | Touch interaction model not designed | TBD |

---

## 7. Gap Analysis

### P0: Workflow Editor Mobile Read-Only Mode

**Problem:** The workflow DAG editor (`@xyflow`) requires a minimum viewport of 780px for meaningful interaction. On mobile, the page is effectively unusable.

**Planned Solution:** Read-only mobile view that displays workflow status, node list, and execution history without the interactive canvas editor. Users can view but not edit workflows on mobile.

**Estimated Scope:**
- New mobile-only layout component for `/workflow`
- Workflow summary cards (name, status, last run, node count)
- Node list view (collapsed DAG representation)
- Execution history timeline
- "Edit on desktop" prompt/CTA

### P1: Observability Dashboard Adaptation

**Problem:** Chart-based dashboard renders at mobile widths but charts may become unreadable due to compressed sizing.

**Recommended Approach:**
- Stack charts vertically (single column) on mobile
- Increase chart height relative to width for readability
- Simplify chart legends (collapse to toggle)
- Consider swipeable chart carousel for dense dashboards

### P2: Graph Canvas Touch Adaptation

**Problem:** `@xyflow` interactive graph canvas uses mouse-centric interaction patterns (hover, right-click, drag-select) that don't translate to touch.

**Recommended Approach:**
- Pan/zoom via pinch gestures
- Tap-to-select instead of click
- Long-press context menu instead of right-click
- Consider simplified list view as fallback

### P3: Pipeline Mobile Layout

**Problem:** No responsive implementation exists. Pipeline visualization and controls may not work on mobile.

**Recommended Approach:**
- Assess pipeline UI complexity
- If DAG-based, follow workflow read-only pattern
- If list-based, apply natural form stacking

---

## 8. Design Decisions and Rationale

### Decision 1: Two-Layer Over Single-Layer Responsive

**Choice:** Separate global nav (app-layout) and IM-specific layout (IMShell) rather than a single responsive wrapper.

**Rationale:** The IM page has fundamentally different mobile requirements (dual floating controls, 3-panel transformation, BottomSheet) compared to other pages (simple drawer navigation). Combining them into one layer would create excessive conditional logic and coupling. The two-layer approach isolates complexity.

### Decision 2: BottomSheet Over Full-Page Navigation for Right Panel

**Choice:** Right panel content (task monitor) appears as a BottomSheet rather than navigating to a separate page.

**Rationale:** BottomSheet preserves the user's chat context underneath. Navigating away would lose scroll position and input state. The sheet pattern (common in iOS/Android native apps) provides quick access without context switching.

### Decision 3: Custom Easing `[0.2, 0, 0, 1]` for Drawers

**Choice:** Non-standard cubic-bezier with fast initial acceleration and gentle deceleration.

**Rationale:** This curve creates a "snappy" feel that matches user expectation for drawer interactions -- fast appearance (user wants to see nav items immediately) with a smooth settle (avoids jarring stop). Similar to iOS drawer/sheet animations.

### Decision 4: Spring Animation for BottomSheet

**Choice:** framer-motion spring (damping: 30, stiffness: 300) instead of easing curves.

**Rationale:** Spring physics provide natural-feeling motion that responds well to drag gestures. The relatively high damping (30) prevents excessive bounce while the stiffness (300) ensures quick response. This matches the tactile feel users expect from bottom sheets on mobile OS.

### Decision 5: Dual-Threshold Drag Dismiss

**Choice:** Close on either distance (> 80px) or velocity (> 500px/s).

**Rationale:** Distance threshold serves deliberate drags (user slowly pulls down). Velocity threshold serves quick flicks (user swipes down fast). Both patterns are common in native mobile UIs, and supporting both makes the interaction feel natural regardless of gesture style.

### Decision 6: Separate Z-Index Ranges for Global vs IM

**Choice:** Global nav uses z-1001/1002; IM uses z-1003/1004.

**Rationale:** Prevents z-index conflicts when IM-specific overlays need to render above global navigation elements. The intentional gap (1001-1002 vs 1003-1004) makes the layering hierarchy explicit and debuggable.

### Decision 7: 768px as Primary Mobile Breakpoint

**Choice:** 768px max-width defines the mobile threshold, matching iPad portrait width.

**Rationale:** Below 768px, the 3-column IM layout becomes unusable (columns compress below readable widths). At 768px and above, there is sufficient space for at least a compact multi-column layout. This threshold captures all phones and tablet-portrait as "mobile" while keeping tablet-landscape and desktop in the multi-column experience.

---

## 9. Upstream Context References

| Source | Content |
|--------|---------|
| `brief` | Design strategy: sidebar -> slide-out drawer, right panel -> bottom sheet, CSS Grid minmax + breakpoint strategy |
| `stories` | story-1 (mobile IM chat), story-2 (tablet sidebar drawer), story-3 (workflow mobile read-only) |
| `sitemap` | 10 pages, 8 primary nav items, multi-platform IA |

---

## 10. File References

| File | Description |
|------|-------------|
| `app-layout.tsx` | Global navigation layout with responsive drawer |
| `IMShell.tsx` | IM-specific 3-panel to single-column transformation |
| `BottomSheet` component | Spring-animated bottom sheet with drag-to-dismiss |
| `globals.css` | CSS breakpoints and responsive media queries |
| `@/lib/use-media-query` | `useIsMobile`, `useIsTablet`, `useIsDesktop` hooks |
| `F:\swarm-ide\spark-output\context\flow-mobile.json` | Structured context JSON for downstream skill consumption |
