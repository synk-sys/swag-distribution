/**
 * Runs the real FirestoreRepo (Admin SDK transactions) against the Firestore emulator.
 * Skipped unless FIRESTORE_EMULATOR_HOST is set. Run with:  npm run test:emulator
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { remainingBags } from "@/lib/domain/types";
import { FirestoreRepo } from "@/lib/server/repo/firestore";
import { changeInventory, importCsv, updateSettings } from "@/lib/server/services/admin";
import { claimSwag, lookupBarcode, reverseClaim } from "@/lib/server/services/claims";
import { csv, key, organizer, row, volA, volB } from "./helpers/fixtures";

const enabled = !!process.env.FIRESTORE_EMULATOR_HOST;

describe.skipIf(!enabled)("Firestore emulator: real transactions", async () => {
  const { initializeApp, getApps, deleteApp } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const projectId = "demo-swag-test";
  const app = getApps()[0] ?? initializeApp({ projectId });
  const db = getFirestore(app);
  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch {
    /* already set */
  }
  const repo = new FirestoreRepo(db);
  const T = "GOOGA263469041";

  beforeEach(async () => {
    await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: "DELETE" });
    await updateSettings(repo, organizer, {
      barcode: { separator: ":", prefixPattern: "^\\d{1,12}$", idPattern: "^\\d{7}$", suffixLength: 7, prefixPolicy: "enforce", allowedPrefixes: ["132774"], validated: true },
    });
    await importCsv(repo, organizer, csv([row(T, "Grace", "Hopper"), row("GOOGA263469042", "Alan", "Turing")]), { dryRun: false });
    await changeInventory(repo, organizer, { kind: "set_initial", value: 300 });
  });

  afterAll(async () => {
    await deleteApp(app);
  });

  it("matches the observed barcode", async () => {
    const r = await lookupBarcode(repo, volA, "132774:3469041");
    expect(r.status).toBe("ELIGIBLE");
    expect(r.attendee?.ticketNumber).toBe(T);
  });

  it("FINAL ACCEPTANCE: simultaneous claims from two counters → exactly one success", async () => {
    const results = await Promise.all([
      claimSwag(repo, volA, { ticketNumber: T, idempotencyKey: key(), counter: "Counter 1", method: "scan" }),
      claimSwag(repo, volB, { ticketNumber: T, idempotencyKey: key(), counter: "Counter 2", method: "scan" }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["ALREADY_COLLECTED", "SUCCESS"]);
    expect(results.find((r) => r.status !== "SUCCESS")!.message).toBe("ALREADY COLLECTED. Do not distribute another bag.");
    expect(remainingBags(await repo.getInventory())).toBe(299);
    expect(await repo.listEvents({ limit: 50, types: ["claim"] })).toHaveLength(1);
  });

  it("20 concurrent attempts → exactly one claim", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        claimSwag(repo, { uid: `v${i}`, name: `V${i}`, role: "volunteer" }, { ticketNumber: T, idempotencyKey: key(), counter: `C${i % 3}`, method: "scan" }),
      ),
    );
    expect(results.filter((r) => r.status === "SUCCESS")).toHaveLength(1);
    expect((await repo.getInventory()).bagsOut).toBe(1);
  });

  it("retry with the same idempotency key replays the result", async () => {
    const input = { ticketNumber: T, idempotencyKey: key(), counter: "C1", method: "scan" as const };
    expect((await claimSwag(repo, volA, input)).status).toBe("SUCCESS");
    const again = await claimSwag(repo, volA, input);
    expect(again).toMatchObject({ status: "SUCCESS", replayed: true });
    expect((await repo.getInventory()).bagsOut).toBe(1);
  });

  it("reimport preserves claims (mergeFields never touches swag)", async () => {
    const c = await claimSwag(repo, volA, { ticketNumber: T, idempotencyKey: key(), counter: "C1", method: "scan" });
    await importCsv(repo, organizer, csv([row(T, "Grace", "Hopper-Renamed")]), { dryRun: false });
    const reg = await repo.getRegistration(T);
    expect(reg?.lastName).toBe("Hopper-Renamed");
    expect(reg?.swag).toMatchObject({ status: "claimed", claimId: c.claim!.claimId });
    expect((await repo.getRegistration("GOOGA263469042"))?.inLatestImport).toBe(false);
  });

  it("reversal keeps both events", async () => {
    const c = await claimSwag(repo, volA, { ticketNumber: T, idempotencyKey: key(), counter: "C1", method: "scan" });
    await reverseClaim(repo, organizer, { ticketNumber: T, claimId: c.claim!.claimId, reason: "Wrong attendee", bagReturned: true, confirm: true });
    const events = await repo.listEvents({ limit: 50, types: ["claim", "claim_reversed"] });
    expect(events.map((e) => e.type).sort()).toEqual(["claim", "claim_reversed"]);
    expect(remainingBags(await repo.getInventory())).toBe(300);
  });
});
