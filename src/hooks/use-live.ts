"use client";
import * as React from "react";
import { IS_DEMO } from "@/lib/config";
import { api } from "@/lib/client/api";

/**
 * Returns a number that changes whenever any claim / import / setting changes.
 * Production: Firestore onSnapshot on meta/live (push, real time).
 * Demo: polls /api/live every 1.5 s.
 */
export function useLiveVersion(enabled = true): number {
  const [v, setV] = React.useState(0);
  React.useEffect(() => {
    if (!enabled) return;
    if (IS_DEMO) {
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
      const id = setInterval(tick, 1500);
      return () => {
        stop = true;
        clearInterval(id);
      };
    }
    let unsub = () => {};
    void (async () => {
      const { clientDb } = await import("@/lib/client/firebase");
      const { doc, onSnapshot } = await import("firebase/firestore");
      unsub = onSnapshot(
        doc(clientDb(), "meta", "live"),
        (s) => setV((s.data()?.version as number) ?? 0),
        () => undefined,
      );
    })();
    return () => unsub();
  }, [enabled]);
  return v;
}
