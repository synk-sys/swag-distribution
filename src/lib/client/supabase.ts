"use client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseClientConfig } from "@/lib/config";

let client: SupabaseClient | undefined;

/** Browser Supabase client: Auth sessions + Realtime only. It never reads attendee data. */
export function supabaseBrowser(): SupabaseClient {
  if (!client) {
    if (!supabaseClientConfig.url || !supabaseClientConfig.anonKey) {
      throw new Error("Supabase config missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (see .env.example).");
    }
    client = createClient(supabaseClientConfig.url, supabaseClientConfig.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }
  return client;
}
