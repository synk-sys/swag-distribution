import { readJson, route } from "@/lib/server/http";
import { getVolunteerAccess, updateVolunteerAccess } from "@/lib/server/services/admin";

export const GET = route({ roles: ["organizer"] }, async ({ actor, repo }) => getVolunteerAccess(repo, actor));
export const POST = route({ roles: ["organizer"], rate: { name: "admin-write", limit: 30 } }, async ({ req, actor, repo }) =>
  updateVolunteerAccess(repo, actor, await readJson(req)),
);
