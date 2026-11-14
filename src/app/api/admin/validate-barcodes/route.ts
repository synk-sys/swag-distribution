import { z } from "zod";
import { badRequest } from "@/lib/server/errors";
import { readJson, route } from "@/lib/server/http";
import { validateBarcodes } from "@/lib/server/services/admin";

const schema = z.object({ codes: z.array(z.string().max(200)).min(1).max(50) });

export const POST = route({ roles: ["organizer"], rate: { name: "validate", limit: 60 } }, async ({ req, actor, repo }) => {
  const p = schema.safeParse(await readJson(req, 64 * 1024));
  if (!p.success) throw badRequest("Provide 1–50 barcodes.");
  return { results: await validateBarcodes(repo, actor, p.data.codes) };
});
