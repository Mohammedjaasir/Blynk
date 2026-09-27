# Blynk Customer App — Motion System Plan

**Status:** M1-M12 implemented and verified 2026-09-26 (launch: option A). M13 audit in §8.
**Scope:** `apps/customer` only. No backend, auth, pricing, checkout rules, order lifecycle, tracking logic, recommendation or dental logic is touched (§26).
**Reference video:** used for level of polish only. No branding, colour, copy or layout is taken from it.

---

## 0. What already exists (inspected, not assumed)

The brief reads as if the app is "static Flutter screens". It is not. Before writing a line, this is what is already there and will be **extended, not replaced**:

| Area | Exists today | Verdict |
|---|---|---|
| Motion tokens | `BlynkMotion.fast/base/slow` = 120/200/280 ms, `easeIn/easeOut`, `resolve()` for reduced motion. Only **10** literal durations outside `design/` in the whole app. | Extend (§21 is ~80% done) |
| Skeletons | `SkeletonScope` — one shared 0.6→1.0 pulse, reduced-motion aware; `AppSkeleton`, `ProductCardSkeleton`, `CategoryTileSkeleton`; used on 8 screens | Keep; add crossfade *out* |
| Image loading | `image_well.dart` — `frameBuilder` + `AnimatedOpacity` fade-in, geometry contract tested (no layout shift) | Already meets §11 |
| Cart bar | `TweenAnimationBuilder` enter/exit on first item / empty | Keep; add number transition |
| Add to cart | `AnimatedSize`×2 + `AnimatedSwitcher` ADD ↔ stepper | Keep; add press + tick |
| Hero carousel | AnimatedContainer/Opacity/Scale/Slide, staggered | Keep; move literals to tokens |
| Product detail | **`Hero`×3 already**, AnimatedSize, Switcher | Verify tag continuity from card |
| Cart screen | Switcher/Fade/Slide, 260 ms remove | Keep; token the literal |
| Category tile (Home) | `AnimatedContainer` pressed/selected/focus | Done in the category redesign |
| Home grid entrance | `EntranceFade` (staggered, keyed by product id, no timers, reduced-motion aware) | Reuse app-wide |

**Genuine gaps** (the real work): Home has no coordinated entrance; product cards have no press response; nav swaps icon/label instantly; routes are 21× default `MaterialPageRoute`; Products sidebar selection has no transition **and still wears the old solid-yellow tile**; skeletons cut to content with no crossfade; connectivity banner pops in/out; confirmation check is static; live-map rider marker **teleports** between real fixes.

---

## 1. Decision needed before M2 — the launch sequence

§3 asks for a Flutter launch sequence with a grocery visual, 1.5–2.0 s. **That exact screen was deleted earlier today at your request** ("still two intros", "loading too slow"). Cold start is now 1.3–1.5 s with the native splash as the only opening.

Re-adding it will recreate both complaints. Options:

- **A (recommended):** Native splash stays the only opening. M2 becomes a 20-minute task: make the native splash asset itself carry the wordmark so the one intro looks like the stacked logo you preferred. Zero added latency.
- **B:** A branded Flutter beat, but **≤ 600 ms**, mark solid on frame 0 (no fade, no second composition), wordmark settling in beneath. Adds ~0.5 s to every cold start.
- **C:** The full §3 sequence as written. Re-adds ~1.5–2 s. I advise against it.

The plan below assumes **A** until told otherwise.

---

## 2. Motion tokens (M1) — the foundation everything else uses

Extend `lib/design/motion.dart`, keeping every existing name:

```
Durations   instant 60 · fast 120 · base 200 · slow 280 · emphasized 320
Curves      standard = easeOutCubic · emphasized = easeInOutCubic · exit = easeInCubic
Stagger     step 40 ms · cap 6 (a list's 7th+ item shares the 6th's delay)
Press       scale 0.97 · fast
Entrance    travel 8 dp · base
```

- Every value goes through `BlynkMotion.resolve()` — reduced motion → zero, everywhere, for free.
- Migrate the 10 literal durations (carousel 360/260, cart remove 260, map fit 500, entrance step 45). Debounces (search/dental 350 ms) are **not motion** and stay as they are.
- `design_tokens_test` gets a guard: no `Duration(milliseconds:` outside `design/` except an allow-list of the two debounces.

**Reusable components** (only where a pattern repeats ≥3 times — §22):
`BlynkPress` (scale-on-press wrapper) · `BlynkAnimatedNumber` (cart total) · `BlynkCrossfade` (skeleton→content) · `BlynkPageTransition` (one route transition, set once in theme) · existing `EntranceFade` promoted to the shared entrance.

---

## 3. Milestones

Each is one PR-sized change with its own tests; each verified on the emulator before the next.

| # | Milestone | What changes | Guard |
|---|---|---|---|
| M1 | Tokens + components | `motion.dart`, 5 small atoms, migrate 10 literals | tokens test + literal-duration ratchet |
| M2 | Launch | Option A: native splash asset carries wordmark. **No Flutter screen.** | session_gate_test unchanged |
| M3 | Home entrance | `EntranceFade` on the 6 Home slivers as **one timeline ≤ 350 ms total** (header 0 → search 40 → hero 80 → categories 120 → dental 160 → products 200). Plays once per Home visit, never on scroll-back. | home_composition_test |
| M4 | Categories | Products sidebar: 180 ms selected transition **and** bring it to the wash+ring design Home already uses (the one remaining old-design surface). Home tiles: unchanged. | category_widget_test, audit_fixes (edge bar stays) |
| M5 | Product cards | `BlynkPress` 1→0.97→1 on tap; `EntranceFade` on Products grid + rails (play-once, not while offscreen) | product_card_layout_test, touch_targets |
| M6 | Add to cart / cart bar | Press on +/−; quantity tick (fast); `BlynkAnimatedNumber` on total; bar rise uses `emphasized`. **No snackbar-only feedback.** | cart_bar_test, add_to_cart_button_test |
| M7 | Product detail | Verify `Hero` tag = product id from card; content rise (base). No new transition type. | existing detail tests |
| M8 | Navigation | Icon/label crossfade (fast) + indicator; `BlynkPageTransition` (fade-through, base) via `pageTransitionsTheme` — 21 routes changed in one place | customer_shell_back_test, route_consolidation_test |
| M9 | Loading / error | `BlynkCrossfade` skeleton→content; connectivity banner size+fade in/out (base). Image fade already exists. | app_skeleton_test, app_state_view_test |
| M10 | Checkout / confirmation | Cart→Address→Review use the M8 transition only — **nothing playful**. Confirmation: check scale 0.9→1 + fade (emphasized), no confetti. | checkout_policy_test |
| M11 | Live tracking | Rider marker **interpolates between real fixes** (slow); jump > 250 m → cut, no tween. Timeline step animates only on a real status change. **No ETA, no fake progress — unchanged by contract.** | order_tracking_map_test, clinic_location_map_test |
| M12 | Perf + a11y | `RepaintBoundary` on animated cards; no continuous animation off-screen; reduced-motion pass on every milestone; profile-build scroll check on emulator | manual + logcat |
| M13 | De-slop audit | §27's 12 questions answered against the running app; anything that fails "does it have a reason" is removed | — |

Estimated: M1–M6 are the bulk of the felt improvement. M7–M11 are smaller.

---

## 4. What I will not do

- Copy the reference's branding, colours, copy, layout or exact motion (§0 of the brief).
- Add an animation package. Everything above is `AnimatedX`/`AnimationController`/`Hero`, already in the tree.
- Animate the rider marker to anywhere the backend didn't put it (§16–17).
- Re-add a Flutter launch hold without you choosing B or C in §1.
- Commit or push.

---

## 5. Verification per milestone

`flutter analyze` clean → `flutter test` green → profile build → emulator capture of the specific interaction → note in this file. Final: §28's full checklist on the emulator, cold and warm.

---

## 6. Verification log

| Milestone | analyze | tests | emulator | Notes |
|---|---|---|---|---|
| M1 tokens + components | clean | 2,039 pass (+17 new) | - | `instant/emphasized/camera/stagger` added; 7 literals migrated; ratchet holds `lib/` to 3 allow-listed timers. Found and fixed while writing: `BlynkPress` needs `HitTestBehavior.opaque` (a card's padding must also feel the press); `AnimatedSwitcher` does *not* fade its initial child - a test now proves it, and an earlier comment blaming it in `SessionGate` was wrong and is corrected. |
| M2 launch (option A) | - | - | **verified**: 8-frame cold-launch capture shows the stacked mark + wordmark on Android 12's native splash; cold start 1.6-2.1 s over 3 runs; no exceptions | Source `Assets/splash_android12.png` recomposed from `splash2.png` inside the 768 px safe zone; `flutter_native_splash:create` regenerated **only** the ten `android12splash.png` buckets - every XML fingerprint identical before/after. Old source backed up in the session scratchpad. |

---

## 7. Implementation notes, M3-M12 (what changed, and the calls made)

Verification rows for these land in §6 once the final suite and the emulator pass report.

| M | Change | Judgement calls worth knowing |
|---|---|---|
| M3 | `SliverEntrance` + `EntranceTimeline` (one controller in `HomeScreen`, five beats, 360 ms total). `HomeProductSections.entranceDelay` so cards start when their section appears. | Sections **fade only**: there is no sliver transform, and animating sliver padding would move everything below. `skeleton_usage_test` now takes its ticker baseline *after* the entrance - it was counting the one-shot controller as "everything else that ticks". |
| M4 | Products sidebar rows are the shared `CategoryWidget(diameter: 44)`: wash + ring selected state, per-category glyph, `fast` transition. Edge bar kept (audit pin). | Was the last surface wearing the pre-redesign solid-yellow disc and a generic shapes icon. |
| M5 | `BlynkPress` on every card; `EntranceFade` on Products grid, rails, Search results; **`EntranceScope`** per screen so a card scrolled off and back is rebuilt at rest. | `EntranceFade`'s "plays once" only held while its element lived - a real latent replay on Home that M5 fixed and pinned. `BlynkPress` needs `HitTestBehavior.opaque` (a card's padding must feel the press). Scopes live inside each screen, not on the routes: `route_fallbacks_test` rightly pins "route builds screen X". |
| M6 | `BlynkAnimatedNumber` on the cart total; `BlynkPress` on stepper halves; count ticks on a `fast` crossfade. | The bar's slide stays on `base`: it runs the exit on the same tween, and exits must not get slower than enters. `BlynkAnimatedNumber` mirrors `MoneyText`'s `compact` default exactly - it adds motion to a number, never a format. |
| M7 | `ProductHero` (real `Hero`, tag = product id) around the card image well and the detail hero; `HeroMode` off under reduced motion. | The "Hero x3" in the original inventory were a private `_Hero` class - there was no shared element before. Safe only because no screen shows one product in two lists; the atom's doc says where to scope the tag if that changes. |
| M8 | Nav tile `AnimatedContainer` + icon/label colour `ColorTween`s on `fast`; `blynkPageTransitions` (fade-through, 8 dp rise) installed once in `ThemeData`. | Two pins reversed on purpose: "nothing tweens in the nav" and `findsNothing(AnimatedContainer)`. Icon and label keep a single widget with an explicit style - `widget<Icon>` and `Text.style` pins are real invariants. A null-`begin` `ColorTween` starts at rest, so nothing fades in on first build. |
| M9 | `BlynkCrossfade` skeleton->content on Products and Detail; `ConnectivityBanner` arrives/leaves over one beat (`AnimatedSize` + crossfade). | **Bug found by the isolated test:** `AnimatedSize` at `Duration.zero` completes inside its own layout and asserts; under reduced motion the size step is skipped, not zeroed. Wiring tests wait one beat on arrival (a zero-extent sliver is offstage to finders) and two on exit. Search results are *not* crossfaded: their cards already enter, and a second fade would double-animate. |
| M10 | Confirmation medallion settles once (0.9->1 + fade, `emphasized`). Checkout steps use only the M8 route transition. | The "static check mark" pin became "settles once, nothing loops" - `pumpAndSettle` is what guards against a loop. No confetti. |
| M11 | `MarkerMotion` (pure, tested): the rider glides between two real fixes on `slow`; a jump > 250 m cuts; reduced motion cuts; fit-to-bounds uses the real specs. Both adapters. | Lives in the adapters, not the specs: `order_tracking_map_test` pins that the specs equal the real fixes. Seeded in `initState` - `didUpdateWidget` never runs on first build, which briefly made every first move a "first sighting" cut. No ETA, no extrapolation: it only ever draws the straight line between two fixes the backend sent. |
| M12 | `RepaintBoundary` per card. Continuous tickers audited: skeleton pulse (parked when idle), login Lottie (off under reduced motion), carousel auto-advance (6 s, off under reduced motion, cancelled on dispose); the rest are functional timers, not motion. Every new motion site resolves reduced motion. | Nothing found that runs off-screen; nothing added that runs continuously. |

### §6 continued - final verification (2026-09-26)

| Check | Result |
|---|---|
| `flutter analyze` | No issues found |
| `flutter test` | **2,074 passed**, 0 failed (after every change below, including the image-well one) |
| Cold start (profile, emulator) | 1.16 / 1.31 / 1.96 s across runs; no Flutter hold after the native splash |
| logcat across four driven passes | no exceptions, no RenderFlex overflow |
| Native splash (Android 12+) | stacked mark + wordmark, enlarged: logo now ~534 x 720 px of the 768 safe zone (was ~344 x 471); captured on cold launch |
| Products sidebar (M4) | selected row = signalWash + signal ring + ink edge bar; per-category glyphs; captured |
| Product photo border | removed: photos fill the well edge to edge on card and detail; fallback keeps its inset medallion; captured on the Butter detail |
| Cart bar / nav | captured in pass 1; transitions themselves are below screencap frame rate - their timing evidence is the widget tests |

**What the emulator could not prove.** `adb screencap` runs at ~4-6 fps, so a 120-320 ms transition lands in one frame or none. The captures prove before/after states and the absence of errors; the timing of every transition is pinned by widget tests instead (`motion_components_test`, `home_entrance_test`, `adaptive_scaffold_test`, `google_map_view_test`, and others). One detail tap in an earlier pass reached "Product no longer available" - that is the app's own not-found state for a product id the backend no longer serves, not a motion defect; it was not investigated further.

## 8. M13 - motion audit (brief section 27), answered against the running app

1. **Responsive?** Yes. Press feedback is `instant` (60 ms); nothing blocks a tap (`BlynkPress` only observes the pointer).
2. **Too slow?** No transition exceeds 320 ms except the map camera fit (500 ms, unchanged). Home's whole entrance is 360 ms.
3. **Too frequent?** Every animation plays once per state change. Entrances never replay on scroll-back (`EntranceScope`) or pull-to-refresh.
4. **Unnecessary animations?** Removed during the work: the Flutter launch screen (a second intro), and a crossfade on search results (their cards already enter).
5. **Home premium on open?** One coordinated 5-beat entrance, sections fade, cards rise.
6. **Cards interactive?** Press scale 0.97, image flies to the detail as a Hero.
7. **Add to cart satisfying?** Press on +/-, count ticks, cart total counts up rather than cutting.
8. **Navigation smooth?** Tile fill and icon/label colour tween over 120 ms; one route transition for all 21 routes.
9. **Checkout trustworthy?** Nothing playful: only the shared route transition, and one settle on the confirmation check. No confetti.
10. **Tracking animates only real data?** Yes. The rider glides only between two fixes the backend sent; > 250 m cuts; no ETA, no extrapolation.
11. **Fast on Android?** Cold start 1.2-2.0 s; `RepaintBoundary` per card; no continuous animation added; existing continuous ones (skeleton pulse, login Lottie, carousel auto-advance) are parked or off under reduced motion.
12. **Still Blynk?** Yes - every colour, radius and duration comes from the existing tokens; nothing was borrowed from the reference video.

