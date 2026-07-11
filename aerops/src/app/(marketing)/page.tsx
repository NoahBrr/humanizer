import type { Metadata } from "next";
import Link from "next/link";
import { Building2, GraduationCap, Plane, Users, Wrench } from "lucide-react";
import { Section, Eyebrow, Heading, Lead, ScreenshotFrame, CtaBand } from "@/components/marketing/sections";

export const metadata: Metadata = {
  title: "AeroOps — The Modern Operating System for Flight Schools",
  description:
    "AeroOps helps flight schools operate every part of the business from one modern platform, with a foundation designed to grow into broader aviation organizations over time.",
};

const BENEFITS = [
  {
    icon: GraduationCap,
    title: "Run Your Entire Flight School",
    body: "Bring scheduling, dispatch, training, billing, and operations into one calm, connected workspace.",
    href: "/solutions/flight-schools",
  },
  {
    icon: Plane,
    title: "Modern Dispatch & Scheduling",
    body: "Keep aircraft, instructors, and students aligned with live availability and clear operational controls.",
    href: "/features#scheduling",
  },
  {
    icon: Building2,
    title: "Built to Scale With You",
    body: "Start with flight school operations and grow into broader aviation programs with the same trusted platform.",
    href: "/solutions/university-aviation-programs",
  },
];

const SOLUTIONS = [
  { href: "/solutions/flight-schools", icon: GraduationCap, title: "Flight Schools", body: "Training, scheduling, dispatch, and billing for schools that need calm, professional operations." },
  { href: "/solutions/flying-clubs", icon: Users, title: "Flying Clubs", body: "Member self-service booking and club operations without the spreadsheet overhead." },
  { href: "/solutions/university-aviation-programs", icon: Building2, title: "University Aviation Programs", body: "Program-scale coordination for academic and flight operations in one place." },
  { href: "/solutions/corporate-aviation", icon: Wrench, title: "Corporate Aviation", body: "A polished foundation for organizations that need operational clarity as they grow." },
];

export default function HomePage() {
  return (
    <>
      <section className="bg-brand-navy text-white">
        <div className="mx-auto max-w-6xl px-4 pb-16 pt-16 lg:px-6 lg:pt-24">
          <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="max-w-2xl">
              <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-xs font-medium text-white/80">
                <span className="h-1.5 w-1.5 rounded-full bg-brand-sky" />
                Flight Schools · Flying Clubs · Aviation Growth
              </p>
              <h1 className="mt-5 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
                The Modern Operating System for Flight Schools
              </h1>
              <p className="mt-5 text-base leading-relaxed text-white/70">
                AeroOps helps flight schools run every part of the business from one modern platform, with a foundation designed to grow into other aviation organizations over time.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link href="/demo" className="inline-flex h-11 items-center rounded-lg bg-white px-6 text-sm font-semibold text-brand-navy shadow-sm transition-colors hover:bg-brand-silver">
                  Request a Demo
                </Link>
                <Link href="/sign-up" className="inline-flex h-11 items-center rounded-lg border border-white/30 px-6 text-sm font-semibold text-white transition-colors hover:bg-white/10">
                  Create Account
                </Link>
              </div>
            </div>
            <div className="print-flatten print-break-before">
              <ScreenshotFrame src="/marketing/dashboard.png" alt="AeroOps dashboard for flight school operations" priority />
            </div>
          </div>
        </div>
      </section>

      <Section className="pt-10 lg:pt-14">
        <div className="text-center">
          <Eyebrow>Three core benefits</Eyebrow>
          <Heading>Designed for the way aviation organizations actually operate</Heading>
        </div>
        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          {BENEFITS.map((benefit) => (
            <div key={benefit.title} className="rounded-2xl border border-border bg-card p-6 shadow-sm">
              <benefit.icon className="h-6 w-6 text-brand-royal dark:text-brand-sky" />
              <h3 className="mt-4 text-lg font-semibold text-brand-navy dark:text-foreground">{benefit.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{benefit.body}</p>
              <Link href={benefit.href} className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-brand-royal hover:underline dark:text-brand-sky">
                Learn More
              </Link>
            </div>
          ))}
        </div>
      </Section>

      <Section className="pt-0">
        <div className="rounded-3xl border border-border bg-card p-8 lg:p-12">
          <div className="grid items-center gap-10 lg:grid-cols-[0.95fr_1.05fr]">
            <div>
              <Eyebrow>Product preview</Eyebrow>
              <Heading className="text-3xl">A clear operating picture from the first login</Heading>
              <Lead className="mx-0 mt-4">
                AeroOps brings the day’s schedule, fleet readiness, training progress, and billing into one focused experience that feels professional from the start.
              </Lead>
              <Link href="/features" className="mt-6 inline-flex h-10 items-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
                Explore AeroOps
              </Link>
            </div>
            <ScreenshotFrame src="/marketing/mission-control.png" alt="AeroOps product preview" />
          </div>
        </div>
      </Section>

      <Section className="pt-0">
        <div className="text-center">
          <Eyebrow>Solutions</Eyebrow>
          <Heading>Built for the organizations that keep aviation moving</Heading>
        </div>
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {SOLUTIONS.map((solution) => (
            <Link key={solution.href} href={solution.href} className="rounded-2xl border border-border bg-card p-6 text-left transition-colors hover:border-brand-royal/50">
              <solution.icon className="h-6 w-6 text-brand-royal dark:text-brand-sky" />
              <h3 className="mt-4 text-lg font-semibold text-brand-navy dark:text-foreground">{solution.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{solution.body}</p>
            </Link>
          ))}
        </div>
      </Section>

      <Section className="pt-0">
        <div className="rounded-3xl border border-border bg-muted/40 p-8 lg:p-12">
          <Eyebrow>Vision</Eyebrow>
          <Heading className="text-3xl">AeroOps is building a more dependable future for aviation operations</Heading>
          <Lead className="mx-0 mt-4 max-w-3xl">
            We are focused on helping aviation organizations run with more clarity, better discipline, and a more professional customer experience — from the first lesson to the next stage of growth.
          </Lead>
        </div>
      </Section>

      <CtaBand title="Ready to modernize your flight school?" body="Take the first step with a tailored demo or create an account and explore AeroOps on your own terms." />
    </>
  );
}
