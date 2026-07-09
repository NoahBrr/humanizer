import type { Metadata } from "next";
import Link from "next/link";
import { Section, Eyebrow, Heading, Lead, CtaBand } from "@/components/marketing/sections";

export const metadata: Metadata = {
  title: "About",
  description: "Why AeroOps exists: aviation operations deserve modern software.",
};

const PRINCIPLES = [
  ["Operational first", "AeroOps is built around how flight lines actually run — dispatch discipline, airworthiness gates, and meter-accurate billing — not around a generic calendar."],
  ["One system of record", "Scheduling, maintenance, training, and money share the same aircraft, the same people, and the same audit trail. No sync jobs, no swivel-chair."],
  ["Trust is a feature", "Tenant isolation, data-driven permissions, MFA, and an immutable audit log are core product, not enterprise add-ons."],
  ["Reasons, not just numbers", "Every computed answer in AeroOps — health scores, forecasts, AI recommendations — carries the factors behind it, so you can check the work."],
];

export default function AboutPage() {
  return (
    <>
      <Section className="pb-8">
        <div className="mx-auto max-w-3xl text-center">
          <Eyebrow>About AeroOps</Eyebrow>
          <Heading className="text-4xl">Aviation runs on discipline. Its software should too.</Heading>
          <Lead className="mx-auto">
            Flight schools, clubs, FBOs, and flight departments run some of the most safety-critical small businesses
            in the world — on whiteboards, binders, and spreadsheets. AeroOps exists to give those operations the same
            quality of software that airlines and modern SaaS companies take for granted.
          </Lead>
        </div>
      </Section>

      <Section className="pt-0">
        <div className="grid gap-4 sm:grid-cols-2">
          {PRINCIPLES.map(([title, body]) => (
            <div key={title} className="rounded-xl border border-border bg-card p-6">
              <p className="text-sm font-semibold text-brand-navy dark:text-foreground">{title}</p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section className="pt-0">
        <div className="rounded-2xl bg-brand-navy p-8 text-white lg:p-12">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-sky">The name</p>
          <h3 className="mt-2 max-w-2xl text-2xl font-semibold tracking-tight">
            “Ops” is where aviation businesses are won and lost.
          </h3>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/70">
            Not in the logo, not in the lobby — in operations: the schedule that holds, the squawk that gets fixed
            before it grounds a lesson, the invoice that goes out the moment the prop stops. AeroOps is named for the
            part of the business we obsess over.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/demo" className="inline-flex h-10 items-center rounded-lg bg-white px-5 text-sm font-semibold text-brand-navy hover:bg-brand-silver">Request a Demo</Link>
            <Link href="/features" className="inline-flex h-10 items-center rounded-lg border border-white/30 px-5 text-sm font-semibold text-white hover:bg-white/10">Explore the product</Link>
          </div>
        </div>
      </Section>

      <CtaBand />
    </>
  );
}
