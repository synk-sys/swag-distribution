/**
 * App mode. "demo" runs fully in memory with fictional attendees and never
 * touches Supabase. "production" requires Supabase (Auth + Postgres + Realtime).
 */
export type AppMode = "demo" | "production";

export const APP_MODE: AppMode = process.env.NEXT_PUBLIC_APP_MODE === "production" ? "production" : "demo";
export const IS_DEMO = APP_MODE === "demo";

export const supabaseClientConfig = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
};

export const EVENT_NAME = "DevFest Toronto 2026";
export const SWAG_NAME = "Standard DevFest Toronto Swag Bag";
