import { route } from "@/lib/server/http";
import { auditLog } from "@/lib/server/services/admin";

export const GET = route({ roles: ["organizer"] }, async ({ req, actor, repo }) => ({
  events: await auditLog(repo, actor, Number(new URL(req.url).searchParams.get("limit") ?? 500)),
}));
