# Rendly Design System (2026, monochrome / Linear-grade)

Source of truth: `styles/rendly-theme.css` (CSS variables + `.rd-*` components). Tailwind mirrors it in `tailwind.config.ts`.

## Principles
- Black canvas, white ink. Depth comes from grey elevation steps and 1px white-alpha hairlines, never from glow.
- Colour is an accent, not a theme: `--rd-spectrum` gradient for one hero phrase or a highlighted metric; status hues (success/danger/warning/info) for state. No purple, cyan or blue brand fills anywhere.
- Dense, calm, precise. 13px UI text, 6-12px radii, 32px controls, 52px top bar.
- Motion: transform + opacity only, `--rd-ease` (expo-out), 140-240ms for UI, 400-700ms for reveals. Respect `prefers-reduced-motion`.

## Tokens
| Role | Var | Value |
|---|---|---|
| Canvas | `--rd-bg` | #08090a |
| Sidebar | `--rd-bg-2` | #0b0c0d |
| Panel / card | `--rd-panel` | #0f1011 |
| Surface | `--rd-surface-solid` | #141516 |
| Raised / hover | `--rd-raised` / `--rd-hover` | #1a1b1d / #202124 |
| Alpha surfaces | `--rd-surface`, `-2`, `-3` | white 2.5% / 5% / 8% |
| Borders | `--rd-border-faint` / `--rd-border` / `-strong` / `-bright` | white 5 / 8 / 12 / 20% |
| Text | `--rd-text` / `-2` / `--rd-muted` / `--rd-faint` | #f7f8f8 / #d0d6e0 / #8a8f98 / #62666d |
| Primary action | `--rd-primary` on `--rd-on-primary` | #f7f8f8 on #08090a |
| Accent gradient | `--rd-spectrum` | #8ea2ff → #b78bff → #f08bd0 → #ffb38a |
| Status | success / danger / warning / info | #4cc38a / #eb5757 / #f2c94c / #5e9eff |
| Radii | xs/sm/md/lg/xl | 6 / 8 / 12 / 16 / 20 |

## Components (`.rd-*`)
Buttons: `.rd-btn` (secondary), `--primary` (white), `--ghost`, `--danger`, sizes `--sm`/`--lg`, `--block`. Icon button `.rd-icon-btn`.
Inputs: `.rd-input`, `.rd-textarea`, `.rd-select`, `.rd-label`. Chips `.rd-chip(--on)`, badges `.rd-badge(--live|--success)`, `.rd-kbd`, `.rd-dot`.
Surfaces: `.rd-card(--pad|--interactive|--glow)`, `.rd-modal`, `.rd-toast`, `.rd-notif-panel`. Text: `.rd-h1`, `.rd-h2`, `.rd-eyebrow`, `.rd-muted`, `.rd-mono`, `.rd-gradient-text` (white sheen), `.rd-spectrum-text`.
Brand: `components/brand/Brand.tsx` (`RendlyMark`, `RendlyWordmark`, `RendlyLockup`, `AnoryxSignature`).

## Typography
Inter (`--font-sans`). Display: weight 600, tracking -0.03em to -0.04em, line-height 1.05. UI: 13-14px, weight 500. Metadata: `--font-mono` 11-12px.

## Breakpoints
380 / 640 / 768 / 1024 / 1280 / 1536 / 1920. App rail collapses to icons under 1200px, becomes a bottom tab bar under 768px.
