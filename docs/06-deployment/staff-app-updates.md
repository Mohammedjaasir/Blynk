# Staff app updates (Blynk Ops and Blynk Rider)

Owner decision, 2026-10-12: the staff Android apps update themselves from inside the app, and
Admin and Operations can force an update.

## How it works

| Piece | Where | What it does |
|---|---|---|
| APK | `apps/customer-site/files/{ops,rider}.apk`, served at `https://blynk.lk/download/<app>.apk` | The app itself (release-signed). |
| Version manifest | `apps/customer-site/files/{ops,rider}.json`, served at `https://blynk.lk/download/<app>.json` (`Cache-Control: no-cache`, readable from other origins) | `{"app","version_code","version_name","sha256","size","released_at"}`. Written by `apps/customer-site/scripts/write-apk-manifest.mjs`. |
| Update policy | `GET /api/v1/app-updates/policy?app=ops\|rider` (public). Set in Admin > Settings > App updates, or Ops > More > App updates (`GET\|PATCH /admin/settings/app-updates`, audited `APP_UPDATES_UPDATED`) | Per app: `min_version_code`, `mode` (`optional` / `required`) and short `notes`. Default `0`, `optional`, `''`. Stored in `system_configurations` key `app_updates`; no migration. |
| In-app check | `apps/{operations,rider}/src/lib/app-update.ts` | On start and when the app comes back to the front (at most every 3 hours), reads the manifest and the policy and compares them with the installed `versionCode`. |
| Native installer | `apps/{operations,rider}/android/.../AppUpdatePlugin.java` | Downloads only `https://blynk.lk/download/<its own name>.apk` (the URL is fixed in the app), stops at the manifest size, checks the SHA-256 and the signing key, then opens Android's install screen. |

What staff see:

- **Optional** (or Required but already at or above the minimum): an "Update available — vX" card with
  the notes, **Update** and **Later** (Later hides that version for a day). More (Ops) and My day (Rider)
  show the installed version and a **Check for updates** button.
- **Required**, and the installed `versionCode` is below `min_version_code`: a full-screen "Update
  required" with only **Update**. It also covers the login screen. The last answer is remembered, so it
  still blocks offline. If the published APK is not newer than the installed one, nothing blocks (staff
  are never locked out by a minimum nobody can reach), so **publish the APK before raising the minimum**.
- **Update**: the first time on Android 8+, the app explains and opens "Install unknown apps" for itself.
  Then it downloads with a progress bar and opens Android's install screen; the user taps **Install**.
  Data and sign-in are kept. A bad download says "The download was corrupted. Try again."

Android only installs an update signed with the same key as the installed app. Phones that still have a
debug-signed build (or one signed with another key) must uninstall it once and install the release APK
from `https://blynk.lk/download/<app>.apk` by hand; after that, in-app updates work.

## Version codes

Every release must have a higher `versionCode` than the last one (the first shipped code was `2`).
`apps/{operations,rider}/android/app/build.gradle` takes:

- `versionCode`: `BLYNK_VERSION_CODE` if set, else the number of commits on `HEAD`
  (`git rev-list --count HEAD`), else `2`.
- `versionName`: `BLYNK_VERSION_NAME` if set, else `1.2`.

For a release, set both explicitly so the number you write into the manifest is exactly the one built
into the APK. Use a number higher than the current `version_code` in `apps/customer-site/files/<app>.json`
(for example today's commit count, or the last one + 1).

## Release steps (per app)

The release key is read from `~/.blynk-release/keystore.properties` by Gradle. Never commit, copy or
print it.

1. Build the web app and sync it into Android (from `apps/operations` or `apps/rider`):
   `npm run build` (production API address), then `npx cap sync android`.
2. Build the signed release APK (from `apps/<app>/android`), Git Bash:

   ```sh
   BLYNK_VERSION_CODE=150 BLYNK_VERSION_NAME=1.2 ./gradlew assembleRelease
   ```

   Output: `app/build/outputs/apk/release/app-release.apk`. Check it is signed with the release key:
   `apksigner verify --print-certs app/build/outputs/apk/release/app-release.apk`.
3. Copy it over the published APK (repo root):
   `cp apps/operations/android/app/build/outputs/apk/release/app-release.apk apps/customer-site/files/ops.apk`
   (Rider: `apps/rider/...` to `apps/customer-site/files/rider.apk`).
4. Write the manifest with the **same** version code and name (repo root, offline):

   ```sh
   node apps/customer-site/scripts/write-apk-manifest.mjs --app ops \
     --apk apps/customer-site/files/ops.apk --version-code 150 --version-name 1.2
   ```

   This writes `apps/customer-site/files/ops.json` with the APK's SHA-256 and size. Re-run it whenever
   the APK file changes: an APK that does not match its manifest is refused by the app as corrupted.
5. Commit the APK and its JSON together, push, and redeploy the landing site (Coolify). If a volume is
   mounted at `/usr/share/nginx/html/download`, it wins over the built-in files for both the `.apk`
   and the `.json`: copy **both** files there, never just one.
6. Check: `https://blynk.lk/download/ops.json` shows the new `version_code`, and an older install shows
   "Update available" (open the app, or More / My day > Check for updates).
7. Only if this update must be forced: Admin > Settings > App updates (or Ops > More > App updates), set
   the app's minimum version code to the new `version_code`, mode **Required**, optional notes, Save.

Tests: `node --test apps/customer-site/tests/write-apk-manifest.test.mjs` (manifest writer);
`backend/api/tests/app-updates.test.ts` (policy endpoints); `app-update-*.test.ts(x)` in
`apps/operations` and `apps/rider`; `apps/admin/src/test/app-updates.test.tsx`.
