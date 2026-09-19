# Home Promotional Carousel — Implementation Report

## 1. Existing implementation inspected

Before writing any code, the following were inspected directly:

- `lib/Screens/home_screen.dart` — the `CustomScrollView` slivers order (`HomeScreenAppBar` → `HomeScreenSearchBar` → `HomeScreenCarousel` → categories → product sections), confirming the carousel's slot in the existing architecture did not need to move.
- `lib/UI/Widgets/Organisms/home_screen_carousel.dart` — the previous implementation: a `StatelessWidget` wrapping a `PageView.builder` of 5 static `Container`s, each showing `Assets/cimgs/${index+1}.jpg` via `DecorationImage`. No headline, no CTA, no indicators, no auto-scroll — a raw image slideshow.
- `lib/app_responsive.dart` — the shared breakpoint utility built in the prior Home-screen responsiveness pass (`Responsive.of(context)`, `isDesktop`/`isTablet`, `contentMaxWidth`). Reused as-is; not duplicated.
- `lib/app_colors.dart` — confirmed `AppColors.primaryGreenColor` (`#0C831F`) and `AppColors.primaryYellowColor` (`#FFE141`) are the only approved brand colors.
- `lib/route_generator.dart` and `lib/UI/Widgets/Atoms/category_widget.dart` — confirmed the real navigation pattern (`Navigator.pushNamed(context, '/products', arguments: categoryName)`) and the real category name strings in `lib/constants.dart` (`kCategoriesTitles`), so the CTA buttons navigate to genuine existing screens instead of dead buttons.
- `pubspec.yaml` and `Assets/` — confirmed available imagery (see §2).

## 2. Assets discovered

- `Assets/cimgs/1-5.jpg` — the old banner images (generic template ads, e.g. "Makeup & beauty needs" — unrelated to groceries). **Not reused**, since they don't represent real Blynk content.
- `Assets/Images/onboarding_groceries.png` — the grocery-basket photo already used on the onboarding screen (full-bleed, edge-to-edge photo, no dead whitespace). Reused as Slide 1's hero.
- `Assets/Products/1.png`–`Assets/Products/6.png` — existing product package photos (paneer, tofu snacks, oats, milk, etc.) already used on product cards elsewhere in the app. Six were visually inspected; four were selected across Slides 2 and 3 as small circular "product chips."
- No Lottie/Rive/GIF asset exists that depicts genuine promotional motion — confirmed via the same asset-search approach used in the earlier onboarding-animation task. **No new image or animation asset was generated** for this feature; every visual is an existing project asset, and all motion is applied via Flutter's own animation APIs.

## 3. Carousel architecture

`lib/UI/Widgets/Organisms/home_screen_carousel.dart` was rewritten in place (same `HomeScreenCarousel` widget name and constructor, so `home_screen.dart` required no changes). It is now a `StatefulWidget`:

- `PageController` + `PageView.builder` over 3 `_PromoSlideData` entries (title, badge, CTA label + destination category, gradient colors, hero image or hero cluster).
- Each slide renders inside a rounded (`24px`), gradient-backed card: left side = badge → headline → CTA button; right side = either one full-bleed photo (`_FloatingHero`) or two circular product chips (`_HeroCluster`).
- Page indicators below the banner: an elongated pill for the active slide, small dots for inactive ones, driven by `_currentPage` state.

## 4. Number of slides

Three, using only real existing assets/content:

1. **Fresh Groceries / Delivered Fast** — hero: grocery basket photo. CTA "Shop Now" → `Fruits & Vegetables`.
2. **Everyday Essentials / At Your Doorstep** — hero: milk + tofu-snack product chips. CTA "Explore" → `Dairy, Bread & Eggs`.
3. **Fresh Picks / For Your Home** — hero: paneer + Amul Gold milk product chips. CTA "Shop Fresh" → `Breakfast & Instandt Food` (existing category string, typo preserved as-is — not introduced by this change).

## 5. Animation approach

Per the explicit instruction not to animate the whole banner as one rigid image, motion is layered and independent:

- **Text entrance** (badge → headline → CTA): `AnimatedSlide` + `AnimatedOpacity`, staggered by 0/60/120ms, driven by `isActive` (`index == currentPage`). Plays on every slide change, not just app launch.
- **Single-photo hero** (Slide 1): a separate, continuously-running `AnimationController` (`_FloatingHero`) applies a subtle vertical float (±5px) and breathing scale (1.0–1.015), independent of and not synchronized with the text animation.
- **Product-chip hero** (Slides 2–3): each chip (`_FloatingChip`) has its **own** `AnimationController` with a phase-delayed start (0ms and 300ms), so the two chips float independently rather than moving in lockstep — genuine "layered, independent movement" rather than a single moving rectangle.
- All motion is subtle (a few pixels / ~1.5% scale) and continuous, not bouncy or attention-grabbing, per the "premium, not gimmicky" requirement.

**Honesty note**: no genuinely animated (Lottie/Rive) promotional asset exists in the project. This carousel achieves motion by animating existing static images with layered Flutter transforms — not by pretending a static asset is a character animation. This matches how the same constraint was handled and reported in the earlier onboarding-animation task.

## 6. Auto-scroll behavior

- `Timer.periodic(Duration(seconds: 5))` advances to the next page via `_pageController.animateToPage(..., duration: 500ms, curve: Curves.easeInOut)`, wrapping back to slide 0 after the last slide.
- Verified live: on a fresh app launch, the carousel was observed advancing from Slide 1 to Slide 3 without any manual interaction, confirming the timer fires as designed.
- Manual swipe (`onPageChanged`) calls `_startAutoScroll()` again, which cancels and restarts the timer — so a manual swipe doesn't fight the next scheduled auto-advance, and rotation resumes cleanly from wherever the user left it.
- `dispose()` cancels the timer and disposes the `PageController`, and each `_FloatingHero`/`_FloatingChip` disposes its own `AnimationController` — no leaked timers or controllers.

## 7. Swipe behavior

Standard `PageView` horizontal drag, unchanged from the existing project's carousel pattern (same mechanism already proven to work correctly on the onboarding screen's carousel in an earlier task). The banner's horizontal drag axis and the Home screen's vertical `CustomScrollView` axis are resolved automatically by Flutter's gesture arena — no custom gesture-disambiguation code was needed or added.

## 8. CTA behavior

Each CTA (`Shop Now` / `Explore` / `Shop Fresh`) calls `Navigator.of(context).pushNamed('/products', arguments: <realCategoryName>)` — the exact navigation pattern already used by `CategoryWidget` elsewhere in the app, targeting real category strings from `kCategoriesTitles`, not placeholder/dead buttons.

**Limitation**: CTA taps were not exercised via live UI automation in this session (direct mouse-click synthesis proved unreliable against this Flutter Windows build throughout this work session — wheel/scroll events register, discrete clicks largely don't). Confidence here is from direct code inspection confirming the route exists, accepts a `String` argument, and is reached via the identical call pattern already working elsewhere in the app — not from an on-screen click observed to navigate.

## 9. Responsive behavior

Reuses the existing `Responsive` utility (`lib/app_responsive.dart`) rather than introducing new breakpoint logic:

- Banner height: `180` (mobile) / `200` (tablet) / `220` (desktop) — compact at every tier, never pushes products far below the fold.
- Banner width: fills the Home screen's existing centered, max-width-capped content column (from the earlier Home-screen responsiveness pass) — so on desktop it doesn't stretch edge-to-edge, and doesn't sit as a small mobile-sized box in a wide viewport either.
- Verified visually at 420px (mobile), 600px, 750px, and 1500px (desktop) window widths: card scales correctly, product chips remain non-overlapping and fully visible at desktop width, category grid and header from the earlier responsive pass remain intact.
- Text/CTA font sizes step up slightly on desktop (`isDesktop` ternaries) for readability at larger card sizes.

## 10. Performance considerations

- Each slide's `AnimationController`s live inside the `PageView.builder`'s per-item widgets, matching the same lifecycle pattern already used (and proven) in the onboarding carousel: controllers start/stop with the item's own `initState`/`dispose`, not tied to the whole Home screen's rebuild cycle.
- `AnimatedBuilder` wraps only the transformed subtree (image/chip), so each tick only repaints that small widget, not the surrounding card or the rest of the Home screen.
- No new packages, no network-dependent assets, no video. All imagery is local, already-bundled `Image.asset` calls using Flutter's default asset caching.

## 11. Files modified

- `lib/UI/Widgets/Organisms/home_screen_carousel.dart` — full rewrite (in place; same public widget name/constructor).

No other files were changed for this task. `lib/main.dart`'s `initialRoute` was temporarily pointed at `/home` twice during this session purely to visually verify the carousel without relying on unreliable click automation, and was reverted to `/` both times before finishing — confirmed via `git diff`/re-read after each revert.

## 12. Flutter analyze result

Clean for the changed file. Project-wide: 8 pre-existing `info`-level lints in unrelated files (`otp_verification_screen.dart`, `coupons_screeen.dart`, `order_confirmation_screen.dart`, `user_orders_screen.dart`, `add_to_cart_button.dart`, `home_screen_search_bar.dart`, `login_screen_otp_sheet.dart`) — all pre-date this change (`deprecated_member_use` / `use_build_context_synchronously`), none introduced by it.

## 13. Flutter test result

`flutter test` → **16/16 passing**. No test file required changes for this task.

## 14. Remaining asset limitations

- No genuinely animated promotional asset (Lottie/Rive) exists in the project — see §5's honesty note. If true character/product animation (not layered transforms on static images) is wanted later, a real animated asset would need to be supplied.
- Product-chip imagery (`Assets/Products/*.png`) are flat product-package photos on plain backgrounds, not isolated/transparent cutouts — acceptable inside a circular clip (as used here) but not suited to non-circular "floating fruit" style compositions without new assets.
- CTA navigation was verified by code inspection, not by an observed live click (see §8) — the underlying screen-automation tooling used throughout this session could not reliably synthesize discrete mouse clicks against this Flutter Windows build.

---

STATUS: PREMIUM HOME PROMOTIONAL CAROUSEL COMPLETE
