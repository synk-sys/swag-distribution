import { NextResponse } from "next/server";
import { z } from "zod";
import { IS_DEMO } from "@/lib/config";
import { DEMO_COOKIE, makeDemoSession } from "@/lib/server/auth";
import { DEMO_ACTORS } from "@/lib/server/demo-seed";
import { errorResponse, json, readJson } from "@/lib/server/http";

const schema = z.object({ uid: z.string() });

export async function POST(req: Request) {
  if (!IS_DEMO) return json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404);
  try {
    const p = schema.safeParse(await readJson(req));
    if (!p.success || !DEMO_ACTORS[p.data.uid]) return json({ error: { code: "BAD_REQUEST", message: "Unknown demo user" } }, 400);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(DEMO_COOKIE, makeDemoSession(p.data.uid), { httpOnly: true, sameSite: "strict", path: "/", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 12 });
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(DEMO_COOKIE);
  return res;
}
