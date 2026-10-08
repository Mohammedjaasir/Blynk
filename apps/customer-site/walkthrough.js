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
    // Android installs the real app (owner, 2026-10-08): the APK downloads
    // when the guide opens; these are the steps to install it.
    android: [
      {
        title: 'Open the downloaded file',
        text: 'Blynk is downloading. When it finishes, tap blynk.apk in the notification (or in Chrome\u2019s Downloads).',
        art: phone(`<rect x="16" y="16" width="188" height="120" rx="22" class="ph-sheet"/>
          <rect x="28" y="60" width="164" height="54" rx="12" class="ph-row ph-row--hot"/>
          <path d="M50 77v14M44 85l6 6 6-6" class="ph-stroke ph-hot"/><text x="68" y="83" class="ph-txt ph-txt--hot">blynk.apk</text>
          <text x="68" y="100" class="ph-txt">Download complete</text>${ring(50, 85, 14)}${lines(160, 7)}`),
      },
      {
        title: 'Allow installs from Chrome',
        text: 'First time only: Android asks. Tap Settings, switch on \u201cAllow from this source\u201d, then go back.',
        art: phone(`<text x="34" y="52" class="ph-txt ph-txt--hot">Install unknown apps</text>${lines(70, 2)}
          <rect x="28" y="130" width="164" height="44" rx="10" class="ph-row"/><text x="40" y="156" class="ph-txt">Allow from this source</text>
          <rect x="158" y="144" width="26" height="16" rx="8" fill="#0c831f"/><circle cx="176" cy="152" r="6" fill="#fff"/>${ring(171, 152, 16)}
          ${lines(200, 5)}`),
      },
      {
        title: 'Tap \u201cInstall\u201d',
        text: 'Android asks if you want to install Blynk. Tap Install.',
        art: phone(`${lines(40, 10)}<rect x="30" y="140" width="160" height="120" rx="14" class="ph-sheet"/>
          ${icon(46, 156, 34)}<text x="90" y="178" class="ph-txt">Install Blynk?</text>
          <text x="66" y="238" class="ph-txt">Cancel</text><text x="140" y="238" class="ph-txt ph-txt--hot">Install</text>${ring(154, 234, 16)}`),
      },
      {
        title: 'Open Blynk',
        text: 'That\u2019s it. Open Blynk from your Home Screen and log in with your number.',
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
  // Blynk is for phones only (owner, 2026-10-08): a computer only gets the
  // steps to follow on a phone; Download there says Blynk is a phone app.
  let onComputer = false;

  // Android's real app (owner, 2026-10-08); bump the version with each new APK.
  const APK = '/download/blynk.apk?v=6';
  const APK_32 = '/download/blynk-32bit.apk?v=6';

  function render() {
    const step = steps[at];
    const kind = dialog.dataset.kind;
    open.href = kind === 'android' ? APK : '/app/';
    open.textContent = kind === 'android' ? 'Download again' : 'Download';
    stage.innerHTML = `${step.art}<h2 id="install-title" class="walk__title">${step.title}</h2><p class="walk__text">${step.text}</p>`;
    counter.textContent = `Step ${at + 1} of ${steps.length}`;
    dots.innerHTML = steps.map((_, i) => `<span class="walk__dot${i === at ? ' is-on' : ''}"></span>`).join('');
    back.hidden = at === 0;
    const last = at === steps.length - 1;
    next.hidden = last;
    open.hidden = !last || (onComputer && kind === 'android');
    if (kind === 'android' && !onComputer && last) {
      stage.insertAdjacentHTML('beforeend', `<a class="walk__link" href="${APK_32}">Older phone and it won\u2019t install? Get this version</a>`);
    }
  }

  // kind: 'ios' | 'android' | 'desktop'
  window.blynkWalkthrough = function (kind, opts) {
    dialog.dataset.kind = kind;
    onComputer = kind === 'desktop' || Boolean(opts && opts.fromComputer);
    // On an Android phone the real app downloads straight away.
    if (kind === 'android' && !onComputer) window.location.href = APK;
    if (kind === 'desktop') {
      // A computer: ask which phone, then walk through that phone's steps
      // (owner, 2026-10-08: "Download Blynk" should always guide).
      steps = [];
      stage.innerHTML =
        '<img src="/assets/icon-192.png" alt="" width="72" height="72" class="walk__icon"><h2 id="install-title" class="walk__title">Which phone do you have?</h2><p class="walk__text">Blynk is an app for your phone. Pick yours to see the steps.</p><div class="walk__choose"><button type="button" class="btn btn--yellow btn--pill" data-walk-pick="ios">iPhone</button><button type="button" class="btn btn--yellow btn--pill" data-walk-pick="android">Android</button></div>';
      for (const b of stage.querySelectorAll('[data-walk-pick]')) b.addEventListener('click', () => window.blynkWalkthrough(b.dataset.walkPick, { fromComputer: true }));
      counter.textContent = '';
      dots.innerHTML = '';
      back.hidden = next.hidden = open.hidden = true;
      intro.hidden = true;
    } else {
      steps = STEPS[kind];
      at = 0;
      intro.hidden = false;
      intro.textContent =
        onComputer
          ? 'Blynk is a phone app: open blynk.lk on your phone, tap Download Blynk and follow these steps there.'
          : kind === 'ios'
            ? 'Tap Download at the end, then do these steps in Safari. A helper on that page points at the right button.'
            : 'Your download has started. Then:';
      render();
    }
    if (dialog.open) return;
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
