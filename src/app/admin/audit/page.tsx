"use client";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useLiveVersion } from "@/hooks/use-live";
import { api } from "@/lib/client/api";
import type { AuditEvent } from "@/lib/domain/types";
import { fmtTime } from "@/lib/utils";

const VARIANT: Record<string, "ok" | "bad" | "warn" | "muted" | "default"> = {
  claim: "ok",
  claim_denied: "bad",
  claim_reversed: "warn",
  import: "default",
};

export default function AuditPage() {
  const live = useLiveVersion();
  const [events, setEvents] = React.useState<AuditEvent[]>([]);
  const [q, setQ] = React.useState("");
  React.useEffect(() => {
    void api<{ events: AuditEvent[] }>("/api/admin/audit?limit=1000").then((r) => setEvents(r.events));
  }, [live]);
  const term = q.trim().toLowerCase();
  const shown = term ? events.filter((e) => JSON.stringify(e).toLowerCase().includes(term)) : events;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit log</CardTitle>
        <CardDescription>Append-only. Claims, denied attempts, reversals, inventory, imports, eligibility, settings and staff changes. Newest first (latest 1000).</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter (ticket, volunteer, type…)" aria-label="Filter audit log" />
        <ul className="flex flex-col divide-y text-sm">
          {shown.map((e) => (
            <li key={e.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-start sm:gap-3">
              <span className="w-40 shrink-0 text-xs text-muted-foreground">{fmtTime(e.at)}</span>
              <Badge variant={VARIANT[e.type] ?? "muted"} className="w-fit shrink-0">
                {e.type}
              </Badge>
              <span className="min-w-0 flex-1">
                <span className="font-medium">{e.actor.name}</span> <span className="text-muted-foreground">({e.actor.role})</span>
                {e.ticketNumber && <span className="ml-2 font-mono text-xs">{e.ticketNumber}</span>}
                {e.counter && <span className="ml-2 text-xs">@ {e.counter}</span>}
                {e.details && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-muted-foreground">details</summary>
                    <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(e.details, null, 2)}</pre>
                  </details>
                )}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
