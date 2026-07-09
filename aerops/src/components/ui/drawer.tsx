"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Right-side detail drawer (Section 3): edit-in-context instead of page
 * navigation. Traps focus, closes on ESC, restores focus on close, and
 * announces itself as a dialog.
 */
export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const node = ref.current;
    node?.querySelector<HTMLElement>("button, [href], input, select, textarea")?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      } else if (e.key === "Tab" && node) {
        // Simple focus trap: cycle within the drawer.
        const focusables = node.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fixed inset-y-0 right-0 z-40 w-full max-w-sm animate-fade-up border-l border-border bg-card shadow-2xl"
      >
        <div className="flex h-14 items-center justify-between border-b border-border px-4">
          <h2 className="text-sm font-semibold">{title}</h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close drawer"><X className="h-4 w-4" /></Button>
        </div>
        <div className="h-[calc(100vh-3.5rem)] space-y-4 overflow-y-auto p-4">{children}</div>
      </div>
    </>
  );
}
