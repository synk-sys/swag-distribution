import "server-only";
import { getApps, initializeApp, applicationDefault, cert, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

/**
 * Credentials:
 *  - Firebase App Hosting / Cloud Run: Application Default Credentials (no config needed).
 *  - Local: `gcloud auth application-default login` or GOOGLE_APPLICATION_CREDENTIALS,
 *    or FIREBASE_SERVICE_ACCOUNT_JSON (single-line JSON; keep it out of git).
 *  - Emulators: set FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST.
 */
function adminApp(): App {
  const existing = getApps()[0];
  if (existing) return existing;
  const projectId = process.env.FIREBASE_PROJECT_ID ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? process.env.GCLOUD_PROJECT;
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  return initializeApp({
    credential: sa ? cert(JSON.parse(sa)) : applicationDefault(),
    projectId,
  });
}

let db: Firestore | undefined;
export function getAdminDb(): Firestore {
  if (!db) {
    db = getFirestore(adminApp());
    db.settings({ ignoreUndefinedProperties: true });
  }
  return db;
}

export function getAdminAuth() {
  return getAuth(adminApp());
}
