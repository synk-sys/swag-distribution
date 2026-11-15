/**
 * Runs the real PostgresRepo (row-locking transactions) against a Postgres database.
 * Skipped unless TEST_DATABASE_URL is set. The database is WIPED. Use a throwaway DB:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54322/postgres npm run test:db
 * (`supabase start` exposes a local DB on port 54322.)
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { remainingBags } from "@/lib/domain/types";
import { PostgresRepo } from "@/lib/server/repo/postgres";
import { changeInventory, importCsv, setEligibilityOverride, updateSettings } from "@/lib/server/services/admin";
import { claimSwag, lookupBarcode, reverseClaim } from "@/lib/server/services/claims";
import { csv, key, organizer, row, volA, volB } from "./helpers/fixtures";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("Postgres: real transactions", () => {
  const pool = new Pool({ connectionString: url, max: 30 });
  const repo = new PostgresRepo(pool);
  const T = "GOOGA263469041";

  beforeAll(async () => {
    await pool.query("drop table if exists registrations, inventory, settings, events, idempotency, live_meta, staff cascade");
    await pool.query(readFileSync("supabase/migrations/20261114000001_schema.sql", "utf8"));
  });

  beforeEach(async () => {
    await pool.query("alter table events disable trigger events_no_update");
    await pool.query("truncate registrations, events, idempotency, staff");
    await pool.query("alter table events enable trigger events_no_update");
    await pool.query("update inventory set initial = 0, adjustments = 0, bags_out = 0, active_claims = 0");
    await pool.query("update settings set data = '{}'::jsonb");
    await updateSettings(repo, organizer, {
      barcode: { separator: ":", prefixPattern: "^\\d{1,12}$", idPattern: "^\\d{7}$", suffixLength: 7, prefixPolicy: "enforce", allowedPrefixes: ["132774"], validated: true },
    });
    await importCsv(repo, organizer, csv([row(T, "Grace", "Hopper"), row("GOOGA263469042", "Alan", "Turing"), row("GOOGA263469043", "Kat", "Johnson")]), { dryRun: false });
    await changeInventory(repo, organizer, { kind: "set_initial", value: 300 });
  });

  afterAll(async () => pool.end());

  it("matches the observed barcode 132774:3469041 → GOOGA263469041", async () => {
    const r = await lookupBarcode(repo, volA, "132774:3469041");
    expect(r.status).toBe("ELIGIBLE");
    expect(r.attendee?.ticketNumber).toBe(T);
  });

  it("FINAL ACCEPTANCE: two counters claim simultaneously → exactly one success", async () => {
    const results = await Promise.all([
      claimSwag(repo, volA, { ticketNumber: T, idempotencyKey: key(), counter: "Counter 1", method: "scan" }),
      claimSwag(repo, volB, { ticketNumber: T, idempotencyKey: key(), counter: "Counter 2", method: "scan" }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["ALREADY_COLLECTED", "SUCCESS"]);
    expect(results.find((r) => r.status !== "SUCCESS")!.message).toBe("ALREADY COLLECTED. Do not distribute another bag.");
    expect(remainingBags(await repo.getInventory())).toBe(299);
    expect(await repo.listEvents({ limit: 50, types: ["claim"] })).toHaveLength(1);
  });

  it("25 concurrent attempts on one ticket → exactly one claim", async () => {
    const results = await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        claimSwag(repo, { uid: `v${i}`, name: `V${i}`, role: "volunteer" }, { ticketNumber: T, idempotencyKey: key(), counter: `C${i % 3}`, method: "scan" }),
      ),
    );
    expect(results.filter((r) => r.status === "SUCCESS")).toHaveLength(1);
    expect((await repo.getInventory()).bagsOut).toBe(1);
  });

  it("concurrent claims for different attendees never oversell the last bag", async () => {
    await changeInventory(repo, organizer, { kind: "set_initial", value: 1 });
    const results = await Promise.all(
      [T, "GOOGA263469042", "GOOGA263469043"].map((t, i) =>
        claimSwag(repo, { uid: `v${i}`, name: "v", role: "volunteer" }, { ticketNumber: t, idempotencyKey: key(), counter: `C${i}`, method: "scan" }),
      ),
    );
    expect(results.filter((r) => r.status === "SUCCESS")).toHaveLength(1);
    expect(results.filter((r) => r.status === "OUT_OF_STOCK")).toHaveLength(2);
    expect(remainingBags(await repo.getInventory())).toBe(0);
  });

  it("the same request sent twice concurrently (retry storm) records one claim and both get SUCCESS", async () => {
    const input = { ticketNumber: T, idempotencyKey: key(), counter: "C1", method: "scan" as const };
    const [a, b] = await Promise.all([claimSwag(repo, volA, input), claimSwag(repo, volA, input)]);
    expect([a.status, b.status]).toEqual(["SUCCESS", "SUCCESS"]);
    expect([a.replayed, b.replayed].filter(Boolean)).toHaveLength(1);
    expect((await repo.getInventory()).bagsOut).toBe(1);
  });

  it("reimport preserves claims and overrides", async () => {
    const c = await claimSwag(repo, volA, { ticketNumber: T, idempotencyKey: key(), counter: "C1", method: "scan" });
    await setEligibilityOverride(repo, organizer, { ticketNumber: "GOOGA263469043", value: "ineligible", reason: "Refunded" });
    await importCsv(repo, organizer, csv([row(T, "Grace", "Hopper-Renamed"), row("GOOGA263469043", "Kat", "Johnson")]), { dryRun: false });
    const reg = await repo.getRegistration(T);
    expect(reg?.lastName).toBe("Hopper-Renamed");
    expect(reg?.swag).toMatchObject({ status: "claimed", claimId: c.claim!.claimId });
    expect((await repo.getRegistration("GOOGA263469043"))?.eligibilityOverride?.value).toBe("ineligible");
    expect((await repo.getRegistration("GOOGA263469042"))?.inLatestImport).toBe(false);
  });

  it("reversal keeps history; audit events cannot be modified or deleted", async () => {
    const c = await claimSwag(repo, volA, { ticketNumber: T, idempotencyKey: key(), counter: "C1", method: "scan" });
    await reverseClaim(repo, organizer, { ticketNumber: T, claimId: c.claim!.claimId, reason: "Wrong attendee", bagReturned: true, confirm: true });
    const events = await repo.listEvents({ limit: 50, types: ["claim", "claim_reversed"] });
    expect(events.map((e) => e.type).sort()).toEqual(["claim", "claim_reversed"]);
    expect(remainingBags(await repo.getInventory())).toBe(300);
    await expect(pool.query("delete from events")).rejects.toThrow(/append-only/);
    await expect(pool.query("update events set type = 'x'")).rejects.toThrow(/append-only/);
  });

  it("the database itself refuses negative inventory", async () => {
    await expect(pool.query("update inventory set bags_out = 301 where id = 1")).rejects.toThrow(/inventory_not_negative/);
  });

  it("row level security is enabled on every table", async () => {
    const r = await pool.query(
      "select relname, relrowsecurity from pg_class where relname = any($1) and relkind = 'r'",
      [["registrations", "inventory", "settings", "events", "idempotency", "live_meta", "staff"]],
    );
    expect(r.rows).toHaveLength(7);
    expect(r.rows.every((x) => x.relrowsecurity)).toBe(true);
  });
});
