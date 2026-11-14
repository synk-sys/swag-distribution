import "server-only";
import { z } from "zod";
import { IS_DEMO } from "@/lib/config";
import type { Actor } from "@/lib/domain/types";
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

/**
 * Grants a role by setting a Firebase Auth custom claim (enforced by both the
 * API and Firestore rules). Creates the Auth user if they don't exist yet; they
 * then sign in with Google or use "Forgot password" to set a password.
 */
export async function addStaff(repo: Repo, actor: Actor | null, raw: unknown) {
  assertRole(actor, "organizer");
  const p = staffInputSchema.safeParse(raw);
  if (!p.success) throw badRequest("Enter a valid email, name and role.");
  if (IS_DEMO) throw badRequest("Staff management is disabled in demo mode.");
  const { getAdminAuth } = await import("../firebase-admin");
  const auth = getAdminAuth();
  let user;
  try {
    user = await auth.getUserByEmail(p.data.email);
  } catch {
    user = await auth.createUser({ email: p.data.email, displayName: p.data.displayName, emailVerified: false });
  }
  await auth.setCustomUserClaims(user.uid, { ...(user.customClaims ?? {}), role: p.data.role });
  // Force existing sessions to pick up the new role on next token refresh.
  await auth.revokeRefreshTokens(user.uid);
  const now = new Date();
  await repo.upsertStaff({ uid: user.uid, email: p.data.email, displayName: p.data.displayName, role: p.data.role, addedBy: actor.name, addedAt: now.toISOString() });
  await repo.addEvent({ type: "staff_change", at: now.toISOString(), atMs: now.getTime(), actor: { uid: actor.uid, name: actor.name, role: actor.role }, details: { action: "grant", email: p.data.email, role: p.data.role } });
  return { uid: user.uid };
}

export async function removeStaff(repo: Repo, actor: Actor | null, uid: string) {
  assertRole(actor, "organizer");
  if (IS_DEMO) throw badRequest("Staff management is disabled in demo mode.");
  if (!uid || uid === actor.uid) throw badRequest("You cannot remove your own access.");
  const { getAdminAuth } = await import("../firebase-admin");
  const auth = getAdminAuth();
  const user = await auth.getUser(uid);
  const { role: _removed, ...rest } = (user.customClaims ?? {}) as Record<string, unknown>;
  void _removed;
  await auth.setCustomUserClaims(uid, rest);
  await auth.revokeRefreshTokens(uid);
  await repo.removeStaff(uid);
  const now = new Date();
  await repo.addEvent({ type: "staff_change", at: now.toISOString(), atMs: now.getTime(), actor: { uid: actor.uid, name: actor.name, role: actor.role }, details: { action: "revoke", uid, email: user.email } });
  return { ok: true };
}
