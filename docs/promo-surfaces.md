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

No row (or a malformed one) = the defaults above = exactly the band the app
drew before this existed. A text colour must reach WCAG AA (4.5:1) on both
gradient stops or the API refuses it:

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
