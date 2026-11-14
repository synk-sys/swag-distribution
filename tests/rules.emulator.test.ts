/** Firestore security rules: browsers can never read attendee data or write anything. */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, it } from "vitest";

const enabled = !!process.env.FIRESTORE_EMULATOR_HOST;

describe.skipIf(!enabled)("Firestore security rules", async () => {
  const { initializeTestEnvironment, assertFails, assertSucceeds } = await import("@firebase/rules-unit-testing");
  const { doc, getDoc, setDoc, collection, getDocs } = await import("firebase/firestore");
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080").split(":");
  let env: Awaited<ReturnType<typeof initializeTestEnvironment>>;

  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: "demo-swag-rules",
      firestore: { rules: readFileSync("firestore.rules", "utf8"), host, port: Number(port) },
    });
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "registrations/GOOGA263469041"), { firstName: "Grace" });
      await setDoc(doc(ctx.firestore(), "meta/live"), { version: 1 });
    });
  });
  afterAll(async () => env?.cleanup());

  it("anonymous users cannot read anything", async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, "registrations/GOOGA263469041")));
    await assertFails(getDoc(doc(db, "meta/live")));
  });

  it("signed-in users without a role cannot read the live counter", async () => {
    await assertFails(getDoc(doc(env.authenticatedContext("u1").firestore(), "meta/live")));
  });

  it("staff can read only the live counter; never attendees, events or claims", async () => {
    for (const role of ["volunteer", "organizer"]) {
      const db = env.authenticatedContext(`u-${role}`, { role }).firestore();
      await assertSucceeds(getDoc(doc(db, "meta/live")));
      await assertFails(getDoc(doc(db, "registrations/GOOGA263469041")));
      await assertFails(getDocs(collection(db, "registrations")));
      await assertFails(getDocs(collection(db, "events")));
      await assertFails(getDoc(doc(db, "inventory/swag")));
    }
  });

  it("no client can write, even organizers", async () => {
    const db = env.authenticatedContext("org", { role: "organizer" }).firestore();
    await assertFails(setDoc(doc(db, "registrations/GOOGA263469041"), { swag: { status: "unclaimed" } }));
    await assertFails(setDoc(doc(db, "inventory/swag"), { initial: 99999 }));
    await assertFails(setDoc(doc(db, "meta/live"), { version: 0 }));
  });
});
