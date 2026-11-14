import { APP_MODE } from "@/lib/config";
import { route } from "@/lib/server/http";

export const GET = route({ roles: ["organizer", "volunteer"] }, async ({ actor }) => ({ actor, mode: APP_MODE }));
