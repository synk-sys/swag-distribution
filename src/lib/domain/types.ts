import { z } from "zod";

export type Role = "organizer" | "volunteer";

export interface Actor {
  uid: string;
  name: string;
  role: Role;
}

export interface SwagClaim {
  status: "claimed";
  claimId: string;
  claimedAt: string; // ISO, server clock
  claimedAtMs: number;
  claimedBy: { uid: string; name: string };
  counter: string;
  method: "scan" | "manual";
}

export interface SwagUnclaimed {
  status: "unclaimed";
  lastReversal?: {
    claimId: string;
    reversedAt: string;
    reversedBy: { uid: string; name: string };
    reason: string;
    bagReturned: boolean;
  };
}

export type SwagState = SwagClaim | SwagUnclaimed;

export interface EligibilityOverride {
  value: "eligible" | "ineligible";
  reason: string;
  by: { uid: string; name: string };
  at: string;
}

/** Fields that come from the Bevy CSV. Reimports only ever overwrite these. */
export interface RegistrationCsvFields {
  ticketNumber: string;
  orderNumber: string;
  firstName: string;
  lastName: string;
  email: string;
  ticketTitle: string;
  checkinDateUtc: string | null;
  barcodeId: string | null;
  extra: Record<string, string>;
}

export interface Registration extends RegistrationCsvFields {
  inLatestImport: boolean;
  firstImportedAt: string;
  lastImportedAt: string;
  importId: string;
  eligibilityOverride?: EligibilityOverride | null;
  /** Absent means never claimed. Only claim/reverse transactions write this. */
  swag?: SwagState;
}

export interface Inventory {
  initial: number;
  adjustments: number;
  /** Physical bags that have left the table. */
  bagsOut: number;
  /** Registrations currently marked as claimed. */
  activeClaims: number;
}

export function remainingBags(inv: Inventory): number {
  return inv.initial + inv.adjustments - inv.bagsOut;
}

export const EMPTY_INVENTORY: Inventory = { initial: 0, adjustments: 0, bagsOut: 0, activeClaims: 0 };

export const barcodeSettingsSchema = z.object({
  separator: z.string().min(1).max(3),
  prefixPattern: z.string().min(1).max(200),
  idPattern: z.string().min(1).max(200),
  suffixLength: z.number().int().min(4).max(20),
  prefixPolicy: z.enum(["unvalidated", "enforce", "ignore"]),
  allowedPrefixes: z.array(z.string().regex(/^[A-Za-z0-9]{1,20}$/)).max(20),
  validated: z.boolean(),
  validatedBy: z.string().nullable().optional(),
  validatedAt: z.string().nullable().optional(),
});
export type BarcodeSettings = z.infer<typeof barcodeSettingsSchema>;

export const eligibilitySettingsSchema = z.object({
  mode: z.enum(["all", "allowlist"]),
  allowedTicketTitles: z.array(z.string().max(200)).max(100),
  requireCheckin: z.boolean(),
  excludeRemovedRegistrations: z.boolean(),
});
export type EligibilitySettings = z.infer<typeof eligibilitySettingsSchema>;

export const verificationSettingsSchema = z.object({
  requireNameCheck: z.boolean(),
});

export const settingsSchema = z.object({
  barcode: barcodeSettingsSchema,
  eligibility: eligibilitySettingsSchema,
  verification: verificationSettingsSchema,
});
export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  barcode: {
    separator: ":",
    prefixPattern: "^\\d{1,12}$",
    idPattern: "^\\d{7}$",
    suffixLength: 7,
    prefixPolicy: "unvalidated",
    allowedPrefixes: [],
    validated: false,
    validatedBy: null,
    validatedAt: null,
  },
  eligibility: {
    mode: "all",
    allowedTicketTitles: [],
    requireCheckin: false,
    excludeRemovedRegistrations: true,
  },
  verification: { requireNameCheck: false },
};

export type AuditEventType =
  | "claim"
  | "claim_denied"
  | "claim_reversed"
  | "inventory_set_initial"
  | "inventory_adjust"
  | "import"
  | "eligibility_override"
  | "settings_change"
  | "staff_change";

export interface AuditEvent {
  id: string;
  type: AuditEventType;
  at: string;
  atMs: number;
  actor: { uid: string; name: string; role: Role };
  ticketNumber?: string | null;
  counter?: string | null;
  claimId?: string | null;
  details?: Record<string, unknown>;
}

export interface IdempotencyRecord {
  uid: string;
  ticketNumber: string;
  result: ClaimResult;
  createdAt: string;
  expiresAt: string;
}

export type LookupStatus =
  | "ELIGIBLE"
  | "ALREADY_COLLECTED"
  | "NOT_FOUND"
  | "INELIGIBLE"
  | "OUT_OF_STOCK"
  | "FORMAT_NOT_VALIDATED";

export interface AttendeeView {
  ticketNumber: string;
  firstName: string;
  lastName: string;
  ticketTitle: string;
  barcodeId: string | null;
  emailMasked: string;
}

export interface ClaimInfoView {
  claimId: string;
  claimedAt: string;
  claimedByName: string;
  counter: string;
  method: "scan" | "manual";
}

export interface LookupResult {
  status: LookupStatus;
  reason?: string;
  message: string;
  attendee?: AttendeeView;
  previousClaim?: ClaimInfoView;
  remaining?: number;
  requireNameCheck?: boolean;
  barcode?: { prefix: string | null; id: string | null };
}

export type ClaimStatus =
  | "SUCCESS"
  | "ALREADY_COLLECTED"
  | "NOT_FOUND"
  | "INELIGIBLE"
  | "OUT_OF_STOCK"
  | "IDEMPOTENCY_CONFLICT";

export interface ClaimResult {
  status: ClaimStatus;
  message: string;
  claim?: ClaimInfoView;
  attendee?: AttendeeView;
  remaining?: number;
  replayed?: boolean;
}

export const STATUS_MESSAGES = {
  ELIGIBLE: "This attendee can collect one swag bag.",
  ALREADY_COLLECTED: "This attendee has already received their swag bag.",
  ALREADY_COLLECTED_ON_CLAIM: "ALREADY COLLECTED. Do not distribute another bag.",
  NOT_FOUND: "Barcode does not match a registered attendee.",
  INELIGIBLE: "This registration is not eligible for swag.",
  OUT_OF_STOCK: "No swag bags remaining in inventory. Do not distribute.",
  FORMAT_NOT_VALIDATED:
    "Barcode format has not been validated by an organizer yet. Use manual lookup or ask an organizer.",
  SUCCESS: "Distribution recorded. Hand over ONE swag bag.",
} as const;
