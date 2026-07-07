import Link from "next/link";
import Image from "next/image";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Shared building blocks for the public marketing site. */

export function Section({ className, children, id }: { className?: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className={cn("mx-auto max-w-6xl px-4 py-16 lg:px-6 lg:py-24", className)}>
      {children}
    </section>
  );
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-royal dark:text-brand-sky">{children}</p>;
}

export function Heading({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h2 className={cn("mt-2 text-3xl font-semibold tracking-tight text-brand-navy dark:text-foreground", className)}>{children}</h2>;
}

export function Lead({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground", className)}>{children}</p>;
}

/** Product screenshot in a subtle browser frame — the workhorse of the site. */
export function ScreenshotFrame({ src, alt, priority = false, className }: { src: string; alt: string; priority?: boolean; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-xl border border-border bg-card shadow-[0_20px_60px_-25px_rgb(11_36_71/0.4)]", className)}>
      <div className="flex h-8 items-center gap-1.5 border-b border-border bg-muted/60 px-3.5">
        <span className="h-2.5 w-2.5 rounded-full bg-border" />
        <span className="h-2.5 w-2.5 rounded-full bg-border" />
        <span className="h-2.5 w-2.5 rounded-full bg-border" />
        <span className="ml-3 hidden h-4 flex-1 max-w-64 rounded bg-border/50 sm:block" />
      </div>
      <Image src={src} alt={alt} width={1400} height={875} priority={priority} className="w-full" quality={90} />
    </div>
  );
}

/** Phone frame for the mobile experience section. */
export function PhoneFrame({ src, alt, className }: { src: string; alt: string; className?: string }) {
  return (
    <div className={cn("mx-auto w-56 overflow-hidden rounded-[2rem] border-[6px] border-brand-gunmetal bg-brand-gunmetal shadow-2xl", className)}>
      <Image src={src} alt={alt} width={390} height={844} className="w-full rounded-[1.6rem]" quality={90} />
    </div>
  );
}

/** Alternating screenshot/copy feature row. */
export function FeatureRow({
  eyebrow, title, body, bullets, image, imageAlt, href, hrefLabel = "Learn more", flip = false, dark = false,
}: {
  eyebrow: string; title: string; body: string; bullets?: string[];
  image: string; imageAlt: string; href: string; hrefLabel?: string; flip?: boolean; dark?: boolean;
}) {
  return (
    <div className={cn("grid items-center gap-10 lg:grid-cols-2", dark && "rounded-2xl bg-brand-navy p-8 text-white lg:p-12")}>
      <div className={cn(flip && "lg:order-2")}>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h3 className={cn("mt-2 text-2xl font-semibold tracking-tight", dark ? "text-white" : "text-brand-navy dark:text-foreground")}>{title}</h3>
        <p className={cn("mt-3 text-sm leading-relaxed", dark ? "text-white/70" : "text-muted-foreground")}>{body}</p>
        {bullets && (
          <ul className="mt-4 space-y-2">
            {bullets.map((b) => (
              <li key={b} className={cn("flex items-start gap-2 text-sm", dark ? "text-white/85" : "text-foreground/90")}>
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-sky" />
                {b}
              </li>
            ))}
          </ul>
        )}
        <Link href={href} className={cn("mt-5 inline-flex items-center gap-1.5 text-sm font-medium", dark ? "text-brand-sky hover:text-white" : "text-brand-royal hover:underline dark:text-brand-sky")}>
          {hrefLabel} <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
      <div className={cn(flip && "lg:order-1")}>
        <ScreenshotFrame src={image} alt={imageAlt} />
      </div>
    </div>
  );
}

/** Full-width call-to-action band. */
export function CtaBand({ title = "Ready to run your operation on AeroOps?", body = "See the full system with your kind of operation loaded in — or create an account and set it up yourself in minutes." }: { title?: string; body?: string }) {
  return (
    <section className="bg-brand-navy">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-5 px-4 py-16 text-center lg:px-6">
        <h2 className="max-w-2xl text-3xl font-semibold tracking-tight text-white">{title}</h2>
        <p className="max-w-xl text-sm leading-relaxed text-white/70">{body}</p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link href="/demo" className="inline-flex h-11 items-center rounded-lg bg-white px-6 text-sm font-semibold text-brand-navy shadow-sm transition-colors hover:bg-brand-silver">
            Request a Demo
          </Link>
          <Link href="/sign-up" className="inline-flex h-11 items-center rounded-lg border border-white/30 px-6 text-sm font-semibold text-white transition-colors hover:bg-white/10">
            Create Account
          </Link>
        </div>
      </div>
    </section>
  );
}

export function Faq({ items }: { items: [string, string][] }) {
  return (
    <div className="mx-auto max-w-2xl divide-y divide-border rounded-xl border border-border bg-card">
      {items.map(([q, a]) => (
        <details key={q} className="group px-5 py-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
            {q}
            <span className="text-muted-foreground transition-transform group-open:rotate-45">+</span>
          </summary>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{a}</p>
        </details>
      ))}
    </div>
  );
}
