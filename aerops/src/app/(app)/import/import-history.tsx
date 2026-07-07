"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function RollbackButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function rollback() {
    if (!confirm("Roll back this import?\n\nEvery record it CREATED will be deleted. Records it UPDATED keep their imported values.")) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/import/jobs/${jobId}/rollback`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) setError(typeof data.error === "string" ? data.error : "Rollback failed.");
    else router.refresh();
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button size="sm" variant="outline" onClick={rollback} disabled={busy}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />} Roll back
      </Button>
      {error && <span className="max-w-64 text-right text-[10px] text-destructive">{error}</span>}
    </span>
  );
}
