"use client";
import { useState } from "react";

type Mode = "system" | "light" | "dark";

/**
 * Theme switch. Writes a cookie and flips data-theme on the spot - the server reads the same
 * cookie when it renders, so a reload paints the chosen theme immediately with no flash.
 * "System" clears the attribute and lets prefers-color-scheme decide.
 */
export function ThemeToggle({ initial }: { initial: Mode }) {
  const [mode, setMode] = useState<Mode>(initial);

  function apply(next: Mode) {
    setMode(next);
    const root = document.documentElement;
    if (next === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", next);
    document.cookie = `theme=${next}; path=/; max-age=31536000; samesite=lax`;
  }

  const OPTIONS: { value: Mode; label: string; icon: React.ReactNode }[] = [
    { value: "light", label: "Light", icon: <SunIcon /> },
    { value: "system", label: "System", icon: <AutoIcon /> },
    { value: "dark", label: "Dark", icon: <MoonIcon /> },
  ];

  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-white/[0.06] p-0.5 w-fit"
      role="radiogroup" aria-label="Colour theme">
      {OPTIONS.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={mode === o.value}
          title={`${o.label} theme`} onClick={() => apply(o.value)}
          className={`flex items-center justify-center w-8 h-6 rounded-md transition-colors ${
            mode === o.value
              ? "bg-accent text-accent-ink"
              : "text-sidebar-muted hover:text-sidebar-ink"}`}>
          {o.icon}
          <span className="sr-only">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

const svg = { width: 13, height: 13, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
              strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

function SunIcon() {
  return (
    <svg {...svg}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}
function MoonIcon() {
  return <svg {...svg}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>;
}
function AutoIcon() {
  return (
    <svg {...svg}>
      <rect x="2" y="4" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 18v3" />
    </svg>
  );
}
