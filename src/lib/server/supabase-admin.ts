import "server-only";
import { Pool } from "pg";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only connections to Supabase.
 *  - DATABASE_URL: Postgres connection string (Supabase → Connect → Transaction pooler, port 6543,
 *    or Session pooler / direct connection). Used for all data access with real transactions.
 *  - SUPABASE_SERVICE_ROLE_KEY: used ONLY to verify access tokens and manage staff Auth users.
 *    Never expose it to the browser.
 */
type G = typeof globalThis & { __pgPool?: Pool; __sbAdmin?: SupabaseClient };
const g = globalThis as G;

export function getPool(): Pool {
  if (!g.__pgPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set (see .env.example).");
    const local = /localhost|127\.0\.0\.1/.test(connectionString);
    g.__pgPool = new Pool({
      connectionString,
      max: Number(process.env.PG_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: local ? undefined : { rejectUnauthorized: false },
    });
    g.__pgPool.on("error", (e) => console.error("[pg] idle client error", e));
  }
  return g.__pgPool;
}

export function getSupabaseAdmin(): SupabaseClient {
  if (!g.__sbAdmin) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
    g.__sbAdmin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return g.__sbAdmin;
}
