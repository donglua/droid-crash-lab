# DroidCrashLab Design System

## 1. Direction

DroidCrashLab is a dense local operations console: calm graphite navigation, bright work surfaces, strong status color, and monospace evidence areas. The memorable moment is the live run rail—device, state, metrics, issues, and raw logs remain readable at a glance without decorative dashboard noise.

## 2. Users and constraints

- Primary user: Android developer or QA operator running time-sensitive device checks.
- Context: desktop-first local tool, but all primary actions remain usable at 375 px.
- Accessibility: keyboard-visible focus, semantic controls, no color-only status, 44 px touch targets, reduced-motion safe.
- Content: Chinese operational copy with English identifiers and log text; use natural wrapping and preserve monospace logs.

## 3. Tokens

- Color: canvas `#f4f6f8`, surface `#ffffff`, raised `#f8fafb`, ink `#18212b`, muted `#66717d`, border `#dce2e7`, navy `#172334`, blue `#1769aa`, green `#138a5b`, amber `#b86a10`, red `#c33d3d`, log `#101820`.
- Typography: system sans for interface; `ui-monospace` stack for IDs and logs. Scale: 12, 13, 14, 16, 20, 28 px.
- Spacing: 4 px base; named steps 4, 8, 12, 16, 20, 24, 32 px.
- Radius: 4 px controls, 6 px panels, 8 px maximum.
- Depth: borders plus one restrained panel shadow; no gradients, glow, glass, or decorative blobs.
- Motion: 140 ms opacity/background/border transitions only for actionable controls. No entrance animation.

## 4. Layout

- Desktop: 232 px fixed navigation rail, flexible main region, 28 px content gutter.
- Tablet: compact rail and two-column content where space allows.
- Mobile: top app bar, horizontal section navigation, one-column panels, no horizontal page overflow.
- Main shell owns viewport scrolling; log console owns its internal scroll.

## 5. Primitives and states

- `AppShell`: top status bar, navigation rail, main content. States: connected, disconnected, connecting.
- `Panel`: bordered surface with optional heading/actions. States: default, emphasized, error.
- `StatusBadge`: neutral, success, warning, danger.
- `Button`: primary, secondary, danger, ghost; disabled and focus-visible states.
- `Field`: label, help/error text, input/select/file control; disabled and invalid states.
- `Metric`: fixed-height label/value block; neutral/success/warning/danger values.
- `SegmentedControl`: manual/Monkey choice; selected and keyboard-focus states.
- `EmptyState`: unframed concise guidance, never promotional.
- `LogViewport`: dark monospace evidence surface with filters and paused state.

## 6. Component rules

- Panels are siblings, never nested cards.
- Icons come from Lucide and always have a text label or accessible name.
- Status text accompanies every color indicator.
- Tables collapse to labeled rows on narrow screens.
- Buttons describe actions: 「检查 APK」「覆盖安装」「启动应用」「开始测试」「停止测试」.

## 7. Responsive and accessibility checks

- Required viewports: 375x812, 768x1024, 1280x800.
- No clipped Chinese text, orphan single characters, overlapping controls, or page-level horizontal scroll.
- Tab order follows visual order; all file, numeric, segmented, and action controls are keyboard operable.
- `prefers-reduced-motion` disables transitions.

## 8. Accepted debt

- V1 uses system fonts and does not bundle a custom CJK font.
- No charts or screenshots; metrics remain textual and compact by product scope.
