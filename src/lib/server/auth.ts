import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { IS_DEMO } from "@/lib/config";
import type { Actor, Role, VolunteerAccess } from "@/lib/domain/types";
import { DEMO_ACTORS } from "./demo-seed";
import { AppError, forbidden } from "./errors";
import { readVolunteerSession, VOLUNTEER_COOKIE } from "./volunteer-session";

export const DEMO_COOKIE = "demo_session";

type G = typeof globalThis & { __demoSecret?: string };
function demoSecret(): string {
  const g = globalThis as G;
  g.__demoSecret ??= process.env.DEMO_SESSION_SECRET || randomBytes(32).toString("hex");
  return g.__demoSecret;
}

/** Secret for signing counter-session cookies. Required in production (fails closed). */
export function sessionSecret(): string {
  const v = process.env.SESSION_SECRET;
  if (v && v.length >= 32) return v;
  if (IS_DEMO) return demoSecret();
  throw new AppError(500, "MISCONFIGURED", "SESSION_SECRET (32+ characters) must be set on the server for counter sign-in.");
}

let accessCache: { value: VolunteerAccess; at: number } | null = null;
export function clearAccessCache() {
  accessCache = null;
}
async function volunteerAccess(): Promise<VolunteerAccess> {
  if (accessCache && Date.now() - accessCache.at < 10_000) return accessCache.value;
  const { getRepo } = await import("./context");
  const value = (await (await getRepo()).getSettings()).volunteerAccess;
  accessCache = { value, at: Date.now() };
  return value;
}

const sign = (v: string) => createHmac("sha256", demoSecret()).update(v).digest("base64url");

export function makeDemoSession(uid: string): string {
  if (!IS_DEMO || !DEMO_ACTORS[uid]) throw forbidden();
  return `${uid}.${sign(uid)}`;
}

function readDemoSession(cookieValue: string | undefined): string | null {
  if (!cookieValue) return null;
  const i = cookieValue.lastIndexOf(".");
  if (i < 0) return null;
  const uid = cookieValue.slice(0, i);
  const a = Buffer.from(cookieValue.slice(i + 1));
  const b = Buffer.from(sign(uid));
  return a.length === b.length && timingSafeEqual(a, b) && DEMO_ACTORS[uid] ? uid : null;
}

function cookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

const staffCache = new Map<string, { actor: Actor | null; at: number }>();
const STAFF_CACHE_MS = 15_000;
export function clearStaffCache() {
  staffCache.clear();
}

/**
 * Resolve the calling staff member.
 *  - production: verifies the Supabase access token (Authorization: Bearer) with
 *    Supabase Auth, then reads the role from the `staff` table (server-side, so
 *    removing someone takes effect within 15 seconds).
 *  - counter devices (both modes): a signed counter-session cookie, no account.
 *  - demo: an HMAC-signed cookie naming one of the fictional demo actors. The
 *    dual-counter demo page may act as either demo volunteer via `x-demo-actor`.
 */
export async function getActor(req: Request): Promise<Actor | null> {
  // 1. Organizer / staff account (production). Takes priority over a counter cookie,
  //    so a counter phone can sign in as an organizer.
  const m = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "");
  if (m && !IS_DEMO) return staffFromToken(m[1]);

  // 2. Demo organizer / demo actors.
  if (IS_DEMO) {
    const uid = readDemoSession(cookie(req, DEMO_COOKIE));
    if (uid && (uid === "demo-organizer" || req.headers.get("x-demo-actor"))) {
      const as = req.headers.get("x-demo-actor");
      const chosen = as && (as === "demo-vol-a" || as === "demo-vol-b") ? as : uid;
      const { uid: id, name, role, counter } = DEMO_ACTORS[chosen];
      return { uid: id, name, role, ...(counter && chosen !== uid ? { counter } : {}) };
    }
  }

  // 3. No-sign-in counter device (both modes). Checked against live settings so
  //    organizers can disable counters or sign them all out.
  const counterCookie = cookie(req, VOLUNTEER_COOKIE);
  if (counterCookie) {
    const actor = readVolunteerSession(counterCookie, await volunteerAccess(), sessionSecret());
    if (actor) return actor;
  }

  // 4. Remaining demo identities (demo volunteers).
  if (IS_DEMO) {
    const uid = readDemoSession(cookie(req, DEMO_COOKIE));
    if (uid) {
      const { uid: id, name, role } = DEMO_ACTORS[uid];
      return { uid: id, name, role };
    }
  }
  return null;
}

async function staffFromToken(token: string): Promise<Actor | null> {
  const { getSupabaseAdmin } = await import("./supabase-admin");
  const { data, error } = await getSupabaseAdmin().auth.getUser(token);
  if (error || !data.user) return null;
  const uid = data.user.id;

  const cached = staffCache.get(uid);
  let actor: Actor | null;
  if (cached && Date.now() - cached.at < STAFF_CACHE_MS) actor = cached.actor;
  else {
    const { getRepo } = await import("./context");
    const staff = await (await getRepo()).getStaff(uid);
    actor = staff ? { uid, name: staff.displayName, role: staff.role as Role } : null;
    staffCache.set(uid, { actor, at: Date.now() });
  }
  if (!actor) throw forbidden("Your account has not been given access. Ask an organizer to add you.");
  return actor;
}
