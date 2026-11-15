import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Actor, VolunteerAccess } from "@/lib/domain/types";

/**
 * One-tap counter sessions for volunteers (no account).
 * Cookie = base64url(JSON payload) + "." + HMAC-SHA256(payload, SESSION_SECRET).
 * A session is valid only while: signature matches, not expired, counter access is
 * enabled, the counter still exists, and the epoch matches (organizers can bump it
 * to sign out every counter device at once).
 */

export const VOLUNTEER_COOKIE = "counter_session";
export const VOLUNTEER_SESSION_HOURS = 16;

interface Payload {
  c: string; // counter
  s: string; // device id
  e: number; // epoch
  x: number; // expires at (ms)
}

const b64 = (s: string) => Buffer.from(s).toString("base64url");
const sign = (v: string, secret: string) => createHmac("sha256", secret).update(v).digest("base64url");

export const hashCode = (code: string) => createHash("sha256").update(`swag-counter-code:${code.trim()}`).digest("hex");

export function codeMatches(code: string | undefined, hash: string | null): boolean {
  if (!hash) return true;
  if (!code) return false;
  const a = Buffer.from(hashCode(code));
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function makeVolunteerSession(counter: string, access: VolunteerAccess, secret: string, now = Date.now()): string {
  const payload: Payload = { c: counter, s: randomBytes(6).toString("hex"), e: access.epoch, x: now + VOLUNTEER_SESSION_HOURS * 3600_000 };
  const body = b64(JSON.stringify(payload));
  return `${body}.${sign(body, secret)}`;
}

export function readVolunteerSession(value: string | undefined, access: VolunteerAccess, secret: string, now = Date.now()): Actor | null {
  if (!value || !access.enabled) return null;
  const i = value.lastIndexOf(".");
  if (i < 1) return null;
  const body = value.slice(0, i);
  const a = Buffer.from(value.slice(i + 1));
  const b = Buffer.from(sign(body, secret));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let p: Payload;
  try {
    p = JSON.parse(Buffer.from(body, "base64url").toString());
  } catch {
    return null;
  }
  if (typeof p.c !== "string" || typeof p.s !== "string" || p.x < now || p.e !== access.epoch || !access.counters.includes(p.c)) return null;
  return { uid: `counter-${p.s}`, name: `${p.c} volunteer`, role: "volunteer", counter: p.c };
}
