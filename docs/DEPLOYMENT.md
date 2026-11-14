# Firebase setup and deployment

## 1. Create the Firebase project

1. In the [Firebase console](https://console.firebase.google.com), create a project, for example `devfest-toronto-swag`. App Hosting requires the **Blaze** plan.
2. **Firestore** → Create database → *Production mode* → region `northamerica-northeast2` (Toronto) or `nam5`.
3. **Authentication** → Get started → enable **Email/Password** and **Google**. Under Settings → Authorized domains, add your App Hosting domain once you have it.
4. **Project settings → Your apps → Web app** → register it, then copy `apiKey`, `authDomain`, `projectId` and `appId`.

## 2. Deploy rules and indexes

```bash
npx firebase login
npx firebase use --add            # select your project
npx firebase deploy --only firestore:rules,firestore:indexes
```

`firestore.indexes.json` contains the `events(type, atMs desc)` composite index. It also turns on a TTL policy on `idempotency.expireAt`, so old retry keys delete themselves after 24 h.

## 3. Create the first organizer

```bash
gcloud auth application-default login
FIREBASE_PROJECT_ID=your-project npx tsx scripts/set-role.ts organizer you@example.com "Your Name"
```

Then sign in on the app, either with Google or with **Set or reset password**. You can add other staff later from **/admin/staff**.

## 4. Deploy with App Hosting

1. Push this repository to GitHub.
2. In the console, go to **App Hosting** → Create backend → connect the repo and set the root directory to `/`. Pick the same region as Firestore.
3. Edit `apphosting.yaml` and replace every `REPLACE_ME` with your web app config. These values are public identifiers, not secrets. Commit the change.
4. App Hosting builds on every push to the live branch. The App Hosting service account already has Firestore and Auth access through Application Default Credentials, so you don't need a service-account key.
5. Add the App Hosting domain (`*.hosted.app`, or your custom domain) to Auth → Authorized domains.

Command-line alternative: `npx firebase apphosting:backends:create`, then `npx firebase deploy --only apphosting`.

## 5. Verify the deployment

- `https://<your-domain>/api/health` returns `{"ok":true}`.
- Sign in as the organizer, open `/admin` and check that the yellow DEMO banner is **not** shown.
- Sign in with a Google account that has no role. It must show "No access".
- Run the whole [event-day checklist](EVENT_DAY_CHECKLIST.md) rehearsal on the production URL. Afterwards, reverse the test claims with reason "rehearsal" and bag returned = yes.

## Local development against Firebase

```bash
cp .env.example .env.local         # set NEXT_PUBLIC_APP_MODE=production and the Firebase values
gcloud auth application-default login
npm run dev
```

## Emulator tests

The Firestore emulator needs **Java 21+**.

```bash
npm run test:emulator
```

## Keep demo and production separate

Demo mode (`NEXT_PUBLIC_APP_MODE` unset or `demo`) stores data only in server memory and never initializes Firebase. Production mode never loads demo data, and the demo session and reset endpoints return 404 or 400 there.
