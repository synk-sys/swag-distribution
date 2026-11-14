import { MAX_CSV_BYTES } from "@/lib/domain/csv";
import { readText, route } from "@/lib/server/http";
import { importCsv } from "@/lib/server/services/admin";

export const POST = route({ roles: ["organizer"], rate: { name: "import", limit: 20 } }, async ({ req, actor, repo }) => {
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  const text = await readText(req, MAX_CSV_BYTES);
  return importCsv(repo, actor, text, { dryRun });
});
