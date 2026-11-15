"use client";
import * as React from "react";
import { LogOut } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/client/api";

interface Access {
  enabled: boolean;
  counters: string[];
  codeRequired: boolean;
  epoch: number;
}

/** Organizer controls for one-tap (no sign-in) volunteer counters. */
export function CounterAccessCard() {
  const [a, setA] = React.useState<Access | null>(null);
  const [counters, setCounters] = React.useState("");
  const [code, setCode] = React.useState("");
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    void api<Access>("/api/admin/volunteer-access").then((r) => {
      setA(r);
      setCounters(r.counters.join(", "));
    });
  }, []);

  async function save(body: Record<string, unknown>, ok: string) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<Access>("/api/admin/volunteer-access", { body });
      setA(r);
      setCounters(r.counters.join(", "));
      setMsg({ ok: true, text: ok });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (!a) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Volunteer counters {a.enabled ? <Badge variant="ok">On</Badge> : <Badge variant="neutral">Off</Badge>}
          {a.enabled && !a.codeRequired && <Badge variant="warn">No code</Badge>}
        </CardTitle>
        <CardDescription>
          Volunteers tap a counter on the login screen. No account is needed. Anyone with the app link can do the same, so set a counter code for the event and share it only with volunteers.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {msg && <p role="status" className={`rounded-md p-3 text-sm font-medium ${msg.ok ? "bg-ok text-ok-fg" : "bg-bad text-bad-fg"}`}>{msg.text}</p>}
        <label className="flex items-center justify-between gap-4 text-sm">
          <span>Allow one-tap counter sign-in</span>
          <Switch checked={a.enabled} disabled={busy} onCheckedChange={(v) => save({ enabled: v }, v ? "Counter sign-in turned on." : "Counter sign-in turned off. Counter devices are blocked.")} />
        </label>

        <form
          className="flex flex-col gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            const list = counters.split(",").map((c) => c.trim()).filter(Boolean);
            void save({ counters: list }, "Counters saved.");
          }}
        >
          <Label htmlFor="counters">Counters shown on the login screen (comma separated)</Label>
          <div className="flex gap-2">
            <Input id="counters" value={counters} onChange={(e) => setCounters(e.target.value)} placeholder="Counter A, Counter B" />
            <Button type="submit" variant="outline" disabled={busy}>
              Save
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Removing a counter signs out the devices using it.</p>
        </form>

        <form
          className="flex flex-col gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            void save({ code }, "Counter code set. All counter devices were signed out and must enter the new code.").then(() => setCode(""));
          }}
        >
          <Label htmlFor="ccode">Counter code {a.codeRequired ? "(a code is set)" : "(none, so anyone with the link can open a counter)"}</Label>
          <div className="flex gap-2">
            <Input id="ccode" value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. DEVFEST26" autoComplete="off" />
            <Button type="submit" disabled={busy || code.trim().length < 4}>
              {a.codeRequired ? "Change" : "Set"}
            </Button>
          </div>
          {a.codeRequired && (
            <Button type="button" variant="link" size="sm" className="self-start px-0" disabled={busy} onClick={() => save({ code: null }, "Counter code removed.")}>
              Remove code
            </Button>
          )}
        </form>

        <Button
          variant="destructive"
          className="self-start"
          disabled={busy}
          onClick={() => confirm("Sign out every counter device now? Volunteers will need to tap their counter again.") && save({ signOutAll: true }, "All counter devices signed out.")}
        >
          <LogOut /> Sign out all counter devices
        </Button>
      </CardContent>
    </Card>
  );
}
