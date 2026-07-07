import type { Metadata } from "next";
import {
  CalendarDays, Radio, MonitorPlay, Wrench, Receipt, Sparkles, GraduationCap,
  Megaphone, ShieldCheck, FolderLock, Users, Bell,
} from "lucide-react";
import { Section, Eyebrow, Heading, Lead, FeatureRow, CtaBand } from "@/components/marketing/sections";

export const metadata: Metadata = {
  title: "Features",
  description: "Everything AeroOps does: scheduling, dispatch, Mission Control, maintenance, training, billing, CRM, documents, and AI — one aviation operating system.",
};

const CAPABILITIES = [
  { icon: CalendarDays, title: "Scheduling", body: "Timeline calendar, conflict detection, requests, waitlists, recurrence." },
  { icon: Radio, title: "Dispatch", body: "Release checklists, closeout, automatic invoicing, squawk capture." },
  { icon: MonitorPlay, title: "Mission Control", body: "Live operational wall with scenes, alerts, and TV mode." },
  { icon: Wrench, title: "Maintenance", body: "Squawks, work orders, return-to-service, inspections, parts inventory." },
  { icon: GraduationCap, title: "Training", body: "Part 61/141 syllabi, stage checks, endorsements, checkride readiness." },
  { icon: Receipt, title: "Billing", body: "Auto-invoices, payments, ledgers, receivables aging, exports." },
  { icon: Megaphone, title: "CRM & Growth", body: "Lead pipeline, discovery flights, one-click enrollment." },
  { icon: Sparkles, title: "AI Copilot", body: "Plain-English questions, reasoned insights, operational forecasts." },
  { icon: Users, title: "People & Roles", body: "Data-driven permissions, custom roles, invitations, join requests." },
  { icon: FolderLock, title: "Documents", body: "Expiration-tracked vault for medicals, certificates, and logs." },
  { icon: Bell, title: "Notifications", body: "In-app alerts for weather, maintenance, balances, and approvals." },
  { icon: ShieldCheck, title: "Security & Audit", body: "MFA, session controls, tenant isolation, immutable audit trail." },
];

export default function FeaturesPage() {
  return (
    <>
      <Section className="pb-8 text-center">
        <Eyebrow>Product</Eyebrow>
        <Heading className="text-4xl">One system. The whole operation.</Heading>
        <Lead className="mx-auto">
          AeroOps replaces the patchwork of scheduling tools, spreadsheets, paper dispatch, and disconnected billing
          with a single operating system built for aviation organizations.
        </Lead>
      </Section>

      <Section className="pt-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {CAPABILITIES.map((c) => (
            <div key={c.title} className="rounded-xl border border-border bg-card p-4">
              <c.icon className="h-5 w-5 text-brand-royal dark:text-brand-sky" />
              <p className="mt-2.5 text-sm font-semibold">{c.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{c.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section id="scheduling" className="space-y-20">
        <FeatureRow
          eyebrow="Scheduling"
          title="The schedule is the source of truth"
          body="Day, week, month, and by-aircraft timeline views with drag-to-book and drag-to-move. Every booking is checked server-side against aircraft, instructor, and student availability, maintenance windows, and airworthiness — with alternative slots suggested on conflict."
          bullets={[
            "Student lesson requests reviewed by staff",
            "Waitlists that notify when a slot opens",
            "Recurring bookings, multi-location, resource filters",
            "Weather cancellations tracked with reasons",
          ]}
          image="/marketing/schedule.png"
          imageAlt="AeroOps scheduling"
          href="/demo"
          hrefLabel="See it live — request a demo"
        />
        <div id="operations">
          <FeatureRow
            flip
            eyebrow="Operations & Dispatch"
            title="Paper dispatch, retired"
            body="The dispatch board moves every flight through release, out, and closeout. Releases verify fuel, oil, documents, weather acknowledgment, and approvals. Closeouts capture hobbs/tach, compute billable time, roll the meters, update ledgers, and issue the invoice atomically."
            bullets={[
              "Airworthiness engine blocks non-releasable aircraft",
              "Squawk capture at closeout with grounding logic",
              "Live operations command center across locations",
            ]}
            image="/marketing/operations.png"
            imageAlt="AeroOps operations center"
            href="/demo"
            hrefLabel="See it live — request a demo"
          />
        </div>
        <div id="mission-control">
          <FeatureRow
            dark
            eyebrow="Mission Control"
            title="The wall your whole operation watches"
            body="Full-screen, continuously-updating command center: KPI wall, active flights, alerts, fleet status, tomorrow's forecast with instructor load, and curated scenes for different audiences — including a TV mode for the lobby."
            bullets={["Live data stream — no refresh", "Saved scenes per purpose (front desk, owner, mx)", "Health, forecast, and priority intelligence panels"]}
            image="/marketing/mission-control.png"
            imageAlt="AeroOps Mission Control"
            href="/demo"
            hrefLabel="See it live — request a demo"
          />
        </div>
        <div id="maintenance">
          <FeatureRow
            eyebrow="Maintenance"
            title="From squawk to signed return-to-service"
            body="Squawks carry severity and airworthiness impact — a grounding squawk pulls the tail off the schedule instantly. Work orders track priority, category, labor, parts, and corrective action, and close with an electronic return-to-service signature."
            bullets={["Inspection radar with hours- and date-based countdowns", "Parts inventory with movement ledger and low-stock alerts", "Fleet health score with the reasons behind it"]}
            image="/marketing/maintenance.png"
            imageAlt="AeroOps maintenance workspace"
            href="/solutions/maintenance"
          />
        </div>
        <FeatureRow
          flip
          eyebrow="Training"
          title="Training records a Part 141 auditor will like"
          body="Structured syllabi with stages and stage checks, lesson grading with instructor signatures, endorsements with FAR references, ratings, checkride scheduling, and a readiness board that shows exactly who is close to minimums."
          bullets={["Part 61 and Part 141 course support", "CFI command center for the chief instructor", "FAA data on file: certificates, medicals, TSA, FTN"]}
          image="/marketing/training.png"
          imageAlt="AeroOps training workspace"
          href="/solutions/flight-schools"
        />
        <div id="analytics">
          <FeatureRow
            eyebrow="Business & Finance"
            title="Billing that happens by itself"
            body="Every closed flight generates its invoice with typed line items — rental, instruction, fuel surcharges, fees. Payments post against ledgers, receivables age in real time, and the executive workspace ranks profitability by tail, instructor, and student."
            bullets={["Automatic invoice generation on flight close", "Receivables aging and outstanding balance rollups", "Executive KPIs and operation health score"]}
            image="/marketing/billing.png"
            imageAlt="AeroOps billing workspace"
            href="/pricing"
            hrefLabel="See pricing"
          />
        </div>
        <div id="growth">
          <FeatureRow
            flip
            eyebrow="CRM & Admissions"
            title="From web lead to first solo"
            body="A public discovery-flight form feeds a lead pipeline with follow-ups and estimated value. Book the discovery flight from the lead, and convert to an enrolled student or member with one click — history intact."
            bullets={["Lead pipeline with priorities and follow-up dates", "Discovery flight scheduling from the CRM", "One-click conversion to student or member"]}
            image="/marketing/crm.png"
            imageAlt="AeroOps CRM workspace"
            href="/demo"
            hrefLabel="See it live — request a demo"
          />
        </div>
        <div id="intelligence">
          <FeatureRow
            eyebrow="AI Copilot"
            title="Ask your operation anything"
            body="The insight engine watches utilization, revenue, maintenance, and training progress, and surfaces recommendations with their reasoning and confidence. Ask questions in plain English — “which aircraft loses us money?” — and get answers grounded in your data."
            bullets={["Insights carry factors, basis, and confidence", "Natural-language ask endpoint", "AI never mutates data on its own — recommendations only"]}
            image="/marketing/intelligence.png"
            imageAlt="AeroOps AI copilot"
            href="/demo"
            hrefLabel="See it live — request a demo"
          />
        </div>
      </Section>

      <CtaBand />
    </>
  );
}
