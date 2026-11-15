import { randomUUID } from "node:crypto";
import {
  DEFAULT_SETTINGS,
  EMPTY_INVENTORY,
  type AuditEvent,
  type IdempotencyRecord,
  type Inventory,
  type Registration,
  type RegistrationCsvFields,
  type Settings,
} from "@/lib/domain/types";
import type { NewAuditEvent, Repo, StaffMember, Tx } from "./types";

const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));

export interface FaultHooks {
  /** Throw here to simulate the transaction failing before commit. */
  beforeCommit?: () => void;
  /** Throw here to simulate the commit succeeding but the response being lost. */
  afterCommit?: () => void;
}

/**
 * In-memory repository used for DEMO MODE and automated tests.
 * Transactions are fully serialized with a mutex, which gives the same
 * guarantee Postgres row locks give for our access pattern.
 */
export class MemoryRepo implements Repo {
  readonly kind = "memory" as const;
  registrations = new Map<string, Registration>();
  events: AuditEvent[] = [];
  idempotency = new Map<string, IdempotencyRecord>();
  inventory: Inventory = { ...EMPTY_INVENTORY };
  settings: Settings = clone(DEFAULT_SETTINGS);
  staff = new Map<string, StaffMember>();
  live = 0;
  faults: FaultHooks = {};
  /** Artificial latency inside transactions to widen race windows in tests. */
  txLatencyMs = 0;

  private lock: Promise<unknown> = Promise.resolve();

  async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const run = async () => {
      const writes: (() => void)[] = [];
      const pause = () => (this.txLatencyMs ? new Promise((r) => setTimeout(r, this.txLatencyMs)) : Promise.resolve());
      const tx: Tx = {
        getRegistration: async (t) => (await pause(), clone(this.registrations.get(t) ?? null)),
        getInventory: async () => (await pause(), clone(this.inventory)),
        getSettings: async () => clone(this.settings),
        getIdempotency: async (k) => clone(this.idempotency.get(k) ?? null),
        updateSwag: (t, swag) =>
          writes.push(() => {
            const r = this.registrations.get(t);
            if (!r) throw new Error(`registration ${t} missing`);
            r.swag = clone(swag);
          }),
        updateEligibilityOverride: (t, o) =>
          writes.push(() => {
            const r = this.registrations.get(t);
            if (!r) throw new Error(`registration ${t} missing`);
            r.eligibilityOverride = clone(o);
          }),
        setInventory: (inv) => writes.push(() => (this.inventory = clone(inv))),
        setSettings: (s) => writes.push(() => (this.settings = clone(s))),
        setIdempotency: (k, rec) => writes.push(() => this.idempotency.set(k, clone(rec))),
        addEvent: (e) => {
          const id = e.id ?? randomUUID();
          writes.push(() => this.events.push(clone({ ...e, id })));
          return id;
        },
        bumpLive: () => writes.push(() => this.live++),
      };
      const result = await fn(tx);
      this.faults.beforeCommit?.();
      for (const w of writes) w();
      this.faults.afterCommit?.();
      return result;
    };
    const p = this.lock.then(run, run);
    this.lock = p.catch(() => undefined);
    return p;
  }

  async getSettings() {
    return clone(this.settings);
  }
  async getInventory() {
    return clone(this.inventory);
  }
  async getRegistration(t: string) {
    return clone(this.registrations.get(t) ?? null);
  }
  async findByBarcodeId(id: string) {
    return [...this.registrations.values()].filter((r) => r.barcodeId === id).map(clone);
  }
  async listRegistrations() {
    return [...this.registrations.values()].map(clone);
  }
  async listEvents({ limit, types }: { limit: number; types?: AuditEvent["type"][] }) {
    return this.events
      .filter((e) => !types || types.includes(e.type))
      .sort((a, b) => b.atMs - a.atMs)
      .slice(0, limit)
      .map(clone);
  }
  async addEvent(e: NewAuditEvent) {
    const id = e.id ?? randomUUID();
    this.events.push(clone({ ...e, id }));
    return id;
  }
  async applyImport(records: RegistrationCsvFields[], removed: string[], meta: { importId: string; now: string }) {
    for (const rec of records) {
      const existing = this.registrations.get(rec.ticketNumber);
      const csv = {
        ticketNumber: rec.ticketNumber,
        orderNumber: rec.orderNumber,
        firstName: rec.firstName,
        lastName: rec.lastName,
        email: rec.email,
        ticketTitle: rec.ticketTitle,
        checkinDateUtc: rec.checkinDateUtc,
        barcodeId: rec.barcodeId,
        extra: clone(rec.extra),
      };
      if (existing) {
        Object.assign(existing, csv, { inLatestImport: true, lastImportedAt: meta.now, importId: meta.importId });
      } else {
        this.registrations.set(rec.ticketNumber, {
          ...csv,
          inLatestImport: true,
          firstImportedAt: meta.now,
          lastImportedAt: meta.now,
          importId: meta.importId,
        });
      }
    }
    for (const t of removed) {
      const r = this.registrations.get(t);
      if (r) r.inLatestImport = false;
    }
  }
  async setBarcodeIds(updates: { ticketNumber: string; barcodeId: string | null }[]) {
    for (const u of updates) {
      const r = this.registrations.get(u.ticketNumber);
      if (r) r.barcodeId = u.barcodeId;
    }
  }
  async getLiveVersion() {
    return this.live;
  }
  async bumpLive() {
    this.live++;
  }
  async listStaff() {
    return [...this.staff.values()].map(clone);
  }
  async getStaff(uid: string) {
    return clone(this.staff.get(uid) ?? null);
  }
  async upsertStaff(m: StaffMember) {
    this.staff.set(m.uid, clone(m));
  }
  async removeStaff(uid: string) {
    this.staff.delete(uid);
  }
}
