# Seller portal (separate responsive web app) - design

Owner, 2026-10-23: "a separate RWD application for sellers: they can upload their products and their
things; before that they have to get approved by our admin, and their products and pricing also;
they sign in with their phone number and OTP." Model left to us ("use the proper model that suits").

## Intent

Let local sellers (shops, home businesses, producers) list products on Blynk without Blynk staff
typing them in, while Admin keeps full control of what goes live and at what price.

## The model (our call): consignment, Blynk stays the shop

- Customers still buy from **Blynk**. One cart, one delivery, one cash-on-delivery payment. Seller
  products sit in the same customer app next to Blynk's own (optional "Sold by <shop>" line).
- **Blynk packs and delivers** from the dark store. The seller hands goods to the dark store.
- **Stock is Blynk-held**: staff confirm the quantity received in Inventory (the existing flow); the
  seller sees their stock and sales read-only. Sellers cannot make stock appear on their own.
- **Money**: Blynk collects the customer's cash. Per delivered order the seller is owed
  `seller price x quantity` (minus an optional commission %). The portal shows a statement; Admin marks
  payouts as paid by hand (a ledger, no online payouts in v1).
- **Pricing**: the seller proposes their price. Admin approves the product and sets the customer-facing
  price (the existing fixed price / markup rules). A seller price change creates a new pending version;
  the live product keeps its old price until Admin approves the new one.

## Flow

1. Seller opens the portal, enters a phone number, gets an OTP (existing SMS OTP), signs in.
2. First time: they fill the shop profile (name, contact, address, a note). Status **PENDING**; they can
   look around but not list until Admin approves the seller. (Admin → Sellers: approve / reject / suspend.)
3. Approved seller adds products: name, category, photos, unit / sizes, description, their price.
   Each submission is **PENDING**; nothing is visible to customers.
4. Admin → Product approvals: sees the submission (and what changed for an edit), sets the selling price,
   approves or rejects with a reason. Approved = live in the customer app.
5. Stock arrives at the dark store; Inventory records it against the seller's product.
6. Orders flow through the normal Ops / Rider screens; sold quantities feed the seller's statement.

## Parts

- `apps/seller`: new responsive web app (Vite + React like Admin, mobile-first), served as its own
  site. Screens: sign-in, shop profile, my products (status chips), add / edit product, stock and sales,
  statement.
- API: SELLER role, seller table and ownership of products, submissions / revisions with a status,
  approval endpoints for Admin, statement query. Migrations are manual in Coolify (as always).
- Admin: Sellers list and approvals; Product approvals queue; payouts ledger. Ops gets read access to
  seller names on products only.

## Goals / non-goals / anti-goals

- Goals: sellers self-serve their catalogue; Admin approves sellers, products and prices; phone + OTP only.
- Non-goals (v1): sellers delivering themselves, seller-chosen delivery fees, chat, reviews, several
  logins per seller, online payouts, seller-run offers, seeing customer names or addresses.
- Anti-goals: a seller product or a seller price change going live without Admin approval; a seller
  seeing another seller's data or any customer's personal details.

## Decisions I made (please check)

1. Consignment model above (Blynk holds stock, delivers and collects the cash).
2. Seller products appear mixed in the customer app, with a small "Sold by" line.
3. Seller edits to price or name re-enter approval; the live version stays until approved.
4. Payouts are a manual ledger in v1; commission % is one setting per seller (default 0).
5. A phone number belongs to one account (existing rule): a number already used as a customer cannot
   also be a seller. (Alternative: let one number hold both roles - needs your call.)
6. The portal lives on its own address; I suggest `seller.blynk.lk`.

## Open questions for the owner

- Commission: charge sellers a % per sale, or is Blynk's gain only the markup on their price?
- Seller domain: `seller.blynk.lk` ok?
- Same phone number as a customer and a seller: allowed or not?
- Do sellers get notified (SMS) when a product is approved or rejected? (suggested: yes)
