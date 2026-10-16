import type { Config } from "tailwindcss";

/**
 * Colours are CSS variables holding raw RGB channels, so Tailwind's opacity modifiers
 * (bg-accent/10, border-line/60) keep working while the whole palette swaps with the theme.
 * The palette itself is Material 3, matching the Stitch design reference.
 */
const c = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: c("bg"), panel: c("panel"), raised: c("raised"), sunken: c("sunken"), high: c("high"),
        line: c("line"), ink: c("ink"), muted: c("muted"),

        accent: c("accent"), "accent-ink": c("accent-ink"),
        "accent-container": c("accent-container"), "on-accent-container": c("on-accent-container"),
        "accent-soft": c("accent-soft"),

        info: c("info"), "info-container": c("info-container"),
        "on-info-container": c("on-info-container"),
        neutral: c("neutral"), "neutral-container": c("neutral-container"),

        ok: c("ok"), "ok-container": c("ok-container"),
        warn: c("warn"), "warn-container": c("warn-container"),
        bad: c("bad"), "bad-container": c("bad-container"),

        sidebar: c("sidebar"), "sidebar-ink": c("sidebar-ink"),
        "sidebar-muted": c("sidebar-muted"), "sidebar-active": c("sidebar-active"),
        "sidebar-active-ink": c("sidebar-active-ink"),
      },
      fontFamily: {
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgb(var(--shadow) / 0.05), 0 1px 8px rgb(var(--shadow) / 0.04)",
        pop: "0 4px 16px rgb(var(--shadow) / 0.12), 0 2px 6px rgb(var(--shadow) / 0.06)",
      },
      borderRadius: { xl: "0.75rem", lg: "0.5rem", DEFAULT: "0.375rem" },
      spacing: { sidebar: "16rem", header: "3.5rem", banner: "1.75rem" },
    },
  },
} satisfies Config;
