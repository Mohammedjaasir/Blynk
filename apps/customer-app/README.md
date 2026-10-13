# Blynk customer app (Expo)

The Blynk customer app for the Dharga Town store. A React Native (Expo SDK 57) app whose
screens, flow and animations started from the owner's Toing-style "tokri" build; all motion
is **react-native-reanimated 4**. It reads the real Blynk catalogue and store settings
(GET only in this phase) and uses Blynk colours and branding.

## Run it

```bash
cd apps/customer-app
npm install
EXPO_PUBLIC_API_BASE_URL=http://localhost:4000/api/v1 npx expo start   # "w" for web
npm test            # vitest: pricing, money, cart, store text, API client, live refresh
npx tsc --noEmit && npx expo lint
EXPO_PUBLIC_API_BASE_URL=https://<api>/api/v1 npx expo export -p web --output-dir dist   # served at /app/
```

The web build is served under `/app/` (`experiments.baseUrl`); the host must send
`/app/*` to `/app/index.html`.

## Data

`src/blynk/` holds the Blynk data layer, ported from `apps/customer-web/src` (API client,
types, catalogue calls, `formatLkr`, offer pricing, cart store, store text, live refresh).
Everything Admin and Ops control (prices, offers, availability, categories, delivery fee,
free deliveries, opening hours, promotions) comes from the API; when a field is missing the
UI hides instead of guessing.

## Flow

Splash → Home → tap an aisle → "Fresh from the Dharga Town store" intro → Aisle → add items →
View cart → Login (phone, preview) → OTP (preview, nothing sent) → address map (preview) →
Place order shows "Ordering from the new app opens soon" (ordering is wired in a later phase).

## Animation map (original video → this app)

| Video time | Original animation | Where it lives |
|---|---|---|
| 0:00.4 | Launcher icon grows into full-screen green card | `src/app/index.tsx` |
| 0:01–0:05 | "Locating…" header, skeleton shimmer, then content fades in | `src/app/home.tsx` (`LocationRow`, `FeedSkeleton`), `Skeleton` in `src/components/ui.tsx` |
| 0:06–0:16 | Search placeholder rolls through dishes | `SearchBar` + `RollingText` |
| 0:06–0:16 | "FREE DELIVERY" letters wobble, UFO bobs, beam abducts real product photos, sparkles on the lowest price | `src/components/Banner.tsx` |
| 0:08 | Location-permission bar → slides away after GRANT, page re-locates | `home.tsx` (location sheet, `grant`) |
| 0:11 | Green "No packaging fee / No platform fee / delivery" strip slides up, hides on scroll | `home.tsx` (`feeStrip`) |
| 0:12–0:30 | "Offer price" ⇄ "You save LKR n" flip (only when an offer is on and Admin shows savings) | `PriceTicker` in `ui.tsx` |
| 0:16 | Categories stick to top, filter chips slide in under them | `home.tsx` (`stickyHeaderIndices`, `chipsA`) |
| 0:17–0:30 | Rotating "FREE DELIVERY" stamp on aisle cards (only while free deliveries are on) | `StampBadge` |
| 0:23 | Green band (cash on delivery, no platform/packaging fee) with waving scooter | `PromoBand` |
| 0:25 | Floating black "Search" pill springs up after scrolling | `home.tsx` (`pillA`) |
| 0:30.8 | "+" springs open into "− 1 +" stepper, number rolls | `AddButton` in `ui.tsx` |
| 0:31.7 | "Fresh from the Dharga Town store" — green arcs chase around a real price list | `src/app/opening.tsx` |
| 0:32–0:36 | Aisle hero collapses into a sticky "Search in …" bar with filter chips | `src/app/store/[id].tsx` |
| 0:32 | Green cart bar slides up; count/price roll; bar jiggles on add | `src/components/CartBar.tsx` |
| 0:36.8 | "People usually pair this with" unfurls below the row | `PairPanel` in `store/[id].tsx` |
| 0:38 | First item while free deliveries are on: "Yay! FREE delivery" strip unfurls + confetti burst | `CartBar.tsx` + `Confetti` |
| 0:32+ | MENU fab rides up above the cart bar; opens the sub-category popover | `store/[id].tsx` (`fabA`, `MenuPopover`) |
| 0:41–0:42 | Cart skeleton shimmer | `CartSkeleton` in `src/app/cart.tsx` |
| 0:43–0:47 | "Hurray! Free delivery unlocked" (first N orders) pops in, drain bar auto-dismisses | `HurrayModal` |
| 0:48–0:53 | Fee pill bursts into full-bleed header with a sweep, cycles "FREE DELIVERY / FIRST N ORDERS ✓" (tick draws) / "LKR 0 packaging · platform fee" | `src/components/FeeHeader.tsx` |
| 0:48 | Bobbing "Tap here if you need a carry bag" tooltip | `Tooltip` |
| 0:54 | Login bottom sheet, floating label, Continue lights up at a 9-digit +94 number | `LoginSheet` in `cart.tsx` |
| 0:58–1:05 | OTP: active underline grows; Verify drops an honest "preview, nothing sent" banner | `src/app/otp.tsx` |
| 1:05–1:08 | Bottom CTA swaps to "Add or Select address", charges from pale to green | `GlowButton` |
| 1:08 | "Complete your basket" expands with skeleton → items | `CompleteBasket` |
| 1:12–1:18 | Map preview: pin drops in, tooltip, pulsing blue dot, drag lifts pin (illustrative streets) | `src/app/address.tsx` |
| — | Order placed: ring + tick draw, confetti (kept, unreachable until ordering is wired) | `src/app/placed.tsx` |

The table maps the original recording's moments; in the Blynk build the copy and data in each
moment were changed to what Blynk can back (see `.superpowers/sdd/tokri-wiring/report.md`).
