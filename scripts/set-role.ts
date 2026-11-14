/**
 * Bootstrap / emergency role assignment using the Admin SDK.
 *   npx tsx scripts/set-role.ts organizer you@example.com "Your Name"
 *   npx tsx scripts/set-role.ts volunteer helper@example.com "Helper"
 *   npx tsx scripts/set-role.ts none someone@example.com          # revoke
 * Requires Application Default Credentials (gcloud auth application-default login)
 * and FIREBASE_PROJECT_ID.
 */
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

async function main() {
  const [role, email, name] = process.argv.slice(2);
  if (!["organizer", "volunteer", "none"].includes(role) || !email) {
    console.error('Usage: tsx scripts/set-role.ts <organizer|volunteer|none> <email> ["Display Name"]');
    process.exit(1);
  }
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error("Set FIREBASE_PROJECT_ID");
  initializeApp({ credential: applicationDefault(), projectId });
  const auth = getAuth();
  const db = getFirestore();
  let user;
  try {
    user = await auth.getUserByEmail(email);
  } catch {
    user = await auth.createUser({ email, displayName: name || email });
    console.log("Created auth user", user.uid);
  }
  const claims = { ...(user.customClaims ?? {}) } as Record<string, unknown>;
  if (role === "none") delete claims.role;
  else claims.role = role;
  await auth.setCustomUserClaims(user.uid, claims);
  await auth.revokeRefreshTokens(user.uid);
  const now = new Date();
  if (role === "none") await db.collection("staff").doc(user.uid).delete();
  else await db.collection("staff").doc(user.uid).set({ uid: user.uid, email, displayName: name || user.displayName || email, role, addedBy: "set-role script", addedAt: now.toISOString() });
  await db.collection("events").add({ type: "staff_change", at: now.toISOString(), atMs: now.getTime(), actor: { uid: "script", name: "set-role script", role: "organizer" }, details: { action: role === "none" ? "revoke" : "grant", email, role } });
  console.log(`${email} → ${role}. They must sign in again to pick up the change.`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
