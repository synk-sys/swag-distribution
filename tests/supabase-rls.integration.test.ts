/**
 * Applies BOTH migrations to a plain Postgres with minimal stand-ins for Supabase's
 * auth schema, API roles and realtime publication, then checks what the browser-facing
 * roles (anon / authenticated) can and cannot do. Skipped unless TEST_DATABASE_URL is set.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

const url = process.env.TEST_DATABASE_URL;
const STAFF = "11111111-1111-1111-1111-111111111111";
const STRANGER = "22222222-2222-2222-2222-222222222222";

describe.skipIf(!url)("Supabase migrations: RLS and grants", () => {
  // Use a dedicated throwaway database so tables live in `public`, exactly like Supabase.
  const dbName = "swag_rls_test";
  const testUrl = url ? url.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`) : "";
  const db = new Client({ connectionString: testUrl });

  beforeAll(async () => {
    const admin = new Client({ connectionString: url });
    await admin.connect();
    await admin.query(`drop database if exists ${dbName} with (force)`);
    await admin.query(`create database ${dbName}`);
    await admin.end();
    await db.connect();
    await db.query(`
      do $$ begin
        if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
      end $$;
      create schema if not exists auth;
      create table if not exists auth.users (id uuid primary key);
      create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;
      do $$ begin
        if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then create publication supabase_realtime; end if;
      end $$;
    `);
    await db.query(readFileSync("supabase/migrations/20261114000001_schema.sql", "utf8"));
    // Supabase grants table privileges to API roles by default; simulate that, then let the migration revoke.
    await db.query("grant usage on schema public to anon, authenticated; grant all on all tables in schema public to anon, authenticated");
    await db.query(readFileSync("supabase/migrations/20261114000002_supabase_auth_realtime.sql", "utf8"));
    await db.query(`insert into auth.users values ('${STAFF}'), ('${STRANGER}') on conflict do nothing`);
    await db.query(`insert into staff (user_id, email, display_name, role, added_by) values ('${STAFF}', 's@example.com', 'S', 'volunteer', 'test')`);
    await db.query(`insert into registrations (ticket_number, first_name) values ('GOOGA263469041', 'Grace')`);
  });

  afterAll(async () => {
    await db.end();
    const admin = new Client({ connectionString: url });
    await admin.connect();
    await admin.query(`drop database if exists ${dbName} with (force)`).catch(() => undefined);
    await admin.end();
  });

  async function as(role: "anon" | "authenticated", sub: string | null, sql: string) {
    await db.query("begin");
    try {
      await db.query(`set local role ${role}`);
      await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [sub ?? ""]);
      return await db.query(sql);
    } finally {
      await db.query("rollback");
    }
  }

  it("anon cannot read anything", async () => {
    await expect(as("anon", null, "select * from registrations")).rejects.toThrow(/permission denied/);
    await expect(as("anon", null, "select * from live_meta")).rejects.toThrow(/permission denied/);
  });

  it("signed-in staff can read only the live counter", async () => {
    expect((await as("authenticated", STAFF, "select version from live_meta")).rows).toHaveLength(1);
    for (const t of ["registrations", "events", "inventory", "staff", "idempotency", "settings"]) {
      await expect(as("authenticated", STAFF, `select * from ${t}`)).rejects.toThrow(/permission denied/);
    }
  });

  it("signed-in non-staff see no live counter rows", async () => {
    expect((await as("authenticated", STRANGER, "select version from live_meta")).rows).toHaveLength(0);
  });

  it("no browser role can write", async () => {
    await expect(as("authenticated", STAFF, "update live_meta set version = 0")).rejects.toThrow(/permission denied/);
    await expect(as("authenticated", STAFF, "update registrations set swag = null")).rejects.toThrow(/permission denied/);
    await expect(as("authenticated", STAFF, "update inventory set initial = 9999")).rejects.toThrow(/permission denied/);
  });

  it("live_meta is published to Supabase Realtime", async () => {
    const r = await db.query("select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'live_meta'");
    expect(r.rows).toHaveLength(1);
  });
});
