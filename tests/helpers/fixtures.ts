import { toCsv } from "@/lib/domain/csv";
import type { Actor } from "@/lib/domain/types";
import { MemoryRepo } from "@/lib/server/repo/memory";
import { changeInventory, importCsv, updateSettings } from "@/lib/server/services/admin";

export const organizer: Actor = { uid: "org-1", name: "Org One", role: "organizer" };
export const volA: Actor = { uid: "vol-a", name: "Volunteer A", role: "volunteer" };
export const volB: Actor = { uid: "vol-b", name: "Volunteer B", role: "volunteer" };

export const HEADERS = ["Order number", "Ticket number", "First Name", "Last Name", "Email", "Ticket title", "Checkin Date (UTC)", "Attendee Company", "Ticket price"];

export function row(ticket: string, first = "Ada", last = "Lovelace", title = "General Admission", checkin = "") {
  return [`ORD-${ticket.slice(-5)}`, ticket, first, last, `${first}.${last}@example.com`.toLowerCase(), title, checkin, "Acme", "0.00"];
}

export function csv(rows: string[][]) {
  return toCsv(HEADERS, rows);
}

/** A repo with the real observed ticket plus a few others, barcode format validated. */
export async function setupRepo(opts: { inventory?: number; rows?: string[][]; prefixes?: string[] } = {}) {
  const repo = new MemoryRepo();
  await updateSettings(repo, organizer, {
    barcode: {
      separator: ":",
      prefixPattern: "^\\d{1,12}$",
      idPattern: "^\\d{7}$",
      suffixLength: 7,
      prefixPolicy: opts.prefixes ? "enforce" : "ignore",
      allowedPrefixes: opts.prefixes ?? [],
      validated: true,
    },
  });
  const rows = opts.rows ?? [
    row("GOOGA263469041", "Grace", "Hopper"),
    row("GOOGA263469042", "Alan", "Turing"),
    row("GOOGA263469043", "Katherine", "Johnson", "Student"),
  ];
  await importCsv(repo, organizer, csv(rows), { dryRun: false });
  await changeInventory(repo, organizer, { kind: "set_initial", value: opts.inventory ?? 300 });
  return repo;
}

let n = 0;
export const key = () => `test-key-${Date.now()}-${++n}`;
