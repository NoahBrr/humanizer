import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorize } from "@/lib/session";
import { rateLimit, clientIp } from "@/lib/rate-limit";

/**
 * Natural-language ask endpoint. Two layers:
 *  1. Deterministic intents — org-scoped queries answered directly from the
 *     database with their reasoning, no model required.
 *  2. Conversational layer — when ANTHROPIC_API_KEY is configured, unmatched
 *     questions go to Claude with a compact, org-scoped operating summary.
 * The AI never mutates anything: this endpoint is read-only by construction,
 * and every action stays behind the permissioned, audited APIs.
 */
export async function POST(req: Request) {
  const limited = rateLimit(`ai:${clientIp(req)}`, 15, 60_000);
  if (!limited.allowed) return NextResponse.json({ error: "Slow down a little — try again shortly." }, { status: 429 });

  const { session, error } = await authorize("students.view");
  if (error) return error;
  const organizationId = session.organizationId;

  const body = z.object({ question: z.string().min(3).max(500) }).safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: "Ask a question between 3 and 500 characters." }, { status: 400 });
  const q = body.data.question.toLowerCase();

  // ---- Layer 1: deterministic intents ---------------------------------------
  if (/(checkride|check ride).*(ready|readiness)|ready.*checkride/.test(q)) {
    const students = await db.student.findMany({
      where: { user: { organizationId, isActive: true }, status: "ENROLLED", totalHours: { gte: 30 } },
      include: { user: { select: { firstName: true, lastName: true } } },
      orderBy: { totalHours: "desc" },
      take: 8,
    });
    return NextResponse.json({
      answer: students.length
        ? `${students.length} student(s) at or near checkride hours: ${students.map((s) => `${s.user.firstName} ${s.user.lastName} (${Number(s.totalHours).toFixed(1)} hrs)`).join(", ")}. Open the Training Command Center for the full factor-by-factor readiness board.`
        : "Nobody is at checkride hours yet — the Training Command Center tracks everyone's progress toward it.",
      source: "Computed from live training records (hours ≥ 30).",
      href: "/training",
    });
  }
  if (/overdue.*(invoice|account|balance)|invoice.*overdue/.test(q)) {
    const overdue = await db.invoice.findMany({
      where: { organizationId, status: { in: ["OPEN", "PARTIALLY_PAID", "OVERDUE"] }, dueAt: { lt: new Date() } },
      include: { student: { include: { user: { select: { firstName: true, lastName: true } } } } },
      take: 10,
    });
    return NextResponse.json({
      answer: overdue.length
        ? `${overdue.length} overdue invoice(s): ${overdue.map((i) => `${i.number}${i.student ? ` (${i.student.user.firstName} ${i.student.user.lastName})` : ""}`).join(", ")}.`
        : "No overdue invoices — collections are clean.",
      source: "Live invoice ledger, due date before now.",
      href: "/billing",
    });
  }
  if (/hasn'?t flown|not flown|inactive student|who.*idle/.test(q)) {
    const students = await db.student.findMany({
      where: { user: { organizationId, isActive: true }, status: "ENROLLED" },
      include: { user: { select: { firstName: true, lastName: true } }, lessonRecords: { orderBy: { date: "desc" }, take: 1, select: { date: true } } },
    });
    const idle = students.filter((s) => !s.lessonRecords[0] || Date.now() - s.lessonRecords[0].date.getTime() > 30 * 86_400_000);
    return NextResponse.json({
      answer: idle.length
        ? `${idle.length} student(s) with no lesson in 30+ days: ${idle.map((s) => `${s.user.firstName} ${s.user.lastName}`).join(", ")}. These are your highest dropout risks.`
        : "Every enrolled student has flown within the last 30 days.",
      source: "Most recent lesson record per enrolled student.",
      href: "/training",
    });
  }
  if (/underutilized|utilization.*aircraft|aircraft.*(idle|underused)/.test(q)) {
    const fleet = await db.aircraft.findMany({
      where: { organizationId, isSimulator: false, status: { not: "RETIRED" } },
      include: { dispatches: { where: { status: "CLOSED", closedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } }, select: { flightTime: true } } },
    });
    const ranked = fleet
      .map((a) => ({ tail: a.tailNumber, hours: a.dispatches.reduce((t, d) => t + Number(d.flightTime ?? 0), 0) }))
      .sort((a, b) => a.hours - b.hours);
    return NextResponse.json({
      answer: `Least utilized over 30 days: ${ranked.slice(0, 3).map((a) => `${a.tail} (${a.hours.toFixed(1)} hrs)`).join(", ")}. Consider rotating bookings toward them or reviewing their rates.`,
      source: "Closed dispatch hours per aircraft, last 30 days.",
      href: "/reports",
    });
  }

  // ---- Layer 2: conversational (Claude adapter, env-gated) -------------------
  if (process.env.ANTHROPIC_API_KEY) {
    const [orgName, insightCount] = await Promise.all([
      db.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
      db.lead.count({ where: { organizationId } }),
    ]);
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 500,
        system: `You are the AeroOps operations copilot for ${orgName?.name}. Answer from aviation-operations knowledge, be concise, always explain reasoning, and recommend which AeroOps workspace to open. Never claim to have taken an action. (${insightCount} CRM records on file.)`,
        messages: [{ role: "user", content: body.data.question }],
      }),
    });
    if (res.ok) {
      const j = await res.json();
      return NextResponse.json({ answer: j.content?.[0]?.text ?? "No answer.", source: "AeroOps Copilot (Claude)", href: "/intelligence" });
    }
  }

  return NextResponse.json({
    answer:
      "I can answer these directly today: checkride readiness, overdue invoices, students who haven't flown, and underutilized aircraft. The full conversational copilot activates when an Anthropic API key is configured for your deployment.",
    source: "Deterministic intents (no API key configured).",
    href: "/intelligence",
  });
}
