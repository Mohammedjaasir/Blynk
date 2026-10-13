# Blynk Customer Web (PWA) — Phase 1: Browse and Cart — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new, light React + Vite customer shop at `apps/customer-web/`. It has the Toing-style look approved in the prototype and lets a guest browse the real Blynk catalogue and build a cart, against the existing backend.

**Architecture:** This is a single-page React app (react-router) that talks to the unchanged Blynk REST API through one `apiRequest` client, following the same pattern as the Rider/Ops apps. Other state lives as follows:
- **Catalogue:** read through small resource functions, kept fresh by the `GET /catalog/events` SSE stream plus a 30 s poll.
- **Cart:** a local store persisted in `localStorage`. The server re-prices at checkout in Phase 2.
- **Styling:** plain CSS with the Blynk tokens, laid out like the prototype.

**Tech Stack:**
- React 18.3, react-router-dom 6, TypeScript 5.6, Vite 5.4.
- Vitest 2 with Testing Library and jsdom. Same versions as `apps/rider`.
- No UI framework, no state library.

**Spec:**
- `docs/customer-app-redesign-contract.md`: what must stay, plus the API contracts.
- `docs/redesign/prototype/index.html`: the approved look and motion.
- `docs/redesign/img/`: product art used only by the prototype. The real app uses the API `image_url`s.

## Roadmap (this plan = Phase 1 only)

| Phase | Delivers | Plan |
|---|---|---|
| **1. Browse and cart** | App shell, design tokens, API client, home, aisle (category), product, search, cart (guest), cart bar, live catalogue | this file |
| 2. Sign-in and checkout | Login sheet + OTP + name and birthday capture, session/refresh, address book + map pin (MapLibre), checkout (checkout-info, slots, coupon, points, order for someone else, basket free delivery), place order, order placed | later plan |
| 3. Orders and tracking | Orders list, order detail, delivery code, live map via SSE + route/ETA, cancel, order again, web push registration | later plan |
| 4. Account and launch | Profile, about you, SMS & offers, refer a friend, points, feedback, delete account, doctors, help, store-closed states, PWA manifest + service worker + install helper, Dockerfile switch so `blynk.lk/app/` serves this app, parity check against the contract | later plan |

The Flutter shop keeps serving `blynk.lk/app/` until Phase 4 passes the contract checklist.

## Global Constraints

- **Starting point.** Work branches from `origin/main` (commit `4d78df2` or later), never from `feat/customer-grid-and-accumulated-work`, which is 14 commits behind.
- **No backend changes in Phase 1.** Only `apps/customer-web/` is created. In local development, `backend/api/.env` `CORS_ORIGINS` gets `http://localhost:5177` added. `.env` is not committed.
- **API.**
  - Base: `VITE_API_BASE_URL`, default `http://localhost:4000/api/v1`.
  - Envelope: `{ success: true, data }` on success, or `{ success: false, error: { code, message, details } }` on failure.
  - A production build must refuse a localhost or `http:` API URL. Copy `apps/rider/src/build-env.ts`.
- **Dev port:** 5177, `strictPort`.
- **Colours.** Use exactly these Blynk tokens:

  | Token | Hex |
  |---|---|
  | ink | `#1A1D2E` |
  | yellow | `#FFE141` |
  | yellow-dark | `#E5C700` |
  | wash | `#FFF8D6` |
  | wash-2 | `#FFFADD` |
  | green | `#0C831F` |
  | green-dark | `#0A741B` |
  | green-tint | `#E8F5EA` |
  | text | `#1C1C1C` |
  | text-2 | `#5C5F66` |
  | text-3 | `#8A8D94` |
  | line | `#E8E9EC` |
  | bg | `#F2F3F5` |
  | problem | `#B42318` |

  No purple, no pink.
- **Font:** Outfit from Google Fonts, weights 400–900.
- **Money:** `LKR 1,250`, or `LKR 254.40` when the value is not whole (2 decimals). This matches the Flutter `money_text.dart`.
- **Offer price display:** the struck regular price comes first, then the offer price on a green-tint highlight. "Save LKR X" shows **only** when `/store` `show_offer_savings === true`.
- **Active offer.** An offer is active when all of these hold:
  - `offer_price != null`;
  - `offer_price < selling_price`;
  - `offer_ends_at` is null or in the future.
  - The price charged is the offer price, otherwise `selling_price`.
- **Cart limits:** 1–100 per product; up to 20 per combo and 20 combo lines.
- **Delivery fee.** It depends on mode:
  - **Flat mode:** `/store` `delivery_fee_mode` is `FLAT` and `delivery_fee_lkr` is a number, so show that fee.
  - **Distance mode:** `delivery_fee_lkr` is `null` and `delivery_fee_mode` is `DISTANCE_TIERS`. A guest cart shows "Calculated at checkout".
  - **Free deliveries:** while `new_customer_free_deliveries.enabled`, the cart says "Your first {count} deliveries are free".
- **Copy:**
  - Sentence case, no exclamation marks. "Yay!" and "Hurray!" are the only exceptions, from the approved prototype.
  - Never state the delivery fee amount in marketing copy, only in the cart.
- **Assets.** No religious imagery. The mascot is the Blynk rider illustration `apps/customer-site/assets/phones.webp` (crop already made at `docs/redesign/img/cut-rider.png`; copy it into `apps/customer-web/src/assets/rider.png`).
- **Phones only.** At or above 900 px wide, show "Blynk is a phone app" unless the URL has `?desktop=1`, as the Flutter app does.
- **Every visible state.** Each screen handles loading (skeleton), empty, error (with Retry) and offline.

## Review Focus

1. **Expired offers.** `offer_ends_at` in the past must show the regular price, not a struck one. This is tested in Task 4 (`isOfferActive`).
2. **Corrupt or old cart storage.** Bad JSON, an old shape, or quantities over the limits in `localStorage` must load as an empty or clamped cart, never crash. This is tested in Task 6.
3. **A product that disappears or becomes unavailable while in the cart.** The cart line stays but shows "Unavailable" and is left out of the total. This is tested in Task 6 (`reconcile`) and Task 11.
4. **Slow or failed network on first load.** Home shows the skeleton, then an error with Retry, never a blank screen. This is tested in Task 8.
5. **Double-tapping +.** Rapid taps must add exactly one per tap, never skip or double. This is tested in Task 7 with two fast clicks giving quantity 2.

---

## File Structure

```
apps/customer-web/
  package.json, vite.config.ts, tsconfig.json, index.html, .gitignore
  src/
    main.tsx                 app entry, router
    App.tsx                  routes + shell (dock, desktop gate)
    build-env.ts             production API URL guard (copy of rider)
    vite-env.d.ts
    styles/tokens.css        colours, fonts, radii, motion
    styles/app.css           layout + component classes (ported from the prototype)
    assets/rider.png, assets/logo-mark.png
    api/client.ts            apiRequest, ApiError, tokenStore (no refresh in Phase 1)
    api/types.ts             Product, Category, HomeGroup, Promotion, Combo, StoreInfo
    api/catalog.ts           getProducts, getProduct, getCategories, getHomeGroups, getPromotions, getCombos, getStore
    lib/money.ts             formatLkr
    lib/pricing.ts           isOfferActive, effectivePrice, savings
    lib/useLoad.ts           tiny async loader hook with retry
    lib/catalogLive.ts       SSE /catalog/events + 30 s poll -> "catalog changed" signal
    cart/cartStore.ts        cart state, persistence, limits, reconcile
    cart/CartContext.tsx     React provider + useCart()
    components/ProductCard.tsx, AddButton.tsx, CartBar.tsx, Skeleton.tsx, ErrorState.tsx, PromoBanner.tsx, CategoryTiles.tsx
    pages/Home.tsx, Aisle.tsx, ProductPage.tsx, Search.tsx, Cart.tsx, PhoneOnly.tsx
    test/setup.ts, test/fixtures.ts
    (tests sit beside their files as *.test.ts / *.test.tsx)
```

---

### Task 1: Scaffold the app

**Files:**
- Create: `apps/customer-web/package.json`
- Create: `apps/customer-web/vite.config.ts`
- Create: `apps/customer-web/tsconfig.json`
- Create: `apps/customer-web/index.html`
- Create: `apps/customer-web/.gitignore`
- Create: `apps/customer-web/src/build-env.ts`
- Create: `apps/customer-web/src/vite-env.d.ts`
- Create: `apps/customer-web/src/test/setup.ts`
- Create: `apps/customer-web/src/main.tsx`
- Create: `apps/customer-web/src/App.tsx`
- Test: `apps/customer-web/src/App.test.tsx`

**Interfaces:**
- Produces: `npm run dev|build|test|typecheck`. `App` renders inside `<BrowserRouter basename="/app">`.

- [ ] **Step 1: Create the branch from main**

```bash
git fetch origin
git switch -c feat/customer-web-pwa origin/main
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "blynk-customer-web",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.2"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.5.0",
    "@testing-library/react": "^16.0.1",
    "@testing-library/user-event": "^14.5.2",
    "@types/react": "^18.3.10",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.2",
    "jsdom": "^25.0.1",
    "typescript": "^5.6.2",
    "vite": "^5.4.8",
    "vitest": "^2.1.2"
  }
}
```

- [ ] **Step 3: Write `vite.config.ts`, `tsconfig.json`, `.gitignore`, `vite-env.d.ts`**

`vite.config.ts`:
```ts
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { assertProductionEnv } from './src/build-env';

export default defineConfig(({ command, mode }) => {
  if (command === 'build' && mode === 'production') {
    assertProductionEnv(loadEnv(mode, process.cwd(), 'VITE_'));
  }
  return {
    base: '/app/',
    plugins: [react()],
    server: { port: 5177, strictPort: true },
    test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test/setup.ts'] },
  };
});
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "vite.config.ts"]
}
```

`.gitignore`:
```
node_modules
dist
.env*.local
```

`src/vite-env.d.ts`:
```ts
/// <reference types="vite/client" />
```

- [ ] **Step 4: Copy the production API guard and write the test setup**

```bash
cp apps/rider/src/build-env.ts apps/customer-web/src/build-env.ts
```

`src/test/setup.ts`:
```ts
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  localStorage.clear();
});
```

- [ ] **Step 5: Write the failing smoke test `src/App.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';

test('renders the Blynk shell', () => {
  render(<MemoryRouter><App /></MemoryRouter>);
  expect(screen.getByTestId('app-shell')).toBeInTheDocument();
});
```

- [ ] **Step 6: Install and run the test to see it fail**

Run: `cd apps/customer-web && npm install && npx vitest run src/App.test.tsx`
Expected: FAIL with "Failed to resolve import './App'".

- [ ] **Step 7: Write `src/App.tsx`, `src/main.tsx`, `index.html`**

`src/App.tsx` (routes are filled in by later tasks):
```tsx
import { Routes, Route } from 'react-router-dom';

export default function App() {
  return (
    <div className="app" data-testid="app-shell">
      <Routes>
        <Route path="*" element={<div />} />
      </Routes>
    </div>
  );
}
```

`src/main.tsx`:
```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles/tokens.css';
import './styles/app.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename="/app"><App /></BrowserRouter>
  </React.StrictMode>
);
```

`index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#1A1D2E" />
    <title>Blynk</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Create empty `src/styles/tokens.css` and `src/styles/app.css`. Task 2 fills them.

- [ ] **Step 8: Run tests and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 1 passed; tsc exits 0.

- [ ] **Step 9: Commit**

```bash
git add apps/customer-web
git commit -m "feat(customer-web): scaffold the new light customer shop (React + Vite)"
```

---

### Task 2: Design tokens, base styles and the phone-only gate

**Files:**
- Create: `apps/customer-web/src/styles/tokens.css`
- Create: `apps/customer-web/src/styles/app.css`
- Create: `apps/customer-web/src/pages/PhoneOnly.tsx`
- Modify: `apps/customer-web/src/App.tsx`
- Create: `apps/customer-web/src/assets/rider.png` (copy of `docs/redesign/img/cut-rider.png`)
- Create: `apps/customer-web/src/assets/logo-mark.png` (copy of `apps/customer-site/assets/logo-mark.png`)
- Test: `apps/customer-web/src/pages/PhoneOnly.test.tsx`

**Interfaces:**
- Produces:
  - CSS custom properties `--ink --yellow --yellow-d --wash --wash-2 --green --green-d --green-t --t1 --t2 --t3 --line --bg --problem --out --spring`.
  - Class names used by later tasks: `.screen .sc .stt .rail .grid .pc .add .chip .sk .fi .big .cbar`.
  - `isDesktopBlocked(width: number, search: string): boolean`.

- [ ] **Step 1: Copy assets**

```bash
cp docs/redesign/img/cut-rider.png apps/customer-web/src/assets/rider.png
cp apps/customer-site/assets/logo-mark.png apps/customer-web/src/assets/logo-mark.png
```

- [ ] **Step 2: Write `tokens.css`**

```css
:root{
  --ink:#1A1D2E;--yellow:#FFE141;--yellow-d:#E5C700;--wash:#FFF8D6;--wash-2:#FFFADD;
  --green:#0C831F;--green-d:#0A741B;--green-t:#E8F5EA;
  --t1:#1C1C1C;--t2:#5C5F66;--t3:#8A8D94;--line:#E8E9EC;--bg:#F2F3F5;--problem:#B42318;--strike:#8A8D94;
  --out:cubic-bezier(.22,1,.36,1);--spring:cubic-bezier(.34,1.56,.64,1);
  font-family:Outfit,system-ui,sans-serif;color:var(--t1);-webkit-font-smoothing:antialiased;
}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body,#root{margin:0;height:100%}
body{background:#fff}
h1,h2,h3,p{margin:0}
button{font:inherit;color:inherit;border:0;background:none;cursor:pointer;padding:0}
img{display:block}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
```

- [ ] **Step 3: Write `app.css`**

Port these rule blocks **verbatim** from `docs/redesign/prototype/index.html`'s `<style>`, keeping the selectors as they are there:
- the home header: `.h-top .loc .search .roll`;
- the banner: `.banner .b-copy .b-h .b-sub .b-cta .ufo-w .ufo .beam .lift` with their keyframes `tw hov up`;
- `.stk .cats .ct .fl .chip .stt .rail .pc .add .bump .pr .sv .band .tile .aisle .stamp`;
- the dock: `.dock .wave .cbw .cbar .menu .sfab`;
- `.sk .fi .inter .s-hero .s-body .s-meta .s-off .ss .sech .grid .pair`;
- the cart: `.c-top .strip .cbox .li .ost .amt .chips .chk .tip .ap .paybox .bill .foot .big`;
- `.toast` with its keyframes.

Then add the app frame rules:
```css
.app{position:relative;height:100%;max-width:520px;margin:0 auto;overflow:hidden;background:#fff}
.screen{position:absolute;inset:0;display:flex;flex-direction:column;background:#fff}
.sc{flex:1;overflow-y:auto;overflow-x:hidden;scrollbar-width:none;overscroll-behavior:contain}
.sc::-webkit-scrollbar{display:none}
.phone-only{min-height:100%;display:grid;place-items:center;text-align:center;padding:24px;background:var(--ink);color:#fff}
.phone-only h1{font-size:28px;font-weight:800;margin-top:16px}
.phone-only p{color:rgba(255,255,255,.75);margin-top:8px;max-width:340px}
```

- [ ] **Step 4: Write the failing test `PhoneOnly.test.tsx`**

```tsx
import { isDesktopBlocked } from './PhoneOnly';

test('blocks wide screens unless ?desktop=1', () => {
  expect(isDesktopBlocked(1280, '')).toBe(true);
  expect(isDesktopBlocked(1280, '?desktop=1')).toBe(false);
  expect(isDesktopBlocked(390, '')).toBe(false);
  expect(isDesktopBlocked(899, '')).toBe(false);
  expect(isDesktopBlocked(900, '')).toBe(true);
});
```

- [ ] **Step 5: Run it to see it fail**

Run: `npx vitest run src/pages/PhoneOnly.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 6: Write `PhoneOnly.tsx` and use it in `App.tsx`**

```tsx
import logo from '../assets/logo-mark.png';

export function isDesktopBlocked(width: number, search: string): boolean {
  if (new URLSearchParams(search).get('desktop') === '1') return false;
  return width >= 900;
}

export default function PhoneOnly() {
  return (
    <div className="phone-only">
      <div>
        <img src={logo} alt="" width={72} style={{ margin: '0 auto' }} />
        <h1>Blynk is a phone app</h1>
        <p>Groceries delivered in Dharga Town and its 4 km surroundings. Open blynk.lk on your phone and tap Get Blynk.</p>
      </div>
    </div>
  );
}
```

`App.tsx`:
```tsx
import { Routes, Route } from 'react-router-dom';
import PhoneOnly, { isDesktopBlocked } from './pages/PhoneOnly';

export default function App() {
  if (typeof window !== 'undefined' && isDesktopBlocked(window.innerWidth, window.location.search)) return <PhoneOnly />;
  return (
    <div className="app" data-testid="app-shell">
      <Routes>
        <Route path="*" element={<div />} />
      </Routes>
    </div>
  );
}
```

jsdom's default `innerWidth` is 1024, which would block the smoke test. Add `Object.defineProperty(window, 'innerWidth', { value: 390, writable: true });` to the top of `src/test/setup.ts`.

- [ ] **Step 7: Run all tests**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add apps/customer-web
git commit -m "feat(customer-web): Blynk tokens, Toing-style base styles, phone-only gate"
```

---

### Task 3: API client

**Files:**
- Create: `apps/customer-web/src/api/client.ts`
- Test: `apps/customer-web/src/api/client.test.ts`

**Interfaces:**
- Produces:
  - `apiRequest<T>(path: string, opts?: { method?: 'GET'|'POST'|'PATCH'|'DELETE'; body?: unknown; auth?: boolean; signal?: AbortSignal }): Promise<T>`, which resolves to `data`.
  - `class ApiError extends Error { status: number; code?: string; details?: unknown }`.
  - `API_BASE_URL: string`.
  - `REQUEST_TIMEOUT_MS = 15000`.
  - In Phase 1, `auth` defaults to `false`. Phase 2 adds tokens and refresh.

- [ ] **Step 1: Write the failing tests**

```ts
import { apiRequest, ApiError, API_BASE_URL } from './client';

function mockFetch(status: number, body: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  );
}

afterEach(() => vi.restoreAllMocks());

test('returns data from the success envelope', async () => {
  const f = mockFetch(200, { success: true, data: { products: [] } });
  await expect(apiRequest('/catalog/products')).resolves.toEqual({ products: [] });
  expect(f).toHaveBeenCalledWith(`${API_BASE_URL}/catalog/products`, expect.objectContaining({ method: 'GET' }));
});

test('throws ApiError with the server code and message', async () => {
  mockFetch(422, { success: false, error: { code: 'DELIVERY_OUTSIDE_RADIUS', message: 'Too far', details: { distance_km: 5 } } });
  await expect(apiRequest('/x')).rejects.toMatchObject({ status: 422, code: 'DELIVERY_OUTSIDE_RADIUS', message: 'Too far' });
});

test('maps a network failure to NETWORK_ERROR', async () => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
  const err = await apiRequest('/x').catch((e) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect(err.code).toBe('NETWORK_ERROR');
});

test('a 5xx never leaks server text', async () => {
  mockFetch(500, { success: false, error: { code: 'INTERNAL', message: 'stack trace here' } });
  const err = await apiRequest('/x').catch((e) => e);
  expect(err.message).toBe("Something went wrong on our side. Please try again.");
});

test('sends JSON bodies', async () => {
  const f = mockFetch(200, { success: true, data: {} });
  await apiRequest('/y', { method: 'POST', body: { a: 1 } });
  expect(f.mock.calls[0][1]).toMatchObject({ method: 'POST', body: '{"a":1}' });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/api/client.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `client.ts`**

```ts
export const API_BASE_URL: string =
  (import.meta.env?.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:4000/api/v1';
export const REQUEST_TIMEOUT_MS = 15_000;

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly details?: unknown) {
    super(message);
    this.name = 'ApiError';
  }
}

interface Options { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown; auth?: boolean; signal?: AbortSignal }

export async function apiRequest<T>(path: string, opts: Options = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  opts.signal?.addEventListener('abort', () => ctrl.abort());
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    const timedOut = ctrl.signal.aborted && !opts.signal?.aborted;
    throw new ApiError(
      timedOut ? 'This is taking too long. Check your connection and try again.' : "We couldn't reach Blynk. Check your connection and try again.",
      timedOut ? 408 : 0,
      timedOut ? 'TIMEOUT' : 'NETWORK_ERROR'
    );
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let payload: { success?: boolean; data?: unknown; error?: { code?: string; message?: string; details?: unknown } } = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { /* non-JSON body */ }
  if (res.ok && payload.success !== false) return payload.data as T;
  if (res.status >= 500) throw new ApiError('Something went wrong on our side. Please try again.', res.status, payload.error?.code);
  throw new ApiError(payload.error?.message ?? 'Request failed.', res.status, payload.error?.code, payload.error?.details);
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/api/client.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/customer-web/src/api
git commit -m "feat(customer-web): API client with envelope, timeout and safe errors"
```

---

### Task 4: Money and pricing rules

**Files:**
- Create: `apps/customer-web/src/lib/money.ts`
- Create: `apps/customer-web/src/lib/pricing.ts`
- Test: `apps/customer-web/src/lib/pricing.test.ts`

**Interfaces:**
- Produces:
  - `formatLkr(n: number): string`.
  - `isOfferActive(p: PricedItem, now?: Date): boolean`.
  - `effectivePrice(p: PricedItem, now?: Date): number`.
  - `savingsPerUnit(p: PricedItem, now?: Date): number`.
  - `type PricedItem = { selling_price: number; offer_price: number | null; offer_ends_at: string | null }`.

- [ ] **Step 1: Write the failing tests**

```ts
import { formatLkr } from './money';
import { isOfferActive, effectivePrice, savingsPerUnit } from './pricing';

const base = { selling_price: 540, offer_price: 513, offer_ends_at: null };
const now = new Date('2026-10-13T10:00:00+05:30');

test('formatLkr', () => {
  expect(formatLkr(1250)).toBe('LKR 1,250');
  expect(formatLkr(254.4)).toBe('LKR 254.40');
  expect(formatLkr(574.75)).toBe('LKR 574.75');
  expect(formatLkr(0)).toBe('LKR 0');
});

test('active offer charges the offer price', () => {
  expect(isOfferActive(base, now)).toBe(true);
  expect(effectivePrice(base, now)).toBe(513);
  expect(savingsPerUnit(base, now)).toBe(27);
});

test('expired offer falls back to selling price', () => {
  const p = { ...base, offer_ends_at: '2026-10-12T18:29:59.000Z' };
  expect(isOfferActive(p, now)).toBe(false);
  expect(effectivePrice(p, now)).toBe(540);
  expect(savingsPerUnit(p, now)).toBe(0);
});

test('offer not below selling price is ignored', () => {
  expect(isOfferActive({ ...base, offer_price: 540 }, now)).toBe(false);
  expect(isOfferActive({ ...base, offer_price: null }, now)).toBe(false);
});

test('future end date keeps the offer', () => {
  expect(isOfferActive({ ...base, offer_ends_at: '2026-10-20T18:29:59.000Z' }, now)).toBe(true);
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/lib/pricing.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`money.ts`:
```ts
export function formatLkr(n: number): string {
  const whole = Math.abs(n % 1) < 0.005;
  return 'LKR ' + n.toLocaleString('en-US', whole ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
```

`pricing.ts`:
```ts
export type PricedItem = { selling_price: number; offer_price: number | null; offer_ends_at: string | null };

export function isOfferActive(p: PricedItem, now: Date = new Date()): boolean {
  if (p.offer_price == null || !(p.offer_price < p.selling_price)) return false;
  return p.offer_ends_at == null || new Date(p.offer_ends_at).getTime() > now.getTime();
}

export function effectivePrice(p: PricedItem, now: Date = new Date()): number {
  return isOfferActive(p, now) ? (p.offer_price as number) : p.selling_price;
}

export function savingsPerUnit(p: PricedItem, now: Date = new Date()): number {
  return Math.round((p.selling_price - effectivePrice(p, now)) * 100) / 100;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/pricing.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/customer-web/src/lib
git commit -m "feat(customer-web): LKR formatting and offer-price rules"
```

---

### Task 5: Catalogue types, resources, loader hook and live updates

**Files:**
- Create: `apps/customer-web/src/api/types.ts`
- Create: `apps/customer-web/src/api/catalog.ts`
- Create: `apps/customer-web/src/lib/useLoad.ts`
- Create: `apps/customer-web/src/lib/catalogLive.ts`
- Create: `apps/customer-web/src/test/fixtures.ts`
- Test: `apps/customer-web/src/api/catalog.test.ts`
- Test: `apps/customer-web/src/lib/catalogLive.test.ts`

**Interfaces:**
- Consumes: `apiRequest` (Task 3).
- Produces: types and functions below; `startCatalogLive(onChange: () => void): () => void`.

- [ ] **Step 1: Write `types.ts`** (fields copied from the live `GET /catalog/products`, `/catalog/home-groups` and `/store` responses on 13 Oct 2026)

```ts
export interface Product {
  id: string; category_id: string; category_name: string; name: string; slug: string;
  description: string | null; unit: string; pack_size: string | null;
  image_url: string | null; image_focal_x: number | null; image_focal_y: number | null;
  selling_price: number; offer_price: number | null; offer_ends_at: string | null;
  offer_kind: 'PRODUCT' | 'CATEGORY' | 'LKR_OFF' | null; is_available: boolean;
}
export interface Category {
  id: string; name: string; slug: string; description: string | null; image_url: string | null;
  display_order: number; parent_id: string | null; offer_percent: number | null; offer_ends_at: string | null;
}
export interface HomeGroup { id: string | null; name: string; sort_order: number; categories: Category[] }
export interface Promotion {
  id: string; title: string | null; subtitle: string | null; image_url: string | null;
  background_type: 'SOLID' | 'GRADIENT' | 'IMAGE' | 'ARTWORK'; cta_label: string | null;
  cta_destination_type: 'CATEGORY' | 'PRODUCT' | 'CATALOG' | null; cta_destination_value: string | null;
}
export interface ComboItem { product_id: string; name: string; quantity: number; image_url: string | null }
export interface Combo {
  id: string; name: string; description: string | null; image_url: string | null; price: number;
  items_total: number; ends_at: string | null; is_available: boolean; items: ComboItem[];
}
export interface Pagination { page: number; limit: number; total: number; total_pages: number }
export interface StoreInfo {
  delivery_fee_lkr: number | null; delivery_fee_mode: 'FLAT' | 'DISTANCE_TIERS';
  radius_km: number; coupons_enabled: boolean; show_offer_savings: boolean;
  new_customer_free_deliveries: { enabled: boolean; count: number; since: string };
  delivery_hours: { start: string; end: string; timezone: string };
  is_open_now: boolean; closed_kind: 'OPEN' | 'OUTSIDE_HOURS' | 'CLOSED_DAY' | 'HOLIDAY' | 'CLOSED_NOW';
  closed_reason: string | null; next_open_at: string | null; delivery_slots_enabled: boolean;
  doctors_require_sign_in: boolean;
}
```

Before relying on the `Combo` and `Promotion` fields, check them with `curl -s "$API/combos"` and `curl -s "$API/promotions"` against the local API. Make the types match what is actually returned, and note any differences in the commit message.

- [ ] **Step 2: Write fixtures `src/test/fixtures.ts`**

```ts
import type { Product, Category, StoreInfo } from '../api/types';
export const milk: Product = { id: 'p-milk', category_id: 'c-dairy', category_name: 'Dairy & Eggs', name: 'Kotmale Fresh Milk 1L', slug: 'kotmale-fresh-milk-1l', description: null, unit: '1 L', pack_size: null, image_url: null, image_focal_x: 50, image_focal_y: 50, selling_price: 540, offer_price: 513, offer_ends_at: null, offer_kind: 'CATEGORY', is_available: true };
export const sugar: Product = { ...milk, id: 'p-sugar', category_id: 'c-groc', category_name: 'Groceries', name: 'White Sugar 1KG', slug: 'white-sugar-1kg', unit: '1KG', selling_price: 253, offer_price: null, offer_kind: null };
export const dairy: Category = { id: 'c-dairy', name: 'Dairy & Eggs', slug: 'dairy-eggs', description: null, image_url: null, display_order: 0, parent_id: null, offer_percent: 5, offer_ends_at: null };
export const store: StoreInfo = { delivery_fee_lkr: null, delivery_fee_mode: 'DISTANCE_TIERS', radius_km: 4, coupons_enabled: false, show_offer_savings: false, new_customer_free_deliveries: { enabled: true, count: 2, since: '2026-10-08T18:30:00.000Z' }, delivery_hours: { start: '08:00', end: '21:00', timezone: 'Asia/Colombo' }, is_open_now: true, closed_kind: 'OPEN', closed_reason: null, next_open_at: null, delivery_slots_enabled: false, doctors_require_sign_in: true };
```

- [ ] **Step 3: Write the failing tests**

`catalog.test.ts`:
```ts
import { getProducts, getStore } from './catalog';
import * as client from './client';

afterEach(() => vi.restoreAllMocks());

test('getProducts builds the query and returns products + pagination', async () => {
  const spy = vi.spyOn(client, 'apiRequest').mockResolvedValue({ products: [], pagination: { page: 1, limit: 40, total: 0, total_pages: 0 } });
  await getProducts({ category_slug: 'dairy-eggs', search: 'milk', page: 2, limit: 40 });
  expect(spy).toHaveBeenCalledWith('/catalog/products?category_slug=dairy-eggs&search=milk&page=2&limit=40');
});

test('getStore hits /store', async () => {
  const spy = vi.spyOn(client, 'apiRequest').mockResolvedValue({});
  await getStore();
  expect(spy).toHaveBeenCalledWith('/store');
});
```

`catalogLive.test.ts`:
```ts
import { startCatalogLive } from './catalogLive';

class FakeES { static last: FakeES; listeners: Record<string, () => void> = {}; constructor(public url: string) { FakeES.last = this; }
  addEventListener(n: string, cb: () => void) { this.listeners[n] = cb; } close = vi.fn(); }

test('fires onChange on a catalog event and on the 30 s poll, and stops cleanly', () => {
  vi.useFakeTimers();
  (globalThis as any).EventSource = FakeES;
  const onChange = vi.fn();
  const stop = startCatalogLive(onChange);
  FakeES.last.listeners['catalog']();
  expect(onChange).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(30_000);
  expect(onChange).toHaveBeenCalledTimes(2);
  stop();
  expect(FakeES.last.close).toHaveBeenCalled();
  vi.advanceTimersByTime(60_000);
  expect(onChange).toHaveBeenCalledTimes(2);
  vi.useRealTimers();
});
```

- [ ] **Step 4: Run to see them fail**

Run: `npx vitest run src/api/catalog.test.ts src/lib/catalogLive.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 5: Implement `catalog.ts`, `catalogLive.ts`, `useLoad.ts`**

`catalog.ts`:
```ts
import { apiRequest } from './client';
import type { Product, Category, HomeGroup, Promotion, Combo, Pagination, StoreInfo } from './types';

export interface ProductQuery { category_slug?: string; search?: string; on_offer?: boolean; page?: number; limit?: number }

export function getProducts(q: ProductQuery = {}) {
  const p = new URLSearchParams();
  if (q.category_slug) p.set('category_slug', q.category_slug);
  if (q.search) p.set('search', q.search);
  if (q.on_offer) p.set('on_offer', 'true');
  p.set('page', String(q.page ?? 1));
  p.set('limit', String(q.limit ?? 40));
  return apiRequest<{ products: Product[]; pagination: Pagination }>(`/catalog/products?${p.toString()}`);
}
export const getProduct = (id: string) => apiRequest<{ product: Product }>(`/catalog/products/${encodeURIComponent(id)}`);
export const getCategories = () => apiRequest<{ categories: Category[] }>('/catalog/categories');
export const getHomeGroups = () => apiRequest<{ groups: HomeGroup[] }>('/catalog/home-groups');
export const getPromotions = () => apiRequest<{ promotions: Promotion[] }>('/promotions');
export const getCombos = () => apiRequest<{ combos: Combo[] }>('/combos');
export const getStore = () => apiRequest<StoreInfo>('/store');
```

`catalogLive.ts`:
```ts
import { API_BASE_URL } from '../api/client';

/** Calls onChange when staff change the catalogue (SSE), and every 30 s as a safety net. */
export function startCatalogLive(onChange: () => void): () => void {
  let es: EventSource | null = null;
  try {
    es = new EventSource(`${API_BASE_URL}/catalog/events`);
    es.addEventListener('catalog', () => onChange());
  } catch { /* no SSE: the poll still runs */ }
  const poll = setInterval(onChange, 30_000);
  return () => { clearInterval(poll); es?.close(); };
}
```

`useLoad.ts`:
```ts
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../api/client';

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const run = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await fn()); }
    catch (e) { setError(e instanceof ApiError ? e : new ApiError('Something went wrong.', 0)); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { void run(); }, [run]);
  return { data, error, loading, retry: run, setData };
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add apps/customer-web/src
git commit -m "feat(customer-web): catalogue resources, loader hook, live catalogue updates"
```

---

### Task 6: Cart store

**Files:**
- Create: `apps/customer-web/src/cart/cartStore.ts`
- Create: `apps/customer-web/src/cart/CartContext.tsx`
- Test: `apps/customer-web/src/cart/cartStore.test.ts`

**Interfaces:**
- Consumes: `Product` (Task 5) and `effectivePrice` (Task 4).
- Produces:
  - `CART_KEY = 'blynk.web.cart.v1'`.
  - `type CartLine = { product: Product; quantity: number }`.
  - `type CartState = { lines: CartLine[] }`.
  - Pure functions:
    - `loadCart(): CartState`
    - `saveCart(s: CartState): void`
    - `setQuantity(s, product, qty): CartState`
    - `quantityOf(s, productId): number`
    - `itemCount(s): number`
    - `subtotal(s, now?): number` (available lines only)
    - `regularTotal(s): number`
    - `reconcile(s, fresh: Product[]): CartState`
  - React: `<CartProvider>` and `useCart(): { state, add(p), remove(p), setQty(p, n), count, subtotal }`.
  - Combos are added in Phase 2.

- [ ] **Step 1: Write the failing tests**

```ts
import { loadCart, saveCart, setQuantity, quantityOf, itemCount, subtotal, regularTotal, reconcile, CART_KEY } from './cartStore';
import { milk, sugar } from '../test/fixtures';

test('adds, clamps to 1..100 and removes at 0', () => {
  let s = { lines: [] };
  s = setQuantity(s, milk, 1);
  s = setQuantity(s, milk, 2);
  expect(quantityOf(s, milk.id)).toBe(2);
  s = setQuantity(s, milk, 150);
  expect(quantityOf(s, milk.id)).toBe(100);
  s = setQuantity(s, milk, 0);
  expect(s.lines).toHaveLength(0);
});

test('totals use the offer price, regular total the selling price', () => {
  let s = setQuantity({ lines: [] }, milk, 2);
  s = setQuantity(s, sugar, 1);
  expect(itemCount(s)).toBe(3);
  expect(subtotal(s)).toBe(1279);
  expect(regularTotal(s)).toBe(1333);
});

test('persists and reloads; corrupt or old storage gives an empty cart', () => {
  saveCart(setQuantity({ lines: [] }, milk, 3));
  expect(quantityOf(loadCart(), milk.id)).toBe(3);
  localStorage.setItem(CART_KEY, '{not json');
  expect(loadCart().lines).toEqual([]);
  localStorage.setItem(CART_KEY, JSON.stringify({ v: 0, items: [1] }));
  expect(loadCart().lines).toEqual([]);
  localStorage.setItem(CART_KEY, JSON.stringify({ v: 1, lines: [{ product: milk, quantity: 999 }] }));
  expect(quantityOf(loadCart(), milk.id)).toBe(100);
});

test('reconcile refreshes prices and marks vanished or unavailable products', () => {
  let s = setQuantity(setQuantity({ lines: [] }, milk, 1), sugar, 1);
  const fresh = [{ ...milk, offer_price: 500 }];
  s = reconcile(s, fresh);
  expect(s.lines.find((l) => l.product.id === milk.id)!.product.offer_price).toBe(500);
  expect(s.lines.find((l) => l.product.id === sugar.id)!.product.is_available).toBe(false);
  expect(subtotal(s)).toBe(500);
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/cart`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `cartStore.ts`**

```ts
import type { Product } from '../api/types';
import { effectivePrice } from '../lib/pricing';

export const CART_KEY = 'blynk.web.cart.v1';
export const MAX_QTY = 100;
export type CartLine = { product: Product; quantity: number };
export type CartState = { lines: CartLine[] };

const clamp = (n: number) => Math.max(0, Math.min(MAX_QTY, Math.floor(n)));

export function loadCart(): CartState {
  try {
    const raw = JSON.parse(localStorage.getItem(CART_KEY) ?? 'null');
    if (!raw || raw.v !== 1 || !Array.isArray(raw.lines)) return { lines: [] };
    const lines = raw.lines
      .filter((l: CartLine) => l && l.product && typeof l.product.id === 'string' && Number.isFinite(l.quantity))
      .map((l: CartLine) => ({ product: l.product, quantity: clamp(l.quantity) }))
      .filter((l: CartLine) => l.quantity > 0);
    return { lines };
  } catch { return { lines: [] }; }
}
export function saveCart(s: CartState) {
  try { localStorage.setItem(CART_KEY, JSON.stringify({ v: 1, lines: s.lines })); } catch { /* storage full or blocked */ }
}
export function setQuantity(s: CartState, product: Product, qty: number): CartState {
  const q = clamp(qty);
  const rest = s.lines.filter((l) => l.product.id !== product.id);
  if (q === 0) return { lines: rest };
  const i = s.lines.findIndex((l) => l.product.id === product.id);
  const line = { product, quantity: q };
  if (i === -1) return { lines: [...s.lines, line] };
  const lines = [...s.lines]; lines[i] = line; return { lines };
}
export const quantityOf = (s: CartState, id: string) => s.lines.find((l) => l.product.id === id)?.quantity ?? 0;
export const itemCount = (s: CartState) => s.lines.reduce((a, l) => a + l.quantity, 0);
const round2 = (n: number) => Math.round(n * 100) / 100;
export const subtotal = (s: CartState, now = new Date()) =>
  round2(s.lines.filter((l) => l.product.is_available).reduce((a, l) => a + effectivePrice(l.product, now) * l.quantity, 0));
export const regularTotal = (s: CartState) =>
  round2(s.lines.filter((l) => l.product.is_available).reduce((a, l) => a + l.product.selling_price * l.quantity, 0));
export function reconcile(s: CartState, fresh: Product[]): CartState {
  const byId = new Map(fresh.map((p) => [p.id, p]));
  return { lines: s.lines.map((l) => ({ ...l, product: byId.get(l.product.id) ?? { ...l.product, is_available: false } })) };
}
```

- [ ] **Step 4: Implement `CartContext.tsx`**

```tsx
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Product } from '../api/types';
import { loadCart, saveCart, setQuantity, quantityOf, itemCount, subtotal, type CartState } from './cartStore';

interface CartApi { state: CartState; add(p: Product): void; remove(p: Product): void; setQty(p: Product, n: number): void; qty(id: string): number; count: number; subtotal: number }
const Ctx = createContext<CartApi | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CartState>(() => loadCart());
  useEffect(() => saveCart(state), [state]);
  const api = useMemo<CartApi>(() => ({
    state,
    add: (p) => setState((s) => setQuantity(s, p, quantityOf(s, p.id) + 1)),
    remove: (p) => setState((s) => setQuantity(s, p, quantityOf(s, p.id) - 1)),
    setQty: (p, n) => setState((s) => setQuantity(s, p, n)),
    qty: (id) => quantityOf(state, id),
    count: itemCount(state),
    subtotal: subtotal(state),
  }), [state]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
export function useCart(): CartApi {
  const c = useContext(Ctx);
  if (!c) throw new Error('useCart outside CartProvider');
  return c;
}
```

`add` uses the functional `setState` form, so two rapid taps give 2 (Review Focus 5).

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/cart`
Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add apps/customer-web/src/cart
git commit -m "feat(customer-web): cart store with limits, persistence and reconcile"
```

---

### Task 7: Product card, add button, skeleton, error state

**Files:**
- Create: `apps/customer-web/src/components/AddButton.tsx`
- Create: `apps/customer-web/src/components/ProductCard.tsx`
- Create: `apps/customer-web/src/components/Skeleton.tsx`
- Create: `apps/customer-web/src/components/ErrorState.tsx`
- Create: `apps/customer-web/src/store/StoreContext.tsx`
- Test: `apps/customer-web/src/components/ProductCard.test.tsx`

**Interfaces:**
- Consumes: `useCart` (Task 6), `formatLkr` and the pricing rules (Task 4), `getStore` (Task 5).
- Produces:
  - `<ProductCard product={Product} width?: number />`
  - `<AddButton product={Product} />`
  - `<SkeletonCard />`, `<SkeletonRail count={3} />`
  - `<ErrorState error={ApiError} onRetry={() => void} />`
  - `<StoreProvider>` and `useStore(): StoreInfo | null`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { CartProvider, useCart } from '../cart/CartContext';
import { StoreContext } from '../store/StoreContext';
import ProductCard from './ProductCard';
import { milk, sugar, store } from '../test/fixtures';

function Count() { const c = useCart(); return <span data-testid="count">{c.count}</span>; }
const wrap = (ui: React.ReactNode, s = store) => render(
  <MemoryRouter><StoreContext.Provider value={s}><CartProvider>{ui}<Count /></CartProvider></StoreContext.Provider></MemoryRouter>
);

test('offer product shows struck regular price, highlighted offer, no Save line when switch off', () => {
  wrap(<ProductCard product={milk} />);
  expect(screen.getByText('LKR 540').tagName).toBe('S');
  expect(screen.getByText('LKR 513')).toHaveClass('hl');
  expect(screen.queryByText(/You save/)).toBeNull();
  expect(screen.getByText('5% OFF')).toBeInTheDocument();
});

test('Save line shows when show_offer_savings is true', () => {
  wrap(<ProductCard product={milk} />, { ...store, show_offer_savings: true });
  expect(screen.getByText('You save LKR 27')).toBeInTheDocument();
});

test('plus becomes a stepper; two fast taps give 2', async () => {
  wrap(<ProductCard product={sugar} />);
  await userEvent.click(screen.getByRole('button', { name: 'Add White Sugar 1KG' }));
  await userEvent.click(screen.getByRole('button', { name: 'One more White Sugar 1KG' }));
  expect(screen.getByTestId('count')).toHaveTextContent('2');
  await userEvent.click(screen.getByRole('button', { name: 'One less White Sugar 1KG' }));
  expect(screen.getByTestId('count')).toHaveTextContent('1');
});

test('unavailable product shows Unavailable and no add button', () => {
  wrap(<ProductCard product={{ ...sugar, is_available: false }} />);
  expect(screen.getByText('Unavailable')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Add/ })).toBeNull();
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/components/ProductCard.test.tsx`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `StoreContext.tsx`**

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getStore } from '../api/catalog';
import type { StoreInfo } from '../api/types';

export const StoreContext = createContext<StoreInfo | null>(null);
export function StoreProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<StoreInfo | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => getStore().then((d) => alive && setS(d)).catch(() => {});
    void load();
    const t = setInterval(load, 30_000);
    const vis = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', vis);
    return () => { alive = false; clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, []);
  return <StoreContext.Provider value={s}>{children}</StoreContext.Provider>;
}
export const useStore = () => useContext(StoreContext);
```

- [ ] **Step 4: Implement `AddButton.tsx`, `ProductCard.tsx`, `Skeleton.tsx`, `ErrorState.tsx`**

`AddButton.tsx`:
```tsx
import { useCart } from '../cart/CartContext';
import type { Product } from '../api/types';

export default function AddButton({ product }: { product: Product }) {
  const cart = useCart();
  const q = cart.qty(product.id);
  if (q === 0) {
    return (
      <div className="add">
        <button className="p1" aria-label={`Add ${product.name}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); cart.add(product); }}>
          <svg className="i" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
        </button>
      </div>
    );
  }
  return (
    <div className="add has">
      <span className="sp">
        <button aria-label={`One less ${product.name}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); cart.remove(product); }}>
          <svg className="i" viewBox="0 0 24 24"><path d="M5 12h14" /></svg>
        </button>
        <span className="n bump" key={q}>{q}</span>
        <button aria-label={`One more ${product.name}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); cart.add(product); }}>
          <svg className="i" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
        </button>
      </span>
    </div>
  );
}
```

`ProductCard.tsx`:
```tsx
import { Link } from 'react-router-dom';
import type { Product } from '../api/types';
import { formatLkr } from '../lib/money';
import { isOfferActive, effectivePrice, savingsPerUnit } from '../lib/pricing';
import { useStore } from '../store/StoreContext';
import AddButton from './AddButton';

export default function ProductCard({ product: p, width }: { product: Product; width?: number }) {
  const store = useStore();
  const offer = isOfferActive(p);
  const pct = offer ? Math.round((1 - effectivePrice(p) / p.selling_price) * 100) : 0;
  return (
    <Link to={`/p/${p.id}`} className="pc" style={{ width, textDecoration: 'none', color: 'inherit' }}>
      <div className="im">
        {offer && <span className="tag">{pct}% OFF</span>}
        {p.image_url && (
          <img src={p.image_url} alt="" loading="lazy"
            style={{ objectPosition: `${p.image_focal_x ?? 50}% ${p.image_focal_y ?? 50}%`, opacity: p.is_available ? 1 : 0.45 }} />
        )}
        <span className="unit">{p.unit}</span>
        {p.is_available ? <AddButton product={p} /> : null}
      </div>
      <div className="sub">{p.category_name}</div>
      <div className="nm">{p.name}</div>
      {p.is_available ? (
        <div className="pr">
          {offer ? (<><s>{formatLkr(p.selling_price)}</s><span className="hl">{formatLkr(effectivePrice(p))}</span></>) : <span className="pl">{formatLkr(p.selling_price)}</span>}
        </div>
      ) : <div className="pr" style={{ color: 'var(--t3)' }}>Unavailable</div>}
      {offer && store?.show_offer_savings === true && <div className="sv">You save {formatLkr(savingsPerUnit(p))}</div>}
    </Link>
  );
}
```

`Skeleton.tsx`:
```tsx
export function SkeletonCard() {
  return (<div className="pc"><div className="sk" style={{ width: 152, height: 152, borderRadius: 14 }} /><div className="sk" style={{ width: 90, height: 12, marginTop: 10 }} /><div className="sk" style={{ width: 120, height: 14, marginTop: 8 }} /></div>);
}
export function SkeletonRail({ count = 3 }: { count?: number }) {
  return <div className="rail" aria-busy="true" aria-label="Loading">{Array.from({ length: count }, (_, i) => <SkeletonCard key={i} />)}</div>;
}
```

`ErrorState.tsx`:
```tsx
import type { ApiError } from '../api/client';

export default function ErrorState({ error, onRetry, title }: { error: ApiError; onRetry: () => void; title?: string }) {
  const offline = error.code === 'NETWORK_ERROR' || error.code === 'TIMEOUT';
  return (
    <div role="alert" style={{ textAlign: 'center', padding: '40px 24px' }}>
      <h3 style={{ fontSize: 18, fontWeight: 600 }}>{offline ? "You're offline" : title ?? "We couldn't load this"}</h3>
      <p style={{ color: 'var(--t2)', marginTop: 6, fontSize: 14 }}>{error.message}</p>
      <button className="big" style={{ marginTop: 18, maxWidth: 220, marginInline: 'auto' }} onClick={onRetry}>Try again</button>
    </div>
  );
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/components`
Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add apps/customer-web/src
git commit -m "feat(customer-web): Toing-style product card, add stepper, skeleton and error states"
```

---

### Task 8: Home page

**Files:**
- Create: `apps/customer-web/src/components/PromoBanner.tsx`
- Create: `apps/customer-web/src/components/CategoryTiles.tsx`
- Create: `apps/customer-web/src/pages/Home.tsx`
- Modify: `apps/customer-web/src/App.tsx`
- Test: `apps/customer-web/src/pages/Home.test.tsx`

**Interfaces:**
- Consumes:
  - `getProducts` with `limit=100` and paging until `total_pages`;
  - `getHomeGroups`, `getPromotions`, `getStore`;
  - `startCatalogLive`, `ProductCard`, `SkeletonRail`, `ErrorState`.
- Produces: the route `/` renders `<Home />`.
- **Layout, top to bottom:** prototype home.
  1. Dark header: location placeholder "Dharga Town" (tap does nothing in Phase 1), search pill linking to `/search` with the rolling hint.
  2. Banner:
     - when `/promotions` returns at least one item, use the first promotion's `image_url` as a full-width image;
     - otherwise the built-in "FREE DELIVERY" UFO banner from the prototype;
     - "Groceries starting at {lowest effective price}" is computed from the loaded products.
  3. Sticky category tiles. The order is the home groups flattened. Each tile badge:
     - `FROM {lowest price in that category}`;
     - or `SOON` when it has no products.
  4. Under the tiles, in order:
     - an "Under LKR 300" rail (products with effective price ≤ 300, available first);
     - the "5% LOWER PRICES" band of products with an active offer, shown only if any exist;
     - one aisle card per category with at least one product, holding a rail of that category's products;
     - an "All products" grid.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import * as catalog from '../api/catalog';
import { ApiError } from '../api/client';
import { CartProvider } from '../cart/CartContext';
import { StoreContext } from '../store/StoreContext';
import Home from './Home';
import { milk, sugar, dairy, store } from '../test/fixtures';

const mount = () => render(<MemoryRouter><StoreContext.Provider value={store}><CartProvider><Home /></CartProvider></StoreContext.Provider></MemoryRouter>);
afterEach(() => vi.restoreAllMocks());

test('shows skeleton, then rails built from the live catalogue', async () => {
  vi.spyOn(catalog, 'getProducts').mockResolvedValue({ products: [milk, sugar], pagination: { page: 1, limit: 100, total: 2, total_pages: 1 } });
  vi.spyOn(catalog, 'getHomeGroups').mockResolvedValue({ groups: [{ id: null, name: 'More', sort_order: 0, categories: [dairy] }] });
  vi.spyOn(catalog, 'getPromotions').mockResolvedValue({ promotions: [] });
  mount();
  expect(screen.getByLabelText('Loading')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText('Under LKR 300')).toBeInTheDocument());
  expect(screen.getByText(/Groceries starting at/)).toBeInTheDocument();
  expect(screen.getAllByText('White Sugar 1KG').length).toBeGreaterThan(0);
  expect(screen.getByText('5% LOWER PRICES')).toBeInTheDocument();
  expect(screen.getByText('FROM LKR 513')).toBeInTheDocument();
});

test('network failure shows error with Try again, retry recovers', async () => {
  const gp = vi.spyOn(catalog, 'getProducts').mockRejectedValueOnce(new ApiError("We couldn't reach Blynk.", 0, 'NETWORK_ERROR'))
    .mockResolvedValue({ products: [sugar], pagination: { page: 1, limit: 100, total: 1, total_pages: 1 } });
  vi.spyOn(catalog, 'getHomeGroups').mockResolvedValue({ groups: [] });
  vi.spyOn(catalog, 'getPromotions').mockResolvedValue({ promotions: [] });
  mount();
  await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  screen.getByRole('button', { name: 'Try again' }).click();
  await waitFor(() => expect(screen.getByText('Under LKR 300')).toBeInTheDocument());
  expect(gp).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/pages/Home.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `PromoBanner.tsx`**

- **Promotion image:** given one, render `<img className="banner-img">`, full width, 180 px tall, `object-fit: cover`.
- **Otherwise:** port the prototype's banner markup, `.banner` through `.ufo-w`, as JSX:
  - beam-up images cycle through the first 5 product `image_url`s every 2.8 s using `setInterval`, cleared on unmount;
  - the headline is "FREE DELIVERY" only when `store.new_customer_free_deliveries.enabled`, otherwise "FRESH GROCERIES";
  - the sub-line is `Groceries starting at {formatLkr(min)}`;
  - "ORDER NOW" links to `/aisle/{first category slug}`.

- [ ] **Step 4: Implement `CategoryTiles.tsx`**

```tsx
import { Link } from 'react-router-dom';
import type { Category, Product } from '../api/types';
import { formatLkr } from '../lib/money';
import { effectivePrice } from '../lib/pricing';

export default function CategoryTiles({ categories, products }: { categories: Category[]; products: Product[] }) {
  return (
    <div className="cats">
      {categories.map((c) => {
        const own = products.filter((p) => p.category_id === c.id && p.is_available);
        const min = own.length ? Math.min(...own.map((p) => effectivePrice(p))) : null;
        return (
          <Link key={c.id} to={`/aisle/${c.slug}`} className="ct" style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="im">
              {c.image_url && <img src={c.image_url} alt="" />}
              {min != null ? <span className="bd">FROM {formatLkr(min)}</span> : <span className="bd soon">SOON</span>}
            </div>
            <div className="nm">{c.name}</div>
          </Link>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 5: Implement `Home.tsx`**

```tsx
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getProducts, getHomeGroups, getPromotions } from '../api/catalog';
import type { Product, Category, Promotion } from '../api/types';
import { ApiError } from '../api/client';
import { effectivePrice, isOfferActive } from '../lib/pricing';
import { startCatalogLive } from '../lib/catalogLive';
import ProductCard from '../components/ProductCard';
import CategoryTiles from '../components/CategoryTiles';
import PromoBanner from '../components/PromoBanner';
import { SkeletonRail } from '../components/Skeleton';
import ErrorState from '../components/ErrorState';

async function loadAll() {
  const first = await getProducts({ page: 1, limit: 100 });
  let products = first.products;
  for (let page = 2; page <= Math.min(first.pagination.total_pages, 20); page++) {
    products = products.concat((await getProducts({ page, limit: 100 })).products);
  }
  const [{ groups }, { promotions }] = await Promise.all([getHomeGroups(), getPromotions().catch(() => ({ promotions: [] as Promotion[] }))]);
  const categories: Category[] = groups.flatMap((g) => g.categories);
  return { products, categories, promotions };
}

export default function Home() {
  const [data, setData] = useState<Awaited<ReturnType<typeof loadAll>> | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const load = () => { setError(null); loadAll().then(setData).catch((e) => setError(e instanceof ApiError ? e : new ApiError('Something went wrong.', 0))); };
  useEffect(() => { load(); return startCatalogLive(() => { loadAll().then(setData).catch(() => {}); }); }, []);

  const view = useMemo(() => {
    if (!data) return null;
    const avail = data.products.filter((p) => p.is_available);
    return {
      under300: avail.filter((p) => effectivePrice(p) <= 300),
      offers: avail.filter((p) => isOfferActive(p)),
      aisles: data.categories.map((c) => ({ c, items: data.products.filter((p) => p.category_id === c.id) })).filter((a) => a.items.length > 0),
      min: avail.length ? Math.min(...avail.map((p) => effectivePrice(p))) : null,
    };
  }, [data]);

  return (
    <section className="screen">
      <div className="sc">
        <div className="h-top">
          <div className="loc"><span className="pin" /><div className="grow"><div className="t">Dharga Town</div><div className="s">Groceries delivered within 4 km</div></div></div>
          <Link to="/search" className="search" style={{ textDecoration: 'none' }}>Search for 'Milk'</Link>
          <PromoBanner promotions={data?.promotions ?? []} products={data?.products ?? []} minPrice={view?.min ?? null} firstCategory={data?.categories[0]?.slug} />
        </div>
        <div className="stk">{data && <CategoryTiles categories={data.categories} products={data.products} />}</div>
        {error && <ErrorState error={error} onRetry={load} />}
        {!data && !error && <SkeletonRail />}
        {view && (
          <>
            {view.under300.length > 0 && (<><div className="stt fi"><h2>Under LKR 300</h2></div><div className="rail fi">{view.under300.map((p: Product) => <ProductCard key={p.id} product={p} />)}</div></>)}
            {view.offers.length > 0 && (<div className="band fi"><div className="K">5% LOWER PRICES</div><div className="rail">{view.offers.map((p) => <ProductCard key={p.id} product={p} />)}</div></div>)}
            {view.aisles.length > 0 && <div className="stt"><h2 style={{ fontSize: 17 }}>Explore all aisles</h2></div>}
            {view.aisles.map(({ c, items }) => (
              <div className="aisle fi" key={c.id}>
                <div className="hd"><Link to={`/aisle/${c.slug}`} style={{ color: 'inherit', textDecoration: 'none' }}><h3>{c.name}</h3></Link><div className="m1">{items.length} items • 8 AM – 9 PM</div></div>
                <div className="rail">{items.map((p) => <ProductCard key={p.id} product={p} />)}</div>
              </div>
            ))}
            <div className="stt"><h2 style={{ fontSize: 17 }}>All products</h2></div>
            <div className="grid">{data!.products.map((p) => <ProductCard key={p.id} product={p} />)}</div>
            <div style={{ height: 120 }} />
          </>
        )}
      </div>
    </section>
  );
}
```

`"5% LOWER PRICES"` is the prototype wording. When offers carry different percentages, change the heading to "LOWER PRICES" and show each card's own `% OFF` tag. Write this condition into the code: compute the set of distinct `%` values and use "{n}% LOWER PRICES" only when the set has exactly one value.

- [ ] **Step 6: Route it in `App.tsx`**

Wrap `<Routes>` in `<StoreProvider><CartProvider>…</CartProvider></StoreProvider>` and add `<Route path="/" element={<Home />} />`.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add apps/customer-web/src
git commit -m "feat(customer-web): Toing-style home built from the live catalogue"
```

---

### Task 9: Aisle (category) page

**Files:**
- Create: `apps/customer-web/src/pages/Aisle.tsx`
- Modify: `apps/customer-web/src/App.tsx` (route `/aisle/:slug`)
- Test: `apps/customer-web/src/pages/Aisle.test.tsx`

**Interfaces:**
- Consumes: `getCategories`, `getProducts({ category_slug })`, `ProductCard`.
- Produces: `/aisle/:slug`.
- **Layout, from the prototype store page:**
  - **Header:** 146 px photo header (`category.image_url`) with a back button (`navigate(-1)`, or `/` if there's no history).
  - **Sheet:** a white sheet with the title `{name} at Blynk`, the meta "{n} items · 8 AM – 9 PM".
  - **Offer line:** shown when `offer_percent` is set — "{offer_percent}% LOWER PRICES ON EVERYTHING HERE", plus "until {date}" when `offer_ends_at` is set.
  - **Search link:** to `/search?c={slug}`.
  - **Sub-category chips:** categories whose `parent_id` is this one, as links to `/aisle/{child slug}`.
  - **Grid:** a 2-column grid.
  - **Empty aisle:** shows the rider image with "Coming soon to Blynk".

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import * as catalog from '../api/catalog';
import { CartProvider } from '../cart/CartContext';
import { StoreContext } from '../store/StoreContext';
import Aisle from './Aisle';
import { milk, dairy, store } from '../test/fixtures';

const mount = (slug: string) => render(
  <MemoryRouter initialEntries={[`/aisle/${slug}`]}><StoreContext.Provider value={store}><CartProvider>
    <Routes><Route path="/aisle/:slug" element={<Aisle />} /></Routes>
  </CartProvider></StoreContext.Provider></MemoryRouter>);
afterEach(() => vi.restoreAllMocks());

test('shows the category with its offer line and products', async () => {
  vi.spyOn(catalog, 'getCategories').mockResolvedValue({ categories: [dairy] });
  const gp = vi.spyOn(catalog, 'getProducts').mockResolvedValue({ products: [milk], pagination: { page: 1, limit: 100, total: 1, total_pages: 1 } });
  mount('dairy-eggs');
  await waitFor(() => expect(screen.getByText('Dairy & Eggs at Blynk')).toBeInTheDocument());
  expect(screen.getByText('5% LOWER PRICES ON EVERYTHING HERE')).toBeInTheDocument();
  expect(screen.getByText('Kotmale Fresh Milk 1L')).toBeInTheDocument();
  expect(gp).toHaveBeenCalledWith({ category_slug: 'dairy-eggs', page: 1, limit: 100 });
});

test('an empty aisle says Coming soon', async () => {
  vi.spyOn(catalog, 'getCategories').mockResolvedValue({ categories: [{ ...dairy, slug: 'bakery', name: 'Bakery', offer_percent: null }] });
  vi.spyOn(catalog, 'getProducts').mockResolvedValue({ products: [], pagination: { page: 1, limit: 100, total: 0, total_pages: 0 } });
  mount('bakery');
  await waitFor(() => expect(screen.getByText('Coming soon to Blynk')).toBeInTheDocument());
});

test('an unknown slug shows not found', async () => {
  vi.spyOn(catalog, 'getCategories').mockResolvedValue({ categories: [dairy] });
  vi.spyOn(catalog, 'getProducts').mockResolvedValue({ products: [], pagination: { page: 1, limit: 100, total: 0, total_pages: 0 } });
  mount('nope');
  await waitFor(() => expect(screen.getByText("This aisle isn't available")).toBeInTheDocument());
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/pages/Aisle.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `Aisle.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getCategories, getProducts } from '../api/catalog';
import type { Category, Product } from '../api/types';
import { ApiError } from '../api/client';
import ProductCard from '../components/ProductCard';
import ErrorState from '../components/ErrorState';
import { SkeletonRail } from '../components/Skeleton';
import rider from '../assets/rider.png';

export default function Aisle() {
  const { slug = '' } = useParams();
  const nav = useNavigate();
  const [state, setState] = useState<{ cat: Category | null; kids: Category[]; items: Product[] } | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const load = () => {
    setError(null); setState(null);
    Promise.all([getCategories(), getProducts({ category_slug: slug, page: 1, limit: 100 })])
      .then(([{ categories }, { products }]) => {
        const cat = categories.find((c) => c.slug === slug) ?? null;
        setState({ cat, kids: cat ? categories.filter((c) => c.parent_id === cat.id) : [], items: products });
      })
      .catch((e) => setError(e instanceof ApiError ? e : new ApiError('Something went wrong.', 0)));
  };
  useEffect(load, [slug]);
  const back = () => (window.history.length > 1 ? nav(-1) : nav('/'));

  if (error) return <section className="screen"><ErrorState error={error} onRetry={load} /></section>;
  if (!state) return <section className="screen"><div className="sk" style={{ height: 146 }} /><SkeletonRail /></section>;
  if (!state.cat) return <section className="screen"><div style={{ padding: 40, textAlign: 'center' }}><h2>This aisle isn't available</h2><Link className="big" to="/" style={{ marginTop: 18, textDecoration: 'none' }}>Go to Shop</Link></div></section>;
  const c = state.cat;
  return (
    <section className="screen">
      <div className="sc">
        <div className="s-hero">{c.image_url && <img src={c.image_url} alt="" />}<button className="rb" style={{ left: 16 }} onClick={back} aria-label="Back">←</button></div>
        <div className="s-body">
          <h1>{c.name} at Blynk</h1>
          <div className="s-meta"><span>{state.items.length} items</span><span className="bar" /><span>8 AM – 9 PM</span></div>
          {c.offer_percent != null && (
            <div className="s-off"><div><div className="k">{c.offer_percent}% LOWER PRICES ON EVERYTHING HERE</div>{c.offer_ends_at && <div className="s">until {new Date(c.offer_ends_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div>}</div></div>
          )}
          <Link to={`/search?c=${c.slug}`} className="ss" style={{ textDecoration: 'none' }}>Search in {c.name}</Link>
          {state.kids.length > 0 && <div className="fl" style={{ padding: '12px 0' }}>{state.kids.map((k) => <Link key={k.id} className="chip" to={`/aisle/${k.slug}`}>{k.name}</Link>)}</div>}
        </div>
        {state.items.length ? (
          <div className="grid">{state.items.map((p) => <ProductCard key={p.id} product={p} />)}</div>
        ) : (
          <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--t2)' }}><img src={rider} alt="" style={{ width: 150, margin: '0 auto' }} /><div style={{ fontSize: 17, fontWeight: 600, color: 'var(--t1)' }}>Coming soon to Blynk</div><div style={{ fontSize: 13.5 }}>We're stocking this aisle. Check back shortly.</div></div>
        )}
        <div style={{ height: 120 }} />
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Route `/aisle/:slug` in `App.tsx`; run tests**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/customer-web/src
git commit -m "feat(customer-web): aisle page with category offer, sub-category chips, empty state"
```

---

### Task 10: Product page

**Files:**
- Create: `apps/customer-web/src/pages/ProductPage.tsx`
- Modify: `apps/customer-web/src/App.tsx` (route `/p/:id`)
- Test: `apps/customer-web/src/pages/ProductPage.test.tsx`

**Interfaces:**
- Consumes: `getProduct`, `AddButton`, the pricing rules.
- Produces: `/p/:id`. The same path the existing share links use: `blynk.lk/p/<id>` redirects to `/app/#/p/<id>` today, and Phase 4 changes it to `/app/p/<id>`.
- **Layout, top to bottom:**
  1. A large image, then the category, name and "unit · pack_size".
  2. The price block, with the active-offer display and "Offer ends {date}" when `offer_ends_at` is set.
  3. The badge "Available" or "Currently unavailable".
  4. "About this product" (the description, when present).
  5. A sticky bottom bar: when the product is available, the Add / stepper plus "View cart" linking to `/cart`.
- **Not found:** a 404 shows "Product no longer available". Notify-me comes in Phase 2, because it needs sign-in.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import * as catalog from '../api/catalog';
import { ApiError } from '../api/client';
import { CartProvider } from '../cart/CartContext';
import { StoreContext } from '../store/StoreContext';
import ProductPage from './ProductPage';
import { milk, store } from '../test/fixtures';

const mount = () => render(<MemoryRouter initialEntries={['/p/p-milk']}><StoreContext.Provider value={store}><CartProvider>
  <Routes><Route path="/p/:id" element={<ProductPage />} /></Routes></CartProvider></StoreContext.Provider></MemoryRouter>);
afterEach(() => vi.restoreAllMocks());

test('shows product details and an Add button', async () => {
  vi.spyOn(catalog, 'getProduct').mockResolvedValue({ product: { ...milk, offer_ends_at: '2026-10-20T18:29:59.000Z' } });
  mount();
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Kotmale Fresh Milk 1L' })).toBeInTheDocument());
  expect(screen.getByText('Available')).toBeInTheDocument();
  expect(screen.getByText(/Offer ends/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add Kotmale Fresh Milk 1L' })).toBeInTheDocument();
});

test('404 shows product no longer available', async () => {
  vi.spyOn(catalog, 'getProduct').mockRejectedValue(new ApiError('Not found', 404, 'PRODUCT_NOT_FOUND'));
  mount();
  await waitFor(() => expect(screen.getByText('Product no longer available')).toBeInTheDocument());
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/pages/ProductPage.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `ProductPage.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getProduct } from '../api/catalog';
import type { Product } from '../api/types';
import { ApiError } from '../api/client';
import { formatLkr } from '../lib/money';
import { isOfferActive, effectivePrice } from '../lib/pricing';
import AddButton from '../components/AddButton';
import ErrorState from '../components/ErrorState';

export default function ProductPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const [p, setP] = useState<Product | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const load = () => { setError(null); getProduct(id).then((r) => setP(r.product)).catch((e) => setError(e instanceof ApiError ? e : new ApiError('Something went wrong.', 0))); };
  useEffect(load, [id]);
  if (error?.status === 404) return <section className="screen"><div style={{ padding: 40, textAlign: 'center' }}><h2>Product no longer available</h2><button className="big" style={{ marginTop: 18 }} onClick={() => nav('/')}>Go to Shop</button></div></section>;
  if (error) return <section className="screen"><ErrorState error={error} onRetry={load} /></section>;
  if (!p) return <section className="screen"><div className="sk" style={{ height: 320, margin: 16 }} /></section>;
  const offer = isOfferActive(p);
  return (
    <section className="screen">
      <div className="sc">
        <div style={{ position: 'relative', background: 'linear-gradient(160deg,#F7F7F9,#ECEDF1)', height: 340 }}>
          <button className="rb" onClick={() => nav(-1)} aria-label="Back" style={{ position: 'absolute', left: 16, top: 14 }}>←</button>
          {p.image_url && <img src={p.image_url} alt="" style={{ width: '70%', height: '80%', objectFit: 'contain', margin: '30px auto 0' }} />}
        </div>
        <div style={{ padding: '16px' }}>
          <div style={{ color: 'var(--t3)', fontSize: 13 }}>{p.category_name}</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginTop: 2 }}>{p.name}</h1>
          <div style={{ color: 'var(--t2)', fontSize: 14 }}>{p.unit}{p.pack_size ? ` · ${p.pack_size}` : ''}</div>
          <div className="pr" style={{ fontSize: 18, marginTop: 10 }}>
            {offer ? <><s>{formatLkr(p.selling_price)}</s><span className="hl">{formatLkr(effectivePrice(p))}</span></> : <span className="pl">{formatLkr(p.selling_price)}</span>}
          </div>
          {offer && p.offer_ends_at && <div style={{ fontSize: 13, color: 'var(--green)', marginTop: 4 }}>Offer ends {new Date(p.offer_ends_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div>}
          <div style={{ marginTop: 10, fontSize: 13, fontWeight: 600, color: p.is_available ? 'var(--green)' : 'var(--problem)' }}>{p.is_available ? 'Available' : 'Currently unavailable'}</div>
          {p.description && <><h2 style={{ fontSize: 16, marginTop: 18 }}>About this product</h2><p style={{ color: 'var(--t2)', fontSize: 14, marginTop: 6 }}>{p.description}</p></>}
        </div>
        <div style={{ height: 100 }} />
      </div>
      {p.is_available && (
        <div className="foot" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ position: 'relative', width: 110, height: 40 }}><AddButton product={p} /></div>
          <Link to="/cart" className="big" style={{ textDecoration: 'none' }}>View cart</Link>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Route `/p/:id`; run tests**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/customer-web/src
git commit -m "feat(customer-web): product page with offer end date and not-found state"
```

---

### Task 11: Search page

**Files:**
- Create: `apps/customer-web/src/pages/Search.tsx`
- Modify: `apps/customer-web/src/App.tsx` (route `/search`)
- Test: `apps/customer-web/src/pages/Search.test.tsx`

**Interfaces:**
- Consumes: `getProducts({ search, category_slug, page, limit: 40 })`, `ProductCard`.
- Produces: `/search?c=<slug>`.
- **Behaviour:**
  - **Typing:** a 350 ms debounce before searching.
  - **Recent searches:** up to 8, stored in `localStorage` under `blynk.web.recentSearches`, with a "Clear" button.
  - **Results:** a count header, then the results grid.
  - **No results:** `No results for "{q}"`, with a link to `/`.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import * as catalog from '../api/catalog';
import { CartProvider } from '../cart/CartContext';
import { StoreContext } from '../store/StoreContext';
import Search from './Search';
import { milk, store } from '../test/fixtures';

const mount = () => render(<MemoryRouter><StoreContext.Provider value={store}><CartProvider><Search /></CartProvider></StoreContext.Provider></MemoryRouter>);
afterEach(() => vi.restoreAllMocks());

test('debounced search shows results and remembers the query', async () => {
  const gp = vi.spyOn(catalog, 'getProducts').mockResolvedValue({ products: [milk], pagination: { page: 1, limit: 40, total: 1, total_pages: 1 } });
  mount();
  await userEvent.type(screen.getByRole('searchbox'), 'milk');
  await waitFor(() => expect(screen.getByText('1 result')).toBeInTheDocument());
  expect(gp).toHaveBeenLastCalledWith({ search: 'milk', category_slug: undefined, page: 1, limit: 40 });
  expect(JSON.parse(localStorage.getItem('blynk.web.recentSearches')!)).toEqual(['milk']);
});

test('no results message', async () => {
  vi.spyOn(catalog, 'getProducts').mockResolvedValue({ products: [], pagination: { page: 1, limit: 40, total: 0, total_pages: 0 } });
  mount();
  await userEvent.type(screen.getByRole('searchbox'), 'zzz');
  await waitFor(() => expect(screen.getByText('No results for "zzz"')).toBeInTheDocument());
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/pages/Search.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `Search.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { getProducts } from '../api/catalog';
import type { Product } from '../api/types';
import ProductCard from '../components/ProductCard';

const KEY = 'blynk.web.recentSearches';
const readRecent = (): string[] => { try { const v = JSON.parse(localStorage.getItem(KEY) ?? '[]'); return Array.isArray(v) ? v.slice(0, 8) : []; } catch { return []; } };
const remember = (q: string) => { try { localStorage.setItem(KEY, JSON.stringify([q, ...readRecent().filter((r) => r !== q)].slice(0, 8))); } catch { /* blocked */ } };

export default function Search() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const cat = params.get('c') ?? undefined;
  const [q, setQ] = useState('');
  const [res, setRes] = useState<{ items: Product[]; total: number } | null>(null);
  const [recent, setRecent] = useState(readRecent);
  useEffect(() => {
    const term = q.trim();
    if (!term) { setRes(null); return; }
    const t = setTimeout(() => {
      getProducts({ search: term, category_slug: cat, page: 1, limit: 40 })
        .then((r) => { setRes({ items: r.products, total: r.pagination.total }); remember(term); setRecent(readRecent()); })
        .catch(() => setRes({ items: [], total: 0 }));
    }, 350);
    return () => clearTimeout(t);
  }, [q, cat]);
  return (
    <section className="screen">
      <div className="row" style={{ display: 'flex', gap: 10, padding: '14px 16px' }}>
        <button onClick={() => nav(-1)} aria-label="Back">←</button>
        <input type="search" role="searchbox" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search groceries & essentials" className="ss" style={{ flex: 1, border: 0, outline: 0 }} />
      </div>
      <div className="sc">
        {!q.trim() && recent.length > 0 && (
          <div style={{ padding: '0 16px' }}>
            <div className="stt" style={{ padding: 0 }}><h2 style={{ fontSize: 16 }}>Recent searches</h2><button onClick={() => { localStorage.removeItem(KEY); setRecent([]); }}>Clear</button></div>
            <div className="fl" style={{ padding: '10px 0', flexWrap: 'wrap' }}>{recent.map((r) => <button key={r} className="chip" onClick={() => setQ(r)}>{r}</button>)}</div>
          </div>
        )}
        {res && res.total > 0 && <div style={{ padding: '4px 16px', color: 'var(--t2)', fontSize: 13 }}>{res.total === 1 ? '1 result' : `${res.total} results`}</div>}
        {res && res.total > 0 && <div className="grid">{res.items.map((p) => <ProductCard key={p.id} product={p} />)}</div>}
        {res && res.total === 0 && <div style={{ textAlign: 'center', padding: 40 }}><h2 style={{ fontSize: 17 }}>No results for "{q.trim()}"</h2><p style={{ color: 'var(--t2)', fontSize: 14, marginTop: 6 }}>Check the spelling or browse the aisles.</p><Link to="/" className="big" style={{ marginTop: 16, textDecoration: 'none' }}>Browse the shop</Link></div>}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Route `/search`; run tests**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/customer-web/src
git commit -m "feat(customer-web): search with debounce and recent searches"
```

---

### Task 12: Cart page and cart bar

**Files:**
- Create: `apps/customer-web/src/components/CartBar.tsx`
- Create: `apps/customer-web/src/pages/Cart.tsx`
- Modify: `apps/customer-web/src/App.tsx` (route `/cart`; `CartBar` shown on `/`, `/aisle/*`, `/p/*`, `/search`)
- Test: `apps/customer-web/src/pages/Cart.test.tsx`

**Interfaces:**
- Consumes: `useCart`, `regularTotal`, `reconcile`, `getProducts`, `useStore`, `formatLkr`.
- Produces:
  - `/cart`.
  - `<CartBar />`: green, full width, "N Items | LKR X | View Cart".
  - The cart bar adds a "Yay! Your first deliveries are free" line when `new_customer_free_deliveries.enabled` and the cart is not empty.
- **Cart layout, from the prototype cart:**
  1. Back button.
  2. Green strip: "Free delivery on your first {count} orders" when that's enabled, otherwise "Cash on delivery".
  3. Item lines with outlined − n + steppers. An unavailable line shows "Unavailable" and a Remove button.
  4. "Add items" chip.
  5. Savings card with an "Applied" row "LKR X saved with offer prices", shown when X > 0.
  6. Bill: "Item total" (struck regular total when different, then the subtotal).
  7. "Delivery fee": "FREE · first {count} orders" when free deliveries are enabled, otherwise the fee when FLAT, otherwise "Calculated at checkout".
  8. "Cancellation policy: You can cancel your order until it is out for delivery."
  9. Footer "Almost There" with "Proceed with Phone Number". In Phase 1 it navigates to `/login`, which shows "Sign-in comes in the next update" until Phase 2.
- **On open:** reconcile the cart against `getProducts` for each distinct category in the cart, so prices and availability are fresh (Review Focus 3).
- **Empty cart:** "Your cart is empty", with "Browse groceries" linking to `/`.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import * as catalog from '../api/catalog';
import { CartProvider } from '../cart/CartContext';
import { saveCart, setQuantity } from '../cart/cartStore';
import { StoreContext } from '../store/StoreContext';
import Cart from './Cart';
import { milk, sugar, store } from '../test/fixtures';

const mount = (s = store) => render(<MemoryRouter><StoreContext.Provider value={s}><CartProvider><Cart /></CartProvider></StoreContext.Provider></MemoryRouter>);
afterEach(() => vi.restoreAllMocks());

test('empty cart', () => {
  mount();
  expect(screen.getByText('Your cart is empty')).toBeInTheDocument();
});

test('shows lines, savings, free delivery and the guest footer', async () => {
  saveCart(setQuantity(setQuantity({ lines: [] }, milk, 2), sugar, 1));
  vi.spyOn(catalog, 'getProducts').mockResolvedValue({ products: [milk, sugar], pagination: { page: 1, limit: 100, total: 2, total_pages: 1 } });
  mount();
  expect(screen.getByText('Kotmale Fresh Milk 1L')).toBeInTheDocument();
  expect(screen.getByText('LKR 54 saved with offer prices')).toBeInTheDocument();
  expect(screen.getByText('FREE · first 2 orders')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Proceed with Phone Number' })).toBeInTheDocument();
});

test('distance fee without free deliveries says calculated at checkout', async () => {
  saveCart(setQuantity({ lines: [] }, sugar, 1));
  vi.spyOn(catalog, 'getProducts').mockResolvedValue({ products: [sugar], pagination: { page: 1, limit: 100, total: 1, total_pages: 1 } });
  mount({ ...store, new_customer_free_deliveries: { enabled: false, count: 0, since: store.new_customer_free_deliveries.since } });
  expect(screen.getByText('Calculated at checkout')).toBeInTheDocument();
});

test('a product that became unavailable is marked and left out of the total', async () => {
  saveCart(setQuantity(setQuantity({ lines: [] }, milk, 1), sugar, 1));
  vi.spyOn(catalog, 'getProducts').mockImplementation(async (q) => ({ products: q?.category_slug === undefined ? [milk] : [milk], pagination: { page: 1, limit: 100, total: 1, total_pages: 1 } }));
  mount();
  await waitFor(() => expect(screen.getByText('Unavailable')).toBeInTheDocument());
  expect(screen.getByTestId('cart-total')).toHaveTextContent('LKR 513');
  await userEvent.click(screen.getByRole('button', { name: 'Remove White Sugar 1KG' }));
  expect(screen.queryByText('White Sugar 1KG')).toBeNull();
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/pages/Cart.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Add a `replace` action to the cart context**

In `CartContext.tsx`, add `replaceState(s: CartState): void` to `CartApi` and implement it with `replaceState: (s) => setState(s)`.

- [ ] **Step 4: Implement `Cart.tsx`**

```tsx
import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getProducts } from '../api/catalog';
import { useCart } from '../cart/CartContext';
import { reconcile, regularTotal, subtotal } from '../cart/cartStore';
import { useStore } from '../store/StoreContext';
import { formatLkr } from '../lib/money';
import { effectivePrice, isOfferActive } from '../lib/pricing';

export default function Cart() {
  const nav = useNavigate();
  const cart = useCart();
  const store = useStore();
  useEffect(() => {
    // Refresh prices and availability for what is in the cart.
    if (!cart.state.lines.length) return;
    getProducts({ page: 1, limit: 100 }).then(({ products }) => cart.replaceState(reconcile(cart.state, products))).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!cart.state.lines.length) {
    return (<section className="screen"><div style={{ padding: 40, textAlign: 'center' }}><h2>Your cart is empty</h2><p style={{ color: 'var(--t2)', marginTop: 6 }}>Add your everyday essentials and we'll deliver them to your doorstep.</p><Link to="/" className="big" style={{ marginTop: 18, textDecoration: 'none' }}>Browse groceries</Link></div></section>);
  }
  const sub = subtotal(cart.state), reg = regularTotal(cart.state), saved = Math.round((reg - sub) * 100) / 100;
  const free = store?.new_customer_free_deliveries.enabled ? store.new_customer_free_deliveries.count : 0;
  const feeText = free > 0 ? `FREE · first ${free} orders` : store?.delivery_fee_mode === 'FLAT' && store.delivery_fee_lkr != null ? formatLkr(store.delivery_fee_lkr) : 'Calculated at checkout';
  return (
    <section className="screen" style={{ background: 'var(--bg)' }}>
      <div className="sc">
        <div className="c-top"><button onClick={() => nav(-1)} aria-label="Back">←</button><span>Blynk · Dharga Town store</span></div>
        <div className="strip">{free > 0 ? `Free delivery on your first ${free} orders` : 'Cash on delivery'}</div>
        <div className="cbox">
          {cart.state.lines.map((l) => (
            <div className="li" key={l.product.id}>
              <span className="nm">{l.product.name}{!l.product.is_available && <span style={{ display: 'block', color: 'var(--problem)', fontSize: 12.5 }}>Unavailable</span>}</span>
              {l.product.is_available ? (
                <span className="ost"><button aria-label={`One less ${l.product.name}`} onClick={() => cart.remove(l.product)}>−</button><span>{l.quantity}</span><button aria-label={`One more ${l.product.name}`} onClick={() => cart.add(l.product)}>+</button></span>
              ) : <button className="chip" aria-label={`Remove ${l.product.name}`} onClick={() => cart.setQty(l.product, 0)}>Remove</button>}
              <span className="amt">{l.product.is_available && isOfferActive(l.product) && <s>{formatLkr(l.product.selling_price * l.quantity)}</s>}{l.product.is_available ? formatLkr(Math.round(effectivePrice(l.product) * l.quantity * 100) / 100) : ''}</span>
            </div>
          ))}
          <div className="chips"><Link to="/" className="chip">+ Add Items</Link></div>
        </div>
        {saved > 0 && <div className="cbox"><div className="ap"><span className="grow">{formatLkr(saved)} saved with offer prices</span><span className="ok">Applied</span></div></div>}
        <div className="cbox paybox">
          <div className="bill">
            <div className="r"><u>Item Total</u><span>{saved > 0 && <s style={{ color: 'var(--strike)' }}>{formatLkr(reg)} </s>}<span data-testid="cart-total">{formatLkr(sub)}</span></span></div>
            <div className="r"><u>Delivery Fee</u><span>{feeText}</span></div>
          </div>
        </div>
        <div style={{ margin: '16px 18px', fontSize: 13, color: 'var(--t3)' }}><b style={{ color: 'var(--t2)', fontWeight: 500 }}>Cancellation policy:</b><br />You can cancel your order until it is out for delivery.</div>
      </div>
      <div className="foot"><h3>Almost There</h3><p>Login/Create Account quickly to place order</p><button className="big" onClick={() => nav('/login')}>Proceed with Phone Number</button></div>
    </section>
  );
}
```

The reconcile call fetches `limit: 100` across the whole catalogue, which is enough for today's catalogue of under 100 products. Phase 2 replaces it with a server-side check at checkout. Leave the comment above in the code.

- [ ] **Step 5: Implement `CartBar.tsx` and wire it into `App.tsx`**

```tsx
import { useLocation, Link } from 'react-router-dom';
import { useCart } from '../cart/CartContext';
import { useStore } from '../store/StoreContext';
import { formatLkr } from '../lib/money';

const SHOW_ON = [/^\/$/, /^\/aisle\//, /^\/p\//, /^\/search/];
export default function CartBar() {
  const { pathname } = useLocation();
  const cart = useCart();
  const store = useStore();
  if (!cart.count || !SHOW_ON.some((r) => r.test(pathname))) return null;
  return (
    <div className="cbw show" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 20 }}>
      <Link to="/cart" className="cbar" style={{ display: 'block', textDecoration: 'none' }}>
        {store?.new_customer_free_deliveries.enabled && <div className="yay show">Yay! Your first deliveries are free</div>}
        <div className="mn"><span>{cart.count} {cart.count === 1 ? 'Item' : 'Items'}</span><span className="sep">|</span><span>{formatLkr(cart.subtotal)}</span><span className="grow" />View Cart</div>
      </Link>
    </div>
  );
}
```

In `App.tsx`:
- Render `<CartBar />` after `<Routes>`.
- Add `<Route path="/cart" element={<Cart />} />`.
- Add `<Route path="/login" element={<div style={{ padding: 40, textAlign: 'center' }}>Sign-in comes in the next update.</div>} />`.

- [ ] **Step 6: Run all tests and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass, tsc exits 0.

- [ ] **Step 7: Commit**

```bash
git add apps/customer-web/src
git commit -m "feat(customer-web): cart page with savings, fee rules, unavailable lines; green cart bar"
```

---

### Task 13: Run against the local backend and check it end to end

**Files:**
- Modify (local only, not committed): `backend/api/.env`. Add `,http://localhost:5177` to `CORS_ORIGINS`.
- Create: `apps/customer-web/README.md`

- [ ] **Step 1: Start the local API and the shop**

Each command runs in its own terminal.

```bash
cd backend/api && npm run dev
```

```bash
cd apps/customer-web && npm run dev
```

Then open http://localhost:5177/app/ with the browser in phone emulation (390×844).

- [ ] **Step 2: Manual checks**

Write down **pass** or **fail** for each:
- home loads its skeleton, then real local products;
- the category tiles show `FROM` badges;
- + changes to a stepper, and the cart bar appears;
- an aisle opens;
- the product page opens;
- search finds "milk";
- the cart shows savings and the delivery fee text;
- stopping the API shows an error with Try again, which recovers once the API is started again.

- [ ] **Step 3: Write `README.md`**

```markdown
# Blynk customer web (PWA)

The new, light customer shop (React + Vite), replacing the Flutter web build at blynk.lk/app in Phase 4.

- `npm run dev` — http://localhost:5177/app/ (needs the API on :4000 and `http://localhost:5177` in its CORS_ORIGINS)
- `npm test` — unit and screen tests
- `npm run build` — production build; `VITE_API_BASE_URL` must be the https API address

Design: docs/redesign/prototype/index.html. Must-keep features: docs/customer-app-redesign-contract.md.
Plans: docs/superpowers/plans/2026-10-13-blynk-customer-web-phase1.md (this phase); phases 2-4 to follow.
```

- [ ] **Step 4: Production build check**

Run: `cd apps/customer-web && VITE_API_BASE_URL=https://blynk-api.valgrowlabs.com/api/v1 npm run build && du -sh dist && gzip -c dist/assets/*.js | wc -c`

Expected: the build succeeds and the gzipped JS is under 120 000 bytes. That is the "light" promise; record the number in the commit message.

- [ ] **Step 5: Commit**

```bash
git add apps/customer-web/README.md
git commit -m "docs(customer-web): how to run phase 1; gzipped JS <N> bytes"
```
