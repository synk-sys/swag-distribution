import { readJson, route } from "@/lib/server/http";
import { setEligibilityOverride } from "@/lib/server/services/admin";

export const POST = route({ roles: ["organizer"], rate: { name: "admin-write", limit: 60 } }, async ({ req, actor, repo }) =>
  setEligibilityOverride(repo, actor, await readJson(req)),
);
