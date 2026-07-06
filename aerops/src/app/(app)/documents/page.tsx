import { FileText, ShieldCheck } from "lucide-react";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate, daysUntil, fullName } from "@/lib/utils";
import type { DocumentKind } from "@prisma/client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Documents" };

const KIND_LABELS: Record<DocumentKind, string> = {
  MEDICAL_CERTIFICATE: "Medical Certificates",
  PILOT_CERTIFICATE: "Pilot Certificates",
  GOVERNMENT_ID: "Government IDs",
  INSURANCE: "Insurance",
  RENTAL_AGREEMENT: "Rental Agreements",
  TRAINING_RECORD: "Training Records",
  MAINTENANCE_LOG: "Maintenance Logs",
  OTHER: "Other",
};

export default async function DocumentsPage() {
  const session = await getSession();
  const isStudent = session!.role === "STUDENT";
  const documents = await db.document.findMany({
    where: {
      organizationId: session!.organizationId,
      ...(isStudent ? { ownerId: session!.userId } : {}),
    },
    include: {
      owner: { select: { firstName: true, lastName: true } },
      aircraft: { select: { tailNumber: true } },
    },
    orderBy: { uploadedAt: "desc" },
  });

  const grouped = new Map<DocumentKind, typeof documents>();
  for (const d of documents) {
    const list = grouped.get(d.kind) ?? [];
    list.push(d);
    grouped.set(d.kind, list);
  }

  return (
    <div className="animate-fade-up mx-auto max-w-3xl">
      <PageHeader
        title="Documents"
        description="Encrypted document vault. Uploads support digital signatures; storage backends (S3 / Supabase) are configured in Settings."
      />
      <div className="space-y-4">
        {documents.length === 0 && (
          <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">No documents on file.</CardContent></Card>
        )}
        {[...grouped.entries()].map(([kind, docs]) => (
          <Card key={kind}>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-muted-foreground" /> {KIND_LABELS[kind]}</CardTitle>
              <CardDescription>{docs.length} document{docs.length > 1 ? "s" : ""}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {docs.map((d) => {
                const days = daysUntil(d.expiresAt);
                return (
                  <div key={d.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">{d.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {d.owner ? fullName(d.owner) : d.aircraft ? d.aircraft.tailNumber : "Organization"} · uploaded {formatDate(d.uploadedAt)}
                      </p>
                    </div>
                    {days !== null && (
                      <Badge tone={days < 0 ? "red" : days < 60 ? "amber" : "green"}>
                        {days < 0 ? "Expired" : `Expires ${formatDate(d.expiresAt)}`}
                      </Badge>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
