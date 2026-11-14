import { z } from "zod";
import { badRequest } from "@/lib/server/errors";
import { readJson, route } from "@/lib/server/http";
import { lookupBarcode } from "@/lib/server/services/claims";

const schema = z.object({ code: z.string().max(200) });

export const POST = route({ roles: ["organizer", "volunteer"], rate: { name: "lookup", limit: 120 } }, async ({ req, actor, repo }) => {
  const p = schema.safeParse(await readJson(req));
  if (!p.success) throw badRequest("Missing barcode.");
  return lookupBarcode(repo, actor, p.data.code);
});
