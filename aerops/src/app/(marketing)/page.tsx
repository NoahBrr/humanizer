import type { Metadata } from "next";
import Link from "next/link";
import {
  Wrench, GraduationCap, Building2, Users, Plane, Landmark, Briefcase, ShieldCheck,
} from "lucide-react";
import { Section, Eyebrow, Heading, Lead, ScreenshotFrame, PhoneFrame, FeatureRow, CtaBand, Faq } from "@/components/marketing/sections";
import { ProductTour } from "@/components/marketing/product-tour";

export const metadata: Metadata = {
  title: "AeroOps — The Operating System for Aviation",
  description:
    "Scheduling, dispatch, maintenance, training, billing, CRM, and analytics in one system. Built for flight schools, flying clubs, FBOs, charter, corporate flight departments, and aviation operators.",
};

const AUDIENCES = [
  { icon: GraduationCap, label: "Flight Schools" },
  { icon: Users, label: "Flying Clubs" },
  { icon: Plane, label: "Aircraft Rental" },
  { icon: Landmark, label: "FBOs" },
  { icon: Wrench, label: "Maintenance Shops" },
  { icon: Briefcase, label: "Corporate Flight Departments" },
  { icon: Building2, label: "Universities" },
  { icon: ShieldCheck, label: "Aircraft Management" },
];

const REPLACE = [
  ["Whiteboards & wall calendars", "A live schedule with conflict detection, waitlists, and mobile booking."],
  ["Paper dispatch sheets", "Digital release checklists, hobbs/tach closeout, and automatic invoicing."],
  ["Spreadsheet maintenance tracking", "Inspection countdowns, work orders, signed return-to-service, parts inventory."],
  ["Disconnected tools & sticky notes", "One system of record — every workspace shares the same data, audit trail, and permissions."],
];

const TESTIMONIALS = [
  {
    quote: "We ran on a whiteboard and three spreadsheets for years. Now dispatch, billing, and maintenance are one motion — flights close and the invoice already exists.",
    name: "Chief Flight Instructor",
    org: "Part 141 flight academy · 12 aircraft",
  },
  {
    quote: "Our members book from their phones, the board finally has real utilization numbers, and nobody double-books the 182 anymore.",
    name: "Club President",
    org: "Member-owned flying club · 5 aircraft",
  },
  {
    quote: "The maintenance workspace is what sold our DOM — squawks with airworthiness impact, and a return-to-service he can actually sign.",
    name: "Director of Operations",
    org: "Charter & management operator",
  },
];

const FAQ_ITEMS: [string, string][] = [
  ["Is AeroOps only for flight schools?", "No. AeroOps is built around business activities, not a single business type: flight training, clubs, rental, FBO services, maintenance, charter, corporate flight departments, universities, and aircraft management. You enable the activities you do, and the right modules light up."],
  ["How long does setup take?", "Create an account, answer a few questions about your operation, and your workspace exists in minutes. Invite your team by email or with a shareable link, and import your fleet and people at your own pace."],
  ["Can my students and members join by themselves?", "Yes — people create individual AeroOps accounts and request to join your organization (or use your invite link). Admins approve requests, assign roles and locations, and everything is audit-logged."],
  ["Does the schedule prevent double bookings?", "Yes. Booking checks aircraft, instructor, and student conflicts, maintenance overlaps, and grounded aircraft — and proposes alternative slots when there's a clash. Staff can override with a reason."],
  ["What about billing?", "Closing a flight computes billable time from hobbs, rolls meters forward, updates the student or member ledger, and generates the invoice in a single transaction. Payments, partial payments, and receivables aging are built in."],
  ["Is my data isolated and secure?", "Every organization is a fully isolated tenant. Role-based permissions gate every page and API, MFA is available for every account, and every important action lands in an immutable audit trail."],
];

export default function HomePage() {
  return (
    <>
      {/* Hero */}
      <section className="bg-brand-navy text-white">
        <div className="mx-auto max-w-6xl px-4 pb-0 pt-16 lg:px-6 lg:pt-24">
          <div className="mx-auto max-w-3xl text-center">
            <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-xs font-medium text-white/80">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-sky" />
              Scheduling · Dispatch · Maintenance · Training · Billing · CRM · AI
            </p>
            <h1 className="mt-5 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
              The Operating System<br className="hidden sm:block" /> for Aviation
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-white/70">
              One system for your whole operation — from the front desk to the maintenance hangar to the owner&apos;s
              office. Replace the whiteboard, the paper dispatch binder, and the spreadsheet stack.
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <Link href="/demo" className="inline-flex h-11 items-center rounded-lg bg-white px-6 text-sm font-semibold text-brand-navy shadow-sm transition-colors hover:bg-brand-silver">
                Request a Demo
              </Link>
              <Link href="/sign-up" className="inline-flex h-11 items-center rounded-lg border border-white/30 px-6 text-sm font-semibold text-white transition-colors hover:bg-white/10">
                Create Account
              </Link>
            </div>
            <p className="mt-4 text-xs text-white/50">Self-serve setup in minutes · No credit card to start</p>
          </div>
          <div className="relative mt-12 translate-y-10 lg:translate-y-14">
            <ScreenshotFrame src="/marketing/dashboard.png" alt="AeroOps dashboard — today's operating picture" priority />
          </div>
        </div>
      </section>
      <div className="h-10 lg:h-14" />

      {/* Who it's for */}
      <Section className="pt-10 text-center lg:pt-14">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Built for aviation organizations</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2.5">
          {AUDIENCES.map((a) => (
            <span key={a.label} className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-foreground/85">
              <a.icon className="h-4 w-4 text-brand-royal dark:text-brand-sky" /> {a.label}
            </span>
          ))}
        </div>
      </Section>

      {/* Replace the stack */}
      <Section className="pt-0">
        <div className="text-center">
          <Eyebrow>Why AeroOps</Eyebrow>
          <Heading>Retire the whiteboard. Keep the operation.</Heading>
          <Lead className="mx-auto">
            Start with scheduling and grow into a complete aviation operating system — every module shares the same
            aircraft, people, billing, and audit trail.
          </Lead>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {REPLACE.map(([from, to]) => (
            <div key={from} className="rounded-xl border border-border bg-card p-5">
              <p className="text-sm font-medium text-muted-foreground line-through decoration-destructive/50">{from}</p>
              <p className="mt-2 text-sm font-medium leading-relaxed">{to}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Product tour */}
      <section className="border-y border-border bg-muted/30">
        <Section>
          <div className="text-center">
            <Eyebrow>Product Tour</Eyebrow>
            <Heading>Every workspace your operation needs</Heading>
            <Lead className="mx-auto">
              Real screenshots from a running AeroOps operation — not mockups. Click through the workspaces.
            </Lead>
          </div>
          <div className="mt-10">
            <ProductTour />
          </div>
        </Section>
      </section>

      {/* Feature rows */}
      <Section className="space-y-20">
        <FeatureRow
          eyebrow="Scheduling"
          title="An aircraft schedule that defends itself"
          body="Timeline calendar by aircraft and instructor, drag-to-book, and server-side conflict detection that catches double-bookings, maintenance overlaps, and grounded aircraft — then suggests the nearest open slot."
          bullets={["Conflict detection with alternative-slot suggestions", "Student lesson requests and day waitlists", "Recurring bookings and multi-location support"]}
          image="/marketing/schedule.png"
          imageAlt="AeroOps scheduling workspace"
          href="/features#scheduling"
        />
        <FeatureRow
          flip
          eyebrow="Operations & Dispatch"
          title="From release to invoice in one motion"
          body="Pre-flight release verifies fuel, documents, and approvals before a wheel turns. Post-flight closeout captures hobbs and tach, updates the logbooks and ledgers, and generates the invoice — in a single transaction."
          bullets={["Airworthiness checks block non-releasable aircraft", "Automatic invoicing on flight close", "Live operations board across locations"]}
          image="/marketing/dispatch.png"
          imageAlt="AeroOps dispatch center"
          href="/features#operations"
        />
        <FeatureRow
          dark
          eyebrow="Mission Control"
          title="Your operation on the big screen"
          body="A continuously-updating operational wall: active flights, fleet status, weather, revenue, alerts, and the day's plan. Built for the front desk, the owner's office, and the trade-show booth."
          bullets={["Live KPI wall with scenes and TV mode", "Alerts for weather, groundings, and overdue balances", "Tomorrow's forecast with instructor load"]}
          image="/marketing/mission-control.png"
          imageAlt="AeroOps Mission Control wall"
          href="/features#mission-control"
        />
        <FeatureRow
          eyebrow="Maintenance"
          title="Airworthiness you can prove"
          body="Squawks carry airworthiness impact, inspections count down in hours and days, work orders follow a real lifecycle with signed return-to-service, and the parts ledger tracks every movement."
          bullets={["Inspection radar: annual, 100-hour, ELT, pitot-static and more", "Work orders with priorities, categories, and signatures", "Parts inventory with low-stock alerts"]}
          image="/marketing/maintenance.png"
          imageAlt="AeroOps fleet maintenance workspace"
          href="/features#maintenance"
        />
        <FeatureRow
          flip
          eyebrow="Business & Intelligence"
          title="Know your numbers — and the reasons behind them"
          body="Executive dashboards rank fleet profitability and utilization, receivables age in real time, and the AI copilot answers plain-English questions with the factors behind every insight."
          bullets={["Executive workspace with operation health score", "CRM pipeline from web lead to enrolled student", "AI recommendations with confidence and reasoning"]}
          image="/marketing/executive.png"
          imageAlt="AeroOps executive workspace"
          href="/features#analytics"
        />
      </Section>

      {/* Mobile */}
      <section className="border-y border-border bg-muted/30">
        <Section className="grid items-center gap-10 lg:grid-cols-2">
          <div>
            <Eyebrow>Mobile Experience</Eyebrow>
            <Heading>Take the operation to the ramp</Heading>
            <Lead>
              AeroOps is a responsive, installable web app. Instructors check the day&apos;s schedule from the run-up
              area, members book from the couch, and mechanics close squawks from the hangar floor — no separate app
              store download required.
            </Lead>
            <ul className="mt-5 space-y-2 text-sm text-foreground/90">
              {["Installable PWA with home-screen icon", "Bottom navigation tuned for one-handed use", "Same permissions, same data, every screen size"].map((b) => (
                <li key={b} className="flex items-start gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-sky" />{b}</li>
              ))}
            </ul>
          </div>
          <PhoneFrame src="/marketing/mobile-dashboard.png" alt="AeroOps on mobile" />
        </Section>
      </section>

      {/* Solutions grid */}
      <Section>
        <div className="text-center">
          <Eyebrow>Solutions</Eyebrow>
          <Heading>Configured around what you do</Heading>
          <Lead className="mx-auto">
            AeroOps organizations pick their business activities — Part 61/141 training, club operations, rental,
            FBO services, maintenance, charter — and the system enables the right modules.
          </Lead>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { href: "/solutions/flight-schools", icon: GraduationCap, title: "Flight Schools", body: "Part 61/141 syllabi, stage checks, checkride readiness, TSA and medical tracking, and instructor operations." },
            { href: "/solutions/flying-clubs", icon: Users, title: "Flying Clubs", body: "Member self-service booking, equity and dues billing, proficiency tracking, and board-ready reporting." },
            { href: "/solutions/aircraft-rental", icon: Plane, title: "Aircraft Rental", body: "Renter checkout requirements, wet/dry rates, fuel surcharges, and automated rental invoicing." },
            { href: "/solutions/fbos", icon: Landmark, title: "FBOs", body: "Discovery flights, rentals, line-service coordination, and parts & fuel inventory in one place." },
            { href: "/solutions/maintenance", icon: Wrench, title: "Maintenance Operations", body: "Work orders, signed return-to-service, inspection tracking, and a full parts traceability ledger." },
            { href: "/solutions/corporate-flight-departments", icon: Briefcase, title: "Corporate Flight Departments", body: "Trip legs, crew currency, maintenance coordination, and executive reporting for the flight department." },
          ].map((s) => (
            <Link key={s.href} href={s.href} className="group rounded-xl border border-border bg-card p-5 transition-colors hover:border-brand-royal/50">
              <s.icon className="h-6 w-6 text-brand-royal dark:text-brand-sky" />
              <p className="mt-3 text-sm font-semibold group-hover:text-brand-royal dark:group-hover:text-brand-sky">{s.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{s.body}</p>
            </Link>
          ))}
        </div>
      </Section>

      {/* Testimonials (placeholder personas) */}
      <section className="border-y border-border bg-muted/30">
        <Section>
          <div className="text-center">
            <Eyebrow>What operators say</Eyebrow>
            <Heading>Run by people who run flight lines</Heading>
          </div>
          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            {TESTIMONIALS.map((t) => (
              <figure key={t.org} className="rounded-xl border border-border bg-card p-6">
                <blockquote className="text-sm leading-relaxed text-foreground/90">“{t.quote}”</blockquote>
                <figcaption className="mt-4 text-xs">
                  <span className="font-semibold">{t.name}</span>
                  <span className="block text-muted-foreground">{t.org}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        </Section>
      </section>

      {/* Pricing preview */}
      <Section className="text-center">
        <Eyebrow>Pricing</Eyebrow>
        <Heading>Plans that grow with your fleet</Heading>
        <Lead className="mx-auto">From a five-aircraft club to a university program — start on Starter and change plans any time.</Lead>
        <div className="mx-auto mt-8 grid max-w-4xl gap-4 sm:grid-cols-3">
          {[
            ["Starter", "$149", "Up to 5 aircraft · scheduling, dispatch, billing, documents"],
            ["Professional", "$399", "Up to 25 aircraft · adds maintenance, reports, and multi-location"],
            ["Enterprise", "$999", "Up to 200 aircraft · adds AI copilot, inventory, and dedicated support"],
          ].map(([name, price, desc]) => (
            <div key={name} className={`rounded-xl border p-5 text-left ${name === "Professional" ? "border-brand-royal shadow-[0_10px_40px_-15px_rgb(30_99_208/0.4)]" : "border-border"}`}>
              <p className="text-sm font-semibold">{name}</p>
              <p className="mt-1 text-2xl font-semibold">{price}<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{desc}</p>
            </div>
          ))}
        </div>
        <Link href="/pricing" className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-brand-royal hover:underline dark:text-brand-sky">
          Full pricing & plan comparison <span aria-hidden>→</span>
        </Link>
      </Section>

      {/* FAQ */}
      <Section className="pt-0">
        <div className="mb-8 text-center">
          <Eyebrow>FAQ</Eyebrow>
          <Heading>Common questions</Heading>
        </div>
        <Faq items={FAQ_ITEMS} />
      </Section>

      <CtaBand />
    </>
  );
}
