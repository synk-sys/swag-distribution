"use client";
import * as React from "react";
import QRCode from "qrcode";
import { Loader2, QrCode, RotateCcw, Swords, Zap } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { RequireRole } from "@/components/require-role";
import { ScanStation } from "@/components/scan-station";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useLiveVersion } from "@/hooks/use-live";
import { useNetworkStatus } from "@/hooks/use-network";
import { api, newIdempotencyKey } from "@/lib/client/api";
import { IS_DEMO } from "@/lib/config";
import type { ClaimResult } from "@/lib/domain/types";

interface Sample {
  name: string;
  ticketNumber: string;
  ticketTitle: string;
  barcode: string;
  claimed: boolean;
  eligible: boolean;
}
interface Samples {
  samples: Sample[];
  extras: { label: string; barcode: string }[];
}
interface Totals {
  totals: { registered: number; eligible: number; distributed: number; remaining: number; bagsOut: number };
  recent: { id: string; type: string; at: string; actor: { name: string }; counter?: string; ticketNumber?: string; details?: Record<string, unknown> }[];
}

export default function DemoPage() {
  if (!IS_DEMO) return <p className="p-6">Demo mode is disabled in production.</p>;
  return (
    <RequireRole roles={["organizer"]}>
      <Demo />
    </RequireRole>
  );
}

function Demo() {
  const net = useNetworkStatus();
  const live = useLiveVersion();
  const [data, setData] = React.useState<Samples | null>(null);
  const [totals, setTotals] = React.useState<Totals | null>(null);
  const [race, setRace] = React.useState<{ ticket: string; a: ClaimResult; b: ClaimResult; before: number; after: number } | null>(null);
  const [racing, setRacing] = React.useState(false);
  const [showQr, setShowQr] = React.useState(false);
  const injectA = React.useRef<((c: string) => void) | null>(null);
  const injectB = React.useRef<((c: string) => void) | null>(null);

  const load = React.useCallback(async () => {
    const [s, t] = await Promise.all([api<Samples>("/api/demo/samples"), api<Totals>("/api/admin/dashboard")]);
    setData(s);
    setTotals(t);
  }, []);
  React.useEffect(() => void load(), [load, live]);

  async function runRace() {
    const target = data?.samples.find((s) => s.eligible && !s.claimed);
    if (!target) return alert("No unclaimed eligible demo attendees left. Reset the demo.");
    setRacing(true);
    const before = totals?.totals.remaining ?? 0;
    const send = (actor: string, counter: string) =>
      api<ClaimResult>("/api/claims", { body: { ticketNumber: target.ticketNumber, idempotencyKey: newIdempotencyKey(), counter, method: "scan" }, demoActor: actor });
    const [a, b] = await Promise.all([send("demo-vol-a", "Counter A"), send("demo-vol-b", "Counter B")]);
    const t = await api<Totals>("/api/admin/dashboard");
    setTotals(t);
    setRace({ ticket: `${target.name} · ${target.ticketNumber}`, a, b, before, after: t.totals.remaining });
    setRacing(false);
  }

  async function reset() {
    if (!confirm("Reset all demo data to the starting state?")) return;
    await api("/api/demo/reset", { method: "POST", body: {} });
    setRace(null);
    await load();
  }

  return (
    <div className="min-h-dvh">
      <AppHeader sub="Demo · two counters" />
      <main className="mx-auto flex max-w-6xl flex-col gap-4 p-4 pb-16">
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Two simulated volunteer counters</CardTitle>
              <CardDescription>
                Send a simulated Bevy barcode to Counter A, Counter B, or both at once, then tap Confirm on each. Or run the automated race.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={runRace} disabled={racing}>
                {racing ? <Loader2 className="animate-spin" /> : <Swords />} Race: both counters confirm the same attendee
              </Button>
              <Button variant="outline" onClick={reset}>
                <RotateCcw /> Reset demo
              </Button>
            </div>
          </CardHeader>
          {totals && (
            <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Registered" value={totals.totals.registered} />
              <Stat label="Eligible" value={totals.totals.eligible} />
              <Stat label="Distributed" value={totals.totals.distributed} />
              <Stat label="Bags remaining" value={totals.totals.remaining} />
            </CardContent>
          )}
        </Card>

        {race && (
          <Card className="border-2 border-g-blue" role="status">
            <CardHeader>
              <CardTitle>Race result · {race.ticket}</CardTitle>
              <CardDescription>
                Inventory: {race.before} → {race.after} (changed by {race.before - race.after})
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  ["Counter A", race.a],
                  ["Counter B", race.b],
                ] as const
              ).map(([c, r]) => (
                <div key={c} className={`rounded-lg p-4 ${r.status === "SUCCESS" ? "bg-ok text-ok-fg" : "bg-bad text-bad-fg"}`}>
                  <p className="text-sm font-semibold opacity-90">{c}</p>
                  <p className="text-2xl font-black">{r.status === "SUCCESS" ? "SUCCESS" : "ALREADY COLLECTED"}</p>
                  <p>{r.message}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          {(
            [
              ["Counter A", "demo-vol-a", injectA],
              ["Counter B", "demo-vol-b", injectB],
            ] as const
          ).map(([counter, actor, ref]) => (
            <Card key={counter}>
              <CardHeader>
                <CardTitle>
                  {counter} <span className="text-sm font-normal text-muted-foreground">({actor === "demo-vol-a" ? "Victor" : "Vera"}, volunteer)</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScanStation counter={counter} network={net.state} demoActor={actor} camera={false} compact injectRef={ref} />
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>Fictional attendees and simulated Bevy barcodes</CardTitle>
              <CardDescription>Prefix 900001 is a fictional event id. Show QR codes to test real camera scanning on /scan from a phone.</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => setShowQr((v) => !v)}>
              <QrCode /> {showQr ? "Hide" : "Show"} QR codes
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {data?.extras.map((x) => (
              <Row key={x.barcode} title={x.label} code={x.barcode} badge={<Badge variant="warn">edge case</Badge>} onA={() => injectA.current?.(x.barcode)} onB={() => injectB.current?.(x.barcode)} showQr={showQr} />
            ))}
            {data?.samples.map((s) => (
              <Row
                key={s.ticketNumber}
                title={`${s.name} · ${s.ticketTitle}`}
                sub={s.ticketNumber}
                code={s.barcode}
                badge={s.claimed ? <Badge variant="bad">collected</Badge> : !s.eligible ? <Badge variant="neutral">ineligible</Badge> : <Badge variant="ok">eligible</Badge>}
                onA={() => injectA.current?.(s.barcode)}
                onB={() => injectB.current?.(s.barcode)}
                showQr={showQr}
              />
            ))}
          </CardContent>
        </Card>

        {totals && (
          <Card>
            <CardHeader>
              <CardTitle>Live audit (latest)</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-1 text-sm">
                {totals.recent.slice(0, 12).map((e) => (
                  <li key={e.id} className="flex flex-wrap gap-2">
                    <Badge variant={e.type === "claim" ? "ok" : e.type === "claim_denied" ? "bad" : "warn"}>{e.type}</Badge>
                    <span className="font-mono">{e.ticketNumber}</span>
                    <span className="text-muted-foreground">
                      {e.actor.name} · {e.counter} · {new Date(e.at).toLocaleTimeString()}
                      {e.details?.status ? ` · ${String(e.details.status)}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-muted p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

function Row({ title, sub, code, badge, onA, onB, showQr }: { title: string; sub?: string; code: string; badge: React.ReactNode; onA: () => void; onB: () => void; showQr: boolean }) {
  const [qr, setQr] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (showQr && !qr) void QRCode.toDataURL(code, { margin: 1, width: 160 }).then(setQr);
  }, [showQr, qr, code]);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- data: URL QR */}
      {showQr && qr && <img src={qr} alt={`QR code for ${code}`} className="h-28 w-28 rounded bg-white p-1" />}
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          {title} {badge}
        </p>
        <p className="font-mono text-xs text-muted-foreground">
          {code}
          {sub ? ` → ${sub}` : ""}
        </p>
      </div>
      <div className="flex gap-1.5">
        <Button size="sm" variant="outline" onClick={onA}>
          → A
        </Button>
        <Button size="sm" variant="outline" onClick={onB}>
          → B
        </Button>
        <Button
          size="sm"
          onClick={() => {
            onA();
            onB();
          }}
          aria-label="Scan at both counters simultaneously"
        >
          <Zap /> Both
        </Button>
      </div>
    </div>
  );
}
