# Blynk Live Location & Delivery Tracking — Investigation & Design Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task, ONLY once the user has said to proceed. Steps use checkbox (`- [ ]`) syntax for tracking. §0–§17 below are the investigation and design (read first — every task cites back to it). §D is the approved-decisions record. §N is the task-level implementation plan.

**Status: §0–§17 and §D are FINAL (decisions approved 2026-09-19). §N (task list) is written and ready for review — do not execute any task until the user says to proceed.**

**Amendment (2026-09-19, same day, map provider only):** the Customer app's map provider changed from `google_maps_flutter` to **MapLibre + a self-hosted OpenStreetMap-derived tile source** (see the "Map Provider" section immediately below, and §8, §D.4, §N Task M0/M4/M5/M6 as revised). No other part of this plan changed — rider GPS tracking, the backend location API/SSE, the order lifecycle, delivery assignment, and tracking authorization are unaffected and were not re-opened.

**Goal:** real rider GPS location, captured only during an active delivery, shown to the customer who owns that order on a live map — with no fake movement, no fake ETA, no invented infrastructure, and no scope beyond what the investigation shows is actually needed.

**Method:** Graphify was refreshed against the current repository (502 changed files since the last graph; code AST-extracted in full, docs/plans/reports semantically re-extracted, low-value image assets deliberately skipped — see §0), then five parallel deep-reads of the actual source (not documentation) covered the Rider app, the Customer Flutter app, the backend orders/riders/deliveries modules, the full DB schema, and the order lifecycle end to end. External research covered background-geolocation reliability, Capacitor, and map-provider pricing. Every claim below cites the file and line it came from.

**Customer Order Experience plan remains parked**, as instructed — not touched, not resumed.

---

## Map Provider (binding — read this before writing any Customer-app map code)

**Google Maps is not used anywhere in this plan.** The Customer app's live delivery map and its "use current location" address picker are built on **MapLibre** (`maplibre_gl`, the actively maintained `flutter-maplibre-gl` package — vendor-neutral, BSD-licensed, no account, no key) rendering **OpenStreetMap-derived vector tiles**. The tiles themselves come from a **self-hosted `.pmtiles` file**, built once from an OSM regional extract and served as a static asset by Blynk's own existing backend — not from the public `tile.openstreetmap.org` server (its usage policy explicitly discourages unattributed production/commercial traffic and permits withdrawing access without notice), and not from a third-party SaaS tile provider's free tier (every one investigated — MapTiler Cloud, Stadia Maps — restricts free-tier usage to non-commercial projects only; a paid plan starting near $25–30/month with metered overage would be needed for commercial use of either). No Google Cloud project, no Google API key, and no recurring third-party tile-service bill are required for the initial launch. Full comparison, exact terms, and the documented fallback (OpenFreeMap, a free hosted OSM vector-tile service with no usage limit and no key, reachable by changing one configuration value) are in the rewritten §8 below. The map rendering sits behind a small internal `MapProvider`/`TrackingMapView` abstraction (§8, §N Task M4) so a future provider change never touches rider GPS tracking, the backend location-write API, SSE, order lifecycle, delivery assignment, or tracking authorization.

---

## 0. Graphify refresh

The graph was 15 days stale (771 nodes, last built before the Rider app existed). Refreshed via `graphify . --update`: 336 changed code files AST-extracted (free, structural), 50 docs + 1 paper semantically re-extracted (3 subagents), 115 low-value image assets (product icons, splash screens, favicons — confirmed by sampling, not architecturally relevant) explicitly skipped this run to avoid 115 one-per-image extraction agents for icon files — a deliberate, disclosed deviation from the default pipeline, not a silent shortcut. Result: **3,447 nodes, 6,176 edges, 216 communities**, health-checked clean (no dangling/missing/collapsed edges). `apps/rider` is now indexed for the first time.

---

## 1. Rider tracking architecture — audit and feasibility

### 1.1 What exists today (verified in source, not docs)

`apps/rider` — React 18.3 + Vite 5 + react-router-dom 6, hand-rolled `fetch` client, no state library (`package.json:13-29`).

| Question | Finding |
|---|---|
| Geolocation code | **None.** Grepped all of `src/` for `geolocation\|getCurrentPosition\|watchPosition\|Capacitor\|GPS\|latitude\|longitude\|coords` — zero hits in app code. The only coordinate literals anywhere are in a test fixture. |
| Existing regression test | `src/test/delivery.test.tsx:53-71`, titled *"never renders coordinates, costs or supplier details even if the API sent them"* — **currently passing**, asserts rider-facing UI must never show a coordinate. Any tracking UI work must deliberately revise this test, not accidentally break it. |
| PWA / service worker | `public/manifest.webmanifest` exists (`display: "standalone"`, one icon) and is linked from `index.html:10` — enough for a browser's native install heuristic. **No service worker file exists anywhere** (grepped `serviceWorker\|workbox\|vite-plugin-pwa` — zero hits); `src/main.tsx` never calls `navigator.serviceWorker.register`. No `vite-plugin-pwa` dependency. "Installable" is real but minimal: no offline cache, no background sync, no push infrastructure. |
| App lifecycle handling | `src/lib/useRevalidate.ts` (23 lines) — `setInterval` **30s** default, paused unless `document.visibilityState === 'visible'`, plus a `window.addEventListener('online', ...)` reconnect trigger. No `navigator.wakeLock` anywhere. This is the only lifecycle-aware primitive in the app and the natural extension point for a tracking loop. |
| Capacitor scaffolding | **None at all.** No `capacitor.config.ts`, no `android/`/`ios/` directories at any depth. Would be a from-scratch addition. |
| Auth | JWT access token (15 min expiry) + opaque, hashed-at-rest, single-use-rotated refresh token (30 days), both in `localStorage`, attached via `Authorization: Bearer` header only (`src/api/client.ts:17-18, 35-66, 126-132`). |

### 1.2 External finding: browser geolocation is not reliable for background tracking

Confirmed by current documentation and browser vendor behavior: the Web Geolocation API (`watchPosition`) **stops reporting as soon as the tab/PWA leaves the foreground**, and frequently stops when the device screen locks, regardless of any service worker — geolocation is not a service-worker-accessible API for continuous background use. `setInterval`/timers in a backgrounded tab are also throttled/frozen by Chrome, Safari and Firefox. This is a platform limitation, not an implementation gap — no amount of JavaScript in the current PWA architecture can make `watchPosition` survive a locked screen or a backgrounded tab.

By contrast, mature Capacitor background-geolocation plugins (Capawesome, capacitor-community, Cap-go — all actively maintained in 2026) provide a correctly-configured Android foreground service (Android 14+-compliant, persistent notification) and continue reporting position with the screen off or the app backgrounded, with an on-device queue for offline resilience.

### 1.3 Tradeoffs (as requested — presented, not silently chosen)

| Option | What it takes | Reliability | Cost |
|---|---|---|---|
| **A. PWA / browser geolocation, foreground only** | Add `navigator.geolocation.watchPosition` to the existing React app; no new build pipeline. | Works only while the rider has the app open, visible, and the screen on. Stops the instant the rider locks the phone or switches apps. | Lowest — frontend-only change, ships in this codebase's existing deploy pipeline. |
| **B. Capacitor-wrapped Android app + background-geolocation plugin** | Wrap the existing React app in Capacitor (new `android/` project, plugin dependency, native build via Android Studio/Gradle), distribute as an APK or Play Store internal track instead of a URL. | Genuinely reliable through backgrounding and screen-lock via a real foreground service — this is what "operational tracking" in the brief's sense requires. | Real — new native build/release pipeline, rider onboarding changes (install an app, not visit a URL), ongoing Android SDK/Gradle maintenance. iOS would need separate, harder work (background location on iOS has its own stricter constraints) and is not scoped here. |
| **C. Dedicated native rider app** | Rewrite outside the current React codebase. | Same ceiling as B, more work to get there. | Not justified — the existing React app is well-tested (49 rider-app tests + 38 delivery tests, per the prior phase's own report) and working; there is no reason to discard it. Rejected. |

**Decision D1 — RESOLVED: Option B (Capacitor-wrapped Android app + background-geolocation plugin).** The user has confirmed the requirement is genuine operational tracking that must survive the rider backgrounding the app or locking the phone — Option A cannot do this (§1.2 is a platform limitation, not an implementation gap), so it is rejected outright rather than adopted as a Phase-1 stopgap. This is the single biggest architectural commitment in this plan: the Rider app gains a real native build/distribution pipeline (§N Tasks R1–R3 + the physical verification gate, Task RG). Plugin choice: **`@capacitor-community/background-geolocation`** (open source, MIT-licensed, actively maintained, correctly implements the Android 14+ foreground-service requirement) is recommended over Transistorsoft's more heavily-featured but commercially-licensed plugin — the community plugin is sufficient for this phase's requirements (interval/distance-throttled position reporting with a foreground-service notification) without committing to a paid vendor dependency the user hasn't separately approved. If field testing later shows it insufficient, swapping to the paid plugin is a contained, single-module change (the tracking module in §N is written against a small internal interface, not the plugin's API directly, precisely so this swap stays cheap).

---

## 2. Tracking lifecycle boundaries — verified against the actual state machine

Source: `backend/api/src/modules/orders/lifecycle/catalogue.ts`, `actions/{admin,rider,shared}.ts`, `database/types.ts`.

### 2.1 The ground truth the code already maintains

```ts
// catalogue.ts:132-138
export const ACTIVE_DELIVERY_STATUSES: readonly DeliveryAssignmentStatus[] = [
  'ASSIGNED', 'ACCEPTED', 'PICKED_UP', 'ARRIVED_AT_CUSTOMER',
];
// catalogue.ts:127
export const CLOSED_ORDER_STATUSES: readonly OrderStatus[] = ['CANCELLED', 'DELIVERED', 'FAILED', 'CUSTOMER_UNAVAILABLE'];
```

Definitive timeline (verified line-by-line against every action that writes `deliveries.assignment_status`):

| `DeliveryAssignmentStatus` | Set by | `orders.order_status` at that instant |
|---|---|---|
| `ASSIGNED` | `ASSIGN_RIDER` (`actions/admin.ts:43-53`) | `PACKED` (unchanged — assignment doesn't move the order) |
| `ACCEPTED` | *no write path exists anywhere in the backend* — dead enum value | n/a |
| `PICKED_UP` | `dispatch()` inside `RIDER_PICKUP`/`HAND_TO_RIDER` (`actions/shared.ts:26-44`) | `OUT_FOR_DELIVERY` (set in the **same transaction**) |
| `ARRIVED_AT_CUSTOMER` | `RIDER_ARRIVE` (`actions/rider.ts:50-63`) | `OUT_FOR_DELIVERY` (unchanged) |
| `DELIVERED` | `settleCod()` via `RIDER_COLLECT_COD`/`ADMIN_MARK_DELIVERED` | `DELIVERED` |
| `FAILED` | `closeDeliveryAsFailed()` via `RIDER_FAIL`/admin overrides | `FAILED` **or** `CUSTOMER_UNAVAILABLE` (delivery row is always `FAILED` either way) |
| `REJECTED` | *no write path exists* — dead enum value | n/a |

### 2.2 Two gotchas that must be in the tracking gate, not assumed

1. **Cancellation while assigned.** `cancelOrder` (`actions/shared.ts:56-77`) explicitly documents: *"An ASSIGNED delivery is left as it is: the Rider app already shows a cancelled order as 'Cancelled — don't pick up'."* The delivery row stays `ASSIGNED` under a now-`CANCELLED` order. **A tracking gate that only checks `deliveries.assignment_status` will miss this** — it must also check `orders.order_status NOT IN CLOSED_ORDER_STATUSES`.
2. **Re-stage creates a new delivery row.** `RESTAGE` (`actions/admin.ts:155-167`) only flips `orders.order_status` back to `PACKED`; it never touches the old `FAILED` delivery row. The replacement rider gets a **brand-new** `deliveries` row via the normal `ASSIGN_RIDER` path. So after a failed→re-staged→reassigned order, there is one old `FAILED` row and one new `ASSIGNED` row for the same order. **Tracking must always resolve "the current active delivery" by querying `order_id + assignment_status`, never by a cached/last-known `delivery_id`** — otherwise a location write could target the dead row.

### 2.3 Recommended tracking window (verifies and slightly sharpens the brief's own diagram)

The brief's proposed diagram shows tracking starting at "PICKED_UP / OUT_FOR_DELIVERY" and stopping at "ARRIVED_AT_CUSTOMER" — this matches the code's semantics exactly, and is what's recommended, with one clarification: **not** `ASSIGNED`. At `ASSIGNED` the rider is travelling to the *store* to collect the bag, not toward the customer — showing that leg on a map centered on the customer's address has no product value and needlessly widens the tracking window. Recommended gate:

- **Start:** the instant `assignment_status` becomes `PICKED_UP` (the rider taps "picked up," which they already do today — no new rider action).
- **Stop:** the instant `assignment_status` becomes `ARRIVED_AT_CUSTOMER` — once the rider is at the door, live movement has nothing left to show, and continuing to stream location through COD settlement only costs battery and exposure for no benefit.
- **Independent backend gate (defense in depth, §2.2):** a location write is only ever accepted while `deliveries.assignment_status == 'PICKED_UP' AND orders.order_status == 'OUT_FOR_DELIVERY'`, checked fresh on every write — not cached, not inferred from what the rider app last saw.

No rider-availability system is invented for this — `riders.is_available` exists in the schema but nothing maintains it today (confirmed by the riders-module investigation); tracking eligibility is derived purely from the delivery's own status, exactly as instructed.

**Decision D2:** confirm the PICKED_UP→ARRIVED_AT_CUSTOMER window (recommended) vs. the wider ASSIGNED→DELIVERED window (matches the raw `ACTIVE_DELIVERY_STATUSES` set but shows the store-bound leg too).

---

## 3. Location permission strategy (rider side)

No permission handling exists in the Rider app today (confirmed absent). Design:

1. **Never call the browser permission prompt cold.** Show an explanatory in-app message first ("Blynk needs your location to share it with the customer while their order is on the way — starting now that you've picked up the order"), triggered by the rider's own existing "I've picked up" action (§13), not by a separate screen or app-open event — so the ask appears exactly when its purpose is self-evident.
2. **States to model** (a small state machine, not a boolean): `not_requested → requesting → granted | denied | unavailable`.
   - **Granted:** start `watchPosition` immediately.
   - **Denied (soft):** browsers generally won't re-prompt in the same session; show the explanation again plus a link to the browser's own site-settings (the exact UI differs by browser — Chrome/Android exposes a padlock-icon flow, Safari/iOS a Settings-app flow). Use the Permissions API (`navigator.permissions.query({name:'geolocation'})`) where available to distinguish an active session denial from a persisted one, falling back to the browser's own prompt behavior where the API isn't supported (notably older Safari).
   - **GPS/location services disabled at the OS level:** distinguished from a permission denial via the Geolocation API's own error codes (`error.code === 2`, `POSITION_UNAVAILABLE`, vs `error.code === 1`, `PERMISSION_DENIED`) — different message, different remedy (device Settings, not browser Settings).
   - **Revoked mid-session:** `watchPosition`'s error callback fires `PERMISSION_DENIED` if revoked while active — stop the loop, surface "location sharing was turned off," offer to re-request.
   - **Approximate vs. precise:** request `enableHighAccuracy: true`; the OS may still return an approximate fix if the user has chosen that mode (iOS 14+/Android 12+). Send the reported `accuracy` (meters) to the backend regardless — do not reject approximate fixes, just carry the accuracy value through so the customer-facing freshness/quality treatment (§10) can account for it.
3. **No silent requests.** The rider always sees why before the OS dialog appears.

---

## 4. Location update strategy

- **Send trigger: time interval OR minimum distance, whichever comes first** — the standard fleet-tracking pattern. Recommended starting values (tunable, not hardcoded as magic numbers in the final implementation): send at most every **8–10 seconds**, or immediately if the rider has moved more than **~25–30 meters** since the last *sent* point (Haversine against the last accepted point, reusing `backend/api/src/utils/geo.ts`'s existing function — or a client-side equivalent for the pre-send check). This avoids flooding while stationary (a red light, the customer's gate) and avoids stale gaps while moving fast.
- **`watchPosition` itself fires far more often than this** (typically ~1Hz on a good GPS fix) — the throttle above governs what gets *sent*, not what the OS reports; no change to the underlying watch call.
- **Duplicate suppression:** if the new fix is within a tiny epsilon of the last *sent* point AND the time threshold hasn't elapsed, skip the send. If the time threshold *has* elapsed, send anyway even if stationary, so a legitimately-idle rider doesn't make the customer's "last update" look stale.
- **Stale fixes:** if the device-reported fix timestamp (`position.timestamp`) is already old when the client is about to send it (can happen with a cached OS fix), the client should still send it honestly — staleness is a server-side classification concern (§10), not something the client should paper over by substituting the send-time.
- **Timestamp handling (the brief's explicit requirement):** the client sends `captured_at` = `position.timestamp` (when the fix was actually taken), converted to ISO-8601. The **server stores both** `captured_at` (client-reported) and `received_at` (`now()` at the moment of the write) — `captured_at` is the timestamp of record for freshness display; `received_at` exists only to diagnose network/device delay, never substituted for `captured_at`.
- **Battery:** the interval/distance throttle above is the main lever available in a plain browser context (you cannot tell the OS location provider itself to sample less often from JS the way a native app can); this is an accepted tradeoff of Option A (§1.3).
- **Network failure:** a failed send is dropped, not queued — see the offline-queue decision in §10.
- **No offline location queue built for Phase 1** — investigated and rejected: with a latest-only data model (§6), a backlog of stale historical points has no value once a fresher one arrives; queueing them would add real complexity (persistence, retry, replay ordering) for zero product benefit. Revisit only if a future requirement needs a trip trail.

---

## 5. Backend API design

**Conceptual route** (not the final path, per instruction — but the closest fit to the existing convention, which uses `POST` for "record something new" — `collect-cod` — and `PATCH` for "change the delivery's own state" — `/status`):

```
POST /api/v1/riders/deliveries/:id/location
Body: { latitude: number, longitude: number, accuracy: number, captured_at: string (ISO 8601) }
```

Deliberately **nothing else in the body** — no `order_id`, no `rider_id`, no `customer_id`, no `tracking_status`. Every one of those is derived server-side from the authenticated caller and the DB row, exactly like `collect-cod`'s body is `{ amount }` only (`rider.schema.ts`, `resources.ts:32-38`). This closes off the "never trust rider-supplied IDs" requirement by construction rather than by validation.

### 5.1 Verification chain (every item from the brief, mapped to an existing, reused mechanism)

| Requirement | Mechanism | Reused from |
|---|---|---|
| Authenticated + RIDER role | `requireAuth` then `requireRoles('RIDER')` | Existing middleware, unchanged (`rider.controller.ts` routes already use this) |
| Rider owns the delivery | Resolve `riders.id` from `req.user.id` (checks `is_active`), then `WHERE deliveries.id = :id AND deliveries.rider_id = :riderId` → **404** on mismatch (not 403 — indistinguishable from "doesn't exist," anti-enumeration) | Exact pattern of `lifecycle/engine.ts:86-97`'s `riderDelivery` lock and `rider.service.ts`'s `getRiderOrThrow` |
| Delivery currently trackable | `assignment_status == 'PICKED_UP' AND order_status == 'OUT_FOR_DELIVERY'` (§2.3) → else `409 DELIVERY_NOT_TRACKABLE`, never silently dropped | New check, same error-shape convention as the rest of the API (`AppError(msg, status, code)`) |
| Valid coordinates | Zod `z.number().min(-90).max(90)` / `.min(-180).max(180)` | Verbatim template already used for customer addresses, `modules/users/address.schema.ts:21-22` |
| Valid timestamp | Zod `z.string().datetime()` + application check: reject if more than ~60s in the future (clock skew tolerance); treat as harmlessly stale (not a hard error) if more than a few minutes old, rather than failing the request | New, following the schema's existing style (no bare numeric literals — named constants) |
| Cannot submit for another rider's delivery | Covered by the ownership check above | — |
| Cannot submit after delivery closed | Covered by the trackable-state check above | — |

### 5.2 Deliberately bypasses the lifecycle engine

`lifecycle/engine.ts`/`runTransition`/`CATALOGUE` exist specifically to gate **status-changing** writes with children-before-order `FOR UPDATE` locking. A location ping changes neither `orders.order_status` nor `deliveries.assignment_status` — forcing it through the same machinery would take an order-row lock on every single ping (every few seconds, per active rider), serializing against every real state-changing action (pack, hand-to-rider, cancel, admin overrides) for the whole trip duration, for a write that has no state-machine semantics at all. Instead: a plain unlocked `SELECT` for the ownership/state check, then a single-row `UPDATE` (Postgres MVCC is sufficient for a single-row overwrite — no `FOR UPDATE` needed). **This endpoint must never be given a `from`/`to`/`ActionName` entry in the catalogue** — it is not a lifecycle transition, and #11's "location updates must never modify order status" is enforced by the fact that its `apply` logic literally never touches those two columns.

### 5.3 Rate limiting

No `express-rate-limit` or any general rate-limiting middleware exists anywhere in the backend today (confirmed absent from `app.ts` and `package.json`); the only precedent is a bespoke in-memory per-phone/per-IP limiter scoped to OTP requests (`modules/auth/auth.rate-limiter.ts`). Recommendation: **a lightweight, endpoint-local throttle**, not new global infrastructure — reject/ignore a write if it arrives less than the intended minimum interval (§4) after the *last accepted* write for that delivery, checked against the DB row's own `location_received_at` (no new in-memory state needed, and it's correct even if the process restarts, unlike the OTP limiter's in-memory `Map`). This satisfies "determine whether rate limiting is required" → yes, but scoped to the one endpoint that needs it.

---

## 6. Location data model

**Recommendation: latest-location only, as new columns on the existing `deliveries` row. No new table.**

```sql
-- new migration 006, additive to deliveries
ALTER TABLE deliveries
  ADD COLUMN current_latitude  NUMERIC(9,6),
  ADD COLUMN current_longitude NUMERIC(9,6),
  ADD COLUMN location_accuracy_m NUMERIC(7,1),
  ADD COLUMN location_captured_at TIMESTAMPTZ,
  ADD COLUMN location_received_at TIMESTAMPTZ;
```

Reasoning, directly answering the brief's own questions:

- **Whether history is needed in Phase 1: no.** Nothing in this phase's requirements needs a trail, replay, or analytics view — only "customer sees rider moving," which the latest point alone satisfies (the map animates from old-latest to new-latest on each push; no server-side history is needed to do that).
- **Whether latest-only is sufficient: yes**, for exactly that reason.
- **Retention/cleanup: none needed.** Every write is a plain `UPDATE` overwrite — the table never grows with ping volume, only with delivery count (which the schema already retains indefinitely, same as every other order/delivery row today). There is no history to expire.
- **Indexing:** none beyond the existing `deliveries` primary key — both the write path (by `id`) and the read path (by `order_id`/`id`, already indexed via `idx_deliveries_rider_active` and the FK) are covered.
- **Uses the schema's existing convention exactly**: `NUMERIC(9,6)` is the precision used everywhere else in this codebase for coordinates (`dark_stores`, `customer_addresses`, `orders.delivery_latitude/longitude`) — no reason to deviate.
- **Exposure is scoped narrowly**: these five columns must be surfaced by exactly one read path (the customer SSE stream, §7/§9) and nowhere else — not the admin order list, not the rider's own delivery view (which already correctly shows no coordinates, per the existing test in §1.1), not any general "get delivery" response.

**Deferred, not built:** an optional `rider_locations(delivery_id, latitude, longitude, accuracy, captured_at)` history table, only if a future, separately-scoped requirement (an ops replay/audit view) emerges. If ever added, it would need a retention job and an index on `(delivery_id, captured_at)` — noted here so the decision isn't lost, not designed further.

---

## 7. Realtime transport comparison

| | Short polling | WebSocket | **SSE (recommended)** |
|---|---|---|---|
| Direction needed | matches (client pulls) | over-provisioned — nothing needs to go customer→server on this channel | matches exactly (server pushes) |
| New infra | none, but... | new `ws` dependency, new connection-lifecycle code, no built-in reconnect (must hand-write) | none — attaches to the same plain Express `http.Server` (`server.ts:18-19`) as a normal long-lived route; confirmed via source that `app.listen()` returns a real `http.Server` |
| Reconnection | trivial (it's just repeated requests) | must be hand-rolled | **built in** — browsers/clients auto-reconnect a dropped SSE stream |
| Auth fit for THIS client | fine | fine | **fine, with no extra work**: the consuming client is the Flutter app over Dio, not a browser `EventSource` — Dio can stream a normal authenticated `GET` with the existing `Authorization: Bearer` header exactly like every other call this app makes. The usual "browser EventSource can't set custom headers" problem that normally complicates SSE auth **does not apply here**. |
| Fits the codebase's stated stance | the customer app explicitly has **zero** polling today by design (confirmed: `order_summary_screen.dart` and `customer_shell.dart` both document resume-triggered refresh instead of timers) — introducing polling specifically for this feature reintroduces exactly what the rest of the app deliberately avoids | new pattern, unused half of its capability | new pattern, but the minimum one that matches the actual one-directional requirement |

**Recommendation: SSE.** `GET /api/v1/orders/:id/location/stream` — customer-facing, `requireAuth` + `requireRoles('CUSTOMER')` + ownership check (§9). Sends the current latest point immediately on connect if one exists, then pushes on every accepted rider write; sends periodic heartbeat comments to keep the connection alive past Node's default `keepAliveTimeout` (which is not currently tuned anywhere in `server.ts` — will need raising, or heartbeats alone may suffice depending on the exact default in the deployed Node version) and to let the client detect a dead stream. **The server closes the stream itself** the instant the order leaves the trackable window (§2.3) — the client doesn't need to poll "is this still live," it simply sees the connection end.

**Fan-out at this scale:** confirmed via `docker-compose.yml` that the API runs as a **single container/single process** today (a separate `worker` container exists only for notifications, explicitly disabled inside the API container to avoid double-processing) — no load balancer, no replicas, no Redis anywhere in the topology. A single-process **in-memory** pub/sub (a `Map<orderId, Set<Response>>`, broadcast right after each accepted location write) is fully correct at this scale and matches the explicit instruction not to introduce Redis/Kafka "merely because the feature is called live tracking." **Documented, not built:** this must move to a shared broker (Redis pub/sub, or Postgres `LISTEN/NOTIFY` as a zero-new-infra option since Postgres is already present) before the API is ever scaled beyond one replica — a clear future trigger, not a current requirement.

**Decision D3:** confirm SSE over WebSocket/polling (recommended) — this is the one place this plan proposes new backend infrastructure (a stream route + an in-memory broadcaster), so it's called out explicitly even though it introduces no new external dependency.

---

## 8. Map provider comparison (Customer Flutter app) — REVISED 2026-09-19, Google Maps rejected

Confirmed absent today: no map or geolocation package in `pubspec.yaml` at all, no location permission config in `AndroidManifest.xml` or `Info.plist`. This is a from-scratch integration. **This section was rewritten in full after the original approval; the original `google_maps_flutter` recommendation (§D.4) is superseded by this section, not merely amended.**

### 8.1 Three separate, easily-conflated licensing/cost questions

The brief specifically asked these to be distinguished, because "OSM is free" is true of exactly one of them:

| Question | Answer |
|---|---|
| **Is the MapLibre software free?** | Yes, unconditionally. `maplibre_gl` (the `flutter-maplibre-gl` package) and the MapLibre Native engine it wraps are open source (BSD-3-Clause lineage, forked from Mapbox GL JS v1 before Mapbox relicensed). No account, no key, no usage reporting, ever — this is true regardless of which tiles it renders. |
| **Is the OpenStreetMap *data* free?** | Yes, under the Open Database License (ODbL): free to use, copy, modify, and redistribute for any purpose, **including commercial**, provided "© OpenStreetMap contributors" attribution is shown. ODbL's share-alike clause applies to redistributing the *database itself* — it does **not** require an app that merely displays rendered map tiles (a "produced work" in ODbL's terms) to open-source anything. This plan only ever displays rendered tiles; no share-alike obligation arises. |
| **Is *serving the tiles* free?** | **No — this is the cost that actually exists**, and it is a hosting/bandwidth cost, entirely separate from the data license above. Rendering OSM data into tiles and serving billions of tile requests is infrastructure someone pays for. This is the question §8.2 actually answers. |

Geocoding and routing are separate products again (their own APIs, their own pricing) and are **out of scope** — this plan adds no address-lookup/reverse-geocoding and no routing/ETA (§D.13), so no geocoding or routing cost surface exists here at all.

### 8.2 Tile-serving options investigated

| | Public OSM tile server (`tile.openstreetmap.org`) | MapTiler Cloud | Stadia Maps | OpenFreeMap (hosted) | **Self-hosted PMTiles** |
|---|---|---|---|---|---|
| What it is | The OSM Foundation's own community-funded raster tile server | Commercial vector/raster tile hosting, OSM-based | Commercial vector/raster tile hosting, OSM-based | Free, open-source vector-tile hosting service (OpenMapTiles schema), run by an individual maintainer; also fully self-hostable | Blynk builds one `.pmtiles` file from an OSM extract and serves it as a static file from its own existing backend |
| Free-tier commercial use | Not really a "tier" — access is a courtesy, not a product | **Free plan is explicitly non-commercial-use only** (confirmed on MapTiler's own pricing/ToS pages); commercial use needs the Flex plan ($25–30/month base + $0.10/1,000 requests over the included quota) or higher | **Free plan explicitly excludes any commercial/revenue-generating use** (confirmed on Stadia's own FAQ) | **Commercial use is explicitly allowed**, no API key, "no limits on the number of map views or requests" per the maintainer's own published terms | N/A — nothing is "used," Blynk hosts the one file itself |
| API key required | No | Yes | Yes | No | No |
| Reliability guarantee | None stated; heavy/inappropriate use "may be blocked without notice" — explicit OSMF operations policy | Standard commercial SLA on paid plans | Standard commercial SLA on paid plans | **None** — the maintainer states plainly "I don't offer SLA guarantees or personalized support" (a single-maintainer free service) | Bound only by Blynk's own existing backend's uptime — no separate third party to lose |
| What happens past the "free" ceiling | Access can be withdrawn without notice at any volume if usage is judged heavy — there is no purchasable increase | Automatic metered overage billing (capped only if a spending limit is set) | Requires upgrading off the free plan entirely (free plan is non-commercial by definition, not a volume ceiling) | No stated ceiling, but no SLA either — "past the ceiling" isn't really the risk; an unannounced maintainer outage is | N/A — Blynk's own bandwidth is the only ceiling, and at 1–2 riders / ~50 orders/day it is trivial |
| Attribution | "© OpenStreetMap contributors" | Built-in | Built-in | "OpenFreeMap © OpenMapTiles Data from OpenStreetMap" (mandatory; MapLibre renders it automatically when configured) | "© OpenStreetMap contributors" (Blynk must render this itself — same as any other OSM-data use) |
| Fit for Blynk's actual scale (Dharga Town, one hub, 4 km radius, 1–2 riders) | Explicitly the wrong tool — this is exactly the "small commercial user on a community-funded courtesy service" case the OSMF policy warns against | Technically fine, but forces either a recurring bill for a genuinely tiny, geographically fixed tile footprint, or staying on a plan whose terms forbid the commercial use this app has | Same shape as MapTiler | Attractive (no key, allows commercial use, no bill) but carries a real availability risk for a feature the live-delivery flow depends on, with no recourse if the maintainer stops running it | A near-perfect fit for a **single fixed small town**: the entire tile footprint Blynk will ever need is one small, static regional extract — cheap to build once, cheap to store, and served by infrastructure Blynk already runs and already trusts for everything else |

### 8.3 Decision: self-hosted PMTiles, with OpenFreeMap documented as the swap-in fallback

**Chosen for implementation: a self-hosted `.pmtiles` file, built from an OSM extract covering Dharga Town and enough surrounding area for context, served as a static file by `backend/api`.** This is presented as the concrete fit for Blynk's specific situation, not a universal "best" tile provider — a company operating city-wide or nationwide, or serving many separate towns, would reasonably reach a different conclusion (fixed small-region self-hosting stops being cheap once the region isn't fixed and small).

Why this fits here specifically:
1. **The geography is genuinely fixed and tiny.** One dark store, one town, a 4 km radius (`dark_stores.radius_km`, §12) — the entire tile area this app will ever need is known today and does not grow with order volume the way a per-request SaaS bill would.
2. **It removes every dependency this investigation was asked to avoid**: no API key to secure or rotate, no third-party billing risk, no third-party reliability risk for a feature the live-delivery flow depends on (unlike OpenFreeMap's public instance, which carries a stated no-SLA disclaimer from a single maintainer).
3. **PMTiles is natively supported by `maplibre_gl`/MapLibre Native on both Android and iOS with no extra plugin code** — the `pmtiles://` protocol is handled inside MapLibre Native itself (confirmed against the package's own current documentation); the app only needs to point the map's `styleString`/tile source at the file's URL.
4. **It reuses infrastructure Blynk already runs and pays for** — `backend/api` already serves HTTP; serving one additional static file with byte-range support (Express's static-file handling supports HTTP Range requests, which `.pmtiles` reading relies on) is not new infrastructure in the sense the brief warns against (no new service, no new database, no new account) — it is one more route on the server that already exists.
5. **The one-time cost is a build step, not a running service**: an OSM regional extract (source: Geofabrik's Sri Lanka extract — confirm the current download URL against Geofabrik's own site at build time, since extract URLs/coverage occasionally change) is processed once into a `.pmtiles` file using an open-source tile-building tool (e.g. Planetiler, Java-based, or the Protomaps `basemaps` build pipeline — **the exact current tool/command/version must be confirmed against that tool's own current documentation at Task M0's implementation time**, not assumed from this investigation, per the brief's own instruction not to invent configuration values). Rebuilding is a manual/scripted maintenance task done occasionally (e.g. every few months, since a town's road network changes slowly), not a running process.

**Documented fallback, enabled by the abstraction (§8.4), not a fallback that requires new code:** if self-hosting is ever deprioritized, **OpenFreeMap's public instance** is a same-day swap — it needs no API key either, allows commercial use, and the only change required anywhere in the app is the tile-source URL/style passed into the one file that is allowed to know about it (§8.4). MapTiler/Stadia's paid commercial tiers remain documented, verified options if a vendor-backed SLA is ever wanted instead — neither is adopted now because neither is needed at this scale and both would introduce exactly the recurring third-party billing dependency this investigation was asked to avoid.

**Explicitly rejected:** the raw public `tile.openstreetmap.org` server (§8.2 — this is precisely the "assume OSM tiles are an unlimited free commercial API" mistake the brief warned against; the OSMF's own operations policy says heavy or commercial-shaped use may be blocked without notice); `google_maps_flutter` (superseded per the brief's explicit new instruction); Mapbox (dropped from consideration entirely — it was in the original comparison, added no advantage over MapLibre/OSM for this app, and is not investigated further here since the brief's scope is Google Maps → MapLibre + OSM specifically).

### 8.4 The `MapProvider` / `TrackingMapView` abstraction (new binding requirement)

Mirroring the Rider app's `TrackingPlugin` isolation (§1.3, §N Task R2): **exactly one file, `apps/customer/.../lib/UI/Widgets/Organisms/maplibre_map_view.dart`, is allowed to import `package:maplibre_gl/maplibre_gl.dart`.** Every other file that needs a map — `OrderTrackingMap` (§N Task M4) and the location picker screen (§N Task M6) — depends only on a small, provider-neutral contract (`GeoPoint`, `MapMarkerSpec`, `TrackingMapView`, `LocationPickerMapView`; full definitions in Task M4) defined in a separate file that never imports any map SDK. This means a future provider change (OpenFreeMap's tile URL, a different rendering engine entirely) touches exactly one file and never touches: rider GPS tracking, the backend location-write API, SSE, order lifecycle, delivery assignment, or tracking authorization — none of which import or know about the map layer at all today, and this abstraction keeps it that way going forward too. Verified mechanically (§N Task M7): grep for `maplibre_gl` under `lib/` must return exactly one file.

### 8.5 Security requirements (tile hosting specifically)

- **No API key is required by the chosen provider (self-hosted) or its documented fallback (OpenFreeMap)** — there is nothing to store as a secret for tile access. This is stated explicitly so a future implementer doesn't invent a key requirement that doesn't exist.
- The `.pmtiles` file's URL is **not a secret** — it is a public asset URL, the same category of value as the API base URL the app already configures via `flutter_dotenv`/`.env` (already a dependency, already the established convention in this codebase — reused here, not a new pattern).
- If a future provider swap ever does require a key (e.g. adopting MapTiler's paid tier), it must follow this codebase's existing secret-handling convention (server-side/build-time injection, never committed, never embedded unrestricted) — exactly as documented for the Rider app's own secrets; no new convention is invented here since none is needed for the chosen providers.

### 8.6 What the map shows (unchanged from the original investigation)

- **Destination marker:** from `orders.delivery_latitude/delivery_longitude` — **already stored on every order** (`order.service.ts:210-211`, `types.ts:210-211`), just not yet surfaced to the Flutter `OrderModel` (a small additive parse, no backend change needed for this part).
- **Rider marker:** from the new latest-location columns (§6), pushed via SSE (§7) — a plain colored marker (no photo, no name, no vehicle detail), consistent with the existing `OrderDeliveryInfo` design already established in the prior phase, which explicitly strips rider identity from every customer-facing delivery field.
- **Status text:** the existing `orderStatusHeader`/`orderStatusSentence` built in the Customer Order Experience phase stays exactly as it is — the map augments it, doesn't replace it.
- **No route/polyline, no ETA** — unchanged reasoning: a real route needs a separate routing/directions API (its own licensing, its own cost, explicitly out of scope per §D.13), and a straight-line polyline would misrepresent actual roads.
- **Attribution is always visible** — "© OpenStreetMap contributors" (plus the tile source's own required credit, if the OpenFreeMap fallback is ever used), rendered as a permanent, non-dismissible overlay on the map widget, per the ODbL requirement (§8.1) — not optional UI polish.
- **Offline:** MapLibre renders already-cached tiles for the last-viewed area without network; rider position simply stops updating (the SSE stream drops) — covered by the stale/offline UI in §10, not a map-specific concern.

**What the map needs, confirmed absent today (Android permissions, unchanged from the original investigation — these are unaffected by the provider swap):**
- **Two separate permission asks, not to be conflated:** viewing the *rider's* location (the live-map feature) needs no permission from the customer's device at all — only the customer's *own* "use my current location" address-picker feature (§12) needs `ACCESS_FINE_LOCATION`/`NSLocationWhenInUseUsageDescription`, also currently absent.
- Unlike Google Maps, **MapLibre requires no manifest API-key meta-data at all** — one fewer piece of Android config than the original plan needed (§N Task M5).
- iOS: not scoped further here — this plan is Android-first per §1, matching the rider-tracking scope; the Customer app already ships on multiple platforms per its existing config, but live tracking's rider-side dependency is Android-only for now. `maplibre_gl` does support iOS (confirmed in its own documentation), so the Customer app's map is not itself Android-locked the way the Rider tracking work is — only noted as not separately verified/scoped in this phase.

**Flutter/Dart toolchain compatibility (verified in this environment, not assumed):** the installed Flutter SDK is **3.47.2 / Dart 3.13.2** (`flutter --version`, run directly against this repo's toolchain), and the current `flutter-maplibre-gl` release (`maplibre_gl` v0.26.0 per its own changelog, current as of this investigation) requires **Flutter 3.29+ / Dart 3.7+** — comfortably satisfied. The app's `pubspec.yaml` SDK constraint (`>=3.0.5 <4.0.0`) is broad enough to accept `maplibre_gl`'s requirement without needing to be raised. This must be re-confirmed against whatever `maplibre_gl` version is actually current at implementation time (Task M4), the same way the Rider app's plugin-compatibility check is re-confirmed at its own implementation time (§N Task RG Step 0) — versions move.

---

## 9. Customer privacy model

Ownership check on the SSE stream, mirroring the exact pattern the backend already uses for every other customer-order read (`orders.customer_id == req.user.id`, confirmed in the prior phase's own investigation of `getCustomerOrderById`):

| Test | Result |
|---|---|
| Customer A → Order A → Rider location A | Allowed — `orders.customer_id` matches `req.user.id`. |
| Customer A → Order B (not theirs) | **404** (not 403 — matches the anti-enumeration convention used throughout this backend) — the ownership check on `order_id` alone already prevents this regardless of which rider is on the order. |
| Customer B → Order A | Same 404. |
| Unauthenticated | `requireAuth` rejects before the ownership check runs — same as every other order route today. |
| Staff roles (ADMIN/PACKING_STAFF/RIDER) | Explicit `requireRoles('CUSTOMER')` on the stream route, in addition to the ownership check — belt-and-braces, matching the existing role-array convention in `catalogue.ts`. Any operational visibility into rider location is a separate, explicitly-scoped feature (§14), never an accidental side effect of this one. |
| Closed deliveries stop exposing live location | The server closes the SSE stream itself the instant the delivery leaves the trackable window (§2.3) — not a client-side timeout, an authoritative server action. |
| Old locations not indefinitely accessible | With latest-only storage (§6) there is no historical data to leak — once closed, the columns are simply never served again by the one endpoint that reads them; no other route exposes `deliveries.current_latitude/longitude` at all. |

---

## 10. Stale/offline behavior

Freshness is always computed from the **server-recorded `location_captured_at`**, never a client wall clock:

| State | Condition | Customer-facing treatment |
|---|---|---|
| **LIVE** | `now() - captured_at` within ~1.5–2× the expected update interval (§4) — tolerates one missed tick without flapping | Full-strength rider marker |
| **STALE** | Beyond that, up to a longer ceiling (e.g. 2 minutes) | Dimmed marker + "Last seen Xs/Xm ago" — the position is real, just not current; never presented as if it were live |
| **OFFLINE / UNAVAILABLE** | Beyond the ceiling, the SSE stream has dropped, or no location has been recorded yet (before pickup) | Rider marker hidden/faded out entirely — no stale pin left implying currency |

Re-evaluated on a short client-side UI timer (a pure re-render of already-received data, not a network call — does not reintroduce polling).

**Rider-side GPS failure:** `watchPosition`'s `POSITION_UNAVAILABLE` error → explicit banner ("Can't get your location — check GPS is on") + a bounded retry (e.g. every 10–15s), never a silent tight loop.

**Rider-side network failure:** a failed POST is simply not retried with a backlog — the rider app's own "last sent" indicator (§13) honestly reflects the gap; the next successful `watchPosition` tick (or the existing `useRevalidate` `online` event) resumes sending fresh data. **No offline location queue is built**, per explicit instruction to build one only if investigation proves necessary — it doesn't, because a backlog of stale points has no value once a fresher point exists (latest-only model, §6).

---

## 11. Security and abuse-prevention test mapping

| Scenario (from the brief) | Defeated by |
|---|---|
| Rider submits another rider's delivery ID | Ownership `WHERE ... rider_id = :riderId` → 404 (§5.1) |
| Rider submits another order ID | N/A by construction — the payload carries no order/customer/rider id at all (§5) |
| Customer requests another customer's tracking | Ownership check on the stream → 404 (§9) |
| Malformed coordinates | Zod type/shape validation |
| Impossible coordinates | Zod `.min/.max` bounds, same template as `address.schema.ts` |
| Old timestamps | Treated as stale (silently not applied), not a hard error — avoids punishing normal network delay |
| Future timestamps | Rejected beyond a small clock-skew tolerance (~60s) — 400 |
| Duplicate locations | Idempotent no-op by construction (latest-only overwrite with the same value) |
| High-frequency location spam | Server-side per-delivery throttle keyed off the DB's own last-accepted timestamp (§5.3) |
| Location submission after delivery/failure | Trackable-state check → 409 (§2.3/§5.1), independent of what the rider client believes |
| Unauthenticated requests | `requireAuth` → 401 |
| Wrong-role requests | `requireRoles('RIDER')` (write) / `requireRoles('CUSTOMER')` (read) → 403 |

**Rate limiting: yes, endpoint-local, not new global middleware** (§5.3) — the one gap this investigation found (no `express-rate-limit` anywhere) is real but doesn't justify adopting a new dependency for a single endpoint when a DB-timestamp-based throttle covers the actual risk.

**Location updates never change order status: enforced by construction**, not by a rule someone has to remember — the endpoint's write path only ever touches the five new location columns, and it deliberately never runs through `lifecycle/engine.ts` (§5.2), which is the only code path in this backend that can change `order_status`/`assignment_status` at all.

---

## 12. Customer location picker (item #12)

**Current state, confirmed in source, not assumed:** `lib/Screens/add_edit_address_screen.dart:12-16` carries its own comment: *"there's no map-picker or geocoding library in this project, so these stay plain editable fields defaulted to the real Dharga Town hub coordinates rather than faking a location picker that doesn't exist."* Two plain, hand-typed lat/lng `TextFormField`s, defaulted to `6.4382, 80.0274` (`add_edit_address_screen.dart:75-78`). This is an honest stub, not a broken feature — but it is not real GPS.

**Already working and needs no change:** saved-address selection (`AddressProvider`'s list/select flow) already functions correctly.

**What's missing, to build:**
1. **Real "use current location"** — add `geolocator` (the standard Flutter geolocation package; its own bundled permission API is sufficient for this one use case, so a second general permission package is not needed). Explain-before-prompt, same principle as §3, applied to the customer this time.
2. **Visible confirmation of the selected coordinate** — since `maplibre_gl` is already being added for §8 (behind the `MapProvider`/`TrackingMapView` abstraction, §8.4), reuse the same `LocationPickerMapView` contract here for a draggable-pin confirmation screen rather than leaving raw numbers in a text field. This directly satisfies "the selected coordinate is visible" and "the delivery address is clearly confirmed," and this screen never imports `maplibre_gl` directly either (§N Task M6).
3. **Two distinct permission asks, not one** — the customer's own location (this feature) is unrelated to viewing the rider's location (§8), and the UX must not conflate them (don't ask for location "for tracking" when it's actually for address entry, or vice versa).

**Backend radius validation stays exactly as it is: server-side only, at checkout, not at address-save.** Confirmed today: `utils/geo.ts` + `order.service.ts:115-136`, evaluated against the configurable `dark_stores.radius_km` (currently 4.00 km, but a DB value, not hardcoded). **No client-side distance calculation is added anywhere** — explicitly instructed against, and adding even a "soft hint" risks drifting out of sync with the server's configurable radius or being misread as authoritative. The picker simply saves the address; checkout already surfaces the existing `DELIVERY_OUTSIDE_RADIUS` error if it applies, unchanged.

---

## 13. Rider UI (item #13)

**No manual "Start tracking" toggle** — the brief discourages this unless proven necessary, and it isn't: tracking should follow the lifecycle the rider already drives via the existing pickup button. The permission prompt (§3) and the start of `watchPosition` are both triggered by that same existing "I've picked up" action, not a new control.

**Status readout the rider must be able to see** (a small, passive UI element near the existing delivery-action area — not a new screen):
- Location permission needed (shown only once relevant, i.e. at pickup, not at app launch)
- Tracking active ("Sharing your location")
- GPS unavailable (§10's rider-side flow)
- **Last successfully sent time** ("Updated 4s ago") — directly answers "whether the latest location was successfully sent" from the brief, and is honest: it only advances on a confirmed server accept, not on every `watchPosition` tick
- Tracking stopped (a brief confirmation on `ARRIVED_AT_CUSTOMER`, so the rider isn't left wondering if sharing is still silently running)

---

## 14. Admin (item #14)

**Not adding a live tracking map to Admin in this phase.** The brief asks to first determine whether operations actually need it — nothing in this investigation surfaces a concrete need distinct from what the customer-facing feature already provides: a dispatcher's real questions ("is this order out for delivery yet," "has it been going unusually long") are already answerable from the existing status/timestamp data the Admin Orders board already polls (confirmed: `apps/admin/src/pages/Orders.tsx`, 20s interval, explicitly imitating the Rider app's own polling pattern). A genuine ops need — "show me where *all* riders are right now," a fleet-overview map — would be a materially different feature (aggregating across all active deliveries, not the one-order-scoped stream this plan builds) and is documented here as a distinct, separately-approved future item, not built or assumed.

---

## 15. Test strategy

| Area | Where verified |
|---|---|
| Location permission (granted/denied/unavailable/revoked/approximate) | Rider app unit/widget tests around the new tracking hook, mirroring `useRevalidate`'s existing test style |
| Location validation (bounds, malformed, future/old timestamps) | Backend Vitest, same style as `address.schema.ts`'s existing bound tests |
| Rider ownership (another rider's delivery → 404) | Backend integration test, same pattern as the existing `riderDelivery` lock tests in `order-lifecycle.test.ts`/`rider-delivery.test.ts` |
| Customer ownership (another customer's order → 404) | Backend integration test, same pattern as existing `customer-orders.test.ts` |
| Closed delivery (DELIVERED/FAILED/CANCELLED) rejects a location write | Backend integration test — one case per closed state, including the cancel-while-ASSIGNED edge case from §2.2 |
| Stale location handling | Backend unit test (timestamp far in the past → accepted-but-not-broadcast, not a hard error) |
| Duplicate location | Backend unit test (idempotent overwrite) |
| High-frequency updates | Backend integration test — two writes inside the throttle window, second is rejected/ignored |
| Network failure (rider) | Rider app test — failed POST doesn't advance "last sent," no crash |
| GPS failure (rider) | Rider app test — `POSITION_UNAVAILABLE` shows the banner, bounded retry |
| Concurrent updates | Backend concurrency test (two writes racing for the same delivery — Postgres MVCC on a single-row `UPDATE`, no lock needed, verify no corruption/deadlock — 5 repetitions, matching this codebase's existing concurrency-test convention) |
| Location cleanup | N/A under the latest-only model — no test needed because there's nothing to clean up (documented, not skipped by oversight) |
| Customer isolation | Backend integration test, the three-case matrix in §9 |
| Live map update | Flutter widget test — SSE event → marker moves, matching how the Customer app's existing tests fake network responses |
| Rider pickup → tracking starts | Rider app test — the pickup action triggers the permission flow / starts `watchPosition` |
| Arrival → tracking stops | Rider app test — the arrive action stops `watchPosition`; backend test — a write after `ARRIVED_AT_CUSTOMER` is rejected |
| Delivery/Failed → tracking stops | Backend test, same shape as above |
| Failed → re-stage → replacement rider tracking | Backend integration test walking the full path from §2.2's gotcha #2 — confirms the new delivery row (not the old `FAILED` one) is the one location writes attach to |

---

## 16. Live E2E strategy

Extends the existing live-E2E pattern (real OTP, real HTTP, nothing mocked, database restored to baseline after) already used by the prior three phases:

1. Customer places an order (real UI) → pack → assign rider → rider picks up (real UI action) → **tracking starts**.
2. Rider sends **real device/test GPS coordinates** (not fake UI-only values, per explicit instruction) — on a real device this is genuine `watchPosition` output; in a CI/headless run, the closest honest equivalent is geolocation **mocked at the browser/WebDriver level** (a real, supported testing mechanism that still exercises the actual `watchPosition` code path) rather than a hand-typed "fake location" in the app's own code — the distinction matters: the app under test never knows it's not real GPS.
3. Backend receives the location → **customer's SSE stream delivers it** → customer app's map marker moves — asserted against the real coordinate value round-tripped through the real endpoint, not a canned response.
4. Rider marks arrived → **tracking stops** — assert the SSE stream closes and a further (test-forced) location POST is rejected 409.
5. Delivery completes → customer confirms the map no longer receives updates.
6. **Two-customer/two-rider isolation pass:** a second customer/order/rider pair verifies neither can see the other's location stream (§9's matrix, exercised live, not just in backend unit tests).
7. **Failed → re-stage → replacement rider pass:** confirms tracking correctly attaches to the new delivery row, not the dead one (§2.2).

---

## 17. Architecture constraints — compliance check

| Forbidden | Status |
|---|---|
| Kafka / Kubernetes / microservices | Not introduced anywhere in this plan. |
| Redis | Not introduced. SSE fan-out uses in-process memory (§7), justified by the confirmed single-container deployment; the future multi-replica trigger is documented, not built toward. |
| PostGIS / event sourcing | Not introduced — latest-only overwrite columns (§6), no spatial querying need identified. |
| Continuous tracking with no active delivery | The tracking gate is `PICKED_UP → ARRIVED_AT_CUSTOMER` only (§2.3), enforced server-side independent of what the rider client claims. |
| Fake GPS / fake ETA | No fake data anywhere in this design; no ETA/route proposed (§8) without separate approval. |
| Automatic rider dispatch | Untouched — assignment remains the existing manual `ASSIGN_RIDER` admin action; `is_available` stays unmaintained as today, nothing here invents a new dispatch mechanism. |

The one new piece of backend infrastructure this plan proposes is an SSE route + an in-process broadcaster (§7) — flagged explicitly as the minimum mechanism the live-map behavior genuinely requires, not a default reached for because the feature is called "live tracking."

---

## §D. Decisions — APPROVED 2026-09-19

| # | Decision | Resolution |
|---|---|---|
| **D1** | Rider tracking architecture (§1.3) | **Option B — Capacitor-wrapped Android app + `@capacitor-community/background-geolocation`.** Corrected from the original recommendation (Option A) after the user confirmed genuine background/lock-screen reliability is a hard requirement, not a nice-to-have. See the resolved §1.3 above. |
| **D2** | Tracking window (§2.3) | `PICKED_UP → ARRIVED_AT_CUSTOMER`, as recommended. |
| **D3** | Realtime transport (§7) | SSE, as recommended, "unless the implementation investigation demonstrates a concrete incompatibility" — none was found; confirmed compatible (plain Express `http.Server`, Dio-based client sends normal auth headers, no browser `EventSource` header limitation applies). |
| **D4** | Map provider (§8) | **REVISED 2026-09-19: `maplibre_gl` (MapLibre) rendering a self-hosted OSM-derived `.pmtiles` tile source**, superseding the original `google_maps_flutter` recommendation per explicit instruction. No Google Cloud project, no Google API key. Tile-hosting setup documentation is now the required, separately-written deliverable (§N Task M0) before any implementation task touches it. A `MapProvider`/`TrackingMapView` abstraction (§8.4) is a new binding requirement so the provider is swappable without touching tracking, backend, SSE, lifecycle, or authorization code. |
| **D5** | Data model (§6) | Latest-location-only columns on `deliveries`, as recommended. No historical rider locations exposed in this phase (explicit re-confirmation). |
| **D6** | Admin live map (§14) | Not built this phase, as recommended. |

**Additional binding requirements from the approval (restated here as constraints on every task in §N, not just noted in prose):**

1. Tracking starts only when the active delivery enters `PICKED_UP`, with the order in `OUT_FOR_DELIVERY` (§2.3, §5.1) — never earlier.
2. Tracking stops on `ARRIVED_AT_CUSTOMER`, `DELIVERED`, `FAILED`, `CUSTOMER_UNAVAILABLE`, `CANCELLED` — every way the trackable window can end, not just the happy path (§2.2, §2.3, §11).
3. Re-staging a failed order creates a **new** `deliveries` row; the old row must never accept a location write again, and this is enforced by the per-row eligibility check itself (§2.2), not by any explicit "is this the current delivery" flag — verified by a dedicated test (§N Task B7).
4. Every location write is authorized from `req.user` (authenticated rider) **and** the specific delivery row's own current state — never from anything the client claims (§5.1).
5. The location write path **never** calls `runTransition`/`lifecycle/engine.ts`/the `CATALOGUE` — confirmed architecturally in §5.2 and enforced by construction (the write touches only the five new location columns, never `order_status`/`assignment_status`).
6. The write endpoint has its own validation (Zod), ownership check, lifecycle-eligibility check, rate limit, and transaction strategy (§5, §5.3) — a complete, self-contained authorization chain, not a partial reuse of the lifecycle engine's checks.
7. The customer stream exposes only the caller's own active delivery's location (§9) — ownership-checked on every connection, not just at app-level routing.
8. **No historical rider locations are exposed in this phase** — re-confirmed; the one SSE stream and the one write endpoint are the only two places location data is ever read or written, and neither surfaces anything but the current latest value (§6, §9).
9. Latest location only is stored, with both `location_captured_at` (device fix time) and `location_received_at` (server receipt time) so freshness is always computable (§4, §6, §10).
10. SSE is used unless implementation proves a concrete incompatibility — none found; if one emerges during §N Task B4/B5, it must be raised explicitly before falling back to polling, not silently substituted.
11. **REVISED 2026-09-19:** MapLibre (`maplibre_gl`) is used, rendering a self-hosted OSM-derived tile source — not Google Maps. No Google Cloud project or API key exists in this plan. Tile-hosting setup documentation (data source, build tooling, hosting, attribution, fallback provider) is a required deliverable, written **before** any task that consumes it (§N Task M0, gates Tasks M1+). The map layer must sit behind a `MapProvider`/`TrackingMapView` abstraction (§8.4) — exactly one file may import `maplibre_gl` directly, mechanically verified (§N Task M7).
12. No Admin live map this phase (§14, re-confirmed).
13. No ETA anywhere, unless a real routing/ETA service is separately approved in the future (§8, re-confirmed).
14. No fake/simulated GPS anywhere in the product — every task's tests use either real device output or a browser/WebDriver-level geolocation mock that the app code cannot distinguish from a real fix (§16); the app itself never contains a "fake location" code path.
15. Tests must cover: background/foreground behavior, GPS permission changes (including mid-session revocation), network loss/reconnection, stale locations, rider ownership, customer isolation, closed deliveries (every terminal state, not just one), failed → re-stage → replacement rider, and duplicate/high-frequency location submissions (§N's per-task test lists implement §15/§16 exactly, expanded below to explicitly enumerate each of these).

The task-level implementation plan below (§N) implements all of the above. **Do not execute any task in §N until the user reviews and approves it** — this document stops at "written," not "started," per the original instruction.

---

# §N. Task-Level Implementation Plan

**Goal:** implement real rider GPS tracking (Capacitor/Android, background-capable), a backend location-write + SSE-stream pair that never touches the order lifecycle engine, and a customer-facing live map — exactly as designed and decided in §0–§D above.

**Architecture:** three independent surfaces, each already justified above — (1) backend: one migration, one write endpoint that bypasses `lifecycle/engine.ts` by design, one SSE stream, both under `orders`/`riders`' existing route conventions, plus one static-file route serving the self-hosted map tile archive; (2) Rider app: Capacitor-wrapped Android build, a background-geolocation plugin, a tracking module hung off the existing pickup/arrive/fail actions; (3) Customer Flutter app: `maplibre_gl` (behind a `MapProvider`/`TrackingMapView` abstraction, §8.4) + an SSE-consuming `LocationProvider`, following this app's established `ChangeNotifier`+injectable-request convention.

**Spec:** §0–§D of this same file (every task below cites back to a specific numbered section).

## Global Constraints (from §D, binding on every task)

- Tracking window is `PICKED_UP → ARRIVED_AT_CUSTOMER` (§2.3) — never wider, never narrower, checked fresh on every read and write, never cached.
- The location write endpoint must never import or call anything from `modules/orders/lifecycle/` (`engine.ts`, `catalogue.ts`, `actions/*`) — a task that does this fails review, full stop (§D.5).
- No historical rider locations are ever stored or exposed — latest-location-only columns on `deliveries`, nothing else (§D.5, §D.8).
- Every location write is authorized from `req.user` + the delivery row's own DB state — the request body carries only `{latitude, longitude, accuracy, captured_at}`, nothing else (§D.4).
- No fake/simulated GPS anywhere in application code — test doubles live only in test files, and Capacitor plugin mocks in rider-app tests must be swappable for the real plugin without any app-code branch on "is this a test" (§D.14).
- No ETA, no route/polyline, no rider identity/phone/vehicle exposed to the customer (unchanged from the prior phase's `OrderDeliveryInfo` design).
- No Admin live map (§D.6). No new Flutter dependency beyond `geolocator` and `maplibre_gl` (plus their own transitive deps). No new backend dependency beyond what's explicitly named in a task (SSE and the in-memory broadcaster use only Express/Node primitives already present; the tile static-file route uses Express's own static-file/range-request handling, no new package).
- **Map provider isolation (§8.4, mirrors the Rider app's `TrackingPlugin` isolation):** exactly one file, `apps/customer/.../lib/UI/Widgets/Organisms/maplibre_map_view.dart`, may import `package:maplibre_gl/maplibre_gl.dart`. `OrderTrackingMap`, the location picker, and every other Customer-app file depend only on the provider-neutral `GeoPoint`/`MapMarkerSpec`/`TrackingMapView`/`LocationPickerMapView` contract (Task M4) — a task that imports `maplibre_gl` from any other file fails review. Mechanically checked in Task M7.
- **No Google Maps anywhere in this plan** (§8, §D.4, revised 2026-09-19) — no Google Cloud project, no Google API key, no `google_maps_flutter` dependency. The map tile source is a self-hosted `.pmtiles` file built from an OSM extract (§8.3); OpenFreeMap is the documented, no-code-change fallback if self-hosting is ever deprioritized.
- `NUMERIC(9,6)` for coordinates, matching every existing lat/lng column in this schema (`dark_stores`, `customer_addresses`, `orders`).
- Commit only when the user asks (this repository's standing convention in this session); every task below still ends with a "Commit" step per the plan format — whether it is actually run is an execution-time decision, not a step to skip silently.
- Every task's tests must be real (verify actual behaviour, not shape) and must pass before the task is marked complete; run the project's full verification suite at Task V1, not before.

## File Structure

| File | Responsibility |
|---|---|
| `backend/api/src/database/migrations/006_rider_location_tracking.sql` (+`_down.sql`) | Adds the five latest-location columns to `deliveries`. |
| `backend/api/src/database/types.ts` | `DeliveriesTable` gains the five columns (existing file, additive edit). |
| `backend/api/src/modules/riders/rider.location.schema.ts` | Zod schema for the location-write payload. |
| `backend/api/src/modules/riders/rider.location.service.ts` | Ownership + eligibility + out-of-order/rate-limit/staleness logic; the one place that calls `broadcastLocation`. Never imports `lifecycle/`. |
| `backend/api/src/modules/riders/rider.repository.ts` | Gains `findTrackableDelivery`/`writeLocation` (existing file, additive edit). |
| `backend/api/src/modules/riders/rider.controller.ts` | Gains `updateLocation` (existing file, additive edit). |
| `backend/api/src/modules/riders/index.ts` | Gains the `POST /deliveries/:id/location` route (existing file, additive edit). |
| `backend/api/src/modules/realtime/location-stream.ts` | The in-process SSE subscriber registry + broadcaster + shutdown drain. New module, used by both `riders` (write side, to broadcast) and `orders` (read side, to subscribe). |
| `backend/api/src/modules/orders/order.repository.ts` | Gains `findTrackableLocationForCustomer` (existing file, additive edit). |
| `backend/api/src/modules/orders/order.location.controller.ts` | The customer-facing SSE stream handler. |
| `backend/api/src/modules/orders/index.ts` | Gains the `GET /:id/location/stream` route (existing file, additive edit). |
| `backend/api/src/server.ts` | `keepAliveTimeout`/`headersTimeout` tuning; calls `closeAllStreams()` during graceful shutdown (existing file, additive edit). |
| `backend/api/src/utils/metrics.ts` | Gains `locationUpdatesReceived/Rejected`, `streamsOpened/Closed` counters (existing file, additive edit). |
| `backend/api/tests/rider-location.test.ts` | Write-path tests. |
| `backend/api/tests/location-stream.test.ts` | Read-path (SSE) tests. |
| `backend/api/src/map-tiles/dharga-town.pmtiles` (or an equivalent path decided in Task M0) | The self-hosted, pre-built OSM-derived tile archive (§8.3) — a build artifact, not source code; the exact path/storage location (repo-committed vs. object storage) is decided and documented in Task M0. |
| `backend/api/src/routes/map-tiles.ts` (or folded into an existing static-file convention if one already exists — confirmed at Task M0) | Serves the `.pmtiles` file with HTTP byte-range support; no auth required (it is public map data, same trust level as any other public asset). |
| `apps/rider/capacitor.config.ts`, `apps/rider/android/` | New Capacitor Android project wrapping the existing React build. |
| `apps/rider/src/lib/tracking.ts` | Permission state machine + throttled send loop, talking to the background-geolocation plugin through a small internal interface (so the plugin is swappable). |
| `apps/rider/src/lib/tracking-plugin.ts` | The thin adapter over `@capacitor-community/background-geolocation` — the ONLY file that imports the plugin directly. |
| `apps/rider/src/api/resources.ts` | Gains `deliveriesApi.sendLocation` (existing file, additive edit). |
| `apps/rider/src/components/TrackingStatus.tsx` | The passive status readout (§13). |
| `apps/rider/src/pages/Delivery.tsx` | Wires tracking start/stop into the existing pickup/arrive/fail actions (existing file, additive edit). |
| `apps/rider/src/test/tracking.test.ts` | Tracking-module tests (plugin mocked, no real GPS). |
| `docs/06-deployment/map-tile-hosting-setup.md` | **REVISED 2026-09-19** (was `google-maps-setup.md`) — the required tile-hosting documentation (§D.11): OSM extract source, build tooling, hosting, attribution, no-key confirmation, and the OpenFreeMap fallback procedure. Written before any task that consumes it. |
| `apps/customer/.../pubspec.yaml` | Gains `maplibre_gl`, `geolocator`. |
| `apps/customer/.../android/app/src/main/AndroidManifest.xml` | Gains location permissions only (existing file, additive edit) — **no Maps API-key meta-data**, unlike the superseded Google Maps plan. |
| `apps/customer/.../lib/Models/order_model.dart` | Gains `deliveryLatitude`/`deliveryLongitude` (existing file, additive edit) — the destination marker source, already present in every order API response today. |
| `apps/customer/.../lib/Models/rider_location_model.dart` | The SSE payload model + freshness classification. |
| `apps/customer/.../lib/Services/Providers/location.provider.dart` | SSE client (Dio streaming GET), following the `OrderProvider` injectable-request convention. |
| `apps/customer/.../lib/UI/Widgets/Organisms/map_provider.dart` | Provider-neutral map contract (`GeoPoint`, `MapMarkerSpec`, `TrackingMapView`, `LocationPickerMapView`, §8.4) — never imports a map SDK. |
| `apps/customer/.../lib/UI/Widgets/Organisms/maplibre_map_view.dart` | The concrete MapLibre adapter — the ONLY file that imports `package:maplibre_gl/maplibre_gl.dart` directly (§8.4). |
| `apps/customer/.../lib/UI/Widgets/Organisms/order_tracking_map.dart` | `OrderTrackingMap`, built against `TrackingMapView`/`MapMarkerSpec` (never against `maplibre_gl` directly) — destination + rider markers, freshness treatment. |
| `apps/customer/.../lib/Screens/order_summary_screen.dart` | Inserts the tracking map, gated to the trackable window (existing file, additive edit). |
| `apps/customer/.../lib/Screens/live_location_picker_screen.dart` | New draggable-pin address-location picker, built against `LocationPickerMapView` (never against `maplibre_gl` directly). |
| `apps/customer/.../lib/Screens/add_edit_address_screen.dart` | Gains "Use current location" wired to the picker (existing file, additive edit). |
| `apps/customer/.../test/*` | New/updated tests per task, following this app's established fixture/fake-request patterns. |
| `apps/customer/.../integration_test/live_location_tracking_flow_test.dart` | The live E2E (§16). |

---

## Task B1: Migration 006 — latest-location columns on `deliveries`

**Files:** Create `backend/api/src/database/migrations/006_rider_location_tracking.sql`, `..._down.sql`; Modify `backend/api/src/database/types.ts`

**Interfaces — Produces:** `DeliveriesTable` gains `current_latitude: ColumnType<number, number|string, number|string> | null`, `current_longitude` (same), `location_accuracy_m: ColumnType<number, number|string, number|string> | null`, `location_captured_at: Date | null`, `location_received_at: Date | null`.

- [ ] **Step 1: Write the migration**, following the exact style of `001_initial_schema.sql`'s coordinate columns/checks:

```sql
-- 006_rider_location_tracking.sql
-- Latest-location-only columns for live rider tracking (plan
-- docs/superpowers/plans/2026-09-19-blynk-live-location-tracking.md §6, §D.5).
-- No history table: every write overwrites these five columns. No cleanup
-- job is needed because nothing here ever grows independently of `deliveries`
-- itself.
ALTER TABLE deliveries
  ADD COLUMN current_latitude NUMERIC(9, 6),
  ADD COLUMN current_longitude NUMERIC(9, 6),
  ADD COLUMN location_accuracy_m NUMERIC(7, 1),
  ADD COLUMN location_captured_at TIMESTAMPTZ,
  ADD COLUMN location_received_at TIMESTAMPTZ;

ALTER TABLE deliveries
  ADD CONSTRAINT chk_delivery_lat CHECK (current_latitude IS NULL OR current_latitude BETWEEN -90.0 AND 90.0),
  ADD CONSTRAINT chk_delivery_lon CHECK (current_longitude IS NULL OR current_longitude BETWEEN -180.0 AND 180.0),
  ADD CONSTRAINT chk_delivery_location_accuracy CHECK (location_accuracy_m IS NULL OR location_accuracy_m > 0.0);
```

```sql
-- 006_rider_location_tracking_down.sql
ALTER TABLE deliveries
  DROP CONSTRAINT IF EXISTS chk_delivery_lat,
  DROP CONSTRAINT IF EXISTS chk_delivery_lon,
  DROP CONSTRAINT IF EXISTS chk_delivery_location_accuracy;

ALTER TABLE deliveries
  DROP COLUMN IF EXISTS current_latitude,
  DROP COLUMN IF EXISTS current_longitude,
  DROP COLUMN IF EXISTS location_accuracy_m,
  DROP COLUMN IF EXISTS location_captured_at,
  DROP COLUMN IF EXISTS location_received_at;
```

- [ ] **Step 2: Apply and verify.** Run `npm run migrate:up` — confirm it applies cleanly against the dev DB. Run `npm run migrate:down` then `npm run migrate:up` again — confirm the round trip is clean (this migration's rollback safety, mirroring how Stage 1 verified `001_initial_schema.sql`'s round trip).

- [ ] **Step 3: Update `database/types.ts`** — in `DeliveriesTable` (currently ending `created_at: Generated<Date>; updated_at: Generated<Date>;`), add:

```ts
  current_latitude: ColumnType<number, number | string, number | string> | null;
  current_longitude: ColumnType<number, number | string, number | string> | null;
  location_accuracy_m: ColumnType<number, number | string, number | string> | null;
  location_captured_at: Date | null;
  location_received_at: Date | null;
```

- [ ] **Step 4: Verify.** `npm run typecheck` — clean.

- [ ] **Step 5: Commit.**

---

## Task B2: Rider location-write endpoint

**Files:** Create `backend/api/src/modules/riders/rider.location.schema.ts`, `rider.location.service.ts`; Modify `rider.repository.ts`, `rider.controller.ts`, `riders/index.ts`, `utils/metrics.ts`; Test `backend/api/tests/rider-location.test.ts`

**Interfaces — Consumes:** `riderRepository.findRiderByUserId` (existing). **Produces:** `riderLocationService.recordLocation(deliveryId, userId, input): Promise<{accepted: boolean; reason?: 'not_newer'|'rate_limited'}>`; route `POST {API_PREFIX}/riders/deliveries/:id/location` and `POST {API_PREFIX}/rider/deliveries/:id/location` (both, via the existing dual mount).

- [ ] **Step 1: Write the schema**, `rider.location.schema.ts`:

```ts
import { z } from 'zod';

/**
 * A rider's own reported position for one delivery (plan §5). Deliberately
 * carries no order_id/rider_id/customer_id/tracking status - those are all
 * derived server-side from the authenticated caller and the URL's delivery
 * id (plan §D.4), never trusted from the body.
 */
export const updateLocationSchema = z.object({
  latitude: z
    .number({ required_error: 'latitude is required', invalid_type_error: 'latitude must be a number' })
    .min(-90, 'Latitude must be between -90 and 90')
    .max(90, 'Latitude must be between -90 and 90'),
  longitude: z
    .number({ required_error: 'longitude is required', invalid_type_error: 'longitude must be a number' })
    .min(-180, 'Longitude must be between -180 and 180')
    .max(180, 'Longitude must be between -180 and 180'),
  accuracy: z
    .number({ required_error: 'accuracy is required', invalid_type_error: 'accuracy must be a number' })
    .positive('accuracy must be a positive number of meters'),
  captured_at: z
    .string({ required_error: 'captured_at is required' })
    .datetime({ message: 'captured_at must be an ISO 8601 timestamp' }),
});

export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;
```

- [ ] **Step 2: Add repository methods** to `rider.repository.ts` (append inside `RiderRepository`):

```ts
  /**
   * The one row a location write needs (plan §5.1, §5.2): this delivery,
   * owned by this rider, plus the parent order's status and this delivery's
   * own last-accepted point - all read in a single plain SELECT, no
   * FOR UPDATE. A location write never goes through lifecycle/engine.ts.
   */
  async findTrackableDelivery(deliveryId: string, riderId: string, executor: DBConnection = db) {
    return await executor
      .selectFrom('deliveries')
      .innerJoin('orders', 'orders.id', 'deliveries.order_id')
      .select([
        'deliveries.id',
        'deliveries.order_id',
        'deliveries.assignment_status',
        'deliveries.location_captured_at',
        'deliveries.location_received_at',
        'orders.order_status',
      ])
      .where('deliveries.id', '=', deliveryId)
      .where('deliveries.rider_id', '=', riderId)
      .executeTakeFirst();
  }

  /**
   * A single-row overwrite of the latest-location columns (plan §6). No
   * FOR UPDATE: Postgres MVCC already makes one row's UPDATE atomic, and this
   * never races against anything that needs stronger isolation (it never
   * touches order_status or assignment_status).
   */
  async writeLocation(
    deliveryId: string,
    input: { latitude: number; longitude: number; accuracy: number; capturedAt: Date },
    executor: DBConnection = db
  ) {
    const now = new Date();
    return await executor
      .updateTable('deliveries')
      .set({
        current_latitude: input.latitude,
        current_longitude: input.longitude,
        location_accuracy_m: input.accuracy,
        location_captured_at: input.capturedAt,
        location_received_at: now,
        updated_at: now,
      })
      .where('id', '=', deliveryId)
      .returning([
        'order_id',
        'current_latitude',
        'current_longitude',
        'location_accuracy_m',
        'location_captured_at',
        'location_received_at',
      ])
      .executeTakeFirstOrThrow();
  }
```

- [ ] **Step 3: Write the failing tests** in `backend/api/tests/rider-location.test.ts`. Follow `tests/rider-delivery.test.ts`'s exact setup style (seeded users/tokens via `generateAccessToken`, a real order walked through source→pack→assign→pickup via existing helpers/`runTransition`, cleanup in `afterAll`):

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { runTransition } from '../src/modules/orders/lifecycle/engine.js';

describe('Rider location updates', () => {
  const app = createApp();
  const customer = { id: 'a0000001-0000-0000-0000-000000000001', phone: '+94771234567', role: 'CUSTOMER' as const };
  const staff = { id: 'a0000001-0000-0000-0000-000000000004', phone: '+94774443322', role: 'PACKING_STAFF' as const };
  const admin = { id: 'a0000001-0000-0000-0000-000000000003', phone: '+94775551122', role: 'ADMIN' as const };
  const riderAUser = { id: 'a0000001-0000-0000-0000-000000000002', phone: '+94779876543', role: 'RIDER' as const };
  const riderBUser = { id: 'a0000009-0000-0000-0000-00000000000c', phone: '+94770009902', role: 'RIDER' as const };
  const RIDER_A = 'f0000001-0000-0000-0000-000000000001';
  const RIDER_B = 'f0000009-0000-0000-0000-00000000000c';
  const DARK_STORE = '018dc3f0-4a82-789a-8b1b-947f61ad8821';
  const MILK = 'b0000001-0000-0000-0000-000000000001';
  const tokens = {
    customer: generateAccessToken(customer),
    staff: generateAccessToken(staff),
    admin: generateAccessToken(admin),
    riderA: generateAccessToken(riderAUser),
    riderB: generateAccessToken(riderBUser),
  };
  const created: string[] = [];
  let addressId = '';

  beforeAll(async () => {
    await pool.query(`INSERT INTO users (id, phone, full_name, role) VALUES ($1,$2,'Test Rider B','RIDER') ON CONFLICT (phone) DO NOTHING`, [riderBUser.id, riderBUser.phone]);
    await pool.query(
      `INSERT INTO riders (id, user_id, dark_store_id, vehicle_registration_number, is_available, is_active)
       VALUES ($1,$2,$3,'TEST-LOC-0001',true,true) ON CONFLICT (id) DO NOTHING`,
      [RIDER_B, riderBUser.id, DARK_STORE]
    );
    const addr = await pool.query(
      `INSERT INTO customer_addresses (user_id, label, recipient_name, recipient_phone, address_line1, city, latitude, longitude, is_default)
       VALUES ($1,'Location test','Loc Test','+94771234567','No. 1, Test Lane','Dharga Town',6.4351,80.0243,false) RETURNING id`,
      [customer.id]
    );
    addressId = addr.rows[0].id;
  });
  afterAll(async () => {
    if (created.length) {
      await pool.query('DELETE FROM notifications WHERE order_id = ANY($1)', [created]);
      await pool.query('DELETE FROM deliveries WHERE order_id = ANY($1)', [created]);
      await pool.query('DELETE FROM payments WHERE order_id = ANY($1)', [created]);
      await pool.query('DELETE FROM orders WHERE id = ANY($1)', [created]);
    }
    await pool.query('DELETE FROM customer_addresses WHERE id = $1', [addressId]);
    await pool.query('DELETE FROM riders WHERE id = $1', [RIDER_B]);
    await pool.query('DELETE FROM users WHERE id = $1', [riderBUser.id]);
  });

  /** Places, sources, packs and assigns an order to RIDER_A, ready to pick up. */
  async function assignedOrder(riderId = RIDER_A, riderToken = tokens.riderA) {
    const placed = await request(app).post('/api/v1/orders').set('Authorization', `Bearer ${tokens.customer}`)
      .send({ address_id: addressId, items: [{ product_id: MILK, quantity: 1 }] });
    const orderId = placed.body.data.order.id as string;
    created.push(orderId);
    const items = await request(app).get(`/api/v1/admin/orders/${orderId}`).set('Authorization', `Bearer ${tokens.admin}`);
    for (const item of items.body.data.order.items) {
      await request(app).post(`/api/v1/admin/orders/${orderId}/items/${item.id}/source`).set('Authorization', `Bearer ${tokens.staff}`).send({ actual_unit_cost: 450 });
    }
    await request(app).patch(`/api/v1/admin/orders/${orderId}/status`).set('Authorization', `Bearer ${tokens.staff}`).send({ status: 'PACKED' });
    const assign = await request(app).post(`/api/v1/admin/orders/${orderId}/assign-rider`).set('Authorization', `Bearer ${tokens.admin}`).send({ rider_id: riderId });
    return { orderId, deliveryId: assign.body.data.delivery.id as string };
  }

  const point = (overrides: Partial<Record<'latitude' | 'longitude' | 'accuracy' | 'captured_at', unknown>> = {}) => ({
    latitude: 6.436, longitude: 80.026, accuracy: 12.5, captured_at: new Date().toISOString(), ...overrides,
  });

  const send = (deliveryId: string, token: string, body: unknown) =>
    request(app).post(`/api/v1/riders/deliveries/${deliveryId}/location`).set('Authorization', `Bearer ${token}`).send(body);

  it('accepts a location once the rider has picked up, not before (plan §D.1)', async () => {
    const { deliveryId } = await assignedOrder();
    const before = await send(deliveryId, tokens.riderA, point());
    expect(before.status).toBe(409);
    expect(before.body.error.code).toBe('DELIVERY_NOT_TRACKABLE');

    await request(app).patch(`/api/v1/riders/deliveries/${deliveryId}/status`).set('Authorization', `Bearer ${tokens.riderA}`).send({ status: 'PICKED_UP' });
    const after = await send(deliveryId, tokens.riderA, point());
    expect(after.status).toBe(202);
    expect(after.body.data.accepted).toBe(true);

    const row = await pool.query('SELECT current_latitude, current_longitude, location_accuracy_m, location_captured_at, location_received_at FROM deliveries WHERE id = $1', [deliveryId]);
    expect(Number(row.rows[0].current_latitude)).toBeCloseTo(6.436, 5);
    expect(row.rows[0].location_received_at).not.toBeNull();
  });

  it('rejects another rider submitting to this delivery (404, not 403 - plan §D.4)', async () => {
    const { deliveryId } = await assignedOrder();
    await request(app).patch(`/api/v1/riders/deliveries/${deliveryId}/status`).set('Authorization', `Bearer ${tokens.riderA}`).send({ status: 'PICKED_UP' });
    const res = await send(deliveryId, tokens.riderB, point());
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('DELIVERY_NOT_FOUND');
  });

  it('rejects a customer or unauthenticated caller', async () => {
    const { deliveryId } = await assignedOrder();
    const asCustomer = await request(app).post(`/api/v1/riders/deliveries/${deliveryId}/location`).set('Authorization', `Bearer ${tokens.customer}`).send(point());
    expect(asCustomer.status).toBe(403);
    const anon = await request(app).post(`/api/v1/riders/deliveries/${deliveryId}/location`).send(point());
    expect(anon.status).toBe(401);
  });

  it('rejects malformed and out-of-range coordinates', async () => {
    const { deliveryId } = await assignedOrder();
    await request(app).patch(`/api/v1/riders/deliveries/${deliveryId}/status`).set('Authorization', `Bearer ${tokens.riderA}`).send({ status: 'PICKED_UP' });
    for (const bad of [point({ latitude: 91 }), point({ longitude: -181 }), point({ accuracy: -1 }), point({ accuracy: 0 }), point({ latitude: 'x' })]) {
      const res = await send(deliveryId, tokens.riderA, bad);
      expect(res.status).toBe(400);
    }
  });

  it('rejects a captured_at far in the future, accepts one only slightly stale', async () => {
    const { deliveryId } = await assignedOrder();
    await request(app).patch(`/api/v1/riders/deliveries/${deliveryId}/status`).set('Authorization', `Bearer ${tokens.riderA}`).send({ status: 'PICKED_UP' });
    const future = await send(deliveryId, tokens.riderA, point({ captured_at: new Date(Date.now() + 5 * 60_000).toISOString() }));
    expect(future.status).toBe(400);
    const slightlyOld = await send(deliveryId, tokens.riderA, point({ captured_at: new Date(Date.now() - 30_000).toISOString() }));
    expect(slightlyOld.status).toBe(202);
    expect(slightlyOld.body.data.accepted).toBe(true);
  });

  it('a point no newer than the last accepted one is ignored, never regresses the stored position (duplicate/out-of-order)', async () => {
    const { deliveryId } = await assignedOrder();
    await request(app).patch(`/api/v1/riders/deliveries/${deliveryId}/status`).set('Authorization', `Bearer ${tokens.riderA}`).send({ status: 'PICKED_UP' });
    const t0 = new Date();
    await send(deliveryId, tokens.riderA, point({ latitude: 6.5, captured_at: t0.toISOString() }));
    // a small pause so the rate-limit floor (below) isn't what rejects this one
    await new Promise((r) => setTimeout(r, 5100));
    const older = await send(deliveryId, tokens.riderA, point({ latitude: 6.1, captured_at: new Date(t0.getTime() - 1000).toISOString() }));
    expect(older.status).toBe(202);
    expect(older.body.data.accepted).toBe(false);
    expect(older.body.data.reason).toBe('not_newer');
    const row = await pool.query('SELECT current_latitude FROM deliveries WHERE id = $1', [deliveryId]);
    expect(Number(row.rows[0].current_latitude)).toBeCloseTo(6.5, 3);
  });

  it('high-frequency submissions are throttled server-side, independent of the client (plan §D.6, §11)', async () => {
    const { deliveryId } = await assignedOrder();
    await request(app).patch(`/api/v1/riders/deliveries/${deliveryId}/status`).set('Authorization', `Bearer ${tokens.riderA}`).send({ status: 'PICKED_UP' });
    const first = await send(deliveryId, tokens.riderA, point());
    expect(first.body.data.accepted).toBe(true);
    const immediatelyAfter = await send(deliveryId, tokens.riderA, point({ captured_at: new Date(Date.now() + 1000).toISOString() }));
    expect(immediatelyAfter.status).toBe(202);
    expect(immediatelyAfter.body.data.accepted).toBe(false);
    expect(immediatelyAfter.body.data.reason).toBe('rate_limited');
  });

  it('rejects a location once arrived, delivered, or failed - every closed state (plan §D.2)', async () => {
    for (const close of ['arrive', 'fail'] as const) {
      const { deliveryId } = await assignedOrder();
      await request(app).patch(`/api/v1/riders/deliveries/${deliveryId}/status`).set('Authorization', `Bearer ${tokens.riderA}`).send({ status: 'PICKED_UP' });
      if (close === 'arrive') {
        await request(app).patch(`/api/v1/riders/deliveries/${deliveryId}/status`).set('Authorization', `Bearer ${tokens.riderA}`).send({ status: 'ARRIVED_AT_CUSTOMER' });
      } else {
        await request(app).patch(`/api/v1/riders/deliveries/${deliveryId}/status`).set('Authorization', `Bearer ${tokens.riderA}`).send({ status: 'FAILED', failure_reason: 'test' });
      }
      const res = await send(deliveryId, tokens.riderA, point());
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('DELIVERY_NOT_TRACKABLE');
    }
  });

  it('rejects a location for a cancelled order even though the delivery row is still ASSIGNED (plan §2.2 gotcha #1)', async () => {
    const { orderId, deliveryId } = await assignedOrder();
    await request(app).post(`/api/v1/orders/${orderId}/cancel`).set('Authorization', `Bearer ${tokens.customer}`).send({});
    const res = await send(deliveryId, tokens.riderA, point());
    expect(res.status).toBe(409);
  });

  it('re-stage creates a new delivery; the old FAILED delivery never accepts a location again (plan §2.2 gotcha #2, §D.3)', async () => {
    const { orderId, deliveryId: firstDeliveryId } = await assignedOrder();
    await request(app).patch(`/api/v1/riders/deliveries/${firstDeliveryId}/status`).set('Authorization', `Bearer ${tokens.riderA}`).send({ status: 'PICKED_UP' });
    await request(app).patch(`/api/v1/riders/deliveries/${firstDeliveryId}/status`).set('Authorization', `Bearer ${tokens.riderA}`).send({ status: 'FAILED', failure_reason: 'test' });
    await request(app).patch(`/api/v1/admin/orders/${orderId}/status`).set('Authorization', `Bearer ${tokens.admin}`).send({ status: 'PACKED', notes: 'restage' });
    const reassign = await request(app).post(`/api/v1/admin/orders/${orderId}/assign-rider`).set('Authorization', `Bearer ${tokens.admin}`).send({ rider_id: RIDER_A });
    const secondDeliveryId = reassign.body.data.delivery.id as string;
    expect(secondDeliveryId).not.toBe(firstDeliveryId);

    const toOld = await send(firstDeliveryId, tokens.riderA, point());
    expect(toOld.status).toBe(409);

    await request(app).patch(`/api/v1/riders/deliveries/${secondDeliveryId}/status`).set('Authorization', `Bearer ${tokens.riderA}`).send({ status: 'PICKED_UP' });
    const toNew = await send(secondDeliveryId, tokens.riderA, point());
    expect(toNew.status).toBe(202);
    expect(toNew.body.data.accepted).toBe(true);
  });

  it('concurrent writes to the same delivery do not corrupt or deadlock (5 reps)', async () => {
    for (let i = 0; i < 5; i++) {
      const { deliveryId } = await assignedOrder();
      await request(app).patch(`/api/v1/riders/deliveries/${deliveryId}/status`).set('Authorization', `Bearer ${tokens.riderA}`).send({ status: 'PICKED_UP' });
      const [a, b] = await Promise.all([
        send(deliveryId, tokens.riderA, point({ latitude: 6.40, captured_at: new Date(Date.now() + 100).toISOString() })),
        send(deliveryId, tokens.riderA, point({ latitude: 6.41, captured_at: new Date(Date.now() + 200).toISOString() })),
      ]);
      expect([a.status, b.status]).toEqual([202, 202]);
    }
  });
});
```

- [ ] **Step 4:** `npx vitest run tests/rider-location.test.ts` → FAIL (`riderLocationService` doesn't exist, route 404s).

- [ ] **Step 5: Implement `rider.location.service.ts`:**

```ts
import { riderRepository } from './rider.repository.js';
import { AppError } from '../../middleware/error.middleware.js';
import { broadcastLocation } from '../realtime/location-stream.js';
import { metrics } from '../../utils/metrics.js';
import type { UpdateLocationInput } from './rider.location.schema.js';

/** No two accepted writes closer together than this, per delivery (plan §5.3, §D.6). */
export const MIN_LOCATION_INTERVAL_MS = 5_000;
/** A capture more than this far in the future is a clock-skew problem, not a real point. */
const MAX_FUTURE_SKEW_MS = 60_000;
/** Older than this, a point is still accepted and stored but not broadcast live (plan §5.1). */
const STALE_BROADCAST_THRESHOLD_MS = 5 * 60_000;

export type RecordLocationResult =
  | { accepted: true }
  | { accepted: false; reason: 'not_newer' | 'rate_limited' };

/**
 * Records one rider-reported position for one delivery (plan §5). This is
 * deliberately NOT a lifecycle action: it never imports lifecycle/engine.ts,
 * lifecycle/catalogue.ts or lifecycle/actions/* (plan §D.5), and its only
 * database effect is overwriting the five latest-location columns - it can
 * never change order_status or assignment_status.
 */
export class RiderLocationService {
  private async getRiderOrThrow(userId: string) {
    const rider = await riderRepository.findRiderByUserId(userId);
    if (!rider) throw new AppError('Rider profile not found for this user account.', 403, 'RIDER_PROFILE_NOT_FOUND');
    if (!rider.is_active) throw new AppError('This rider profile is inactive.', 403, 'RIDER_INACTIVE');
    return rider;
  }

  async recordLocation(deliveryId: string, userId: string, input: UpdateLocationInput): Promise<RecordLocationResult> {
    const rider = await this.getRiderOrThrow(userId);

    const delivery = await riderRepository.findTrackableDelivery(deliveryId, rider.id);
    if (!delivery) {
      throw new AppError('Delivery assignment not found.', 404, 'DELIVERY_NOT_FOUND');
    }
    // The trackable window (plan §2.3, §D.1): PICKED_UP and the order still
    // OUT_FOR_DELIVERY, checked fresh against the DB every time - never
    // cached, and independently covers a cancelled order that left this
    // delivery row ASSIGNED (plan §2.2 gotcha #1) because that state is
    // neither PICKED_UP nor OUT_FOR_DELIVERY.
    if (delivery.assignment_status !== 'PICKED_UP' || delivery.order_status !== 'OUT_FOR_DELIVERY') {
      throw new AppError('This delivery is not currently trackable.', 409, 'DELIVERY_NOT_TRACKABLE', {
        assignment_status: delivery.assignment_status,
        order_status: delivery.order_status,
      });
    }

    const capturedAt = new Date(input.captured_at);
    const nowMs = Date.now();
    if (capturedAt.getTime() - nowMs > MAX_FUTURE_SKEW_MS) {
      throw new AppError('captured_at is too far in the future.', 400, 'VALIDATION_ERROR', [
        { path: ['captured_at'], message: 'timestamp is ahead of the server clock' },
      ]);
    }

    // Out-of-order or duplicate: a point no newer than what is already
    // stored must never regress the customer's map backward (plan §11).
    if (delivery.location_captured_at && capturedAt.getTime() <= delivery.location_captured_at.getTime()) {
      metrics.locationUpdatesRejected('not_newer');
      return { accepted: false, reason: 'not_newer' };
    }

    // Server-side rate floor, independent of the rider app's own throttle
    // (plan §5.3, §D.6) - abuse protection that doesn't trust the client.
    if (delivery.location_received_at && nowMs - delivery.location_received_at.getTime() < MIN_LOCATION_INTERVAL_MS) {
      metrics.locationUpdatesRejected('rate_limited');
      return { accepted: false, reason: 'rate_limited' };
    }

    const updated = await riderRepository.writeLocation(deliveryId, {
      latitude: input.latitude,
      longitude: input.longitude,
      accuracy: input.accuracy,
      capturedAt,
    });
    metrics.locationUpdatesReceived();

    const isStale = nowMs - capturedAt.getTime() > STALE_BROADCAST_THRESHOLD_MS;
    if (!isStale) {
      broadcastLocation(updated.order_id, {
        latitude: Number(updated.current_latitude),
        longitude: Number(updated.current_longitude),
        accuracy: Number(updated.location_accuracy_m),
        captured_at: updated.location_captured_at!.toISOString(),
        received_at: updated.location_received_at!.toISOString(),
      });
    }

    return { accepted: true };
  }
}

export const riderLocationService = new RiderLocationService();
```

- [ ] **Step 6: Wire the controller and route.** In `rider.controller.ts`, add:

```ts
  async updateLocation(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = deliveryParamsSchema.parse(req.params);
      const input = updateLocationSchema.parse(req.body);
      const result = await riderLocationService.recordLocation(id, req.user!.id, input);
      res.status(202).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
```

with `import { updateLocationSchema } from './rider.location.schema.js';` and `import { riderLocationService } from './rider.location.service.js';` added to the file's imports. In `riders/index.ts`, add:

```ts
ridersRouter.post(
  '/deliveries/:id/location',
  requireAuth,
  requireRoles('RIDER'),
  riderController.updateLocation.bind(riderController)
);
```

- [ ] **Step 7: Add the three metrics counters** to `utils/metrics.ts`'s existing grouped-counter pattern: `locationUpdatesReceived()`, `locationUpdatesRejected(reason: 'not_newer' | 'rate_limited')` — follow the exact style of the existing `orders`/`notifications` counter groups (plain increments, no PII, per the module's own documented rule).

- [ ] **Step 8:** `npx vitest run tests/rider-location.test.ts` → all passing. `npx vitest run tests/order-lifecycle.test.ts tests/rider-delivery.test.ts` → unchanged, still passing (confirms this task never touched the lifecycle engine's behaviour). `npm run typecheck` → clean.

- [ ] **Step 9: Commit.**

---

## Task B3: In-process location broadcaster

**Files:** Create `backend/api/src/modules/realtime/location-stream.ts`; Test `backend/api/tests/location-stream.test.ts` (unit-test the broadcaster in isolation here; the HTTP-level stream tests are Task B4)

**Interfaces — Produces:** `subscribe(orderId, res): () => void`; `broadcastLocation(orderId, event): void`; `subscriberCount(orderId): number`; `closeAllStreams(): void`; `interface LocationEvent { latitude, longitude, accuracy, captured_at, received_at }`.

- [ ] **Step 1: Write the failing tests** (a fake Express `Response` — just needs `write`/`end`):

```ts
import { describe, it, expect, vi } from 'vitest';
import { subscribe, broadcastLocation, subscriberCount, closeAllStreams, type LocationEvent } from '../src/modules/realtime/location-stream.js';

function fakeRes() {
  return { write: vi.fn(), end: vi.fn() } as unknown as import('express').Response;
}

const EVENT: LocationEvent = { latitude: 6.4, longitude: 80.0, accuracy: 10, captured_at: '2026-09-19T10:00:00.000Z', received_at: '2026-09-19T10:00:01.000Z' };

describe('location-stream broadcaster', () => {
  it('delivers a broadcast to every subscriber of that order, and no other order', () => {
    const a = fakeRes();
    const b = fakeRes();
    const unsubA = subscribe('order-1', a);
    subscribe('order-2', b);
    broadcastLocation('order-1', EVENT);
    expect(a.write).toHaveBeenCalledWith(expect.stringContaining('"latitude":6.4'));
    expect(b.write).not.toHaveBeenCalled();
    unsubA();
  });

  it('unsubscribing stops further broadcasts and cleans up empty order entries', () => {
    const a = fakeRes();
    const unsub = subscribe('order-3', a);
    expect(subscriberCount('order-3')).toBe(1);
    unsub();
    expect(subscriberCount('order-3')).toBe(0);
    broadcastLocation('order-3', EVENT);
    expect(a.write).not.toHaveBeenCalled();
  });

  it('broadcasting to an order with no subscribers is a harmless no-op', () => {
    expect(() => broadcastLocation('order-nobody', EVENT)).not.toThrow();
  });

  it('a second subscriber to the same order gets its own broadcasts, independent of the first', () => {
    const a = fakeRes();
    const b = fakeRes();
    subscribe('order-4', a);
    subscribe('order-4', b);
    broadcastLocation('order-4', EVENT);
    expect(a.write).toHaveBeenCalledTimes(1);
    expect(b.write).toHaveBeenCalledTimes(1);
  });

  it('closeAllStreams ends every open connection and clears the registry', () => {
    const a = fakeRes();
    subscribe('order-5', a);
    closeAllStreams();
    expect(a.write).toHaveBeenCalledWith(expect.stringContaining('server_shutdown'));
    expect(a.end).toHaveBeenCalled();
    expect(subscriberCount('order-5')).toBe(0);
  });
});
```

- [ ] **Step 2:** `npx vitest run tests/location-stream.test.ts` → FAIL (module doesn't exist).

- [ ] **Step 3: Implement:**

```ts
import type { Response } from 'express';

export interface LocationEvent {
  latitude: number;
  longitude: number;
  accuracy: number;
  captured_at: string;
  received_at: string;
}

/**
 * order_id -> the open SSE responses currently subscribed to it. In-process
 * only (plan §7): correct today because the api service runs as a single
 * container (confirmed via docker-compose.yml). Documented requirement: this
 * must move to a shared broker (Redis pub/sub, or Postgres LISTEN/NOTIFY)
 * before the api service is ever scaled to more than one replica.
 */
const subscribers = new Map<string, Set<Response>>();

function writeEvent(res: Response, event: 'location' | 'closed', data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function subscribe(orderId: string, res: Response): () => void {
  let set = subscribers.get(orderId);
  if (!set) {
    set = new Set();
    subscribers.set(orderId, set);
  }
  set.add(res);
  return () => {
    set!.delete(res);
    if (set!.size === 0) subscribers.delete(orderId);
  };
}

export function broadcastLocation(orderId: string, event: LocationEvent): void {
  const set = subscribers.get(orderId);
  if (!set || set.size === 0) return;
  for (const res of set) writeEvent(res, 'location', event);
}

export function writeLocationEvent(res: Response, event: LocationEvent): void {
  writeEvent(res, 'location', event);
}

export function writeClosedEvent(res: Response, reason: 'not_trackable' | 'delivery_closed' | 'server_shutdown'): void {
  writeEvent(res, 'closed', { reason });
}

export function subscriberCount(orderId: string): number {
  return subscribers.get(orderId)?.size ?? 0;
}

/** Called once during graceful shutdown (server.ts) so server.close() never
 * waits on a long-lived SSE connection that would otherwise never end. */
export function closeAllStreams(): void {
  for (const [orderId, set] of subscribers) {
    for (const res of set) {
      try {
        writeClosedEvent(res, 'server_shutdown');
        res.end();
      } catch {
        // Best-effort during shutdown; a socket that's already gone is fine.
      }
    }
    subscribers.delete(orderId);
  }
}
```

- [ ] **Step 4:** `npx vitest run tests/location-stream.test.ts` → all passing. `npm run typecheck` → clean.

- [ ] **Step 5: Commit.**

---

## Task B4: Customer SSE stream endpoint

**Files:** Create `backend/api/src/modules/orders/order.location.controller.ts`; Modify `order.repository.ts`, `orders/index.ts`, `server.ts`, `utils/metrics.ts`; Test append to `backend/api/tests/location-stream.test.ts`

**Interfaces — Consumes:** `subscribe`, `writeLocationEvent`, `writeClosedEvent` from Task B3. **Produces:** route `GET {API_PREFIX}/orders/:id/location/stream`.

- [ ] **Step 1: Add the repository method** to `order.repository.ts`:

```ts
  /**
   * The one row the live-tracking stream needs (plan §7, §9): ownership plus
   * the current delivery's position, only while the trackable window (plan
   * §2.3 - PICKED_UP with the order OUT_FOR_DELIVERY) is open. A re-staged
   * order's old FAILED delivery can never match this query, by construction
   * (plan §2.2 gotcha #2) - at most one delivery row can be PICKED_UP at a
   * time per uq_deliveries_active_assignment.
   */
  async findTrackableLocationForCustomer(orderId: string, customerId: string, executor: DBConnection = db) {
    return await executor
      .selectFrom('orders')
      .innerJoin('deliveries', 'deliveries.order_id', 'orders.id')
      .select([
        'deliveries.current_latitude',
        'deliveries.current_longitude',
        'deliveries.location_accuracy_m',
        'deliveries.location_captured_at',
        'deliveries.location_received_at',
      ])
      .where('orders.id', '=', orderId)
      .where('orders.customer_id', '=', customerId)
      .where('deliveries.assignment_status', '=', 'PICKED_UP')
      .where('orders.order_status', '=', 'OUT_FOR_DELIVERY')
      .executeTakeFirst();
  }
```

- [ ] **Step 2: Write the failing tests** (raw `http` client against `app.listen(0)`, since the stream is genuinely long-lived — supertest buffers and can't observe multiple discrete SSE frames cleanly):

```ts
// append to backend/api/tests/location-stream.test.ts
import http from 'http';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';

describe('Customer location stream (HTTP)', () => {
  const app = createApp();
  let server: http.Server;
  let baseUrl: string;
  const customer = { id: 'a0000001-0000-0000-0000-000000000001', phone: '+94771234567', role: 'CUSTOMER' as const };
  const customerB = { id: 'a0000005-0000-0000-0000-000000000005', phone: '+94771119999', role: 'CUSTOMER' as const };
  const admin = { id: 'a0000001-0000-0000-0000-000000000003', phone: '+94775551122', role: 'ADMIN' as const };
  const staff = { id: 'a0000001-0000-0000-0000-000000000004', phone: '+94774443322', role: 'PACKING_STAFF' as const };
  const riderAUser = { id: 'a0000001-0000-0000-0000-000000000002', phone: '+94779876543', role: 'RIDER' as const };
  const RIDER_A = 'f0000001-0000-0000-0000-000000000001';
  const MILK = 'b0000001-0000-0000-0000-000000000001';
  const tokens = { customer: generateAccessToken(customer), customerB: generateAccessToken(customerB), admin: generateAccessToken(admin), staff: generateAccessToken(staff), riderA: generateAccessToken(riderAUser) };
  const created: string[] = [];
  let addressId = '';

  beforeAll(async () => {
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    const addr = server.address();
    baseUrl = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : '';
    const a = await pool.query(
      `INSERT INTO customer_addresses (user_id, label, recipient_name, recipient_phone, address_line1, city, latitude, longitude, is_default)
       VALUES ($1,'Stream test','Stream Test','+94771234567','No. 1, Test Lane','Dharga Town',6.4351,80.0243,false) RETURNING id`,
      [customer.id]
    );
    addressId = a.rows[0].id;
  });
  afterAll(async () => {
    server.close();
    if (created.length) {
      await pool.query('DELETE FROM notifications WHERE order_id = ANY($1)', [created]);
      await pool.query('DELETE FROM deliveries WHERE order_id = ANY($1)', [created]);
      await pool.query('DELETE FROM payments WHERE order_id = ANY($1)', [created]);
      await pool.query('DELETE FROM orders WHERE id = ANY($1)', [created]);
    }
    await pool.query('DELETE FROM customer_addresses WHERE id = $1', [addressId]);
  });

  /** Places+sources+packs+assigns+picks up, returns the order id and delivery id, ready to send locations. */
  async function trackableOrder() {
    const request = (await import('supertest')).default;
    const placed = await request(app).post('/api/v1/orders').set('Authorization', `Bearer ${tokens.customer}`).send({ address_id: addressId, items: [{ product_id: MILK, quantity: 1 }] });
    const orderId = placed.body.data.order.id as string;
    created.push(orderId);
    const detail = await request(app).get(`/api/v1/admin/orders/${orderId}`).set('Authorization', `Bearer ${tokens.admin}`);
    for (const item of detail.body.data.order.items) {
      await request(app).post(`/api/v1/admin/orders/${orderId}/items/${item.id}/source`).set('Authorization', `Bearer ${tokens.staff}`).send({ actual_unit_cost: 450 });
    }
    await request(app).patch(`/api/v1/admin/orders/${orderId}/status`).set('Authorization', `Bearer ${tokens.staff}`).send({ status: 'PACKED' });
    const assign = await request(app).post(`/api/v1/admin/orders/${orderId}/assign-rider`).set('Authorization', `Bearer ${tokens.admin}`).send({ rider_id: RIDER_A });
    const deliveryId = assign.body.data.delivery.id as string;
    await request(app).patch(`/api/v1/riders/deliveries/${deliveryId}/status`).set('Authorization', `Bearer ${tokens.riderA}`).send({ status: 'PICKED_UP' });
    return { orderId, deliveryId };
  }

  /** Opens the stream, reads text frames until `until` returns true or a 3s timeout, then aborts. */
  function readStream(orderId: string, token: string, until: (raw: string) => boolean): Promise<string> {
    return new Promise((resolve, reject) => {
      let raw = '';
      const req = http.get(`${baseUrl}/api/v1/orders/${orderId}/location/stream`, { headers: { Authorization: `Bearer ${token}` } }, (res) => {
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
          if (until(raw)) {
            req.destroy();
            resolve(raw);
          }
        });
        res.on('end', () => resolve(raw));
      });
      req.on('error', (err) => { if ((err as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(err); else resolve(raw); });
      setTimeout(() => { req.destroy(); resolve(raw); }, 3000);
    });
  }

  it('sends the current location immediately on connect, then a live broadcast', async () => {
    const { orderId, deliveryId } = await trackableOrder();
    const request = (await import('supertest')).default;
    await request(app).post(`/api/v1/riders/deliveries/${deliveryId}/location`).set('Authorization', `Bearer ${tokens.riderA}`).send({ latitude: 6.44, longitude: 80.03, accuracy: 8, captured_at: new Date().toISOString() });

    const streamPromise = readStream(orderId, tokens.customer, (raw) => raw.includes('"6.44"') || raw.includes('6.44'));
    const raw = await streamPromise;
    expect(raw).toContain('event: location');
  });

  it('a second customer cannot open the first customer\'s stream (404)', async () => {
    const { orderId } = await trackableOrder();
    const res = await new Promise<number>((resolve) => {
      http.get(`${baseUrl}/api/v1/orders/${orderId}/location/stream`, { headers: { Authorization: `Bearer ${tokens.customerB}` } }, (r) => resolve(r.statusCode ?? 0));
    });
    expect(res).toBe(404);
  });

  it('closes the stream once the delivery arrives (no longer trackable)', async () => {
    const { orderId, deliveryId } = await trackableOrder();
    const request = (await import('supertest')).default;
    const streamP = readStream(orderId, tokens.customer, (raw) => raw.includes('event: closed'));
    await new Promise((r) => setTimeout(r, 200));
    await request(app).patch(`/api/v1/riders/deliveries/${deliveryId}/status`).set('Authorization', `Bearer ${tokens.riderA}`).send({ status: 'ARRIVED_AT_CUSTOMER' });
    const raw = await streamP;
    expect(raw).toContain('event: closed');
  }, 20_000);

  it('an already-arrived order refuses a new stream connection outright', async () => {
    const { orderId, deliveryId } = await trackableOrder();
    const request = (await import('supertest')).default;
    await request(app).patch(`/api/v1/riders/deliveries/${deliveryId}/status`).set('Authorization', `Bearer ${tokens.riderA}`).send({ status: 'ARRIVED_AT_CUSTOMER' });
    const raw = await readStream(orderId, tokens.customer, (raw) => raw.includes('event: closed'));
    expect(raw).toContain('not_trackable');
  });
});
```

(Note: `readStream`'s exact byte-matching (`'"6.44"'`) may need a small adjustment once real output is observed — the implementer should assert on the actual serialized JSON, this is illustrative of the technique, not a literal guarantee of the exact string shape.)

- [ ] **Step 3:** `npx vitest run tests/location-stream.test.ts` → the new tests FAIL (404 for the whole route).

- [ ] **Step 4: Implement `order.location.controller.ts`:**

```ts
import { Request, Response, NextFunction } from 'express';
import { orderRepository } from './order.repository.js';
import { subscribe, writeLocationEvent, writeClosedEvent, type LocationEvent } from '../realtime/location-stream.js';
import { metrics } from '../../utils/metrics.js';

/** How often an open stream re-checks whether its order is still trackable
 * (plan §7): the stream closes within one interval of the actual state
 * change, not instantly - a documented, bounded latency, not a defect. */
const HEARTBEAT_MS = 15_000;

function toEvent(row: {
  current_latitude: unknown;
  current_longitude: unknown;
  location_accuracy_m: unknown;
  location_captured_at: Date | null;
  location_received_at: Date | null;
}): LocationEvent | null {
  if (row.current_latitude == null || row.location_captured_at == null || row.location_received_at == null) return null;
  return {
    latitude: Number(row.current_latitude),
    longitude: Number(row.current_longitude),
    accuracy: Number(row.location_accuracy_m),
    captured_at: row.location_captured_at.toISOString(),
    received_at: row.location_received_at.toISOString(),
  };
}

/**
 * GET /orders/:id/location/stream - the customer's own live rider location,
 * and nothing else's (plan §9). Ownership is checked once at connect and
 * re-checked, along with the trackable window, on every heartbeat.
 */
export async function streamOrderLocation(req: Request, res: Response, next: NextFunction) {
  try {
    const orderId = req.params.id;
    const order = await orderRepository.findOrderById(orderId, req.user!.id);
    if (!order) {
      res.status(404).json({ success: false, error: { code: 'ORDER_NOT_FOUND', message: 'Order not found.' } });
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    let closed = false;
    let unsubscribe: (() => void) | null = null;

    const end = (reason: 'not_trackable' | 'delivery_closed') => {
      if (closed) return;
      closed = true;
      writeClosedEvent(res, reason);
      res.end();
      metrics.streamsClosed(reason);
    };

    const row = await orderRepository.findTrackableLocationForCustomer(orderId, req.user!.id);
    if (!row) {
      end('not_trackable');
      return;
    }
    const initial = toEvent(row);
    if (initial) writeLocationEvent(res, initial);
    unsubscribe = subscribe(orderId, res);
    metrics.streamsOpened();

    const heartbeat = setInterval(async () => {
      if (closed) return;
      const stillTrackable = await orderRepository.findTrackableLocationForCustomer(orderId, req.user!.id);
      if (!stillTrackable) {
        clearInterval(heartbeat);
        unsubscribe?.();
        end('delivery_closed');
        return;
      }
      res.write(': heartbeat\n\n');
    }, HEARTBEAT_MS);

    req.on('close', () => {
      closed = true;
      clearInterval(heartbeat);
      unsubscribe?.();
    });
  } catch (err) {
    next(err);
  }
}
```

- [ ] **Step 5: Wire the route.** In `orders/index.ts`, add:

```ts
ordersRouter.get('/:id/location/stream', requireAuth, requireRoles('CUSTOMER'), streamOrderLocation);
```

(with the matching imports; `requireRoles` is the existing `middleware/role.middleware.ts` export already used elsewhere.)

- [ ] **Step 6: Tune `server.ts`** — after `const server = app.listen(...)`, add:

```ts
  // Long-lived SSE connections (order location streams) need this raised
  // above Node's short defaults; headersTimeout must stay above
  // keepAliveTimeout (Node's own documented requirement).
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
```

and in the `shutdown` function, before `server.close(...)`:

```ts
    const { closeAllStreams } = await import('./modules/realtime/location-stream.js');
    closeAllStreams();
```

- [ ] **Step 7: Add `streamsOpened()`/`streamsClosed(reason)` counters** to `utils/metrics.ts`, same style as Step 7 of Task B2.

- [ ] **Step 8:** `npx vitest run tests/location-stream.test.ts` → all passing. Full suite `npx vitest run` → unchanged elsewhere. `npm run typecheck` → clean. `npm run test:hygiene` → every row identical after the run (these tests create and clean up their own orders/addresses, matching every other integration test's convention).

- [ ] **Step 9: Commit.**

---

## Task B5: Backend verification checkpoint

**Files:** none (verification only)

- [ ] Run `npm run typecheck`, `npm test` (full suite), `npm run test:hygiene`, `npm run build` — all must pass before any Rider-app or Customer-app task begins consuming these endpoints. Report exact counts.
- [ ] Confirm by grep: `rider.location.service.ts` and `order.location.controller.ts` contain no import of anything under `modules/orders/lifecycle/` (Global Constraint, §D.5) — this is a mechanical, zero-ambiguity check to run now, not leave to the final review.

---

## Task R1: Capacitor Android scaffolding

**Files:** Create `apps/rider/capacitor.config.ts`, `apps/rider/android/` (generated); Modify `apps/rider/package.json`

This task is native platform scaffolding, not app logic — there is no meaningful failing test for "does an Android manifest permission exist," so verification here is a build/inspection step, not TDD. Every value below is exact, not a placeholder.

- [ ] **Step 1:** `npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor-community/background-geolocation` in `apps/rider`.

- [ ] **Step 2:** `npx cap init "Blynk Rider" "lk.blynk.rider" --web-dir=dist` — creates `capacitor.config.ts`:

```ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'lk.blynk.rider',
  appName: 'Blynk Rider',
  webDir: 'dist',
};

export default config;
```

- [ ] **Step 3:** `npm run build` (produces `dist/`), then `npx cap add android` — generates `apps/rider/android/`.

- [ ] **Step 4: Add permissions** to `android/app/src/main/AndroidManifest.xml` (inside `<manifest>`, before `<application>`):

```xml
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
    <uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
```

Follow `@capacitor-community/background-geolocation`'s own Android setup instructions for the plugin's required `<service>` declaration and foreground-service notification config (channel id, icon, title/text resource strings) — copy its documented block exactly rather than hand-rolling one, since the plugin's manifest requirements are version-specific and the plugin's own README is the source of truth at implementation time.

- [ ] **Step 5: Verify.** `npx cap sync android`, then `cd android && ./gradlew assembleDebug` (or open in Android Studio and build) — the build must succeed and produce an installable debug APK. Install on a device/emulator, launch, confirm the app loads the existing React UI unchanged (this step introduces no app-code change yet, only the native wrapper).

- [ ] **Step 6: Commit** (the generated `android/` directory is checked in, following Capacitor's own convention — it is not a build artifact, it's the native project source).

---

## Task R2: Tracking module (permission state machine + throttled send loop)

**Files:** Create `apps/rider/src/lib/tracking-plugin.ts`, `apps/rider/src/lib/tracking.ts`; Test `apps/rider/src/test/tracking.test.ts`

**Interfaces — Produces:**
```ts
// tracking-plugin.ts - the ONLY file that imports the Capacitor plugin directly
export type TrackingPermissionState = 'not_requested' | 'requesting' | 'granted' | 'denied' | 'unavailable';
export interface TrackingPoint { latitude: number; longitude: number; accuracy: number; capturedAt: Date }
export interface TrackingPlugin {
  checkPermission(): Promise<TrackingPermissionState>;
  requestPermission(): Promise<TrackingPermissionState>;
  start(onPoint: (p: TrackingPoint) => void, onError: (code: 'permission_denied' | 'position_unavailable') => void): Promise<void>;
  stop(): Promise<void>;
}
export const capacitorTrackingPlugin: TrackingPlugin;

// tracking.ts
export interface TrackingState {
  permission: TrackingPermissionState;
  active: boolean;
  lastSentAt: Date | null;
  lastError: 'permission_denied' | 'position_unavailable' | 'network' | null;
}
export class DeliveryTracker {
  constructor(plugin: TrackingPlugin, send: (deliveryId: string, point: TrackingPoint) => Promise<void>);
  getState(): TrackingState;
  subscribe(listener: (state: TrackingState) => void): () => void;
  start(deliveryId: string): Promise<void>;
  stop(): Promise<void>;
}
```

- [ ] **Step 1: Write the failing tests**, with a fake `TrackingPlugin` (no real Capacitor/GPS involved — satisfies §D.14: the app code under test never knows the difference between this fake and the real plugin):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeliveryTracker } from '../lib/tracking';
import type { TrackingPlugin, TrackingPoint } from '../lib/tracking-plugin';

function fakePlugin(): TrackingPlugin & { emit(p: TrackingPoint): void; emitError(code: 'permission_denied' | 'position_unavailable'): void } {
  let onPoint: (p: TrackingPoint) => void = () => {};
  let onError: (code: 'permission_denied' | 'position_unavailable') => void = () => {};
  let permission: 'not_requested' | 'requesting' | 'granted' | 'denied' | 'unavailable' = 'not_requested';
  return {
    async checkPermission() { return permission; },
    async requestPermission() { permission = 'granted'; return permission; },
    async start(op, oe) { onPoint = op; onError = oe; },
    async stop() {},
    emit(p) { onPoint(p); },
    emitError(code) { onError(code); },
  };
}

describe('DeliveryTracker', () => {
  let plugin: ReturnType<typeof fakePlugin>;
  let send: ReturnType<typeof vi.fn>;
  let tracker: DeliveryTracker;

  beforeEach(() => {
    plugin = fakePlugin();
    send = vi.fn().mockResolvedValue(undefined);
    tracker = new DeliveryTracker(plugin, send);
  });

  it('requests permission and starts the plugin on start()', async () => {
    await tracker.start('delivery-1');
    expect(tracker.getState().permission).toBe('granted');
    expect(tracker.getState().active).toBe(true);
  });

  it('sends a point through the throttle and records lastSentAt', async () => {
    await tracker.start('delivery-1');
    plugin.emit({ latitude: 6.4, longitude: 80.0, accuracy: 10, capturedAt: new Date() });
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith('delivery-1', expect.objectContaining({ latitude: 6.4 })));
    expect(tracker.getState().lastSentAt).not.toBeNull();
  });

  it('suppresses a duplicate point that arrives before the minimum interval', async () => {
    await tracker.start('delivery-1');
    const p1 = { latitude: 6.4, longitude: 80.0, accuracy: 10, capturedAt: new Date() };
    plugin.emit(p1);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    plugin.emit({ ...p1, capturedAt: new Date(p1.capturedAt.getTime() + 500) }); // 0.5s later, under the interval
    await new Promise((r) => setTimeout(r, 50));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('sends anyway once the max interval elapses, even if stationary', async () => {
    vi.useFakeTimers();
    await tracker.start('delivery-1');
    const p1 = { latitude: 6.4, longitude: 80.0, accuracy: 10, capturedAt: new Date() };
    plugin.emit(p1);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    vi.advanceTimersByTime(11_000);
    plugin.emit({ ...p1, capturedAt: new Date(Date.now()) });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    vi.useRealTimers();
  });

  it('reports position_unavailable without crashing, does not mark lastSentAt', async () => {
    await tracker.start('delivery-1');
    plugin.emitError('position_unavailable');
    expect(tracker.getState().lastError).toBe('position_unavailable');
    expect(tracker.getState().active).toBe(true); // still trying, not torn down
  });

  it('a failed send is not treated as success - lastSentAt does not advance', async () => {
    send.mockRejectedValueOnce(new Error('network'));
    await tracker.start('delivery-1');
    plugin.emit({ latitude: 6.4, longitude: 80.0, accuracy: 10, capturedAt: new Date() });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(tracker.getState().lastSentAt).toBeNull();
    expect(tracker.getState().lastError).toBe('network');
  });

  it('stop() calls the plugin\'s stop and marks inactive', async () => {
    await tracker.start('delivery-1');
    await tracker.stop();
    expect(tracker.getState().active).toBe(false);
  });

  it('notifies subscribers on every state change', async () => {
    const states: unknown[] = [];
    tracker.subscribe((s) => states.push(s.active));
    await tracker.start('delivery-1');
    await tracker.stop();
    expect(states).toContain(true);
    expect(states).toContain(false);
  });
});
```

- [ ] **Step 2:** `npx vitest run src/test/tracking.test.ts` → FAIL.

- [ ] **Step 3: Implement `tracking-plugin.ts`** (the real Capacitor adapter — implementer fills in the exact `@capacitor-community/background-geolocation` API calls per that plugin's documented interface at implementation time; the shape below is the contract the rest of the app is written against):

```ts
import type { TrackingPermissionState, TrackingPoint, TrackingPlugin } from './tracking-types'; // or co-located in this file

// Real implementation wraps @capacitor-community/background-geolocation's
// addWatcher/removeWatcher and permission APIs behind the TrackingPlugin
// interface (plan §D.1). This is the ONLY file in the app that imports the
// plugin package directly - swapping plugins later touches only this file.
export const capacitorTrackingPlugin: TrackingPlugin = {
  async checkPermission() { /* plugin.checkPermissions() mapped to our 5 states */ throw new Error('implement against the installed plugin version'); },
  async requestPermission() { /* plugin.requestPermissions() */ throw new Error('implement against the installed plugin version'); },
  async start(onPoint, onError) { /* plugin.addWatcher({backgroundMessage, backgroundTitle, requestPermissions: true, stale: false, distanceFilter: 25}, callback) */ throw new Error('implement against the installed plugin version'); },
  async stop() { /* plugin.removeWatcher(...) */ throw new Error('implement against the installed plugin version'); },
};
```

- [ ] **Step 4: Implement `tracking.ts`:**

```ts
import type { TrackingPermissionState, TrackingPlugin, TrackingPoint } from './tracking-plugin';

export interface TrackingState {
  permission: TrackingPermissionState;
  active: boolean;
  lastSentAt: Date | null;
  lastError: 'permission_denied' | 'position_unavailable' | 'network' | null;
}

/** Time+distance throttle (plan §4): send at most this often... */
const MAX_INTERVAL_MS = 9_000;
/** ...unless the rider hasn't moved this far, in which case skip until the interval elapses. */
const MIN_DISTANCE_M = 25;

function haversineMeters(a: TrackingPoint, b: TrackingPoint): number {
  const R = 6371000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export class DeliveryTracker {
  private state: TrackingState = { permission: 'not_requested', active: false, lastSentAt: null, lastError: null };
  private listeners = new Set<(s: TrackingState) => void>();
  private deliveryId: string | null = null;
  private lastSentPoint: TrackingPoint | null = null;

  constructor(private plugin: TrackingPlugin, private send: (deliveryId: string, point: TrackingPoint) => Promise<void>) {}

  getState(): TrackingState {
    return this.state;
  }

  subscribe(listener: (s: TrackingState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setState(patch: Partial<TrackingState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }

  async start(deliveryId: string): Promise<void> {
    this.deliveryId = deliveryId;
    const permission = await this.plugin.requestPermission();
    this.setState({ permission });
    if (permission !== 'granted') return;

    await this.plugin.start(
      (point) => void this.onPoint(point),
      (code) => this.setState({ lastError: code })
    );
    this.setState({ active: true, lastError: null });
  }

  async stop(): Promise<void> {
    await this.plugin.stop();
    this.deliveryId = null;
    this.lastSentPoint = null;
    this.setState({ active: false });
  }

  private async onPoint(point: TrackingPoint): Promise<void> {
    if (!this.deliveryId) return;
    const last = this.lastSentPoint;
    const elapsedMs = last ? point.capturedAt.getTime() - last.capturedAt.getTime() : Infinity;
    const movedEnough = !last || haversineMeters(last, point) >= MIN_DISTANCE_M;
    if (last && elapsedMs < MAX_INTERVAL_MS && !movedEnough) return; // throttled, not sent

    try {
      await this.send(this.deliveryId, point);
      this.lastSentPoint = point;
      this.setState({ lastSentAt: new Date(), lastError: null });
    } catch {
      this.setState({ lastError: 'network' });
    }
  }
}
```

- [ ] **Step 5:** `npx vitest run src/test/tracking.test.ts` → all passing.

- [ ] **Step 6: Commit.**

---

## Task R3: Wire tracking into the delivery lifecycle + status UI

**Files:** Modify `apps/rider/src/api/resources.ts`, `apps/rider/src/pages/Delivery.tsx`; Modify (carefully) `apps/rider/src/test/delivery.test.tsx`; Create `apps/rider/src/components/TrackingStatus.tsx`; Test `apps/rider/src/test/tracking-status.test.tsx`

**Interfaces — Consumes:** `DeliveryTracker` (Task R2), `capacitorTrackingPlugin` (Task R2). **Produces:** `deliveriesApi.sendLocation(deliveryId, point)`.

- [ ] **Step 1: Add `sendLocation` to `resources.ts`:**

```ts
  sendLocation: (id: string, point: { latitude: number; longitude: number; accuracy: number; captured_at: string }) =>
    apiRequest<{ accepted: boolean; reason?: string }>(`/riders/deliveries/${id}/location`, { method: 'POST', body: point }),
```

(added to the `deliveriesApi` object, same style as the existing methods.)

- [ ] **Step 2: Write the failing test for `TrackingStatus`** — a small, passive readout (plan §13); asserts it shows state, never raw coordinates (preserving the intent of the existing "never renders coordinates" rule):

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { TrackingStatus } from '../components/TrackingStatus';

describe('TrackingStatus', () => {
  it('shows sharing-active state', () => {
    render(<TrackingStatus state={{ permission: 'granted', active: true, lastSentAt: new Date(), lastError: null }} />);
    expect(screen.getByText(/sharing your location/i)).toBeInTheDocument();
  });

  it('shows a GPS-unavailable banner with the reason, not a coordinate', () => {
    render(<TrackingStatus state={{ permission: 'granted', active: true, lastSentAt: null, lastError: 'position_unavailable' }} />);
    expect(screen.getByText(/can't get your location/i)).toBeInTheDocument();
  });

  it('never renders a raw coordinate, regardless of state', () => {
    render(<TrackingStatus state={{ permission: 'granted', active: true, lastSentAt: new Date(), lastError: null }} />);
    expect(screen.queryByText(/6\.4|80\.0/)).not.toBeInTheDocument();
  });

  it('shows a stopped confirmation once tracking has ended', () => {
    render(<TrackingStatus state={{ permission: 'granted', active: false, lastSentAt: new Date(), lastError: null }} />);
    expect(screen.getByText(/stopped sharing/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3:** `npx vitest run src/test/tracking-status.test.tsx` → FAIL.

- [ ] **Step 4: Implement `TrackingStatus.tsx`** (following this app's existing small-component style — plain JSX, the app's own CSS classes, no new UI framework):

```tsx
import type { TrackingState } from '../lib/tracking';

export function TrackingStatus({ state }: { state: TrackingState }) {
  if (state.lastError === 'position_unavailable') {
    return <p className="tracking-status tracking-status--error">Can't get your location — check GPS is on.</p>;
  }
  if (!state.active) {
    return state.lastSentAt ? <p className="tracking-status">Stopped sharing your location.</p> : null;
  }
  const secondsAgo = state.lastSentAt ? Math.max(0, Math.round((Date.now() - state.lastSentAt.getTime()) / 1000)) : null;
  return (
    <p className="tracking-status tracking-status--active">
      Sharing your location{secondsAgo !== null ? ` — updated ${secondsAgo}s ago` : ''}
    </p>
  );
}
```

- [ ] **Step 5: Wire into `Delivery.tsx`** — start tracking on the existing pickup action, stop on arrive/fail (no new button, per plan §13). In the component:

```tsx
// added near the top of Delivery():
const trackerRef = useRef<DeliveryTracker | null>(null);
const [trackingState, setTrackingState] = useState<TrackingState>({ permission: 'not_requested', active: false, lastSentAt: null, lastError: null });
useEffect(() => {
  const tracker = new DeliveryTracker(capacitorTrackingPlugin, (deliveryId, point) =>
    deliveriesApi.sendLocation(deliveryId, {
      latitude: point.latitude, longitude: point.longitude, accuracy: point.accuracy, captured_at: point.capturedAt.toISOString(),
    }).then(() => undefined)
  );
  trackerRef.current = tracker;
  return tracker.subscribe(setTrackingState);
}, []);
```

and wire `onPickUp`/`onArrive`/`onFail` (already existing handlers in `run(...)`) to call `trackerRef.current?.start(data.delivery_id)` right after a successful pickup, and `trackerRef.current?.stop()` right after a successful arrive or fail — added inside the existing `run()` function's success path, gated on which `step` ran (pass a small tag through, or branch on `action.kind` from `nextAction(data)` before calling `run`). Render `<TrackingStatus state={trackingState} />` inside `<Slip>` only while `stage(d) === 2` (out-for-delivery), matching plan §2.3's window.

- [ ] **Step 6: Revise `delivery.test.tsx`'s existing coordinate-secrecy test** — it must keep asserting no raw coordinate digits ever appear in the rendered delivery screen (unchanged intent), while now also rendering the new `TrackingStatus` text, which contains no coordinates. Add one assertion confirming both together: the delivery detail screen shows tracking-status copy but never a raw lat/lng value, even once tracking is active.

- [ ] **Step 7:** `npx vitest run` (whole `apps/rider` suite) → all passing, including the revised coordinate-secrecy test. `npm run typecheck`.

- [ ] **Step 8: Commit.**

---

## Task RG: Physical background-tracking verification gate — BLOCKS every Customer-app task

**Files:** none (verification only). **This task supersedes and absorbs what an earlier draft called "Task R4" — there is no separate, lighter R4; this is the one, non-optional gate.**

**This is the single most important task in the whole plan.** Everything after it (Google Maps setup, the customer map, the live E2E) assumes the architectural bet made in Decision D1 — that a Capacitor-wrapped native app with this plugin gives genuinely reliable background location — is actually true. Nothing before this point proves that; unit tests exercise `DeliveryTracker` against a fake plugin by design (§D.14), which proves the *logic* is correct but says nothing about whether the *real plugin* survives a locked screen on the *real target Android build*. Research done while writing this plan found a previously reported case of this exact plugin's background updates silently stopping after several minutes on Android 14 (§ tracking-plugin research) — a failure mode a quick "lock the screen for 10 seconds" smoke test would not catch, which is why the scenario list below is long and includes sustained, multi-minute movement.

**Do not proceed to Task M0 or any later task until this gate passes.** If it fails, the response is to reconsider the plugin choice (§1.3 names the paid Transistorsoft plugin as the documented fallback) — not to patch around the symptom, and not to weaken this gate to make it pass.

- [ ] **Step 0: Compatibility verification, before installing anything for real (desk research, no device needed).** Confirm, against the plugin's actual current README/CHANGELOG/issue tracker at implementation time (not assumed from this plan's own research, which is already a few weeks old by the time this task runs):
  - The exact Capacitor major version this plugin documents support for, cross-checked against the exact `@capacitor/core`/`@capacitor/android` version Task R1 actually installed — pin to a version pair the plugin's own documentation confirms, not "whatever `npm install` resolves to."
  - Android-side requirements: minimum/target SDK version compatibility with the plugin (including any Android 14 foreground-service-specific fixes/notes — cite the specific released version that contains them), and the exact manifest/service declarations the plugin's current docs require (may differ from what Task R1 Step 4 wrote if the plugin has changed since).
  - iOS-side requirements: read and record them even though iOS remains out of scope for this phase (§1/§8) — so a future iOS task doesn't have to re-derive this.
  - Any open, unresolved issues in the plugin's own tracker describing exactly the failure mode this gate exists to catch (background updates stopping after N minutes, being killed by battery optimization, etc.) — if a serious open issue matches this project's exact Android target version, that is grounds to stop and reconsider the plugin choice before writing any more code, not just a footnote.
  - **Record the findings** (versions pinned, exact manifest requirements used, any known-issue caveats) in a short note at the top of `tracking-plugin.ts` as a code comment, so the compatibility research travels with the code, not just this plan.

- [ ] **Step 1: A real, physical Android device is required for every remaining step.** An emulator does not exercise real OS battery-optimization/Doze behavior and is not sufficient (per the user's explicit instruction: "browser simulation or mocked GPS" is insufficient for final verification, and a real device is required, "not only browser/dev-server testing"). If no physical device is available in the environment running this task, **stop here and request one** — do not substitute an emulator run and report it as equivalent, and do not skip ahead to Task M0 while waiting.

- [ ] **Step 2: Build and install.** `npm run build && npx cap sync android`, then a debug build (`./gradlew assembleDebug`) installed on the physical device via `adb install`. Confirm `adb devices` lists the device before proceeding.

- [ ] **Step 3: Run the full scenario list below against the real backend** (the backend from Tasks B1–B5 must already be reachable from the device — either the dev machine's LAN IP, not `localhost`, or a tunnel). For each scenario, record the observed result (pass/fail + what was actually observed — a log line, a DB row, a UI state), not just a checkbox:
  1. Rider signs in, an order is walked (via the admin/staff flow, as in the backend's own tests) to `PACKED` and assigned to this rider.
  2. Rider taps "picked up" — confirm tracking starts (the rider UI's `TrackingStatus` shows "Sharing your location").
  3. **Lock the screen.**
  4. **Physically move the device** (walk around, or drive if practical) for **at least 5 continuous minutes** — long enough to catch the exact "stops after a few minutes" failure mode found in research, not just an initial handshake.
  5. Confirm, via the backend's own data (`deliveries.location_received_at` advancing in the DB, queried directly, or backend logs), that location updates kept arriving **the whole time the screen was locked**, not just before locking.
  6. Confirm the customer side receives the updates: open the SSE stream directly (`curl` with the customer's bearer token, or a minimal script — the full customer map UI does not need to exist yet for this gate) and observe `event: location` frames arriving with changing coordinates while the rider is moving.
  7. Rider taps "arrived" — confirm the stream receives `event: closed` and a further location POST from the rider returns `409`.
  8. **App backgrounded** (not locked, just switched away from) during an active delivery — confirm tracking continues the same way.
  9. **Network temporarily disconnected** (airplane mode toggled) mid-delivery — confirm no fake "success" is shown to the rider, and sending resumes once connectivity returns, without a burst of stale queued points (per the "no offline queue" decision, §4/§10).
  10. **GPS/location services disabled** at the OS level mid-delivery — confirm the rider UI shows the GPS-unavailable state (§10), not a silent failure or a crash.
  11. **Location permission denied** at first ask, then **revoked mid-session** via Android's own app-settings toggle while tracking is active — confirm both produce the correct rider UI state (§3) and that revocation actually stops the plugin from reporting (no locations sent after revocation).
  12. **Stale location:** stop moving/sending for several minutes without closing the delivery — confirm the customer-facing freshness state (via the SSE/curl check) would classify as STALE then OFFLINE per §10's thresholds (this can be checked against the raw `location_received_at` timestamps even without the full customer UI).
  13. **Rider app killed and restarted mid-delivery** — confirm the app recovers the active delivery on restart (via its existing queue/detail reload) and tracking resumes correctly rather than either silently staying off or double-starting.
  14. **Failed delivery:** rider reports a failure — confirm tracking stops and a further location POST is refused (409), exactly as Task B2's automated test already proves at the API level; this step confirms the *device-side* tracking loop also stops, not just that the server would reject it.
  15. **Failed → re-stage → new delivery → new tracking session:** admin re-stages, a (possibly the same) rider is reassigned, picks up the new delivery — confirm tracking starts fresh against the *new* delivery id, and that the *old* delivery id's tracking loop (if the app somehow still held a reference to it) cannot report a location (mirrors Task B2's automated re-stage test, now proven device-side).

- [ ] **Step 4: Verdict.** If every scenario above passes: proceed to Task M0. If any scenario in steps 3–15 above fails in a way that indicates the plugin cannot reliably track in the background (not a one-off flake — re-run a failed scenario at least once before concluding it's systemic): **stop, do not proceed to Task M0**, and escalate to the user with the specific failing scenario and evidence, per the binding instruction that background tracking must be demonstrated reliably before the full feature is built. Do not silently swap plugins or weaken the gate without that conversation.

- [ ] **Step 5: Release build.** Once the gate passes on a debug build, also produce and spot-check a release build (`./gradlew assembleRelease`, the project's chosen signing flow) — release builds can behave differently under battery optimization/ProGuard than debug builds, so this is not purely a formality re-run of Step 2.

- [ ] **Step 6:** Full test suite: `npm test` in `apps/rider` — all passing (unchanged from Task R2/R3's state; this task adds no new automated tests, only device evidence).

---

## Task M0: Map tile hosting setup documentation (gates every Customer-app task below) — REVISED 2026-09-19

**Files:** Create `docs/06-deployment/map-tile-hosting-setup.md` (was `google-maps-setup.md` under the superseded Google Maps plan — do not create both).

**Required per §D.11/§8 — written before any task that consumes the tile source.** No Google Cloud project, no Google API key, anywhere in this task. Content, concrete and complete (no placeholders):

- [ ] Write the doc covering:
  1. **Build the tile archive.** Download a current OpenStreetMap regional extract covering Dharga Town and enough surrounding area for map context (source: Geofabrik's Sri Lanka extract — **confirm the exact current download URL against `download.geofabrik.de` at build time**, since extract naming/coverage can change). Process it into a single `.pmtiles` vector-tile archive using a current open-source tile-building tool (e.g. Planetiler, or the Protomaps `basemaps` build pipeline) — **confirm the exact current command/flags/tool version against that tool's own official documentation at implementation time**; this plan deliberately does not invent a specific command, per the instruction not to invent configuration values not yet verified. Choose a zoom range appropriate for street-level delivery tracking (roughly z0–z16 is typical for this use case; confirm against the chosen tool's own guidance) — a wider range than needed only inflates file size and build time for no benefit at this app's fixed, small map area.
  2. **Pick a matching style.** The `.pmtiles` file's vector schema must match an open-source MapLibre style JSON built for that schema (e.g. Protomaps' own `basemaps` light/dark themes if built with that pipeline, or an OpenMapTiles-schema style such as Positron/Bright if the OpenFreeMap-compatible schema is used instead — pick one pairing and keep the style and the tile schema consistent). Bundle the chosen style JSON as a Flutter asset (no network fetch needed for the style itself — only individual tiles are fetched over HTTP via byte-range requests against the `.pmtiles` file).
  3. **Host the file.** Serve the built `.pmtiles` file as a static file from `backend/api`, with HTTP byte-range support (needed because MapLibre reads ranges from the archive rather than downloading it whole) — Express's built-in static-file serving supports Range requests natively; confirm the exact route/middleware choice at implementation time and record it here. No authentication on this route — it is public map data, the same trust level as any other static asset already served by this backend. Document the resulting URL convention (e.g. via the existing `.env`/`flutter_dotenv` config already used for the API base URL — reusing that convention, not inventing a new one) so the Customer app's `MapProvider` (§8.4, Task M4) can read it as ordinary, non-secret configuration.
  4. **No API key, confirmed and stated explicitly.** Neither self-hosted PMTiles nor its documented fallback (step 6 below) requires an API key. State this plainly so a future implementer doesn't add key-management code that has no purpose.
  5. **Attribution.** "© OpenStreetMap contributors" must render as a permanent, non-dismissible overlay on every map view (ODbL requirement, §8.1) — document exactly where in the widget tree this lives once Task M4 builds it, so it's never accidentally dropped in a later redesign.
  6. **Documented fallback: OpenFreeMap.** If self-hosting is ever deprioritized, record the exact swap procedure: point the `MapProvider`'s tile-source configuration at OpenFreeMap's public style/tile endpoints (confirm the current endpoint URL against `openfreemap.org`'s own documentation at swap time — it has changed structure before and should not be assumed stable indefinitely) and update the attribution string to "OpenFreeMap © OpenMapTiles Data from OpenStreetMap" per their stated requirement. No other file changes — this is the concrete proof that the §8.4 abstraction does what it's for. Also record, for completeness, that OpenFreeMap's public instance carries no SLA (a single-maintainer service, per its own published terms) — a deliberate tradeoff if ever exercised, not a silent one.
  7. **Maintenance cadence.** The `.pmtiles` file is a point-in-time snapshot; document a periodic (e.g. every few months) manual/scripted rebuild step so the local road network doesn't silently drift out of date — no runtime cost, an occasional build-and-redeploy task.
  8. **Cost note.** Restate §8.3 plainly: no recurring third-party tile-service bill exists for this setup; the only ongoing cost is the bandwidth/storage already absorbed by `backend/api`'s existing hosting, which at this app's scale (1–2 riders, ~50 orders/day, one small fixed map area) is trivial.

- [ ] Commit.

---

## Task M1: `OrderModel` gains the destination coordinate

**Files:** Modify `apps/customer/.../lib/Models/order_model.dart`; Test `apps/customer/.../test/order_model_test.dart`

**Interfaces — Produces:** `OrderModel.deliveryLatitude: double?`, `deliveryLongitude: double?`.

- [ ] **Step 1: Failing test** (append to `order_model_test.dart`, using the existing `orderJson` fixture — confirm/extend it to include `delivery_latitude`/`delivery_longitude`, which the real backend already returns on every order per §8):

```dart
test('parses the delivery destination coordinate (already returned by the backend, plan §8)', () {
  final o = OrderModel.fromJson({...orderJson(), 'delivery_latitude': '6.4382', 'delivery_longitude': '80.0274'});
  expect(o.deliveryLatitude, 6.4382);
  expect(o.deliveryLongitude, 80.0274);
});
test('a missing destination coordinate parses as null, not zero', () {
  final o = OrderModel.fromJson(orderJson());
  expect(o.deliveryLatitude, isNull);
  expect(o.deliveryLongitude, isNull);
});
```

- [ ] **Step 2:** `flutter test test/order_model_test.dart` → FAIL.

- [ ] **Step 3: Implement** — add `final double? deliveryLatitude; final double? deliveryLongitude;` to the class, thread through the constructor, and in `fromJson`:

```dart
deliveryLatitude: _optionalDouble(json['delivery_latitude'] ?? json['deliveryLatitude']),
deliveryLongitude: _optionalDouble(json['delivery_longitude'] ?? json['deliveryLongitude']),
```

with a small helper `double? _optionalDouble(Object? v) => v == null ? null : double.tryParse(v.toString());` near the file's existing `_date` helper.

- [ ] **Step 4:** `flutter test test/order_model_test.dart` → passing. Whole suite `flutter test` → unchanged elsewhere. `flutter analyze` → clean.

- [ ] **Step 5: Commit.**

---

## Task M2: `RiderLocationModel` + freshness classification

**Files:** Create `apps/customer/.../lib/Models/rider_location_model.dart`; Test `apps/customer/.../test/rider_location_model_test.dart`

**Interfaces — Produces:**
```dart
enum LocationFreshness { live, stale, offline }
class RiderLocationPoint {
  final double latitude, longitude, accuracy;
  final DateTime capturedAt, receivedAt;
  static RiderLocationPoint? tryParse(Object? json);
}
LocationFreshness classifyFreshness(DateTime capturedAt, {DateTime? now});
```

- [ ] **Step 1: Failing tests** (thresholds match plan §10 — LIVE within ~18s, STALE up to 2 minutes, OFFLINE beyond):

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:ecom/Models/rider_location_model.dart';

void main() {
  group('RiderLocationPoint', () {
    test('parses a well-formed SSE location event', () {
      final p = RiderLocationPoint.tryParse({
        'latitude': 6.44, 'longitude': 80.03, 'accuracy': 8.5,
        'captured_at': '2026-09-19T10:00:00.000Z', 'received_at': '2026-09-19T10:00:01.000Z',
      })!;
      expect(p.latitude, 6.44);
      expect(p.capturedAt, DateTime.utc(2026, 9, 19, 10, 0, 0));
    });
    test('malformed payloads parse as null, never a fabricated point', () {
      expect(RiderLocationPoint.tryParse({'latitude': 6.44}), isNull);
      expect(RiderLocationPoint.tryParse(null), isNull);
      expect(RiderLocationPoint.tryParse('not a map'), isNull);
    });
  });

  group('classifyFreshness', () {
    final now = DateTime.utc(2026, 9, 19, 10, 0, 20);
    test('LIVE within the live window', () {
      expect(classifyFreshness(DateTime.utc(2026, 9, 19, 10, 0, 5), now: now), LocationFreshness.live);
    });
    test('STALE beyond live but within the stale ceiling', () {
      expect(classifyFreshness(now.subtract(const Duration(seconds: 40)), now: now), LocationFreshness.stale);
    });
    test('OFFLINE beyond the stale ceiling', () {
      expect(classifyFreshness(now.subtract(const Duration(minutes: 5)), now: now), LocationFreshness.offline);
    });
  });
}
```

- [ ] **Step 2:** `flutter test test/rider_location_model_test.dart` → FAIL.

- [ ] **Step 3: Implement:**

```dart
import 'package:ecom/Models/order_model.dart' show orderStatusFromString; // no-op import removed if unused

enum LocationFreshness { live, stale, offline }

/// LIVE up to ~2x the rider app's send interval (plan §4, §10); STALE up to a
/// longer ceiling; OFFLINE beyond that. Always computed from server
/// timestamps, never a client guess.
const _liveWindow = Duration(seconds: 18);
const _staleCeiling = Duration(minutes: 2);

LocationFreshness classifyFreshness(DateTime capturedAt, {DateTime? now}) {
  final n = now ?? DateTime.now().toUtc();
  final age = n.difference(capturedAt);
  if (age <= _liveWindow) return LocationFreshness.live;
  if (age <= _staleCeiling) return LocationFreshness.stale;
  return LocationFreshness.offline;
}

class RiderLocationPoint {
  const RiderLocationPoint({
    required this.latitude, required this.longitude, required this.accuracy,
    required this.capturedAt, required this.receivedAt,
  });
  final double latitude, longitude, accuracy;
  final DateTime capturedAt, receivedAt;

  static RiderLocationPoint? tryParse(Object? json) {
    if (json is! Map) return null;
    final lat = double.tryParse((json['latitude'] ?? '').toString());
    final lng = double.tryParse((json['longitude'] ?? '').toString());
    final acc = double.tryParse((json['accuracy'] ?? '').toString());
    final capturedAt = DateTime.tryParse((json['captured_at'] ?? '').toString());
    final receivedAt = DateTime.tryParse((json['received_at'] ?? '').toString());
    if (lat == null || lng == null || acc == null || capturedAt == null || receivedAt == null) return null;
    return RiderLocationPoint(latitude: lat, longitude: lng, accuracy: acc, capturedAt: capturedAt, receivedAt: receivedAt);
  }
}
```

(drop the unused import line above — shown only to flag it must not linger; the real file has no such import.)

- [ ] **Step 4:** `flutter test test/rider_location_model_test.dart` → passing. `flutter analyze` → clean.

- [ ] **Step 5: Commit.**

---

## Task M3: `LocationProvider` — SSE client

**Files:** Create `apps/customer/.../lib/Services/Providers/location.provider.dart`; Test `apps/customer/.../test/location_provider_test.dart`

**Interfaces — Consumes:** `RiderLocationPoint`, `classifyFreshness` (Task M2). **Produces:**
```dart
typedef LocationStreamOpener = Stream<String> Function(String orderId); // yields raw SSE text chunks
class LocationProvider extends ChangeNotifier {
  LocationProvider({LocationStreamOpener? opener});
  RiderLocationPoint? get current;
  LocationFreshness? get freshness; // null until a point or a close arrives
  bool get closed; // true once the server sent event: closed
  void watch(String orderId);   // opens the stream
  void stopWatching();          // closes it, resets state
}
```

- [ ] **Step 1: Failing tests**, following the injectable-stream convention already used for injectable requests elsewhere in this app (`OrderProvider`'s `OrderRequest` typedef is the direct precedent):

```dart
import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:ecom/Services/Providers/location.provider.dart';
import 'package:ecom/Models/rider_location_model.dart';

void main() {
  group('LocationProvider', () {
    test('parses a location event from the stream and exposes it', () async {
      final controller = StreamController<String>();
      final provider = LocationProvider(opener: (_) => controller.stream);
      provider.watch('order-1');
      controller.add('event: location\ndata: {"latitude":6.44,"longitude":80.03,"accuracy":8,"captured_at":"2026-09-19T10:00:00.000Z","received_at":"2026-09-19T10:00:01.000Z"}\n\n');
      await Future<void>.delayed(Duration.zero);
      expect(provider.current?.latitude, 6.44);
      expect(provider.closed, isFalse);
    });

    test('a closed event marks the provider closed and stops updating current', () async {
      final controller = StreamController<String>();
      final provider = LocationProvider(opener: (_) => controller.stream);
      provider.watch('order-1');
      controller.add('event: closed\ndata: {"reason":"not_trackable"}\n\n');
      await Future<void>.delayed(Duration.zero);
      expect(provider.closed, isTrue);
      expect(provider.current, isNull);
    });

    test('stopWatching resets state and does not react to further stream data', () async {
      final controller = StreamController<String>();
      final provider = LocationProvider(opener: (_) => controller.stream);
      provider.watch('order-1');
      controller.add('event: location\ndata: {"latitude":6.44,"longitude":80.03,"accuracy":8,"captured_at":"2026-09-19T10:00:00.000Z","received_at":"2026-09-19T10:00:01.000Z"}\n\n');
      await Future<void>.delayed(Duration.zero);
      provider.stopWatching();
      expect(provider.current, isNull);
      controller.add('event: location\ndata: {"latitude":6.50,"longitude":80.05,"accuracy":8,"captured_at":"2026-09-19T10:00:05.000Z","received_at":"2026-09-19T10:00:06.000Z"}\n\n');
      await Future<void>.delayed(Duration.zero);
      expect(provider.current, isNull); // late data from a stopped watch is ignored
    });

    test('watching a second order supersedes the first (generation guard, same pattern as OrderProvider)', () async {
      final c1 = StreamController<String>();
      final c2 = StreamController<String>();
      var call = 0;
      final provider = LocationProvider(opener: (_) => call++ == 0 ? c1.stream : c2.stream);
      provider.watch('order-1');
      provider.watch('order-2');
      c1.add('event: location\ndata: {"latitude":1,"longitude":1,"accuracy":1,"captured_at":"2026-09-19T10:00:00.000Z","received_at":"2026-09-19T10:00:01.000Z"}\n\n');
      await Future<void>.delayed(Duration.zero);
      expect(provider.current, isNull); // the stale first stream's data never applies
    });

    test('malformed frames are ignored, not thrown', () async {
      final controller = StreamController<String>();
      final provider = LocationProvider(opener: (_) => controller.stream);
      provider.watch('order-1');
      controller.add('garbage\n\n');
      await Future<void>.delayed(Duration.zero);
      expect(provider.current, isNull);
    });
  });
}
```

- [ ] **Step 2:** `flutter test test/location_provider_test.dart` → FAIL.

- [ ] **Step 3: Implement**, following the same generation-counter discipline the prior phase's `OrderProvider` established for exactly this class of bug (a superseded async operation applying stale data):

```dart
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:dio/dio.dart';

import '../../Models/rider_location_model.dart';
import '../../Infrastructure/HttpMethods/requesting_methods.dart';
import '../../Infrastructure/HttpMethods/token_storage.dart';

/// Yields raw SSE text chunks for one order's location stream. Injectable so
/// tests never open a real network connection (plan §D.14).
typedef LocationStreamOpener = Stream<String> Function(String orderId);

Stream<String> _dioStreamOpener(String orderId) async* {
  final token = await TokenStorage.getAccessToken();
  final response = await ApiService.dio.get<ResponseBody>(
    '/orders/$orderId/location/stream',
    options: Options(
      responseType: ResponseType.stream,
      headers: {if (token != null) 'Authorization': 'Bearer $token'},
    ),
  );
  await for (final chunk in response.data!.stream) {
    yield String.fromCharCodes(chunk);
  }
}

/// The customer's live view of their own order's rider location (plan §7, §9).
/// Mirrors OrderProvider's ChangeNotifier + injectable-request convention,
/// substituting an injectable stream opener for an injectable request.
class LocationProvider extends ChangeNotifier {
  LocationProvider({LocationStreamOpener? opener}) : _opener = opener ?? _dioStreamOpener;
  final LocationStreamOpener _opener;

  RiderLocationPoint? _current;
  bool _closed = false;
  StreamSubscription<String>? _sub;
  int _generation = 0;
  String _buffer = '';

  RiderLocationPoint? get current => _current;
  LocationFreshness? get freshness => _current == null ? null : classifyFreshness(_current!.capturedAt);
  bool get closed => _closed;

  void watch(String orderId) {
    final gen = ++_generation;
    _sub?.cancel();
    _current = null;
    _closed = false;
    _buffer = '';
    notifyListeners();
    _sub = _opener(orderId).listen(
      (chunk) => _onChunk(gen, chunk),
      onError: (_) {
        if (gen != _generation) return;
        // A dropped connection is not "closed" (no server signal) - the UI
        // freshness classification (stale -> offline) covers this without
        // the provider claiming an authoritative close (plan §10).
      },
    );
  }

  void stopWatching() {
    _generation++; // supersede any in-flight listener
    _sub?.cancel();
    _sub = null;
    _current = null;
    _closed = false;
    notifyListeners();
  }

  void _onChunk(int gen, String chunk) {
    if (gen != _generation) return;
    _buffer += chunk;
    while (_buffer.contains('\n\n')) {
      final idx = _buffer.indexOf('\n\n');
      final frame = _buffer.substring(0, idx);
      _buffer = _buffer.substring(idx + 2);
      _applyFrame(gen, frame);
    }
  }

  void _applyFrame(int gen, String frame) {
    if (gen != _generation) return;
    String? event;
    String? data;
    for (final line in frame.split('\n')) {
      if (line.startsWith('event:')) event = line.substring(6).trim();
      if (line.startsWith('data:')) data = line.substring(5).trim();
    }
    if (event == 'location' && data != null) {
      try {
        final point = RiderLocationPoint.tryParse((data.isEmpty) ? null : _decode(data));
        if (point != null) {
          _current = point;
          notifyListeners();
        }
      } catch (_) {
        // A malformed frame is ignored, never thrown to the widget tree.
      }
    } else if (event == 'closed') {
      _closed = true;
      _current = null;
      notifyListeners();
    }
  }

  Object? _decode(String data) => dio_convert(data);

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }
}

// dio_convert is a thin `jsonDecode` alias kept local so this file's only
// import needs are dio + dart:convert; implementer wires `import 'dart:convert' show jsonDecode;`
// and defines `Object? dio_convert(String s) => jsonDecode(s);` (named to avoid
// colliding with any existing top-level `jsonDecode` re-export in this app).
```

(The `_decode`/`dio_convert` naming above is a placeholder for "use `dart:convert`'s `jsonDecode` directly" — the implementer should simply `import 'dart:convert';` and call `jsonDecode(data)` inline; it is spelled out separately here only to flag that this file needs that import, which the code block's own import list above does not yet include — add it.)

- [ ] **Step 4:** `flutter test test/location_provider_test.dart` → passing. `flutter analyze` → clean (resolve the `_decode` indirection above into a plain `jsonDecode` call per the note).

- [ ] **Step 5: Commit.**

---

## Task M4: `MapProvider` abstraction + MapLibre adapter + `OrderTrackingMap` widget — REVISED 2026-09-19

**Files:** Create `apps/customer/.../lib/UI/Widgets/Organisms/map_provider.dart`, `apps/customer/.../lib/UI/Widgets/Organisms/maplibre_map_view.dart`, `apps/customer/.../lib/UI/Widgets/Organisms/order_tracking_map.dart`; Modify `pubspec.yaml`; Test `apps/customer/.../test/order_tracking_map_test.dart`

**Interfaces — Consumes:** `LocationProvider`, `RiderLocationPoint`, `classifyFreshness` (Task M2/M3); `OrderModel.deliveryLatitude/Longitude` (Task M1). **Produces:** `GeoPoint`, `MapMarkerSpec`, `MapMarkerTone`, `TrackingMapView` (the provider-neutral contract, §8.4), `OrderTrackingMap({required OrderModel order})`.

This task was rewritten in full for the MapLibre swap (§8, §D.4) — it now also creates the `MapProvider` abstraction (§8.4), a new binding requirement that did not exist in the original Google Maps version of this task.

- [ ] **Step 1:** `pubspec.yaml` — add `maplibre_gl: ^0.26.0` (or the current stable version at implementation time — **re-verify its Flutter/Dart SDK floor against its own current changelog before pinning**, the same way Task RG re-verifies the Rider app's plugin; §8.6 recorded Flutter 3.47.2/Dart 3.13.2 as the installed toolchain and `maplibre_gl` v0.26.0's Flutter 3.29+/Dart 3.7+ floor as comfortably satisfied at investigation time) and `geolocator: ^13.0.0` under `dependencies`. Remove any `google_maps_flutter` entry if one was added by mistake from the superseded version of this task — there must be none.

- [ ] **Step 2: Write the provider-neutral contract**, `map_provider.dart` (imports nothing map-SDK-specific — this file is safe for every other file to depend on):

```dart
import 'package:flutter/widgets.dart';

/// Provider-neutral map contracts (plan §8.4). No file except
/// maplibre_map_view.dart may import a concrete map SDK - swapping the map
/// provider later means changing that one file and this file's factory
/// redirects, nothing else.

class GeoPoint {
  const GeoPoint(this.latitude, this.longitude);
  final double latitude;
  final double longitude;
}

enum MapMarkerTone { destination, riderLive, riderStale }

class MapMarkerSpec {
  const MapMarkerSpec({required this.id, required this.position, required this.tone});
  final String id;
  final GeoPoint position;
  final MapMarkerTone tone;
}

/// A read-only map showing a fixed set of markers - used for the live
/// delivery-tracking map (Task M4). The concrete widget returned is
/// MapLibreTrackingMapView (maplibre_map_view.dart); callers never
/// reference that class directly.
abstract class TrackingMapView extends StatelessWidget {
  const factory TrackingMapView({
    Key? key,
    required GeoPoint initialCenter,
    required double initialZoom,
    required Set<MapMarkerSpec> markers,
  }) = MapLibreTrackingMapView;

  const TrackingMapView.constructor({super.key});
}

/// An interactive map with a single draggable pin - used for the address
/// location picker (Task M6). The concrete widget returned is
/// MapLibreLocationPickerView (maplibre_map_view.dart).
abstract class LocationPickerMapView extends StatelessWidget {
  const factory LocationPickerMapView({
    Key? key,
    required GeoPoint initialPosition,
    required ValueChanged<GeoPoint> onPositionChanged,
  }) = MapLibreLocationPickerView;

  const LocationPickerMapView.constructor({super.key});
}
```

(the `TrackingMapView`/`LocationPickerMapView` abstract classes use Dart's factory-constructor-redirect pattern deliberately: every call site writes `TrackingMapView(...)`/`LocationPickerMapView(...)` and never names the concrete class, so a future provider swap is a one-line change to the redirect target, not a find-and-replace across every call site.)

- [ ] **Step 3: Write the MapLibre adapter**, `maplibre_map_view.dart` (the ONLY file in the Customer app allowed to import `maplibre_gl` — verified mechanically in Task M7):

```dart
// maplibre_map_view.dart - the ONLY file that imports maplibre_gl directly
// (plan §8.4). Everything else in this app depends only on map_provider.dart.
import 'package:flutter/material.dart';
import 'package:maplibre_gl/maplibre_gl.dart';

import 'map_provider.dart';

const _tileStyleUrl = String.fromEnvironment('MAP_STYLE_URL', defaultValue: '');
// ^ Read from the app's existing flutter_dotenv/.env convention at call
// sites that construct these widgets in production (Task M0's documented
// config), not hardcoded here - shown as a build-time default only so this
// file compiles standalone. The implementer wires the real value through
// exactly as order_model.dart's existing API-base-URL config does.

class MapLibreTrackingMapView extends TrackingMapView {
  const MapLibreTrackingMapView({
    super.key,
    required this.initialCenter,
    required this.initialZoom,
    required this.markers,
  }) : super.constructor();

  final GeoPoint initialCenter;
  final double initialZoom;
  final Set<MapMarkerSpec> markers;

  @override
  Widget build(BuildContext context) {
    return MapLibreMap(
      styleString: _tileStyleUrl,
      initialCameraPosition: CameraPosition(
        target: LatLng(initialCenter.latitude, initialCenter.longitude),
        zoom: initialZoom,
      ),
      myLocationEnabled: false,
      onMapCreated: (controller) => _MapLibreCircles.sync(controller, markers),
      onStyleLoadedCallback: () {},
    );
  }
}

/// Renders MapMarkerSpec as MapLibre circle annotations (no image assets
/// needed, unlike Google Maps' BitmapDescriptor markers - a plain colored
/// dot per tone, which also makes the stale-opacity treatment simpler).
/// Exact CircleManager/CircleOptions field names must be verified against
/// the installed maplibre_gl version's API at implementation time - the
/// manager/annotation pattern itself has been stable across this package's
/// releases, but field names can drift between majors.
class _MapLibreCircles {
  static Future<void> sync(MapLibreMapController controller, Set<MapMarkerSpec> markers) async {
    final circleManager = CircleManager(controller);
    for (final marker in markers) {
      await circleManager.create(CircleOptions(
        geometry: LatLng(marker.position.latitude, marker.position.longitude),
        circleColor: _colorFor(marker.tone),
        circleRadius: 8.0,
        circleOpacity: marker.tone == MapMarkerTone.riderStale ? 0.5 : 1.0,
      ));
    }
  }

  static String _colorFor(MapMarkerTone tone) => switch (tone) {
        MapMarkerTone.destination => '#8E24AA', // violet, matches the prior Google-Maps hueViolet destination pin
        MapMarkerTone.riderLive => '#1E88E5', // azure, matches the prior hueAzure rider pin
        MapMarkerTone.riderStale => '#1E88E5',
      };
}

class MapLibreLocationPickerView extends LocationPickerMapView {
  const MapLibreLocationPickerView({
    super.key,
    required this.initialPosition,
    required this.onPositionChanged,
  }) : super.constructor();

  final GeoPoint initialPosition;
  final ValueChanged<GeoPoint> onPositionChanged;

  @override
  Widget build(BuildContext context) {
    // Implemented fully in Task M6, alongside the picker screen that uses
    // it - a draggable single circle annotation whose onDrag callback calls
    // onPositionChanged. Declared here because it shares this file's
    // exclusive maplibre_gl import; its body is written in Task M6.
    throw UnimplementedError('implemented in Task M6');
  }
}
```

- [ ] **Step 4: Failing tests** (the abstraction means these tests assert on `TrackingMapView`'s own constructor arguments — the `markers` set passed in — rather than reaching into a third-party widget's internals, which is simpler than the original Google Maps version of this test and is itself evidence the abstraction is doing its job):

```dart
testWidgets('shows a destination marker from the order and a rider marker once a point arrives', (tester) async {
  final provider = LocationProvider(opener: (_) => const Stream.empty());
  final order = OrderModel.fromJson({...orderJson(status: 'OUT_FOR_DELIVERY'), 'delivery_latitude': '6.4382', 'delivery_longitude': '80.0274'});
  await tester.pumpWidget(
    ChangeNotifierProvider<LocationProvider>.value(
      value: provider,
      child: MaterialApp(home: Scaffold(body: OrderTrackingMap(order: order))),
    ),
  );
  final map = tester.widget<TrackingMapView>(find.byType(TrackingMapView));
  expect(map.markers.length, 1); // destination only, no rider point yet
  expect(map.markers.single.tone, MapMarkerTone.destination);
});

testWidgets('shows the LIVE label when a fresh point exists', (tester) async {
  // pump with a provider already carrying a fresh RiderLocationPoint (constructed directly, not via the stream)
  // assert find.text('Live') or the app's chosen live-state copy is present
});

testWidgets('shows the STALE label with a "last seen" caption for an aging point', (tester) async { /* ... */ });

testWidgets('hides the rider marker entirely once offline/closed', (tester) async {
  // provider.closed == true -> markers contains only the destination tone, an "unavailable" caption instead
});

testWidgets('renders nothing (or a minimal placeholder) when the order has no destination coordinate', (tester) async {
  final order = OrderModel.fromJson(orderJson(status: 'OUT_FOR_DELIVERY')); // no delivery_latitude/longitude
  // assert the widget degrades gracefully, no crash, no fabricated coordinate
});
```

(the STALE/offline cases above are given as structure, not full pump code, since they differ from the first only in the provider's injected state — the implementer writes them with the same `ChangeNotifierProvider.value` pattern as the first test, injecting a `LocationProvider` subclass or a directly-mutated instance carrying the desired `current`/`freshness`/`closed` values.)

- [ ] **Step 5:** `flutter pub get`, then `flutter test test/order_tracking_map_test.dart` → FAIL.

- [ ] **Step 6: Implement `OrderTrackingMap`**, using the design tokens established in the prior Customer Order Experience phase (`AppColors`, `AppSpacing`, `AppTextColors`) and depending only on `map_provider.dart`, never on `maplibre_gl`:

```dart
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../Models/order_model.dart';
import '../../../Models/rider_location_model.dart';
import '../../../Services/Providers/location.provider.dart';
import '../../../app_colors.dart';
import '../../../app_design.dart';
import 'map_provider.dart';

/// The customer's live delivery map (plan §8): destination pin always shown
/// when known; rider pin shown only while a fresh-enough point exists. No
/// route, no ETA (plan §D.13) - the map shows where things ARE, not a
/// prediction. Depends only on map_provider.dart's TrackingMapView, never on
/// a concrete map SDK (plan §8.4).
class OrderTrackingMap extends StatelessWidget {
  const OrderTrackingMap({super.key, required this.order});
  final OrderModel order;

  @override
  Widget build(BuildContext context) {
    final destLat = order.deliveryLatitude;
    final destLng = order.deliveryLongitude;
    if (destLat == null || destLng == null) return const SizedBox.shrink();

    return Consumer<LocationProvider>(
      builder: (context, location, _) {
        final point = location.current;
        final freshness = location.freshness;
        final markers = <MapMarkerSpec>{
          MapMarkerSpec(id: 'destination', position: GeoPoint(destLat, destLng), tone: MapMarkerTone.destination),
          if (point != null && freshness != LocationFreshness.offline && !location.closed)
            MapMarkerSpec(
              id: 'rider',
              position: GeoPoint(point.latitude, point.longitude),
              tone: freshness == LocationFreshness.stale ? MapMarkerTone.riderStale : MapMarkerTone.riderLive,
            ),
        };

        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(AppRadius.card),
              child: SizedBox(
                height: 220,
                child: TrackingMapView(
                  initialCenter: GeoPoint(destLat, destLng),
                  initialZoom: 14,
                  markers: markers,
                ),
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
            _FreshnessCaption(point: point, freshness: freshness, closed: location.closed),
          ],
        );
      },
    );
  }
}

class _FreshnessCaption extends StatelessWidget {
  const _FreshnessCaption({required this.point, required this.freshness, required this.closed});
  final RiderLocationPoint? point;
  final LocationFreshness? freshness;
  final bool closed;

  @override
  Widget build(BuildContext context) {
    if (point == null || closed || freshness == LocationFreshness.offline) {
      return const Text('Live location unavailable right now.', style: TextStyle(color: AppTextColors.onBackground, fontSize: 13));
    }
    if (freshness == LocationFreshness.stale) {
      return const Text('Last seen a moment ago.', style: TextStyle(color: AppTextColors.onBackground, fontSize: 13, fontWeight: FontWeight.w600));
    }
    return const Text('Live', style: TextStyle(color: AppColors.primaryGreenColor, fontSize: 13, fontWeight: FontWeight.w700));
  }
}
```

(the "Last seen a moment ago" caption should compute an actual elapsed-time string from `point!.capturedAt`, following the same local-time formatting helper (`formatOrderTime` or a small dedicated one) established in `order_format.dart` in the prior phase — spelled out generically here since the exact phrasing is a design-polish detail, not a structural one.)

- [ ] **Step 7:** `flutter test test/order_tracking_map_test.dart` → passing. `flutter analyze` → clean.

- [ ] **Step 8: Commit.**

---

## Task M5: Android permission wiring + wire the map into the order detail screen — REVISED 2026-09-19

**Files:** Modify `apps/customer/.../android/app/src/main/AndroidManifest.xml`; Modify `lib/Screens/order_summary_screen.dart`; Modify `main.dart` (provider registration); Test append to `apps/customer/.../test/order_detail_screen_test.dart`

**Depends on Task M0 (the tile-hosting setup doc) being followed exactly for the tile-URL config step.** Unlike the superseded Google Maps version of this task, **no manifest API-key meta-data is added at all** — MapLibre needs none (§8.6).

- [ ] **Step 1: Android config** — in `AndroidManifest.xml`, add only: `<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />` and `<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />` (needed only for the separate "use my current location" address-picker feature in Task M6/M7, not for viewing the map — the live delivery map itself asks the customer for no device permission at all, §8.6). No `build.gradle` change and no `local.properties`/`manifestPlaceholders` wiring is needed for the map itself, unlike the superseded plan.

- [ ] **Step 2: Register `LocationProvider`** in `main.dart`'s existing `MultiProvider` list, alongside `OrderProvider` etc.

- [ ] **Step 3: Failing test** — the tracking map appears only during the trackable window (plan §2.3), never before pickup or after arrival:

```dart
testWidgets('shows the tracking map only while OUT_FOR_DELIVERY with a PICKED_UP delivery', (tester) async {
  // pump the detail screen with an order fixture at OUT_FOR_DELIVERY + delivery.assignmentStatus PICKED_UP
  // expect(find.byType(OrderTrackingMap), findsOneWidget)
});
testWidgets('does not show the tracking map for a PACKED order (not yet picked up)', (tester) async {
  // expect(find.byType(OrderTrackingMap), findsNothing)
});
testWidgets('does not show the tracking map once DELIVERED', (tester) async {
  // expect(find.byType(OrderTrackingMap), findsNothing)
});
```

- [ ] **Step 4:** `flutter test test/order_detail_screen_test.dart` → the new tests FAIL.

- [ ] **Step 5: Implement** — in `order_summary_screen.dart`'s section list (between the status header and the timeline, per plan §8), add:

```dart
if (order.status == OrderStatus.outForDelivery && order.delivery?.assignmentStatus == 'PICKED_UP')
  OrderTrackingMap(order: order),
```

and start/stop the `LocationProvider`'s watch in the screen's existing `_load()`/lifecycle methods: call `context.read<LocationProvider>().watch(order.id)` when that same condition becomes true, and `stopWatching()` in `dispose()` and whenever the condition becomes false on a subsequent refresh (mirroring how the screen already manages its `WidgetsBindingObserver` lifecycle from the prior phase).

- [ ] **Step 6:** `flutter test test/order_detail_screen_test.dart` → passing. Whole suite `flutter test` → unchanged elsewhere. `flutter analyze` → clean.

- [ ] **Step 7: Commit.**

---

## Task M6: Customer "use current location" (address picker)

**Files:** Create `apps/customer/.../lib/Screens/live_location_picker_screen.dart`; Modify `lib/Screens/add_edit_address_screen.dart`; Test `apps/customer/.../test/live_location_picker_screen_test.dart`

- [ ] **Step 1: Failing tests** for the picker screen — permission states, draggable pin confirms a coordinate, "Confirm" returns it to the caller:

```dart
testWidgets('requesting permission shows an explanation before the OS prompt (plan §12, §3)', (tester) async {
  // a fake LocationPermissionSource with checkPermission() -> denied initially
  // expect the explanatory copy to render before any permission call
});
testWidgets('on grant, centers the map on the device position and shows a draggable pin', (tester) async {
  // fake source returns a fixed lat/lng; expect a Marker at that position
});
testWidgets('dragging the pin updates the visible coordinate label', (tester) async {
  // simulate onCameraMove/onTap moving the marker; assert the displayed lat/lng text changes
});
testWidgets('Confirm returns the selected coordinate to the caller via Navigator.pop', (tester) async {
  // tap Confirm, assert the pushed route resolves with {latitude, longitude}
});
testWidgets('permission denied shows the explanation again plus manual-entry fallback, never crashes', (tester) async {
  // fake source returns denied on request too
});
```

- [ ] **Step 2:** FAIL. **Step 3: Implement** the screen: a `geolocator`-backed `checkPermission`/`requestPermission`/`getCurrentPosition` call (through a small injectable interface, same pattern as Task R2's `TrackingPlugin`, so this screen's tests never touch real device location either), a `LocationPickerMapView` (Task M4's abstraction — never `maplibre_gl` directly, §8.4) with a single draggable pin — completing `MapLibreLocationPickerView`'s body in `maplibre_map_view.dart` (left as `UnimplementedError` at the end of Task M4, since it belongs with this screen's own logic) as a single MapLibre circle annotation whose drag-update callback invokes `onPositionChanged`, exact `CircleManager`/drag-event field names to be verified against the installed `maplibre_gl` version at implementation time (same caveat as Task M4's rider/destination circles) — plus a coordinate label, and "Confirm"/"Cancel" actions that `Navigator.pop` a `{latitude, longitude}` result or `null`.

- [ ] **Step 4: Wire into `add_edit_address_screen.dart`** — a new "Use my current location" button above the existing manual lat/lng fields (which remain, as a fallback/correction, per plan §12); on tap, push the picker screen and, on a non-null result, populate the existing `_latController`/`_lngController` text fields with the returned values (reusing the screen's existing state, no new fields needed there).

- [ ] **Step 5:** `flutter test test/live_location_picker_screen_test.dart` → passing. `flutter test test/add_edit_address_screen_test.dart` (existing file) → still passing, unchanged behaviour for manual entry. `flutter analyze` → clean.

- [ ] **Step 6: Commit.**

---

## Task M7: Customer app verification checkpoint

**Files:** none (verification only)

- [ ] `flutter test` (whole suite), `flutter analyze`, `flutter build apk --release` (and note if this hits the same pre-existing Gradle/Java toolchain gap the prior phase documented — if so, it is not new to this phase and should be reported, not silently worked around) — all reported with exact counts/output.
- [ ] Confirm by grep: no file under `lib/` computes or displays an ETA, a route/polyline, or a ranking/estimate of any kind (Global Constraint, §D.13) — mechanical check, run now.
- [ ] **Confirm by grep (§8.4, new for the MapLibre swap):** `grep -rl "package:maplibre_gl" lib/` returns exactly one file, `lib/UI/Widgets/Organisms/maplibre_map_view.dart` — a task that leaves a second import fails review.
- [ ] Confirm `pubspec.yaml` has no `google_maps_flutter` entry and no Google Maps API key reference exists anywhere in the app (`grep -ri "google.*maps\|com.google.android.geo" apps/customer/.../android/` should return nothing) — the map provider swap must be complete, not partial.

---

## Task V1: Full-stack verification + live E2E

**Files:** Create `apps/customer/.../integration_test/live_location_tracking_flow_test.dart`

**Depends on Task RG having passed.** Every location-generating step in this task's live E2E uses the **real physical Android device and real GPS** proven in Task RG — browser simulation or mocked GPS is explicitly not acceptable for this final pass (binding instruction, approved 2026-09-19), not even as a fallback. The parts of this task that don't generate location data (OTP sign-in, order placement, pack/assign, ownership/isolation checks that only need the API, not real movement) may still use this repo's existing automated-test conventions; only the rider's actual position data must come from the real device.

- [ ] Backend: `npm run typecheck && npm test && npm run test:hygiene && npm run build` (backend/api) — all passing.
- [ ] Rider app: `npm run typecheck && npm test && npm run build` (apps/rider), plus the Android release build already produced and proven in Task RG Step 5.
- [ ] Customer app: `flutter test && flutter analyze` (Task M7), plus a build.
- [ ] **Live E2E on the real device**, following the established pattern (real OTP, real HTTP, nothing mocked, DB restored to baseline after) and covering every scenario named in §D.15/§16, re-run here end to end through the FULL stack (including the now-built customer map and picker, which Task RG's own scenario list deliberately checked via a raw SSE probe instead, since the customer UI didn't exist yet at that point):
  1. Normal flow: customer places an order (real UI) → pack → assign → **rider picks up on the real physical device** → tracking starts → the rider's real GPS reports a position → the customer app's actual map marker moves, asserted against the real round-tripped coordinate → rider arrives → assert the stream receives `event: closed` and the customer map shows the offline/unavailable state → delivered.
  2. **Background/foreground**: lock the screen and background the app mid-delivery on the real device; confirm location updates keep arriving and the customer map keeps moving.
  3. **Permission changes**: deny then revoke location permission mid-tracking on the real device; confirm the rider UI shows the correct state and stops sending (no crash, no fake point sent).
  4. **Network loss/reconnection**: toggle airplane mode on the real device briefly during tracking; confirm no fake "success" is shown, and sending resumes once connectivity returns, with no burst of stale queued points.
  5. **GPS disabled**: turn off location services at the OS level mid-delivery on the real device; confirm the rider UI's GPS-unavailable state and that the customer side ages into STALE/OFFLINE correctly.
  6. **Stale locations**: stop the rider moving/sending; assert the customer UI transitions LIVE → STALE → OFFLINE purely from elapsed time (no new send needed to observe this transition).
  7. **Rider app restarted mid-delivery**: kill and relaunch the rider app on the real device during an active delivery; confirm it recovers the delivery and tracking resumes correctly.
  8. **Rider ownership**: a second rider attempts to POST a location to the first rider's delivery — 409/404 as designed, no data written.
  9. **Customer isolation**: a second customer/order pair confirms neither customer can see the other's stream (§9's matrix, live).
  10. **Closed deliveries**: for each of DELIVERED, FAILED, CUSTOMER_UNAVAILABLE, CANCELLED — confirm a location write after that point is refused and the stream (if still open) closes.
  11. **Failed delivery**: rider reports a failure on the real device; confirm tracking stops device-side and the customer map correctly shows the closed/unavailable state.
  12. **Failed → re-stage → new delivery → new tracking session**: admin re-stages, a rider is reassigned, picks up the new delivery on the real device; confirm tracking starts fresh against the new delivery id and the customer sees a new live stream, never the old delivery's stale identity.
  13. **Duplicate/high-frequency submissions**: send two location POSTs in immediate succession; confirm the second is silently throttled and the customer never sees a spurious jump.
- [ ] Baseline restored (orders/deliveries/notifications/addresses/users) after the run, per the established convention.
- [ ] **Regression check (binding: "keep all existing Blynk lifecycle, security, concurrency and authorization rules unchanged").** Run the full pre-existing backend suite — `order-lifecycle.test.ts`, `order-lifecycle-guard.test.ts`, `order-lifecycle-catalogue.test.ts`, `rider-delivery.test.ts`, `security.test.ts`, and every other existing test file — and confirm every one passes exactly as it did before this phase, with the same counts. This phase must add tests, never change the meaning of an existing one.

---

## Task V2: Documentation

**Files:** Modify `docs/05-implementation/implementation-status.md`; Create `docs/05-implementation/blynk-live-location-tracking-report.md`

- [ ] Write the implementation report (same format as the prior three phases' reports): what was built, the D1–D6 decisions as actually implemented (noting D4's mid-plan revision from `google_maps_flutter` to MapLibre + self-hosted PMTiles), the map-tile-hosting setup doc's key points restated, test counts, live E2E results, and known limitations (e.g. iOS not scoped, the single-process SSE fan-out's documented multi-replica migration trigger, the community background-geolocation plugin's maintenance-risk note from §1.3, the self-hosted tile archive's manual rebuild cadence from Task M0).
- [ ] Add the "Live Location & Delivery Tracking (COMPLETE)" section to `implementation-status.md`, matching the established format of every prior phase's section.

---

## Self-review

- **Spec coverage:** every one of §D's 15 additional requirements is implemented by a specific task (traceable via the `plan §…`/`§D.…` citations inside the code comments themselves, not just this plan's prose) — the tracking window (B2), stop-on-every-terminal-state (B2's closed-state test loop), re-stage identity (B2's dedicated test), authorization chain (B2), lifecycle-engine bypass (B2, mechanically verified in B5/M7), customer isolation (B4), no history (B1/B3/B4's column and query shapes), SSE-first (B3/B4/M3), tile-hosting docs-before-code (M0 gates M1+), no Admin map (nothing in §N touches `apps/admin`), no ETA (M7's grep check), no fake GPS (R2/M6's injectable-plugin pattern, checked at M7), and the full test-scenario list (B2, R2, M3, V1). The map-provider swap's own new requirements are covered the same way: no Google Maps anywhere (M7's grep check), the `MapProvider`/`TrackingMapView` isolation (M4 defines it, M7 mechanically verifies exactly one importing file), and the self-hosted-tiles-with-documented-fallback design (M0).
- **Placeholder scan:** the spots flagged inline (`tracking-plugin.ts`'s real Capacitor calls, `LocationProvider`'s `_decode` naming, `maplibre_map_view.dart`'s exact `CircleManager`/`CircleOptions` field names and the OSM extract/tile-build tool's exact current command in Task M0) are explicitly called out as "implement/verify against the installed plugin/library/tool version" rather than silently vague — each is a narrow, named gap (an external library's exact call signature or an external tool's exact current command, not yet installed/run at plan-writing time) rather than unspecified logic; every other line of code in this plan is complete and runnable as written.
- **Type consistency:** `TrackingPoint`/`TrackingPlugin`/`DeliveryTracker` (R2) are used with identical shapes in R3; `RiderLocationPoint`/`LocationFreshness`/`classifyFreshness` (M2) are used identically in M3 and M4; `LocationProvider.current/freshness/closed/watch/stopWatching` (M3) are used identically in M4/M5; backend `LocationEvent` (B3) is used identically in B2 and B4; `GeoPoint`/`MapMarkerSpec`/`MapMarkerTone`/`TrackingMapView`/`LocationPickerMapView` (M4) are used identically in M4's own `OrderTrackingMap` and in M6's picker screen, and appear nowhere else (M7's grep check is the mechanical proof of that last point).

**Once approved, execution should follow `superpowers:subagent-driven-development`** (a fresh implementer + reviewer per task, exactly as the prior three phases in this repository were executed) **or `superpowers:executing-plans`** for a parallel-session run — the choice is the user's, to make when they say to proceed.
