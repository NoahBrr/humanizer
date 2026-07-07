import Link from "next/link";
import { AeroOpsMark } from "@/components/brand/logo";

const COLUMNS: { title: string; links: [string, string][] }[] = [
  {
    title: "Product",
    links: [
      ["/features", "Features"], ["/pricing", "Pricing"], ["/demo", "Request a Demo"], ["/sign-up", "Create Account"],
    ],
  },
  {
    title: "Solutions",
    links: [
      ["/solutions/flight-schools", "Flight Schools"], ["/solutions/flying-clubs", "Flying Clubs"],
      ["/solutions/aircraft-rental", "Aircraft Rental"], ["/solutions/fbos", "FBOs"],
      ["/solutions/maintenance", "Maintenance"], ["/solutions/corporate-flight-departments", "Corporate Flight"],
    ],
  },
  {
    title: "Company",
    links: [
      ["/about", "About"], ["/contact", "Contact"], ["/sign-in", "Sign in"],
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-brand-navy text-white">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:grid-cols-2 lg:grid-cols-5 lg:px-6">
        <div className="lg:col-span-2">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white p-1"><AeroOpsMark className="h-full w-full" /></span>
            <span className="text-[15px] font-bold tracking-[0.07em]">AERO<span className="text-brand-sky">OPS</span></span>
          </div>
          <p className="mt-3 max-w-xs text-xs leading-relaxed text-white/60">
            The Operating System for Aviation. Scheduling, dispatch, maintenance, training, billing,
            CRM, and analytics — one system for your whole operation.
          </p>
        </div>
        {COLUMNS.map((c) => (
          <div key={c.title}>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/50">{c.title}</p>
            <ul className="mt-3 space-y-2">
              {c.links.map(([href, label]) => (
                <li key={href}>
                  <Link href={href} className="text-sm text-white/75 transition-colors hover:text-white">{label}</Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-[11px] text-white/45 lg:px-6">
          <p>© {new Date().getFullYear()} AeroOps. All rights reserved.</p>
          <p>Built for flight schools, clubs, FBOs, charter, corporate, university, and maintenance operations.</p>
        </div>
      </div>
    </footer>
  );
}
