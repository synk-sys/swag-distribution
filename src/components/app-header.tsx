"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { IS_DEMO } from "@/lib/config";
import { cn } from "@/lib/utils";

const ADMIN_NAV = [
  ["/admin", "Dashboard"],
  ["/admin/import", "Import CSV"],
  ["/admin/validate", "Barcode validation"],
  ["/admin/settings", "Inventory & rules"],
  ["/admin/staff", "Staff"],
  ["/admin/audit", "Audit log"],
] as const;

export function AppHeader({ sub, right }: { sub?: string; right?: React.ReactNode }) {
  const { actor, signOut } = useAuth();
  const path = usePathname();
  const isAdmin = path.startsWith("/admin");
  return (
    <header className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur">
      {IS_DEMO && <div className="bg-g-yellow px-4 py-1 text-center text-xs font-bold text-black">DEMO MODE — fictional attendees, in-memory data, not production</div>}
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2">
        <Link href={actor?.role === "organizer" ? "/admin" : "/scan"} className="min-w-0">
          <Brand sub={sub} />
        </Link>
        <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1.5">
          {right}
          {actor && (
            <Badge variant="muted" className="hidden sm:inline-flex">
              {actor.name} · {actor.role}
            </Badge>
          )}
          <ThemeToggle />
          {actor && (
            <Button variant="ghost" size="icon" onClick={signOut} aria-label="Sign out">
              <LogOut />
            </Button>
          )}
        </div>
      </div>
      {actor?.role === "organizer" && (
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 pb-2 text-sm" aria-label="Organizer">
          <Link href="/scan" className={cn("whitespace-nowrap rounded-md px-3 py-1.5 hover:bg-muted", path === "/scan" && "bg-muted font-semibold")}>
            Scanner
          </Link>
          {IS_DEMO && (
            <Link href="/demo" className={cn("whitespace-nowrap rounded-md px-3 py-1.5 hover:bg-muted", path === "/demo" && "bg-muted font-semibold")}>
              Demo: 2 counters
            </Link>
          )}
          {ADMIN_NAV.map(([href, label]) => (
            <Link key={href} href={href} className={cn("whitespace-nowrap rounded-md px-3 py-1.5 hover:bg-muted", isAdmin && path === href && "bg-muted font-semibold")}>
              {label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
