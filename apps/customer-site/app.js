// Blynk landing - install behaviour (2026-09-29).
//
// "Install Blynk" installs the Blynk shop (the web app at /app/) on Android
// and iPhone alike - the launch is web-app first, Play Store later:
// - Android Chrome/Edge fire `beforeinstallprompt`; we keep it and show the
//   browser's own install prompt on click.
// - iPhone/iPad have no install prompt: we show the Safari steps (Share ->
//   Add to Home Screen) with a button that opens the shop in Safari.
// - Anywhere else, the sheet explains and offers to open the shop here.
(function () {
  const ua = navigator.userAgent || '';
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
  });

  const sheet = document.getElementById('install-sheet');
  function showGuide(kind) {
    for (const el of sheet.querySelectorAll('[data-guide]')) el.hidden = el.dataset.guide !== kind;
    if (typeof sheet.showModal === 'function') sheet.showModal();
    else sheet.setAttribute('open', '');
  }

  async function install() {
    if (standalone) {
      window.location.href = '/app/';
      return;
    }
    if (deferredPrompt) {
      deferredPrompt.prompt();
      try {
        await deferredPrompt.userChoice;
      } finally {
        deferredPrompt = null;
      }
      return;
    }
    showGuide(isIOS ? 'ios' : isAndroid ? 'android' : 'desktop');
  }
  for (const button of document.querySelectorAll('[data-install]')) button.addEventListener('click', install);

  // The download button always reads "For iOS & Android" (owner, 2026-10-07);
  // the sheet it opens still shows the steps for the reader's own phone.

  // Close the sheet by tapping the backdrop.
  sheet.addEventListener('click', (event) => {
    if (event.target === sheet) sheet.close();
  });

  // On desktop, scale the header and hero down together so the whole first
  // screen fits the window height (laptops, browser zoom).
  const fold = [document.querySelector('.nav'), document.querySelector('.hero')];
  function fitFold() {
    for (const el of fold) el.style.zoom = '';
    if (window.innerWidth <= 960) return;
    const natural = fold[1].getBoundingClientRect().bottom + window.scrollY + 20;
    const fit = Math.max(0.6, Math.min(1, window.innerHeight / natural));
    if (fit >= 1) return;
    for (const el of fold) el.style.zoom = String(fit);
    // Zoomed columns reflow a little; correct once for what is left over.
    const over = fold[1].getBoundingClientRect().bottom + window.scrollY + 20;
    if (over > window.innerHeight) {
      const again = Math.max(0.6, fit * (window.innerHeight / over));
      for (const el of fold) el.style.zoom = String(again);
    }
  }
  fitFold();
  window.addEventListener('resize', fitFold);
  window.addEventListener('load', fitFold);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitFold);

  // Reveal sections as they scroll in (CSS hides them only under .js).
  const reveal = document.querySelectorAll('[data-reveal]');
  if ('IntersectionObserver' in window) {
    document.documentElement.classList.add('js');
    const ro = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-in');
          ro.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.1 }
    );
    reveal.forEach((el) => ro.observe(el));
  }

  // Scroll motion: the progress line, and the hero pictures drifting at
  // different speeds (translate only, one rAF per frame, off for reduced motion).
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!still) {
    const art = document.querySelector('.hero__art');
    const veggies = document.querySelector('.deco--veggies');
    const skyline = document.querySelector('.deco--skyline');
    const root = document.documentElement;
    let queued = false;
    const frame = () => {
      queued = false;
      const y = window.scrollY;
      const max = root.scrollHeight - window.innerHeight;
      root.style.setProperty('--progress', max > 0 ? String(Math.min(1, y / max)) : '0');
      if (y < window.innerHeight * 1.5) {
        if (art) art.style.translate = `0 ${(y * -0.12).toFixed(1)}px`;
        if (veggies) veggies.style.translate = `0 ${(y * 0.18).toFixed(1)}px`;
        if (skyline) skyline.style.translate = `0 ${(y * 0.08).toFixed(1)}px`;
      }
    };
    window.addEventListener('scroll', () => {
      if (!queued) { queued = true; requestAnimationFrame(frame); }
    }, { passive: true });
    frame();
  }

  // Delivery figures count up the first time they are seen; the last frame
  // writes the exact figure.
  const formatCount = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
  const counters = document.querySelectorAll('[data-count]');
  if (!still && 'IntersectionObserver' in window) {
    const co = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        co.unobserve(entry.target);
        const el = entry.target;
        const start = performance.now();
        el.dataset.counting = '1';
        const tick = (t) => {
          const to = Number(el.dataset.count);
          const k = Math.min(1, (t - start) / 900);
          if (k < 1) {
            el.textContent = String(Math.round(to * (1 - Math.pow(1 - k, 3))));
            requestAnimationFrame(tick);
          } else {
            el.textContent = formatCount(to);
            delete el.dataset.counting;
          }
        };
        el.textContent = '0';
        requestAnimationFrame(tick);
      }
    }, { threshold: 0.6 });
    counters.forEach((el) => co.observe(el));
  }

  // Footer year.
  const year = document.querySelector('[data-year]');
  if (year) year.textContent = String(new Date().getFullYear());

  // Highlight the nav link for where the reader is: Home until the first
  // section's top reaches the upper third of the window, then that section.
  const links = [...document.querySelectorAll('.nav__links a')];
  const sections = links
    .map((a) => ({ a, el: document.getElementById(a.getAttribute('href').slice(1)) }))
    .filter((x) => x.el && x.el.tagName !== 'MAIN');
  const home = links.find((a) => a.getAttribute('href') === '#top');
  let navQueued = false;
  function markNav() {
    navQueued = false;
    const line = window.innerHeight * 0.35;
    let current = home;
    for (const { a, el } of sections) if (el.getBoundingClientRect().top <= line) current = a;
    // At the very bottom the last section wins even if it is short.
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2 && sections.length) {
      current = sections[sections.length - 1].a;
    }
    links.forEach((a) => {
      const on = a === current;
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'location');
      else a.removeAttribute('aria-current');
    });
  }
  window.addEventListener('scroll', () => {
    if (!navQueued) { navQueued = true; requestAnimationFrame(markNav); }
  }, { passive: true });
  window.addEventListener('resize', markNav);
  markNav();
})();
