import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authorize } from "@/lib/session";

export type SearchResult = { type: string; label: string; sublabel: string; href: string };

/**
 * Global search (⌘K): one query fans out across every major entity, scoped to
 * the caller's organization and filtered by their permissions.
 */
export async function GET(req: Request) {
  const { session, error } = await authorize(null);
  if (error) return error;

  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ results: [] });

  const organizationId = session.organizationId;
  const can = (p: Parameters<typeof session.permissions.has>[0]) => session.permissions.has(p);
  const contains = { contains: q, mode: "insensitive" as const };

  const [aircraft, students, instructors, invoices, documents, maintenance] = await Promise.all([
    can("aircraft.view")
      ? db.aircraft.findMany({
          where: { organizationId, tailNumber: contains },
          select: { id: true, tailNumber: true, aircraftType: { select: { manufacturer: true, model: true } } },
          take: 5,
        })
      : [],
    can("students.view")
      ? db.student.findMany({
          where: { user: { organizationId, OR: [{ firstName: contains }, { lastName: contains }, { email: contains }] } },
          select: { id: true, trainingGoal: true, user: { select: { firstName: true, lastName: true } } },
          take: 5,
        })
      : [],
    can("instructors.view")
      ? db.instructor.findMany({
          where: { user: { organizationId, OR: [{ firstName: contains }, { lastName: contains }] } },
          select: { id: true, certificates: true, user: { select: { firstName: true, lastName: true } } },
          take: 4,
        })
      : [],
    can("billing.view") || can("billing.record_payments")
      ? db.invoice.findMany({
          where: {
            organizationId,
            OR: [{ number: contains }, { student: { user: { OR: [{ firstName: contains }, { lastName: contains }] } } }],
          },
          select: { id: true, number: true, status: true, student: { select: { user: { select: { firstName: true, lastName: true } } } } },
          take: 5,
        })
      : [],
    can("documents.view")
      ? db.document.findMany({ where: { organizationId, name: contains }, select: { id: true, name: true, kind: true }, take: 4 })
      : [],
    can("maintenance.view")
      ? db.squawk.findMany({
          where: { aircraft: { organizationId }, title: contains },
          select: { id: true, title: true, status: true, aircraft: { select: { tailNumber: true } } },
          take: 4,
        })
      : [],
  ]);

  const results: SearchResult[] = [
    ...aircraft.map((a) => ({ type: "Aircraft", label: a.tailNumber, sublabel: `${a.aircraftType.manufacturer} ${a.aircraftType.model}`, href: `/aircraft/${a.id}` })),
    ...students.map((s) => ({ type: "Student", label: `${s.user.firstName} ${s.user.lastName}`, sublabel: s.trainingGoal ?? "Student", href: `/students/${s.id}` })),
    ...instructors.map((i) => ({ type: "Instructor", label: `${i.user.firstName} ${i.user.lastName}`, sublabel: i.certificates, href: "/instructors" })),
    ...invoices.map((inv) => ({ type: "Invoice", label: inv.number, sublabel: `${inv.student ? `${inv.student.user.firstName} ${inv.student.user.lastName} · ` : ""}${inv.status.toLowerCase()}`, href: `/billing/${inv.id}` })),
    ...documents.map((d) => ({ type: "Document", label: d.name, sublabel: d.kind.replaceAll("_", " ").toLowerCase(), href: "/documents" })),
    ...maintenance.map((m) => ({ type: "Squawk", label: `${m.aircraft.tailNumber} — ${m.title}`, sublabel: m.status.replaceAll("_", " ").toLowerCase(), href: "/maintenance" })),
  ];

  return NextResponse.json({ results: results.slice(0, 18) });
}
