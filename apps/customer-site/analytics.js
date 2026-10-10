// Blynk landing - Google Tag Manager events (owner, 2026-10-10).
//
// Only describes what happened, as window.dataLayer events; GA4, Google Ads
// and the Meta Pixel are set up inside GTM (docs/06-deployment/
// google-tag-manager-and-ads-setup.md lists every event). When the site is
// built without a GTM container there is no dataLayer and nothing is pushed.
// Nothing personal is ever sent (the visitor has told us nothing personal on
// this page anyway).
(function () {
  function track(event, params) {
    if (!Array.isArray(window.dataLayer)) return;
    var payload = { event: event };
    for (var key in params) if (Object.prototype.hasOwnProperty.call(params, key)) payload[key] = params[key];
    window.dataLayer.push(payload);
  }
  // walkthrough.js reports its steps through this.
  window.blynkTrack = track;

  var ua = navigator.userAgent || '';
  var isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var platform = isIOS ? 'ios' : /Android/i.test(ua) ? 'android' : 'desktop';

  // Page views come from this event on both sites (the GTM Google tag has
  // send_page_view off), so the landing page and the shop count the same way.
  track('page_view', {
    page_path: location.pathname,
    page_location: location.href,
    page_title: document.title,
  });

  // Which Get Blynk button: the header, the hero, the products section...
  function where(el) {
    if (el.closest('.nav')) return 'header';
    if (el.closest('.hero')) return 'hero';
    if (el.closest('.bento')) return 'products_grid';
    if (el.closest('footer')) return 'footer';
    var section = el.closest('section[id]');
    return section ? section.id : 'page';
  }

  // Capture phase: runs before app.js opens the walkthrough.
  document.addEventListener('click', function (event) {
    var target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    var install = target.closest('[data-install]');
    if (install) {
      track('get_blynk_click', { button_location: where(install), platform: platform });
      return;
    }
    var open = target.closest('[data-walk-open]');
    if (open) {
      track('open_app_click', { button_location: 'install_guide', platform: platform });
      return;
    }
    var link = target.closest('a[href]');
    if (!link) return;
    var href = link.getAttribute('href') || '';
    // The method only, never the number.
    if (href.indexOf('tel:') === 0) track('contact_click', { method: 'call', link_location: where(link) });
    else if (/^https:\/\/(wa\.me|api\.whatsapp\.com)\//.test(href)) track('contact_click', { method: 'whatsapp', link_location: where(link) });
  }, true);
})();
