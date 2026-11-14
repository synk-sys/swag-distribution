"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import type { Role } from "@/lib/domain/types";

/** UI guard only. Real enforcement happens on every API route. */
export function RequireRole({ roles, children }: { roles: Role[]; children: React.ReactNode }) {
  const { actor, loading, error } = useAuth();
  const router = useRouter();
  React.useEffect(() => {
    if (!loading && !actor && !error) router.replace("/login");
  }, [loading, actor, error, router]);

  if (loading || (!actor && !error)) {
    return (
      <div className="flex min-h-[60dvh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" aria-label="Loading" />
      </div>
    );
  }
  if (!actor || !roles.includes(actor.role)) {
    return (
      <div className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-xl font-bold">No access</h1>
        <p className="text-muted-foreground">{error ?? "Your role does not allow access to this page."}</p>
        <Button asChild variant="outline">
          <Link href={actor ? "/scan" : "/login"}>{actor ? "Go to scanner" : "Sign in"}</Link>
        </Button>
      </div>
    );
  }
  return <>{children}</>;
}
