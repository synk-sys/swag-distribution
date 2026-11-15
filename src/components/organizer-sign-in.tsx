"use client";
import * as React from "react";
import { Loader2, LogIn, ShieldCheck } from "lucide-react";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IS_DEMO } from "@/lib/config";

/** Organizer sign-in, shown on any /admin link when not signed in as an organizer. */
export function OrganizerSignIn() {
  const { actor, refresh, error: authError, signOut } = useAuth();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [info, setInfo] = React.useState<string | null>(null);

  // A counter device signing in as organizer should stop being a counter.
  const dropCounter = () => fetch("/api/volunteer/session", { method: "DELETE" });

  async function run(fn: () => Promise<void>) {
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
    void run(async () => {
      await dropCounter();
      const { error } = await (await sb()).auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      await refresh();
    });
  };
  const googleLogin = () =>
    run(async () => {
      await dropCounter();
      const { error } = await (await sb()).auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.href } });
      if (error) throw error;
    });
  const reset = () =>
    run(async () => {
      if (!email.trim()) throw new Error("Enter your email first.");
      const { error } = await (await sb()).auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/reset-password` });
      if (error) throw error;
      setInfo("If that email belongs to an organizer account, a password link was sent.");
    });
  const demoLogin = () =>
    run(async () => {
      await dropCounter();
      await fetch("/api/demo/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uid: "demo-organizer" }) });
      await refresh();
    });

  const shownError = error ?? (actor ? null : authError);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-4">
      <div className="flex items-center justify-between">
        <Brand sub="Organizer" />
        <ThemeToggle />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <ShieldCheck className="h-5 w-5" /> Organizer sign in
          </CardTitle>
          <CardDescription>
            {actor ? `This device is open as ${actor.name}. Sign in with an organizer account to continue.` : "Dashboard, CSV import, inventory and corrections."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {shownError && (
            <p role="alert" className="rounded-md bg-bad p-3 text-sm font-medium text-bad-fg">
              {shownError}
            </p>
          )}
          {info && <p className="rounded-md bg-muted p-3 text-sm">{info}</p>}
          {IS_DEMO ? (
            <>
              <p className="text-sm text-muted-foreground">Demo mode: fictional organizer, no real data.</p>
              <Button size="lg" onClick={demoLogin} disabled={busy}>
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
          {actor && (
            <Button variant="ghost" size="sm" onClick={signOut}>
              Leave {actor.name} and go to the counter screen
            </Button>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
