"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Loader2 } from "lucide-react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IS_DEMO } from "@/lib/config";

/** Landing page for Supabase invite and password-recovery links. */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = React.useState(false);
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (IS_DEMO) return;
    void (async () => {
      const { supabaseBrowser } = await import("@/lib/client/supabase");
      const sb = supabaseBrowser();
      // The invite/recovery link puts a session in the URL; supabase-js picks it up.
      const { data } = await sb.auth.getSession();
      if (data.session) setReady(true);
      sb.auth.onAuthStateChange((_e, session) => session && setReady(true));
    })();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 10) return setError("Use at least 10 characters.");
    if (password !== confirm) return setError("Passwords do not match.");
    setBusy(true);
    setError(null);
    const { supabaseBrowser } = await import("@/lib/client/supabase");
    const { error } = await supabaseBrowser().auth.updateUser({ password });
    setBusy(false);
    if (error) return setError(error.message);
    router.replace("/");
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-4">
      <Brand sub="Swag distribution" />
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Set your password</CardTitle>
          <CardDescription>{ready ? "Choose a password for your staff account." : "Open this page from the link in your invite or password email."}</CardDescription>
        </CardHeader>
        <CardContent>
          {ready && (
            <form onSubmit={submit} className="flex flex-col gap-3">
              {error && <p role="alert" className="rounded-md bg-bad p-3 text-sm font-medium text-bad-fg">{error}</p>}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pw">New password</Label>
                <Input id="pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-12" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pw2">Confirm password</Label>
                <Input id="pw2" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="h-12" />
              </div>
              <Button size="lg" type="submit" disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <KeyRound />} Save password
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
