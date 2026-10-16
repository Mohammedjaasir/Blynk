# Promo surfaces: the Home promo band and the promotion carousel

One spec for the two promotional surfaces of the new customer app
(`apps/customer-app`, Expo) so the app and the live previews in Admin
(`apps/admin`) and Blynk Ops (`apps/operations`) look and move the same.
Owner, 2026-10-14: "make sure promotional banner edit option like this
animation in the ops and admin" - both surfaces are editable in BOTH apps.

All sizes are in points at the design width of **390 pt** (a 390 pt phone; the
web previews draw a 390 px phone frame and scale it down only when the page is
narrower). Colours are Blynk's (`apps/customer-app/src/lib/theme.ts`).

| Surface | Customer app | Staff editors | Data |
| --- | --- | --- | --- |
| Promo band | `src/components/PromoBand.tsx` (render model: `src/blynk/promo/promoBand.ts`) | Admin `/promo-band`, Ops `Catalog -> Promo band` (`PromoBandEditor`, `PromoBandPreview`) | `GET/PATCH /admin/settings/promo-band`, public `GET /store` -> `promo_band` |
| Carousel | `src/components/PromoCarousel.tsx` (look + timings: `src/blynk/promo/carousel.ts`) - **not yet wired into Home** | Admin `/promotions`, Ops `Catalog -> Promotions` (`PromoCarouselPreview` in the editor and above the list) | `promotions` table, `GET /promotions`, `/admin/promotions` |
| Hero banner | `src/components/Banner.tsx` (render model: `src/blynk/promo/heroBanner.ts`) | Admin `/home-banner`, Ops `Catalog -> Home banner` (`HeroBanner`, `HeroBannerPreview`) | `GET/PATCH /admin/settings/hero-banner`, public `GET /store` -> `hero_banner` |

---

## 1. Promo band

The yellow band with scalloped edges that follows the 3rd aisle on Home (or
the last aisle when the store has fewer).

### Data (system_configurations `promo_band`, no migration)

```jsonc
{
  "enabled": true,                 // false = hidden
  "lines": ["Fresh bread daily"],  // 0-5 sliding headlines, 2-44 chars; [] = the app's own copy
  "ticks": ["No Platform Fee"],    // 0-3 ticked points, 2-24 chars;   [] = the app's own copy
  "background": "YELLOW",          // YELLOW | YELLOW_SOFT | CREAM | WHITE | INK | GREEN
  "text_color": null,              // null = automatic | INK | WHITE | YELLOW | BROWN | GREEN
  "item_kind": "NONE",             // NONE | ILLUSTRATED | IMAGE (the item in the light beam)
  "item_illustration": null,       // bread apple carrot egg broccoli banana milk rice cheese tomato fish chicken gift cart
  "item_image_url": null,          // uploaded through POST /admin/media (folder "promotions")
  "mascot": "WAVE",                // WAVE | RIDE | OFF
  "cta_destination_type": null,    // CATEGORY | PRODUCT | CATALOG (same levels as promotions)
  "cta_destination_value": null,   // category slug (category or sub-category) | product id | group id (Main) | null (whole catalog)
  "starts_at": null,               // ISO date-time, optional
  "ends_at": null                  // ISO date-time, optional, after starts_at
}
```

No row (or a malformed one) = the defaults above, with the app's own built-in
headline and ticks ("No sneaky fees. Ever." / No Platform Fee / No Packaging
Fee, `livePromo()` in `src/demo/homeLive.ts`; owner, 2026-10-15: a catchy line
over the true ticks, not bare checkmarks). A text colour must reach WCAG AA
(4.5:1) on both gradient stops or the API refuses it:

| background | gradient (top -> bottom) | readable text (first = automatic) |
| --- | --- | --- |
| YELLOW | `#FFE141 -> #F2C600` | INK |
| YELLOW_SOFT | `#FFEFA0 -> #FFE141` | INK, GREEN, BROWN |
| CREAM | `#FFF8D6 -> #FFEFA0` | INK, GREEN, BROWN |
| WHITE | `#FFFFFF -> #F4F4F6` | INK, GREEN, BROWN |
| INK | `#1A1D2E -> #2A2E45` | WHITE, YELLOW |
| GREEN | `#0C831F -> #0A6B19` | WHITE |

Text colours: INK `#1A1D2E`, WHITE `#FFFFFF`, YELLOW `#FFE141`, BROWN
`#7A5F00`, GREEN `#0A6B19`.

`GET /store` -> `promo_band` is what the app draws **now**: `null` while it is
off or outside its schedule; otherwise `{ lines, ticks, background, colors:
{start, end, text}, item: {kind, illustration, image_url}, mascot, cta_target,
ends_at }`. `cta_target` is the resolved destination (`level` MAIN / CATEGORY /
SUB_CATEGORY / PRODUCT / CATALOG), `null` when there is none or it is switched
off. An older API without the field = today's look.

### Layout

```
 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~  scallop 14 pt (top colour)
 |  [v] Headline that slides            beam  |  padding 14 top / 16 bottom / 18 sides
 |  [v] Tick one   [v] Tick two         (o) R |  R = mascot 74x74, right 10, bottom 2
 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~  scallop 14 pt (bottom colour, flipped)
```

- Band margin: 2 pt above, 22 pt below. Scallop: 26 pt period.
- Text: Outfit SemiBold 14 / line height 18, check-box icon 14 pt, gap 6.
  Headline row 9 pt above the ticks row; ticks 12 pt apart.
- Safe text width: 390 - 36 (padding) - 84 (mascot on) - 100 (item on).
  Long headlines wrap to at most 2 lines; the row keeps the tallest line's
  height so sliding never makes the band jump.
- Light beam: a cone 34 pt wide at the top, 96 pt at the bottom, full band
  height, `#FFFBE6` at 95 % fading to 0 %. Right edge 92 pt from the band's
  right with the mascot, 14 pt without. The item (52 x 52, `contain`, soft
  drop shadow) is centred in the beam at 56 % of the body height.

### Motion

| Element | Motion |
| --- | --- |
| Headlines (2+) | each holds **2800 ms**; out: up 10 pt + fade (200 ms, ease-in quad); in: from 12 pt below + fade (220 ms, ease-out quad). One line = static. |
| Mascot WAVE | rotate 0 -> 10 -> -10 -> 10 -> 0 deg (220 ms steps), hold 1400 ms, loop (2280 ms). |
| Mascot RIDE | drives in from 120 pt right (700 ms, ease-out cubic), then bobs 0 <-> -3 pt with -2 <-> 0 deg tilt (600 ms, in-out sine) forever. |
| Item | drops down the beam on mount (from -40 pt, scale 0.2; spring damping 12 / stiffness 150), then bobs +-3 pt (1300 ms, in-out sine). |
| Beam | opacity 0.85 <-> 1 with the item's bob. |
| Reduced motion | no loops, no drop, no slide: headlines swap in place every 2800 ms. |

Tap: the whole band is a button when `cta_target` is set. It goes where a
carousel banner with the same target goes (`src/blynk/catalog/promoTarget.ts`):
CATEGORY opens `/category/<slug>`, SUB_CATEGORY opens its parent's screen with
it selected in the sidebar, PRODUCT opens `/p/<id>`, MAIN opens the categories
screen at that group and CATALOG the categories screen. A switched-off target
is not tappable.

---

## 2. Carousel slide (promotions)

### Card

- Card: **(screen width - 30) x 180 pt**, i.e. **360 x 180** at 390 (aspect
  **2 : 1**), radius 16, 15 pt side gutters, overflow hidden.
- Dots: 10 pt under the card, 6 pt circles 5 pt apart, active = 18 x 6 pill.
  Active `#1A1D2E`, inactive `#D5D6DD`. Hidden for a single slide.
- Background by `background_type`:
  - SOLID: `background_color` (`#F1F4F9` when empty).
  - GRADIENT: 135 deg `background_color -> background_color_end`.
  - IMAGE: `background_image_url`, `cover`, anchored at `background_focal_x/y` %,
    under a flat ink scrim `rgba(16,19,25,0.66)`.
  - ARTWORK: the uploaded banner full-bleed (`cover` at the focal point), **no
    scrim, no headline, no subtitle**; a CTA pill only when `cta_label` is set,
    otherwise the whole card is the tap target. `title` is its accessibility label.
- Text colour: white on IMAGE and on a background colour with relative
  luminance < 0.45; ink `#12151F` (subtitle `#4B5364`) otherwise; white
  subtitle at 82 %.

### Safe text area

`left 20, top 20, bottom 20, width 58 %` of the card (**208 pt** at 360). Title
Outfit ExtraBold 20 / 24, max 2 lines; subtitle Outfit Medium 13 / 17, max 2
lines, 6 pt below; CTA pill 12 pt below: height 30, padding 0 14, radius 15,
Outfit Bold 12: `#FFE141` with ink text on dark slides (IMAGE, ARTWORK, dark
colours), ink `#1A1D2E` with white text on light slides (a yellow pill would
vanish on a yellow card). Keep words in a promotion's ARTWORK
inside this same area so they survive the crop on narrower phones.

Foreground `image_url`: right 12, bottom 0, `contain`, max 42 % of the card
width (151 pt) x 150 pt.

### Motion

| Step | Timing |
| --- | --- |
| Hold per slide | **4000 ms** |
| Slide change | **450 ms** horizontal push (new slide in from the right, old out to the left), `cubic-bezier(0.65, 0, 0.35, 1)`; after the last slide it carries on forward to the first. |
| Entrance (new slide) | title + subtitle from x -12 pt + fade (300 ms, delay 120 ms, ease-out); foreground from y +16 pt and scale 0.94 (420 ms, delay 160 ms, ease-out back); CTA fade (240 ms, delay 260 ms). |
| Touch | a swipe pages by hand and pauses auto-advance; it resumes 4000 ms after the last touch. |
| Single slide | no auto-advance, no dots. |
| Reduced motion | no auto-advance (swipe / dots only), changes are instant, no entrance animation. |

Order: `display_order` ascending (ties: as the API lists them); only active
promotions are shown. The staff preview inserts the slide being edited at its
display order so the whole carousel can be watched in sequence.

Tap: the CTA pill (or the whole ARTWORK card without a label) follows
`cta_target` exactly like the band (section 1); a promotion without a target, or
with a switched-off one, is not tappable and draws no pill. The app's carousel is
`src/components/PromoCarousel.tsx` over `src/blynk/promo/carousel.ts`.

---

## 3. Hero banner (Home banner)

The purple banner at the very top of Home (the header above it is painted the
same purple): a pink saucer whose beam lifts illustrated grocery items one
after another, two big words jumping letter by letter, a rolling sub-line with
a sweeping underline and a firework round the price, and the ORDER NOW button.
The purple / pink / yellow are the owner's choice: **no colour fields**.

### Data (system_configurations `hero_banner`, no migration)

```jsonc
{
  "mode": "AUTO",                  // AUTO (default) = the app's own words | CUSTOM = the fields below
  "title_1": "FRESH",              // 1-12 chars, shown (and stored) in capitals, white
  "title_2": "GROCERIES",          // 1-12 chars, yellow
  "lines": ["Groceries starting at {min_price}"], // 1-4 rolling sub-lines, 2-40 chars
  "cta_label": "ORDER NOW",        // 1-16 chars, capitals
  "cta_destination_type": null,    // null = scroll down to the aisles (today) | CATEGORY | PRODUCT | CATALOG
  "cta_destination_value": null,   // as the promo band / promotions (category slug, product id, group id)
  "items": ["bread", "apple", "carrot", "egg", "broccoli", "banana"], // 1+ of milk bread apple carrot egg broccoli banana
  "starts_at": null,               // optional; outside the window the app shows AUTO
  "ends_at": null
}
```

Tokens in a sub-line: `{min_price}` = the cheapest available product's
effective price ("LKR 253"), `{free_count}` = the free deliveries this customer
may be told about: a signed-in customer's own free deliveries left (checkout-info),
a guest's the store's new-customer count, with " for new customers" added unless
the line already says so, `{points_rule}` = the Blynk Points earn rule from Admin /
Ops' Blynk Points settings, worded "1 point for every LKR 100" (`GET /store` ->
`points_program`; owner, 2026-10-14). Any other `{...}` is refused. The app fills
them in; a line whose token has no value (no products / none left / free
deliveries off / Blynk Points off) is skipped.

AUTO (no row, a malformed row, mode AUTO, or a CUSTOM banner outside its
schedule): "EARN / POINTS" while Blynk Points are on (owner, 2026-10-14: points
instead of free delivery; guests and signed-in customers alike), sub-lines "1 point
for every LKR 100" (the live rule) and "From <price>"; else
"FRESH / GROCERIES" with sub-lines "Quality groceries, delivered with care" and
"From <price>" (owner, 2026-10-16: not "Groceries starting at", to match the
aisle cards' "Items from LKR X") - the purple banner never claims free delivery,
even while the free-deliveries setting is on (owner, 2026-10-15: "remove that,
add some other catchy thing"; other surfaces - the yellow band title, the fee
strip, the aisle offer row - still say it); the six AUTO items;
ORDER NOW scrolls to the aisles. Switching back to AUTO keeps the custom fields
for next time; "Reset to automatic" saves the defaults above.

`GET /store` -> `hero_banner`: `null` = AUTO; otherwise `{ mode: "CUSTOM",
title: [w1, w2], lines (tokens unfilled), cta_label, cta_target, items, ends_at }`.
`cta_target` is the resolved target (`null` when none, deleted or switched off:
the button then scrolls to the aisles). An older API without the field = AUTO.
Customer-facing default words live in `HERO_COPY` (`src/blynk/promo/heroBanner.ts`)
for the Sinhala / Tamil phase.

### Layout (390 pt; unchanged)

- Height 183. Text column: 24 left padding, 26 top, **196 pt** wide.
- Title words: Bowlby One, size `min(36, floor(196 / (letters x 0.82)))` - 12
  letters = 19 pt, so the longest word still fits the column on a 360 pt phone
  (the column keeps its width; the saucer starts 260 pt from the left there).
  Second word 5 pt up, 7 pt left; pink extrusion -2.5 / +3.5.
- Sub-line: Outfit Bold 15, tracking 0.8, one line. AUTO: always 15 pt. A custom
  line may run 44 pt past the column (240 pt) and shrinks (half-points, at the
  least 10.5 pt) to end within 220 pt, before the item, also at 360 pt.
- CTA: 28 high pill, 13 sides, Outfit ExtraBold 12, pink slab 4 pt under.
- Stage (right 180 x 183): beam, item (86 x 86, right 30, bottom 20; emoji 74),
  saucer (92 x 56, right 8, top 12).

### Motion (per item cycle, P = 2600 ms; identical in both modes)

| Time | Motion |
| --- | --- |
| 0 | item drops down the beam (spring damping 12 / stiffness 150; the first item starts resting) |
| 300 ms | underline sweeps under the sub-line (480 ms), holds 1500 ms, fades 300 ms |
| 550 ms | firework round the price (620 ms), when the line contains it |
| 1100 ms | letters jump one after another (~75 ms apart, 7 pt up, +-13 deg); every other item the moon pops in |
| P - 380 | item is sucked back up (230 ms) while the saucer swings (only with 2+ items) |
| P - 120 | next item (P with a single item) |
| loops | saucer / beam / item bob 1300 ms; clouds drift 14 pt over 9 s; CTA arrow nudges every 1560 ms; sub-lines roll every 3200 ms |

Long titles: the letter wave runs at the same speed until the last letter has
jumped (it used to stop after 1 s, leaving a letter past the 13th mid-jump in
"FRESH GROCERIES"; short titles are unchanged). Reduced motion (Reanimated's
system setting): loops still, one-off effects jump to their end; items still
change every cycle and lines still roll. The staff previews (`HeroBannerPreview`)
play the same with CSS; they fill the tokens with sample values (LKR 253) and the
live Blynk Points / free-delivery switches (`GET /admin/settings/points` and
`/admin/settings/checkout`; until they load: points on, "1 point for every LKR
100", no free deliveries), so "Automatic" previews what customers see now.


---

## 4. Blynk Points instead of free delivery (owner, 2026-10-14)

"Remove completely free delivery - instead of that, for 100 LKR order 1 Blynk
point." The free-delivery features and their Admin / Ops switches stay; the
customer app only says what the switches allow (`src/blynk/store/pointsPromo.ts`,
tested in `pointsPromo.test.ts` for free on/off x points on/off x guest/signed in).

| Surface | Blynk Points on | Free deliveries on, points off | Both off |
| --- | --- | --- | --- |
| Hero AUTO | EARN / POINTS, "1 point for every LKR 100", "From ..." | FRESH / GROCERIES, "Quality groceries, delivered with care" (owner, 2026-10-15: never free delivery here), "From ..." | same |
| Yellow band over the offer tiles | "1 point for every LKR 100 · No packaging or platform fee" / EARN BLYNK POINTS | NO PACKAGING FEE & NO PLATFORM FEE / FIRST 2 DELIVERIES FREE (or NEXT N ...) | NO PACKAGING FEE & NO PLATFORM FEE / OFFER PRICES TODAY (or SHOP BY AISLE) |
| Fee strip | 0 Packaging fee · 0 Platform fee · 1 pt / LKR 100 | ... · 2 Free · new users | ... · LKR Delivery LKR X (or km Fee at checkout) |
| Aisle cards | "Items from LKR X" | same | same |
| Aisle screen offer row | EARN BLYNK POINTS / 1 point for every LKR 100 (after a category offer) | FREE DELIVERY ON YOUR FIRST N ORDERS | none |
| Cart bill | "You'll earn N Blynk Points on this order" (guest: "Sign in to earn N ..."; hidden at 0) | the free-delivery rows, Hurray and basket bar as before | nothing extra |
| Order placed | "You'll earn N Blynk Points when it's delivered" (`points_earn_preview` on POST /orders and GET /orders/:id) | - | - |
| Profile (guest) / Points screen | "1 point for every LKR 100 · Log in to earn" / the rule | - | - |

Points win Home's headline surfaces when both are on. The earn number is the
server's rule (backend `points.rules.ts`): items after discounts, never the
delivery fee or the part paid with points, in full steps of `earn_per_lkr`,
added when the order is DELIVERED. `GET /store` -> `points_program` =
`{ enabled: true, earn_points, earn_per_lkr, lkr_per_point, min_redeem_points }`
while on, `null` while off.
