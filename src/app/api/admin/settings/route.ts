import { readJson, route } from "@/lib/server/http";
import { updateSettings } from "@/lib/server/services/admin";

const redact = <T extends { volunteerAccess: { codeHash: string | null } }>(s: T) => ({
  ...s,
  volunteerAccess: { ...s.volunteerAccess, codeHash: s.volunteerAccess.codeHash ? "set" : null },
});

export const GET = route({ roles: ["organizer"] }, async ({ repo }) => ({
  settings: redact(await repo.getSettings()),
  inventory: await repo.getInventory(),
}));

export const PUT = route({ roles: ["organizer"], rate: { name: "admin-write", limit: 60 } }, async ({ req, actor, repo }) => ({
  settings: redact(await updateSettings(repo, actor, await readJson(req))),
}));
