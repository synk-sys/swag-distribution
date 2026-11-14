import { route } from "@/lib/server/http";
import { exportCsv } from "@/lib/server/services/admin";

export const GET = route({ roles: ["organizer"], rate: { name: "export", limit: 20 } }, async ({ req, actor, repo }) => {
  const kind = new URL(req.url).searchParams.get("kind") === "events" ? "events" : "attendees";
  const csv = await exportCsv(repo, actor, kind);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="swag-${kind}-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
});
