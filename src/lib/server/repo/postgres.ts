import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  DEFAULT_SETTINGS,
  EMPTY_INVENTORY,
  settingsSchema,
  type AuditEvent,
  type AuditEventType,
  type Inventory,
  type Registration,
  type RegistrationCsvFields,
  type Settings,
} from "@/lib/domain/types";
import type { NewAuditEvent, Repo, StaffMember, Tx } from "./types";

/**
 * Supabase Postgres repository (direct connection via node-postgres).
 *
 * Concurrency: each transaction locks the rows it will change with
 * SELECT … FOR UPDATE (registration first, then inventory, always in that
 * order, so there are no deadlocks). A second counter claiming the same ticket
 * blocks on the registration lock, then re-reads the committed row, sees it
 * claimed, and returns ALREADY_COLLECTED. A CHECK constraint on inventory makes
 * overselling impossible even if application logic were wrong.
 */

type Row = Record<string, unknown>;
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string));

function toRegistration(r: Row): Registration {
  return {
    ticketNumber: r.ticket_number as string,
    orderNumber: r.order_number as string,
    firstName: r.first_name as string,
    lastName: r.last_name as string,
    email: r.email as string,
    ticketTitle: r.ticket_title as string,
    checkinDateUtc: (r.checkin_date_utc as string) ?? null,
    barcodeId: (r.barcode_id as string) ?? null,
    extra: (r.extra as Record<string, string>) ?? {},
    inLatestImport: r.in_latest_import as boolean,
    firstImportedAt: iso(r.first_imported_at),
    lastImportedAt: iso(r.last_imported_at),
    importId: r.import_id as string,
    eligibilityOverride: (r.eligibility_override as Registration["eligibilityOverride"]) ?? null,
    ...(r.swag ? { swag: r.swag as Registration["swag"] } : {}),
  };
}

function toInventory(r: Row | undefined): Inventory {
  if (!r) return { ...EMPTY_INVENTORY };
  return { initial: r.initial as number, adjustments: r.adjustments as number, bagsOut: r.bags_out as number, activeClaims: r.active_claims as number };
}

function toSettings(data: unknown): Settings {
  const merged = { ...structuredClone(DEFAULT_SETTINGS), ...((data as object) ?? {}) };
  const parsed = settingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : structuredClone(DEFAULT_SETTINGS);
}

function toEvent(r: Row): AuditEvent {
  return {
    id: r.id as string,
    type: r.type as AuditEventType,
    at: iso(r.at),
    atMs: Number(r.at_ms),
    actor: r.actor as AuditEvent["actor"],
    ticketNumber: (r.ticket_number as string) ?? null,
    counter: (r.counter as string) ?? null,
    claimId: (r.claim_id as string) ?? null,
    details: (r.details as Record<string, unknown>) ?? undefined,
  };
}

const INSERT_EVENT = `insert into events (id, type, at, at_ms, actor, ticket_number, counter, claim_id, details)
  values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`;
const eventParams = (e: NewAuditEvent, id: string) => [
  id,
  e.type,
  e.at,
  e.atMs,
  JSON.stringify(e.actor),
  e.ticketNumber ?? null,
  e.counter ?? null,
  e.claimId ?? null,
  e.details ? JSON.stringify(e.details) : null,
];
const BUMP_LIVE = `update live_meta set version = version + 1, updated_at = now() where id = 1`;

// Deadlock / serialization failure / lock timeout: safe to retry the whole transaction.
const RETRYABLE = new Set(["40001", "40P01", "55P03"]);

export class PostgresRepo implements Repo {
  readonly kind = "postgres" as const;
  constructor(private pool: Pool) {}

  async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      const client = await this.pool.connect();
      try {
        await client.query("begin");
        await client.query("set local lock_timeout = '10s'");
        const result = await this.runTx(client, fn);
        await client.query("commit");
        return result;
      } catch (e) {
        await client.query("rollback").catch(() => undefined);
        const code = (e as { code?: string }).code;
        if (code && RETRYABLE.has(code) && attempt < 5) continue;
        throw e;
      } finally {
        client.release();
      }
    }
  }

  private async runTx<T>(client: PoolClient, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const writes: [string, unknown[]][] = [];
    const tx: Tx = {
      getRegistration: async (t) => {
        const r = await client.query("select * from registrations where ticket_number = $1 for update", [t]);
        return r.rows[0] ? toRegistration(r.rows[0]) : null;
      },
      getInventory: async () => toInventory((await client.query("select * from inventory where id = 1 for update")).rows[0]),
      getSettings: async () => toSettings((await client.query("select data from settings where id = 1")).rows[0]?.data),
      getIdempotency: async (key) => {
        const r = await client.query("select * from idempotency where key = $1 and expires_at > now()", [key]);
        const row = r.rows[0];
        return row ? { uid: row.uid, ticketNumber: row.ticket_number, result: row.result, createdAt: iso(row.created_at), expiresAt: iso(row.expires_at) } : null;
      },
      updateSwag: (t, swag) => writes.push(["update registrations set swag = $2 where ticket_number = $1", [t, JSON.stringify(swag)]]),
      updateEligibilityOverride: (t, o) =>
        writes.push(["update registrations set eligibility_override = $2 where ticket_number = $1", [t, o ? JSON.stringify(o) : null]]),
      setInventory: (inv) =>
        writes.push([
          "update inventory set initial = $1, adjustments = $2, bags_out = $3, active_claims = $4 where id = 1",
          [inv.initial, inv.adjustments, inv.bagsOut, inv.activeClaims],
        ]),
      setSettings: (s) => writes.push(["update settings set data = $1 where id = 1", [JSON.stringify(s)]]),
      setIdempotency: (key, rec) =>
        writes.push([
          // Expired keys are replaced; live keys are never overwritten.
          `insert into idempotency (key, uid, ticket_number, result, created_at, expires_at) values ($1, $2, $3, $4, $5, $6)
           on conflict (key) do update set uid = excluded.uid, ticket_number = excluded.ticket_number, result = excluded.result,
             created_at = excluded.created_at, expires_at = excluded.expires_at
           where idempotency.expires_at <= now()`,
          [key, rec.uid, rec.ticketNumber, JSON.stringify(rec.result), rec.createdAt, rec.expiresAt],
        ]),
      addEvent: (e) => {
        const id = e.id ?? randomUUID();
        writes.push([INSERT_EVENT, eventParams(e, id)]);
        return id;
      },
      bumpLive: () => writes.push([BUMP_LIVE, []]),
    };
    const result = await fn(tx);
    for (const [sql, params] of writes) await client.query(sql, params);
    return result;
  }

  async getSettings() {
    return toSettings((await this.pool.query("select data from settings where id = 1")).rows[0]?.data);
  }
  async getInventory() {
    return toInventory((await this.pool.query("select * from inventory where id = 1")).rows[0]);
  }
  async getRegistration(t: string) {
    const r = await this.pool.query("select * from registrations where ticket_number = $1", [t]);
    return r.rows[0] ? toRegistration(r.rows[0]) : null;
  }
  async findByBarcodeId(id: string) {
    const r = await this.pool.query("select * from registrations where barcode_id = $1 limit 5", [id]);
    return r.rows.map(toRegistration);
  }
  async listRegistrations() {
    return (await this.pool.query("select * from registrations")).rows.map(toRegistration);
  }
  async listEvents({ limit, types }: { limit: number; types?: AuditEventType[] }) {
    const r = types?.length
      ? await this.pool.query("select * from events where type = any($1) order by at_ms desc limit $2", [types, limit])
      : await this.pool.query("select * from events order by at_ms desc limit $1", [limit]);
    return r.rows.map(toEvent);
  }
  async addEvent(e: NewAuditEvent) {
    const id = e.id ?? randomUUID();
    await this.pool.query(INSERT_EVENT, eventParams(e, id));
    return id;
  }

  async applyImport(records: RegistrationCsvFields[], removed: string[], meta: { importId: string; now: string }) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      // Upsert ONLY CSV fields. swag and eligibility_override are never in the update list.
      const CHUNK = 1000;
      for (let i = 0; i < records.length; i += CHUNK) {
        const rows = records.slice(i, i + CHUNK).map((r) => ({
          ticket_number: r.ticketNumber,
          order_number: r.orderNumber,
          first_name: r.firstName,
          last_name: r.lastName,
          email: r.email,
          ticket_title: r.ticketTitle,
          checkin_date_utc: r.checkinDateUtc,
          barcode_id: r.barcodeId,
          extra: r.extra,
        }));
        await client.query(
          `insert into registrations (ticket_number, order_number, first_name, last_name, email, ticket_title, checkin_date_utc,
             barcode_id, extra, in_latest_import, first_imported_at, last_imported_at, import_id)
           select x.ticket_number, x.order_number, x.first_name, x.last_name, x.email, x.ticket_title, x.checkin_date_utc,
             x.barcode_id, coalesce(x.extra, '{}'::jsonb), true, $2, $2, $3
           from jsonb_to_recordset($1::jsonb) as x(ticket_number text, order_number text, first_name text, last_name text,
             email text, ticket_title text, checkin_date_utc text, barcode_id text, extra jsonb)
           on conflict (ticket_number) do update set
             order_number = excluded.order_number, first_name = excluded.first_name, last_name = excluded.last_name,
             email = excluded.email, ticket_title = excluded.ticket_title, checkin_date_utc = excluded.checkin_date_utc,
             barcode_id = excluded.barcode_id, extra = excluded.extra, in_latest_import = true,
             last_imported_at = excluded.last_imported_at, import_id = excluded.import_id`,
          [JSON.stringify(rows), meta.now, meta.importId],
        );
      }
      if (removed.length) await client.query("update registrations set in_latest_import = false where ticket_number = any($1)", [removed]);
      await client.query("commit");
    } catch (e) {
      await client.query("rollback").catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  async setBarcodeIds(updates: { ticketNumber: string; barcodeId: string | null }[]) {
    if (!updates.length) return;
    await this.pool.query(
      `update registrations r set barcode_id = x.barcode_id
       from jsonb_to_recordset($1::jsonb) as x(ticket_number text, barcode_id text)
       where r.ticket_number = x.ticket_number`,
      [JSON.stringify(updates.map((u) => ({ ticket_number: u.ticketNumber, barcode_id: u.barcodeId })))],
    );
  }

  async getLiveVersion() {
    return Number((await this.pool.query("select version from live_meta where id = 1")).rows[0]?.version ?? 0);
  }
  async bumpLive() {
    await this.pool.query(BUMP_LIVE);
  }

  async listStaff(): Promise<StaffMember[]> {
    const r = await this.pool.query("select * from staff order by role, display_name");
    return r.rows.map((s) => ({ uid: s.user_id, email: s.email, displayName: s.display_name, role: s.role, addedBy: s.added_by, addedAt: iso(s.added_at) }));
  }
  async getStaff(uid: string): Promise<StaffMember | null> {
    const r = await this.pool.query("select * from staff where user_id = $1", [uid]);
    const s = r.rows[0];
    return s ? { uid: s.user_id, email: s.email, displayName: s.display_name, role: s.role, addedBy: s.added_by, addedAt: iso(s.added_at) } : null;
  }
  async upsertStaff(m: StaffMember) {
    await this.pool.query(
      `insert into staff (user_id, email, display_name, role, added_by, added_at) values ($1, $2, $3, $4, $5, $6)
       on conflict (user_id) do update set email = excluded.email, display_name = excluded.display_name, role = excluded.role,
         added_by = excluded.added_by, added_at = excluded.added_at`,
      [m.uid, m.email, m.displayName, m.role, m.addedBy, m.addedAt],
    );
  }
  async removeStaff(uid: string) {
    await this.pool.query("delete from staff where user_id = $1", [uid]);
  }

  async purgeExpiredIdempotency() {
    await this.pool.query("delete from idempotency where expires_at <= now()");
  }
}
