import type { Metadata } from "next";
import Link from "next/link";
import { Section, Eyebrow, Heading, Lead, Faq, CtaBand } from "@/components/marketing/sections";

export const metadata: Metadata = {
  title: "Pricing",
  description: "AeroOps pricing depends on organization type, fleet size, users, modules, and implementation scope — not a one-size-fits-all plan.",
};

const PRICING_POINTS = [
  "Organization type and workflow complexity",
  "Fleet size and number of locations",
  "Users, instructors, members, and staff",
  "Modules such as scheduling, dispatch, maintenance, billing, and reports",
  "Implementation support and integrations",
];

const FAQ_ITEMS: [string, string][] = [
  ["Do you publish pricing?", "No. AeroOps pricing is tailored to each organization because aviation operations vary so widely by fleet size, complexity, and workflow."],
  ["What happens in a demo?", "We review your operation, outline where AeroOps fits, and show how the platform supports flight schools and growing aviation organizations in the real world."],
  ["Can we start with one module?", "Yes. Many organizations begin with scheduling and dispatch, then expand into training, maintenance, or billing as their needs grow."],
  ["Is there a free trial?", "You can create an account and explore the product on your own, and we can also arrange a guided walkthrough for your team."],
];

export default function PricingPage() {
  return (
    <>
      <Section className="pb-8 text-center">
        <Eyebrow>Pricing</Eyebrow>
        <Heading className="text-4xl">Pricing is tailored to the way you operate</Heading>
        <Lead className="mx-auto">
          Every aviation organization is different. AeroOps pricing depends on the scale of your operation, the modules you need, and the support required to get started well.
        </Lead>
      </Section>

      <Section className="pt-0">
        <div className="rounded-3xl border border-border bg-card p-8 lg:p-12">
          <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr]">
            <div>
              <p className="text-sm font-semibold text-brand-navy dark:text-foreground">What pricing depends on</p>
              <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
                {PRICING_POINTS.map((point) => (
                  <li key={point} className="flex items-start gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-sky" />{point}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-border bg-muted/40 p-6">
              <p className="text-sm font-semibold text-brand-navy dark:text-foreground">What to expect</p>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                We’ll discuss your organization type, fleet size, locations, users, modules, integrations, and implementation needs so we can recommend the right scope and path forward.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link href="/demo" className="inline-flex h-10 items-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90">Request Pricing</Link>
                <Link href="/demo" className="inline-flex h-10 items-center rounded-lg border border-border px-5 text-sm font-semibold hover:bg-muted">Schedule a Demo</Link>
              </div>
            </div>
          </div>
        </div>
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
