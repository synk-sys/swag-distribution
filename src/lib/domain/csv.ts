import Papa from "papaparse";
import { barcodeIdForTicket } from "./barcode";
import type { RegistrationCsvFields } from "./types";

export const MAX_CSV_BYTES = 5 * 1024 * 1024;
export const MAX_CSV_ROWS = 20000;
const MAX_EXTRA_COLUMNS = 60;
const MAX_CELL = 500;

/** Bevy export columns we rely on, mapped to our field names. */
export const REQUIRED_COLUMNS = {
  orderNumber: "Order number",
  ticketNumber: "Ticket number",
  firstName: "First Name",
  lastName: "Last Name",
  email: "Email",
  ticketTitle: "Ticket title",
  checkinDateUtc: "Checkin Date (UTC)",
} as const;

type FieldKey = keyof typeof REQUIRED_COLUMNS;

export const TICKET_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;

export type RowIssueCode =
  | "missing_ticket"
  | "invalid_ticket"
  | "duplicate_ticket"
  | "missing_name"
  | "invalid_email"
  | "no_barcode_id"
  | "ambiguous_barcode";

export interface RowIssue {
  row: number; // 1-based data row number (header excluded); spreadsheet row = row + 1
  ticketNumber: string;
  code: RowIssueCode;
  severity: "error" | "warning";
  message: string;
}

export interface CsvParseReport {
  ok: boolean;
  fatal?: string;
  headers: string[];
  missingColumns: string[];
  extraColumns: string[];
  totalRows: number;
  validRecords: RegistrationCsvFields[];
  issues: RowIssue[];
  errorCount: number;
  warningCount: number;
  ambiguousBarcodeIds: Record<string, string[]>;
  ticketTitles: Record<string, number>;
}

const norm = (h: string) => h.replace(/^﻿/, "").trim().replace(/\s+/g, " ").toLowerCase();

function clean(v: unknown): string {
  if (v === undefined || v === null) return "";
  return String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, MAX_CELL);
}

const SAFE_KEY = /^[A-Za-z0-9 _()\-./#]{1,80}$/;

export function parseBevyCsv(text: string, opts: { suffixLength: number }): CsvParseReport {
  const empty: CsvParseReport = {
    ok: false,
    headers: [],
    missingColumns: [],
    extraColumns: [],
    totalRows: 0,
    validRecords: [],
    issues: [],
    errorCount: 0,
    warningCount: 0,
    ambiguousBarcodeIds: {},
    ticketTitles: {},
  };
  if (typeof text !== "string" || !text.trim()) return { ...empty, fatal: "The file is empty." };
  if (new TextEncoder().encode(text).length > MAX_CSV_BYTES) {
    return { ...empty, fatal: "The file is larger than 5 MB." };
  }

  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.replace(/^﻿/, "").trim(),
  });
  const headers = (parsed.meta.fields ?? []).filter(Boolean);
  if (headers.length === 0) return { ...empty, fatal: "No header row found." };

  const headerByNorm = new Map(headers.map((h) => [norm(h), h]));
  const colFor = {} as Record<FieldKey, string>;
  const missingColumns: string[] = [];
  for (const [key, label] of Object.entries(REQUIRED_COLUMNS) as [FieldKey, string][]) {
    const actual = headerByNorm.get(norm(label));
    if (actual) colFor[key] = actual;
    else missingColumns.push(label);
  }
  const requiredActual = new Set(Object.values(colFor));
  const extraColumns = headers.filter((h) => !requiredActual.has(h));

  if (missingColumns.length) {
    return { ...empty, headers, extraColumns, missingColumns, fatal: `Missing required columns: ${missingColumns.join(", ")}` };
  }
  const rows = parsed.data;
  if (rows.length > MAX_CSV_ROWS) return { ...empty, headers, fatal: `Too many rows (max ${MAX_CSV_ROWS}).` };

  const issues: RowIssue[] = [];
  const candidates: { row: number; rec: RegistrationCsvFields }[] = [];
  const ticketRows = new Map<string, number[]>();
  const keptExtra = extraColumns.filter((h) => SAFE_KEY.test(h) && h !== "__proto__").slice(0, MAX_EXTRA_COLUMNS);

  rows.forEach((r, i) => {
    const row = i + 1;
    const ticket = clean(r[colFor.ticketNumber]).toUpperCase();
    if (!ticket) {
      issues.push({ row, ticketNumber: "", code: "missing_ticket", severity: "error", message: "Row has no ticket number." });
      return;
    }
    if (!TICKET_PATTERN.test(ticket)) {
      issues.push({ row, ticketNumber: ticket, code: "invalid_ticket", severity: "error", message: "Ticket number contains unexpected characters." });
      return;
    }
    const extra: Record<string, string> = {};
    for (const h of keptExtra) {
      const v = clean(r[h]);
      if (v) extra[h] = v;
    }
    const checkin = clean(r[colFor.checkinDateUtc]);
    const rec: RegistrationCsvFields = {
      ticketNumber: ticket,
      orderNumber: clean(r[colFor.orderNumber]),
      firstName: clean(r[colFor.firstName]),
      lastName: clean(r[colFor.lastName]),
      email: clean(r[colFor.email]).toLowerCase(),
      ticketTitle: clean(r[colFor.ticketTitle]),
      checkinDateUtc: checkin || null,
      barcodeId: barcodeIdForTicket(ticket, opts.suffixLength),
      extra,
    };
    ticketRows.set(ticket, [...(ticketRows.get(ticket) ?? []), row]);
    candidates.push({ row, rec });
  });

  const duplicates = new Set([...ticketRows].filter(([, rs]) => rs.length > 1).map(([t]) => t));
  const valid: RegistrationCsvFields[] = [];
  for (const { row, rec } of candidates) {
    if (duplicates.has(rec.ticketNumber)) {
      issues.push({
        row,
        ticketNumber: rec.ticketNumber,
        code: "duplicate_ticket",
        severity: "error",
        message: `Ticket number appears on rows ${ticketRows.get(rec.ticketNumber)!.join(", ")}. Not imported.`,
      });
      continue;
    }
    if (!rec.firstName && !rec.lastName) {
      issues.push({ row, ticketNumber: rec.ticketNumber, code: "missing_name", severity: "warning", message: "Attendee has no name." });
    }
    if (rec.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rec.email)) {
      issues.push({ row, ticketNumber: rec.ticketNumber, code: "invalid_email", severity: "warning", message: "Email looks invalid." });
    }
    if (!rec.barcodeId) {
      issues.push({
        row,
        ticketNumber: rec.ticketNumber,
        code: "no_barcode_id",
        severity: "warning",
        message: `Ticket does not end in ${opts.suffixLength} digits; barcode scanning will not work (manual lookup only).`,
      });
    }
    valid.push(rec);
  }

  const ambiguousBarcodeIds = findAmbiguous(valid);
  const rowOf = new Map(candidates.map((c) => [c.rec.ticketNumber, c.row]));
  for (const [id, tickets] of Object.entries(ambiguousBarcodeIds)) {
    for (const t of tickets) {
      issues.push({
        row: rowOf.get(t) ?? 0,
        ticketNumber: t,
        code: "ambiguous_barcode",
        severity: "warning",
        message: `Barcode identifier ${id} is shared by ${tickets.join(", ")}. Scans will be rejected; use manual lookup.`,
      });
    }
  }

  const ticketTitles: Record<string, number> = {};
  for (const r of valid) ticketTitles[r.ticketTitle || "(blank)"] = (ticketTitles[r.ticketTitle || "(blank)"] ?? 0) + 1;

  issues.sort((a, b) => a.row - b.row);
  return {
    ok: true,
    headers,
    missingColumns,
    extraColumns,
    totalRows: rows.length,
    validRecords: valid,
    issues,
    errorCount: issues.filter((i) => i.severity === "error").length,
    warningCount: issues.filter((i) => i.severity === "warning").length,
    ambiguousBarcodeIds,
    ticketTitles,
  };
}

export function findAmbiguous(records: { ticketNumber: string; barcodeId: string | null }[]): Record<string, string[]> {
  const byId = new Map<string, string[]>();
  for (const r of records) {
    if (!r.barcodeId) continue;
    byId.set(r.barcodeId, [...(byId.get(r.barcodeId) ?? []), r.ticketNumber]);
  }
  return Object.fromEntries([...byId].filter(([, ts]) => ts.length > 1));
}

/** Escape a value for CSV export, neutralising spreadsheet formula injection. */
export function csvCell(v: unknown): string {
  let s = v === undefined || v === null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\r\n") + "\r\n";
}
