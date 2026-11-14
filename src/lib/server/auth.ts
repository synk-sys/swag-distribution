import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { IS_DEMO } from "@/lib/config";
import type { Actor, Role } from "@/lib/domain/types";
import { DEMO_ACTORS } from "./demo-seed";
import { forbidden } from "./errors";

export const DEMO_COOKIE = "demo_session";

type G = typeof globalThis & { __demoSecret?: string };
function demoSecret(): string {
  const g = globalThis as G;
  g.__demoSecret ??= process.env.DEMO_SESSION_SECRET || randomBytes(32).toString("hex");
  return g.__demoSecret;
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

/**
 * Resolve the calling staff member.
 *  - production: verifies a Firebase ID token (Authorization: Bearer) incl. revocation,
 *    and reads the `role` custom claim set by an organizer.
 *  - demo: an HMAC-signed cookie naming one of the fictional demo actors. The
 *    dual-counter demo page may act as either demo volunteer via `x-demo-actor`.
 */
export async function getActor(req: Request): Promise<Actor | null> {
  if (IS_DEMO) {
    const uid = readDemoSession(cookie(req, DEMO_COOKIE));
    if (!uid) return null;
    const as = req.headers.get("x-demo-actor");
    const chosen = as && (as === "demo-vol-a" || as === "demo-vol-b") ? as : uid;
    const { uid: id, name, role } = DEMO_ACTORS[chosen];
    return { uid: id, name, role };
  }
  const auth = req.headers.get("authorization") ?? "";
  const m = /^Bearer (.+)$/.exec(auth);
  if (!m) return null;
  const { getAdminAuth } = await import("./firebase-admin");
  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(m[1], true);
  } catch {
    return null;
  }
  const role = decoded.role as Role | undefined;
  if (role !== "organizer" && role !== "volunteer") {
    throw forbidden("Your account has not been given access. Ask an organizer to add you as a volunteer.");
  }
  return { uid: decoded.uid, name: (decoded.name as string) || decoded.email || decoded.uid, role };
}
