import { readJson, route } from "@/lib/server/http";
import { claimSwag } from "@/lib/server/services/claims";

export const POST = route({ roles: ["organizer", "volunteer"], rate: { name: "claim", limit: 60 } }, async ({ req, actor, repo }) =>
  claimSwag(repo, actor, await readJson(req)),
);
