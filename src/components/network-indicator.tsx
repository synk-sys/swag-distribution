"use client";
import { Wifi, WifiOff } from "lucide-react";
import type { NetState } from "@/hooks/use-network";
import { cn } from "@/lib/utils";

export function NetworkIndicator({ state, latency, showLabel }: { state: NetState; latency: number | null; showLabel?: boolean }) {
  const label = state === "online" ? "Online" : state === "slow" ? "Slow network" : "Offline";
  return (
    <span
      role="status"
      aria-label={`Network: ${label}`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
        state === "online" && "bg-ok text-ok-fg",
        state === "slow" && "bg-warn text-warn-fg",
        state === "offline" && "bg-bad text-bad-fg",
      )}
    >
      {state === "offline" ? <WifiOff className="h-3.5 w-3.5" /> : <Wifi className="h-3.5 w-3.5" />}
      <span className={state === "offline" || showLabel ? "" : "hidden sm:inline"}>{label}</span>
      {latency !== null && state !== "offline" && <span className="opacity-80">{latency}ms</span>}
    </span>
  );
}
