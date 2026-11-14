# DevFest Toronto 2026 — Swag Distribution

Volunteers scan attendees' **existing Bevy barcodes**, and each registered attendee gets **exactly one** Standard DevFest Toronto Swag Bag. The server enforces this even when two counters scan the same person at the same moment.

**Flow:** Bevy barcode → scan → verify → confirm → record → never distribute twice.

| Doc | For |
| --- | --- |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Firebase setup, App Hosting deploy, first organizer |
| [docs/CSV_AND_BARCODES.md](docs/CSV_AND_BARCODES.md) | Bevy CSV import, reimport, barcode validation |
| [docs/VOLUNTEER_GUIDE.md](docs/VOLUNTEER_GUIDE.md) | One-page guide for counter volunteers |
| [docs/EVENT_DAY_CHECKLIST.md](docs/EVENT_DAY_CHECKLIST.md) | Before, during and after the event |

## Quick start (demo mode, no Firebase needed)

```bash
npm install
npm run dev            # http://localhost:3000
```

Demo mode is the default when `NEXT_PUBLIC_APP_MODE` is not `production`. It runs entirely in memory with **20 fictional attendees** (simulated barcodes using the fictional prefix `900001`) and never connects to Firebase. On the login page you pick one of these identities:

- **Volunteer · Counter A** / **Volunteer · Counter B**: the scanner at `/scan`
- **Organizer**: the dashboard, plus `/demo`, which shows both counters side by side, a one-click "race" where both counters confirm the same attendee, edge-case barcodes, and QR codes you can scan from a phone

Seeded demo situations: one attendee has already collected (Casey Spadina), two "Sponsor Booth Staff" tickets are ineligible, two tickets share the same barcode suffix (`5550001`) to show ambiguity rejection, and there are 15 bags in stock so you can run inventory out.

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind CSS 4 · shadcn/ui components · Firebase Auth · Cloud Firestore · Firebase Admin SDK · Firebase App Hosting · ZXing (`@zxing/browser`) camera scanning · Zod · Papa Parse · Vitest.

## How "exactly one bag" is guaranteed

- `registrations/{ticketNumber}` is the single source of truth. Its `swag` field is the attendee's claim state. The full Bevy ticket number is the document ID.
- `POST /api/claims` runs **one Firestore transaction** that reads the idempotency record, the registration, the settings and the inventory, then checks: the attendee exists → is eligible → has not claimed yet → bags remain. It then writes the claim, increments `bagsOut`, appends an audit event and stores the idempotency record, all atomically.
- If two counters race, Firestore aborts and retries the transaction that committed second. On retry it sees the claim and returns `ALREADY_COLLECTED`: **"ALREADY COLLECTED. Do not distribute another bag."**
- **Idempotency:** the browser creates a key each time an attendee is shown and reuses it on every retry, so a lost response can never be counted twice. The key is scoped to the volunteer.
- The browser **never decides** whether a claim succeeded. If the network fails, the screen shows **NOT CONFIRMED** with a safe Retry. There are no offline claims: the Confirm button is disabled while offline.
- Volunteers are told to tap Confirm **first**, then hand over the bag when they see **RECORDED ✓**.

## Security model

- Every API route verifies the Firebase ID token (including the revocation check) and the `role` custom claim (`organizer` or `volunteer`). Every service function checks the role again (defense in depth).
- `firestore.rules`: browsers can read **only** `meta/live`, a change counter used for real-time refresh, and nothing else. No client writes at all. All data goes through the Admin SDK on the server.
- Volunteers only see the attendee's name, ticket number, ticket type and a masked email. Only organizers see the full attendee list and exports.
- Every request body is validated with Zod and size-capped. CSV uploads are limited to 5 MB and parsed on the server. CSV exports are protected against formula injection.
- Rate limits apply per user and per server instance. Audit events are append-only. Claim reversals never delete history.
- A barcode is a **lookup credential, not proof of identity**. Organizers can turn on "name matches badge / ID" verification at the counter.

## Project layout

```
src/lib/domain/        barcode parser, CSV parsing, eligibility, types (pure, tested)
src/lib/server/        auth, repos (Firestore + in-memory), services (claims, admin, staff)
src/app/api/           route handlers (thin wrappers around services)
src/app/scan           volunteer scanner          src/app/admin/*   organizer pages
src/app/demo           two-counter demo           src/components/    UI
tests/                 Vitest (unit + route + Firestore emulator + security rules)
firestore.rules, firestore.indexes.json, firebase.json, apphosting.yaml
```

## Tests

```bash
npm test               # 62 tests: domain, claims, concurrency, reimport, authz, HTTP routes, client retry
npm run test:emulator  # all of the above + 10 tests against the real Firestore emulator (needs Java 21+)
npm run typecheck && npm run lint && npm run build
```

Required scenarios and where they are tested: valid barcode `132774:3469041` and its match to `GOOGA263469041` (barcode + claims), invalid barcode, unknown registration, ambiguous suffix, duplicate scans, two volunteers claiming at once (in memory, over HTTP, and in the Firestore emulator with 20 concurrent attempts), reimport preserving claims, inventory exhaustion including the last bag under concurrency, manual lookup and claim, unauthorized admin actions (service and HTTP), claim reversal, network failure and retry (lost response after commit, failure before commit, client retry with the same key), and multiple counters.

## Known limitations

- The barcode → ticket rule is **observed, not specified by Bevy**. Validate it with real barcodes before the event (`/admin/validate`). Scan claims stay disabled until you do.
- Rate limiting is in-memory per instance, so it guards against runaway clients but is not a global quota.
- All claims update the single `inventory/swag` document. That keeps the "never oversell" guarantee simple. Firestore comfortably handles a few claims per second, which is far above what human-staffed counters produce.
- The Firebase Auth login flow (email/password and Google) has not been exercised against a live Firebase project from this repo. Test it in your project before the event (see the checklist).
