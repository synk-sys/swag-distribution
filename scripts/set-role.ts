/**
 * Bootstrap / emergency role assignment (server credentials required).
 *   npx tsx --env-file=.env.local scripts/set-role.ts organizer you@example.com "Your Name"
 *   npx tsx --env-file=.env.local scripts/set-role.ts volunteer helper@example.com "Helper"
 *   npx tsx --env-file=.env.local scripts/set-role.ts none someone@example.com       # revoke
 * Needs DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 * If the user has no Supabase Auth account, an invite email is sent.
 */
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { createClient } from "@supabase/supabase-js";

async function main() {
  const [role, rawEmail, name] = process.argv.slice(2);
  const email = rawEmail?.trim().toLowerCase();
  if (!["organizer", "volunteer", "none"].includes(role) || !email) {
    console.error('Usage: tsx scripts/set-role.ts <organizer|volunteer|none> <email> ["Display Name"]');
    process.exit(1);
  }
  const { DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SITE_URL } = process.env;
  if (!DATABASE_URL || !NEXT_PUBLIC_SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing DATABASE_URL / NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  const admin = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }).auth.admin;

  let uid: string | undefined;
  for (let page = 1; page <= 50 && !uid; page++) {
    const { data, error } = await admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    uid = data.users.find((u) => u.email?.toLowerCase() === email)?.id;
    if (data.users.length < 200) break;
  }
  if (!uid && role !== "none") {
    const { data, error } = await admin.inviteUserByEmail(email, NEXT_PUBLIC_SITE_URL ? { redirectTo: `${NEXT_PUBLIC_SITE_URL.replace(/\/$/, "")}/reset-password` } : undefined);
    if (error) throw error;
    uid = data.user.id;
    console.log(`Invite email sent to ${email}.`);
  }
  if (!uid) throw new Error(`No Supabase Auth user for ${email}`);

  const db = new Client({ connectionString: DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL) ? undefined : { rejectUnauthorized: false } });
  await db.connect();
  const now = new Date();
  if (role === "none") await db.query("delete from staff where user_id = $1", [uid]);
  else
    await db.query(
      `insert into staff (user_id, email, display_name, role, added_by, added_at) values ($1,$2,$3,$4,'set-role script',$5)
       on conflict (user_id) do update set role = excluded.role, display_name = excluded.display_name, email = excluded.email`,
      [uid, email, name || email, role, now.toISOString()],
    );
  await db.query(
    "insert into events (id, type, at, at_ms, actor, details) values ($1, 'staff_change', $2, $3, $4, $5)",
    [randomUUID(), now.toISOString(), now.getTime(), JSON.stringify({ uid: "script", name: "set-role script", role: "organizer" }), JSON.stringify({ action: role === "none" ? "revoke" : "grant", email, role })],
  );
  await db.end();
  console.log(`${email} → ${role}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
