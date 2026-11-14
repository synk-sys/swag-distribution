import { readJson, route } from "@/lib/server/http";
import { updateSettings } from "@/lib/server/services/admin";

export const GET = route({ roles: ["organizer"] }, async ({ repo }) => ({
  settings: await repo.getSettings(),
  inventory: await repo.getInventory(),
}));

export const PUT = route({ roles: ["organizer"], rate: { name: "admin-write", limit: 60 } }, async ({ req, actor, repo }) => ({
  settings: await updateSettings(repo, actor, await readJson(req)),
}));
