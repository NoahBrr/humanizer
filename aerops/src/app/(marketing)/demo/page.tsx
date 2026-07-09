import type { Metadata } from "next";
import { Check } from "lucide-react";
import { Section, Eyebrow, Heading, Lead } from "@/components/marketing/sections";
import { LeadForm } from "@/components/marketing/lead-form";

export const metadata: Metadata = {
  title: "Request a Demo",
  description: "See AeroOps live with an operation like yours loaded in.",
};

const EXPECT = [
  "A live walkthrough with realistic data for your kind of operation",
  "Scheduling, dispatch, maintenance, billing, and Mission Control end-to-end",
  "Straight answers on migration, pricing, and rollout",
  "30–45 minutes, tailored to the roles on your team",
];

export default function DemoPage() {
  return (
    <Section className="grid items-start gap-10 lg:grid-cols-2">
      <div>
        <Eyebrow>Request a Demo</Eyebrow>
        <Heading className="text-4xl">See your operation on AeroOps</Heading>
        <Lead>
          We&apos;ll load a demo environment that looks like your business — your fleet mix, your kind of schedule —
          and walk through a full day of operations.
        </Lead>
        <ul className="mt-6 space-y-2.5">
          {EXPECT.map((e) => (
            <li key={e} className="flex items-start gap-2.5 text-sm">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" /> {e}
            </li>
          ))}
        </ul>
        <p className="mt-6 text-xs text-muted-foreground">
          Prefer to explore on your own? <a href="/sign-up" className="font-medium text-brand-royal hover:underline dark:text-brand-sky">Create an account</a> and set up your workspace in minutes.
        </p>
      </div>
      <LeadForm kind="demo" />
    </Section>
  );
}
