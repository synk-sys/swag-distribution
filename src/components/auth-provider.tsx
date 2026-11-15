"use client";
import * as React from "react";
import { APP_MODE, IS_DEMO } from "@/lib/config";
import type { Actor } from "@/lib/domain/types";
import { api, ApiError, setTokenProvider } from "@/lib/client/api";

interface AuthState {
  actor: Actor | null;
  loading: boolean;
  error: string | null;
  mode: typeof APP_MODE;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = React.createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [actor, setActor] = React.useState<Actor | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const loadMe = React.useCallback(async () => {
    try {
      const me = await api<{ actor: Actor }>("/api/me", { retries: 1 });
      setActor(me.actor);
      setError(null);
    } catch (e) {
      setActor(null);
      setError(e instanceof ApiError && e.status === 403 ? e.message : null);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (IS_DEMO) {
      void loadMe();
      return;
    }
    let unsub = () => {};
    void (async () => {
      const { supabaseBrowser } = await import("@/lib/client/supabase");
      const sb = supabaseBrowser();
      setTokenProvider(async (force) => {
        if (force) return (await sb.auth.refreshSession()).data.session?.access_token ?? null;
        return (await sb.auth.getSession()).data.session?.access_token ?? null;
      });
      let lastUser: string | null = null;
      const { data } = sb.auth.onAuthStateChange((_event, session) => {
        const uid = session?.user.id ?? null;
        if (uid === lastUser && uid !== null) return; // token refresh: nothing to reload
        lastUser = uid;
        // No organizer session? A counter device may still have a counter cookie.
        void loadMe();
      });
      unsub = () => data.subscription.unsubscribe();
    })().catch((e) => {
      setError(String(e?.message ?? e));
      setLoading(false);
    });
    return () => unsub();
  }, [loadMe]);

  const signOut = React.useCallback(async () => {
    await fetch("/api/volunteer/session", { method: "DELETE" });
    if (IS_DEMO) await fetch("/api/demo/session", { method: "DELETE" });
    else {
      const { supabaseBrowser } = await import("@/lib/client/supabase");
      await supabaseBrowser().auth.signOut();
    }
    const wasOrganizer = actor?.role === "organizer";
    setActor(null);
    window.location.href = wasOrganizer ? "/admin" : "/login";
  }, [actor]);

  return <Ctx.Provider value={{ actor, loading, error, mode: APP_MODE, refresh: loadMe, signOut }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = React.useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}
