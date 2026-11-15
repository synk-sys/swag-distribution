import { z } from "zod";
import { parseBarcode, REJECT_REASON_TEXT } from "@/lib/domain/barcode";
import { evaluateEligibility } from "@/lib/domain/eligibility";
import {
  remainingBags,
  STATUS_MESSAGES,
  type Actor,
  type AttendeeView,
  type ClaimInfoView,
  type ClaimResult,
  type LookupResult,
  type Registration,
} from "@/lib/domain/types";
import { badRequest, conflict } from "../errors";
import type { Repo } from "../repo/types";
import { assertRole, STAFF } from "./authz";

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!domain) return "";
  return `${user.slice(0, 1)}${"•".repeat(Math.max(1, Math.min(6, user.length - 1)))}@${domain}`;
}

export function toAttendeeView(r: Registration): AttendeeView {
  return {
    ticketNumber: r.ticketNumber,
    firstName: r.firstName,
    lastName: r.lastName,
    ticketTitle: r.ticketTitle,
    barcodeId: r.barcodeId,
    emailMasked: maskEmail(r.email),
  };
}

export function toClaimView(r: Registration): ClaimInfoView | undefined {
  if (r.swag?.status !== "claimed") return undefined;
  return {
    claimId: r.swag.claimId,
    claimedAt: r.swag.claimedAt,
    claimedByName: r.swag.claimedBy.name,
    counter: r.swag.counter,
    method: r.swag.method,
  };
}

/** Read-only status check for a registration (used by scan + manual lookup). */
async function statusFor(repo: Repo, reg: Registration, barcode?: LookupResult["barcode"]): Promise<LookupResult> {
  const [settings, inv] = await Promise.all([repo.getSettings(), repo.getInventory()]);
  const attendee = toAttendeeView(reg);
  const remaining = remainingBags(inv);
  const base = { attendee, remaining, barcode, requireNameCheck: settings.verification.requireNameCheck };
  if (reg.swag?.status === "claimed") {
    return { ...base, status: "ALREADY_COLLECTED", message: STATUS_MESSAGES.ALREADY_COLLECTED, previousClaim: toClaimView(reg) };
  }
  const elig = evaluateEligibility(reg, settings.eligibility);
  if (!elig.eligible) return { ...base, status: "INELIGIBLE", message: STATUS_MESSAGES.INELIGIBLE, reason: elig.reason };
  if (remaining <= 0) return { ...base, status: "OUT_OF_STOCK", message: STATUS_MESSAGES.OUT_OF_STOCK };
  return { ...base, status: "ELIGIBLE", message: STATUS_MESSAGES.ELIGIBLE };
}

export async function lookupBarcode(repo: Repo, actor: Actor | null, code: string): Promise<LookupResult> {
  assertRole(actor, ...STAFF);
  const settings = await repo.getSettings();
  const parsed = parseBarcode(code, settings.barcode);
  if (!parsed.ok) {
    return { status: "NOT_FOUND", reason: REJECT_REASON_TEXT[parsed.reason], message: STATUS_MESSAGES.NOT_FOUND };
  }
  const barcode = { prefix: parsed.prefix, id: parsed.id };
  if (!settings.barcode.validated) {
    return { status: "FORMAT_NOT_VALIDATED", message: STATUS_MESSAGES.FORMAT_NOT_VALIDATED, barcode };
  }
  const matches = await repo.findByBarcodeId(parsed.id);
  if (matches.length === 0) {
    return { status: "NOT_FOUND", reason: "No registration has this barcode identifier.", message: STATUS_MESSAGES.NOT_FOUND, barcode };
  }
  if (matches.length > 1) {
    return {
      status: "NOT_FOUND",
      reason: "Ambiguous barcode: it matches more than one registration. Use manual lookup by name or full ticket number.",
      message: STATUS_MESSAGES.NOT_FOUND,
      barcode,
    };
  }
  return statusFor(repo, matches[0], barcode);
}

export async function lookupTicket(repo: Repo, actor: Actor | null, ticketNumber: string): Promise<LookupResult> {
  assertRole(actor, ...STAFF);
  const reg = await repo.getRegistration(ticketNumber.trim().toUpperCase());
  if (!reg) return { status: "NOT_FOUND", reason: "No registration with this ticket number.", message: STATUS_MESSAGES.NOT_FOUND };
  return statusFor(repo, reg);
}

export async function searchAttendees(repo: Repo, actor: Actor | null, query: string) {
  assertRole(actor, ...STAFF);
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const all = await repo.listRegistrations();
  const terms = q.split(/\s+/);
  return all
    .filter((r) => {
      const hay = [r.firstName, r.lastName, r.email, r.ticketNumber, r.barcodeId ?? ""].join(" ").toLowerCase();
      return terms.every((t) => hay.includes(t));
    })
    .slice(0, 25)
    .map((r) => ({ ...toAttendeeView(r), claimed: r.swag?.status === "claimed", claim: toClaimView(r) }));
}

export const claimInputSchema = z.object({
  ticketNumber: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{4,64}$/),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
  counter: z.string().trim().min(1).max(40),
  method: z.enum(["scan", "manual"]),
  nameVerified: z.boolean().optional(),
});
export type ClaimInput = z.infer<typeof claimInputSchema>;

/**
 * THE one-time claim. Runs as a single serializable transaction:
 * idempotency check → exists → eligible → not yet claimed → inventory > 0 →
 * mark claimed + decrement inventory + audit event + idempotency record.
 * If two counters race, the transaction that commits second re-reads the
 * registration, sees it claimed, and returns ALREADY_COLLECTED.
 */
export async function claimSwag(repo: Repo, actor: Actor | null, rawInput: unknown, now = () => new Date()): Promise<ClaimResult> {
  assertRole(actor, ...STAFF);
  const parsed = claimInputSchema.safeParse(rawInput);
  if (!parsed.success) throw badRequest("Invalid claim request.");
  const input = parsed.data;
  const idemKey = `${actor.uid.replace(/[^A-Za-z0-9_-]/g, "_")}_${input.idempotencyKey}`;

  const result = await repo.transaction<ClaimResult>(async (tx) => {
    // Lock order matters (Postgres row locks): registration first, then inventory.
    // The idempotency record is read AFTER the registration lock is held, so a
    // concurrent retry of the same request waits and then sees the first result.
    const reg = await tx.getRegistration(input.ticketNumber);
    const prior = await tx.getIdempotency(idemKey);
    const settings = await tx.getSettings();
    const inv = await tx.getInventory();

    if (prior) {
      if (prior.ticketNumber !== input.ticketNumber) {
        return { status: "IDEMPOTENCY_CONFLICT", message: "This request key was already used for a different attendee." };
      }
      return { ...prior.result, replayed: true };
    }
    if (!reg) return { status: "NOT_FOUND", message: STATUS_MESSAGES.NOT_FOUND };
    const attendee = toAttendeeView(reg);
    if (reg.swag?.status === "claimed") {
      return { status: "ALREADY_COLLECTED", message: STATUS_MESSAGES.ALREADY_COLLECTED_ON_CLAIM, claim: toClaimView(reg), attendee };
    }
    const elig = evaluateEligibility(reg, settings.eligibility);
    if (!elig.eligible) return { status: "INELIGIBLE", message: `${STATUS_MESSAGES.INELIGIBLE} ${elig.reason}`, attendee };
    if (settings.verification.requireNameCheck && !input.nameVerified) {
      throw badRequest("Confirm the attendee's name against their badge before distributing.");
    }
    if (remainingBags(inv) <= 0) return { status: "OUT_OF_STOCK", message: STATUS_MESSAGES.OUT_OF_STOCK, attendee, remaining: 0 };

    const at = now();
    const claimedBy = { uid: actor.uid, name: actor.name };
    const claimId = tx.addEvent({
      type: "claim",
      at: at.toISOString(),
      atMs: at.getTime(),
      actor: { ...claimedBy, role: actor.role },
      ticketNumber: reg.ticketNumber,
      counter: input.counter,
      details: { method: input.method, attendeeName: `${reg.firstName} ${reg.lastName}`.trim(), nameVerified: !!input.nameVerified },
    });
    tx.updateSwag(reg.ticketNumber, {
      status: "claimed",
      claimId,
      claimedAt: at.toISOString(),
      claimedAtMs: at.getTime(),
      claimedBy,
      counter: input.counter,
      method: input.method,
    });
    const newInv = { ...inv, bagsOut: inv.bagsOut + 1, activeClaims: inv.activeClaims + 1 };
    tx.setInventory(newInv);
    const res: ClaimResult = {
      status: "SUCCESS",
      message: STATUS_MESSAGES.SUCCESS,
      attendee,
      remaining: remainingBags(newInv),
      claim: { claimId, claimedAt: at.toISOString(), claimedByName: actor.name, counter: input.counter, method: input.method },
    };
    tx.setIdempotency(idemKey, {
      uid: actor.uid,
      ticketNumber: reg.ticketNumber,
      result: res,
      createdAt: at.toISOString(),
      expiresAt: new Date(at.getTime() + IDEMPOTENCY_TTL_MS).toISOString(),
    });
    tx.bumpLive();
    return res;
  });

  if (result.status !== "SUCCESS" && !result.replayed) {
    const at = now();
    // Best effort: record denied attempts (duplicate scans etc.) for the audit trail.
    await repo
      .addEvent({
        type: "claim_denied",
        at: at.toISOString(),
        atMs: at.getTime(),
        actor: { uid: actor.uid, name: actor.name, role: actor.role },
        ticketNumber: input.ticketNumber,
        counter: input.counter,
        details: { status: result.status, method: input.method },
      })
      .catch(() => undefined);
  }
  return result;
}

export const reverseInputSchema = z.object({
  ticketNumber: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{4,64}$/),
  claimId: z.string().min(8).max(64),
  reason: z.string().trim().min(5, "A reason of at least 5 characters is required.").max(500),
  bagReturned: z.boolean(),
  confirm: z.literal(true),
});

/** Organizer-only reversal. Never deletes history; restocks only if the bag physically came back. */
export async function reverseClaim(repo: Repo, actor: Actor | null, rawInput: unknown, now = () => new Date()) {
  assertRole(actor, "organizer");
  const parsed = reverseInputSchema.safeParse(rawInput);
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "Invalid reversal request.");
  const input = parsed.data;

  return repo.transaction(async (tx) => {
    const reg = await tx.getRegistration(input.ticketNumber);
    const inv = await tx.getInventory();
    if (!reg) throw conflict("NOT_FOUND", "Registration not found.");
    if (reg.swag?.status !== "claimed") throw conflict("NOT_CLAIMED", "This registration has no active claim.");
    if (reg.swag.claimId !== input.claimId) {
      throw conflict("CLAIM_CHANGED", "The claim changed since you loaded it. Refresh and try again.");
    }
    const at = now();
    const by = { uid: actor.uid, name: actor.name };
    tx.updateSwag(reg.ticketNumber, {
      status: "unclaimed",
      lastReversal: { claimId: input.claimId, reversedAt: at.toISOString(), reversedBy: by, reason: input.reason, bagReturned: input.bagReturned },
    });
    const newInv = {
      ...inv,
      activeClaims: Math.max(0, inv.activeClaims - 1),
      bagsOut: input.bagReturned ? Math.max(0, inv.bagsOut - 1) : inv.bagsOut,
    };
    tx.setInventory(newInv);
    tx.addEvent({
      type: "claim_reversed",
      at: at.toISOString(),
      atMs: at.getTime(),
      actor: { ...by, role: actor.role },
      ticketNumber: reg.ticketNumber,
      claimId: input.claimId,
      counter: reg.swag.counter,
      details: {
        reason: input.reason,
        bagReturned: input.bagReturned,
        inventoryRestored: input.bagReturned,
        originalClaimedAt: reg.swag.claimedAt,
        originalClaimedBy: reg.swag.claimedBy.name,
      },
    });
    tx.bumpLive();
    return { ok: true as const, remaining: remainingBags(newInv) };
  });
}
