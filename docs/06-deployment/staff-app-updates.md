# Staff app updates (Blynk Ops and Blynk Rider)

Owner decisions, 2026-10-12: the staff Android apps update themselves from inside the app, and
Admin and Operations can force an update. The APKs are **not public**: only signed-in staff can
download them, and Admin or Operations can switch on a temporary share link to put the app on a new
phone.

## How it works

| Piece | Where | What it does |
|---|---|---|
| APK | `backend/api/app-files/{ops,rider}.apk`, copied into the API image (`/app/app-files`, `APP_FILES_DIR`) | The app itself (release-signed). |
| Version manifest | `backend/api/app-files/{ops,rider}.json` | `{"app","version_code","version_name","sha256","size","released_at"}`. Written by `apps/customer-site/scripts/write-apk-manifest.mjs`. |
| Manifest endpoint | `GET /api/v1/app-updates/manifest?app=ops\|rider` | Signed in. `ops`: ADMIN, OPERATIONS. `rider`: RIDER, ADMIN, OPERATIONS. Unknown app 404, wrong role 403. `Cache-Control: no-store`. |
| Download endpoint | `GET\|HEAD /api/v1/app-updates/download?app=ops\|rider` | Same sign-in and roles. Streams the APK (`application/vnd.android.package-archive`, `Content-Length`, `Content-Disposition: attachment`, `Cache-Control: no-store`). Each app has one fixed file; nothing from the request becomes part of a path. |
| Share link | Admin > Settings > App updates, or Ops > More > App updates (`GET\|PATCH /admin/settings/app-share-links`, audited `APP_SHARE_LINK_UPDATED`) | Per app: **Turn on share link** for 1-72 hours (default 24) makes a fresh random link `https://blynk-api.valgrowlabs.com/api/v1/app-updates/share/<token>/<app>.apk` that anyone can open until it expires. **Turn off** ends it at once; turning it on again replaces the old link. A wrong, old or expired link is a plain 404. Rate-limited to 30 tries per IP per 15 minutes. Stored in `system_configurations` key `app_share_links`; no migration. The audit log records on/off, hours and expiry, never the token. |
| Update policy | `GET /api/v1/app-updates/policy?app=ops\|rider` (public). Set in Admin > Settings > App updates, or Ops > More > App updates (`GET\|PATCH /admin/settings/app-updates`, audited `APP_UPDATES_UPDATED`) | Per app: `min_version_code`, `mode` (`optional` / `required`) and short `notes`. Default `0`, `optional`, `''`. Stored in `system_configurations` key `app_updates`; no migration. |
| In-app check | `apps/{operations,rider}/src/lib/app-update.ts` | **Only while signed in.** On sign-in, on start and when the app comes back to the front (at most every 3 hours), reads the manifest (through the app's own API client, so the token is attached and renewed) and the policy and compares them with the installed `versionCode`. Signed out (the login screen) it checks nothing and shows nothing. |
| Native installer | `apps/{operations,rider}/android/.../AppUpdatePlugin.java` | Downloads only `https://blynk-api.valgrowlabs.com/api/v1/app-updates/download?app=<its own name>` (fixed in the app). JavaScript renews the access token right before the call and passes it in; the plugin uses it only as that one request's `Authorization` header (never logged or stored) and does not follow redirects. Stops at the manifest size, checks the SHA-256, the package name and the signing key, then opens Android's install screen. |

The API host is written into the native plugin on purpose (`API_HOST` in `AppUpdatePlugin.java`), so
an app can never be pointed at another server for its own updates. It must stay the same host as the
release `VITE_API_BASE_URL` (`https://blynk-api.valgrowlabs.com/api/v1`). If the API ever moves,
change `API_HOST` in both apps and ship new APKs **before** the old address goes away.

The landing site no longer serves APKs: `https://blynk.lk/download/...` is a 404.

What staff see:

- **Optional** (or Required but already at or above the minimum): an "Update available — vX" card with
  the notes, **Update** and **Later** (Later hides that version for a day). More (Ops) and My day (Rider)
  show the installed version and a **Check for updates** button.
- **Required**, and the installed `versionCode` is below `min_version_code`: once signed in, a
  full-screen "Update required" with only **Update**. The login screen is never blocked. The last
  answer is remembered, so it still blocks offline. If the published APK is not newer than the
  installed one, nothing blocks (staff are never locked out by a minimum nobody can reach), so
  **publish the APK before raising the minimum**.
- **Update**: the first time on Android 8+, the app explains and opens "Install unknown apps" for itself.
  Then it downloads with a progress bar and opens Android's install screen; the user taps **Install**.
  Data and sign-in are kept. A bad download says "The download was corrupted. Try again."; a session
  that cannot be renewed says "Please sign in again."; an account without access to that app says
  "Your account can't download this app."

Android only installs an update signed with the same key as the installed app. Phones that still have a
debug-signed build (or one signed with another key) must uninstall it once and install the release APK
by hand from a share link; after that, in-app updates work.

## Phones still on 1.2 (build 148)

Build 148 (the first release with in-app updates) looks for updates at `https://blynk.lk/download/<app>.json`
and downloads from `https://blynk.lk/download/<app>.apk`. Both are now closed, so on those phones:

- The update check finds no manifest: no "Update available" card ever appears, and More / My day >
  **Check for updates** says "You have the latest version." The app keeps working normally.
- **Do not set Required with a minimum above 148** until every phone runs the new build: a 148 phone
  below the minimum shows "Update required … Connect to the internet to get the update" and cannot
  update itself, so it stays blocked until the new APK is installed by hand.

To move each phone onto the new build (once, by hand):

1. Release the new build as below (a `versionCode` above 148, signed with the same release key).
2. Admin > Settings > App updates (or Ops > More > App updates): **Turn on share link** for that app
   (for example 24 hours) and **Copy link**.
3. Send the link to the staff member (or open it on the phone). Android downloads the APK; open it and
   tap **Update**/**Install**. Because it is signed with the same key, it installs over 148 and keeps
   the data and sign-in.
4. **Turn off** the share link when everyone is done (it also ends by itself at the expiry).

From then on, updates arrive inside the app for signed-in staff.

## Version codes

Every release must have a higher `versionCode` than the last one (the first shipped code was `2`).
`apps/{operations,rider}/android/app/build.gradle` takes:

- `versionCode`: `BLYNK_VERSION_CODE` if set, else the number of commits on `HEAD`
  (`git rev-list --count HEAD`), else `2`.
- `versionName`: `BLYNK_VERSION_NAME` if set, else `1.2`.

For a release, set both explicitly so the number you write into the manifest is exactly the one built
into the APK. Use a number higher than the current `version_code` in `backend/api/app-files/<app>.json`
(for example today's commit count, or the last one + 1).

## Release steps (per app)

The release key is read from `~/.blynk-release/keystore.properties` by Gradle. Never commit, copy or
print it.

1. Build the web app and sync it into Android (from `apps/operations` or `apps/rider`):
   `npm run build` (production API address, `VITE_API_BASE_URL=https://blynk-api.valgrowlabs.com/api/v1`),
   then `npx cap sync android`.
2. Build the signed release APK (from `apps/<app>/android`), Git Bash:

   ```sh
   BLYNK_VERSION_CODE=150 BLYNK_VERSION_NAME=1.2 ./gradlew assembleRelease
   ```

   Output: `app/build/outputs/apk/release/app-release.apk`. Check it is signed with the release key:
   `apksigner verify --print-certs app/build/outputs/apk/release/app-release.apk`.
3. Copy it over the published APK (repo root):
   `cp apps/operations/android/app/build/outputs/apk/release/app-release.apk backend/api/app-files/ops.apk`
   (Rider: `apps/rider/...` to `backend/api/app-files/rider.apk`).
4. Write the manifest with the **same** version code and name (repo root, offline):

   ```sh
   node apps/customer-site/scripts/write-apk-manifest.mjs --app ops \
     --apk backend/api/app-files/ops.apk --version-code 150 --version-name 1.2
   ```

   This writes `backend/api/app-files/ops.json` (the default output) with the APK's SHA-256 and size.
   Re-run it whenever the APK file changes: an APK that does not match its manifest is refused by the
   app as corrupted.
5. Commit the APK and its JSON together, push, and **redeploy the API** (Coolify, the backend
   service). The files are baked into the API image; the landing site does not need a redeploy for an
   app release.
6. Check: in Admin > Settings > App updates, "Latest published" shows the new version code (it reads
   the signed-in manifest endpoint), and an older signed-in install shows "Update available" (open the
   app, or More / My day > Check for updates).
7. Only if this update must be forced: same screen, set the app's minimum version code to the new
   `version_code`, mode **Required**, optional notes, Save. (Not above 148 while phones on build 148
   remain - see above.)
8. New phone, or a phone that cannot update itself: switch on that app's **share link**, send it, and
   turn it off afterwards.

Tests: `node --test apps/customer-site/tests/write-apk-manifest.test.mjs` (manifest writer, and the
committed manifests match their APKs); `backend/api/tests/app-updates.test.ts` (policy endpoints),
`backend/api/tests/app-downloads.test.ts` (manifest/download sign-in and roles, share links),
`backend/api/tests/nginx-headers.test.ts` (`/download/` closed on the landing site);
`app-update-*.test.ts(x)` in `apps/operations` and `apps/rider`; `apps/admin/src/test/app-updates.test.tsx`.
