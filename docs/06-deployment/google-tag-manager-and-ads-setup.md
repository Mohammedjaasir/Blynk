# Google Tag Manager, Google Analytics, Google Ads and Meta (Facebook) Pixel setup

**STATUS (2026-10-10): the website code is done and tested. Nothing outside the code exists yet.** No GTM container, GA4 property, Google Ads conversion or Meta Pixel has been created, and no GTM ID is set in Coolify, so blynk.lk sends no tracking today. Nobody has checked the events on the live site yet. Section 9 says how to check them.

Who this is for: the owner (steps 1 and 2: accounts and Coolify) and the marketer (steps 3 to 9: everything inside Google and Meta). Every click is written out. You don't need to change any code.

---

## 0. How it fits together (read once)

```
blynk.lk (landing page)  ─┐                      ┌─> Google Analytics 4 (reports, audiences)
blynk.lk/app/ (the shop) ─┼─> dataLayer events ─> Google Tag Manager ─┼─> Google Ads (conversions, remarketing)
                          ┘   (code, already done)  (you set this up)  └─> Meta Pixel (Facebook / Instagram ads)
```

- **The website only describes what happened.** For example: "a customer added Kotmale Milk, LKR 540, to the cart". It puts these messages into a list called the `dataLayer`. The website itself never talks to Google Analytics, Google Ads or Facebook.
- **Google Tag Manager (GTM)** reads those messages and passes them on to GA4, Google Ads and Meta. You decide which messages go where, inside GTM, with no code change and no redeploy.
- The event names follow Google's GA4 "recommended events" (`add_to_cart`, `purchase` …), so GA4 understands them without extra work. Meta and Google Ads use the same events.
- **The container ID is not in the code.** It is a Coolify build setting (`GTM_ID`). With no `GTM_ID`, the build removes the GTM code from both pages completely, so no tracking request is ever made. Turning tracking off is therefore one setting plus a redeploy.
- **No personal data is ever sent.** No phone number, name, address, email or map location goes to the dataLayer. A signed-in customer appears only as a scrambled code (a one-way SHA-256 hash of their customer number). See section 11.

Internal apps (Admin, Inventory, Ops, Rider) have no tracking and must not get any.

---

## 1. Create the Google Tag Manager account and container (owner, about 5 minutes)

Use the Google account that should own Blynk's marketing data. Use a company Google account, not a personal one, if you have it.

1. Open **https://tagmanager.google.com** and sign in.
2. Click **Create Account**.
3. **Account Setup:** Account Name `Blynk`, Country `Sri Lanka`. Leave "Share data anonymously…" as you prefer.
4. **Container Setup:** Container name `blynk.lk`, Target platform **Web**.
5. Click **Create**, read the Terms of Service, tick **I also accept the Data Processing Terms…**, then click **Yes**.
6. A box titled "Install Google Tag Manager" opens with two code snippets. **You don't need the snippets** because the site already has them. Close the box.
7. At the top of the workspace, next to "Workspace", is the container ID. It looks like **`GTM-ABC1234`** (GTM-, then 6 to 10 capital letters and digits). Copy it.

Add your marketer: **Admin** (top menu) → **User Management** (under the Container column) → **+** → **Add users** → their email → **Container permissions: Publish** → **Invite**.

---

## 2. Switch it on in Coolify (owner, about 10 minutes plus a build)

The landing page and the shop are built and served by **one** Coolify application. It is built from `apps/customer-site/Dockerfile`, and it is the application that already has `API_BASE_URL` set.

1. Open Coolify → your project → the **customer website** application (the one serving https://blynk.lk).
2. Open **Environment Variables**.
3. Add a variable:
   - **Key:** `GTM_ID`
   - **Value:** your container ID, for example `GTM-ABC1234`. Use capital letters and no spaces.
   - Tick **Is Build Variable?** (also called "Build Variable" or "Available at build time"). This step matters: the ID is written into the pages while the site is built. A runtime-only variable does nothing.
4. Optional: add **`CONSENT_DEFAULT`** (also a Build Variable):
   - `granted` (the default if you leave it out): GA4, Google Ads and Meta measure everyone, except browsers that ask not to be tracked (see section 11).
   - `denied`: Google tags send only anonymous, cookieless pings, and Meta tags (set up as in step 8) don't fire. Use this only together with a cookie banner that switches consent on when the visitor agrees. Blynk has no banner today.
5. Click **Save**, then **Redeploy**. The build takes several minutes because the Flutter shop is rebuilt too. If `GTM_ID` is malformed (lower-case letters, a typo such as `UA-…` or `G-…`), **the build fails on purpose** with the message `GTM_ID must look like GTM-XXXXXXX`. Fix the value and redeploy.
6. **Clear Cloudflare's cache** (blynk.lk runs behind Cloudflare): Cloudflare dashboard → **blynk.lk** → **Caching** → **Configuration** → **Purge Everything** → **Purge Everything**. Or use **Custom Purge** with `https://blynk.lk/`, `https://blynk.lk/app/` and `https://blynk.lk/app/index.html`.
7. Check it is live: open https://blynk.lk on a computer, right-click → **View page source**, and press Ctrl+F `googletagmanager`. You should find it, followed by your ID. Do the same for `https://blynk.lk/app/?desktop=1`.

**About the shop's cache.** The server tells browsers to re-check `index.html` and `/app/` on every visit, so a redeploy normally shows up at once. The shop is a PWA, though. A phone that has it on the Home Screen (or a browser tab left open) can keep showing the old page until the app is fully closed and opened again, sometimes twice. When you test on a phone, close Blynk from the recent-apps list and reopen it.

**To turn all tracking off:** delete `GTM_ID`, or empty its value, then Redeploy and purge Cloudflare. The GTM code is removed from both pages.

---

## 3. Google Analytics 4 (marketer, about 15 minutes)

### 3.1 Create the property

1. Open **https://analytics.google.com** → **Admin** (gear icon, bottom left) → **+ Create** → **Property**.
2. Property name `Blynk`, Reporting time zone **Sri Lanka (GMT+05:30)**, Currency **Sri Lankan Rupee (LKR)** → **Next**.
3. Fill in the business details (Industry: Shopping / Food & Drink; size) → **Next** → choose objectives (for example "Drive online sales" and "Generate leads") → **Create**.
4. Choose a platform: **Web**. Website URL `https://blynk.lk`, Stream name `blynk.lk`.
5. Open **Enhanced measurement** (the gear on the stream page) and **switch off "Page changes based on browser history events"**. Blynk sends its own page views (see 4.3). Leaving this on double-counts screens in the shop. Leave the rest as it is.
6. Click **Create stream**. Copy the **Measurement ID** (`G-XXXXXXXXXX`). Ignore the "installation instructions" because GTM does the installing.

### 3.2 Mark the important events as key events (conversions)

Do this after the first events have arrived (step 9), or create them by name straight away: **Admin** → **Data display** → **Key events** → **New key event**. Add each of these names:

- `purchase` (an order placed. Blynk is cash on delivery, so it counts when the order is placed)
- `sign_up` (a new customer finished signing up)
- `get_blynk_click` (someone tapped "Get Blynk" on the landing page: a lead)
- optionally `pwa_installed` (the shop was added to a Home Screen)

### 3.3 Custom dimensions (so the extra details show in reports)

**Admin** → **Data display** → **Custom definitions** → **Create custom dimension**, scope **Event**, one for each:

| Dimension name | Event parameter |
|---|---|
| Button location | `button_location` |
| Phone type | `platform` |
| Contact method / sign-in method | `method` |
| Link location | `link_location` |
| Install guide step | `step_number` |
| Install guide step title | `step_title` |
| Site | `site` |
| Shared content | `content_type` |

---

## 4. Build the GTM container (marketer, about 30 minutes)

Work in https://tagmanager.google.com, container `blynk.lk`. Nothing goes live until you click **Submit** (step 10).

### 4.1 Variables

**Variables** → **Built-In Variables: Configure** → tick **Event**, **Page URL**, **Page Path** (some are on already).

**Variables** → **User-Defined Variables: New** → **Variable Configuration** → **Data Layer Variable**. Create one for each row below. Use the exact "Data Layer Variable Name", leave Data Layer Version at 2, and give it the name shown.

| GTM variable name | Data Layer Variable Name |
|---|---|
| `DLV - user_id` | `user_id` |
| `DLV - site` | `site` |
| `DLV - page_path` | `page_path` |
| `DLV - page_location` | `page_location` |
| `DLV - page_title` | `page_title` |
| `DLV - search_term` | `search_term` |
| `DLV - method` | `method` |
| `DLV - content_type` | `content_type` |
| `DLV - item_id` | `item_id` |
| `DLV - button_location` | `button_location` |
| `DLV - link_location` | `link_location` |
| `DLV - platform` | `platform` |
| `DLV - step_number` | `step_number` |
| `DLV - step_total` | `step_total` |
| `DLV - step_title` | `step_title` |
| `DLV - ecommerce.value` | `ecommerce.value` |
| `DLV - ecommerce.currency` | `ecommerce.currency` |
| `DLV - ecommerce.transaction_id` | `ecommerce.transaction_id` |
| `DLV - ecommerce.coupon` | `ecommerce.coupon` |
| `DLV - ecommerce.items` | `ecommerce.items` |

Two more, for Meta: **New** → **Custom JavaScript**:

`JS - item ids` (the product ids in the event):

```javascript
function () {
  var items = {{DLV - ecommerce.items}};
  if (!items || !items.length) return undefined;
  var ids = [];
  for (var i = 0; i < items.length; i++) ids.push(items[i].item_id);
  return ids;
}
```

`JS - item count` (how many units):

```javascript
function () {
  var items = {{DLV - ecommerce.items}};
  if (!items || !items.length) return undefined;
  var n = 0;
  for (var i = 0; i < items.length; i++) n += items[i].quantity || 1;
  return n;
}
```

### 4.2 Triggers

**Triggers** → **New** → **Trigger Configuration** → **Custom Event**. Create these. "Event name" must match exactly.

| Trigger name | Event name | Use regex matching |
|---|---|---|
| `CE - all Blynk events` | `^(page_view\|get_blynk_click\|install_guide_step\|open_app_click\|contact_click\|sign_up\|login\|view_item_list\|view_item\|add_to_cart\|remove_from_cart\|view_cart\|begin_checkout\|add_shipping_info\|purchase\|search\|select_promotion\|share\|pwa_installed)$` | **yes** |
| `CE - page_view` | `page_view` | no |
| `CE - purchase` | `purchase` | no |
| `CE - sign_up` | `sign_up` | no |
| `CE - get_blynk_click` | `get_blynk_click` | no |
| `CE - view_item` | `view_item` | no |
| `CE - add_to_cart` | `add_to_cart` | no |
| `CE - begin_checkout` | `begin_checkout` | no |
| `CE - search` | `search` | no |

(Type the regex with plain `|` characters. The `\|` in the table only stops the table from breaking.)

### 4.3 Google tag (GA4 base)

**Tags** → **New** → **Tag Configuration** → **Google Tag**.

- **Tag ID:** your `G-XXXXXXXXXX`.
- **Configuration settings** → **Add parameter**: Configuration parameter **`send_page_view`**, value **`false`**. This is required. Both sites send their own `page_view` event (4.4). Without this setting every page is counted twice.
- **Shared event settings** (optional): add `site` = `{{DLV - site}}`.
- **Triggering:** **Initialization - All Pages**.
- Name it `GA4 - Google tag` → **Save**.

### 4.4 One GA4 event tag for every Blynk event

**Tags** → **New** → **Tag Configuration** → **Google Analytics: GA4 Event**.

- **Measurement ID:** your `G-XXXXXXXXXX`.
- **Event Name:** `{{Event}}`. The built-in variable passes each event under its own name: `add_to_cart`, `purchase`, and so on.
- **More Settings → Ecommerce → Send Ecommerce data**: tick it, Data source **Data Layer**. This sends `items`, `value`, `currency`, `transaction_id`, `shipping` and `coupon` automatically for the shopping events.
- **Event Parameters → Add parameter**, one row each:
  `user_id` = `{{DLV - user_id}}`, `page_path` = `{{DLV - page_path}}`, `page_location` = `{{DLV - page_location}}`, `page_title` = `{{DLV - page_title}}`, `search_term` = `{{DLV - search_term}}`, `method` = `{{DLV - method}}`, `content_type` = `{{DLV - content_type}}`, `item_id` = `{{DLV - item_id}}`, `button_location` = `{{DLV - button_location}}`, `link_location` = `{{DLV - link_location}}`, `platform` = `{{DLV - platform}}`, `step_number` = `{{DLV - step_number}}`, `step_title` = `{{DLV - step_title}}`, `site` = `{{DLV - site}}`.
  (A parameter that an event doesn't have is simply left out.)
- **Triggering:** `CE - all Blynk events`.
- Name it `GA4 - all Blynk events` → **Save**.

If you prefer one tag per event (for example to send some events to a second property), make a copy of this tag, set a fixed Event Name such as `purchase`, and use the matching single trigger.

---

## 5. Google Ads conversions (marketer, about 20 minutes)

You need a Google Ads account (https://ads.google.com). Set its currency to LKR when you create it, because the currency can't be changed later.

### 5.1 Link GA4 and Google Ads (do this in any case)

GA4 **Admin** → **Product links** → **Google Ads links** → **Link** → choose the Ads account → **Next** → leave "Enable personalised advertising" on → **Submit**. This lets you build GA4 audiences for remarketing and import GA4 key events into Ads.

### 5.2 Conversion actions (the GTM route, which gives the best data)

In Google Ads: **Goals** (trophy icon) → **Conversions** → **Summary** → **+ Create conversion action** → **Website** → enter `https://blynk.lk` → **Scan** → scroll to **Add a conversion action manually**. Create three:

| Conversion name | Goal category | Value | Count |
|---|---|---|---|
| Blynk - Purchase | **Purchase** | "Use different values for each conversion", default LKR 0 | **Every** |
| Blynk - Sign up | **Sign-up** | "Don't use a value" (or a fixed value you choose) | **One** |
| Blynk - Get Blynk click | **Submit lead form** (or "Contact") | "Don't use a value" | **One** |

For each one: **Done** → **Save and continue** → under tag setup choose **Use Google Tag Manager**. Note the **Conversion ID** (digits, the same for all three) and the **Conversion Label** (different for each).

### 5.3 GTM tags for Google Ads

1. **Conversion Linker** (required once): **Tags** → **New** → **Conversion Linker** → trigger **Initialization - All Pages** (or All Pages) → name `Ads - Conversion Linker` → **Save**.
2. **Purchase:** **Tags** → **New** → **Google Ads Conversion Tracking**:
   - Conversion ID and Conversion Label for "Blynk - Purchase".
   - **Conversion Value:** `{{DLV - ecommerce.value}}`
   - **Transaction ID:** `{{DLV - ecommerce.transaction_id}}` (the Blynk order number, so Google never counts one order twice)
   - **Currency Code:** `{{DLV - ecommerce.currency}}` (always `LKR`)
   - Trigger `CE - purchase` → name `Ads - Purchase` → **Save**.
3. **Sign up:** same tag type, its own ID and label, no value. Trigger `CE - sign_up` → `Ads - Sign up`.
4. **Get Blynk click:** same tag type, its own ID and label. Trigger `CE - get_blynk_click` → `Ads - Get Blynk click`.
5. Optional remarketing: **Tags** → **New** → **Google Ads Remarketing** → Conversion ID → trigger **All Pages**.

**Enhanced conversions are deliberately not available.** That feature needs the customer's email or phone number, which Google hashes. Blynk's rule is that no phone, name or email ever goes to the dataLayer, so leave enhanced conversions **off**. Turning it on would need a code change and an update to the privacy policy, and it is the owner's decision.

**Imported GA4 conversions instead (simpler, less precise):** in Ads, **Goals** → **Conversions** → **+ Create conversion action** → **Import** → **Google Analytics 4 properties** → **Web** → tick `purchase`, `sign_up`, `get_blynk_click`. Use **either** the GTM tags **or** the imports for the same action, never both as "Primary", or conversions double.

---

## 6. Meta (Facebook / Instagram) Pixel (marketer, about 30 minutes)

You need a Meta Business portfolio (https://business.facebook.com) that owns the Blynk Facebook page and ad account.

### 6.1 Create the Pixel (dataset)

1. Open **Events Manager** (https://business.facebook.com/events_manager) → **Connect data** (green **+**) → **Web** → **Connect**.
2. Name it `Blynk website` → enter `https://blynk.lk` → **Check** → choose **Set up manually** (or "Install code manually"). Do **not** choose a partner integration.
3. Copy the **Pixel ID** (also called the Dataset ID, a long number). You don't need the base code it shows.

### 6.2 Add the Meta Pixel template to GTM

1. GTM → **Templates** → **Tag Templates: Search Gallery** → search **Facebook Pixel** → choose the one by **facebookarchive** → **Add to workspace** → **Add**.
2. **Tags** → **New** → **Tag Configuration** → **Facebook Pixel** (the template you just added).

### 6.3 The Meta tags

Create one tag per row with the Facebook Pixel template:

- **Facebook Pixel ID(s):** your Pixel ID, in every tag.
- **Event Name:** "Standard", with the event shown.
- **Object Properties:** add the rows shown.
- **Advanced Settings → Consent Settings → Require additional consent for tag to fire → `ad_storage`.** Add this to every Meta tag. With it, Meta respects `CONSENT_DEFAULT=denied` and browsers that send Do Not Track or Global Privacy Control.

| Tag name | Standard event | Object properties | Event ID | Trigger |
|---|---|---|---|---|
| `Meta - PageView` | PageView | (none) | | `CE - page_view` |
| `Meta - ViewContent` | ViewContent | `content_ids` = `{{JS - item ids}}`, `content_type` = `product`, `value` = `{{DLV - ecommerce.value}}`, `currency` = `{{DLV - ecommerce.currency}}` | | `CE - view_item` |
| `Meta - AddToCart` | AddToCart | same four as ViewContent | | `CE - add_to_cart` |
| `Meta - InitiateCheckout` | InitiateCheckout | `content_ids`, `content_type` = `product`, `value`, `currency`, `num_items` = `{{JS - item count}}` | | `CE - begin_checkout` |
| `Meta - Purchase` | Purchase | `content_ids`, `content_type` = `product`, `value` = `{{DLV - ecommerce.value}}`, `currency` = `{{DLV - ecommerce.currency}}`, `num_items` = `{{JS - item count}}` | `{{DLV - ecommerce.transaction_id}}` | `CE - purchase` |
| `Meta - CompleteRegistration` | CompleteRegistration | `status` = `true` | | `CE - sign_up` |
| `Meta - Lead` | Lead | `content_name` = `Get Blynk`, `content_category` = `{{DLV - button_location}}` | | `CE - get_blynk_click` |
| `Meta - Search` | Search | `search_string` = `{{DLV - search_term}}` | | `CE - search` |

Why PageView uses `CE - page_view` and not "All Pages": the shop changes screens without loading a new page. Blynk sends a `page_view` event for every screen, and that event fires PageView once per screen on both sites. Don't tick the template's automatic PageView option if it offers one.

**Later: the Conversions API (CAPI).** Ad blockers and iPhone privacy settings stop some Pixel events. Meta's Conversions API sends the same events from Blynk's server. That is a backend task, not part of this setup. When it is built, it must send the same Event ID (the order number) so Meta keeps one copy of each purchase. This is why the Purchase tag already sets an Event ID.

### 6.4 Verify the blynk.lk domain (owner, about 5 minutes plus DNS time)

Meta wants proof that you own blynk.lk before ads can use the website events fully.

1. **Business settings** (https://business.facebook.com/settings) → **Brand safety and suitability** → **Domains** → **Add** → `blynk.lk` → **Add domain**.
2. Choose **DNS TXT record** (also called "Update DNS TXT record"). Copy the value. It looks like `facebook-domain-verification=abc123…`.
3. Cloudflare dashboard → **blynk.lk** → **DNS** → **Records** → **Add record**:
   - Type **TXT**
   - Name **`@`**
   - Content: paste the whole value
   - TTL **Auto**
   - **Save**
4. Back in Meta, click **Verify domain**. If it says "not found", wait 15 minutes (DNS can take up to 72 hours) and click again. Leave the TXT record in place permanently.
5. If Events Manager asks you to configure web events or event priority for blynk.lk (Aggregated Event Measurement), put **Purchase** first, then CompleteRegistration, InitiateCheckout, AddToCart, Lead, ViewContent.

---

## 7. What else is in the container

You don't need anything else. Keep the container tidy: one GA4 Google tag, one GA4 event tag, the Ads tags, and the Meta tags. Don't add Custom HTML tags that read form fields or page text. That could capture phone numbers, which would break the privacy promise in section 11.

---

## 8. The events (reference)

Every event below is pushed as `window.dataLayer.push({...})`. Shopping events follow GA4's ecommerce format. Before each one, the shop pushes `{ecommerce: null}` to clear the previous one, as Google recommends. Each item looks like this:
`{item_id, item_name, item_category, price, quantity}`. A listing also sends `index`, `item_list_id` and `item_list_name`. Combo packs use `item_category: "Combo packs"`. Amounts are in LKR.

Every shop event also carries **`user_id`**: the hashed customer id when signed in, `null` when not. Every page also sets **`site`**: `landing` or `app`.

| Event | Site | When it fires | Parameters | GA4 | Google Ads | Meta |
|---|---|---|---|---|---|---|
| `page_view` | both | Landing: page load. Shop: every screen (hash route such as `#/home`, `#/cart`), including going back | `page_path`, `page_location` (campaign parameters such as `utm_*`, `gclid` and `fbclid` are kept), `page_title` | page_view | (remarketing) | PageView |
| `get_blynk_click` | landing | Any "Get Blynk" button | `button_location` (`header`, `hero`, `products`, `products_grid`, `about`), `platform` (`ios`, `android`, `desktop`) | key event | Get Blynk click conversion | Lead |
| `install_guide_step` | landing | Each step of the "add to Home Screen" walkthrough is shown | `platform` (`ios`, `android`), `step_number`, `step_total`, `step_title`, `from_computer` | event | - | - |
| `open_app_click` | landing | "Open Blynk" at the end of the walkthrough | `button_location` = `install_guide`, `platform` | event | - | - |
| `contact_click` | landing | The "Call" or "WhatsApp us" link | `method` (`call`, `whatsapp`), `link_location` (`footer`). The phone number is never sent | event | - | (optional: Contact) |
| `login` | shop | A returning customer signs in with the SMS code | `method` = `phone_otp` | login | - | - |
| `sign_up` | shop | A new customer gives their name after the SMS code | `method` = `phone_otp` | key event | Sign up conversion | CompleteRegistration |
| `view_item_list` | shop | Home's product list first shows; a category or "All products" list shows | `ecommerce.item_list_id` (`home`, `category_<slug>`, `all_products`), `item_list_name`, `items` (first 20) | view_item_list | - | - |
| `view_item` | shop | A product page opens | `ecommerce.currency`, `value`, `items` (1) | view_item | - | ViewContent |
| `add_to_cart` | shop | Any "+" / Add (product or combo pack), "Order again" | `ecommerce.currency`, `value`, `items` (with the quantity added) | add_to_cart | - | AddToCart |
| `remove_from_cart` | shop | Any "−" or removing a line | `ecommerce.currency`, `value`, `items` | remove_from_cart | - | - |
| `view_cart` | shop | The cart opens | `ecommerce.currency`, `value` (cart subtotal), `items` | view_cart | - | - |
| `begin_checkout` | shop | Checkout opens | `ecommerce.currency`, `value`, `items` | begin_checkout | - | InitiateCheckout |
| `add_shipping_info` | shop | The order is sent with its delivery address (once per checkout attempt; a retry is not counted again) | `ecommerce.currency`, `value`, `items`, `shipping_tier` (`asap` or `scheduled`), `coupon` (if any) | add_shipping_info | - | - |
| `purchase` | shop | The server confirms the order | `ecommerce.transaction_id` (order number, for example `BL-20261010-1234`), `value` (order total), `shipping` (delivery fee), `currency` `LKR`, `coupon` (if any), `payment_type` (`COD`), `items` | key event | Purchase conversion (value, transaction id) | Purchase (value, currency, event ID) |
| `search` | shop | A search is submitted, a recent search is tapped, or a search with results is left (once per term, not per keystroke) | `search_term` (phone numbers and emails are replaced with `[redacted]`) | search | - | Search |
| `select_promotion` | shop | A Home banner (promotion) is tapped | `ecommerce.promotion_id`, `promotion_name`, `creative_slot` | select_promotion | - | - |
| `share` | shop | "Share your code" (Refer a friend) or a product's share button | `method` = `share_sheet`, `content_type` (`referral`, `product`), `item_id` (product only). The referral code is never sent | share | - | - |
| `pwa_installed` | shop | The browser reports the shop was added to the Home Screen (Android Chrome; iPhone Safari doesn't report this) | none | event (optional key event) | - | - |

What is **not** tracked: Orders/Help/Profile tab switches inside the shop (they are tabs, not screens with their own address), dental appointments, and anything in the staff apps.

---

## 9. Test before you publish

### 9.1 GTM Preview (Tag Assistant)

1. In GTM, click **Preview** (top right). Tag Assistant opens. Enter `https://blynk.lk` → **Connect**. A new window opens the site with a "Tag Assistant Connected" badge.
2. On the landing page, tap **Get Blynk** in the header and in the hero, go through the walkthrough steps, and click the WhatsApp link. In the Tag Assistant window, each one appears on the left (`get_blynk_click`, `install_guide_step`, `contact_click`). Click one to see **Tags Fired** (`GA4 - all Blynk events`, `Ads - Get Blynk click`, `Meta - Lead`) and the **Data Layer** tab (the parameters, with no phone number anywhere).
3. Test the shop the same way. On a computer the shop shows "Blynk is a phone app" by design, so connect Tag Assistant to **`https://blynk.lk/app/?desktop=1`**. Open a product (`view_item`), add to cart (`add_to_cart`), open the cart (`view_cart`), go to checkout (`begin_checkout`), and search. `page_view` should appear for every screen.
4. For a full `purchase` test, place a real small order (it is cash on delivery), then cancel it from Ops. **That test order will count as a conversion.** To exclude it, use GA4 **Admin** → **Data streams** → the stream → **Configure tag settings** → **Show more** → **Define internal traffic** for your office IP, or simply note the order number.

### 9.2 GA4 DebugView

While Preview is connected, open GA4 → **Admin** → **Data display** → **DebugView**. Events arrive within seconds. Click `purchase` to check `value`, `currency`, `transaction_id`, `shipping` and `items`. Normal reports take 24 to 48 hours to fill.

### 9.3 Meta

- **Events Manager** → your Pixel → **Test events** → enter `https://blynk.lk` → **Open website**. Click around. PageView, Lead, ViewContent, AddToCart and the rest appear live. Tag consent must be granted (the default) for Meta tags to fire.
- Or install the **Meta Pixel Helper** Chrome extension and click its icon on blynk.lk.

### 9.4 Google Ads

Ads **Goals** → **Conversions** → each action's **Status** shows "Recording conversions" within a few hours of the first real one. Tag Assistant also shows the Ads tags firing.

---

## 10. Publish the container

In GTM: **Submit** (top right) → **Publish and Create Version** → Version name, for example `v1 GA4 + Ads + Meta, 2026-10` → **Publish**.

Every later change is the same: edit, **Preview**, then **Submit**. **Versions** keeps every published version, so you can roll back with **Versions** → the older version → **⋮** → **Publish**.

---

## 11. Privacy: what is and isn't sent

**Sent:** which pages and screens are viewed, which buttons are tapped, products viewed, added and bought (product id, name, category, price and quantity), order number and totals, delivery fee, coupon code, search words, the phone type (iPhone, Android or computer), and a hashed customer id. GA4, Google Ads and Meta also see what any website sees: IP address, browser, and the ad click that brought the visitor.

**Never sent (enforced in code and covered by tests):** phone numbers (the customer's, the rider's, and Blynk's own support number in the contact links), names, delivery addresses, map locations, email addresses, the SMS code, sign-in tokens, the referral code, order notes. Each shop event passes through a filter (`Analytics.sanitize` in `lib/Services/analytics/analytics.dart`). The filter drops personal-sounding fields and replaces any phone- or email-looking text, such as a phone number typed into search, with `[redacted]`. The test `test/analytics_test.dart` replays a whole journey (sign-in, cart, search, order with a real recipient name, phone and address) and fails if any of them reaches the dataLayer.

**Consent and Do Not Track.** The pages set Google Consent Mode v2 defaults before GTM loads: `ad_storage`, `ad_user_data`, `ad_personalization` and `analytics_storage`. They are all `granted` by default, or all `denied` with `CONSENT_DEFAULT=denied`. A browser that sends **Global Privacy Control** or **Do Not Track** always gets `denied`, whatever the setting. Google tags then send only cookieless pings, and the Meta tags don't fire (because of the `ad_storage` consent check in 6.3). There is no cookie banner today. If Blynk later targets visitors from the EU or UK, or the law changes, add a consent banner (a GTM "Consent Management Platform" template) and set `CONSENT_DEFAULT=denied`.

**Add to the privacy policy** (wherever Blynk's privacy policy lives), in plain words:

> Blynk's website and web shop use Google Analytics, Google Ads and Meta (Facebook) Pixel, through Google Tag Manager, to understand how the site is used and to measure our advertising. They receive the pages you view, the products you look at, add to your cart and buy, and your order totals, together with cookies and your device's browser information. We never send them your name, phone number, address or email; a signed-in account is shared only as a scrambled code that cannot be turned back into your details. If your browser sends a "Do Not Track" or "Global Privacy Control" signal, advertising and analytics cookies are switched off. You can also opt out of Google Analytics at https://tools.google.com/dlpage/gaoptout and manage Meta ad preferences in your Facebook settings.

Ask whoever handles Blynk's legal matters whether Sri Lanka's Personal Data Protection Act (No. 9 of 2022) needs anything more. This document is not legal advice.

---

## 12. Troubleshooting

| What you see | Why, and what to do |
|---|---|
| Coolify build fails: `GTM_ID must look like GTM-XXXXXXX` | The value has lower-case letters, spaces, or is a GA4 ID (`G-…`) instead of a container ID. Copy it again from GTM's top bar. |
| Build fails: `CONSENT_DEFAULT must be granted or denied` | Fix the spelling, or delete the variable. |
| View source shows no `googletagmanager` | `GTM_ID` was not a **Build** variable, the redeploy didn't run, or Cloudflare still serves the old page. Purge Cloudflare (section 2, step 6). |
| Landing page works but the shop doesn't | The old shop is cached on that phone or browser. Close the app fully and reopen it, or hard-refresh. On a computer use `/app/?desktop=1`. |
| Tag Assistant shows the events but GA4 has nothing | The GA4 tags may not be published yet (Preview is not live). Check the Measurement ID. Remember that reports lag by 24 to 48 hours, while DebugView is live. |
| Every page counted twice in GA4 | `send_page_view=false` is missing on the Google tag (4.3), or Enhanced measurement's "browser history events" is still on (3.1). |
| Meta tags never fire | The `ad_storage` consent is denied (`CONSENT_DEFAULT=denied`, or your browser sends Do Not Track or GPC; turn it off to test). The Pixel ID may also be wrong. |
| Purchases counted twice in Google Ads | Both the GTM conversion tag and an imported GA4 `purchase` are "Primary". Keep one. |

---

## 13. For developers

- Landing page: `apps/customer-site/index.html` (GTM snippet between the `GTM-HEAD-START`/`-END` and `GTM-BODY-START`/`-END` markers) and `apps/customer-site/analytics.js` (the landing events, `window.blynkTrack`). `walkthrough.js` reports each step through `blynkTrack`.
- Shop: `apps/customer/blinkit-clone-Flutter-ecommerce-/web/index.html` (the same snippet, plus `pwa_installed`), `lib/Services/analytics/analytics.dart` (all events, the hashed `user_id`, the PII filter), `data_layer_web.dart` (the JS bridge: `window.dataLayer.push`, and nothing at all when there is no dataLayer), `data_layer_stub.dart` (a no-op on Android, iOS and in tests), and `analytics_route_observer.dart` (`page_view`, `view_cart`, `begin_checkout`). Events are sent from `CartProvider`, `OrderProvider`, `AuthProvider`, the product, products, search and refer-a-friend screens, the Home feed, and the Home carousel.
- Build: `apps/customer-site/gtm-inject.sh`, run by `apps/customer-site/Dockerfile` after the Flutter shop is copied in. It fills in `__GTM_ID__` and `__CONSENT_DEFAULT__`, or deletes the marked blocks when `GTM_ID` is empty. Unfilled placeholders (local `flutter run`) load nothing, because the snippet checks the ID's shape first.
- Tests: `node --test apps/customer-site/tests/gtm.test.mjs` (inject script, consent defaults, DNT/GPC, landing events) and `flutter test test/analytics_test.dart test/analytics_screens_test.dart` (event shapes, user id, PII guard, cart, checkout, sign-in, route observer, screens).
- To add an event: add a method to `Analytics` (use a GA4 recommended name if one fits), call it from the one place it happens, add it to the table in section 8 and to the `CE - all Blynk events` regex in 4.2, and extend the PII journey test.
