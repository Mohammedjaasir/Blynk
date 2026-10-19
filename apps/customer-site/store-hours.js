// Store hours on blynk.lk, from the API that Admin and Ops control (owner, 2026-10-20: "make
// sure the timings can able controlled by the admins opening and closing timings").
//
// Every page keeps its hours written out, so it still reads right if this script or the API
// is unavailable; this replaces them with the live ones:
//   data-hours="dash"        8 AM – 9 PM
//   data-hours="to"          8 AM to 9 PM
//   data-hours="compact"     8 AM–9 PM
//   data-hours="short"       8–9
//   data-hours="days"        Every day / Mon–Sat / Today
//   data-hours="days-lower"  every day / Mon–Sat / today
//   data-store-status        Open now · until 9 PM / Closed now · opens tomorrow at 8 AM
// and the opening hours in the page's structured data. si and ta pages get their own words.
//
// The API address below is filled in by the Dockerfile from the API_BASE_URL build argument.
(function () {
  const API = '__BLYNK_API__';
  if (!/^https?:\/\//.test(API)) return;

  const TZ = 'Asia/Colombo';
  const KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const lang = (document.documentElement.lang || 'en').slice(0, 2);
  const mins = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + (m || 0); };
  const h12 = (t) => { const h = Math.floor(t / 60) % 24; return h % 12 || 12; };
  const mm = (t, sep) => (t % 60 ? sep + String(t % 60).padStart(2, '0') : '');

  const WORDS = {
    en: {
      time: (t) => `${h12(t)}${mm(t, ':')} ${Math.floor(t / 60) % 24 < 12 ? 'AM' : 'PM'}`,
      short: (t) => `${h12(t)}${mm(t, ':')}`,
      dash: (a, b) => `${a} – ${b}`, to: (a, b) => `${a} to ${b}`,
      every: 'Every day', everyLow: 'every day', today: 'Today', todayLow: 'today',
      days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    },
    si: {
      time: (t) => `${Math.floor(t / 60) % 24 < 12 ? 'පෙ.ව.' : 'ප.ව.'} ${h12(t)}${mm(t, '.')}`,
      short: (t) => `${h12(t)}${mm(t, '.')}`,
      dash: (a, b) => `${a} – ${b}`, to: (a, b) => `${a} සිට ${b} දක්වා`,
      every: 'සෑම දිනකම', everyLow: 'සෑම දිනකම', today: 'අද', todayLow: 'අද',
      days: ['ඉරිදා', 'සඳුදා', 'අඟහරුවාදා', 'බදාදා', 'බ්‍රහස්පතින්දා', 'සිකුරාදා', 'සෙනසුරාදා'],
    },
    ta: {
      time: (t) => {
        const h = Math.floor(t / 60) % 24;
        return `${h < 12 ? 'காலை' : h < 16 ? 'மதியம்' : h < 19 ? 'மாலை' : 'இரவு'} ${h12(t)}${mm(t, '.')}`;
      },
      short: (t) => `${h12(t)}${mm(t, '.')}`,
      dash: (a, b) => `${a} – ${b}`, to: (a, b) => `${a} முதல் ${b} வரை`,
      every: 'தினமும்', everyLow: 'தினமும்', today: 'இன்று', todayLow: 'இன்று',
      days: ['ஞாயிறு', 'திங்கள்', 'செவ்வாய்', 'புதன்', 'வியாழன்', 'வெள்ளி', 'சனி'],
    },
  };
  const W = WORDS[lang] || WORDS.en;

  // Today's weekday in Sri Lanka (0 = Sunday), whatever the visitor's clock says.
  const colomboDay = (d) => KEYS.indexOf(new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(d).toLowerCase().slice(0, 3));
  const colomboDate = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const colomboMins = (d) => {
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
    return mins(p);
  };

  // Mon–Sat when the open days run on, otherwise a list.
  function dayList(open) {
    const order = [1, 2, 3, 4, 5, 6, 0].filter((i) => open.includes(i));
    const run = order.every((d, i) => i === 0 || [1, 2, 3, 4, 5, 6, 0].indexOf(d) === [1, 2, 3, 4, 5, 6, 0].indexOf(order[i - 1]) + 1);
    return run && order.length > 2 ? `${W.days[order[0]]}–${W.days[order[order.length - 1]]}` : order.map((d) => W.days[d]).join(', ');
  }

  function fill(store) {
    const days = store.hours && store.hours.days;
    if (!days) return;
    const open = KEYS.map((k, i) => ({ i, ...days[k] })).filter((d) => d && !d.closed && d.open && d.close);
    if (!open.length) return;
    const uniform = open.every((d) => d.open === open[0].open && d.close === open[0].close);
    // One set of hours for every open day: show it with the days. Different hours on different
    // days: show today's (or the next open day's) and say which.
    let from = mins(open[0].open), to = mins(open[0].close), daysText, daysLow;
    if (uniform) {
      daysText = open.length === 7 ? W.every : dayList(open.map((d) => d.i));
      daysLow = open.length === 7 ? W.everyLow : daysText;
    } else {
      const today = colomboDay(new Date());
      const pick = open.find((d) => d.i === today) || open[0];
      from = mins(pick.open); to = mins(pick.close);
      daysText = pick.i === today ? W.today : W.days[pick.i];
      daysLow = pick.i === today ? W.todayLow : daysText;
    }
    const set = (sel, text) => document.querySelectorAll(sel).forEach((el) => { el.textContent = text; });
    set('[data-hours="dash"]', W.dash(W.time(from), W.time(to)));
    set('[data-hours="to"]', W.to(W.time(from), W.time(to)));
    set('[data-hours="compact"]', lang === 'en' ? `${W.time(from)}–${W.time(to)}` : W.dash(W.time(from), W.time(to)));
    set('[data-hours="short"]', `${W.short(from)}–${W.short(to)}`);
    set('[data-hours="days"]', daysText);
    set('[data-hours="days-lower"]', daysLow);

    // Structured data (search engines): the real opening hours.
    const NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    for (const tag of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(tag.textContent);
        const nodes = Array.isArray(data['@graph']) ? data['@graph'] : [data];
        let changed = false;
        for (const node of nodes) {
          if (!node || !('openingHoursSpecification' in node || 'openingHours' in node)) continue;
          node.openingHoursSpecification = open.map((d) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: NAMES[d.i], opens: d.open, closes: d.close }));
          delete node.openingHours;
          changed = true;
        }
        if (changed) tag.textContent = JSON.stringify(data);
      } catch (e) { /* leave it as written */ }
    }

    status(store, W);
  }

  // "Open now · until 9 PM" / "Closed now · opens tomorrow at 8 AM" (English home page).
  function status(store, W) {
    const el = document.querySelector('[data-store-status]');
    if (!el || lang !== 'en') return;
    let text;
    if (store.is_open_now && store.today_hours) {
      text = `Open now · until ${W.time(mins(store.today_hours.close))}`;
    } else if (store.next_open_at) {
      const at = new Date(store.next_open_at);
      const now = new Date();
      const tomorrow = new Date(now.getTime() + 864e5);
      const when = colomboDate(at) === colomboDate(now) ? 'today'
        : colomboDate(at) === colomboDate(tomorrow) ? 'tomorrow'
        : new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }).format(at);
      text = `Closed now · opens ${when} at ${W.time(colomboMins(at))}`;
    } else {
      text = 'Closed now';
    }
    el.lastElementChild.textContent = text;
    el.classList.toggle('is-open', !!store.is_open_now);
    el.hidden = false;
  }

  fetch(`${API}/store`, { headers: { accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => { if (j && j.data) fill(j.data); })
    .catch(() => { /* keep the written hours */ });
})();
