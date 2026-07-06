"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Plane, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

const DEMO_ACCOUNTS = [
  { email: "admin@aerops.demo", label: "School Admin" },
  { email: "dispatch@aerops.demo", label: "Dispatcher" },
  { email: "sarah.cfi@aerops.demo", label: "Instructor" },
  { email: "student@aerops.demo", label: "Student" },
  { email: "maintenance@aerops.demo", label: "Maintenance" },
  { email: "accounting@aerops.demo", label: "Accountant" },
];

function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("admin@aerops.demo");
  const [password, setPassword] = useState("demo1234");
  const [totp, setTotp] = useState("");
  const [mfaStep, setMfaStep] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e?: React.FormEvent, overrideEmail?: string) {
    e?.preventDefault();
    setLoading(true);
    setError(null);
    const effectiveEmail = overrideEmail ?? email;
    const effectivePassword = overrideEmail ? "demo1234" : password;

    // Pre-flight: is a second factor required for this account?
    if (!mfaStep) {
      const check = await fetch("/api/auth/mfa-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: effectiveEmail, password: effectivePassword }),
      }).then((r) => r.json()).catch(() => ({ ok: false }));
      if (check.ok && check.mfaRequired) {
        setEmail(effectiveEmail);
        setPassword(effectivePassword);
        setMfaStep(true);
        setLoading(false);
        return;
      }
    }

    const res = await signIn("credentials", {
      email: effectiveEmail,
      password: effectivePassword,
      totp: totp || undefined,
      redirect: false,
    });
    setLoading(false);
    if (res?.error) {
      setError(mfaStep ? "That code didn't match — try again." : "Invalid email or password.");
    } else {
      router.push(params.get("callbackUrl") ?? "/dashboard");
      router.refresh();
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm animate-fade-up">
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
            <Plane className="h-6 w-6 -rotate-45" />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-semibold tracking-tight">Welcome to AeroOps</h1>
            <p className="mt-1 text-sm text-muted-foreground">The operating system for flight schools</p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-3 rounded-xl border border-border bg-card p-6 shadow-sm">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </div>
          {mfaStep && (
            <div className="space-y-1.5">
              <Label htmlFor="totp">Authenticator code</Label>
              <Input
                id="totp"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123 456"
                value={totp}
                onChange={(e) => setTotp(e.target.value)}
                autoFocus
                required
              />
              <p className="text-[11px] text-muted-foreground">Two-factor authentication is enabled for this account.</p>
            </div>
          )}
          {error && <p className="text-xs font-medium text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />} {mfaStep ? "Verify & sign in" : "Sign in"}
          </Button>
          <p className="text-center text-[11px] text-muted-foreground">MFA enrollment and password changes live in Settings → Security once signed in.</p>
        </form>

        <div className="mt-6">
          <p className="mb-2 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Demo accounts · password demo1234</p>
          <div className="grid grid-cols-3 gap-1.5">
            {DEMO_ACCOUNTS.map((a) => (
              <button
                key={a.email}
                onClick={() => submit(undefined, a.email)}
                className="cursor-pointer rounded-lg border border-border bg-card px-2 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}
