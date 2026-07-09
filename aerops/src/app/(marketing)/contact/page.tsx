import type { Metadata } from "next";
import { Section, Eyebrow, Heading, Lead } from "@/components/marketing/sections";
import { LeadForm } from "@/components/marketing/lead-form";

export const metadata: Metadata = {
  title: "Contact",
  description: "Get in touch with the AeroOps team.",
};

export default function ContactPage() {
  return (
    <Section className="grid items-start gap-10 lg:grid-cols-2">
      <div>
        <Eyebrow>Contact</Eyebrow>
        <Heading className="text-4xl">Talk to the AeroOps team</Heading>
        <Lead>
          Questions about the product, pricing, migrations, partnerships, or anything else — send a note and a human
          will get back to you.
        </Lead>
        <div className="mt-6 space-y-3 text-sm">
          <p><span className="font-semibold">Sales & demos:</span> <span className="text-muted-foreground">use the form, or request a demo directly.</span></p>
          <p><span className="font-semibold">Support:</span> <span className="text-muted-foreground">existing customers can reach support from inside AeroOps.</span></p>
        </div>
      </div>
      <LeadForm kind="contact" />
    </Section>
  );
}
