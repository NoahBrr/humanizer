import type { Metadata } from "next";
import Link from "next/link";
import { Section, Eyebrow, Heading, Lead, CtaBand } from "@/components/marketing/sections";

export const metadata: Metadata = {
  title: "About",
  description: "AeroOps exists to bring modern, dependable software to flight schools and aviation organizations that deserve better tools.",
};

const PRINCIPLES = [
  ["Built for aviation operations", "AeroOps is designed around how flight schools and other aviation organizations actually run — with scheduling discipline, airworthiness awareness, and billing that closes the loop."],
  ["One system of record", "Scheduling, maintenance, training, and money share the same aircraft, the same people, and the same audit trail."],
  ["Professional by default", "The experience is designed to feel calm, credible, and modern — from the first login to the busiest day of the season."],
  ["Grow without replatforming", "AeroOps starts with the flight school core and expands naturally as an organization grows in complexity."],
];

export default function AboutPage() {
  return (
    <>
      <Section className="pb-8">
        <div className="mx-auto max-w-3xl text-center">
          <Eyebrow>About AeroOps</Eyebrow>
          <Heading className="text-4xl">Aviation deserves software that feels as professional as the work itself</Heading>
          <Lead className="mx-auto">
            AeroOps was built to give flight schools and aviation organizations a modern way to operate with clarity. The goal is simple: fewer manual workarounds, better visibility, and a calmer experience for the teams running the operation.
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
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-sky">The vision</p>
          <h3 className="mt-2 max-w-2xl text-2xl font-semibold tracking-tight">
            We are building the operating system for aviation organizations that want to grow with confidence.
          </h3>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/70">
            AeroOps is designed to support the day-to-day needs of flight schools today while giving them a strong foundation for the broader aviation organizations they may become tomorrow.
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
