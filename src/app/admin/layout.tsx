"use client";
import { AppHeader } from "@/components/app-header";
import { RequireRole } from "@/components/require-role";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireRole roles={["organizer"]}>
      <div className="min-h-dvh">
        <AppHeader sub="Organizer" />
        <main className="mx-auto flex max-w-6xl flex-col gap-4 p-4 pb-16">{children}</main>
      </div>
    </RequireRole>
  );
}
