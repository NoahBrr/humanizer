import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Section, Eyebrow, Heading, Lead, CtaBand } from "@/components/marketing/sections";
import { SOLUTIONS } from "@/components/marketing/solutions-data";

export const metadata: Metadata = {
  title: "Solutions",
  description: "AeroOps for flight schools, flying clubs, aircraft rental, FBOs, maintenance operations, and corporate flight departments.",
};

export default function SolutionsIndexPage() {
  return (
    <>
      <Section className="text-center">
        <Eyebrow>Solutions</Eyebrow>
        <Heading className="text-4xl">Built around what your operation does</Heading>
        <Lead className="mx-auto">
          AeroOps isn&apos;t a flight-school tool with everyone else bolted on. Organizations select their business
          activities and the platform enables the right modules — training, club ops, rental, FBO services,
          maintenance, or the corporate flight department.
        </Lead>
      </Section>
      <Section className="pt-0">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SOLUTIONS.map((s) => (
            <Link key={s.slug} href={`/solutions/${s.slug}`} className="group rounded-xl border border-border bg-card p-6 transition-colors hover:border-brand-royal/50">
              <p className="text-sm font-semibold group-hover:text-brand-royal dark:group-hover:text-brand-sky">{s.label}</p>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{s.sub}</p>
              <p className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand-royal dark:text-brand-sky">
                Explore <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </p>
            </Link>
          ))}
        </div>
      </Section>
      <CtaBand />
    </>
  );
}
