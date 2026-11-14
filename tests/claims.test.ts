import { beforeEach, describe, expect, it } from "vitest";
import { remainingBags } from "@/lib/domain/types";
import type { MemoryRepo } from "@/lib/server/repo/memory";
import { changeInventory, dashboard, setEligibilityOverride, updateSettings } from "@/lib/server/services/admin";
import { claimSwag, lookupBarcode, lookupTicket, reverseClaim, searchAttendees } from "@/lib/server/services/claims";
import { csv, key, organizer, row, setupRepo, volA, volB } from "./helpers/fixtures";
import { importCsv } from "@/lib/server/services/admin";

const T = "GOOGA263469041";
const claim = (repo: MemoryRepo, actor = volA, extra: Record<string, unknown> = {}) =>
  claimSwag(repo, actor, { ticketNumber: T, idempotencyKey: key(), counter: actor === volA ? "Counter 1" : "Counter 2", method: "scan", ...extra });

const successfulClaims = (repo: MemoryRepo) => repo.events.filter((e) => e.type === "claim");

describe("scan lookup", () => {
  let repo: MemoryRepo;
  beforeEach(async () => (repo = await setupRepo()));

  it("1+2. valid barcode 132774:3469041 matches ticket GOOGA263469041 and is ELIGIBLE", async () => {
    const r = await lookupBarcode(repo, volA, "132774:3469041");
    expect(r.status).toBe("ELIGIBLE");
    expect(r.attendee?.ticketNumber).toBe(T);
    expect(r.attendee?.firstName).toBe("Grace");
    expect(r.barcode).toEqual({ prefix: "132774", id: "3469041" });
  });

  it("does not leak full email to volunteers", async () => {
    const r = await lookupBarcode(repo, volA, "132774:3469041");
    expect(r.attendee?.emailMasked).not.toContain("grace.hopper");
    expect(r.attendee).not.toHaveProperty("email");
  });

  it("3. invalid barcode → NOT_FOUND with reason", async () => {
    const r = await lookupBarcode(repo, volA, "hello world");
    expect(r.status).toBe("NOT_FOUND");
    expect(r.reason).toBeTruthy();
    expect(r.attendee).toBeUndefined();
  });

  it("4. unknown registration → NOT_FOUND", async () => {
    const r = await lookupBarcode(repo, volA, "132774:9999999");
    expect(r.status).toBe("NOT_FOUND");
    expect(r.reason).toMatch(/No registration/);
  });

  it("5. ambiguous ticket suffix → rejected, never guesses", async () => {
    const amb = await setupRepo({ rows: [row(T), row("OTHER263469041"), row("GOOGA263469042")] });
    const r = await lookupBarcode(amb, volA, "132774:3469041");
    expect(r.status).toBe("NOT_FOUND");
    expect(r.reason).toMatch(/Ambiguous/);
    expect(r.attendee).toBeUndefined();
  });

  it("refuses scans until an organizer validates the barcode format", async () => {
    await updateSettings(repo, organizer, { barcode: { ...(await repo.getSettings()).barcode, validated: false } });
    expect((await lookupBarcode(repo, volA, "132774:3469041")).status).toBe("FORMAT_NOT_VALIDATED");
    // Manual lookup still works.
    expect((await lookupTicket(repo, volA, T)).status).toBe("ELIGIBLE");
  });

  it("rejects prefixes not on the validated allow-list when enforced", async () => {
    const strict = await setupRepo({ prefixes: ["132774"] });
    expect((await lookupBarcode(strict, volA, "132774:3469041")).status).toBe("ELIGIBLE");
    const r = await lookupBarcode(strict, volA, "555555:3469041");
    expect(r.status).toBe("NOT_FOUND");
    expect(r.reason).toMatch(/prefix/);
  });

  it("reports INELIGIBLE per configurable rules (allow-list by ticket title)", async () => {
    await updateSettings(repo, organizer, {
      eligibility: { mode: "allowlist", allowedTicketTitles: ["General Admission"], requireCheckin: false, excludeRemovedRegistrations: true },
    });
    expect((await lookupBarcode(repo, volA, "132774:3469043")).status).toBe("INELIGIBLE");
    expect((await claimSwag(repo, volA, { ticketNumber: "GOOGA263469043", idempotencyKey: key(), counter: "C1", method: "scan" })).status).toBe("INELIGIBLE");
  });

  it("empty check-in date does NOT make an attendee ineligible by default", async () => {
    const r = await lookupTicket(repo, volA, T);
    expect(r.status).toBe("ELIGIBLE");
  });

  it("organizer eligibility override applies", async () => {
    await setEligibilityOverride(repo, organizer, { ticketNumber: T, value: "ineligible", reason: "Refunded at desk" });
    expect((await lookupTicket(repo, volA, T)).status).toBe("INELIGIBLE");
  });
});

describe("one-time claim enforcement", () => {
  let repo: MemoryRepo;
  beforeEach(async () => (repo = await setupRepo({ inventory: 300 })));

  it("claims once, records volunteer/counter/time, decrements inventory by one", async () => {
    const r = await claim(repo);
    expect(r.status).toBe("SUCCESS");
    const reg = await repo.getRegistration(T);
    expect(reg?.swag).toMatchObject({ status: "claimed", claimedBy: { uid: "vol-a" }, counter: "Counter 1", method: "scan" });
    expect(remainingBags(repo.inventory)).toBe(299);
    expect(successfulClaims(repo)).toHaveLength(1);
  });

  it("6. duplicate scans: second scan shows ALREADY_COLLECTED with previous timestamp", async () => {
    await claim(repo);
    const look = await lookupBarcode(repo, volB, "132774:3469041");
    expect(look.status).toBe("ALREADY_COLLECTED");
    expect(look.previousClaim?.claimedAt).toBeTruthy();
    expect(look.previousClaim?.counter).toBe("Counter 1");
    const again = await claim(repo, volA); // same volunteer, new action (new key)
    expect(again.status).toBe("ALREADY_COLLECTED");
    expect(again.message).toBe("ALREADY COLLECTED. Do not distribute another bag.");
    expect(remainingBags(repo.inventory)).toBe(299);
  });

  it("7. FINAL ACCEPTANCE: two volunteers claim the same ticket simultaneously → exactly one succeeds", async () => {
    repo.txLatencyMs = 5; // widen the race window
    const [la, lb] = await Promise.all([lookupBarcode(repo, volA, "132774:3469041"), lookupBarcode(repo, volB, "132774:3469041")]);
    expect(la.status).toBe("ELIGIBLE");
    expect(lb.status).toBe("ELIGIBLE");
    const before = remainingBags(repo.inventory);
    const results = await Promise.all([claim(repo, volA), claim(repo, volB)]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual(["ALREADY_COLLECTED", "SUCCESS"]);
    const loser = results.find((r) => r.status !== "SUCCESS")!;
    expect(loser.message).toBe("ALREADY COLLECTED. Do not distribute another bag.");
    expect(remainingBags(repo.inventory)).toBe(before - 1);
    expect(repo.inventory.activeClaims).toBe(1);
    expect(successfulClaims(repo)).toHaveLength(1);
    expect(repo.events.filter((e) => e.type === "claim_denied")).toHaveLength(1);
  });

  it("50 concurrent attempts across counters still produce exactly one claim", async () => {
    const actors = Array.from({ length: 50 }, (_, i) => ({ uid: `v${i}`, name: `V${i}`, role: "volunteer" as const }));
    const results = await Promise.all(actors.map((a) => claimSwag(repo, a, { ticketNumber: T, idempotencyKey: key(), counter: `Counter ${a.uid}`, method: "scan" })));
    expect(results.filter((r) => r.status === "SUCCESS")).toHaveLength(1);
    expect(results.filter((r) => r.status === "ALREADY_COLLECTED")).toHaveLength(49);
    expect(remainingBags(repo.inventory)).toBe(299);
  });

  it("9. inventory exhaustion blocks further distribution", async () => {
    const small = await setupRepo({ inventory: 2 });
    const tickets = ["GOOGA263469041", "GOOGA263469042", "GOOGA263469043"];
    const res = [];
    for (const t of tickets) res.push(await claimSwag(small, volA, { ticketNumber: t, idempotencyKey: key(), counter: "C1", method: "scan" }));
    expect(res.map((r) => r.status)).toEqual(["SUCCESS", "SUCCESS", "OUT_OF_STOCK"]);
    expect(remainingBags(small.inventory)).toBe(0);
    expect((await lookupTicket(small, volA, "GOOGA263469043")).status).toBe("OUT_OF_STOCK");
    expect((await small.getRegistration("GOOGA263469043"))?.swag).toBeUndefined();
  });

  it("9b. concurrent claims for different attendees never oversell the last bag", async () => {
    const small = await setupRepo({ inventory: 1 });
    const results = await Promise.all(
      ["GOOGA263469041", "GOOGA263469042", "GOOGA263469043"].map((t, i) =>
        claimSwag(small, { uid: `v${i}`, name: "v", role: "volunteer" }, { ticketNumber: t, idempotencyKey: key(), counter: `C${i}`, method: "scan" }),
      ),
    );
    expect(results.filter((r) => r.status === "SUCCESS")).toHaveLength(1);
    expect(results.filter((r) => r.status === "OUT_OF_STOCK")).toHaveLength(2);
    expect(remainingBags(small.inventory)).toBe(0);
  });

  it("10. manual lookup and claim follow the same one-time rule", async () => {
    const found = await searchAttendees(repo, volA, "grace hop");
    expect(found).toHaveLength(1);
    expect(found[0].ticketNumber).toBe(T);
    expect((await searchAttendees(repo, volA, "3469041"))[0].ticketNumber).toBe(T);
    expect((await searchAttendees(repo, volA, "grace.hopper@example.com"))[0].ticketNumber).toBe(T);
    const manual = await claimSwag(repo, volA, { ticketNumber: T.toLowerCase(), idempotencyKey: key(), counter: "C1", method: "manual" });
    expect(manual.status).toBe("SUCCESS");
    expect(manual.claim?.method).toBe("manual");
    const scanAfter = await claim(repo, volB);
    expect(scanAfter.status).toBe("ALREADY_COLLECTED");
    expect(remainingBags(repo.inventory)).toBe(299);
  });

  it("requires name verification when organizers enable it", async () => {
    await updateSettings(repo, organizer, { verification: { requireNameCheck: true } });
    await expect(claim(repo)).rejects.toThrow(/badge/);
    expect((await claim(repo, volA, { nameVerified: true })).status).toBe("SUCCESS");
  });

  it("14. multiple counters distribute different attendees concurrently and tally per counter", async () => {
    const results = await Promise.all([
      claimSwag(repo, volA, { ticketNumber: "GOOGA263469041", idempotencyKey: key(), counter: "Counter 1", method: "scan" }),
      claimSwag(repo, volB, { ticketNumber: "GOOGA263469042", idempotencyKey: key(), counter: "Counter 2", method: "scan" }),
      claimSwag(repo, volA, { ticketNumber: "GOOGA263469043", idempotencyKey: key(), counter: "Counter 1", method: "manual" }),
    ]);
    expect(results.every((r) => r.status === "SUCCESS")).toBe(true);
    const d = await dashboard(repo, organizer);
    expect(d.totals.distributed).toBe(3);
    expect(d.totals.remaining).toBe(297);
    expect(d.byCounter).toEqual({ "Counter 1": 2, "Counter 2": 1 });
    expect(d.byVolunteer).toEqual({ "Volunteer A": 2, "Volunteer B": 1 });
  });
});

describe("13. network failure and retry", () => {
  let repo: MemoryRepo;
  beforeEach(async () => (repo = await setupRepo({ inventory: 10 })));

  it("response lost after commit: retry with same key returns the original SUCCESS, inventory decremented once", async () => {
    const input = { ticketNumber: T, idempotencyKey: key(), counter: "C1", method: "scan" as const };
    repo.faults.afterCommit = () => {
      repo.faults.afterCommit = undefined;
      throw new Error("ECONNRESET");
    };
    await expect(claimSwag(repo, volA, input)).rejects.toThrow("ECONNRESET");
    const retry = await claimSwag(repo, volA, input);
    expect(retry.status).toBe("SUCCESS");
    expect(retry.replayed).toBe(true);
    expect(remainingBags(repo.inventory)).toBe(9);
    expect(successfulClaims(repo)).toHaveLength(1);
  });

  it("failure before commit leaves nothing written; retry succeeds once", async () => {
    const input = { ticketNumber: T, idempotencyKey: key(), counter: "C1", method: "scan" as const };
    repo.faults.beforeCommit = () => {
      repo.faults.beforeCommit = undefined;
      throw new Error("UNAVAILABLE");
    };
    await expect(claimSwag(repo, volA, input)).rejects.toThrow("UNAVAILABLE");
    expect((await repo.getRegistration(T))?.swag).toBeUndefined();
    expect(remainingBags(repo.inventory)).toBe(10);
    expect((await claimSwag(repo, volA, input)).status).toBe("SUCCESS");
    expect(remainingBags(repo.inventory)).toBe(9);
  });

  it("an idempotency key cannot be replayed by another volunteer or for another ticket", async () => {
    const k = key();
    expect((await claimSwag(repo, volA, { ticketNumber: T, idempotencyKey: k, counter: "C1", method: "scan" })).status).toBe("SUCCESS");
    expect((await claimSwag(repo, volB, { ticketNumber: T, idempotencyKey: k, counter: "C2", method: "scan" })).status).toBe("ALREADY_COLLECTED");
    expect((await claimSwag(repo, volA, { ticketNumber: "GOOGA263469042", idempotencyKey: k, counter: "C1", method: "scan" })).status).toBe("IDEMPOTENCY_CONFLICT");
    expect(remainingBags(repo.inventory)).toBe(9);
  });
});

describe("12. claim reversal", () => {
  let repo: MemoryRepo;
  beforeEach(async () => (repo = await setupRepo({ inventory: 10 })));

  it("requires confirmation and a reason, keeps history, restores inventory only if the bag came back", async () => {
    const c = await claim(repo);
    const claimId = c.claim!.claimId;
    await expect(reverseClaim(repo, organizer, { ticketNumber: T, claimId, reason: "", bagReturned: true, confirm: true })).rejects.toThrow(/reason/);
    await expect(reverseClaim(repo, organizer, { ticketNumber: T, claimId, reason: "Scanned wrong person", bagReturned: true })).rejects.toThrow();

    const r = await reverseClaim(repo, organizer, { ticketNumber: T, claimId, reason: "Scanned wrong person", bagReturned: true, confirm: true });
    expect(r.remaining).toBe(10);
    const reg = await repo.getRegistration(T);
    expect(reg?.swag).toMatchObject({ status: "unclaimed", lastReversal: { claimId, reason: "Scanned wrong person", reversedBy: { uid: "org-1" } } });
    // History is never deleted: the original claim event remains alongside the reversal.
    expect(repo.events.filter((e) => e.type === "claim")).toHaveLength(1);
    const rev = repo.events.find((e) => e.type === "claim_reversed")!;
    expect(rev).toMatchObject({ claimId, actor: { uid: "org-1", role: "organizer" }, details: { inventoryRestored: true } });
    expect(rev.at).toBeTruthy();

    // Attendee can now collect again.
    expect((await claim(repo, volB)).status).toBe("SUCCESS");
  });

  it("does not restore inventory when the bag was physically handed out", async () => {
    const c = await claim(repo);
    await reverseClaim(repo, organizer, { ticketNumber: T, claimId: c.claim!.claimId, reason: "Recorded against wrong ticket, bag already given", bagReturned: false, confirm: true });
    expect(remainingBags(repo.inventory)).toBe(9);
    expect(repo.inventory.activeClaims).toBe(0);
  });

  it("refuses to reverse a stale claim id", async () => {
    await claim(repo);
    await expect(reverseClaim(repo, organizer, { ticketNumber: T, claimId: "stale-claim-id", reason: "oops wrong", bagReturned: true, confirm: true })).rejects.toThrow(/changed/);
  });
});

describe("inventory", () => {
  it("adjustments are audited and cannot go negative", async () => {
    const repo = await setupRepo({ inventory: 5 });
    await changeInventory(repo, organizer, { kind: "adjust", delta: 20, reason: "Second box found" });
    expect(remainingBags(repo.inventory)).toBe(25);
    await expect(changeInventory(repo, organizer, { kind: "adjust", delta: -26, reason: "Count" })).rejects.toThrow(/negative/);
    await expect(changeInventory(repo, organizer, { kind: "adjust", delta: 3 })).rejects.toThrow();
    expect(repo.events.filter((e) => e.type === "inventory_adjust")).toHaveLength(1);
  });
});

describe("8. CSV reimport preserves claims", () => {
  it("reimport never resets swag claims or overrides, updates CSV fields, flags removed rows", async () => {
    const repo = await setupRepo();
    expect((await claim(repo)).status).toBe("SUCCESS");
    await setEligibilityOverride(repo, organizer, { ticketNumber: "GOOGA263469042", value: "ineligible", reason: "Duplicate account" });
    const before = structuredClone(repo.registrations.get(T)!.swag);

    const dry = await importCsv(repo, organizer, csv([row(T, "Grace", "Hopper-Updated"), row("GOOGA263469043", "Katherine", "Johnson", "Student"), row("GOOGA263469099", "New", "Person")]), { dryRun: true });
    expect(dry.diff).toMatchObject({ newTickets: 1, updatedTickets: 1, unchangedTickets: 1, removedTickets: ["GOOGA263469042"], claimsPreserved: 1 });
    expect(repo.registrations.get(T)!.lastName).toBe("Hopper"); // dry run wrote nothing

    await importCsv(repo, organizer, csv([row(T, "Grace", "Hopper-Updated"), row("GOOGA263469043", "Katherine", "Johnson", "Student"), row("GOOGA263469099", "New", "Person")]), { dryRun: false });
    const reg = repo.registrations.get(T)!;
    expect(reg.lastName).toBe("Hopper-Updated");
    expect(reg.swag).toEqual(before);
    expect(repo.registrations.get("GOOGA263469042")!.inLatestImport).toBe(false);
    expect(repo.registrations.get("GOOGA263469042")!.eligibilityOverride?.value).toBe("ineligible");
    expect(repo.registrations.has("GOOGA263469099")).toBe(true);
    expect((await lookupBarcode(repo, volB, "132774:3469041")).status).toBe("ALREADY_COLLECTED");
    expect(remainingBags(repo.inventory)).toBe(299);
  });
});
