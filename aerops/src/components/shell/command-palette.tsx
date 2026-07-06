"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, CornerDownLeft } from "lucide-react";
import { NAV_ITEMS } from "./nav-config";

/**
 * Minimal command palette: ⌘K / Ctrl+K to open, type to filter destinations,
 * arrow keys + Enter to navigate.
 */
export function CommandPalette({ allowedPaths }: { allowedPaths: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const items = useMemo(() => {
    const nav = NAV_ITEMS.filter((i) => allowedPaths.includes(i.href));
    if (!query) return nav;
    return nav.filter((i) => i.label.toLowerCase().includes(query.toLowerCase()));
  }, [query, allowedPaths]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setIndex(0);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        close();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[18vh] backdrop-blur-[2px]" onClick={close}>
      <div
        className="w-full max-w-lg animate-fade-up overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-4">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setIndex(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => Math.min(i + 1, items.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
              if (e.key === "Enter" && items[index]) { router.push(items[index].href); close(); }
            }}
            placeholder="Go to…"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">ESC</kbd>
        </div>
        <div className="max-h-72 overflow-y-auto p-1.5">
          {items.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">No results</p>}
          {items.map((item, i) => (
            <button
              key={item.href}
              onMouseEnter={() => setIndex(i)}
              onClick={() => { router.push(item.href); close(); }}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${i === index ? "bg-accent text-accent-foreground" : ""}`}
            >
              <item.icon className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1">{item.label}</span>
              {i === index && <CornerDownLeft className="h-3.5 w-3.5 text-muted-foreground" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
