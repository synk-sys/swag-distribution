import { route } from "@/lib/server/http";
import { searchAttendees } from "@/lib/server/services/claims";

export const GET = route({ roles: ["organizer", "volunteer"], rate: { name: "search", limit: 60 } }, async ({ req, actor, repo }) => {
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 100);
  return { results: await searchAttendees(repo, actor, q) };
});
