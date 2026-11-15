"use client";
import * as React from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CounterAccessCard } from "@/components/counter-access-card";
import { useDashboard } from "@/hooks/use-dashboard";
import { api } from "@/lib/client/api";
import { SWAG_NAME } from "@/lib/config";
import type { EligibilitySettings } from "@/lib/domain/types";

export default function SettingsPage() {
  const { data, reload } = useDashboard();
  const [initial, setInitial] = React.useState("");
  const [delta, setDelta] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [elig, setElig] = React.useState<EligibilitySettings | null>(null);
  const [nameCheck, setNameCheck] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (data && !elig) {
      setElig(data.settings.eligibility);
      setNameCheck(data.settings.verification.requireNameCheck);
      setInitial(String(data.totals.initialInventory));
    }
  }, [data, elig]);

  const titles = React.useMemo(() => [...new Set((data?.attendees ?? []).map((a) => a.ticketTitle))].sort(), [data]);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
      await reload();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (!data || !elig)
    return (
      <div className="flex justify-center p-10">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  const t = data.totals;

  return (
    <>
      {msg && <p role="status" className={`rounded-md p-3 text-sm font-medium ${msg.ok ? "bg-ok text-ok-fg" : "bg-bad text-bad-fg"}`}>{msg.text}</p>}
      <Card>
        <CardHeader>
          <CardTitle>Inventory · {SWAG_NAME}</CardTitle>
          <CardDescription>
            Initial {t.initialInventory} {t.adjustments ? `(${t.adjustments >= 0 ? "+" : ""}${t.adjustments} adjustments)` : ""} · {t.bagsOut} handed out · <strong>{t.remaining} remaining</strong>. Every change is recorded in the audit log.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => api("/api/admin/inventory", { body: { kind: "set_initial", value: Number(initial) } }), "Initial inventory saved.");
            }}
          >
            <Label htmlFor="initial">Initial number of bags</Label>
            <div className="flex gap-2">
              <Input id="initial" type="number" min={0} value={initial} onChange={(e) => setInitial(e.target.value)} />
              <Button type="submit" disabled={busy}>
                Set
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Use this once before doors open (e.g. 300).</p>
          </form>
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await api("/api/admin/inventory", { body: { kind: "adjust", delta: Number(delta), reason } });
                setDelta("");
                setReason("");
              }, "Inventory adjusted.");
            }}
          >
            <Label htmlFor="delta">Adjust (+ found more, − damaged/miscounted)</Label>
            <div className="flex gap-2">
              <Input id="delta" type="number" value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="e.g. 25 or -3" className="w-32" />
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" aria-label="Adjustment reason" />
            </div>
            <Button type="submit" variant="outline" disabled={busy || !delta || Number(delta) === 0 || reason.trim().length < 3}>
              Record adjustment
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Eligibility rules</CardTitle>
          <CardDescription>Explicit and configurable. An empty Bevy check-in date does not make anyone ineligible unless you turn that on. Per-attendee overrides are set from the dashboard.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2 text-sm">
            <legend className="mb-1 font-medium">Who is eligible?</legend>
            <label className="flex items-center gap-2">
              <input type="radio" checked={elig.mode === "all"} onChange={() => setElig({ ...elig, mode: "all" })} /> Every registration
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={elig.mode === "allowlist"} onChange={() => setElig({ ...elig, mode: "allowlist" })} /> Only selected ticket types
            </label>
          </fieldset>
          {elig.mode === "allowlist" && (
            <div className="flex flex-col gap-1 rounded-lg border p-3 text-sm">
              {titles.length === 0 && <p className="text-muted-foreground">Import attendees to see ticket types.</p>}
              {titles.map((title) => (
                <label key={title} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={elig.allowedTicketTitles.includes(title)}
                    onChange={(e) =>
                      setElig({ ...elig, allowedTicketTitles: e.target.checked ? [...elig.allowedTicketTitles, title] : elig.allowedTicketTitles.filter((x) => x !== title) })
                    }
                  />
                  {title || "(blank)"} <span className="text-muted-foreground">({data.attendees.filter((a) => a.ticketTitle === title).length})</span>
                </label>
              ))}
            </div>
          )}
          <label className="flex items-center justify-between gap-4 text-sm">
            <span>Require a Bevy check-in date</span>
            <Switch checked={elig.requireCheckin} onCheckedChange={(v) => setElig({ ...elig, requireCheckin: v })} />
          </label>
          <label className="flex items-center justify-between gap-4 text-sm">
            <span>Registrations missing from the latest CSV are ineligible</span>
            <Switch checked={elig.excludeRemovedRegistrations} onCheckedChange={(v) => setElig({ ...elig, excludeRemovedRegistrations: v })} />
          </label>
          <Button className="self-start" disabled={busy} onClick={() => run(() => api("/api/admin/settings", { method: "PUT", body: { eligibility: elig } }), "Eligibility rules saved.")}>
            Save eligibility rules
          </Button>
        </CardContent>
      </Card>

      <CounterAccessCard />

      <Card>
        <CardHeader>
          <CardTitle>Anti-sharing check</CardTitle>
          <CardDescription>A barcode is a lookup credential, not proof of identity. When on, volunteers must tick “name matches badge / ID” before confirming.</CardDescription>
        </CardHeader>
        <CardContent>
          <label className="flex items-center justify-between gap-4 text-sm">
            <span>Require name verification at the counter</span>
            <Switch
              checked={nameCheck}
              onCheckedChange={(v) => {
                setNameCheck(v);
                void run(() => api("/api/admin/settings", { method: "PUT", body: { verification: { requireNameCheck: v } } }), v ? "Name check required." : "Name check off.");
              }}
            />
          </label>
        </CardContent>
      </Card>
    </>
  );
}
