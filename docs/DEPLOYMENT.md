# Supabase setup and deployment

The app runs on **Supabase**, which provides sign-in (Auth), the database (Postgres) and live updates (Realtime). The Next.js app can be hosted on **Vercel** (recommended, no extra config) or on any Node.js host.

## 1. Create the Supabase project

1. At [supabase.com/dashboard](https://supabase.com/dashboard), create a new project. Pick the **Canada (Central)** region and save the database password somewhere safe.
2. **Authentication → Sign In / Providers:** keep **Email** enabled. Optionally enable **Google**, which needs a Google OAuth client ID and secret.
3. **Authentication → URL Configuration:**
   - **Site URL:** your app URL, for example `https://swag.example.com`. Use `http://localhost:3000` while developing.
   - **Redirect URLs:** add `https://swag.example.com/**` and `http://localhost:3000/**`.
4. **Project Settings → API:** copy the **Project URL**, the **anon public** key and the **service_role** key. The service_role key is secret.
5. **Connect** (top bar) → **Transaction pooler:** copy the connection string (port `6543`) and put your database password in it.

## 2. Create the database tables

**Option A: Supabase CLI**

```bash
npx supabase login
npx supabase init            # answer "no" to the prompts; keeps the existing supabase/migrations folder
npx supabase link --project-ref YOUR-PROJECT-REF
npx supabase db push
```

**Option B: SQL Editor.** Paste and run these two files in order:

1. `supabase/migrations/20261114000001_schema.sql`: tables, indexes, the never-negative inventory check, the append-only audit log, and RLS turned on everywhere.
2. `supabase/migrations/20261114000002_supabase_auth_realtime.sql`: links staff to Auth users, adds the single access rule (staff may read only the change counter), and turns on Realtime for it.

Confirm that **Database → Publications → supabase_realtime** lists `live_meta`.

## 3. Configure the environment

```bash
cp .env.example .env.local
```

Then fill in:

| Variable | Value | Secret? |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_MODE` | `production` | no |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL | no |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon public key | no |
| `NEXT_PUBLIC_SITE_URL` | your app URL | no |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key | **yes** |
| `DATABASE_URL` | Transaction pooler connection string | **yes** |

## 4. Create the first organizer

```bash
npx tsx --env-file=.env.local scripts/set-role.ts organizer you@example.com "Your Name"
```

If you don't have an account yet, Supabase sends you an invite email. Use the link to set a password on `/reset-password`. Add everyone else from **/admin/staff** in the app.

## 5. Deploy to Vercel

1. Import the GitHub repo in Vercel. It detects Next.js automatically.
2. Add every variable from the table above under **Settings → Environment Variables**, with `NEXT_PUBLIC_SITE_URL` set to the Vercel URL.
3. Deploy, then add the deployed URL to Supabase's **Site URL** and **Redirect URLs**.

Other Node hosts (Render, Fly.io, Cloud Run, a VM) work the same way:

```bash
npm ci && npm run build && npm start
```

Set the same environment variables. `NEXT_PUBLIC_*` values are baked in at **build** time, so rebuild after changing them.

## 6. Verify the deployment

- `https://<your-domain>/api/health` returns `{"ok":true}`.
- Sign in as the organizer. The yellow DEMO banner must **not** appear.
- An account that is not in `staff` sees "No access".
- Open the dashboard on one device and confirm a claim on another. The dashboard should update within about a second (Realtime), and within 5 seconds at worst through the polling fallback.
- Run the rehearsal in [EVENT_DAY_CHECKLIST.md](EVENT_DAY_CHECKLIST.md) on the production URL.

## How the security works

- Browsers only use Supabase for **signing in** and for the **Realtime change counter**. They never query attendee data.
- Every API route checks the Supabase access token with Supabase Auth, then looks up the user's role in the `staff` table on the server. Removing someone takes effect within 15 seconds.
- All data access goes through the server's direct Postgres connection, using transactions with row locks.
- RLS is on for every table. The only policy lets staff read `live_meta`, and grants for the browser roles are revoked on everything else. The tests in `tests/supabase-rls.integration.test.ts` verify this.

## Tests against Postgres

```bash
# Throwaway database only. It is wiped. `npx supabase start` gives you one on port 54322.
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm test
```

## Keep demo and production separate

Demo mode (`NEXT_PUBLIC_APP_MODE` unset or `demo`) keeps data only in server memory and never connects to Supabase. Production mode never loads demo data, and the demo session and reset endpoints are refused there.
