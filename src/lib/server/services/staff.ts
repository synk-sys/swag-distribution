import "server-only";
import { z } from "zod";
import { IS_DEMO } from "@/lib/config";
import type { Actor } from "@/lib/domain/types";
import { clearStaffCache } from "../auth";
import { badRequest } from "../errors";
import type { Repo } from "../repo/types";
import { assertRole } from "./authz";

export const staffInputSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  displayName: z.string().trim().min(1).max(80),
  role: z.enum(["organizer", "volunteer"]),
});

export async function listStaff(repo: Repo, actor: Actor | null) {
  assertRole(actor, "organizer");
  return repo.listStaff();
}

async function findAuthUserId(email: string): Promise<string | null> {
  const { getSupabaseAdmin } = await import("../supabase-admin");
  const admin = getSupabaseAdmin().auth.admin;
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

/**
 * Grants a role by writing the `staff` table (the server reads roles from it on
 * every request). If the person has no Supabase Auth account yet, they are sent
 * an invite email to set a password.
 */
export async function addStaff(repo: Repo, actor: Actor | null, raw: unknown) {
  assertRole(actor, "organizer");
  const p = staffInputSchema.safeParse(raw);
  if (!p.success) throw badRequest("Enter a valid email, name and role.");
  if (IS_DEMO) throw badRequest("Staff management is disabled in demo mode.");
  const { getSupabaseAdmin } = await import("../supabase-admin");
  let uid = await findAuthUserId(p.data.email);
  let invited = false;
  if (!uid) {
    const site = process.env.NEXT_PUBLIC_SITE_URL;
    const { data, error } = await getSupabaseAdmin().auth.admin.inviteUserByEmail(p.data.email, {
      data: { display_name: p.data.displayName },
      ...(site ? { redirectTo: `${site.replace(/\/$/, "")}/reset-password` } : {}),
    });
    if (error || !data.user) throw badRequest(`Could not invite ${p.data.email}: ${error?.message ?? "unknown error"}`);
    uid = data.user.id;
    invited = true;
  }
  const now = new Date();
  await repo.upsertStaff({ uid, email: p.data.email, displayName: p.data.displayName, role: p.data.role, addedBy: actor.name, addedAt: now.toISOString() });
  clearStaffCache();
  await repo.addEvent({ type: "staff_change", at: now.toISOString(), atMs: now.getTime(), actor: { uid: actor.uid, name: actor.name, role: actor.role }, details: { action: "grant", email: p.data.email, role: p.data.role, invited } });
  return { uid, invited };
}

export async function removeStaff(repo: Repo, actor: Actor | null, uid: string) {
  assertRole(actor, "organizer");
  if (IS_DEMO) throw badRequest("Staff management is disabled in demo mode.");
  if (!uid || uid === actor.uid) throw badRequest("You cannot remove your own access.");
  const existing = await repo.getStaff(uid);
  if (!existing) throw badRequest("Not a staff member.");
  await repo.removeStaff(uid);
  clearStaffCache();
  const now = new Date();
  await repo.addEvent({ type: "staff_change", at: now.toISOString(), atMs: now.getTime(), actor: { uid: actor.uid, name: actor.name, role: actor.role }, details: { action: "revoke", uid, email: existing.email } });
  return { ok: true };
}
