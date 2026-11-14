"use client";
import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { firebaseClientConfig } from "@/lib/config";

let app: FirebaseApp | undefined;

export function firebaseApp(): FirebaseApp {
  if (!app) {
    if (!firebaseClientConfig.apiKey || !firebaseClientConfig.projectId) {
      throw new Error("Firebase client config missing. Set NEXT_PUBLIC_FIREBASE_* variables (see .env.example).");
    }
    app = getApps()[0] ?? initializeApp(firebaseClientConfig);
  }
  return app;
}

export const clientAuth = (): Auth => getAuth(firebaseApp());
export const clientDb = (): Firestore => getFirestore(firebaseApp());
