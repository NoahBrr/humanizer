import type { Metadata } from "next";
import { Section, Eyebrow, Heading, Lead } from "@/components/marketing/sections";
import { LeadForm } from "@/components/marketing/lead-form";

export const metadata: Metadata = {
  title: "Contact",
  description: "Get in touch with the AeroOps team for sales, demos, partnerships, or general questions.",
};

export default function ContactPage() {
  return (
    <Section className="grid items-start gap-10 lg:grid-cols-2">
      <div>
        <Eyebrow>Contact</Eyebrow>
        <Heading className="text-4xl">Talk to the AeroOps team</Heading>
        <Lead>
          Whether you are evaluating AeroOps for a flight school, a flying club, or a broader aviation organization, we are happy to help you explore the right fit.
        </Lead>
        <div className="mt-6 space-y-3 text-sm">
          <p><span className="font-semibold">Sales & demos:</span> <span className="text-muted-foreground">Use the form to request a tailored walkthrough of the product.</span></p>
          <p><span className="font-semibold">General questions:</span> <span className="text-muted-foreground">Ask about product fit, implementation, or the best starting point for your organization.</span></p>
          <p><span className="font-semibold">Support:</span> <span className="text-muted-foreground">Existing customers can reach support from inside AeroOps.</span></p>
        </div>
      </div>
      <LeadForm kind="contact" />
    </Section>
  );
}
