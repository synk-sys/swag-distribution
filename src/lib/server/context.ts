import "server-only";
import { IS_DEMO } from "@/lib/config";
import { seedDemo } from "./demo-seed";
import { MemoryRepo } from "./repo/memory";
import type { Repo } from "./repo/types";

type G = typeof globalThis & { __swagRepo?: Promise<Repo> };
const g = globalThis as G;

async function create(): Promise<Repo> {
  if (IS_DEMO) {
    const repo = new MemoryRepo();
    await seedDemo(repo);
    return repo;
  }
  const { getAdminDb } = await import("./firebase-admin");
  const { FirestoreRepo } = await import("./repo/firestore");
  return new FirestoreRepo(getAdminDb());
}

export function getRepo(): Promise<Repo> {
  if (!g.__swagRepo) g.__swagRepo = create().catch((e) => {
    g.__swagRepo = undefined;
    throw e;
  });
  return g.__swagRepo;
}

/** Demo only: wipe and reseed in-memory data. */
export async function resetDemo(): Promise<void> {
  if (!IS_DEMO) throw new Error("resetDemo is only available in demo mode");
  g.__swagRepo = undefined;
  await getRepo();
}
