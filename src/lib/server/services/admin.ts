import { randomUUID } from "node:crypto";
import { z } from "zod";
import { barcodeIdForTicket, parseBarcode, REJECT_REASON_TEXT } from "@/lib/domain/barcode";
import { findAmbiguous, parseBevyCsv, toCsv, type CsvParseReport } from "@/lib/domain/csv";
import { evaluateEligibility } from "@/lib/domain/eligibility";
import {
  barcodeSettingsSchema,
  eligibilitySettingsSchema,
  remainingBags,
  verificationSettingsSchema,
  type Actor,
  type Registration,
  type Settings,
} from "@/lib/domain/types";
import { badRequest, conflict } from "../errors";
import type { Repo } from "../repo/types";
import { assertRole } from "./authz";
import { toClaimView } from "./claims";

const actorRef = (a: Actor) => ({ uid: a.uid, name: a.name, role: a.role });
const stamp = (now: Date) => ({ at: now.toISOString(), atMs: now.getTime() });

// ---------------------------------------------------------------- import

export interface ImportDiff {
  newTickets: number;
  updatedTickets: number;
  unchangedTickets: number;
  removedTickets: string[];
  claimsPreserved: number;
  ambiguousAcrossAll: Record<string, string[]>;
}

export interface ImportOutcome {
  dryRun: boolean;
  importId?: string;
  report: Omit<CsvParseReport, "validRecords"> & { validCount: number; preview: CsvParseReport["validRecords"] };
  diff: ImportDiff;
}

function sameCsv(a: Registration, b: CsvParseReport["validRecords"][number]) {
  return (
    a.orderNumber === b.orderNumber &&
    a.firstName === b.firstName &&
    a.lastName === b.lastName &&
    a.email === b.email &&
    a.ticketTitle === b.ticketTitle &&
    a.checkinDateUtc === b.checkinDateUtc &&
    a.barcodeId === b.barcodeId &&
    JSON.stringify(a.extra) === JSON.stringify(b.extra) &&
    a.inLatestImport
  );
}

export async function importCsv(repo: Repo, actor: Actor | null, csvText: string, opts: { dryRun: boolean }, now = () => new Date()): Promise<ImportOutcome> {
  assertRole(actor, "organizer");
  const settings = await repo.getSettings();
  const report = parseBevyCsv(csvText, { suffixLength: settings.barcode.suffixLength });
  if (!report.ok) throw badRequest(report.fatal ?? "Could not parse CSV.");

  const existing = await repo.listRegistrations();
  const existingBy = new Map(existing.map((r) => [r.ticketNumber, r]));
  const incoming = new Set(report.validRecords.map((r) => r.ticketNumber));
  let newTickets = 0,
    updatedTickets = 0,
    unchangedTickets = 0;
  for (const rec of report.validRecords) {
    const ex = existingBy.get(rec.ticketNumber);
    if (!ex) newTickets++;
    else if (sameCsv(ex, rec)) unchangedTickets++;
    else updatedTickets++;
  }
  const removedTickets = existing.filter((r) => !incoming.has(r.ticketNumber) && r.inLatestImport).map((r) => r.ticketNumber);
  const claimsPreserved = existing.filter((r) => r.swag?.status === "claimed").length;
  // Ambiguity must consider registrations kept from earlier imports too.
  const union = new Map(existing.map((r) => [r.ticketNumber, r.barcodeId]));
  for (const r of report.validRecords) union.set(r.ticketNumber, r.barcodeId);
  const ambiguousAcrossAll = findAmbiguous([...union].map(([ticketNumber, barcodeId]) => ({ ticketNumber, barcodeId })));

  const { validRecords, ...rest } = report;
  const outcome: ImportOutcome = {
    dryRun: opts.dryRun,
    report: { ...rest, validCount: validRecords.length, preview: validRecords.slice(0, 50) },
    diff: { newTickets, updatedTickets, unchangedTickets, removedTickets, claimsPreserved, ambiguousAcrossAll },
  };
  if (opts.dryRun) return outcome;
  if (validRecords.length === 0) throw badRequest("No valid records to import.");

  const importId = randomUUID();
  const at = now();
  await repo.applyImport(validRecords, removedTickets, { importId, now: at.toISOString() });
  await repo.addEvent({
    type: "import",
    ...stamp(at),
    actor: actorRef(actor),
    details: {
      importId,
      totalRows: report.totalRows,
      imported: validRecords.length,
      errors: report.errorCount,
      warnings: report.warningCount,
      newTickets,
      updatedTickets,
      removed: removedTickets.length,
      claimsPreserved,
    },
  });
  await repo.bumpLive();
  return { ...outcome, importId };
}

// ---------------------------------------------------------------- inventory

export const inventoryInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("set_initial"), value: z.number().int().min(0).max(100000), reason: z.string().trim().max(500).optional() }),
  z.object({ kind: z.literal("adjust"), delta: z.number().int().min(-100000).max(100000).refine((d) => d !== 0), reason: z.string().trim().min(3).max(500) }),
]);

export async function changeInventory(repo: Repo, actor: Actor | null, raw: unknown, now = () => new Date()) {
  assertRole(actor, "organizer");
  const parsed = inventoryInputSchema.safeParse(raw);
  if (!parsed.success) throw badRequest("Invalid inventory change. Adjustments need a non-zero amount and a reason.");
  const input = parsed.data;
  return repo.transaction(async (tx) => {
    const inv = await tx.getInventory();
    const next =
      input.kind === "set_initial" ? { ...inv, initial: input.value } : { ...inv, adjustments: inv.adjustments + input.delta };
    if (remainingBags(next) < 0) throw conflict("NEGATIVE_INVENTORY", "That change would make remaining inventory negative.");
    tx.setInventory(next);
    tx.addEvent({
      type: input.kind === "set_initial" ? "inventory_set_initial" : "inventory_adjust",
      ...stamp(now()),
      actor: actorRef(actor),
      details: { before: inv, after: next, reason: input.reason ?? null, ...(input.kind === "adjust" ? { delta: input.delta } : { value: input.value }) },
    });
    tx.bumpLive();
    return { inventory: next, remaining: remainingBags(next) };
  });
}

// ---------------------------------------------------------------- eligibility override

export const overrideSchema = z.object({
  ticketNumber: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{4,64}$/),
  value: z.enum(["eligible", "ineligible"]).nullable(),
  reason: z.string().trim().min(3).max(500),
});

export async function setEligibilityOverride(repo: Repo, actor: Actor | null, raw: unknown, now = () => new Date()) {
  assertRole(actor, "organizer");
  const parsed = overrideSchema.safeParse(raw);
  if (!parsed.success) throw badRequest("Invalid eligibility change (a reason is required).");
  const input = parsed.data;
  return repo.transaction(async (tx) => {
    const reg = await tx.getRegistration(input.ticketNumber);
    if (!reg) throw conflict("NOT_FOUND", "Registration not found.");
    const at = now();
    const override = input.value ? { value: input.value, reason: input.reason, by: { uid: actor.uid, name: actor.name }, at: at.toISOString() } : null;
    tx.updateEligibilityOverride(reg.ticketNumber, override);
    tx.addEvent({
      type: "eligibility_override",
      ...stamp(at),
      actor: actorRef(actor),
      ticketNumber: reg.ticketNumber,
      details: { before: reg.eligibilityOverride ?? null, after: override, reason: input.reason },
    });
    tx.bumpLive();
    return { ok: true };
  });
}

// ---------------------------------------------------------------- settings

export const settingsPatchSchema = z.object({
  barcode: barcodeSettingsSchema.omit({ validatedAt: true, validatedBy: true }).optional(),
  eligibility: eligibilitySettingsSchema.optional(),
  verification: verificationSettingsSchema.optional(),
});

export async function updateSettings(repo: Repo, actor: Actor | null, raw: unknown, now = () => new Date()) {
  assertRole(actor, "organizer");
  const parsed = settingsPatchSchema.safeParse(raw);
  if (!parsed.success) throw badRequest("Invalid settings: " + (parsed.error.issues[0]?.message ?? ""));
  const patch = parsed.data;
  if (patch.barcode) {
    for (const p of [patch.barcode.prefixPattern, patch.barcode.idPattern]) {
      try {
        new RegExp(p);
      } catch {
        throw badRequest(`Invalid pattern: ${p}`);
      }
    }
    if (patch.barcode.prefixPolicy === "enforce" && patch.barcode.allowedPrefixes.length === 0) {
      throw badRequest("Enforcing prefixes requires at least one allowed prefix.");
    }
  }
  const at = now();
  const { before, after } = await repo.transaction(async (tx) => {
    const before = await tx.getSettings();
    const after = { ...before, ...patch } as typeof before;
    if (patch.barcode) {
      const wasValidated = before.barcode.validated;
      after.barcode = {
        ...patch.barcode,
        validatedBy: patch.barcode.validated ? (wasValidated ? before.barcode.validatedBy : actor.name) : null,
        validatedAt: patch.barcode.validated ? (wasValidated ? before.barcode.validatedAt : at.toISOString()) : null,
      };
    }
    tx.setSettings(after);
    tx.addEvent({ type: "settings_change", ...stamp(at), actor: actorRef(actor), details: { before, after } });
    tx.bumpLive();
    return { before, after };
  });
  // Changing the suffix length changes every lookup key, so rebuild the index.
  if (before.barcode.suffixLength !== after.barcode.suffixLength) {
    const regs = await repo.listRegistrations();
    await repo.setBarcodeIds(regs.map((r) => ({ ticketNumber: r.ticketNumber, barcodeId: barcodeIdForTicket(r.ticketNumber, after.barcode.suffixLength) })));
  }
  return after;
}

/** Validation screen: test real scanned barcodes against imported data without claiming. */
export async function validateBarcodes(repo: Repo, actor: Actor | null, codes: string[]) {
  assertRole(actor, "organizer");
  if (!Array.isArray(codes) || codes.length > 50) throw badRequest("Provide up to 50 barcodes.");
  const settings = await repo.getSettings();
  // Evaluate parsing without prefix enforcement so organizers can see every prefix observed.
  const lenient = { ...settings.barcode, prefixPolicy: "ignore" as const };
  return Promise.all(
    codes.map(async (code) => {
      const parsed = parseBarcode(String(code), lenient);
      if (!parsed.ok) return { code, ok: false, result: "MALFORMED", detail: REJECT_REASON_TEXT[parsed.reason] };
      const matches = await repo.findByBarcodeId(parsed.id);
      const prefixAllowed = settings.barcode.allowedPrefixes.includes(parsed.prefix);
      const base = { code, prefix: parsed.prefix, id: parsed.id, prefixAllowed };
      if (matches.length === 0) return { ...base, ok: false, result: "NO_MATCH", detail: "No imported ticket ends with this identifier." };
      if (matches.length > 1) return { ...base, ok: false, result: "AMBIGUOUS", detail: `Matches ${matches.map((m) => m.ticketNumber).join(", ")}` };
      const m = matches[0];
      return { ...base, ok: true, result: "MATCH", ticketNumber: m.ticketNumber, name: `${m.firstName} ${m.lastName}`.trim(), detail: "Exactly one registration matches." };
    }),
  );
}

// ---------------------------------------------------------------- dashboard + export

export async function dashboard(repo: Repo, actor: Actor | null) {
  assertRole(actor, "organizer");
  const [regs, inv, settings, recent] = await Promise.all([
    repo.listRegistrations(),
    repo.getInventory(),
    repo.getSettings(),
    repo.listEvents({ limit: 40, types: ["claim", "claim_reversed", "claim_denied"] }),
  ]);
  let eligible = 0,
    claimed = 0,
    eligibleNotCollected = 0;
  const byVolunteer: Record<string, number> = {};
  const byCounter: Record<string, number> = {};
  const attendees = regs.map((r) => {
    const e = evaluateEligibility(r, settings.eligibility);
    const isClaimed = r.swag?.status === "claimed";
    if (e.eligible) eligible++;
    if (isClaimed) {
      claimed++;
      const s = r.swag as Extract<Registration["swag"], { status: "claimed" }>;
      byVolunteer[s.claimedBy.name] = (byVolunteer[s.claimedBy.name] ?? 0) + 1;
      byCounter[s.counter] = (byCounter[s.counter] ?? 0) + 1;
    } else if (e.eligible) eligibleNotCollected++;
    return {
      ticketNumber: r.ticketNumber,
      orderNumber: r.orderNumber,
      firstName: r.firstName,
      lastName: r.lastName,
      email: r.email,
      ticketTitle: r.ticketTitle,
      checkinDateUtc: r.checkinDateUtc,
      barcodeId: r.barcodeId,
      inLatestImport: r.inLatestImport,
      eligible: e.eligible,
      eligibilityReason: e.reason,
      override: r.eligibilityOverride ?? null,
      claim: toClaimView(r) ?? null,
      lastReversal: r.swag?.status === "unclaimed" ? (r.swag.lastReversal ?? null) : null,
    };
  });
  attendees.sort((a, b) => (a.lastName + a.firstName).localeCompare(b.lastName + b.firstName));
  return {
    totals: {
      registered: regs.length,
      eligible,
      distributed: claimed,
      eligibleNotCollected,
      initialInventory: inv.initial,
      adjustments: inv.adjustments,
      bagsOut: inv.bagsOut,
      remaining: remainingBags(inv),
    },
    byVolunteer,
    byCounter,
    recent,
    settings: { ...settings, volunteerAccess: { ...settings.volunteerAccess, codeHash: settings.volunteerAccess.codeHash ? "set" : null } },
    attendees,
  };
}

export async function exportCsv(repo: Repo, actor: Actor | null, kind: "attendees" | "events") {
  assertRole(actor, "organizer");
  if (kind === "events") {
    const events = await repo.listEvents({ limit: 100000 });
    return toCsv(
      ["Time (UTC)", "Type", "Actor", "Role", "Ticket number", "Counter", "Claim ID", "Details"],
      events.map((e) => [e.at, e.type, e.actor.name, e.actor.role, e.ticketNumber ?? "", e.counter ?? "", e.claimId ?? "", JSON.stringify(e.details ?? {})]),
    );
  }
  const d = await dashboard(repo, actor);
  return toCsv(
    ["Ticket number", "Order number", "First Name", "Last Name", "Email", "Ticket title", "Checkin Date (UTC)", "Barcode ID", "In latest import", "Eligible", "Eligibility reason", "Swag collected", "Collected at (UTC)", "Collected by", "Counter", "Method", "Claim ID"],
    d.attendees.map((a) => [
      a.ticketNumber, a.orderNumber, a.firstName, a.lastName, a.email, a.ticketTitle, a.checkinDateUtc ?? "", a.barcodeId ?? "",
      a.inLatestImport ? "yes" : "no", a.eligible ? "yes" : "no", a.eligibilityReason, a.claim ? "yes" : "no",
      a.claim?.claimedAt ?? "", a.claim?.claimedByName ?? "", a.claim?.counter ?? "", a.claim?.method ?? "", a.claim?.claimId ?? "",
    ]),
  );
}

export async function auditLog(repo: Repo, actor: Actor | null, limit = 500) {
  assertRole(actor, "organizer");
  return repo.listEvents({ limit: Math.min(Math.max(1, limit), 2000) });
}

// ---------------------------------------------------------------- volunteer counter access

export const volunteerAccessPatchSchema = z.object({
  enabled: z.boolean().optional(),
  counters: z.array(z.string().trim().min(1).max(40)).min(1).max(30).optional(),
  /** New shared code (min 4 chars), or null to remove the code requirement. */
  code: z.string().trim().min(4).max(100).nullable().optional(),
  /** Sign out every counter device now. */
  signOutAll: z.boolean().optional(),
});

const accessView = (a: Settings["volunteerAccess"]) => ({ enabled: a.enabled, counters: a.counters, codeRequired: !!a.codeHash, epoch: a.epoch });

export async function getVolunteerAccess(repo: Repo, actor: Actor | null) {
  assertRole(actor, "organizer");
  return accessView((await repo.getSettings()).volunteerAccess);
}

export async function updateVolunteerAccess(repo: Repo, actor: Actor | null, raw: unknown, now = () => new Date()) {
  assertRole(actor, "organizer");
  const parsed = volunteerAccessPatchSchema.safeParse(raw);
  if (!parsed.success) throw badRequest("Invalid counter settings (codes need at least 4 characters).");
  const p = parsed.data;
  const { hashCode } = await import("../volunteer-session");
  const result = await repo.transaction(async (tx) => {
    const s = await tx.getSettings();
    const before = s.volunteerAccess;
    const counters = p.counters ? [...new Set(p.counters)] : before.counters;
    const codeChanged = p.code !== undefined;
    const after = {
      enabled: p.enabled ?? before.enabled,
      counters,
      codeHash: codeChanged ? (p.code ? hashCode(p.code) : null) : before.codeHash,
      // Changing the code or asking to sign everyone out invalidates all counter sessions.
      epoch: p.signOutAll || (codeChanged && p.code) ? before.epoch + 1 : before.epoch,
    };
    tx.setSettings({ ...s, volunteerAccess: after });
    tx.addEvent({
      type: "settings_change",
      ...stamp(now()),
      actor: actorRef(actor),
      details: { volunteerAccess: { before: accessView(before), after: accessView(after), codeChanged, signedOutAll: after.epoch !== before.epoch } },
    });
    tx.bumpLive();
    return accessView(after);
  });
  const { clearAccessCache } = await import("../auth");
  clearAccessCache();
  return result;
}
