import { route } from "@/lib/server/http";

/** Change counter; clients refetch when it moves (demo polling fallback for Firestore onSnapshot). */
export const GET = route({ roles: ["organizer", "volunteer"], rate: { name: "live", limit: 120 } }, async ({ repo }) => ({
  version: await repo.getLiveVersion(),
}));
