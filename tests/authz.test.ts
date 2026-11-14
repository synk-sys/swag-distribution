import { beforeEach, describe, expect, it } from "vitest";
import { changeInventory, dashboard, exportCsv, importCsv, setEligibilityOverride, updateSettings } from "@/lib/server/services/admin";
import { claimSwag, lookupBarcode, reverseClaim } from "@/lib/server/services/claims";
import { resetRateLimits } from "@/lib/server/rate-limit";
import type { MemoryRepo } from "@/lib/server/repo/memory";
import { csv, key, row, setupRepo, volA } from "./helpers/fixtures";

describe("11. unauthorized admin actions (service layer)", () => {
  let repo: MemoryRepo;
  beforeEach(async () => (repo = await setupRepo()));

  it("volunteers cannot perform organizer actions", async () => {
    const c = await claimSwag(repo, volA, { ticketNumber: "GOOGA263469041", idempotencyKey: key(), counter: "C1", method: "scan" });
    const attempts = [
      () => reverseClaim(repo, volA, { ticketNumber: "GOOGA263469041", claimId: c.claim!.claimId, reason: "please", bagReturned: true, confirm: true }),
      () => changeInventory(repo, volA, { kind: "set_initial", value: 9999 }),
      () => importCsv(repo, volA, csv([row("GOOGA263469041")]), { dryRun: false }),
      () => setEligibilityOverride(repo, volA, { ticketNumber: "GOOGA263469041", value: "eligible", reason: "friend" }),
      () => updateSettings(repo, volA, { verification: { requireNameCheck: false } }),
      () => dashboard(repo, volA),
      () => exportCsv(repo, volA, "attendees"),
    ];
    for (const a of attempts) await expect(a()).rejects.toMatchObject({ status: 403 });
    expect(repo.inventory.initial).toBe(300);
    expect((await repo.getRegistration("GOOGA263469041"))?.swag?.status).toBe("claimed");
  });

  it("anonymous callers are rejected everywhere", async () => {
    await expect(lookupBarcode(repo, null, "132774:3469041")).rejects.toMatchObject({ status: 401 });
    await expect(claimSwag(repo, null, {})).rejects.toMatchObject({ status: 401 });
  });
});

describe("11b. unauthorized admin actions (HTTP routes, demo auth)", () => {
  beforeEach(() => resetRateLimits());

  async function session(uid: string) {
    const { POST } = await import("@/app/api/demo/session/route");
    const res = await POST(new Request("http://x/api/demo/session", { method: "POST", body: JSON.stringify({ uid }) }));
    return res.headers.get("set-cookie")!.split(";")[0];
  }

  it("rejects requests without a session", async () => {
    const { GET } = await import("@/app/api/admin/dashboard/route");
    expect((await GET(new Request("http://x/api/admin/dashboard"))).status).toBe(401);
  });

  it("rejects a forged session cookie", async () => {
    const { GET } = await import("@/app/api/admin/dashboard/route");
    const res = await GET(new Request("http://x/api/admin/dashboard", { headers: { cookie: "demo_session=demo-organizer.forged" } }));
    expect(res.status).toBe(401);
  });

  it("volunteer gets 403 from admin routes; organizer gets 200", async () => {
    const vol = await session("demo-vol-a");
    const org = await session("demo-organizer");
    const dash = await import("@/app/api/admin/dashboard/route");
    const rev = await import("@/app/api/admin/claims/reverse/route");
    const inv = await import("@/app/api/admin/inventory/route");
    const imp = await import("@/app/api/admin/import/route");

    expect((await dash.GET(new Request("http://x", { headers: { cookie: vol } }))).status).toBe(403);
    expect((await rev.POST(new Request("http://x", { method: "POST", headers: { cookie: vol }, body: "{}" }))).status).toBe(403);
    expect((await inv.POST(new Request("http://x", { method: "POST", headers: { cookie: vol }, body: JSON.stringify({ kind: "set_initial", value: 1 }) }))).status).toBe(403);
    expect((await imp.POST(new Request("http://x", { method: "POST", headers: { cookie: vol }, body: "a,b" }))).status).toBe(403);
    expect((await dash.GET(new Request("http://x", { headers: { cookie: org } }))).status).toBe(200);
  });

  it("x-demo-actor cannot escalate a volunteer to organizer", async () => {
    const vol = await session("demo-vol-a");
    const dash = await import("@/app/api/admin/dashboard/route");
    const res = await dash.GET(new Request("http://x", { headers: { cookie: vol, "x-demo-actor": "demo-organizer" } }));
    expect(res.status).toBe(403);
  });

  it("claim route works end-to-end for a volunteer and blocks the duplicate", async () => {
    const vol = await session("demo-vol-a");
    const samples = await (await import("@/app/api/demo/samples/route")).GET(new Request("http://x", { headers: { cookie: vol } }));
    const { samples: list } = await samples.json();
    const target = list.find((s: { eligible: boolean; claimed: boolean }) => s.eligible && !s.claimed);
    const { POST } = await import("@/app/api/claims/route");
    const send = (actor: string) =>
      POST(new Request("http://x", { method: "POST", headers: { cookie: vol, "x-demo-actor": actor }, body: JSON.stringify({ ticketNumber: target.ticketNumber, idempotencyKey: crypto.randomUUID(), counter: actor, method: "scan" }) }));
    const [a, b] = await Promise.all([send("demo-vol-a"), send("demo-vol-b")]);
    const statuses = [(await a.json()).status, (await b.json()).status].sort();
    expect(statuses).toEqual(["ALREADY_COLLECTED", "SUCCESS"]);
  });
});
