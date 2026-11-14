"use client";
import * as React from "react";
import { api } from "@/lib/client/api";
import type { AuditEvent, ClaimInfoView, Settings } from "@/lib/domain/types";
import { useLiveVersion } from "./use-live";

export interface DashAttendee {
  ticketNumber: string;
  orderNumber: string;
  firstName: string;
  lastName: string;
  email: string;
  ticketTitle: string;
  checkinDateUtc: string | null;
  barcodeId: string | null;
  inLatestImport: boolean;
  eligible: boolean;
  eligibilityReason: string;
  override: { value: string; reason: string; by: { name: string }; at: string } | null;
  claim: ClaimInfoView | null;
  lastReversal: { claimId: string; reversedAt: string; reversedBy: { name: string }; reason: string; bagReturned: boolean } | null;
}

export interface Dashboard {
  totals: { registered: number; eligible: number; distributed: number; eligibleNotCollected: number; initialInventory: number; adjustments: number; bagsOut: number; remaining: number };
  byVolunteer: Record<string, number>;
  byCounter: Record<string, number>;
  recent: AuditEvent[];
  settings: Settings;
  attendees: DashAttendee[];
}

export function useDashboard() {
  const live = useLiveVersion();
  const [data, setData] = React.useState<Dashboard | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = React.useState<Date | null>(null);
  const reload = React.useCallback(async () => {
    try {
      setData(await api<Dashboard>("/api/admin/dashboard", { retries: 1 }));
      setUpdatedAt(new Date());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  React.useEffect(() => void reload(), [reload, live]);
  return { data, error, reload, updatedAt };
}
