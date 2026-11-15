"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, ScanLine } from "lucide-react";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SWAG_NAME } from "@/lib/config";

/** Volunteer entry: tap a counter. Organizers use any /admin link instead. */
export default function LoginPage() {
  const { actor, refresh } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [counters, setCounters] = React.useState<{ enabled: boolean; counters: string[]; codeRequired: boolean } | null>(null);
  const [code, setCode] = React.useState("");

  React.useEffect(() => {
    if (actor) router.replace(actor.role === "organizer" ? "/admin" : "/scan");
  }, [actor, router]);

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

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-4">
      <div className="flex items-center justify-between">
        <Brand sub="Swag distribution" />
        <ThemeToggle />
      </div>
      {error && (
        <p role="alert" className="rounded-md bg-bad p-3 text-sm font-medium text-bad-fg">
          {error}
        </p>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Volunteers: tap your counter</CardTitle>
          <CardDescription>One {SWAG_NAME} per registered attendee.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!counters && <Loader2 className="mx-auto h-6 w-6 animate-spin" aria-label="Loading counters" />}
          {counters && !counters.enabled && <p className="text-sm text-muted-foreground">Counter sign-in is turned off. Ask an organizer.</p>}
          {counters?.enabled && counters.codeRequired && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="code">Counter code (from your organizer)</Label>
              <Input id="code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" className="h-12 text-lg tracking-widest" />
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
    </main>
  );
}
