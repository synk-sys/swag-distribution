"use client";
import * as React from "react";
import { IS_DEMO } from "@/lib/config";
import { api } from "@/lib/client/api";

/**
 * Returns a number that changes whenever any claim / import / setting changes.
 * Production: Supabase Realtime on public.live_meta (push), plus a slow poll as
 * a safety net if the websocket drops on conference Wi-Fi.
 * Demo: polls /api/live every 1.5 s.
 */
export function useLiveVersion(enabled = true): number {
  const [v, setV] = React.useState(0);
  React.useEffect(() => {
    if (!enabled) return;
    let stop = false;
    const tick = async () => {
      try {
        const r = await api<{ version: number }>("/api/live", { retries: 0, timeoutMs: 4000 });
        if (!stop) setV(r.version);
      } catch {
        /* network indicator covers this */
      }
    };
    void tick();
    const id = setInterval(tick, IS_DEMO ? 1500 : 5000);
    let cleanup = () => {};
    if (!IS_DEMO) {
      void (async () => {
        const { supabaseBrowser } = await import("@/lib/client/supabase");
        const sb = supabaseBrowser();
        const token = (await sb.auth.getSession()).data.session?.access_token;
        if (token) sb.realtime.setAuth(token);
        const channel = sb
          .channel("live-meta")
          .on("postgres_changes", { event: "UPDATE", schema: "public", table: "live_meta" }, (payload) => {
            const version = Number((payload.new as { version?: number }).version ?? 0);
            if (!stop) setV(version);
          })
          .subscribe();
        cleanup = () => void sb.removeChannel(channel);
      })();
    }
    return () => {
      stop = true;
      clearInterval(id);
      cleanup();
    };
  }, [enabled]);
  return v;
}
