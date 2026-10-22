// QR links (owner, 2026-10-22: a jersey's QR code must stay the same while staff choose where it
// leads, in Admin or Ops). https://blynk.lk/q/<code> lands here, asks the API where <code> leads
// right now (and counts the scan) and sends the visitor there. If the answer does not come within
// a few seconds, or the code is unknown, the visitor goes to the Blynk shop instead.
//
// The API address below is filled in by the Dockerfile from the API_BASE_URL build argument.
(function () {
  const API = '__BLYNK_API__';
  const SHOP = '/app/';
  const code = (location.pathname.match(/^\/q\/([a-z0-9-]{1,24})\/?$/i) || [])[1];
  const go = (url) => location.replace(url);

  if (!code || !/^https?:\/\//.test(API)) return go(SHOP);

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => {
    if (controller) controller.abort();
    go(SHOP);
  }, 4000);

  fetch(`${API}/go/${encodeURIComponent(code.toLowerCase())}`, { headers: { accept: 'application/json' }, signal: controller ? controller.signal : undefined, cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      clearTimeout(timer);
      const url = j && j.data && j.data.url;
      go(typeof url === 'string' && /^https:\/\//.test(url) ? url : SHOP);
    })
    .catch(() => {
      clearTimeout(timer);
      go(SHOP);
    });
})();
