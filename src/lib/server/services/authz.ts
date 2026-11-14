import type { Actor, Role } from "@/lib/domain/types";
import { forbidden, unauthorized } from "../errors";

/** Defense in depth: every service entry point re-checks the caller's role. */
export function assertRole(actor: Actor | null | undefined, ...roles: Role[]): asserts actor is Actor {
  if (!actor) throw unauthorized();
  if (!roles.includes(actor.role)) throw forbidden();
}

export const STAFF: Role[] = ["organizer", "volunteer"];
