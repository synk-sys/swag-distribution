import type { BarcodeSettings } from "./types";

/**
 * Bevy barcode parsing.
 *
 * Observed (NOT officially specified by Bevy):
 *   barcode  "132774:3469041"
 *   ticket   "GOOGA263469041"
 * The second component equals the final 7 digits of the ticket number.
 * The first component's meaning is unknown, so it is recorded and can be
 * enforced against an organizer-validated allow-list, but is never silently
 * assumed to be irrelevant.
 */

export type BarcodeParseResult =
  | { ok: true; prefix: string; id: string; raw: string }
  | { ok: false; reason: BarcodeRejectReason; raw: string };

export type BarcodeRejectReason =
  | "empty"
  | "too_long"
  | "illegal_characters"
  | "wrong_part_count"
  | "bad_prefix"
  | "bad_identifier"
  | "prefix_not_allowed";

const MAX_LEN = 64;

function safeRegex(pattern: string): RegExp {
  // Patterns are organizer-configured; anchor them so partial matches never pass.
  const anchored = (pattern.startsWith("^") ? "" : "^") + pattern + (pattern.endsWith("$") ? "" : "$");
  return new RegExp(anchored);
}

export function parseBarcode(input: string, settings: BarcodeSettings): BarcodeParseResult {
  const raw = typeof input === "string" ? input : "";
  const value = raw.trim();
  if (!value) return { ok: false, reason: "empty", raw };
  if (value.length > MAX_LEN) return { ok: false, reason: "too_long", raw };
  // Only printable ASCII, no whitespace inside the code.
  if (!/^[\x21-\x7E]+$/.test(value)) return { ok: false, reason: "illegal_characters", raw };

  const parts = value.split(settings.separator);
  if (parts.length !== 2) return { ok: false, reason: "wrong_part_count", raw };
  const [prefix, id] = parts;

  if (!safeRegex(settings.prefixPattern).test(prefix)) return { ok: false, reason: "bad_prefix", raw };
  if (!safeRegex(settings.idPattern).test(id) || id.length !== settings.suffixLength) {
    return { ok: false, reason: "bad_identifier", raw };
  }
  if (settings.prefixPolicy === "enforce" && !settings.allowedPrefixes.includes(prefix)) {
    return { ok: false, reason: "prefix_not_allowed", raw };
  }
  return { ok: true, prefix, id, raw };
}

/** The lookup-index key for a ticket number: its final N characters, if they are all digits. */
export function barcodeIdForTicket(ticketNumber: string, suffixLength: number): string | null {
  if (ticketNumber.length <= suffixLength) return null;
  const suffix = ticketNumber.slice(-suffixLength);
  return /^\d+$/.test(suffix) ? suffix : null;
}

export const REJECT_REASON_TEXT: Record<BarcodeRejectReason, string> = {
  empty: "No barcode value was read.",
  too_long: "Barcode value is too long.",
  illegal_characters: "Barcode contains unexpected characters.",
  wrong_part_count: "Barcode is not in the expected Bevy format (prefix:identifier).",
  bad_prefix: "Barcode prefix is malformed.",
  bad_identifier: "Barcode identifier is malformed.",
  prefix_not_allowed: "Barcode prefix is not one of the organizer-validated event prefixes.",
};
