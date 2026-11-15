# DevFest Toronto 2026 — Swag Distribution

Volunteers scan attendees' **existing Bevy barcodes**, and each registered attendee gets **exactly one** Standard DevFest Toronto Swag Bag. The server enforces this even when two counters scan the same person at the same moment.

**Flow:** Bevy barcode → scan → verify → confirm → record → never distribute twice.

| Doc | For |
| --- | --- |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Supabase setup, deployment, first organizer |
| [docs/CSV_AND_BARCODES.md](docs/CSV_AND_BARCODES.md) | Bevy CSV import, reimport, barcode validation |
| [docs/VOLUNTEER_GUIDE.md](docs/VOLUNTEER_GUIDE.md) | One-page guide for counter volunteers |
| [docs/EVENT_DAY_CHECKLIST.md](docs/EVENT_DAY_CHECKLIST.md) | Before, during and after the event |

## Quick start (demo mode, no Supabase needed)

```bash
npm install
npm run dev            # http://localhost:3000
```

Demo mode is the default when `NEXT_PUBLIC_APP_MODE` is not `production`. It runs entirely in memory with **20 fictional attendees** (simulated barcodes using the fictional prefix `900001`) and never connects to Supabase. On the login page you pick one of these identities:

- **Volunteer · Counter A** / **Volunteer · Counter B**: the scanner at `/scan`
- **Organizer**: the dashboard, plus `/demo`, which shows both counters side by side, a one-click "race" where both counters confirm the same attendee, edge-case barcodes, and QR codes you can scan from a phone

Seeded demo situations: one attendee has already collected (Casey Spadina), two "Sponsor Booth Staff" tickets are ineligible, two tickets share the same barcode suffix (`5550001`) to show ambiguity rejection, and there are 15 bags in stock so you can run inventory out.

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind CSS 4 · shadcn/ui components · Supabase Auth · Supabase Postgres (via `pg`) · Supabase Realtime · ZXing (`@zxing/browser`) camera scanning · Zod · Papa Parse · Vitest. Host on Vercel or any Node.js server.

## How "exactly one bag" is guaranteed

- The `registrations` table, keyed by the full Bevy ticket number, is the single source of truth. Its `swag` column holds the attendee's claim state.
- `POST /api/claims` runs **one Postgres transaction**. It locks the registration row (`SELECT … FOR UPDATE`), reads the idempotency record, locks the inventory row, then checks: the attendee exists → is eligible → has not claimed yet → bags remain. It then writes the claim, increments `bags_out`, appends an audit event and stores the idempotency record, and commits.
- If two counters race, the second waits for the first one's lock, re-reads the committed row, sees the claim, and returns `ALREADY_COLLECTED`: **"ALREADY COLLECTED. Do not distribute another bag."**
- **Database safeguards:** a CHECK constraint makes negative inventory impossible, and a trigger makes the audit log append-only.
- **Idempotency:** the browser creates a key each time an attendee is shown and reuses it on every retry, so a lost response can never be counted twice. Even two copies of the same request arriving at the same moment produce one claim.
- The browser **never decides** whether a claim succeeded. If the network fails, the screen shows **NOT CONFIRMED** with a safe Retry. There are no offline claims: the Confirm button is disabled while offline.
- Volunteers are told to tap Confirm **first**, then hand over the bag when they see **RECORDED ✓**.

## Security model

- Every API route checks the Supabase access token with Supabase Auth, then looks up the role (`organizer` or `volunteer`) in the `staff` table on the server. Every service function checks the role again (defense in depth).
- RLS is on for every table. Browsers can read **only** `live_meta`, a change counter pushed over Supabase Realtime, and only if they are staff. Grants for the browser roles are revoked on everything else. All data goes through the server's Postgres connection, and the service-role key never leaves the server.
- Volunteers only see the attendee's name, ticket number, ticket type and a masked email. Only organizers see the full attendee list and exports.
- Every request body is validated with Zod and size-capped. CSV uploads are limited to 5 MB and parsed on the server. CSV exports are protected against formula injection.
- Rate limits apply per user and per server instance. Claim reversals never delete history.
- A barcode is a **lookup credential, not proof of identity**. Organizers can turn on "name matches badge / ID" verification at the counter.

## Project layout

```
src/lib/domain/        barcode parser, CSV parsing, eligibility, types (pure, tested)
src/lib/server/        auth, repos (Postgres + in-memory), services (claims, admin, staff)
src/app/api/           route handlers (thin wrappers around services)
src/app/scan           volunteer scanner          src/app/admin/*   organizer pages
src/app/login, src/app/reset-password   Supabase sign-in, invite and password links
src/app/demo           two-counter demo           src/components/    UI
tests/                 Vitest (unit + route + Postgres integration + RLS)
supabase/migrations/   schema, RLS policy, Realtime publication
```

## Tests

```bash
npm test               # 62 tests: domain, claims, concurrency, reimport, authz, HTTP routes, client retry
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm test
                       # + 14 tests on real Postgres: row-lock races, RLS and grants (throwaway DB only, it is wiped)
npm run typecheck && npm run lint && npm run build
```

Required scenarios and where they are tested: valid barcode `132774:3469041` and its match to `GOOGA263469041` (barcode + claims), invalid barcode, unknown registration, ambiguous suffix, duplicate scans, two volunteers claiming at once (in memory, over HTTP, and on Postgres with 25 concurrent attempts), reimport preserving claims, inventory exhaustion including the last bag under concurrency, manual lookup and claim, unauthorized admin actions (service and HTTP), claim reversal, network failure and retry (lost response after commit, failure before commit, a duplicate request arriving at the same moment, client retry with the same key), and multiple counters.

## Known limitations

- The barcode → ticket rule is **observed, not specified by Bevy**. Validate it with real barcodes before the event (`/admin/validate`). Scan claims stay disabled until you do.
- Rate limiting is in-memory per instance, so it guards against runaway clients but is not a global quota.
- Every claim locks the single inventory row, so claims are processed one at a time. That keeps the "never oversell" guarantee simple, and each claim takes a few milliseconds, far faster than human-staffed counters can scan.
- Sign-in (email/password, Google, invite and password-reset links) and Realtime have not been tested against a live Supabase project from this repo. The database logic has been tested on real Postgres. Test both in your project before the event (see the checklist).
