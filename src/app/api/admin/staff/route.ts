import { readJson, route } from "@/lib/server/http";
import { addStaff, listStaff, removeStaff } from "@/lib/server/services/staff";

export const GET = route({ roles: ["organizer"] }, async ({ actor, repo }) => ({ staff: await listStaff(repo, actor) }));
export const POST = route({ roles: ["organizer"], rate: { name: "admin-write", limit: 30 } }, async ({ req, actor, repo }) =>
  addStaff(repo, actor, await readJson(req)),
);
export const DELETE = route({ roles: ["organizer"], rate: { name: "admin-write", limit: 30 } }, async ({ req, actor, repo }) =>
  removeStaff(repo, actor, new URL(req.url).searchParams.get("uid") ?? ""),
);
