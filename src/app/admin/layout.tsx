"use client";
import { Loader2 } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { useAuth } from "@/components/auth-provider";
import { OrganizerSignIn } from "@/components/organizer-sign-in";

/** Any /admin link: organizers see the page, everyone else sees organizer sign-in. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { actor, loading } = useAuth();
  if (loading)
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" aria-label="Loading" />
      </div>
    );
  if (actor?.role !== "organizer") return <OrganizerSignIn />;
  return (
    <div className="min-h-dvh">
      <AppHeader sub="Organizer" />
      <main className="mx-auto flex max-w-6xl flex-col gap-4 p-4 pb-16">{children}</main>
    </div>
  );
}
