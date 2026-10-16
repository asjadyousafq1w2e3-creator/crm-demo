"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "./icon";

/**
 * Global search. Submits to the pharmacy list, which already does all its filtering in SQL -
 * this is a shortcut into that page, not a second search implementation.
 */
export function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (q.trim()) router.push(`/pharmacies?q=${encodeURIComponent(q.trim())}`); }}
      className="flex items-center gap-2 bg-raised border border-line rounded-lg px-3 py-1.5
                 w-full max-w-sm focus-within:border-accent focus-within:ring-2
                 focus-within:ring-accent/20 transition-all">
      <Icon name="search" size={18} className="text-muted" />
      <input value={q} onChange={(e) => setQ(e.target.value)}
        aria-label="Search pharmacy records"
        placeholder="Search name, licence, NPI, email, city…"
        className="bg-transparent border-none outline-none t-body text-ink w-full
                   placeholder:text-muted/80" />
    </form>
  );
}
