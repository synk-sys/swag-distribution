import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/domain/types";
import { codeMatches, hashCode, makeVolunteerSession, readVolunteerSession } from "@/lib/server/volunteer-session";
import { resetRateLimits } from "@/lib/server/rate-limit";

const access = DEFAULT_SETTINGS.volunteerAccess;
const SECRET = "x".repeat(40);

describe("counter session cookie", () => {
  it("round-trips to a volunteer bound to its counter", () => {
    const actor = readVolunteerSession(makeVolunteerSession("Counter A", access, SECRET), access, SECRET);
    expect(actor).toMatchObject({ role: "volunteer", counter: "Counter A", name: "Counter A volunteer" });
    expect(actor!.uid).toMatch(/^counter-[0-9a-f]{12}$/);
  });

  it("gives each device its own id", () => {
    const a = readVolunteerSession(makeVolunteerSession("Counter A", access, SECRET), access, SECRET)!;
    const b = readVolunteerSession(makeVolunteerSession("Counter A", access, SECRET), access, SECRET)!;
    expect(a.uid).not.toBe(b.uid);
  });

  it("rejects tampering, wrong secret, expiry, disabled access, removed counter and old epoch", () => {
    const v = makeVolunteerSession("Counter A", access, SECRET, 1_000);
    const forged = Buffer.from(JSON.stringify({ c: "Counter A", s: "abc", e: 1, x: 9e15 })).toString("base64url") + "." + v.split(".")[1];
    expect(readVolunteerSession(forged, access, SECRET, 2_000)).toBeNull();
    expect(readVolunteerSession(v, access, "y".repeat(40), 2_000)).toBeNull();
    expect(readVolunteerSession(v, access, SECRET, 1_000 + 17 * 3600_000)).toBeNull();
    expect(readVolunteerSession(v, { ...access, enabled: false }, SECRET, 2_000)).toBeNull();
    expect(readVolunteerSession(v, { ...access, counters: ["Counter B"] }, SECRET, 2_000)).toBeNull();
    expect(readVolunteerSession(v, { ...access, epoch: 2 }, SECRET, 2_000)).toBeNull();
    expect(readVolunteerSession(v, access, SECRET, 2_000)).not.toBeNull();
  });

  it("checks the optional counter code", () => {
    expect(codeMatches(undefined, null)).toBe(true);
    const h = hashCode("DEVFEST26");
    expect(codeMatches("DEVFEST26", h)).toBe(true);
    expect(codeMatches(" DEVFEST26 ", h)).toBe(true);
    expect(codeMatches("devfest26", h)).toBe(false);
    expect(codeMatches(undefined, h)).toBe(false);
  });
});

describe("one-tap counter sign-in over HTTP", () => {
  beforeEach(() => resetRateLimits());

  const session = () => import("@/app/api/volunteer/session/route");
  const post = async (body: unknown, ip = "10.0.0.1") =>
    (await session()).POST(new Request("http://x/api/volunteer/session", { method: "POST", headers: { "x-forwarded-for": ip }, body: JSON.stringify(body) }));
  const cookieOf = (res: Response) => res.headers.get("set-cookie")!.split(";")[0];
  async function organizerCookie() {
    const { POST } = await import("@/app/api/demo/session/route");
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ uid: "demo-organizer" }) }));
    return res.headers.get("set-cookie")!.split(";")[0];
  }
  const setAccess = async (body: unknown) => {
    const { POST } = await import("@/app/api/admin/volunteer-access/route");
    return POST(new Request("http://x", { method: "POST", headers: { cookie: await organizerCookie() }, body: JSON.stringify(body) }));
  };

  it("lists counters publicly without revealing the code", async () => {
    const res = await (await session()).GET();
    const j = await res.json();
    expect(j).toEqual({ enabled: true, counters: ["Counter A", "Counter B"], codeRequired: false });
  });

  it("one tap gives a volunteer session that can scan but not use admin routes", async () => {
    const res = await post({ counter: "Counter A" });
    expect(res.status).toBe(200);
    const cookie = cookieOf(res);
    expect(res.headers.get("set-cookie")).toMatch(/HttpOnly/i);

    const me = await (await import("@/app/api/me/route")).GET(new Request("http://x", { headers: { cookie } }));
    expect((await me.json()).actor).toMatchObject({ role: "volunteer", counter: "Counter A" });

    const lookup = await (await import("@/app/api/scan/lookup/route")).POST(new Request("http://x", { method: "POST", headers: { cookie }, body: JSON.stringify({ code: "900001:1000038" }) }));
    expect(lookup.status).toBe(200);

    const dash = await (await import("@/app/api/admin/dashboard/route")).GET(new Request("http://x", { headers: { cookie } }));
    expect(dash.status).toBe(403);
    const rev = await (await import("@/app/api/admin/claims/reverse/route")).POST(new Request("http://x", { method: "POST", headers: { cookie }, body: "{}" }));
    expect(rev.status).toBe(403);
  });

  it("records the session's counter even if the client claims another one", async () => {
    const cookie = cookieOf(await post({ counter: "Counter B" }));
    const { POST } = await import("@/app/api/claims/route");
    const res = await POST(new Request("http://x", { method: "POST", headers: { cookie }, body: JSON.stringify({ ticketNumber: "DEVTO261000075", idempotencyKey: crypto.randomUUID(), counter: "Spoofed Counter", method: "scan" }) }));
    const j = await res.json();
    expect(j.status).toBe("SUCCESS");
    expect(j.claim.counter).toBe("Counter B");
    expect(j.claim.claimedByName).toBe("Counter B volunteer");
  });

  it("rejects unknown counters", async () => {
    expect((await post({ counter: "Counter Z" })).status).toBe(400);
  });

  it("enforces a counter code once set, and setting it signs out existing devices", async () => {
    const old = cookieOf(await post({ counter: "Counter A" }));
    expect((await setAccess({ code: "DEVFEST26" })).status).toBe(200);
    expect((await (await session()).GET().then((r) => r.json())).codeRequired).toBe(true);

    expect((await post({ counter: "Counter A" })).status).toBe(403);
    expect((await post({ counter: "Counter A", code: "wrong" })).status).toBe(403);
    const ok = await post({ counter: "Counter A", code: "DEVFEST26" });
    expect(ok.status).toBe(200);

    const me = await import("@/app/api/me/route");
    expect((await me.GET(new Request("http://x", { headers: { cookie: old } }))).status).toBe(401);
    expect((await me.GET(new Request("http://x", { headers: { cookie: cookieOf(ok) } }))).status).toBe(200);
    await setAccess({ code: null });
  });

  it("'sign out all counter devices' and 'turn off' both block existing sessions", async () => {
    const me = await import("@/app/api/me/route");
    const c1 = cookieOf(await post({ counter: "Counter A" }));
    await setAccess({ signOutAll: true });
    expect((await me.GET(new Request("http://x", { headers: { cookie: c1 } }))).status).toBe(401);

    const c2 = cookieOf(await post({ counter: "Counter A" }));
    await setAccess({ enabled: false });
    expect((await me.GET(new Request("http://x", { headers: { cookie: c2 } }))).status).toBe(401);
    expect((await post({ counter: "Counter A" })).status).toBe(403);
    await setAccess({ enabled: true });
  });

  it("an organizer sign-in on a counter phone takes priority over the counter session", async () => {
    const counter = cookieOf(await post({ counter: "Counter A" }));
    const org = await organizerCookie();
    const dash = await (await import("@/app/api/admin/dashboard/route")).GET(new Request("http://x", { headers: { cookie: `${counter}; ${org}` } }));
    expect(dash.status).toBe(200);
  });

  it("volunteers cannot change counter access", async () => {
    const cookie = cookieOf(await post({ counter: "Counter A" }));
    const { POST } = await import("@/app/api/admin/volunteer-access/route");
    const res = await POST(new Request("http://x", { method: "POST", headers: { cookie }, body: JSON.stringify({ code: null }) }));
    expect(res.status).toBe(403);
  });

  it("rate-limits session creation per IP (stops code guessing)", async () => {
    const statuses = [];
    for (let i = 0; i < 12; i++) statuses.push((await post({ counter: "Counter A" }, "10.9.9.9")).status);
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });
});
