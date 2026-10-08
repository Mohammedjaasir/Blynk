// Blynk install walkthrough (owner, 2026-10-08): instead of a list of
// instructions, one step at a time for the visitor's own phone, each with a
// drawing of the phone screen showing exactly where to tap. The last step
// opens the shop (/app/), where a helper bar keeps pointing at the right
// button (see the customer app's web/index.html).
(function () {
  const phone = (inner) =>
    `<svg class="walk__phone" viewBox="0 0 220 400" aria-hidden="true">
      <rect x="6" y="6" width="208" height="388" rx="30" class="ph-frame"/>
      <rect x="16" y="16" width="188" height="368" rx="22" class="ph-screen"/>${inner}</svg>`;
  const ring = (x, y, r = 16) =>
    `<circle cx="${x}" cy="${y}" r="${r + 10}" class="ph-pulse"/><circle cx="${x}" cy="${y}" r="${r}" class="ph-ring"/>`;
  const lines = (y0, n) =>
    Array.from({ length: n }, (_, i) => `<rect x="34" y="${y0 + i * 26}" width="${150 - (i % 3) * 30}" height="10" rx="5" class="ph-line"/>`).join('');
  const icon = (x, y, s = 44) =>
    `<image href="/assets/icon-192.png" x="${x}" y="${y}" width="${s}" height="${s}" clip-path="inset(0 round 10px)"/>`;
  const home = () => {
    let g = '';
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
      if (r === 2 && c === 1) continue;
      g += `<rect x="${32 + c * 42}" y="${70 + r * 56}" width="30" height="30" rx="8" class="ph-app"/>`;
    }
    return g + icon(74, 182, 30) + ring(89, 197, 22) + `<text x="89" y="236" class="ph-label">Blynk</text>`;
  };

  const STEPS = {
    ios: [
      {
        title: 'Tap the Share button',
        text: 'In Safari, tap the Share button at the bottom of the screen.',
        art: phone(`<rect x="28" y="28" width="164" height="26" rx="13" class="ph-bar"/><text x="110" y="45" class="ph-url">blynk.lk/app</text>${lines(80, 8)}
          <rect x="16" y="330" width="188" height="54" class="ph-toolbar"/>
          <path d="M40 357l-7-7 7-7M70 343l7 7-7 7" class="ph-stroke"/>
          <path d="M110 362v-18M104 350l6-6 6 6M101 352v10h18v-10" class="ph-stroke ph-hot"/>
          <rect x="140" y="347" width="14" height="12" rx="2" class="ph-stroke"/><rect x="172" y="345" width="14" height="14" rx="3" class="ph-stroke"/>
          ${ring(110, 354)}`),
      },
      {
        title: 'Choose “Add to Home Screen”',
        text: 'Scroll the list if you need to, then tap Add to Home Screen.',
        art: phone(`${lines(40, 4)}<rect x="16" y="150" width="188" height="234" rx="18" class="ph-sheet"/>
          <rect x="30" y="172" width="160" height="34" rx="9" class="ph-row"/><text x="44" y="194" class="ph-txt">Copy</text>
          <rect x="30" y="212" width="160" height="34" rx="9" class="ph-row"/><text x="44" y="234" class="ph-txt">Add to Reading List</text>
          <rect x="30" y="252" width="160" height="34" rx="9" class="ph-row ph-row--hot"/><text x="44" y="274" class="ph-txt ph-txt--hot">Add to Home Screen</text>
          <path d="M172 263v12M166 269h12" class="ph-stroke"/>
          <rect x="30" y="292" width="160" height="34" rx="9" class="ph-row"/><text x="44" y="314" class="ph-txt">Find on Page</text>
          ${ring(172, 269, 14)}`),
      },
      {
        title: 'Tap “Add”',
        text: 'Check the name says Blynk, then tap Add in the top corner.',
        art: phone(`<text x="34" y="46" class="ph-txt">Cancel</text><text x="176" y="46" class="ph-txt ph-txt--hot">Add</text>${ring(184, 42, 14)}
          <rect x="30" y="70" width="160" height="70" rx="12" class="ph-row"/>${icon(40, 82)}<text x="96" y="110" class="ph-txt">Blynk</text>
          ${lines(170, 6)}`),
      },
      {
        title: 'Open Blynk from your Home Screen',
        text: 'That’s it. Open Blynk like any other app and log in with your number. Allow notifications to hear about your order.',
        art: phone(home()),
      },
    ],
    android: [
      {
        title: 'Tap the menu',
        text: 'In Chrome, tap the ⋮ menu in the top-right corner.',
        art: phone(`<rect x="28" y="28" width="140" height="26" rx="13" class="ph-bar"/><text x="98" y="45" class="ph-url">blynk.lk/app</text>
          <circle cx="188" cy="34" r="2.6" class="ph-dot"/><circle cx="188" cy="41" r="2.6" class="ph-dot"/><circle cx="188" cy="48" r="2.6" class="ph-dot"/>
          ${ring(188, 41, 14)}${lines(80, 9)}`),
      },
      {
        title: 'Tap “Install app”',
        text: 'Tap Install app. On some phones it says Add to Home screen.',
        art: phone(`<rect x="28" y="28" width="140" height="26" rx="13" class="ph-bar"/>${lines(80, 9)}
          <rect x="80" y="36" width="116" height="190" rx="10" class="ph-sheet"/>
          <text x="94" y="66" class="ph-txt">New tab</text><text x="94" y="98" class="ph-txt">Bookmarks</text>
          <rect x="86" y="112" width="104" height="30" rx="8" class="ph-row ph-row--hot"/><text x="94" y="132" class="ph-txt ph-txt--hot">Install app</text>
          <text x="94" y="166" class="ph-txt">Share…</text><text x="94" y="198" class="ph-txt">Settings</text>
          ${ring(176, 127, 14)}`),
      },
      {
        title: 'Tap “Install”',
        text: 'Chrome asks once more. Tap Install.',
        art: phone(`${lines(40, 10)}<rect x="30" y="140" width="160" height="120" rx="14" class="ph-sheet"/>
          ${icon(46, 156, 34)}<text x="90" y="178" class="ph-txt">Install Blynk?</text>
          <text x="66" y="238" class="ph-txt">Cancel</text><text x="140" y="238" class="ph-txt ph-txt--hot">Install</text>${ring(154, 234, 16)}`),
      },
      {
        title: 'Open Blynk from your Home Screen',
        text: 'That’s it. Open Blynk like any other app and log in with your number. Allow notifications to hear about your order.',
        art: phone(home()),
      },
    ],
  };

  const dialog = document.getElementById('install-sheet');
  if (!dialog) return;
  const stage = dialog.querySelector('[data-walk-stage]');
  const dots = dialog.querySelector('[data-walk-dots]');
  const counter = dialog.querySelector('[data-walk-count]');
  const back = dialog.querySelector('[data-walk-back]');
  const next = dialog.querySelector('[data-walk-next]');
  const open = dialog.querySelector('[data-walk-open]');
  const intro = dialog.querySelector('[data-walk-intro]');
  let steps = [];
  let at = 0;

  function render() {
    const step = steps[at];
    stage.innerHTML = `${step.art}<h2 id="install-title" class="walk__title">${step.title}</h2><p class="walk__text">${step.text}</p>`;
    counter.textContent = `Step ${at + 1} of ${steps.length}`;
    dots.innerHTML = steps.map((_, i) => `<span class="walk__dot${i === at ? ' is-on' : ''}"></span>`).join('');
    back.hidden = at === 0;
    const last = at === steps.length - 1;
    next.hidden = last;
    open.hidden = !last;
  }

  // kind: 'ios' | 'android' | 'desktop'
  window.blynkWalkthrough = function (kind) {
    dialog.dataset.kind = kind;
    if (kind === 'desktop') {
      // A computer: ask which phone, then walk through that phone's steps
      // (owner, 2026-10-08: "Download Blynk" should always guide).
      steps = [];
      stage.innerHTML =
        '<img src="/assets/icon-192.png" alt="" width="72" height="72" class="walk__icon"><h2 id="install-title" class="walk__title">Which phone do you have?</h2><p class="walk__text">Blynk installs on your phone. Pick yours to see the steps, then open <strong>blynk.lk</strong> on it.</p><div class="walk__choose"><button type="button" class="btn btn--yellow btn--pill" data-walk-pick="ios">iPhone</button><button type="button" class="btn btn--yellow btn--pill" data-walk-pick="android">Android</button></div>';
      for (const b of stage.querySelectorAll('[data-walk-pick]')) b.addEventListener('click', () => window.blynkWalkthrough(b.dataset.walkPick));
      counter.textContent = '';
      dots.innerHTML = '';
      back.hidden = next.hidden = open.hidden = true;
      intro.hidden = true;
    } else {
      steps = STEPS[kind];
      at = 0;
      intro.hidden = false;
      intro.textContent =
        kind === 'ios'
          ? 'Open the Blynk shop in Safari, then do these steps there. A helper on that page points at the right button.'
          : 'Open the Blynk shop in Chrome, then do these steps there. A helper on that page offers an Install button.';
      render();
    }
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  };

  back.addEventListener('click', () => {
    if (at > 0) { at--; render(); }
  });
  next.addEventListener('click', () => {
    if (at < steps.length - 1) { at++; render(); }
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
})();
