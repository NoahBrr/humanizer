"use client";

import { useState } from "react";
import Link from "next/link";
import { Sparkles, Loader2, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const SUGGESTIONS = [
  "Show me every student ready for a checkride",
  "Find every overdue invoice",
  "Who hasn't flown in sixty days?",
  "Which aircraft are underutilized?",
];

export function AskBox() {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ answer: string; source: string; href: string } | null>(null);

  async function ask(q: string) {
    setBusy(true);
    setResult(null);
    const res = await fetch("/api/ai/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: q }),
    });
    setBusy(false);
    if (res.ok) setResult(await res.json());
  }

  return (
    <Card>
      <CardContent className="space-y-2.5 p-4">
        <form
          onSubmit={(e) => { e.preventDefault(); if (question.trim().length >= 3) ask(question.trim()); }}
          className="flex gap-2"
        >
          <div className="relative flex-1">
            <Sparkles className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary" />
            <Input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask about your operation — students, aircraft, invoices, utilization…"
              className="pl-9"
            />
          </div>
          <Button type="submit" disabled={busy || question.trim().length < 3}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Ask"}
          </Button>
        </form>
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => { setQuestion(s); ask(s); }}
              className="cursor-pointer rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              {s}
            </button>
          ))}
        </div>
        {result && (
          <div className="rounded-lg border border-primary/25 bg-primary/5 p-3">
            <p className="text-xs">{result.answer}</p>
            <div className="mt-1.5 flex items-center justify-between">
              <p className="text-[10px] text-muted-foreground">{result.source}</p>
              <Link href={result.href} className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline">
                Open workspace <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
