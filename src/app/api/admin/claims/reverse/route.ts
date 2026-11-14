import { readJson, route } from "@/lib/server/http";
import { reverseClaim } from "@/lib/server/services/claims";

export const POST = route({ roles: ["organizer"], rate: { name: "admin-write", limit: 60 } }, async ({ req, actor, repo }) =>
  reverseClaim(repo, actor, await readJson(req)),
);
