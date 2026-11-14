import { describe, expect, it, vi } from "vitest";
import { api, ApiError, NetworkError } from "@/lib/client/api";

const sleep = async () => {};
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe("13. client network failure and retry", () => {
  it("retries network failures with the identical body (same idempotency key)", async () => {
    const bodies: string[] = [];
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(String(init?.body));
      if (bodies.length < 3) throw new TypeError("Failed to fetch");
      return ok({ status: "SUCCESS" });
    });
    const res = await api<{ status: string }>("/api/claims", { body: { ticketNumber: "T", idempotencyKey: "k-123456789" }, fetchImpl: fetchImpl as typeof fetch, sleep });
    expect(res.status).toBe("SUCCESS");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(new Set(bodies).size).toBe(1);
    expect(JSON.parse(bodies[0]).idempotencyKey).toBe("k-123456789");
  });

  it("throws NetworkError (never a fake success) when all attempts fail", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("offline");
    });
    await expect(api("/api/claims", { body: {}, retries: 2, fetchImpl: fetchImpl as typeof fetch, sleep })).rejects.toBeInstanceOf(NetworkError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("does not retry 4xx business errors", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { code: "FORBIDDEN", message: "no" } }), { status: 403 }));
    await expect(api("/api/admin/x", { body: {}, fetchImpl: fetchImpl as typeof fetch, sleep })).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries 5xx then surfaces ApiError", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 503 }));
    await expect(api("/x", { body: {}, retries: 1, fetchImpl: fetchImpl as typeof fetch, sleep })).rejects.toBeInstanceOf(ApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
