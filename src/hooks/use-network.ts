"use client";
import * as React from "react";

export type NetState = "online" | "slow" | "offline";

/** Browser online flag + an actual round-trip to our server every 8 s. */
export function useNetworkStatus() {
  const [state, setState] = React.useState<NetState>("online");
  const [latency, setLatency] = React.useState<number | null>(null);

  const check = React.useCallback(async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setState("offline");
      return;
    }
    const t0 = performance.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const r = await fetch("/api/health", { cache: "no-store", signal: ctrl.signal });
      if (!r.ok) throw new Error();
      const ms = Math.round(performance.now() - t0);
      setLatency(ms);
      setState(ms > 1500 ? "slow" : "online");
    } catch {
      setState("offline");
      setLatency(null);
    } finally {
      clearTimeout(timer);
    }
  }, []);

  React.useEffect(() => {
    void check();
    const id = setInterval(check, 8000);
    const on = () => void check();
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    document.addEventListener("visibilitychange", on);
    return () => {
      clearInterval(id);
      window.removeEventListener("online", on);
      window.removeEventListener("offline", on);
      document.removeEventListener("visibilitychange", on);
    };
  }, [check]);

  return { state, latency, recheck: check };
}
