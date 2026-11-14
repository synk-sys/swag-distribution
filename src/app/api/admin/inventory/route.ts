import { readJson, route } from "@/lib/server/http";
import { changeInventory } from "@/lib/server/services/admin";

export const POST = route({ roles: ["organizer"], rate: { name: "admin-write", limit: 60 } }, async ({ req, actor, repo }) =>
  changeInventory(repo, actor, await readJson(req)),
);
