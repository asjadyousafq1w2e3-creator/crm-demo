"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icon";

/** Keep the original forms visible while preventing live actions in this public display. */
export function ReadonlyNotice() {
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const notify = (event: Event) => {
      event.preventDefault(); event.stopImmediatePropagation(); setVisible(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setVisible(false), 5000);
    };
    const submit = (event: Event) => {
      const form = event.target as HTMLFormElement;
      const action = form.getAttribute("action") || "";
      if (action.includes("/api/auth/logout")) return;
      if (form.method.toLowerCase() === "post" || form.querySelector('input[name^="$ACTION_"]')) notify(event);
    };
    const click = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      if (anchor) {
        const path = new URL(anchor.href, location.href).pathname;
        if (path.startsWith("/api/") && !["/api/deliverable", "/api/registry/export"].includes(path)) notify(event);
        return;
      }
      const button = target.closest<HTMLButtonElement>("button");
      if (!button || button.closest('[role="radiogroup"]') || button.closest('form[action="/api/auth/logout"]')) return;
      const label = `${button.textContent || ""} ${button.title || ""}`.trim();
      if (/^(save|send|start|pause|resume|cancel|delete|remove|create|connect|disconnect|suppress|mark done|assign|push back|complete|upload|simulate|add step)\b/i.test(label)) notify(event);
    };
    document.addEventListener("submit", submit, true);
    document.addEventListener("click", click, true);
    return () => { document.removeEventListener("submit", submit, true); document.removeEventListener("click", click, true); if (timer.current) clearTimeout(timer.current); };
  }, []);
  return visible ? <div role="status" className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] max-w-[calc(100vw-2rem)] w-max rounded-xl border border-accent/30 bg-panel shadow-pop px-5 py-4 flex items-center gap-3 text-ink text-[13px]">
    <Icon name="visibility" size={22}/><span>Demo only. Changes aren’t saved.</span><button type="button" aria-label="Dismiss demo notice" onClick={() => setVisible(false)} className="text-muted p-1"><Icon name="close" size={17}/></button>
  </div> : null;
}
