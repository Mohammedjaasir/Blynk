// The words and form of blynk.lk/seller, "Sell with Blynk" (owner's brother, 2026-10-27: "one form inside
// blynk.lk saying apply for seller registration; once they submit we receive the application, then we
// contact them directly by phone"). build-legal-pages.mjs puts this <main> inside the same header and
// footer as the legal pages and writes seller.html; seller.js posts the form to the API's public
// POST /seller-applications (field names and limits: backend/api/src/modules/sellers/seller-applications.ts).
//
// Rules (owner): the phone number is never shown as text, only in the Call us / WhatsApp us links
// (the tokens of build-legal-pages.mjs); no typed-in opening hours; no photos of people.

/** Field limits the form states; the API enforces the same ones. */
export const SELLER_FORM_LIMITS = { shop_name: 80, owner_name: 80, town: 60, what_they_sell: 500, email: 120, message: 1000 };

/** @param tok the build-legal-pages.mjs tokens ({ phoneLink, whatsappLink, ... } as HTML). */
export function sellerMain(tok) {
  const L = SELLER_FORM_LIMITS;
  const field = (name, label, control, { hint = '', optional = false } = {}) => `
          <div class="seller-field">
            <label for="seller-${name}">${label}${optional ? ' <span class="seller-optional">(optional)</span>' : ''}</label>
            ${control}${hint ? `\n            <p class="seller-hint">${hint}</p>` : ''}
            <p class="seller-error" data-error-for="${name}" role="alert" hidden></p>
          </div>`;
  const input = (name, extra = '') => `<input id="seller-${name}" name="${name}" type="text" maxlength="${L[name]}" aria-invalid="false" ${extra}>`;

  return `  <main id="top">
    <div class="wrap">
      <div class="legal-head">
        <p class="kicker">For shops</p>
        <h1>Sell with Blynk</h1>
        <p class="lead">Do you make or sell something people in Dharga Town and Aluthgama would buy? Apply here and we will call you.</p>
      </div>

      <div class="seller">
        <ol class="seller-how" aria-label="How it works">
          <li><strong>We deliver for you.</strong> Customers order in the Blynk app, and our riders collect from you and deliver.</li>
          <li><strong>You set your prices, and we pay you.</strong> You decide what your products cost, and we pay you for what is sold.</li>
        </ol>

        <noscript>
          <p class="seller-noscript">This form needs JavaScript. To apply, please ${tok.phoneLink} or ${tok.whatsappLink} us.</p>
        </noscript>

        <section class="seller-card" aria-labelledby="seller-form-h">
          <h2 id="seller-form-h">Apply to sell</h2>
          <form class="seller-form" data-seller-form onsubmit="return false" novalidate>${field('shop_name', 'Shop name', input('shop_name', 'required autocomplete="organization"'))}${field('owner_name', 'Your name', input('owner_name', 'required autocomplete="name"'))}${field('phone', 'Phone number', `<input id="seller-phone" name="phone" type="tel" inputmode="tel" maxlength="20" required autocomplete="tel" placeholder="077 123 4567" aria-invalid="false">`, { hint: 'A mobile number we can call.' })}${field('town', 'Town', input('town', 'required autocomplete="address-level2"'))}${field('what_they_sell', 'What you sell', `<textarea id="seller-what_they_sell" name="what_they_sell" rows="3" maxlength="${L.what_they_sell}" required aria-invalid="false"></textarea>`, { hint: 'For example: spices, short eats, school books.' })}${field('email', 'Email', `<input id="seller-email" name="email" type="email" maxlength="${L.email}" autocomplete="email" aria-invalid="false">`, { optional: true })}${field('message', 'Anything else you want to tell us', `<textarea id="seller-message" name="message" rows="3" maxlength="${L.message}" aria-invalid="false"></textarea>`, { optional: true })}

          <div class="seller-trap" aria-hidden="true">
            <label for="seller-website">Leave this field empty</label>
            <input id="seller-website" name="website" type="text" tabindex="-1" autocomplete="off">
          </div>

          <p class="seller-status" data-seller-status role="alert" hidden></p>
          <p class="seller-fallback" data-seller-fallback hidden>Please ${tok.phoneLink} or ${tok.whatsappLink} us to apply.</p>

          <p class="seller-consent">We will call you on this number about your application. See our <a href="/privacy">Privacy Policy</a>.</p>
          <button type="submit" class="btn btn--ink btn--pill seller-submit">Send application</button>
          </form>

          <div class="seller-success" data-seller-success tabindex="-1" role="status" hidden>
            <h2>Application received</h2>
            <p>Thanks! We received your application and will call you soon.</p>
            <a class="btn btn--yellow btn--pill" href="/">Back to home</a>
          </div>
        </section>
      </div>
    </div>
  </main>`;
}
