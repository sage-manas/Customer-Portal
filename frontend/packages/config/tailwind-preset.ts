import type { Config } from "tailwindcss";

/**
 * Shared Tailwind preset. Maps Tailwind theme keys to the CSS custom
 * properties defined in packages/ui/src/tokens.css (see docs/DECISIONS.md
 * ADR on the tokens/preset split: this file only knows the CSS variable
 * *names* (the contract); packages/ui owns the *values* so tenants can
 * override --color-primary etc. without touching Tailwind config.
 *
 * Consuming apps: `presets: [require("@cc/config/tailwind/preset")]`.
 */
const preset: Omit<Config, "content"> = {
  darkMode: ["class"],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "var(--color-primary)",
          dark: "var(--color-primary-dark)",
          subtle: "var(--color-primary-subtle)",
        },
        nav: "var(--color-nav)",
        success: {
          DEFAULT: "var(--color-success)",
          subtle: "var(--color-success-subtle)",
          border: "var(--color-success-border)",
        },
        warning: {
          DEFAULT: "var(--color-warning)",
          subtle: "var(--color-warning-subtle)",
          border: "var(--color-warning-border)",
        },
        danger: {
          DEFAULT: "var(--color-danger)",
          subtle: "var(--color-danger-subtle)",
          border: "var(--color-danger-border)",
        },
        info: {
          DEFAULT: "var(--color-info)",
          subtle: "var(--color-info-subtle)",
          border: "var(--color-info-border)",
        },
        teal: "var(--color-teal)",
        surface: "var(--color-surface)",
        background: "var(--color-background)",
        border: {
          DEFAULT: "var(--color-border)",
          strong: "var(--color-border-strong)",
        },
        text: {
          DEFAULT: "var(--color-text)",
          mid: "var(--color-text-mid)",
          dim: "var(--color-text-dim)",
        },
        accent: {
          onboard: "var(--color-accent-onboard)",
          catalog: "var(--color-accent-catalog)",
          inquiry: "var(--color-accent-inquiry)",
          order: "var(--color-accent-order)",
          delivery: "var(--color-accent-delivery)",
          invoice: "var(--color-accent-invoice)",
          payment: "var(--color-accent-payment)",
          support: "var(--color-accent-support)",
          loyalty: "var(--color-accent-loyalty)",
          report: "var(--color-accent-report)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      borderRadius: {
        sm: "6px",
        md: "10px",
        lg: "14px",
        pill: "9999px",
      },
      boxShadow: {
        sm: "0 1px 4px rgba(0,0,0,.06)",
        md: "0 2px 8px rgba(0,0,0,.07)",
        lg: "0 4px 20px rgba(30,27,58,.3)",
      },
      transitionDuration: {
        micro: "150ms",
        layer: "250ms",
      },
      transitionTimingFunction: {
        portal: "cubic-bezier(0.2, 0, 0, 1)",
      },
    },
  },
};

export default preset;
