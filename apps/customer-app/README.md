# tokri — grocery delivery app (Toing-style)

A React Native (Expo SDK 57) app that recreates the screens, flow and animations of
Swiggy's **Toing** app from a screen recording, re-themed for a **grocery shop**.
All motion is built with **react-native-reanimated 4**.

## Run it

```bash
cd tokri
npm install
npx expo start        # scan the QR with Expo Go (Android / iOS), or press "w" for web
```

## Flow

Splash → Home → tap a store → "Mandi price matched" interstitial → Store → add items →
View Cart → Login (phone) → OTP (auto-filled) → pick address on the map → Place order.

## Animation map (original video → this app)

| Video time | Original animation | Where it lives |
|---|---|---|
| 0:00.4 | Launcher icon grows into full-screen green card | `src/app/index.tsx` |
| 0:01–0:05 | "Locating…" header, skeleton shimmer, then content fades in | `src/app/home.tsx` (`LocationRow`, `FeedSkeleton`), `Skeleton` in `src/components/ui.tsx` |
| 0:06–0:16 | Search placeholder rolls through dishes | `SearchBar` + `RollingText` |
| 0:06–0:16 | "BROKE HOURS" letters wobble, UFO bobs, beam abducts dish and drops the next, sparkles on ₹49 | `src/components/Banner.tsx` |
| 0:08 | Location-permission bar → slides away after GRANT, page re-locates | `home.tsx` (location sheet, `grant`) |
| 0:11 | Green "₹0 Packaging / Platform fee" strip slides up, hides on scroll | `home.tsx` (`feeStrip`) |
| 0:12–0:30 | "Other apps ₹x" ⇄ "Our app: n% lower" flip on every card | `SavingsTicker` in `ui.tsx` |
| 0:16 | Categories stick to top, filter chips slide in under them | `home.tsx` (`stickyHeaderIndices`, `chipsA`) |
| 0:17–0:30 | Rotating "EVERYDAY LOWEST PRICE" stamp on store cards | `StampBadge` |
| 0:23 | Green promo band with waving mascot | `PromoBand` |
| 0:25 | Floating black "Search" pill springs up after scrolling | `home.tsx` (`pillA`) |
| 0:30.8 | "+" springs open into "− 1 +" stepper, number rolls | `AddButton` in `ui.tsx` |
| 0:31.7 | "Offline menu price matched" — pink arcs chase around the menu | `src/app/opening.tsx` |
| 0:32–0:36 | Store hero collapses into a sticky "Search in …" bar with chips | `src/app/store/[id].tsx` |
| 0:32 | Green cart bar slides up; count/price roll; bar jiggles on add | `src/components/CartBar.tsx` |
| 0:36.8 | "People usually pair this with" unfurls below the row | `PairPanel` in `store/[id].tsx` |
| 0:38 | Crossing ₹149: "Yay! FREE delivery" strip unfurls + confetti burst | `CartBar.tsx` + `Confetti` |
| 0:32+ | MENU fab rides up above the cart bar; opens section popover | `store/[id].tsx` (`fabA`, `MenuPopover`) |
| 0:41–0:42 | Cart skeleton shimmer | `CartSkeleton` in `src/app/cart.tsx` |
| 0:43–0:47 | "Hurray! Free delivery unlocked" pops in, drain bar auto-dismisses | `HurrayModal` |
| 0:48–0:53 | Fee pill bursts into full-bleed header with a sweep, cycles "PRICE MATCH ✓" (tick draws) / "₹0 Packaging · Platform fee" | `src/components/FeeHeader.tsx` |
| 0:48 | Bobbing "Tap here if you need cutlery" tooltip → carry bag | `Tooltip` |
| 0:54 | Login bottom sheet, floating label, Continue lights up at 10 digits | `LoginSheet` in `cart.tsx` |
| 0:58–1:05 | OTP: active underline grows, SMS banner drops, code types itself in | `src/app/otp.tsx` |
| 1:05–1:08 | Bottom CTA swaps to "Add or Select address", charges from pale to green | `GlowButton` |
| 1:08 | "Complete your meal" (→ basket) expands with skeleton → items | `CompleteBasket` |
| 1:12–1:18 | Map: pin drops in, tooltip, pulsing blue dot, drag lifts pin, card re-resolves | `src/app/address.tsx` |
| — | Order placed: ring + tick draw, confetti (new) | `src/app/placed.tsx` |

Product images are emoji on pastel tiles so the app runs with no image assets;
swap `emoji` in `src/lib/data.ts` for real photos when you have them.
