"use client";
import * as React from "react";
import { Camera, CheckCircle2, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { Scanner } from "@/components/scanner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/client/api";
import type { BarcodeSettings, Settings } from "@/lib/domain/types";

interface VResult {
  code: string;
  ok: boolean;
  result: "MATCH" | "NO_MATCH" | "AMBIGUOUS" | "MALFORMED";
  detail: string;
  prefix?: string;
  id?: string;
  prefixAllowed?: boolean;
  ticketNumber?: string;
  name?: string;
}

export default function ValidatePage() {
  const [settings, setSettings] = React.useState<Settings | null>(null);
  const [codes, setCodes] = React.useState("132774:3469041\n");
  const [results, setResults] = React.useState<VResult[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [camera, setCamera] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [bc, setBc] = React.useState<BarcodeSettings | null>(null);

  const load = React.useCallback(async () => {
    const r = await api<{ settings: Settings }>("/api/admin/settings");
    setSettings(r.settings);
    setBc(r.settings.barcode);
  }, []);
  React.useEffect(() => void load(), [load]);

  async function test(list = codes) {
    const arr = list.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, 50);
    if (!arr.length) return;
    setBusy(true);
    try {
      setResults((await api<{ results: VResult[] }>("/api/admin/validate-barcodes", { body: { codes: arr } })).results);
    } finally {
      setBusy(false);
    }
  }

  async function save(patch: Partial<BarcodeSettings>) {
    if (!bc) return;
    setMsg(null);
    try {
      const r = await api<{ settings: Settings }>("/api/admin/settings", { method: "PUT", body: { barcode: { ...bc, ...patch, validatedAt: undefined, validatedBy: undefined } } });
      setSettings(r.settings);
      setBc(r.settings.barcode);
      setMsg({ ok: true, text: "Barcode settings saved." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }

  const matches = results.filter((r) => r.result === "MATCH");
  const prefixes = [...new Set(results.filter((r) => r.prefix).map((r) => r.prefix!))];
  const canValidate = matches.length >= 3 && results.every((r) => r.result === "MATCH");

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Barcode validation {settings?.barcode.validated ? <Badge variant="ok">Validated</Badge> : <Badge variant="warn">Not validated</Badge>}
          </CardTitle>
          <CardDescription>
            The barcode → ticket rule was observed in event data (e.g. <span className="font-mono">132774:3469041</span> → <span className="font-mono">GOOGA263469041</span>) but is not an official Bevy specification. Before the event, scan
            several real attendee barcodes (from different orders and ticket types) and confirm each matches exactly one registration. Scanning claims stay disabled until you mark the format validated.
          </CardDescription>
          {settings?.barcode.validated && (
            <p className="text-sm">
              Validated by {settings.barcode.validatedBy} at {settings.barcode.validatedAt && new Date(settings.barcode.validatedAt).toLocaleString()}.
            </p>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Label htmlFor="codes">Real barcodes, one per line (scan into this box with a USB scanner, or use the camera)</Label>
          <Textarea id="codes" value={codes} onChange={(e) => setCodes(e.target.value)} rows={6} className="font-mono" />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => test()} disabled={busy}>
              {busy && <Loader2 className="animate-spin" />} Test against imported CSV
            </Button>
            <Button variant="outline" onClick={() => setCamera((c) => !c)}>
              <Camera /> {camera ? "Close camera" : "Scan with camera"}
            </Button>
          </div>
          {camera && (
            <div className="max-w-md">
              <Scanner
                paused={false}
                onDetect={(t) => {
                  setCodes((c) => {
                    const next = c.split("\n").includes(t) ? c : `${c.trimEnd()}\n${t}\n`;
                    void test(next);
                    return next;
                  });
                }}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {results.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              Results: {matches.length}/{results.length} exact matches
            </CardTitle>
            <CardDescription>Observed prefixes: {prefixes.length ? prefixes.join(", ") : "—"}</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="p-2">Scanned</th>
                  <th className="p-2">Prefix</th>
                  <th className="p-2">Identifier</th>
                  <th className="p-2">Result</th>
                  <th className="p-2">Matched registration</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i} className="border-t">
                    <td className="p-2 font-mono text-xs">{r.code}</td>
                    <td className="p-2 font-mono text-xs">
                      {r.prefix} {r.prefix && bc?.allowedPrefixes.length ? r.prefixAllowed ? <Badge variant="ok">allowed</Badge> : <Badge variant="bad">not allowed</Badge> : null}
                    </td>
                    <td className="p-2 font-mono text-xs">{r.id}</td>
                    <td className="p-2">
                      {r.ok ? (
                        <span className="flex items-center gap-1 font-semibold text-g-green">
                          <CheckCircle2 className="h-4 w-4" /> MATCH
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 font-semibold text-destructive">
                          <XCircle className="h-4 w-4" /> {r.result}
                        </span>
                      )}
                    </td>
                    <td className="p-2">{r.ok ? `${r.name} · ${r.ticketNumber}` : r.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {bc && (
        <Card>
          <CardHeader>
            <CardTitle>Barcode rules</CardTitle>
            <CardDescription>Format: &lt;prefix&gt;{bc.separator}&lt;identifier&gt;; the identifier must equal the last {bc.suffixLength} digits of the ticket number.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {msg && <p className={`rounded-md p-3 text-sm font-medium ${msg.ok ? "bg-ok text-ok-fg" : "bg-bad text-bad-fg"}`}>{msg.text}</p>}
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">First component (prefix) policy</legend>
              {(
                [
                  ["unvalidated", "Not yet decided — record the prefix but don't check it"],
                  ["enforce", "Enforce — only accept the allowed prefixes below (recommended once validated)"],
                  ["ignore", "Ignore — I've confirmed the prefix carries no meaning for matching"],
                ] as const
              ).map(([v, label]) => (
                <label key={v} className="flex items-start gap-2 text-sm">
                  <input type="radio" name="policy" className="mt-1" checked={bc.prefixPolicy === v} onChange={() => setBc({ ...bc, prefixPolicy: v })} /> {label}
                </label>
              ))}
            </fieldset>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="prefixes">Allowed prefixes (comma separated)</Label>
              <Input
                id="prefixes"
                value={bc.allowedPrefixes.join(", ")}
                onChange={(e) => setBc({ ...bc, allowedPrefixes: e.target.value.split(/[,\s]+/).filter(Boolean) })}
                placeholder={prefixes.join(", ") || "132774"}
                className="font-mono"
              />
              {prefixes.length > 0 && (
                <Button variant="link" size="sm" className="self-start px-0" onClick={() => setBc({ ...bc, allowedPrefixes: prefixes })}>
                  Use observed prefixes: {prefixes.join(", ")}
                </Button>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sep">Separator</Label>
                <Input id="sep" value={bc.separator} onChange={(e) => setBc({ ...bc, separator: e.target.value })} className="font-mono" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="len">Identifier length</Label>
                <Input
                  id="len"
                  type="number"
                  min={4}
                  max={20}
                  value={bc.suffixLength}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    setBc({ ...bc, suffixLength: n, idPattern: `^\\d{${n}}$` });
                  }}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pp">Prefix pattern (regex)</Label>
                <Input id="pp" value={bc.prefixPattern} onChange={(e) => setBc({ ...bc, prefixPattern: e.target.value })} className="font-mono" />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => save({})}>
                Save rules
              </Button>
              {settings?.barcode.validated ? (
                <Button variant="destructive" onClick={() => save({ validated: false })}>
                  Revoke validation (disables scan claims)
                </Button>
              ) : (
                <Button onClick={() => save({ validated: true })} disabled={!canValidate}>
                  <ShieldCheck /> Mark format validated
                </Button>
              )}
            </div>
            {!settings?.barcode.validated && !canValidate && <p className="text-xs text-muted-foreground">Test at least 3 real barcodes, all of which must match exactly one registration, before validating.</p>}
          </CardContent>
        </Card>
      )}
    </>
  );
}
