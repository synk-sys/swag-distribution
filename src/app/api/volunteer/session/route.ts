import { NextResponse } from "next/server";
import { z } from "zod";
import { sessionSecret } from "@/lib/server/auth";
import { getRepo } from "@/lib/server/context";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate-limit";
import { codeMatches, makeVolunteerSession, VOLUNTEER_COOKIE, VOLUNTEER_SESSION_HOURS } from "@/lib/server/volunteer-session";

export const dynamic = "force-dynamic";

/** Public: which counters volunteers can pick on the login screen. */
export async function GET() {
  try {
    const { volunteerAccess: a } = await (await getRepo()).getSettings();
    return json({ enabled: a.enabled, counters: a.enabled ? a.counters : [], codeRequired: !!a.codeHash });
  } catch (e) {
    return errorResponse(e);
  }
}

const schema = z.object({ counter: z.string().trim().min(1).max(40), code: z.string().max(100).optional() });

function clientIp(req: Request) {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}

/** One tap: start a counter session on this device (no account). */
export async function POST(req: Request) {
  try {
    if (!rateLimit(`counter-session:${clientIp(req)}`, 10, 60_000)) {
      return json({ error: { code: "RATE_LIMITED", message: "Too many attempts. Wait a minute and try again." } }, 429);
    }
    const p = schema.safeParse(await readJson(req));
    if (!p.success) return json({ error: { code: "BAD_REQUEST", message: "Choose a counter." } }, 400);
    const { volunteerAccess: a } = await (await getRepo()).getSettings();
    if (!a.enabled) return json({ error: { code: "DISABLED", message: "Counter sign-in is turned off. Ask an organizer." } }, 403);
    if (!a.counters.includes(p.data.counter)) return json({ error: { code: "BAD_REQUEST", message: "Unknown counter." } }, 400);
    if (!codeMatches(p.data.code, a.codeHash)) return json({ error: { code: "BAD_CODE", message: "Wrong counter code." } }, 403);

    const res = NextResponse.json({ ok: true, counter: p.data.counter });
    res.cookies.set(VOLUNTEER_COOKIE, makeVolunteerSession(p.data.counter, a, sessionSecret()), {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: VOLUNTEER_SESSION_HOURS * 3600,
    });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(VOLUNTEER_COOKIE);
  return res;
}
