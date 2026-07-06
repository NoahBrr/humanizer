"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StickyNote, Loader2, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type NoteRow = { id: string; authorLabel: string; body: string; createdAt: string };

export function NotesPanel({ orgId, notes }: { orgId: string; notes: NoteRow[] }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    const res = await fetch(`/api/platform/organizations/${orgId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    setBusy(false);
    if (res.ok) { setBody(""); router.refresh(); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5"><StickyNote className="h-4 w-4" /> Platform Notes</CardTitle>
        <CardDescription>Internal only — never visible to the customer. Every note is audited.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2.5">
        <div className="flex gap-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            placeholder="Call summary, renewal context, escalation history…"
            className="min-h-9 flex-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs shadow-sm"
          />
          <Button size="sm" disabled={busy || body.trim().length < 2} onClick={add}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add
          </Button>
        </div>
        {notes.length === 0 && <p className="text-xs text-muted-foreground">No notes yet.</p>}
        {notes.map((n) => (
          <div key={n.id} className="rounded-lg border border-border p-2.5">
            <p className="whitespace-pre-wrap text-xs">{n.body}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">{n.authorLabel} · {new Date(n.createdAt).toLocaleString()}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
