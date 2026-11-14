/**
 * App mode. "demo" runs fully in memory with fictional attendees and never
 * touches Firebase. "production" requires Firebase Auth + Firestore.
 */
export type AppMode = "demo" | "production";

export const APP_MODE: AppMode = process.env.NEXT_PUBLIC_APP_MODE === "production" ? "production" : "demo";
export const IS_DEMO = APP_MODE === "demo";

export const firebaseClientConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const EVENT_NAME = "DevFest Toronto 2026";
export const SWAG_NAME = "Standard DevFest Toronto Swag Bag";
