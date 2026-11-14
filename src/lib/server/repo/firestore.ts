import { randomUUID } from "node:crypto";
import { FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore";
import {
  DEFAULT_SETTINGS,
  EMPTY_INVENTORY,
  settingsSchema,
  type AuditEvent,
  type AuditEventType,
  type IdempotencyRecord,
  type Inventory,
  type Registration,
  type RegistrationCsvFields,
  type Settings,
} from "@/lib/domain/types";
import type { NewAuditEvent, Repo, StaffMember, Tx } from "./types";

export const COL = {
  registrations: "registrations",
  events: "events",
  idempotency: "idempotency",
  config: "config",
  inventory: "inventory",
  meta: "meta",
  staff: "staff",
} as const;

const CSV_FIELDS = [
  "ticketNumber",
  "orderNumber",
  "firstName",
  "lastName",
  "email",
  "ticketTitle",
  "checkinDateUtc",
  "barcodeId",
  "extra",
  "inLatestImport",
  "lastImportedAt",
  "importId",
] as const;

function parseSettings(data: unknown): Settings {
  if (!data) return structuredClone(DEFAULT_SETTINGS);
  const merged = { ...structuredClone(DEFAULT_SETTINGS), ...(data as object) };
  const parsed = settingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : structuredClone(DEFAULT_SETTINGS);
}

function parseInventory(data: unknown): Inventory {
  return { ...EMPTY_INVENTORY, ...((data as Partial<Inventory>) ?? {}) };
}

export class FirestoreRepo implements Repo {
  readonly kind = "firestore" as const;
  constructor(private db: Firestore) {}

  private reg(t: string) {
    return this.db.collection(COL.registrations).doc(t);
  }
  private get invRef() {
    return this.db.collection(COL.inventory).doc("swag");
  }
  private get settingsRef() {
    return this.db.collection(COL.config).doc("settings");
  }
  private get liveRef() {
    return this.db.collection(COL.meta).doc("live");
  }

  async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.runTransaction(
      async (t: Transaction) => {
        // Firestore requires all reads before writes, so writes are buffered and
        // flushed after the callback finishes reading and deciding.
        const writes: ((t: Transaction) => void)[] = [];
        const tx: Tx = {
          getRegistration: async (ticket) => {
            const s = await t.get(this.reg(ticket));
            return s.exists ? (s.data() as Registration) : null;
          },
          getInventory: async () => parseInventory((await t.get(this.invRef)).data()),
          getSettings: async () => parseSettings((await t.get(this.settingsRef)).data()),
          getIdempotency: async (key) => {
            const s = await t.get(this.db.collection(COL.idempotency).doc(key));
            return s.exists ? (s.data() as IdempotencyRecord) : null;
          },
          updateSwag: (ticket, swag) => writes.push((t) => t.update(this.reg(ticket), { swag })),
          updateEligibilityOverride: (ticket, o) =>
            writes.push((t) => t.update(this.reg(ticket), { eligibilityOverride: o })),
          setInventory: (inv) => writes.push((t) => t.set(this.invRef, inv)),
          setSettings: (s) => writes.push((t) => t.set(this.settingsRef, s)),
          setIdempotency: (key, rec) =>
            writes.push((t) =>
              t.create(this.db.collection(COL.idempotency).doc(key), {
                ...rec,
                // Optional Firestore TTL policy on `expireAt` cleans these up.
                expireAt: new Date(rec.expiresAt),
              }),
            ),
          addEvent: (e) => {
            const id = e.id ?? randomUUID();
            writes.push((t) => t.create(this.db.collection(COL.events).doc(id), { ...e, id }));
            return id;
          },
          bumpLive: () =>
            writes.push((t) =>
              t.set(this.liveRef, { version: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() }, { merge: true }),
            ),
        };
        const result = await fn(tx);
        for (const w of writes) w(t);
        return result;
      },
      { maxAttempts: 10 },
    );
  }

  async getSettings() {
    return parseSettings((await this.settingsRef.get()).data());
  }
  async getInventory() {
    return parseInventory((await this.invRef.get()).data());
  }
  async getRegistration(t: string) {
    const s = await this.reg(t).get();
    return s.exists ? (s.data() as Registration) : null;
  }
  async findByBarcodeId(id: string) {
    const q = await this.db.collection(COL.registrations).where("barcodeId", "==", id).limit(5).get();
    return q.docs.map((d) => d.data() as Registration);
  }
  async listRegistrations() {
    const q = await this.db.collection(COL.registrations).get();
    return q.docs.map((d) => d.data() as Registration);
  }
  async listEvents({ limit, types }: { limit: number; types?: AuditEventType[] }) {
    let q = this.db.collection(COL.events).orderBy("atMs", "desc");
    if (types?.length) q = this.db.collection(COL.events).where("type", "in", types).orderBy("atMs", "desc");
    const s = await q.limit(limit).get();
    return s.docs.map((d) => d.data() as AuditEvent);
  }
  async addEvent(e: NewAuditEvent) {
    const id = e.id ?? randomUUID();
    await this.db.collection(COL.events).doc(id).create({ ...e, id });
    return id;
  }

  async applyImport(records: RegistrationCsvFields[], removed: string[], meta: { importId: string; now: string }) {
    const existing = new Set((await this.db.collection(COL.registrations).select().get()).docs.map((d) => d.id));
    const writer = this.db.bulkWriter();
    writer.onWriteError((err) => err.failedAttempts < 5);
    for (const rec of records) {
      const data: Record<string, unknown> = {
        ...rec,
        inLatestImport: true,
        lastImportedAt: meta.now,
        importId: meta.importId,
      };
      const fields: string[] = [...CSV_FIELDS];
      if (!existing.has(rec.ticketNumber)) {
        data.firstImportedAt = meta.now;
        fields.push("firstImportedAt");
      }
      // mergeFields replaces ONLY these top-level fields; `swag` and
      // `eligibilityOverride` are never part of an import write.
      void writer.set(this.reg(rec.ticketNumber), data, { mergeFields: fields });
    }
    for (const t of removed) void writer.update(this.reg(t), { inLatestImport: false });
    await writer.close();
  }

  async setBarcodeIds(updates: { ticketNumber: string; barcodeId: string | null }[]) {
    const writer = this.db.bulkWriter();
    for (const u of updates) void writer.update(this.reg(u.ticketNumber), { barcodeId: u.barcodeId });
    await writer.close();
  }

  async getLiveVersion() {
    return ((await this.liveRef.get()).data()?.version as number) ?? 0;
  }
  async bumpLive() {
    await this.liveRef.set({ version: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }

  async listStaff() {
    return (await this.db.collection(COL.staff).get()).docs.map((d) => d.data() as StaffMember);
  }
  async upsertStaff(m: StaffMember) {
    await this.db.collection(COL.staff).doc(m.uid).set(m);
  }
  async removeStaff(uid: string) {
    await this.db.collection(COL.staff).doc(uid).delete();
  }
}
