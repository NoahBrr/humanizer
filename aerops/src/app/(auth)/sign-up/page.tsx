"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { AeroOpsLogoStacked } from "@/components/brand/logo";

/**
 * Public sign-up: creates an individual AeroOps account (no organization),
 * signs the user in, and hands off to /welcome to create or join an
 * organization.
 */
function SignUpForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", password: "", phone: "" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, phone: form.phone || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Sign-up failed.");
      const signin = await signIn("credentials", { email: form.email, password: form.password, redirect: false });
      if (signin?.error) throw new Error("Account created — sign in to continue.");
      router.push(params.get("callbackUrl") ?? "/welcome");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-up failed.");
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm animate-fade-up">
        <div className="mb-8">
          <AeroOpsLogoStacked />
        </div>

        <form onSubmit={submit} className="space-y-3 rounded-xl border border-border bg-card p-6 shadow-sm">
          <p className="text-sm font-semibold">Create your account</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="firstName">First name</Label>
              <Input id="firstName" value={form.firstName} onChange={set("firstName")} autoComplete="given-name" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lastName">Last name</Label>
              <Input id="lastName" value={form.lastName} onChange={set("lastName")} autoComplete="family-name" required />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={form.email} onChange={set("email")} autoComplete="email" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" value={form.password} onChange={set("password")} autoComplete="new-password" required />
            <p className="text-[11px] text-muted-foreground">At least 12 characters with upper/lower case, a number, and a symbol.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">Phone <span className="text-muted-foreground/60">(optional)</span></Label>
            <Input id="phone" type="tel" value={form.phone} onChange={set("phone")} autoComplete="tel" />
          </div>
          {error && <p className="text-xs font-medium text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />} Create account
          </Button>
          <p className="text-center text-[11px] text-muted-foreground">
            After sign-up you can create your organization, join an existing one, or continue as an individual.
          </p>
        </form>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Already have an account?{" "}
          <Link href="/sign-in" className="font-medium text-primary hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}

export default function SignUpPage() {
  return (
    <Suspense>
      <SignUpForm />
    </Suspense>
  );
}
