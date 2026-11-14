import { route } from "@/lib/server/http";
import { dashboard } from "@/lib/server/services/admin";

export const GET = route({ roles: ["organizer"], rate: { name: "dashboard", limit: 120 } }, async ({ actor, repo }) => dashboard(repo, actor));
