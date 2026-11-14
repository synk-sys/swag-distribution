"use client";
import * as React from "react";
import { Loader2, Trash2, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/components/auth-provider";
import { api } from "@/lib/client/api";
import { IS_DEMO } from "@/lib/config";

interface Staff {
  uid: string;
  email: string;
  displayName: string;
  role: "organizer" | "volunteer";
  addedBy: string;
  addedAt: string;
}

export default function StaffPage() {
  const { actor } = useAuth();
  const [staff, setStaff] = React.useState<Staff[] | null>(null);
  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");
  const [role, setRole] = React.useState<"volunteer" | "organizer">("volunteer");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);

  const load = React.useCallback(async () => setStaff((await api<{ staff: Staff[] }>("/api/admin/staff")).staff), []);
  React.useEffect(() => void load(), [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/admin/staff", { body: { email, displayName: name, role } });
      setMsg({ ok: true, text: `${email} can now sign in as ${role}. They can use Google sign-in or “Set or reset password” on the login page.` });
      setEmail("");
      setName("");
      await load();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function remove(s: Staff) {
    if (!confirm(`Remove access for ${s.email}? They will be signed out.`)) return;
    try {
      await api(`/api/admin/staff?uid=${encodeURIComponent(s.uid)}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Add volunteer or organizer</CardTitle>
          <CardDescription>Roles are Firebase Auth custom claims, enforced on the server and in Firestore rules. Volunteers can scan and confirm only.</CardDescription>
        </CardHeader>
        <CardContent>
          {IS_DEMO ? (
            <p className="text-sm text-muted-foreground">Staff management is disabled in demo mode (fictional demo identities are fixed).</p>
          ) : (
            <form onSubmit={add} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="s-email">Email</Label>
                <Input id="s-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="s-name">Display name</Label>
                <Input id="s-name" required value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as "volunteer")} className="h-10 rounded-md border border-input bg-card px-3 text-sm">
                <option value="volunteer">Volunteer</option>
                <option value="organizer">Organizer</option>
              </select>
              <Button type="submit" disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <UserPlus />} Add
              </Button>
            </form>
          )}
          {msg && <p className={`mt-3 rounded-md p-3 text-sm font-medium ${msg.ok ? "bg-ok text-ok-fg" : "bg-bad text-bad-fg"}`}>{msg.text}</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Staff ({staff?.length ?? "…"})</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col divide-y">
            {staff?.map((s) => (
              <li key={s.uid} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{s.displayName}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {s.email} · added by {s.addedBy}
                  </p>
                </div>
                <Badge variant={s.role === "organizer" ? "default" : "muted"}>{s.role}</Badge>
                {!IS_DEMO && s.uid !== actor?.uid && (
                  <Button variant="ghost" size="icon" aria-label={`Remove ${s.email}`} onClick={() => remove(s)}>
                    <Trash2 />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
