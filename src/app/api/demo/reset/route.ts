import { IS_DEMO } from "@/lib/config";
import { badRequest } from "@/lib/server/errors";
import { route } from "@/lib/server/http";
import { resetDemo } from "@/lib/server/context";

export const POST = route({ roles: ["organizer"] }, async () => {
  if (!IS_DEMO) throw badRequest("Only available in demo mode.");
  await resetDemo();
  return { ok: true };
});
