"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, CornerDownLeft, Plane, GraduationCap, Users, Receipt, FileText, Wrench, Loader2 } from "lucide-react";
import { NAV_ITEMS } from "./nav-config";

type EntityResult = { type: string; label: string; sublabel: string; href: string };
type Item = { key: string; label: string; sublabel?: string; group: string; href: string; icon: React.ElementType };

const TYPE_ICONS: Record<string, React.ElementType> = {
  Aircraft: Plane,
  Student: GraduationCap,
  Instructor: Users,
  Invoice: Receipt,
  Document: FileText,
  Squawk: Wrench,
};

/**
 * Global search + navigation (⌘K / Ctrl+K). Typing searches real entities —
 * students, tail numbers, invoices, documents, squawks — org-scoped and
 * permission-filtered server-side. Arrow keys + Enter to open.
 */
export function CommandPalette({ allowedPaths }: { allowedPaths: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [entityResults, setEntityResults] = useState<EntityResult[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced entity search
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setEntityResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`);
        if (res.ok) {
          const j = (await res.json()) as { results: EntityResult[] };
          setEntityResults(j.results);
        }
      } finally {
        setSearching(false);
      }
    }, 160);
  }, [query, open]);

  const items = useMemo<Item[]>(() => {
    const nav = NAV_ITEMS.filter((i) => allowedPaths.includes(i.href))
      .filter((i) => !query || i.label.toLowerCase().includes(query.toLowerCase()))
      .map((i) => ({ key: `nav:${i.href}`, label: i.label, group: "Go to", href: i.href, icon: i.icon }));
    const entities = entityResults.map((r, idx) => ({
      key: `ent:${idx}:${r.href}`,
      label: r.label,
      sublabel: `${r.type} · ${r.sublabel}`,
      group: "Results",
      href: r.href,
      icon: TYPE_ICONS[r.type] ?? Search,
    }));
    return [...entities, ...nav];
  }, [query, allowedPaths, entityResults]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setIndex(0);
    setEntityResults([]);
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

  useEffect(() => setIndex(0), [items.length]);

  if (!open) return null;

  let lastGroup = "";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[16vh] backdrop-blur-[2px]" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Global search"
        className="w-full max-w-lg animate-fade-up overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-4">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => Math.min(i + 1, items.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
              if (e.key === "Enter" && items[index]) { router.push(items[index].href); close(); }
            }}
            placeholder="Search students, tail numbers, invoices… or jump to a page"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">ESC</kbd>}
        </div>
        <div className="max-h-80 overflow-y-auto p-1.5">
          {items.length === 0 && !searching && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {query.length >= 2 ? "No matches — try a name, tail number, or invoice number." : "Type to search across your organization."}
            </p>
          )}
          {items.map((item, i) => {
            const showGroup = item.group !== lastGroup;
            lastGroup = item.group;
            return (
              <div key={item.key}>
                {showGroup && <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{item.group}</p>}
                <button
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => { router.push(item.href); close(); }}
                  className={`flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${i === index ? "bg-accent text-accent-foreground" : ""}`}
                >
                  <item.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{item.label}</span>
                    {item.sublabel && <span className="block truncate text-[11px] text-muted-foreground">{item.sublabel}</span>}
                  </span>
                  {i === index && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
