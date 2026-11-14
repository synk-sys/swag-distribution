"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogIn, ScanLine, ShieldCheck } from "lucide-react";
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

  async function demoLogin(uid: string) {
    setBusy(true);
    await fetch("/api/demo/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uid }) });
    if (uid === "demo-vol-b") localStorage.setItem("swag.counter", "Counter B");
    if (uid === "demo-vol-a") localStorage.setItem("swag.counter", "Counter A");
    await refresh();
    setBusy(false);
  }

  async function withFirebase(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      const code = (e as { code?: string }).code ?? "";
      setError(
        code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")
          ? "Email or password is incorrect."
          : code.includes("too-many-requests")
            ? "Too many attempts. Wait a minute and try again."
            : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }

  const emailLogin = (e: React.FormEvent) => {
    e.preventDefault();
    void withFirebase(async () => {
      const { clientAuth } = await import("@/lib/client/firebase");
      const { signInWithEmailAndPassword } = await import("firebase/auth");
      await signInWithEmailAndPassword(clientAuth(), email.trim(), password);
    });
  };
  const googleLogin = () =>
    withFirebase(async () => {
      const { clientAuth } = await import("@/lib/client/firebase");
      const { GoogleAuthProvider, signInWithPopup } = await import("firebase/auth");
      await signInWithPopup(clientAuth(), new GoogleAuthProvider());
    });
  const reset = () =>
    withFirebase(async () => {
      if (!email.trim()) throw new Error("Enter your email first.");
      const { clientAuth } = await import("@/lib/client/firebase");
      const { sendPasswordResetEmail } = await import("firebase/auth");
      await sendPasswordResetEmail(clientAuth(), email.trim());
      setInfo("If that email belongs to a staff account, a password link was sent.");
    });

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-4">
      <div className="flex items-center justify-between">
        <Brand sub="Swag distribution" />
        <ThemeToggle />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Volunteer sign in</CardTitle>
          <CardDescription>One {SWAG_NAME} per registered attendee.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {(authError || error) && (
            <p role="alert" className="rounded-md bg-bad p-3 text-sm font-medium text-bad-fg">
              {authError ?? error}
            </p>
          )}
          {info && <p className="rounded-md bg-muted p-3 text-sm">{info}</p>}
          {IS_DEMO ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">Demo mode: choose a fictional staff identity. No real attendee data is used.</p>
              <Button size="lg" onClick={() => demoLogin("demo-vol-a")} disabled={busy}>
                <ScanLine /> Volunteer · Counter A
              </Button>
              <Button size="lg" variant="outline" onClick={() => demoLogin("demo-vol-b")} disabled={busy}>
                <ScanLine /> Volunteer · Counter B
              </Button>
              <Button size="lg" variant="secondary" onClick={() => demoLogin("demo-organizer")} disabled={busy}>
                <ShieldCheck /> Organizer
              </Button>
            </div>
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
              <p className="text-xs text-muted-foreground">Access is granted by an organizer. Accounts without a role cannot see attendee data.</p>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
