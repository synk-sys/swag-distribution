"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/components/auth-provider";

export default function Home() {
  const { actor, loading } = useAuth();
  const router = useRouter();
  React.useEffect(() => {
    if (loading) return;
    router.replace(!actor ? "/login" : actor.role === "organizer" ? "/admin" : "/scan");
  }, [actor, loading, router]);
  return (
    <main className="flex min-h-dvh items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin" aria-label="Loading" />
    </main>
  );
}
