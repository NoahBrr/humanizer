import { NextResponse } from "next/server";
import { authorize } from "@/lib/session";
import { specOf, templateCsv } from "@/lib/import/spec";

/** Downloadable CSV migration template for a data type. */
export async function GET(_req: Request, { params }: { params: Promise<{ type: string }> }) {
  const { error } = await authorize("data.import");
  if (error) return error;
  const { type } = await params;

  const spec = specOf(type);
  if (!spec) return NextResponse.json({ error: "Unknown template" }, { status: 404 });

  return new NextResponse(templateCsv(spec), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="aerops-${spec.key}-template.csv"`,
    },
  });
}
