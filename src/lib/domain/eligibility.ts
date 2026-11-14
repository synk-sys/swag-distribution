import type { EligibilitySettings, Registration } from "./types";

export interface EligibilityDecision {
  eligible: boolean;
  reason: string;
}

/**
 * Eligibility is explicit and configurable. An empty Bevy check-in date does NOT
 * make someone ineligible unless an organizer turns on `requireCheckin`.
 */
export function evaluateEligibility(reg: Registration, rules: EligibilitySettings): EligibilityDecision {
  if (reg.eligibilityOverride) {
    return {
      eligible: reg.eligibilityOverride.value === "eligible",
      reason: `Organizer override: ${reg.eligibilityOverride.reason}`,
    };
  }
  if (rules.excludeRemovedRegistrations && !reg.inLatestImport) {
    return { eligible: false, reason: "Registration is no longer in the latest Bevy export." };
  }
  if (rules.mode === "allowlist") {
    const allowed = rules.allowedTicketTitles.map((t) => t.trim().toLowerCase());
    if (!allowed.includes(reg.ticketTitle.trim().toLowerCase())) {
      return { eligible: false, reason: `Ticket type "${reg.ticketTitle}" is not eligible for swag.` };
    }
  }
  if (rules.requireCheckin && !reg.checkinDateUtc) {
    return { eligible: false, reason: "Attendee has not checked in at registration." };
  }
  return { eligible: true, reason: "Eligible" };
}
