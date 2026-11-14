import { toCsv } from "@/lib/domain/csv";
import type { Actor } from "@/lib/domain/types";
import { MemoryRepo } from "./repo/memory";
import { changeInventory, importCsv, updateSettings } from "./services/admin";
import { claimSwag } from "./services/claims";

/** Fictional demo identities. Demo mode only; never valid in production. */
export const DEMO_ACTORS: Record<string, Actor & { counter?: string; label: string }> = {
  "demo-organizer": { uid: "demo-organizer", name: "Olivia Organizer (demo)", role: "organizer", label: "Organizer" },
  "demo-vol-a": { uid: "demo-vol-a", name: "Victor Volunteer (demo)", role: "volunteer", counter: "Counter A", label: "Volunteer · Counter A" },
  "demo-vol-b": { uid: "demo-vol-b", name: "Vera Volunteer (demo)", role: "volunteer", counter: "Counter B", label: "Volunteer · Counter B" },
};

export const DEMO_PREFIX = "900001";

const PEOPLE: [string, string, string][] = [
  ["Avery", "Maplewood", "General Admission"],
  ["Jordan", "Lakeshore", "General Admission"],
  ["Riley", "Bloorfield", "Student"],
  ["Casey", "Spadina", "General Admission"],
  ["Morgan", "Queensway", "Speaker"],
  ["Taylor", "Dundasson", "General Admission"],
  ["Quinn", "Harbourview", "Student"],
  ["Rowan", "Kensington", "General Admission"],
  ["Skyler", "Yorkdale", "General Admission"],
  ["Emerson", "Danforth", "Volunteer"],
  ["Parker", "Leslieville", "General Admission"],
  ["Hayden", "Junction", "Student"],
  ["Reese", "Cabbagetown", "General Admission"],
  ["Sage", "Riverdale", "General Admission"],
  ["Dakota", "Parkdale", "Sponsor Booth Staff"],
  ["Finley", "Annex", "Sponsor Booth Staff"],
  ["Logan", "Etobrook", "General Admission"],
  ["Peyton", "Scarbridge", "General Admission"],
];

/** Builds a Bevy-shaped CSV of 20 fictional attendees (2 share a barcode suffix on purpose). */
export function demoCsv(): string {
  const rows: string[][] = PEOPLE.map(([f, l, title], i) => {
    const id = String(1000001 + i * 37);
    return [`DEMO-ORD-${100 + i}`, `DEVTO26${id}`, f, l, `${f.toLowerCase()}.${l.toLowerCase()}@example.com`, title, i % 3 === 0 ? "2026-11-14 13:05:00" : "", "Toronto"];
  });
  // Ambiguous pair: two different tickets ending in the same 7 digits.
  rows.push(["DEMO-ORD-200", "DEVTO265550001", "Alex", "Ambiguous-One", "alex.one@example.com", "General Admission", "", "Toronto"]);
  rows.push(["DEMO-ORD-201", "DEVXX265550001", "Alex", "Ambiguous-Two", "alex.two@example.com", "General Admission", "", "Toronto"]);
  return toCsv(["Order number", "Ticket number", "First Name", "Last Name", "Email", "Ticket title", "Checkin Date (UTC)", "City"], rows);
}

export function demoBarcodeFor(ticketNumber: string) {
  return `${DEMO_PREFIX}:${ticketNumber.slice(-7)}`;
}

export async function seedDemo(repo: MemoryRepo) {
  const org = DEMO_ACTORS["demo-organizer"];
  await updateSettings(repo, org, {
    barcode: {
      separator: ":",
      prefixPattern: "^\\d{1,12}$",
      idPattern: "^\\d{7}$",
      suffixLength: 7,
      prefixPolicy: "enforce",
      allowedPrefixes: [DEMO_PREFIX],
      validated: true,
    },
    eligibility: {
      mode: "allowlist",
      allowedTicketTitles: ["General Admission", "Student", "Speaker", "Volunteer"],
      requireCheckin: false,
      excludeRemovedRegistrations: true,
    },
    verification: { requireNameCheck: false },
  });
  await importCsv(repo, org, demoCsv(), { dryRun: false });
  await changeInventory(repo, org, { kind: "set_initial", value: 15, reason: "Demo starting stock" });
  // One attendee already collected, for the "already claimed" demonstration.
  await claimSwag(repo, DEMO_ACTORS["demo-vol-b"], {
    ticketNumber: "DEVTO26" + String(1000001 + 3 * 37),
    idempotencyKey: "demo-seed-claim-0001",
    counter: "Counter B",
    method: "scan",
  });
  for (const [uid, a] of Object.entries(DEMO_ACTORS)) {
    await repo.upsertStaff({ uid, email: `${uid}@example.com`, displayName: a.name, role: a.role, addedBy: "seed", addedAt: new Date().toISOString() });
  }
}
