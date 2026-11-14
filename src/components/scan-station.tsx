"use client";
import * as React from "react";
import { AlertTriangle, CheckCircle2, CircleSlash, Keyboard, Loader2, PackageX, RotateCcw, Search, ShieldAlert, WifiOff, XCircle } from "lucide-react";
import { Scanner } from "@/components/scanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, ApiError, NetworkError, newIdempotencyKey } from "@/lib/client/api";
import { feedback, unlockAudio } from "@/lib/client/feedback";
import type { AttendeeView, ClaimInfoView, ClaimResult, LookupResult } from "@/lib/domain/types";
import { useLiveVersion } from "@/hooks/use-live";
import type { NetState } from "@/hooks/use-network";
import { cn, fmtTime, timeAgo } from "@/lib/utils";

type Source = "scan" | "manual";
type State =
  | { kind: "ready" }
  | { kind: "looking" }
  | { kind: "result"; lookup: LookupResult; source: Source; idemKey: string; nameOk: boolean; error?: string }
  | { kind: "claiming"; lookup: LookupResult; source: Source; idemKey: string; nameOk: boolean }
  | { kind: "claimed"; result: ClaimResult }
  | { kind: "denied"; result: ClaimResult }
  | { kind: "unknown"; lookup: LookupResult; source: Source; idemKey: string; nameOk: boolean; message: string };

interface Props {
  counter: string;
  network: NetState;
  demoActor?: string;
  camera?: boolean;
  compact?: boolean;
  /** Demo page: lets a parent inject a scanned value. */
  injectRef?: React.RefObject<((code: string) => void) | null>;
}

const SUCCESS_HOLD_MS = 2500;

export function ScanStation({ counter, network, demoActor, camera = true, compact = false, injectRef }: Props) {
  const [state, setState] = React.useState<State>({ kind: "ready" });
  const [manualOpen, setManualOpen] = React.useState(false);
  const [typed, setTyped] = React.useState("");
  const busy = React.useRef(false);
  const offline = network === "offline";
  const live = useLiveVersion();

  const reset = React.useCallback(() => {
    busy.current = false;
    setTyped("");
    setState({ kind: "ready" });
  }, []);

  const showLookup = React.useCallback((lookup: LookupResult, source: Source) => {
    feedback(lookup.status === "ELIGIBLE" ? "good" : lookup.status === "ALREADY_COLLECTED" ? "bad" : "warn");
    setState({ kind: "result", lookup, source, idemKey: newIdempotencyKey(), nameOk: false });
  }, []);

  const lookupCode = React.useCallback(
    async (code: string) => {
      if (busy.current) return; // one scan at a time; ignore camera repeats
      busy.current = true;
      feedback("scan");
      setState({ kind: "looking" });
      try {
        const r = await api<LookupResult>("/api/scan/lookup", { body: { code }, demoActor, retries: 2 });
        showLookup(r, "scan");
      } catch (e) {
        busy.current = false;
        feedback("warn");
        setState({
          kind: "denied",
          result: { status: "NOT_FOUND", message: e instanceof NetworkError ? "Network problem — could not check this barcode. Scan again." : (e as Error).message },
        });
      }
    },
    [demoActor, showLookup],
  );

  const lookupTicket = React.useCallback(
    async (ticketNumber: string) => {
      busy.current = true;
      setManualOpen(false);
      setState({ kind: "looking" });
      try {
        showLookup(await api<LookupResult>("/api/attendees/lookup", { body: { ticketNumber }, demoActor, retries: 2 }), "manual");
      } catch (e) {
        setState({ kind: "denied", result: { status: "NOT_FOUND", message: (e as Error).message } });
      }
    },
    [demoActor, showLookup],
  );

  React.useEffect(() => {
    if (injectRef) injectRef.current = (code) => void lookupCode(code);
  }, [injectRef, lookupCode]);

  const confirm = React.useCallback(async () => {
    if (state.kind !== "result" && state.kind !== "unknown") return;
    if (!state.lookup.attendee) return;
    const s = state;
    setState({ ...s, kind: "claiming" });
    try {
      const res = await api<ClaimResult>("/api/claims", {
        body: { ticketNumber: s.lookup.attendee!.ticketNumber, idempotencyKey: s.idemKey, counter, method: s.source, nameVerified: s.nameOk },
        demoActor,
        retries: 4,
      });
      if (res.status === "SUCCESS") {
        feedback("good");
        setState({ kind: "claimed", result: res });
      } else {
        feedback("bad");
        setState({ kind: "denied", result: res });
      }
    } catch (e) {
      feedback("bad");
      if (e instanceof ApiError && e.status < 500 && e.status !== 429) {
        setState({ ...s, kind: "result", error: e.message });
        return;
      }
      // Unknown outcome: we must NOT show success. Retrying reuses the same key, so it is safe.
      setState({ ...s, kind: "unknown", message: e instanceof NetworkError ? e.message : (e as Error).message });
    }
  }, [state, counter, demoActor]);

  // Auto-return to scanning after a recorded claim.
  React.useEffect(() => {
    if (state.kind !== "claimed") return;
    const t = setTimeout(reset, SUCCESS_HOLD_MS);
    return () => clearTimeout(t);
  }, [state.kind, reset]);

  // Real-time: if another counter claims this attendee while we are looking at them, flip to red.
  const shownTicket = state.kind === "result" ? state.lookup.attendee?.ticketNumber : undefined;
  const shownStatus = state.kind === "result" ? state.lookup.status : undefined;
  React.useEffect(() => {
    if (!shownTicket || shownStatus !== "ELIGIBLE" || live === 0) return;
    let stale = false;
    api<LookupResult>("/api/attendees/lookup", { body: { ticketNumber: shownTicket }, demoActor, retries: 0 })
      .then((r) => {
        if (stale || r.status === "ELIGIBLE") return;
        feedback("bad");
        setState((cur) => (cur.kind === "result" && cur.lookup.attendee?.ticketNumber === shownTicket ? { ...cur, lookup: r } : cur));
      })
      .catch(() => undefined);
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  const scanning = state.kind === "ready";

  return (
    <div className={cn("flex flex-col gap-3", compact && "gap-2")} onPointerDown={unlockAudio}>
      {offline && (
        <div role="alert" className="flex items-center gap-2 rounded-lg bg-bad px-4 py-3 font-semibold text-bad-fg">
          <WifiOff className="h-5 w-5" /> OFFLINE — claims cannot be recorded. Do not hand out bags.
        </div>
      )}

      {/* Camera stays mounted so it doesn't re-initialise between attendees. */}
      <div className={cn(!scanning && state.kind !== "looking" && "hidden")}>
        {camera ? (
          <div className="relative">
            <Scanner paused={!scanning} onDetect={lookupCode} />
            {state.kind === "looking" && (
              <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/60 text-white">
                <Loader2 className="h-12 w-12 animate-spin" aria-label="Checking" />
              </div>
            )}
          </div>
        ) : (
          state.kind === "looking" && (
            <div className="flex h-40 items-center justify-center rounded-xl bg-muted">
              <Loader2 className="h-10 w-10 animate-spin" aria-label="Checking" />
            </div>
          )
        )}
      </div>

      {scanning && (
        <>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (typed.trim()) void lookupCode(typed.trim());
            }}
          >
            <div className="relative flex-1">
              <Keyboard className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="Type or USB-scan barcode"
                className="h-12 pl-9 font-mono"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                inputMode="text"
                aria-label="Barcode value"
              />
            </div>
            <Button type="submit" size="lg" disabled={!typed.trim()}>
              Check
            </Button>
          </form>
          <Button variant="outline" size="lg" onClick={() => setManualOpen(true)}>
            <Search /> Manual lookup (barcode won&apos;t scan)
          </Button>
        </>
      )}

      {state.kind !== "ready" && state.kind !== "looking" && (
        <ResultPanel state={state} offline={offline} compact={compact} onConfirm={confirm} onCancel={reset} onNameOk={(v) => setState((s) => (s.kind === "result" ? { ...s, nameOk: v } : s))} onManual={() => { reset(); setManualOpen(true); }} />
      )}

      <ManualLookup open={manualOpen} onOpenChange={setManualOpen} onPick={lookupTicket} demoActor={demoActor} />
    </div>
  );
}

const PANEL = {
  green: "bg-ok text-ok-fg",
  red: "bg-bad text-bad-fg",
  yellow: "bg-warn text-warn-fg",
  gray: "bg-neutral text-neutral-fg",
};

function ResultPanel({
  state,
  offline,
  compact,
  onConfirm,
  onCancel,
  onNameOk,
  onManual,
}: {
  state: Exclude<State, { kind: "ready" } | { kind: "looking" }>;
  offline: boolean;
  compact: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onNameOk: (v: boolean) => void;
  onManual: () => void;
}) {
  const big = compact ? "text-2xl" : "text-4xl sm:text-5xl";

  if (state.kind === "claimed") {
    return (
      <Panel tone="green" onClick={onCancel}>
        <CheckCircle2 className="h-16 w-16" aria-hidden />
        <h2 className={cn("font-black tracking-tight", big)}>RECORDED ✓</h2>
        <p className="text-xl font-semibold">Hand over ONE swag bag.</p>
        <Person a={state.result.attendee} />
        <p className="text-sm opacity-90">{state.result.remaining} bags remaining · tap to scan next</p>
      </Panel>
    );
  }

  if (state.kind === "denied") {
    const r = state.result;
    const already = r.status === "ALREADY_COLLECTED";
    return (
      <Panel tone={already ? "red" : r.status === "INELIGIBLE" || r.status === "OUT_OF_STOCK" ? "gray" : "yellow"}>
        {already ? <XCircle className="h-16 w-16" /> : <AlertTriangle className="h-16 w-16" />}
        <h2 className={cn("font-black tracking-tight", big)}>{already ? "ALREADY COLLECTED" : r.status.replaceAll("_", " ")}</h2>
        <p className="text-lg font-semibold">{r.message}</p>
        <Person a={r.attendee} />
        {r.claim && <PrevClaim c={r.claim} />}
        <Button size="xl" variant="secondary" className="mt-2 w-full" onClick={onCancel}>
          Scan next
        </Button>
      </Panel>
    );
  }

  const { lookup } = state;
  if (state.kind === "unknown") {
    return (
      <Panel tone="yellow">
        <ShieldAlert className="h-16 w-16" />
        <h2 className={cn("font-black tracking-tight", big)}>NOT CONFIRMED</h2>
        <p className="text-lg font-semibold">The claim could not be confirmed. Do NOT hand over a bag yet.</p>
        <p className="text-sm">{state.message}</p>
        <Person a={lookup.attendee} />
        <Button size="xl" className="mt-2 w-full bg-black text-white hover:bg-black/80" onClick={onConfirm} disabled={offline}>
          <RotateCcw /> Retry (safe — won&apos;t double count)
        </Button>
        <Button size="lg" variant="secondary" className="w-full" onClick={onCancel}>
          Cancel
        </Button>
      </Panel>
    );
  }

  const claiming = state.kind === "claiming";
  switch (lookup.status) {
    case "ELIGIBLE": {
      const needName = !!lookup.requireNameCheck;
      return (
        <Panel tone="green">
          <CheckCircle2 className="h-14 w-14" aria-hidden />
          <h2 className={cn("font-black tracking-tight", big)}>ELIGIBLE</h2>
          <p className="text-lg font-semibold">{lookup.message}</p>
          <Person a={lookup.attendee} large />
          {needName && (
            <label className="flex w-full cursor-pointer items-center gap-3 rounded-lg bg-black/20 p-3 text-left text-base font-semibold">
              <input type="checkbox" className="h-6 w-6 accent-white" checked={state.nameOk} onChange={(e) => onNameOk(e.target.checked)} />
              Name matches the attendee&apos;s badge / ID
            </label>
          )}
          {state.kind === "result" && state.error && <p role="alert" className="w-full rounded-lg bg-black/30 p-3 font-semibold">{state.error}</p>}
          <p className="text-sm opacity-90">Tap confirm, then hand over the bag once you see RECORDED ✓</p>
          <Button
            size="xl"
            className="h-20 w-full bg-white text-2xl font-black text-[#137333] hover:bg-white/90"
            onClick={onConfirm}
            disabled={claiming || offline || (needName && !state.nameOk)}
            autoFocus
          >
            {claiming ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
            {claiming ? "Recording…" : "Confirm Distributed"}
          </Button>
          <Button size="lg" variant="ghost" className="w-full text-ok-fg hover:bg-black/10" onClick={onCancel} disabled={claiming}>
            Cancel
          </Button>
        </Panel>
      );
    }
    case "ALREADY_COLLECTED":
      return (
        <Panel tone="red">
          <XCircle className="h-16 w-16" />
          <h2 className={cn("font-black tracking-tight", big)}>ALREADY COLLECTED</h2>
          <p className="text-lg font-semibold">{lookup.message} Do not distribute another bag.</p>
          <Person a={lookup.attendee} />
          {lookup.previousClaim && <PrevClaim c={lookup.previousClaim} />}
          <Button size="xl" variant="secondary" className="mt-2 w-full" onClick={onCancel}>
            Scan next
          </Button>
        </Panel>
      );
    case "INELIGIBLE":
    case "OUT_OF_STOCK":
      return (
        <Panel tone="gray">
          {lookup.status === "OUT_OF_STOCK" ? <PackageX className="h-16 w-16" /> : <CircleSlash className="h-16 w-16" />}
          <h2 className={cn("font-black tracking-tight", big)}>{lookup.status === "OUT_OF_STOCK" ? "OUT OF STOCK" : "INELIGIBLE"}</h2>
          <p className="text-lg font-semibold">{lookup.message}</p>
          {lookup.reason && <p className="text-sm">{lookup.reason}</p>}
          <Person a={lookup.attendee} />
          <Button size="xl" variant="secondary" className="mt-2 w-full" onClick={onCancel}>
            Scan next
          </Button>
        </Panel>
      );
    default:
      return (
        <Panel tone="yellow">
          <AlertTriangle className="h-16 w-16" />
          <h2 className={cn("font-black tracking-tight", big)}>{lookup.status === "FORMAT_NOT_VALIDATED" ? "NOT VALIDATED" : "NOT FOUND"}</h2>
          <p className="text-lg font-semibold">{lookup.message}</p>
          {lookup.reason && <p className="text-sm">{lookup.reason}</p>}
          <div className="mt-2 grid w-full gap-2 sm:grid-cols-2">
            <Button size="xl" variant="secondary" onClick={onCancel}>
              Scan again
            </Button>
            <Button size="xl" className="bg-black text-white hover:bg-black/80" onClick={onManual}>
              <Search /> Manual lookup
            </Button>
          </div>
        </Panel>
      );
  }
}

function Panel({ tone, children, onClick }: { tone: keyof typeof PANEL; children: React.ReactNode; onClick?: () => void }) {
  return (
    <section
      role="status"
      aria-live="assertive"
      onClick={onClick}
      className={cn("animate-pop flex min-h-[60dvh] flex-col items-center justify-center gap-3 rounded-2xl p-6 text-center shadow-lg", PANEL[tone], onClick && "cursor-pointer")}
    >
      {children}
    </section>
  );
}

function Person({ a, large }: { a?: AttendeeView; large?: boolean }) {
  if (!a) return null;
  return (
    <div className="w-full rounded-xl bg-black/15 px-4 py-3">
      <p className={cn("font-bold leading-tight", large ? "text-3xl sm:text-4xl" : "text-2xl")}>
        {a.firstName} {a.lastName}
      </p>
      <p className="mt-1 font-mono text-base opacity-90">{a.ticketNumber}</p>
      {a.ticketTitle && <p className="text-sm opacity-80">{a.ticketTitle}</p>}
    </div>
  );
}

function PrevClaim({ c }: { c: ClaimInfoView }) {
  return (
    <p className="text-base">
      Collected <strong>{fmtTime(c.claimedAt)}</strong> ({timeAgo(c.claimedAt)}) at <strong>{c.counter}</strong> by {c.claimedByName}
      {c.method === "manual" ? " · manual" : ""}
    </p>
  );
}

interface SearchHit extends AttendeeView {
  claimed: boolean;
  claim?: ClaimInfoView;
}

function ManualLookup({ open, onOpenChange, onPick, demoActor }: { open: boolean; onOpenChange: (o: boolean) => void; onPick: (t: string) => void; demoActor?: string }) {
  const [q, setQ] = React.useState("");
  const [hits, setHits] = React.useState<SearchHit[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      setQ("");
      setHits([]);
      setErr(null);
    }
  }, [open]);

  React.useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await api<{ results: SearchHit[] }>(`/api/attendees/search?q=${encodeURIComponent(q.trim())}`, { demoActor, retries: 1 });
        setHits(r.results);
        setErr(null);
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, demoActor]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[5dvh] translate-y-0">
        <DialogHeader>
          <DialogTitle>Manual lookup</DialogTitle>
          <DialogDescription>Search by name, email, full ticket number or the 7-digit barcode number. Check the attendee&apos;s badge or ID.</DialogDescription>
        </DialogHeader>
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Grace Hopper or GOOGA26…" className="h-12" aria-label="Search attendees" />
        {err && <p className="text-sm text-destructive">{err}</p>}
        <ul className="flex max-h-[50dvh] flex-col gap-2 overflow-y-auto" aria-busy={loading}>
          {hits.map((h) => (
            <li key={h.ticketNumber}>
              <button className="flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring" onClick={() => onPick(h.ticketNumber)}>
                <span>
                  <span className="block font-semibold">
                    {h.firstName} {h.lastName}
                  </span>
                  <span className="block font-mono text-xs text-muted-foreground">
                    {h.ticketNumber} · {h.emailMasked}
                  </span>
                </span>
                {h.claimed ? <Badge variant="bad">Collected</Badge> : <Badge variant="muted">Not collected</Badge>}
              </button>
            </li>
          ))}
          {!loading && q.trim().length >= 2 && hits.length === 0 && <li className="p-3 text-sm text-muted-foreground">No matching registrations.</li>}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
