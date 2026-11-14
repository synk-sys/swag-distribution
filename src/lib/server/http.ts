import "server-only";
import { NextResponse } from "next/server";
import type { Actor, Role } from "@/lib/domain/types";
import { getActor } from "./auth";
import { getRepo } from "./context";
import { AppError, badRequest, forbidden, unauthorized } from "./errors";
import { rateLimit } from "./rate-limit";
import type { Repo } from "./repo/types";

export interface Ctx {
  req: Request;
  actor: Actor;
  repo: Repo;
}

interface Opts {
  roles: Role[];
  rate?: { name: string; limit: number; windowMs?: number };
}

const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: NO_STORE });
}

export function errorResponse(e: unknown) {
  if (e instanceof AppError) return json({ error: { code: e.code, message: e.message } }, e.status);
  console.error("[api] unexpected error", e);
  return json({ error: { code: "INTERNAL", message: "Server error. The action was NOT completed." } }, 500);
}

/** Wraps a route handler with authentication, role checks, rate limiting and error mapping. */
export function route(opts: Opts, handler: (ctx: Ctx) => Promise<unknown>) {
  return async (req: Request): Promise<Response> => {
    try {
      const actor = await getActor(req);
      if (!actor) throw unauthorized();
      if (!opts.roles.includes(actor.role)) throw forbidden();
      if (opts.rate && !rateLimit(`${opts.rate.name}:${actor.uid}`, opts.rate.limit, opts.rate.windowMs ?? 60_000)) {
        return json({ error: { code: "RATE_LIMITED", message: "Too many requests. Wait a moment and try again." } }, 429);
      }
      const repo = await getRepo();
      const out = await handler({ req, actor, repo });
      return out instanceof Response ? out : json(out);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export async function readJson(req: Request, maxBytes = 16 * 1024): Promise<unknown> {
  const text = await readText(req, maxBytes);
  try {
    return JSON.parse(text);
  } catch {
    throw badRequest("Request body must be JSON.");
  }
}

export async function readText(req: Request, maxBytes: number): Promise<string> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > maxBytes) throw badRequest("Request is too large.");
  const text = await req.text();
  if (new TextEncoder().encode(text).length > maxBytes) throw badRequest("Request is too large.");
  return text;
}
