# Blynk on Google Play: app, listing pack and owner steps

**STATUS (2026-10-24): everything that does not need the owner's Google account is ready. Nothing has been uploaded to Google Play.** A signed release AAB of the customer app builds on this PC, the site's Digital Asset Links file lists the app, and the listing text, answers and graphics are below. No Play Console account exists yet. The app has **not** been run on a phone or emulator (see section 12).

Goal (owner, 2026-10-24): customers can find Blynk by searching on Google Play.

## 1. What the Play app is

- A **Trusted Web Activity (TWA)**: a small Android app that opens the live shop, `https://blynk.lk/app/`, full screen in the phone's Chrome, with no browser bar. Prices, offers, store hours and everything else come from the same website and API as the PWA, so a website deploy updates the Play app too. A new AAB is only needed when the Android wrapper itself changes (icon, name, colours, Android target level).
- Source: `apps/customer-twa/` (Gradle project hand-written from Bubblewrap 1.27.0's template and `com.google.androidbrowserhelper:androidbrowserhelper:2.7.4`).
- **Package name: `lk.blynk.customer`.** This is the same ID the earlier Flutter customer app used, the one in `apps/customer-site/.well-known/assetlinks.json` and the Android app in the Firebase project `blynk-15cd4`. Once an app is created on Play, its package name can never change.
- Name on the launcher and in Play: **Blynk**. White status and navigation bars, white splash screen with the Blynk "B", portrait only, adaptive icon with an Android 13+ themed (monochrome) layer.
- **Target and compile SDK 36 (Android 16)**, required for new Play apps from 31 Aug 2026. Minimum Android 7.0 (API 24, the minimum of androidbrowserhelper 2.7.4).
- **Notification delegation is on**: the shop's web push notifications (Firebase web push) show as notifications of the Blynk app, with a white "B" small icon. The app declares `POST_NOTIFICATIONS` (Android 13+ asks the customer).
- **Location**: the delivery pin uses the website's location request. Chrome asks for location permission for blynk.lk; the Android app itself declares no location permission (no Bubblewrap location delegation).
- Links: `https://blynk.lk/app/...` and shared product links `https://blynk.lk/p/<id>` open in the app once the app is verified (section 4).
- If the phone has no browser that supports TWAs, the app falls back to a Chrome Custom Tab.

## 2. Signing and the built AAB

| Item | Value |
|---|---|
| Upload key | The existing Blynk release key (the same as Blynk Ops / Blynk Rider): `~/.blynk-release/blynk-release.jks`, alias `blynk`, read through `~/.blynk-release/keystore.properties` (or the file named by `BLYNK_KEYSTORE_PROPERTIES`). Not in the repo. |
| Certificate | `CN=Blynk, O=Valgrow Labs, C=LK` |
| Upload key SHA-256 | `B8:F1:06:4C:53:A8:EC:F3:68:16:D0:56:6F:B4:C9:F8:6B:90:1D:3A:37:19:99:28:77:01:65:54:11:1B:AD:1C` |
| First AAB | `apps/customer-twa/app/build/outputs/bundle/release/app-release.aab` (versionCode 1, versionName 1.0.0, about 1.5 MB). Git-ignored. Built 2026-10-24; `jarsigner -verify` says "jar verified". |

Keep a backup of `~/.blynk-release/` (the `.jks` and the properties file) somewhere safe and offline. With Play App Signing (section 9, step 4) a lost upload key can be reset through Play support, but it takes days.

The AAB is deliberately **not** put in `backend/api/app-files/`: that folder is committed and served by the API to staff.

### Building a new AAB

From Git Bash on this PC:

```bash
cd apps/customer-twa
export JAVA_HOME="C:/Program Files/Android/Android Studio/jbr"
export ANDROID_HOME="$LOCALAPPDATA/Android/Sdk"
export GRADLE_OPTS="-Dorg.gradle.daemon=false -Dsun.net.inetaddr.ttl=86400 -Dsun.net.inetaddr.negative.ttl=0 -Djava.net.preferIPv4Stack=true -Dorg.gradle.parallel=false -Dorg.gradle.workers.max=1"
BLYNK_VERSION_CODE=2 BLYNK_VERSION_NAME=1.0.1 ./gradlew --no-daemon bundleRelease
```

- Every Play upload needs a **higher `BLYNK_VERSION_CODE`** than every earlier upload (1 was used for the first AAB). Without the variable the build uses the number of commits on HEAD.
- Android SDK platform 36 must be installed (it is on this PC: `platforms/android-36`).
- Check the signature: `"$JAVA_HOME/bin/keytool" -printcert -jarfile app/build/outputs/bundle/release/app-release.aab` must show the SHA-256 above.
- Without `~/.blynk-release/keystore.properties` the AAB comes out unsigned and Play refuses it.

## 3. Things the website does for the app (already true)

- The shop's install helper (`#bi-bar` in `apps/customer-app/public/index.html`) hides itself when `display-mode: standalone` matches, which is the case inside the TWA, so customers who installed from Play are not told to "install" again. To be checked on a phone (section 12).
- The phones-only gate lets Android phones through. On Chromebooks and tablets it shows "Blynk is a phone app", so in Play Console limit the release to phones (section 9, step 11).

## 4. Digital Asset Links (the app and the site trust each other)

A TWA shows **without** a browser bar only when `https://blynk.lk/.well-known/assetlinks.json` lists the package `lk.blynk.customer` with the SHA-256 of the key that signed the installed copy. Otherwise it still works, but with a browser bar at the top, and links do not open the app.

Done in the repo: `apps/customer-site/.well-known/assetlinks.json` now lists `lk.blynk.customer` with two fingerprints, the old debug key that was already there (`8F:A2:...:7A`) and the release/upload key (`B8:F1:...:1C`). It goes live with the next landing-site deploy in Coolify. Check after the deploy:

```
https://blynk.lk/.well-known/assetlinks.json
https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://blynk.lk&relation=delegate_permission/common.handle_all_urls
```

**Add the Play app signing key later (required).** With Play App Signing, Google re-signs the app with its own key before it reaches customers, so phones that install from Play see Google's key, not the upload key. After the first upload:

1. Play Console > the Blynk app > **Test and release > Setup > App signing** (older menus: Release > Setup > App integrity > App signing).
2. Copy the **SHA-256 certificate fingerprint** under "App signing key certificate". (The page also offers a ready-made `assetlinks.json` snippet.)
3. Add it as a **third** string in the `sha256_cert_fingerprints` list of `apps/customer-site/.well-known/assetlinks.json`, keeping the other two. Keep the whole list on **one line**: the Dockerfile's `ANDROID_CERT_SHA256` replacement edits that line.
4. Commit, redeploy the landing site in Coolify, and open the two links above to check.
5. Uninstall and reinstall the app from Play: it must open without a browser bar.

**Leave the Coolify build argument `ANDROID_CERT_SHA256` empty.** When it is set, the Dockerfile replaces the whole fingerprint list with that one value, which would drop the other keys. (It is empty today: the live file matches the repo.)

## 5. Store listing text

Play Console > **Grow users > Store presence > Main store listing**.

**App name (30 max):** `Blynk` (or `Blynk: Grocery Delivery`, 22 characters, which helps people find it by search; the launcher still shows "Blynk").

**Short description (80 max), English (73 characters):**

> Groceries and essentials delivered in Dharga Town, Aluthgama and Bentota.

**Full description (4000 max), English (about 1,700 characters):**

> Blynk brings groceries and everyday essentials to your door in Dharga Town, Aluthgama and Bentota.
>
> Shop the aisles you use every week: rice, dairy, chicken, cooking essentials, food cupboard, beverages, juices and shakes, snacks, seeds and spices, baby products, health and hygiene, household items and school stationery.
>
> WHY BLYNK
> • Local and fresh: a local store that picks and packs your order.
> • Clear prices in rupees, with offers and items under LKR 300 easy to find.
> • Pay cash on delivery, or pay online by card when it is offered at checkout.
> • No packaging or platform fee.
> • Earn Blynk Points on every order: 1 point for every LKR 100.
> • Refunds go to your Blynk Wallet, ready for your next order.
>
> EASY ORDERING
> • Set your exact delivery spot on the map, so the rider finds your home or office.
> • Add a second phone number for family or a neighbour who can take the order.
> • Search any product, or browse by category.
> • Reorder your usual items in a few taps.
> • Track your order and get notified when it is packed, on the way and delivered.
>
> HOW IT WORKS
> 1. Sign in with your mobile number (we send a 6-digit code by SMS).
> 2. Set your delivery location.
> 3. Fill your cart and place the order.
> 4. Pay when it arrives.
>
> Opening hours, delivery areas and delivery fees are shown in the app and can change.
>
> Need help? Use Help in the app, or email help@blynk.lk.
>
> Blynk is for customers in and around Dharga Town, Aluthgama and Bentota, Sri Lanka.

Before publishing, check every line against the live shop: the card payment line (PayHere must be switched on), Bentota as an area (the SEO pages say "Dharga Town, Aluthgama and 4 km around"; the web manifest and the address screen include Bentota), reorder, tracking and notifications. Do not add opening hours, delivery times or prices that are not set in Admin/Ops.

**Sinhala and Tamil short descriptions** (add as translations: Store listing > **Manage translations** > Add Sinhala (si-LK) and Tamil (ta-IN, Play has no ta-LK)). Built from the phrasing already used on the site's Sinhala and Tamil pages (`apps/customer-site/pages/si/`, `pages/ta/`). **Have a native speaker read them before publishing**: these were not written by one, and they name only Dharga Town and Aluthgama, as those pages do.

- Sinhala (65 characters): `සිල්ලර බඩු දර්ගා නගරයේ සහ අළුත්ගම ඔබේ දොරකඩටම. ලැබුණු විට ගෙවන්න.`
  ("Groceries to your doorstep in Dharga Town and Aluthgama. Pay when you receive them.")
- Tamil (74 characters): `தர்கா நகர், அளுத்கம பகுதிகளுக்கு மளிகைப் பொருள் டெலிவரி. கிடைத்ததும் பணம்.`
  ("Grocery delivery to Dharga Town and Aluthgama areas. Pay on receipt.")

No Sinhala or Tamil full description is supplied: I could not write 1,700 characters in either language accurately enough to publish. Play shows the English full description for those languages until one is added.

## 6. App details and policy links

| Field | Value |
|---|---|
| App or game | App |
| Free or paid | Free (the app has no in-app purchases through Google Play; goods are paid cash on delivery or by card through PayHere, which Play allows for physical goods) |
| Category | **Shopping** |
| Tags | Grocery delivery, Shopping, Food delivery (pick up to 5 from Play's list) |
| Contact email | `help@blynk.lk` (the address in the privacy policy). Play shows it publicly. Owner: confirm or replace `<CONTACT_EMAIL>` |
| Phone (optional) | `<CONTACT_PHONE>` (optional; public) |
| Website | `https://blynk.lk` |
| Privacy policy | `https://blynk.lk/privacy.html` (live, HTTP 200, checked 2026-10-24) |
| Account deletion URL | `https://blynk.lk/delete-account` (live, HTTP 200, checked 2026-10-24) |
| Developer name shown on Play | Whatever the developer account is registered as. The upload key says `Valgrow Labs`; the privacy policy says "Blynk Quick Commerce". Make the Play developer name, the privacy policy and the business documents agree. |

## 7. Graphics

All in `docs/06-deployment/play-store-assets/`:

| File | Use | Notes |
|---|---|---|
| `icon-512.png` | App icon (512 x 512, 32-bit PNG) | The Blynk "B" on white, from `apps/customer-app/assets/icon.png`; matches the launcher icon. Play rounds the corners itself. |
| `feature-graphic-1024x500.png` | Feature graphic (1024 x 500, no alpha) | Blynk yellow (#FFE141), logo, "Groceries delivered to your door", the real home screen in a phone. No people, no religious imagery. |
| `screenshots/01-home.png` ... `08-cart.png` | Phone screenshots (1080 x 1920, 9:16), in this order | Real live pages of https://blynk.lk/app/ taken 2026-10-24 with Playwright: home, points and offers, categories, an aisle (Cooking Essentials), a product, search ("sugar"), the delivery pin map, and a cart with three items. |

Screenshot notes: taken signed out (no personal data). The install helper bar and the location permission sheet were dismissed. The temporary "Stock-taking - Adding More Products" announcement was hidden from the shots. The delivery pin shot still shows the app's "Move the pin to change location" tip. When the catalogue is bigger or the doctors section is on, retake them; the script is short (Playwright, 360 x 640 viewport at device scale 3, Android Chrome user agent).

Play also accepts 7-inch and 10-inch tablet screenshots; not needed if the release is limited to phones.

## 8. App content answers (Play Console > Policy and programs > App content)

### 8.1 Privacy policy

`https://blynk.lk/privacy.html`.

Gap to fix before review: the policy does not mention the **doctor appointments** data (patient name, patient phone, notes for the doctor). Add it to section 1 (data we collect) and section 4 (shared with the clinic or doctor) before turning that section on, or before submitting if it is on.

### 8.2 App access (reviewers need to sign in)

Sign-in is by SMS code only, so give Google a review number with a fixed code. The API supports this (`REVIEW_LOGIN_PHONE` / `REVIEW_LOGIN_OTP`, see `backend/api/src/config/env.ts`): that one number gets the fixed code and no SMS is sent.

1. In Coolify, on the API service, set `REVIEW_LOGIN_PHONE` (format `+94700000001`) and `REVIEW_LOGIN_OTP` (6 digits), then redeploy the API. Use a number that is not a real customer's.
2. Sign in once yourself in the shop with that number and code, so the account exists with a name and a saved delivery address inside the delivery area.
3. Play Console > App content > **App access** > "All or some functionality is restricted" > **Add instructions**:
   - Name: `Blynk review account`
   - Username / phone: `<REVIEW_PHONE>` (the number without +94 if the shop asks for the 9 digits after +94, e.g. `700000001`)
   - Password / code: `<REVIEW_CODE>`
   - Other information (paste and fill in):

     > Blynk signs in by phone number and a 6-digit SMS code. For review, use the number and fixed code above: no SMS is sent to this number.
     > 1. Open the app. On the Login screen, tap the mobile number field and enter <REVIEW_PHONE> (the +94 prefix is already shown).
     > 2. Tap Continue.
     > 3. Enter the code <REVIEW_CODE>.
     > 4. You are signed in. The account has a saved delivery address, so you can browse, add items to the cart and open checkout.
     > Browsing products works without signing in ("Skip for now"). Orders are delivered only in Dharga Town, Aluthgama and Bentota, Sri Lanka, and are paid on delivery, so please do not complete a real order, or cancel it from Orders right away.
4. Keep the review number working for as long as the app is on Play (Google re-reviews updates). Changing the code means updating this form.

### 8.3 Ads

"Does your app contain ads?" **No.** Blynk's own offers and banners are not ads in Play's sense (no third-party ad network shows ads in the app). Remarketing tags (Google Ads, Meta) measure visitors for ads shown elsewhere; that is declared in Data safety (8.6), not here.

### 8.4 Content rating (IARC questionnaire)

- Category: **"All other app types"** (not a game). Email: the contact email.
- Violence, fear, sexuality, language, controlled substances: **No** to all. Note: the catalogue sells everyday groceries. If it ever lists alcohol or tobacco, answer the "controlled substances / sale of alcohol or tobacco" questions **Yes**.
- "Does the app let users interact or exchange content?" **No** user-to-user chat or sharing. Product ratings are public text tied to products; if the questionnaire asks about user-generated content that other users can see, answer **Yes** for ratings/reviews and say they are moderated by Blynk staff.
- "Does the app share the user's current location with other users?" **No** (the rider sees the delivery address for that order only).
- "Does the app allow purchases of digital goods?" **No** (physical goods only).
- Expected result: Everyone / PEGI 3 / rated for all ages, possibly with an "Users interact" note.

### 8.5 Target audience and content

- Target age groups: **18 and over** (the privacy policy says the platform is not for under-18s without a parent). Do not tick any under-13 group: that would bring in the Families policy.
- "Could the app unintentionally appeal to children?" **No.**

### 8.6 Data safety

Base: what the shop and API actually collect (2026-10-24 code), and the privacy policy. Answer the first page:

- Does your app collect or share any of the required user data types? **Yes**
- Is all of the user data collected by your app encrypted in transit? **Yes** (HTTPS only)
- Which of the following methods of account creation does your app support? **Username and other authentication** (phone number + SMS code). Account deletion: in the app (**Profile / Account > Delete account**) and on the web at **`https://blynk.lk/delete-account`** (put this URL in the "Delete account URL" field).
- Do you provide a way for users to request that some or all of their data is deleted, without requiring them to delete their account? **Yes** (email help@blynk.lk, privacy policy section 8) or No, as the owner prefers.

Data types. "Collected" = sent off the phone to Blynk. "Shared" = sent to a third party that is not just processing it for Blynk. Riders, PayHere, SMS, hosting and Firebase messaging work on Blynk's behalf, which Play counts as **service providers, not sharing**. Google Analytics / Google Ads / Meta through Google Tag Manager are declared as **shared** for analytics and advertising, because the remarketing tags use the data for Google's and Meta's ads. (Tracking only runs when the `GTM_ID` build argument is set in Coolify; on 2026-10-24 the live shop had no GTM container. Declare it now anyway if it will be switched on; Play requires the form to be correct whenever the app is live.)

| Play data type | Collected | Shared (with Google / Meta) | Required or optional | Purposes (collected) | Notes |
|---|---|---|---|---|---|
| Personal info > **Name** | Yes | No | Required | App functionality, Account management | Account name, receiver name on addresses |
| Personal info > **Email address** | Yes | No | Optional | Account management, Developer communications | Optional profile field |
| Personal info > **Phone number** | Yes | No | Required | App functionality, Account management, Fraud prevention and security | Sign-in number, optional second number for an order |
| Personal info > **Address** | Yes | No | Required (to order) | App functionality | Delivery address, landmarks, notes |
| Personal info > **Other info** | Yes | No | Optional | App functionality, Personalization | Date of birth (birthday gift), family members' birthdays if entered |
| Financial info > **Purchase history** | Yes | **Yes** (Analytics, Advertising or marketing) | Required | App functionality, Analytics | Orders; purchase/add-to-cart events go to GA4, Google Ads and Meta |
| Financial info > **Other financial info** | Yes | No | Required | App functionality | Blynk Points and Blynk Wallet balance, payment method and transaction reference. Card numbers are entered on PayHere's page and never reach Blynk: do **not** tick "Credit or debit card number" |
| Location > **Precise location** | Yes | No | Optional (the pin can be set by hand) | App functionality | Delivery map pin and the phone's GPS when the customer taps to use it |
| Location > **Approximate location** | Yes | No | Optional | App functionality, Analytics | Area chosen for delivery; analytics tools derive a coarse location from the IP |
| Health and fitness > **Health info** | Yes, **only if the doctors section is on** | No | Optional | App functionality | Doctor appointment notes and patient details (shared with the chosen clinic to provide the booking, which Play counts as part of the service). The section showed "not available right now" on 2026-10-24 |
| App activity > **App interactions** | Yes | **Yes** (Analytics, Advertising or marketing) | Required | Analytics | Page views, add to cart, checkout events via Google Tag Manager |
| App activity > **In-app search history** | Yes | **Yes** (Analytics, Advertising or marketing) | Optional | App functionality, Analytics | Search terms (the GA4 `search` event) |
| App activity > **Other user-generated content** | Yes | No | Optional | App functionality | Product ratings and reviews, feedback, product requests ("Ask us") |
| Messages > **Other in-app messages** | No | No | | | No customer-to-customer messaging (support is by phone/WhatsApp outside the app) |
| Device or other IDs | Yes | **Yes** (Analytics, Advertising or marketing) | Required | App functionality, Analytics | Firebase push token (for order notifications); cookie IDs used by GA4, Google Ads and Meta |
| App info and performance (crash logs, diagnostics) | No | No | | | The shop sends no crash reports |
| Photos, videos, audio, files, contacts, calendar, web browsing | No | No | | | |

If the owner decides not to switch on Google Tag Manager, change every "Shared: Yes" above to **No** and remove "Analytics" where it only comes from those tags.

### 8.7 Health apps declaration (doctor appointments)

Play Console > App content > **Health apps**. Blynk has a doctors / dental appointment section (channelling: pick a clinic and doctor, book a time, add patient name, phone and notes). It is not a medical device and gives no diagnosis or treatment advice.

- Tick only what applies, most likely **"Healthcare services and management" > appointment booking / scheduling** (wording in the form varies). Do **not** tick medical device, diagnosis, clinical decision support, disease management, medication or "health research".
- If asked whether the app handles health data: **Yes**, appointment notes and patient details, sent only to the clinic and shown to the customer; matches Data safety "Health info".
- If the doctors section is switched off when submitting, the honest answer is still that the app **can** offer appointment booking (Play reviews the app as shipped, and the section can be switched on from Admin without an app update). Declare it.
- Update the privacy policy first (8.1).

### 8.8 Other declarations

- **Financial features**: "My app doesn't provide any financial features." Blynk Wallet is store credit for refunds and Blynk Points are loyalty points, neither is a bank, loan or payment service. If mobile reloads or bill payments (mentioned in the privacy policy) go live in the app, revisit this form.
- **Government app**: No. **News app**: No.
- **COVID-19 contact tracing / status**: No.
- **Data deletion / account deletion**: `https://blynk.lk/delete-account` (see 8.6).

## 9. Owner steps, in order

**A. Developer account (one-time).**

1. Go to `https://play.google.com/console/signup` with the Google account that will own Blynk on Play long term (a business account, not a staff member's personal one).
2. Choose the account type:
   - **Organisation (recommended).** Needs a **D-U-N-S number** for the business (free from Dun & Bradstreet; it can take one to a few weeks to issue in Sri Lanka), the registered business name and address, a business website (blynk.lk) and a business email/phone. Organisation accounts **skip the closed-testing rule** in step C, can publish straight to production after review, and show the business name on Play.
   - **Personal.** Faster to open, but accounts created after 13 Nov 2023 must run a **closed test with at least 12 testers who stay opted in for 14 days in a row** before production access is granted (step C), and the developer's legal name and country are shown on Play.
3. Pay the one-time **USD 25** registration fee by card.
4. Complete **identity verification** (government ID; for organisations, the D-U-N-S details and a business document). Verify the contact email and phone. This can take a few days.
5. Answer the developer questions (apps you plan to publish, etc.).

**B. Create the app and upload the first AAB.**

1. Play Console > **Create app**: App name `Blynk`, default language **English (United Kingdom) en-GB** or English (United States), **App**, **Free**, tick the declarations, **Create app**.
2. **Test and release > Testing > Internal testing** > **Create new release**.
3. When asked about app signing, keep **"Use Google-generated key"** (Play App Signing). Do not upload the release key itself.
4. Upload `apps/customer-twa/app/build/outputs/bundle/release/app-release.aab`. Play reads the package name `lk.blynk.customer` from it, and it is fixed from now on. Release name: `1.0.0 (1)`. Release notes: `First release of Blynk on Google Play.`
5. **Testers**: create an email list with your own and staff Gmail addresses > **Save** > **Review release** > **Start rollout to Internal testing**.
6. Do section 4 "Add the Play app signing key" now (Setup > App signing > SHA-256 > assetlinks.json > deploy the site).
7. Open the internal test link on an Android phone, install, and check: opens without a browser bar, sign-in, location pin, cart, notifications (section 12 list).

**C. (Personal accounts only) Closed testing for 14 days.**

1. **Testing > Closed testing** > Create track (e.g. "Alpha") > upload the same AAB or a new one with a higher version code.
2. Add **at least 12 testers** (an email list or a Google Group) who accept the invite from the opt-in link and install the app. They must stay opted in for **14 continuous days**; keep a few extra in case someone leaves.
3. After 14 days, **Dashboard > Apply for production** and answer the questions about the test. Google replies in about a week.

**D. Fill in everything Play asks for** (Dashboard shows the list; all answers are in this document):

1. **Main store listing**: name, short and full description, icon, feature graphic, phone screenshots (sections 5 and 7). Translations for Sinhala and Tamil (short descriptions).
2. **Store settings**: category Shopping, tags, contact email, website.
3. **App content**: privacy policy, app access (8.2), ads (8.3), content rating (8.4), target audience (8.5), data safety (8.6), health apps (8.7), financial features, government app, account deletion URL.

**E. Production.**

1. **Test and release > Production > Countries/regions**: add **Sri Lanka** only (Blynk only delivers there).
2. **Device catalog** (Test and release > Reach and devices): exclude tablets, Chromebooks, TVs and cars, or under Advanced settings > **Form factors** keep only Phone. The shop is phones-only.
3. **Create new release** > add the same AAB from the library (or a new one with a higher version code) > release notes > **Review release** > **Start rollout to Production**. A staged rollout (e.g. 20%) is optional for a first release.
4. Google's review takes from a few hours to about 7 days for a new app. Answer any email from Google quickly.
5. When it is live, search "Blynk" on Play on a phone in Sri Lanka. New apps can take a few days to show up in search; the direct link is `https://play.google.com/store/apps/details?id=lk.blynk.customer`.

**F. After launch.**

- Add a "Get it on Google Play" link on blynk.lk (and update the site's text that says no Play Store is needed).
- Google Maps keys: if an Android Maps key is ever restricted by app, it needs the Play app signing SHA-1 (not needed today: the shop uses the web map).
- New wrapper versions: build with a higher `BLYNK_VERSION_CODE`, upload to Internal testing, then promote to Production.

## 10. Files in this change

- `apps/customer-twa/` (new): `build.gradle`, `settings.gradle`, `gradle.properties`, `gradlew`, `gradlew.bat`, `gradle/wrapper/*` (copied from `apps/operations/android`), `.gitignore`, `app/build.gradle`, `app/src/main/AndroidManifest.xml`, `app/src/main/java/lk/blynk/customer/{Application,LauncherActivity,DelegationService}.java`, `app/src/main/res/` (icons, splash, notification icon, strings, file paths).
- `apps/customer-site/.well-known/assetlinks.json`: release key fingerprint added to `lk.blynk.customer`.
- `docs/06-deployment/play-store-listing.md` (this file) and `docs/06-deployment/play-store-assets/`.

## 11. Why a TWA and not a native build

The customer shop is the Expo app exported for the web and served at `/app/` (`apps/customer-site/Dockerfile`). A TWA ships exactly that shop, with one code base and no second release process, and is accepted by Google Play when the app passes Digital Asset Links verification and offers real app functionality. The older Flutter app (`apps/customer/`) is retired; its package name is reused here so the old App Links entry keeps working.

## 12. Not verified yet

- **Not run on a phone or emulator.** Before the production release, on a real Android phone from the internal test: the app opens without a browser bar (after section 4 including the Play key); the install helper bar does not appear; sign-in with the SMS code; "use my location" for the delivery pin asks for location and works; add to cart and checkout; an order notification arrives and shows the Blynk "B" icon; a `https://blynk.lk/p/<id>` link from WhatsApp opens the app on that product; back button and app switching behave.
- The Sinhala and Tamil short descriptions need a native speaker's check.
- Play policy facts (target API 36 from 31 Aug 2026, closed testing for new personal accounts, the USD 25 fee) were checked on 2026-10-24; Google changes these, so re-read the Play Console's own prompts.
