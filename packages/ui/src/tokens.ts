/**
 * Design tokens — single source of truth (docs/05-UI-UX-DESIGN.md §2.1).
 * `src/tokens.css` mirrors these as CSS custom properties (consumed by the
 * Tailwind preset in @cc/config, which only knows the variable *names* —
 * see docs/DECISIONS.md). `tokens.test.ts` asserts the two stay in sync,
 * since there is no build-time codegen step in Phase 0.
 */

export const colorTokens = {
  primary: "#5b21b6",
  primaryDark: "#4c1d95",
  primarySubtle: "#f5f3ff",
  nav: "#1e1b3a",
  success: "#15803d",
  successSubtle: "#f0fdf4",
  successBorder: "#bbf7d0",
  warning: "#b45309",
  warningSubtle: "#fffbeb",
  warningBorder: "#fde68a",
  danger: "#be123c",
  dangerSubtle: "#fef2f2",
  dangerBorder: "#fecdd3",
  info: "#1d4ed8",
  infoSubtle: "#eff6ff",
  infoBorder: "#bfdbfe",
  teal: "#0e7490",
  surface: "#ffffff",
  background: "#f5f6fb",
  border: "#e2e8f0",
  borderStrong: "#cbd5e1",
  text: "#0f172a",
  textMid: "#334155",
  textDim: "#64748b",
} as const;

/** Fixed module accent colors (docs/05 §2.1) — not tenant-overridable. */
export const moduleAccentTokens = {
  onboard: "#5b21b6",
  catalog: "#1d4ed8",
  inquiry: "#0e7490",
  order: "#15803d",
  delivery: "#0891b2",
  invoice: "#b45309",
  payment: "#be123c",
  support: "#be185d",
  loyalty: "#9333ea",
  report: "#ea580c",
} as const;

export const typographyTokens = {
  fontSans: "Inter, ui-sans-serif, system-ui, sans-serif",
  fontMono: '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace',
} as const;

export type ColorTokenKey = keyof typeof colorTokens;
export type ModuleAccentKey = keyof typeof moduleAccentTokens;

/** camelCase -> kebab-case, e.g. "primaryDark" -> "primary-dark". */
export function camelToKebab(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

export function colorCssVar(key: ColorTokenKey): string {
  return `--color-${camelToKebab(key)}`;
}

export function accentCssVar(key: ModuleAccentKey): string {
  return `--color-accent-${camelToKebab(key)}`;
}
