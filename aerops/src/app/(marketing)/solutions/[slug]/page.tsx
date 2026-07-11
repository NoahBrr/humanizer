import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, X } from "lucide-react";
import { Section, Eyebrow, Heading, Lead, ScreenshotFrame, CtaBand } from "@/components/marketing/sections";
import { SOLUTIONS } from "@/components/marketing/solutions-data";

export function generateStaticParams() {
  return SOLUTIONS.map((s) => ({ slug: s.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const s = SOLUTIONS.find((x) => x.slug === slug);
  return s ? { title: `${s.label} — Solutions`, description: s.sub } : {};
}

export default async function SolutionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const s = SOLUTIONS.find((x) => x.slug === slug);
  if (!s) notFound();

  return (
    <>
      <Section className="pb-8">
        <div className="mx-auto max-w-3xl text-center">
          <Eyebrow>Solutions · {s.label}</Eyebrow>
          <Heading className="text-4xl">{s.headline}</Heading>
          <Lead className="mx-auto">{s.sub}</Lead>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link href="/demo" className="inline-flex h-10 items-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90">
              Request a Demo
            </Link>
            <Link href="/sign-up" className="inline-flex h-10 items-center rounded-lg border border-border px-5 text-sm font-semibold hover:bg-muted">
              Create Account
            </Link>
          </div>
        </div>
        <div className="mt-10">
          <ScreenshotFrame src={s.image} alt={`AeroOps for ${s.label}`} priority />
        </div>
      </Section>

      <Section className="grid gap-10 pt-8 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <h3 className="text-lg font-semibold tracking-tight text-brand-navy dark:text-foreground">Sound familiar?</h3>
          <ul className="mt-4 space-y-2.5">
            {s.pains.map((p) => (
              <li key={p} className="flex items-start gap-2.5 rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm text-muted-foreground">
                <X className="mt-0.5 h-4 w-4 shrink-0 text-destructive/70" /> {p}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-muted-foreground">
            Business activities this solution uses: {s.activities.join(" · ")}
          </p>
        </div>
        <div className="lg:col-span-3">
          <h3 className="text-lg font-semibold tracking-tight text-brand-navy dark:text-foreground">How AeroOps handles it</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {s.features.map((f) => (
              <div key={f.title} className="rounded-xl border border-border bg-card p-4">
                <p className="flex items-start gap-2 text-sm font-semibold">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" /> {f.title}
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{f.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 rounded-2xl border border-border bg-muted/30 p-5">
            <p className="text-sm font-semibold text-brand-navy dark:text-foreground">Relevant modules</p>
            <p className="mt-2 text-sm text-muted-foreground">{s.modules.join(" · ")}</p>
            <p className="mt-4 text-sm font-semibold text-brand-navy dark:text-foreground">Typical workflow</p>
            <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
              {s.workflow.map((step) => (
                <li key={step} className="flex items-start gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-sky" />{step}</li>
              ))}
            </ul>
            <p className="mt-4 text-sm font-semibold text-brand-navy dark:text-foreground">Customer journey</p>
            <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
              {s.journey.map((step) => (
                <li key={step} className="flex items-start gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-sky" />{step}</li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      <CtaBand title={s.status === "coming-soon" ? `AeroOps is on the way for ${s.label.toLowerCase()}` : `Bring ${s.label.toLowerCase()} onto AeroOps`} />
    </>
  );
}
