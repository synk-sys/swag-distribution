import { describe, expect, it } from "vitest";
import { barcodeIdForTicket, parseBarcode } from "@/lib/domain/barcode";
import { DEFAULT_SETTINGS } from "@/lib/domain/types";

const s = DEFAULT_SETTINGS.barcode;

describe("Bevy barcode parser", () => {
  it("1. parses the observed barcode 132774:3469041", () => {
    const r = parseBarcode("132774:3469041", s);
    expect(r).toEqual({ ok: true, prefix: "132774", id: "3469041", raw: "132774:3469041" });
  });

  it("2. derives the lookup id 3469041 from ticket GOOGA263469041", () => {
    expect(barcodeIdForTicket("GOOGA263469041", 7)).toBe("3469041");
    const r = parseBarcode("132774:3469041", s);
    expect(r.ok && r.id).toBe(barcodeIdForTicket("GOOGA263469041", 7));
  });

  it("tolerates surrounding whitespace from keyboard-wedge scanners", () => {
    expect(parseBarcode("  132774:3469041\n", s).ok).toBe(true);
  });

  it.each([
    ["", "empty"],
    ["3469041", "wrong_part_count"],
    ["132774:3469041:9", "wrong_part_count"],
    ["132774-3469041", "wrong_part_count"],
    ["132774:346904", "bad_identifier"],
    ["132774:34690411", "bad_identifier"],
    ["132774:34690A1", "bad_identifier"],
    ["ABC:3469041", "bad_prefix"],
    [":3469041", "bad_prefix"],
    ["132774: 3469041", "illegal_characters"],
    ["https://evil.example/?x=132774:3469041", "wrong_part_count"],
    ["1".repeat(100), "too_long"],
  ])("3. rejects malformed barcode %j (%s)", (code, reason) => {
    const r = parseBarcode(code, s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(reason);
  });

  it("enforces organizer-validated prefixes when configured", () => {
    const enforce = { ...s, prefixPolicy: "enforce" as const, allowedPrefixes: ["132774"] };
    expect(parseBarcode("132774:3469041", enforce).ok).toBe(true);
    const r = parseBarcode("999999:3469041", enforce);
    expect(r.ok === false && r.reason).toBe("prefix_not_allowed");
  });

  it("returns null lookup id when ticket does not end in digits", () => {
    expect(barcodeIdForTicket("GOOGA26346904X", 7)).toBeNull();
    expect(barcodeIdForTicket("1234567", 7)).toBeNull();
  });
});
