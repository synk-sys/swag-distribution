"use client";
import * as React from "react";
import Link from "next/link";
import { CheckCircle2, FileUp, Loader2, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/client/api";
import { MAX_CSV_BYTES, REQUIRED_COLUMNS } from "@/lib/domain/csv";
import type { RegistrationCsvFields } from "@/lib/domain/types";

interface Issue {
  row: number;
  ticketNumber: string;
  code: string;
  severity: "error" | "warning";
  message: string;
}
interface Outcome {
  dryRun: boolean;
  importId?: string;
  report: {
    headers: string[];
    extraColumns: string[];
    totalRows: number;
    validCount: number;
    preview: RegistrationCsvFields[];
    issues: Issue[];
    errorCount: number;
    warningCount: number;
    ambiguousBarcodeIds: Record<string, string[]>;
    ticketTitles: Record<string, number>;
  };
  diff: { newTickets: number; updatedTickets: number; unchangedTickets: number; removedTickets: string[]; claimsPreserved: number; ambiguousAcrossAll: Record<string, string[]> };
}

export default function ImportPage() {
  const [file, setFile] = React.useState<File | null>(null);
  const [text, setText] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<Outcome | null>(null);
  const [done, setDone] = React.useState<Outcome | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function choose(f: File | undefined) {
    setPreview(null);
    setDone(null);
    setError(null);
    if (!f) return;
    if (f.size > MAX_CSV_BYTES) return setError("File is larger than 5 MB.");
    if (!/\.csv$/i.test(f.name) && f.type !== "text/csv") return setError("Choose a .csv file exported from Bevy.");
    setFile(f);
    const t = await f.text();
    setText(t);
    setBusy(true);
    try {
      setPreview(await api<Outcome>("/api/admin/import?dryRun=1", { rawBody: t, contentType: "text/csv", retries: 1 }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      setDone(await api<Outcome>("/api/admin/import", { rawBody: text, contentType: "text/csv", retries: 2 }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const p = preview;
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Import Bevy attendee CSV</CardTitle>
          <CardDescription>
            Upload the original Bevy export. Reimporting is safe: existing swag claims and organizer overrides are never reset. Registrations missing from a newer file are flagged, never deleted.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm">
            Required columns: {Object.values(REQUIRED_COLUMNS).map((c) => <Badge key={c} variant="muted" className="m-0.5">{c}</Badge>)}. Other columns are kept as extra data.
          </p>
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center hover:bg-muted">
            <FileUp className="h-8 w-8 text-g-blue" />
            <span className="font-semibold">{file ? file.name : "Choose Bevy CSV file"}</span>
            <span className="text-xs text-muted-foreground">Max 5 MB. The file is validated on the server before anything is written.</span>
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => choose(e.target.files?.[0])} />
          </label>
          {busy && (
            <p className="flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Working…
            </p>
          )}
          {error && <p role="alert" className="rounded-md bg-bad p-3 text-sm font-medium text-bad-fg">{error}</p>}
        </CardContent>
      </Card>

      {done && (
        <Card className="border-2 border-g-green">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="text-g-green" /> Import complete
            </CardTitle>
            <CardDescription>
              {done.report.validCount} registrations imported · {done.diff.newTickets} new · {done.diff.updatedTickets} updated · {done.diff.claimsPreserved} existing claims preserved.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Button asChild>
              <Link href="/admin/validate">Next: validate real barcodes →</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/admin">Dashboard</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {p && !done && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Validation summary</CardTitle>
              <CardDescription>Nothing has been written yet.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Mini label="Rows in file" v={p.report.totalRows} />
                <Mini label="Valid records" v={p.report.validCount} />
                <Mini label="Errors (skipped)" v={p.report.errorCount} bad={p.report.errorCount > 0} />
                <Mini label="Warnings" v={p.report.warningCount} />
                <Mini label="New" v={p.diff.newTickets} />
                <Mini label="Updated" v={p.diff.updatedTickets} />
                <Mini label="Unchanged" v={p.diff.unchangedTickets} />
                <Mini label="Claims preserved" v={p.diff.claimsPreserved} />
              </div>
              {p.diff.removedTickets.length > 0 && (
                <p className="rounded-md bg-warn p-3 text-sm text-warn-fg">
                  {p.diff.removedTickets.length} previously imported registrations are not in this file. They will be flagged “not in latest import” (and treated per your eligibility rules), not deleted: {p.diff.removedTickets.slice(0, 10).join(", ")}
                  {p.diff.removedTickets.length > 10 ? "…" : ""}
                </p>
              )}
              {Object.keys(p.diff.ambiguousAcrossAll).length > 0 ? (
                <p className="rounded-md bg-warn p-3 text-sm text-warn-fg">
                  Barcode suffix collisions: {Object.entries(p.diff.ambiguousAcrossAll).map(([id, ts]) => `${id} → ${ts.join(" / ")}`).join("; ")}. Scans of these will be rejected; volunteers must use manual lookup.
                </p>
              ) : (
                <p className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-g-green" /> Every barcode identifier maps to exactly one registration.
                </p>
              )}
              <div>
                <p className="mb-1 text-sm font-medium">Ticket types</p>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(p.report.ticketTitles).map(([t, n]) => (
                    <Badge key={t} variant="outline">
                      {t}: {n}
                    </Badge>
                  ))}
                </div>
              </div>
              <Button size="lg" onClick={commit} disabled={busy || p.report.validCount === 0}>
                <Upload /> Import {p.report.validCount} registrations
              </Button>
            </CardContent>
          </Card>

          {p.report.issues.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Issues ({p.report.issues.length})</CardTitle>
                <CardDescription>Row numbers exclude the header row.</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto text-sm">
                  {p.report.issues.map((i, n) => (
                    <li key={n} className="flex gap-2">
                      <Badge variant={i.severity === "error" ? "bad" : "warn"} className="shrink-0">
                        {i.severity}
                      </Badge>
                      <span>
                        Row {i.row} <span className="font-mono">{i.ticketNumber}</span>: {i.message}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Preview (first {p.report.preview.length})</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="p-2">Ticket number</th>
                    <th className="p-2">Barcode id</th>
                    <th className="p-2">Name</th>
                    <th className="p-2">Email</th>
                    <th className="p-2">Ticket title</th>
                    <th className="p-2">Check-in (UTC)</th>
                  </tr>
                </thead>
                <tbody>
                  {p.report.preview.map((r) => (
                    <tr key={r.ticketNumber} className="border-t">
                      <td className="p-2 font-mono text-xs">{r.ticketNumber}</td>
                      <td className="p-2 font-mono text-xs">{r.barcodeId ?? "—"}</td>
                      <td className="p-2">
                        {r.firstName} {r.lastName}
                      </td>
                      <td className="p-2">{r.email}</td>
                      <td className="p-2">{r.ticketTitle}</td>
                      <td className="p-2">{r.checkinDateUtc ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}

function Mini({ label, v, bad }: { label: string; v: number; bad?: boolean }) {
  return (
    <div className={`rounded-lg p-3 ${bad ? "bg-bad text-bad-fg" : "bg-muted"}`}>
      <p className="text-xs opacity-80">{label}</p>
      <p className="text-xl font-bold tabular-nums">{v}</p>
    </div>
  );
}
