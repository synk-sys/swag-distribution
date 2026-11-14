# Event-day checklist

## One week before

- [ ] Production deployed (see [DEPLOYMENT.md](DEPLOYMENT.md)) with no DEMO banner showing.
- [ ] Firestore rules and indexes deployed.
- [ ] Organizer accounts can sign in. A Google account without a role sees "No access".
- [ ] Latest Bevy CSV imported, with zero errors (or each one understood).
- [ ] **Barcode format validated** with at least 5–10 real barcodes, and the prefix policy set to *Enforce*.
- [ ] Eligibility rules reviewed. Decide whether check-in is required (it is off by default) and which ticket types are eligible.
- [ ] Volunteers added in /admin/staff. Each one has signed in once on the phone they'll use.
- [ ] Rehearsal: two phones scan the **same** real barcode and both tap Confirm → exactly one RECORDED ✓, inventory drops by 1, and the audit log shows one `claim` and one `claim_denied`. Then reverse it with reason "rehearsal" and bag returned = **yes**.

## Morning of

- [ ] Re-export and **reimport the latest Bevy CSV** (claims are preserved).
- [ ] Count the bags physically and set **Initial inventory** (for example 300).
- [ ] Check that the dashboard shows the right totals: registered, eligible, remaining.
- [ ] At each counter: phone charged (plus a power bank), signed in, counter name set, **Online** showing, camera tested on a real barcode.
- [ ] Brief volunteers using [VOLUNTEER_GUIDE.md](VOLUNTEER_GUIDE.md), especially: tap Confirm **before** handing over the bag, and give **no bag** on red or on NOT CONFIRMED.
- [ ] Have a backup network ready (a phone hotspot) in case the venue Wi-Fi fails.

## During

- [ ] An organizer keeps /admin open to watch progress, counter activity, recent claims and denied attempts.
- [ ] At 10 bags or fewer, the dashboard turns red. Decide whether to restock (record an **adjustment** with a reason) or announce the end.
- [ ] Accidental claims: open the attendee on the dashboard → **Reverse claim**. Enter a reason, choose whether the bag came back, and type REVERSE.
- [ ] Barcode sharing suspected: turn on **Require name verification** under Inventory & rules.

## After

- [ ] Download the **Attendees CSV** and **Audit CSV** from the dashboard.
- [ ] Reconcile: initial + adjustments − bags out = physical count remaining.
- [ ] Remove volunteer access in /admin/staff.
