import { describe, expect, it } from "vitest";
import { csvCell, parseBevyCsv } from "@/lib/domain/csv";
import { csv, row } from "./helpers/fixtures";

describe("Bevy CSV parsing", () => {
  it("accepts the real Bevy columns plus extra columns", () => {
    const r = parseBevyCsv(csv([row("GOOGA263469041", "Grace", "Hopper", "General Admission", "2026-11-14 14:00:00")]), { suffixLength: 7 });
    expect(r.ok).toBe(true);
    expect(r.validRecords[0]).toMatchObject({
      ticketNumber: "GOOGA263469041",
      firstName: "Grace",
      barcodeId: "3469041",
      checkinDateUtc: "2026-11-14 14:00:00",
      extra: { "Attendee Company": "Acme", "Ticket price": "0.00" },
    });
    expect(r.extraColumns).toEqual(["Attendee Company", "Ticket price"]);
  });

  it("handles BOM and header case/spacing differences", () => {
    const text = "﻿Order Number,Ticket  number,first name,Last Name,EMAIL,Ticket Title,Checkin date (utc)\nO1,GOOGA263469041,A,B,a@b.co,GA,\n";
    const r = parseBevyCsv(text, { suffixLength: 7 });
    expect(r.ok).toBe(true);
    expect(r.validRecords).toHaveLength(1);
    expect(r.validRecords[0].checkinDateUtc).toBeNull();
  });

  it("reports missing required columns", () => {
    const r = parseBevyCsv("Ticket number,First Name\nX,Y\n", { suffixLength: 7 });
    expect(r.ok).toBe(false);
    expect(r.missingColumns).toContain("Order number");
    expect(r.missingColumns).toContain("Checkin Date (UTC)");
  });

  it("detects duplicate ticket numbers and excludes them", () => {
    const r = parseBevyCsv(csv([row("GOOGA263469041"), row("GOOGA263469041", "Other"), row("GOOGA263469042")]), { suffixLength: 7 });
    expect(r.validRecords.map((v) => v.ticketNumber)).toEqual(["GOOGA263469042"]);
    expect(r.issues.filter((i) => i.code === "duplicate_ticket")).toHaveLength(2);
  });

  it("5. flags ambiguous barcode suffixes", () => {
    const r = parseBevyCsv(csv([row("GOOGA263469041"), row("OTHER263469041"), row("GOOGA263469042")]), { suffixLength: 7 });
    expect(r.ambiguousBarcodeIds).toEqual({ "3469041": ["GOOGA263469041", "OTHER263469041"] });
    expect(r.issues.filter((i) => i.code === "ambiguous_barcode")).toHaveLength(2);
  });

  it("flags invalid records", () => {
    const r = parseBevyCsv(csv([row(""), row("BAD TICKET!"), row("GOOGA26ABCDEFG")]), { suffixLength: 7 });
    expect(r.issues.map((i) => i.code)).toEqual(["missing_ticket", "invalid_ticket", "no_barcode_id"]);
    expect(r.validRecords).toHaveLength(1);
  });

  it("neutralises formula injection in exports", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("plain")).toBe("plain");
  });
});
