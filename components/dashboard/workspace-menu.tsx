"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function WorkspaceMenu() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const workspace = document.querySelector(".crm-demo-compact");
    if (!workspace) return;
    workspace.setAttribute("data-menu-open", String(open));
    const sidebar = workspace.querySelector<HTMLElement>(".crm-sidebar");
    const media = window.matchMedia("(min-width: 768px)");
    const sync = () => {
      if (sidebar) {
        const hidden = !media.matches && !open;
        sidebar.inert = hidden;
        if (hidden) sidebar.setAttribute("aria-hidden", "true");
        else sidebar.removeAttribute("aria-hidden");
      }
      if (media.matches && open) setOpen(false);
    };
    sync(); media.addEventListener("change", sync);
    const cleanVisibility = () => { media.removeEventListener("change", sync); if (sidebar) { sidebar.inert = false; sidebar.removeAttribute("aria-hidden"); } };
    if (!open) return cleanVisibility;
    const previous = document.body.style.overflow;
    const opener = trigger.current;
    document.body.style.overflow = "hidden";
    const close = () => setOpen(false);
    sidebar?.setAttribute("role", "dialog"); sidebar?.setAttribute("aria-modal", "true");
    sidebar?.querySelector<HTMLButtonElement>(".crm-sidebar-close")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (event.key === "Tab" && sidebar) {
        const items = [...sidebar.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled])')];
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    const onLink = (event: MouseEvent) => {
      if ((event.target as Element).closest("a")) close();
    };
    sidebar?.addEventListener("click", onLink as EventListener);
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      workspace.setAttribute("data-menu-open", "false");
      sidebar?.removeEventListener("click", onLink as EventListener);
      document.removeEventListener("keydown", onKey);
      sidebar?.removeAttribute("role"); sidebar?.removeAttribute("aria-modal");
      cleanVisibility(); opener?.focus();
    };
  }, [open]);
  return <>
    <button ref={trigger} type="button" className="crm-menu-button" aria-label={open ? "Close navigation" : "Open navigation"} aria-expanded={open} aria-controls="crm-sidebar" onClick={() => setOpen(value => !value)}>
      <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden><path d="M3 5h14M3 10h14M3 15h14" /></svg>
    </button>
    {open && createPortal(<button type="button" className="crm-menu-backdrop" aria-label="Close navigation" onClick={() => setOpen(false)} />, document.body)}
    {open && createPortal(<button type="button" className="crm-sidebar-close" aria-label="Close navigation" onClick={() => setOpen(false)}><svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden><path d="m5 5 10 10M15 5 5 15" /></svg></button>, document.getElementById("crm-sidebar")!)}
  </>;
}
