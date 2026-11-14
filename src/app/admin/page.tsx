"use client";
import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Download, Loader2, Search, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDashboard, type DashAttendee } from "@/hooks/use-dashboard";
import { api, newIdempotencyKey } from "@/lib/client/api";
import type { ClaimResult } from "@/lib/domain/types";
import { fmtTime, timeAgo } from "@/lib/utils";

export default function AdminDashboard() {
  const { data, error, reload, updatedAt } = useDashboard();
  const [q, setQ] = React.useState("");
  const [filter, setFilter] = React.useState<"all" | "collected" | "waiting" | "ineligible">("all");
  const [selected, setSelected] = React.useState<DashAttendee | null>(null);
  const [limit, setLimit] = React.useState(100);

  const rows = React.useMemo(() => {
    if (!data) return [];
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return data.attendees.filter((a) => {
      if (filter === "collected" && !a.claim) return false;
      if (filter === "waiting" && (a.claim || !a.eligible)) return false;
      if (filter === "ineligible" && a.eligible) return false;
      if (!terms.length) return true;
      const hay = `${a.firstName} ${a.lastName} ${a.email} ${a.ticketNumber} ${a.barcodeId ?? ""}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }, [data, q, filter]);

  // Keep the open dialog in sync with live data.
  const selectedLive = selected && data ? (data.attendees.find((a) => a.ticketNumber === selected.ticketNumber) ?? selected) : selected;

  if (error && !data) return <p className="rounded-lg bg-bad p-4 text-bad-fg">{error}</p>;
  if (!data)
    return (
      <div className="flex justify-center p-10">
        <Loader2 className="h-8 w-8 animate-spin" aria-label="Loading" />
      </div>
    );

  const t = data.totals;
  const pct = t.eligible ? Math.round((t.distributed / t.eligible) * 100) : 0;
  const invPct = t.initialInventory + t.adjustments > 0 ? Math.round((t.bagsOut / (t.initialInventory + t.adjustments)) * 100) : 0;

  return (
    <>
      {!data.settings.barcode.validated && (
        <Link href="/admin/validate" className="flex items-center gap-3 rounded-lg bg-warn p-4 font-semibold text-warn-fg">
          <ShieldAlert className="h-5 w-5 shrink-0" /> Barcode format is not validated yet — volunteers cannot claim by scanning. Validate with real barcodes →
        </Link>
      )}
      {t.registered === 0 && (
        <Link href="/admin/import" className="flex items-center gap-3 rounded-lg bg-g-blue p-4 font-semibold text-white">
          No attendees yet. Import the Bevy CSV →
        </Link>
      )}
      {t.remaining <= 10 && t.initialInventory > 0 && (
        <div role="alert" className="flex items-center gap-3 rounded-lg bg-bad p-4 font-semibold text-bad-fg">
          <AlertTriangle className="h-5 w-5" /> {t.remaining === 0 ? "Inventory exhausted — distribution is blocked." : `Only ${t.remaining} bags remaining.`}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="Registered" value={t.registered} color="bg-g-blue" />
        <Stat label="Eligible" value={t.eligible} color="bg-g-green" />
        <Stat label="Distributed" value={t.distributed} color="bg-g-red" />
        <Stat label="Bags remaining" value={t.remaining} color="bg-g-yellow" />
        <Stat label="Not yet collected" value={t.eligibleNotCollected} color="bg-g-blue" />
        <Stat label="Initial inventory" value={t.initialInventory + t.adjustments} sub={t.adjustments ? `${t.initialInventory} ${t.adjustments >= 0 ? "+" : ""}${t.adjustments} adj.` : undefined} color="bg-g-green" />
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Distribution progress</CardTitle>
          <span className="text-xs text-muted-foreground">Live · updated {updatedAt?.toLocaleTimeString()}</span>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Bar label={`Eligible attendees served: ${t.distributed} / ${t.eligible}`} pct={pct} color="bg-g-green" />
          <Bar label={`Inventory used: ${t.bagsOut} / ${t.initialInventory + t.adjustments}`} pct={invPct} color="bg-g-blue" />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Counter activity</CardTitle>
          </CardHeader>
          <CardContent>
            <Tally data={data.byCounter} empty="No claims yet." />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Volunteer activity</CardTitle>
          </CardHeader>
          <CardContent>
            <Tally data={data.byVolunteer} empty="No claims yet." />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recent claims</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto text-sm">
              {data.recent.length === 0 && <li className="text-muted-foreground">Nothing yet.</li>}
              {data.recent.slice(0, 25).map((e) => (
                <li key={e.id} className="flex items-start gap-2">
                  <Badge variant={e.type === "claim" ? "ok" : e.type === "claim_denied" ? "bad" : "warn"} className="shrink-0">
                    {e.type === "claim" ? "claimed" : e.type === "claim_denied" ? "denied" : "reversed"}
                  </Badge>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{String(e.details?.attendeeName ?? e.ticketNumber)}</span>
                    <span className="block text-xs text-muted-foreground">
                      {e.counter} · {e.actor.name} · {timeAgo(e.at)}
                      {e.type === "claim_denied" ? ` · ${String(e.details?.status)}` : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Attendees</CardTitle>
            <CardDescription>Search by name, email, full ticket number or barcode identifier. Click a row for manual claim, reversal or eligibility.</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href="/api/admin/export?kind=attendees" onClick={exportClick("attendees")}>
                <Download /> Attendees CSV
              </a>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href="/api/admin/export?kind=events" onClick={exportClick("events")}>
                <Download /> Audit CSV
              </a>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search attendees…" className="pl-9" aria-label="Search attendees" />
            </div>
            <div className="flex gap-1 overflow-x-auto">
              {(["all", "waiting", "collected", "ineligible"] as const).map((f) => (
                <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)}>
                  {f === "waiting" ? "Not collected" : f[0].toUpperCase() + f.slice(1)}
                </Button>
              ))}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{rows.length} matching</p>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="p-2">Name</th>
                  <th className="p-2">Ticket</th>
                  <th className="hidden p-2 md:table-cell">Type</th>
                  <th className="p-2">Status</th>
                  <th className="hidden p-2 lg:table-cell">Collected</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, limit).map((a) => (
                  <tr key={a.ticketNumber} className="cursor-pointer border-t hover:bg-muted/60" onClick={() => setSelected(a)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setSelected(a)}>
                    <td className="p-2">
                      <span className="font-medium">
                        {a.firstName} {a.lastName}
                      </span>
                      <span className="block text-xs text-muted-foreground">{a.email}</span>
                    </td>
                    <td className="p-2 font-mono text-xs">{a.ticketNumber}</td>
                    <td className="hidden p-2 md:table-cell">{a.ticketTitle}</td>
                    <td className="p-2">
                      <StatusBadge a={a} />
                    </td>
                    <td className="hidden p-2 text-xs lg:table-cell">{a.claim ? `${fmtTime(a.claim.claimedAt)} · ${a.claim.counter}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > limit && (
            <Button variant="outline" onClick={() => setLimit((l) => l + 200)}>
              Show more ({rows.length - limit} hidden)
            </Button>
          )}
        </CardContent>
      </Card>

      <AttendeeDialog a={selectedLive} onClose={() => setSelected(null)} onChanged={reload} />
    </>
  );
}

/** Exports need the auth header in production, so download via fetch rather than navigation. */
function exportClick(kind: string) {
  return async (e: React.MouseEvent) => {
    e.preventDefault();
    const csv = await api<string>(`/api/admin/export?kind=${kind}`);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `swag-${kind}-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
}

function StatusBadge({ a }: { a: DashAttendee }) {
  if (a.claim) return <Badge variant="bad">Collected</Badge>;
  if (!a.eligible) return <Badge variant="neutral">Ineligible</Badge>;
  return <Badge variant="ok">Eligible</Badge>;
}

function Stat({ label, value, sub, color }: { label: string; value: number; sub?: string; color: string }) {
  return (
    <Card className="overflow-hidden">
      <div className={`h-1 ${color}`} />
      <CardContent className="p-4">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="text-3xl font-bold tabular-nums">{value}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function Bar({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span>{label}</span>
        <span className="font-semibold tabular-nums">{pct}%</span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className={`h-full ${color} transition-all`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}

function Tally({ data, empty }: { data: Record<string, number>; empty: string }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  if (!entries.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {entries.map(([k, v]) => (
        <li key={k}>
          <div className="flex justify-between">
            <span className="truncate">{k}</span>
            <span className="font-semibold tabular-nums">{v}</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-muted">
            <div className="h-full rounded-full bg-g-blue" style={{ width: `${(v / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function AttendeeDialog({ a, onClose, onChanged }: { a: DashAttendee | null; onClose: () => void; onChanged: () => void }) {
  const [mode, setMode] = React.useState<"view" | "reverse" | "override">("view");
  const [reason, setReason] = React.useState("");
  const [bagReturned, setBagReturned] = React.useState<boolean | null>(null);
  const [confirmText, setConfirmText] = React.useState("");
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const claimKey = React.useRef(newIdempotencyKey());

  React.useEffect(() => {
    setMode("view");
    setReason("");
    setBagReturned(null);
    setConfirmText("");
    setMsg(null);
    claimKey.current = newIdempotencyKey();
  }, [a?.ticketNumber]);

  if (!a) return null;

  async function run(fn: () => Promise<string>) {
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ ok: true, text: await fn() });
      setMode("view");
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const manualClaim = () =>
    run(async () => {
      const r = await api<ClaimResult>("/api/claims", { body: { ticketNumber: a.ticketNumber, idempotencyKey: claimKey.current, counter: "Organizer desk", method: "manual", nameVerified: true } });
      claimKey.current = newIdempotencyKey();
      if (r.status !== "SUCCESS") throw new Error(r.message);
      return "Distribution recorded. Hand over ONE bag.";
    });

  const reverse = () =>
    run(async () => {
      await api("/api/admin/claims/reverse", { body: { ticketNumber: a.ticketNumber, claimId: a.claim!.claimId, reason, bagReturned, confirm: true } });
      return bagReturned ? "Claim reversed and bag returned to inventory." : "Claim reversed. Inventory unchanged (bag not returned).";
    });

  const override = (value: "eligible" | "ineligible" | null) =>
    run(async () => {
      await api("/api/admin/eligibility", { body: { ticketNumber: a.ticketNumber, value, reason } });
      return "Eligibility updated.";
    });

  return (
    <Dialog open={!!a} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {a.firstName} {a.lastName}
          </DialogTitle>
          <DialogDescription className="font-mono">{a.ticketNumber}</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Email</dt>
          <dd className="break-all">{a.email}</dd>
          <dt className="text-muted-foreground">Order</dt>
          <dd>{a.orderNumber}</dd>
          <dt className="text-muted-foreground">Ticket type</dt>
          <dd>{a.ticketTitle}</dd>
          <dt className="text-muted-foreground">Barcode id</dt>
          <dd className="font-mono">{a.barcodeId ?? "— (manual only)"}</dd>
          <dt className="text-muted-foreground">Bevy check-in</dt>
          <dd>{a.checkinDateUtc ?? "—"}</dd>
          <dt className="text-muted-foreground">Eligibility</dt>
          <dd>
            {a.eligible ? "Eligible" : "Ineligible"} · {a.eligibilityReason}
          </dd>
          {!a.inLatestImport && (
            <>
              <dt className="text-muted-foreground">Import</dt>
              <dd className="font-semibold text-destructive">Missing from latest Bevy CSV</dd>
            </>
          )}
          <dt className="text-muted-foreground">Swag</dt>
          <dd>{a.claim ? `Collected ${fmtTime(a.claim.claimedAt)} at ${a.claim.counter} by ${a.claim.claimedByName} (${a.claim.method})` : "Not collected"}</dd>
          {a.lastReversal && (
            <>
              <dt className="text-muted-foreground">Last reversal</dt>
              <dd>
                {fmtTime(a.lastReversal.reversedAt)} by {a.lastReversal.reversedBy.name}: “{a.lastReversal.reason}” {a.lastReversal.bagReturned ? "(bag returned)" : "(bag kept)"}
              </dd>
            </>
          )}
        </dl>

        {msg && <p className={`rounded-md p-3 text-sm font-medium ${msg.ok ? "bg-ok text-ok-fg" : "bg-bad text-bad-fg"}`}>{msg.text}</p>}

        {mode === "reverse" && a.claim && (
          <div className="flex flex-col gap-3 rounded-lg border-2 border-destructive p-3">
            <p className="text-sm font-semibold">Reverse this claim. The original claim stays in the audit history.</p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rev-reason">Reason (required)</Label>
              <Textarea id="rev-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Volunteer scanned the wrong attendee's badge" />
            </div>
            <fieldset className="flex flex-col gap-2 text-sm">
              <legend className="mb-1 font-medium">Was the physical bag returned / never handed over?</legend>
              <label className="flex items-center gap-2">
                <input type="radio" name="bag" checked={bagReturned === true} onChange={() => setBagReturned(true)} /> Yes — put it back in inventory
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="bag" checked={bagReturned === false} onChange={() => setBagReturned(false)} /> No — the bag is gone; don&apos;t restore inventory
              </label>
            </fieldset>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rev-confirm">Type REVERSE to confirm</Label>
              <Input id="rev-confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
            </div>
            <Button variant="destructive" disabled={busy || reason.trim().length < 5 || bagReturned === null || confirmText !== "REVERSE"} onClick={reverse}>
              {busy && <Loader2 className="animate-spin" />} Reverse claim
            </Button>
          </div>
        )}

        {mode === "override" && (
          <div className="flex flex-col gap-3 rounded-lg border p-3">
            <Label htmlFor="ov-reason">Reason (required)</Label>
            <Textarea id="ov-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Speaker added late; approved by lead organizer" />
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy || reason.trim().length < 3} onClick={() => override("eligible")}>
                Mark eligible
              </Button>
              <Button variant="secondary" disabled={busy || reason.trim().length < 3} onClick={() => override("ineligible")}>
                Mark ineligible
              </Button>
              {a.override && (
                <Button variant="outline" disabled={busy || reason.trim().length < 3} onClick={() => override(null)}>
                  Clear override (use rules)
                </Button>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          {mode === "view" && (
            <>
              <Button variant="outline" onClick={() => setMode("override")}>
                Change eligibility
              </Button>
              {a.claim ? (
                <Button variant="destructive" onClick={() => setMode("reverse")}>
                  Reverse claim…
                </Button>
              ) : (
                <Button onClick={manualClaim} disabled={busy || !a.eligible}>
                  {busy && <Loader2 className="animate-spin" />} Manual claim (ID checked)
                </Button>
              )}
            </>
          )}
          {mode !== "view" && (
            <Button variant="ghost" onClick={() => setMode("view")}>
              Back
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
