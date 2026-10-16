import type { ReactNode } from "react";

export function Brand({ compact = false }: { compact?: boolean }) {
  return <span className={`pf-brand ${compact ? "pf-brand-compact" : ""}`}>
    <span className="pf-brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="M12 3h8v9h9v8h-9v9h-8v-9H3v-8h9V3Z" fill="currentColor"/><path d="m11 16 3.5 3.5L22 12" stroke="var(--brand-check, #d8f3a3)" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
    <span>express<span className="pf-brand-first">diabetics</span></span>
  </span>;
}

export function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{diagonal ? <path d="M6 18 18 6M6 6h12v12"/> : <path d="M4 12h15m-6-6 6 6-6 6"/>}</svg>;
}

export function Check({ children }: { children: ReactNode }) {
  return <span className="pf-check"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m5 12 4 4L19 6"/></svg>{children}</span>;
}
