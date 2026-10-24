# Sinhala + Tamil for the customer app (contract for the translation agents)

Owner ask (2026-10-25): the customer app (`apps/customer-app`, Expo RN-web PWA) must be usable in
Sinhala and Tamil, not only English. English stays the default and the source language.

## What is already built (do not redo, do not edit)

`src/blynk/i18n/` — `lang.ts` (Lang = 'en' | 'si' | 'ta', persisted, `getLang/setLang`), `localized.ts`
(`localized(en, { si, ta }, name)` and `pick(en, si, ta)`), `useLang.ts`, tests. `src/components/LanguagePicker.tsx`
is already on the Account tab and on the login screen. `app/_layout.tsx` remounts the screens when the
language changes. `src/blynk/ui/strings.ts` `TABS` is the converted example — read it first.

## The pattern

A block of words that is a plain `export const NAME = { ... } as const` (strings and functions that
build a sentence from a number/name) becomes:

```ts
import { localized } from '@/blynk/i18n/localized';

export const CART = localized(
  {
    title: 'Your cart',
    items: (n: number) => `${n} item${n === 1 ? '' : 's'}`,
  } as const,
  {
    si: { title: '...', items: (n: number) => `...${n}...` },
    ta: { title: '...', items: (n: number) => `...${n}...` },
  },
  'checkout.CART',          // a unique name; shows in test failures
);
```

* `si` and `ta` must have EVERY key `en` has, same shape, same function arguments (the compiler checks it:
  `Widen<T>`), and the same number of items in lists.
* Screens keep writing `CART.title`, `CART.items(3)`. Nothing else changes for blocks that already exist.
* NEVER read a block's words at module load (`const { title } = CART`, `const X = CART.title` at the top of
  a file, a `StyleSheet`/default-parameter/`useMemo([])` that captures it): that freezes the language the
  app started in. Read them while rendering. Where the words are captured early today (module constants
  like `export const SMS_LANGUAGE_NOTE = '...'` that are imported elsewhere) turn them into a getter
  function or move them into a `localized` block and update the users.
* Words written inline in a screen or component (JSX text, `title="..."`, `placeholder`, `accessibilityLabel`,
  `Alert`/`showNotice` text, `Row title/sub`) move into a `localized` block in a plain `.ts` file under
  `src/blynk/<area>/` (new file, e.g. `src/blynk/checkout/cartWords.ts`) and the screen imports it. Blocks
  live ONLY in plain `.ts` files under `src/blynk/**` (no React Native imports) so the completeness test
  (`src/blynk/i18n/complete.test.ts`, which loads every such file) can check them. Do not put `localized`
  blocks in `.tsx` files or under `src/app` / `src/components`.
* Sentences that mix a name/number: make a function, do not concatenate translated fragments in the screen
  (Sinhala/Tamil word order differs: the number or name may not come first).
* Plurals: Sinhala and Tamil need no `s`; write the function so the number is placed naturally.
* Words that come from the SERVER stay as the server sends them: product, category and brand names,
  banner/promo text, `app_texts` overrides, API error `message`s, order status codes. Do translate the
  app's own mapping of status/error CODES to words (e.g. order status labels, `accountErrorText`,
  `authErrorText`, `orders/errors.ts`), because those are written in the app.
* Do NOT translate: the legal policy texts in `src/blynk/legal/policies.ts` (long legal text; leave in
  English, only the screen chrome around them), brand names (Blynk, WhatsApp, PayHere, Google), the currency
  code `LKR` (keep every price format exactly as it is), phone numbers/URLs/emails, analytics event
  names/keys, route names, testIDs.
* English output must stay BYTE-IDENTICAL: every existing test must pass unchanged. If a test pins an
  English string it keeps passing because English is the default language in tests. Where you change
  logic (e.g. turn a constant into a function) update the test minimally and say so.
* Emoji icons stay as they are.

## Translation quality

* Write natural, everyday, spoken-register Sinhala (සිංහල) and Sri Lankan Tamil (தமிழ்) for a grocery
  delivery app used by ordinary customers in Dharga Town / Aluthgama, a small town on the south-west coast of Sri Lanka, with
  a Muslim, Sinhala and Tamil population. Short, friendly, polite, the way a local shop would say it. Not
  stiff literary/formal translations, not word-for-word calques. Use the words people really use
  ("Cart" = කරත්තය / கார்ட், "Order" = ඇණවුම / ஆர்டர், "Delivery" = බෙදාහැරීම / டெலிவரி). Widely used
  English loanwords written in Tamil script (டெலிவரி, ஆர்டர், கார்ட், ஆப்) are correct and preferred over
  rare pure-Tamil words.
* Keep button labels short (they sit in fixed-width buttons). Sinhala/Tamil text is longer than English:
  where a label might not fit, shorten it.
* Keep the same tone for errors: calm, say what happened and what to do.
* The owner cannot verify the wording; a native speaker will review later, so keep every string in its
  own key (do not merge sentences) so they can be corrected one by one.

## Groups and ownership (each agent edits ONLY its files; never edit another group's, never edit `src/blynk/i18n/**`, `LanguagePicker.tsx`, `app/_layout.tsx`)

* G1 Shell + Home: `src/app/index.tsx`, `src/app/(tabs)/_layout.tsx`, `src/app/(tabs)/home.tsx`, `src/components/**`
  (except LanguagePicker), `src/blynk/ui/**`, `src/blynk/promo/**`, `src/blynk/store/**`, `src/blynk/lib/**`,
  `src/blynk/bundles/**`, `src/blynk/combos/**`, `src/blynk/api/**` (only app-written texts), `src/lib/**`.
* G2 Browse: `src/app/categories.tsx`, `src/app/category/**`, `src/app/p/**`, `src/app/store/**`, `src/app/search.tsx`,
  `src/blynk/catalog/**`, `src/blynk/cart/**`, `src/blynk/area/**`.
* G3 Checkout: `src/app/cart.tsx`, `src/app/address.tsx`, `src/app/addresses.tsx`, `src/app/delivery-area.tsx`,
  `src/app/placed.tsx`, `src/app/payment/**`, `src/blynk/checkout/**`, `src/blynk/address/**`, `src/blynk/payments/**`.
* G4 Orders + engagement: `src/app/order/**`, `src/app/track/**`, `src/app/repeat-baskets.tsx`, `src/app/requests.tsx`,
  `src/app/(tabs)/orders.tsx`, `src/blynk/orders/**`, `src/blynk/tracking/**`, `src/blynk/ratings/**`,
  `src/blynk/repeat/**`, `src/blynk/requests/**`, `src/blynk/share/**`, `src/blynk/push/**`.
* G5 Account + the rest: `src/app/login.tsx`, `otp.tsx`, `register.tsx`, `profile.tsx`, `settings.tsx`, `wallet.tsx`, `points.tsx`,
  `refer.tsx`, `birthday.tsx`, `feedback.tsx`, `about.tsx`, `opening.tsx`, `src/app/doctors/**`,
  `src/app/(tabs)/account.tsx`, `src/app/(tabs)/help.tsx`, `src/app/+not-found.tsx`, `src/blynk/account/**`,
  `src/blynk/auth/**`, `src/blynk/wallet/**`, `src/blynk/rewards/**`, `src/blynk/doctors/**`, `src/blynk/legal/**`
  (chrome only), `src/blynk/analytics/**` (no user-facing text: skip).

If a file you need to change belongs to another group, leave it and list it in your report.

## Done means

1. Every user-visible word in your files (including `accessibilityLabel`s, placeholders, alerts, empty
   states, error mappers) comes from a `localized` block, in English + Sinhala + Tamil.
2. `npx tsc --noEmit` clean and `npx vitest run` (all of `apps/customer-app`) green. The completeness test
   (`src/blynk/i18n/complete.test.ts`) must pass: it fails on a missing/empty translation or a sentence left
   in English.
3. Add a small test per group that proves Sinhala and Tamil actually render for the group's main
   functions (e.g. `setLang('si')` then a few functions return Sinhala; reset with `setLang('en')` in
   `afterEach`).
4. Do not commit or push. Report: files changed, number of blocks/keys, anything you left untranslated
   and why, anything you could not reach (other groups' files).
