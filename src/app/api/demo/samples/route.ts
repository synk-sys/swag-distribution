import { IS_DEMO } from "@/lib/config";
import { evaluateEligibility } from "@/lib/domain/eligibility";
import { badRequest } from "@/lib/server/errors";
import { route } from "@/lib/server/http";
import { DEMO_ACTORS, DEMO_PREFIX, demoBarcodeFor } from "@/lib/server/demo-seed";

/** Fictional demo attendees with simulated Bevy-format barcodes. Demo mode only. */
export const GET = route({ roles: ["organizer", "volunteer"] }, async ({ repo }) => {
  if (!IS_DEMO) throw badRequest("Only available in demo mode.");
  const [regs, settings] = await Promise.all([repo.listRegistrations(), repo.getSettings()]);
  const samples = regs
    .map((r) => ({
      name: `${r.firstName} ${r.lastName}`,
      ticketNumber: r.ticketNumber,
      ticketTitle: r.ticketTitle,
      barcode: demoBarcodeFor(r.ticketNumber),
      claimed: r.swag?.status === "claimed",
      eligible: evaluateEligibility(r, settings.eligibility).eligible,
    }))
    .sort((a, b) => a.ticketNumber.localeCompare(b.ticketNumber));
  const extras = [
    { label: "Malformed barcode", barcode: "not-a-bevy-code" },
    { label: "Unknown registration", barcode: `${DEMO_PREFIX}:7777777` },
    { label: "Wrong event prefix", barcode: `132774:${samples[0]?.ticketNumber.slice(-7) ?? "1000001"}` },
  ];
  return { samples, extras, counters: Object.values(DEMO_ACTORS).filter((a) => a.counter).map((a) => ({ uid: a.uid, counter: a.counter, name: a.name })) };
});
