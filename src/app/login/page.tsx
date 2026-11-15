"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Loader2, LogIn, ScanLine, ShieldCheck } from "lucide-react";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IS_DEMO, SWAG_NAME } from "@/lib/config";

export default function LoginPage() {
  const { actor, refresh, error: authError } = useAuth();
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [info, setInfo] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (actor) router.replace(actor.role === "organizer" ? "/admin" : "/scan");
  }, [actor, router]);

  const [counters, setCounters] = React.useState<{ enabled: boolean; counters: string[]; codeRequired: boolean } | null>(null);
  const [code, setCode] = React.useState("");
  const [orgOpen, setOrgOpen] = React.useState(false);

  React.useEffect(() => {
    fetch("/api/volunteer/session", { cache: "no-store" })
      .then((r) => r.json())
      .then(setCounters)
      .catch(() => setCounters({ enabled: false, counters: [], codeRequired: false }));
  }, []);

  async function counterLogin(counter: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/volunteer/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ counter, ...(counters?.codeRequired ? { code } : {}) }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error?.message ?? "Could not start the counter.");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function demoLogin(uid: string) {
    setBusy(true);
    await fetch("/api/demo/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uid }) });
    await refresh();
    setBusy(false);
  }

  async function withSupabase(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      const m = (e as Error).message ?? "";
      setError(/invalid login credentials/i.test(m) ? "Email or password is incorrect." : /rate limit|too many/i.test(m) ? "Too many attempts. Wait a minute and try again." : m);
    } finally {
      setBusy(false);
    }
  }
  const sb = async () => (await import("@/lib/client/supabase")).supabaseBrowser();

  const emailLogin = (e: React.FormEvent) => {
    e.preventDefault();
    void withSupabase(async () => {
      const { error } = await (await sb()).auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
    });
  };
  const googleLogin = () =>
    withSupabase(async () => {
      const { error } = await (await sb()).auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}/login` } });
      if (error) throw error;
    });
  const reset = () =>
    withSupabase(async () => {
      if (!email.trim()) throw new Error("Enter your email first.");
      const { error } = await (await sb()).auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/reset-password` });
      if (error) throw error;
      setInfo("If that email belongs to a staff account, a password link was sent.");
    });

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-4">
      <div className="flex items-center justify-between">
        <Brand sub="Swag distribution" />
        <ThemeToggle />
      </div>
      {(authError || error) && (
        <p role="alert" className="rounded-md bg-bad p-3 text-sm font-medium text-bad-fg">
          {authError ?? error}
        </p>
      )}
      {info && <p className="rounded-md bg-muted p-3 text-sm">{info}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Volunteers: tap your counter</CardTitle>
          <CardDescription>No sign-in needed. One {SWAG_NAME} per registered attendee.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!counters && <Loader2 className="mx-auto h-6 w-6 animate-spin" aria-label="Loading counters" />}
          {counters && !counters.enabled && <p className="text-sm text-muted-foreground">Counter sign-in is turned off. Ask an organizer.</p>}
          {counters?.enabled && counters.codeRequired && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="code">Counter code (from your organizer)</Label>
              <Input id="code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" inputMode="text" className="h-12 text-lg tracking-widest" />
            </div>
          )}
          {counters?.enabled &&
            counters.counters.map((c, i) => (
              <Button key={c} size="xl" className="h-16 w-full" variant={i % 2 ? "outline" : "default"} onClick={() => counterLogin(c)} disabled={busy || (counters.codeRequired && code.trim().length < 4)}>
                <ScanLine /> {c}
              </Button>
            ))}
        </CardContent>
      </Card>

      <Card>
        <button
          className="flex w-full items-center justify-between p-5 text-left font-semibold"
          onClick={() => setOrgOpen((o) => !o)}
          aria-expanded={orgOpen}
        >
          <span className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" /> Organizer sign in
          </span>
          <ChevronDown className={`h-5 w-5 transition-transform ${orgOpen ? "rotate-180" : ""}`} />
        </button>
        {orgOpen && (
          <CardContent className="flex flex-col gap-3">
            {IS_DEMO ? (
              <>
                <p className="text-sm text-muted-foreground">Demo mode: fictional organizer, no real data.</p>
                <Button size="lg" variant="secondary" onClick={() => demoLogin("demo-organizer")} disabled={busy}>
                  <ShieldCheck /> Organizer (demo)
                </Button>
              </>
            ) : (
              <>
                <form onSubmit={emailLogin} className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required className="h-12" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="password">Password</Label>
                    <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required className="h-12" />
                  </div>
                  <Button size="lg" type="submit" disabled={busy}>
                    {busy ? <Loader2 className="animate-spin" /> : <LogIn />} Sign in
                  </Button>
                </form>
                <Button size="lg" variant="outline" onClick={googleLogin} disabled={busy}>
                  Continue with Google
                </Button>
                <Button variant="link" size="sm" onClick={reset} disabled={busy}>
                  Set or reset password
                </Button>
              </>
            )}
          </CardContent>
        )}
      </Card>
    </main>
  );
}
