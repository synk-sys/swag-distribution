import { z } from "zod";
import { badRequest } from "@/lib/server/errors";
import { readJson, route } from "@/lib/server/http";
import { lookupTicket } from "@/lib/server/services/claims";

const schema = z.object({ ticketNumber: z.string().min(1).max(64) });

export const POST = route({ roles: ["organizer", "volunteer"], rate: { name: "lookup", limit: 120 } }, async ({ req, actor, repo }) => {
  const p = schema.safeParse(await readJson(req));
  if (!p.success) throw badRequest("Missing ticket number.");
  return lookupTicket(repo, actor, p.data.ticketNumber);
});
