import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "lucide-react";
import { Section, Eyebrow, Heading, Lead, Faq, CtaBand } from "@/components/marketing/sections";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Pricing",
  description: "AeroOps pricing: Starter, Professional, Enterprise, and University plans that grow with your fleet.",
};

/** Plan cards mirror the platform's seeded SubscriptionPlan catalog. */
const PLANS = [
  {
    name: "Starter",
    price: 149,
    blurb: "For small schools and clubs getting off the whiteboard.",
    limits: "Up to 25 users · 5 aircraft · 1 location",
    features: ["Scheduling with conflict detection", "Dispatch & automatic invoicing", "Billing & ledgers", "Documents vault", "Mobile web app", "Email support"],
    highlight: false,
  },
  {
    name: "Professional",
    price: 399,
    blurb: "For growing operations that live on the flight line.",
    limits: "Up to 150 users · 25 aircraft · 5 locations",
    features: ["Everything in Starter", "Maintenance & work orders", "Reports & exports", "Training syllabi & records", "CRM & discovery flights", "Mission Control", "Priority support"],
    highlight: true,
  },
  {
    name: "Enterprise",
    price: 999,
    blurb: "For multi-location operators, charter, and management companies.",
    limits: "Up to 1,000 users · 200 aircraft · 25 locations",
    features: ["Everything in Professional", "AI Copilot & insights", "Parts inventory & traceability", "Public API & webhooks", "Advanced audit & security", "Dedicated support"],
    highlight: false,
  },
  {
    name: "University",
    price: 1499,
    blurb: "For collegiate programs flying cohorts at scale.",
    limits: "Up to 2,500 users · 300 aircraft · 10 locations",
    features: ["Everything in Enterprise", "Semester-scale scheduling", "Program-level reporting", "Dedicated onboarding", "Dedicated support"],
    highlight: false,
  },
];

const FAQ_ITEMS: [string, string][] = [
  ["Can I change plans later?", "Yes — plans can change at any time and take effect immediately. Your data never changes shape between plans; modules simply switch on."],
  ["Is there a free trial?", "Create an account and set up your organization on Starter to evaluate with your real workflow. Talk to us for an extended pilot on larger plans."],
  ["Do you charge per aircraft or per user?", "Neither — plans are flat monthly prices with generous user, aircraft, and location allowances, so adding your members and students never costs extra."],
  ["What counts as a user?", "Anyone with a login: staff, instructors, students, and members. Individual accounts that haven't joined your organization don't count."],
  ["Do you support Part 141 programs?", "Yes — structured syllabi with stages, stage checks, and the training records to match, alongside Part 61 courses."],
  ["How does onboarding work?", "Self-serve: the setup wizard creates your workspace in minutes, and invite links onboard your members in bulk. Professional and above include guided onboarding with our team."],
];

export default function PricingPage() {
  return (
    <>
      <Section className="pb-8 text-center">
        <Eyebrow>Pricing</Eyebrow>
        <Heading className="text-4xl">Flat pricing. No per-seat surprises.</Heading>
        <Lead className="mx-auto">
          Every plan includes unlimited bookings, automatic invoicing, and the mobile experience. Pick by fleet size —
          change any time.
        </Lead>
      </Section>

      <Section className="pt-0">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {PLANS.map((p) => (
            <div
              key={p.name}
              className={cn(
                "flex flex-col rounded-2xl border bg-card p-6",
                p.highlight ? "border-brand-royal shadow-[0_18px_50px_-20px_rgb(30_99_208/0.45)]" : "border-border",
              )}
            >
              {p.highlight && <span className="mb-3 self-start rounded-full bg-brand-royal px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-white">Most popular</span>}
              <p className="text-sm font-semibold">{p.name}</p>
              <p className="mt-2 text-3xl font-semibold">${p.price}<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{p.blurb}</p>
              <p className="mt-3 rounded-lg bg-muted/60 px-3 py-1.5 text-[11px] font-medium text-muted-foreground">{p.limits}</p>
              <ul className="mt-4 flex-1 space-y-2">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-xs">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" /> {f}
                  </li>
                ))}
              </ul>
              <Link
                href={p.highlight ? "/demo" : "/sign-up"}
                className={cn(
                  "mt-5 inline-flex h-10 items-center justify-center rounded-lg text-sm font-semibold transition-colors",
                  p.highlight ? "bg-primary text-primary-foreground hover:bg-primary/90" : "border border-border hover:bg-muted",
                )}
              >
                {p.highlight ? "Request a Demo" : "Get started"}
              </Link>
            </div>
          ))}
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Need something bigger, or a government/university procurement process? <Link href="/contact" className="font-medium text-brand-royal hover:underline dark:text-brand-sky">Talk to us</Link>.
        </p>
      </Section>

      <Section className="pt-4">
        <div className="mb-8 text-center">
          <Eyebrow>FAQ</Eyebrow>
          <Heading>Pricing questions</Heading>
        </div>
        <Faq items={FAQ_ITEMS} />
      </Section>

      <CtaBand />
    </>
  );
}
