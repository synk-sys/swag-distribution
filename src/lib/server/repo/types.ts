import type {
  AuditEvent,
  AuditEventType,
  EligibilityOverride,
  IdempotencyRecord,
  Inventory,
  Registration,
  RegistrationCsvFields,
  Role,
  Settings,
  SwagState,
} from "@/lib/domain/types";

export type NewAuditEvent = Omit<AuditEvent, "id"> & { id?: string };

/**
 * A serializable transaction. All reads see a consistent snapshot; writes are
 * buffered and applied atomically only if the callback resolves. If another
 * transaction changes something we read, the whole callback is retried
 * (Firestore) or never interleaves in the first place (memory store).
 */
export interface Tx {
  getRegistration(ticketNumber: string): Promise<Registration | null>;
  getInventory(): Promise<Inventory>;
  getSettings(): Promise<Settings>;
  getIdempotency(key: string): Promise<IdempotencyRecord | null>;

  updateSwag(ticketNumber: string, swag: SwagState): void;
  updateEligibilityOverride(ticketNumber: string, override: EligibilityOverride | null): void;
  setInventory(inv: Inventory): void;
  setSettings(settings: Settings): void;
  setIdempotency(key: string, rec: IdempotencyRecord): void;
  addEvent(e: NewAuditEvent): string;
  bumpLive(): void;
}

export interface StaffMember {
  uid: string;
  email: string;
  displayName: string;
  role: Role;
  addedBy: string;
  addedAt: string;
}

export interface Repo {
  readonly kind: "memory" | "firestore";
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;

  getSettings(): Promise<Settings>;
  getInventory(): Promise<Inventory>;
  getRegistration(ticketNumber: string): Promise<Registration | null>;
  findByBarcodeId(barcodeId: string): Promise<Registration[]>;
  listRegistrations(): Promise<Registration[]>;
  listEvents(opts: { limit: number; types?: AuditEventType[] }): Promise<AuditEvent[]>;
  /** Best-effort, non-transactional audit write (e.g. denied attempts). */
  addEvent(e: NewAuditEvent): Promise<string>;

  /**
   * Upsert CSV-sourced fields only. MUST NOT modify `swag` or `eligibilityOverride`.
   * Tickets in `removed` are flagged `inLatestImport=false`, never deleted.
   */
  applyImport(
    records: RegistrationCsvFields[],
    removed: string[],
    meta: { importId: string; now: string },
  ): Promise<void>;
  setBarcodeIds(updates: { ticketNumber: string; barcodeId: string | null }[]): Promise<void>;

  getLiveVersion(): Promise<number>;
  bumpLive(): Promise<void>;

  listStaff(): Promise<StaffMember[]>;
  upsertStaff(m: StaffMember): Promise<void>;
  removeStaff(uid: string): Promise<void>;
}
