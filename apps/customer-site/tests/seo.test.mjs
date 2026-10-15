// Website SEO (owner's "Tracking & SEO brief", 2026-10-15).
// Run from the repo root:  node --test apps/customer-site/tests/
//
// Checks every public page as nginx will serve it: the hand-written pages at
// the site root (index.html, privacy.html ...) and everything in pages/,
// which the Dockerfile copies to the root.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const site = join(dirname(fileURLToPath(import.meta.url)), '..');
const pagesDir = join(site, 'pages');
const SITE = 'https://blynk.lk';
const LEGAL = ['/privacy', '/terms', '/refunds'];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** Every public page: { path (URL path), file, html }. */
const PAGES = [
  { path: '/', file: join(site, 'index.html') },
  ...LEGAL.map((p) => ({ path: p, file: join(site, `${p.slice(1)}.html`) })),
  ...walk(pagesDir).filter((f) => f.endsWith(`${sep}index.html`)).map((file) => {
    const dir = relative(pagesDir, dirname(file)).split(sep).join('/');
    // /si/ and /ta/ keep their slash (they are folders of pages); the rest are slashless.
    return { path: /^(si|ta)$/.test(dir) ? `/${dir}/` : `/${dir}`, file };
  }),
].map((p) => ({ ...p, html: readFileSync(p.file, 'utf8') }));
const byPath = new Map(PAGES.map((p) => [p.path, p]));

const attr = (tag, name) => (tag.match(new RegExp(`\\b${name}="([^"]*)"`)) || [])[1];
const metaContent = (html, key, value) => {
  const tag = (html.match(new RegExp(`<meta [^>]*${key}="${value}"[^>]*>`)) || [])[0];
  return tag && attr(tag, 'content');
};
const canonical = (html) => attr((html.match(/<link rel="canonical"[^>]*>/) || [''])[0], 'href');
const alternates = (html) => Object.fromEntries([...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)">/g)].map((m) => [m[1], m[2]]));
const ldBlocks = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const ldNodes = (html) => ldBlocks(html).flatMap((b) => b['@graph'] || [b]);
const urlToPath = (u) => u.replace(SITE, '');

test('the expected pages exist: home, legal, 5 areas, 4 categories, Sinhala and Tamil', () => {
  const areas = ['dharga-town', 'aluthgama', 'bentota', 'kaluwamodara', 'moragalla'];
  const want = ['/', '/si/', '/ta/', ...LEGAL, ...areas.flatMap((a) => [`/${a}`, `/si/${a}`, `/ta/${a}`]),
    '/baby-diapers-delivery-aluthgama', '/sanitary-pads-home-delivery', '/rice-and-dhal-delivery-dharga-town', '/milk-powder-delivery-aluthgama'];
  for (const p of want) assert.ok(byPath.has(p), `missing page ${p}`);
  assert.equal(PAGES.length, want.length, `unexpected pages: ${PAGES.map((p) => p.path).filter((p) => !want.includes(p))}`);
});

test('the generated pages are up to date with scripts/build-seo-pages.mjs', () => {
  const r = spawnSync(process.execPath, [join(site, 'scripts', 'build-seo-pages.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
});

test('every page has one unique title, a unique description and an absolute canonical for its own URL', () => {
  const titles = new Map();
  const descriptions = new Map();
  for (const { path, html } of PAGES) {
    const t = html.match(/<title>([^<]+)<\/title>/g) || [];
    assert.equal(t.length, 1, `${path}: ${t.length} titles`);
    const title = t[0].replace(/<\/?title>/g, '');
    assert.ok(title.length >= 15 && title.length <= 90, `${path}: title length ${title.length}`);
    assert.ok(!titles.has(title), `${path} repeats the title of ${titles.get(title)}`);
    titles.set(title, path);

    const d = metaContent(html, 'name', 'description');
    assert.ok(d && d.length >= 70 && d.length <= 260, `${path}: description "${d}"`);
    assert.ok(!descriptions.has(d), `${path} repeats the description of ${descriptions.get(d)}`);
    descriptions.set(d, path);

    assert.equal(canonical(html), `${SITE}${path}`, `${path}: canonical`);
    assert.match(html, /^<!doctype html>/i, path);
    assert.match(html, /<meta charset="utf-8">/, path);
  }
});

test('every page has Open Graph and Twitter tags with the 1200x630 image', () => {
  for (const { path, html } of PAGES) {
    assert.equal(metaContent(html, 'property', 'og:url'), `${SITE}${path}`, `${path}: og:url`);
    assert.ok(metaContent(html, 'property', 'og:title'), `${path}: og:title`);
    assert.ok(metaContent(html, 'property', 'og:description'), `${path}: og:description`);
    assert.equal(metaContent(html, 'property', 'og:image'), `${SITE}/assets/og-image.jpg`, `${path}: og:image`);
    assert.equal(metaContent(html, 'property', 'og:image:width'), '1200', path);
    assert.equal(metaContent(html, 'property', 'og:image:height'), '630', path);
    assert.equal(metaContent(html, 'name', 'twitter:card'), 'summary_large_image', path);
  }
});

test('the og:image file is a 1200x630 JPEG', () => {
  const buf = readFileSync(join(site, 'assets', 'og-image.jpg'));
  assert.equal(buf.readUInt16BE(0), 0xffd8, 'not a JPEG');
  let i = 2;
  let size = null;
  while (i < buf.length) {
    const marker = buf.readUInt16BE(i);
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xffc0 && marker <= 0xffc2) { size = [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)]; break; }
    i += 2 + len;
  }
  assert.deepEqual(size, [1200, 630]);
  assert.ok(buf.length < 200 * 1024, `og-image.jpg is ${buf.length} bytes`);
});

test('GTM markers and analytics.js (page_view) on every page except the tracking-free legal pages', () => {
  for (const { path, html } of PAGES) {
    if (LEGAL.includes(path)) {
      // The legal pages were made without tracking on purpose (2026-10-14).
      assert.ok(!html.includes('googletagmanager') && !html.includes('GTM-HEAD-START'), `${path} gained tracking`);
      continue;
    }
    for (const marker of ['GTM-HEAD-START', 'GTM-HEAD-END', 'GTM-BODY-START', 'GTM-BODY-END', '__GTM_ID__', '__CONSENT_DEFAULT__']) {
      assert.ok(html.includes(marker), `${path} lacks ${marker}`);
    }
    // The head snippet is the home page's, byte for byte.
    const snippet = (h) => h.match(/<!-- GTM-HEAD-START -->[\s\S]*?<!-- GTM-HEAD-END -->/)[0].replace(/\r\n/g, '\n');
    assert.equal(snippet(html), snippet(byPath.get('/').html), `${path}: GTM snippet differs from the home page`);
    assert.match(html, /<script src="\/analytics\.js\?v=[^"]+" defer><\/script>/, `${path}: analytics.js`);
  }
});

test('hreflang: en, si, ta and x-default on every language version, all pointing at each other', () => {
  const withAlt = PAGES.filter((p) => Object.keys(alternates(p.html)).length);
  assert.equal(withAlt.length, 18, 'home + 5 areas, in 3 languages');
  for (const { path, html } of withAlt) {
    const alt = alternates(html);
    assert.deepEqual(Object.keys(alt).sort(), ['en', 'si', 'ta', 'x-default'], path);
    assert.equal(alt['x-default'], alt.en, `${path}: x-default is the English page`);
    assert.ok(Object.values(alt).includes(`${SITE}${path}`), `${path} does not list itself`);
    const lang = html.match(/<html lang="([a-z]+)">/)[1];
    assert.equal(alt[lang], `${SITE}${path}`, `${path}: its own hreflang is ${lang}`);
    for (const target of Object.values(alt)) {
      const other = byPath.get(urlToPath(target));
      assert.ok(other, `${path} points at missing ${target}`);
      assert.deepEqual(alternates(other.html), alt, `${path} and ${target} disagree`);
    }
  }
});

test('Sinhala and Tamil pages: lang attribute, machine-translation review note, Noto font', () => {
  for (const { path, html } of PAGES) {
    const lang = html.match(/<html lang="([a-z]+)">/)[1];
    if (path.startsWith('/si/')) assert.equal(lang, 'si', path);
    else if (path.startsWith('/ta/')) assert.equal(lang, 'ta', path);
    else { assert.equal(lang, 'en', path); continue; }
    const top = html.slice(0, html.indexOf('<html'));
    assert.match(top, /MACHINE-WRITTEN (SINHALA|TAMIL) TRANSLATION/, `${path}: review note`);
    assert.match(top, /native (Sinhala|Tamil) speaker must review/, path);
    assert.match(html, lang === 'si' ? /Noto\+Sans\+Sinhala/ : /Noto\+Sans\+Tamil/, path);
    assert.match(html, lang === 'si' ? /[඀-෿]{4}/ : /[஀-௿]{4}/, `${path} has no ${lang} text`);
    // Brand names stay in English.
    assert.ok(html.includes('Blynk Points') && html.includes('blynk</span>'), path);
  }
});

test('sitemap.xml lists every page once, with lastmod and the hreflang alternates', () => {
  const xml = readFileSync(join(pagesDir, 'sitemap.xml'), 'utf8');
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9" xmlns:xhtml="http:\/\/www\.w3\.org\/1999\/xhtml">/);
  assert.match(xml, /<\/urlset>\n$/);
  const urls = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => m[1]);
  const locs = urls.map((u) => u.match(/<loc>([^<]+)<\/loc>/)[1]);
  assert.equal(new Set(locs).size, locs.length, 'a page is listed twice');
  assert.deepEqual([...locs].sort(), PAGES.map((p) => `${SITE}${p.path}`).sort());
  for (const u of urls) {
    const loc = u.match(/<loc>([^<]+)<\/loc>/)[1];
    assert.match(u, /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/, loc);
    const alt = Object.fromEntries([...u.matchAll(/<xhtml:link rel="alternate" hreflang="([^"]+)" href="([^"]+)"\/>/g)].map((m) => [m[1], m[2]]));
    assert.deepEqual(alt, alternates(byPath.get(urlToPath(loc)).html), `${loc}: sitemap alternates differ from the page`);
  }
  // Every opened tag is closed (a cheap well-formedness check).
  for (const tag of ['url', 'loc', 'lastmod']) {
    assert.equal((xml.match(new RegExp(`<${tag}>`, 'g')) || []).length, (xml.match(new RegExp(`</${tag}>`, 'g')) || []).length, tag);
  }
});

test('robots.txt allows everything and points at the sitemap', () => {
  const robots = readFileSync(join(pagesDir, 'robots.txt'), 'utf8');
  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Allow: \/$/m);
  assert.match(robots, /^Sitemap: https:\/\/blynk\.lk\/sitemap\.xml$/m);
  assert.doesNotMatch(robots, /^Disallow:\s*\/\S*/m);
});

test('JSON-LD parses everywhere; the home page is a GroceryStore with the brief\'s details', () => {
  for (const { path, html } of PAGES) for (const b of ldBlocks(html)) assert.equal(b['@context'], 'https://schema.org', path);
  const home = byPath.get('/').html;
  const store = ldNodes(home).find((n) => n['@type'] === 'GroceryStore');
  assert.ok(store, 'no GroceryStore on the home page');
  assert.equal(store.name, 'Blynk');
  assert.equal(store.url, `${SITE}/`);
  assert.match(store.logo, /^https:\/\/blynk\.lk\/assets\/.+\.png$/);
  assert.ok(existsSync(join(site, urlToPath(store.logo))), 'logo file');
  // The support number the footer shows.
  const tel = home.match(/href="tel:(\+\d+)"/)[1];
  assert.equal(store.telephone, tel);
  assert.equal(store.address['@type'], 'PostalAddress');
  assert.equal(store.address.addressLocality, 'Dharga Town');
  assert.match(store.address.streetAddress, /Clock Tower/);
  assert.match(store.address.addressRegion, /Western Province/);
  assert.match(store.address.addressRegion, /Kalutara/);
  assert.equal(store.address.addressCountry, 'LK');
  assert.deepEqual([store.geo['@type'], store.geo.latitude, store.geo.longitude], ['GeoCoordinates', 6.441268, 80.011437]);
  const hours = store.openingHoursSpecification[0];
  assert.equal(hours.dayOfWeek.length, 7);
  assert.deepEqual([hours.opens, hours.closes], ['08:00', '21:00']);
  assert.equal(store.openingHours, 'Mo-Su 08:00-21:00');
  assert.deepEqual(store.areaServed.map((a) => a.name), ['Dharga Town', 'Aluthgama', 'Bentota', 'Kaluwamodara', 'Moragalla']);
  assert.ok(store.priceRange);
  assert.match(store.paymentAccepted, /Cash/);
  // The hours on the page say the same.
  assert.match(home, /8 AM to 9 PM/);
});

test('area and category pages carry a BreadcrumbList ending at the page itself', () => {
  for (const { path, html } of PAGES) {
    if (path === '/' || LEGAL.includes(path) || /^\/(si|ta)\/$/.test(path)) continue;
    const crumbs = ldNodes(html).find((n) => n['@type'] === 'BreadcrumbList');
    assert.ok(crumbs, `${path}: no BreadcrumbList`);
    const items = crumbs.itemListElement;
    assert.ok(items.length >= 2, path);
    items.forEach((it, i) => {
      assert.equal(it['@type'], 'ListItem', path);
      assert.equal(it.position, i + 1, path);
      assert.ok(it.name, path);
      assert.ok(byPath.has(urlToPath(it.item)), `${path}: crumb ${it.item} is not a page`);
    });
    assert.equal(items.at(-1).item, `${SITE}${path}`, `${path}: last crumb`);
  }
});

test('no free-delivery promise, no per-km fee tiers, no unbackable claims, no skyline.webp', () => {
  const files = [...PAGES.map((p) => p.file), join(site, 'styles.css'), join(pagesDir, 'pages.css'), join(site, 'app.js'),
    join(site, 'analytics.js'), join(site, 'walkthrough.js'), join(site, 'scripts', 'build-seo-pages.mjs')];
  for (const f of files) {
    const text = readFileSync(f, 'latin1');
    assert.ok(!/skyline/i.test(text), `${f} mentions skyline`);
  }
  for (const { path, html } of PAGES) {
    const text = html.replace(/<!--[\s\S]*?-->/g, '');
    assert.doesNotMatch(text, /free\s+(home\s+)?deliver/i, `${path} promises free delivery`);
    if (LEGAL.includes(path)) continue;
    assert.doesNotMatch(text, /per[\s-]*km|\/\s*km|LKR\s*[\d,]+\s*(for|per)\s*(the\s+)?(first\s+)?\d*\s*km/i, `${path} shows per-km fees`);
    assert.doesNotMatch(text, /fastest|cheapest|lowest price|in \d+\s*min|\d+\s*minutes/i, `${path} makes a claim Blynk cannot back`);
  }
});

test('area and category pages: Order now goes to /app/ with UTM tags, content is not behind a phone gate', () => {
  for (const { path, html } of PAGES) {
    if (path === '/' || LEGAL.includes(path)) continue;
    const orders = [...html.matchAll(/<a [^>]*data-order="[^"]*"[^>]*>/g)].map((m) => attr(m[0], 'href').replace(/&amp;/g, '&'));
    assert.ok(orders.length >= 2, `${path}: Order now buttons`);
    for (const href of orders) {
      const u = new URL(href, SITE);
      assert.equal(u.pathname, '/app/', `${path}: ${href}`);
      assert.equal(u.searchParams.get('utm_source'), 'blynk.lk', path);
      assert.ok(['area_page', 'category_page', 'landing'].includes(u.searchParams.get('utm_medium')), path);
      assert.ok(u.searchParams.get('utm_campaign'), path);
    }
    if (!/^\/(si|ta)\/$/.test(path)) {
      const slug = path.split('/').pop().replace(/-/g, '_');
      assert.ok(orders.every((h) => new URL(h, SITE).searchParams.get('utm_campaign') === slug), `${path}: campaign`);
    }
    assert.match(html, /<h1[^>]*>[^<]{10,}/, `${path}: h1`);
    assert.doesNotMatch(html, /phone-?only|data-phone-gate/i, `${path}: phone gate`);
  }
});

test('every internal link goes to a page, file or the shop', () => {
  for (const { path, html } of PAGES) {
    for (const m of html.matchAll(/<a [^>]*href="([^"]+)"/g)) {
      const href = m[1].replace(/&amp;/g, '&');
      if (!href.startsWith('/') || href.startsWith('//')) continue;
      const p = href.split(/[?#]/)[0];
      if (p === '/app/') continue;
      assert.ok(byPath.has(p) || existsSync(join(site, p)), `${path} links to missing ${href}`);
    }
  }
});

test('images: width and height everywhere, lazy below the fold, files exist and are small', () => {
  for (const { path, html } of PAGES) {
    for (const m of html.matchAll(/<img [^>]*>/g)) {
      const tag = m[0];
      assert.ok(attr(tag, 'width') && attr(tag, 'height'), `${path}: ${tag}`);
      const src = attr(tag, 'src');
      assert.ok(existsSync(join(site, src.split('?')[0])), `${path}: ${src}`);
      const inFold = /class="deco|fetchpriority|nav__brand/.test(tag) || html.slice(Math.max(0, m.index - 200), m.index).includes('nav__brand');
      if (!inFold) assert.match(tag, /loading="lazy"/, `${path}: below-the-fold image without lazy loading: ${tag}`);
    }
  }
  const size = (f) => statSync(join(site, 'assets', f)).size;
  assert.ok(size('logo-mark.png') < 20 * 1024, 'logo-mark.png is shown at 50 px; keep it small');
  assert.ok(size('phones.webp') < 80 * 1024, 'phones.webp');
  assert.ok(size('favicon-32.png') < 4 * 1024, 'favicon-32.png');
});

test('scripts are deferred on every page', () => {
  for (const { path, html } of PAGES) {
    for (const m of html.matchAll(/<script src="[^"]+"[^>]*>/g)) assert.match(m[0], /\sdefer|\sasync/, `${path}: ${m[0]}`);
  }
});

test('Dockerfile copies pages/ to the site root and fills GTM into the SEO pages', () => {
  const docker = readFileSync(join(site, 'Dockerfile'), 'utf8');
  assert.match(docker, /^COPY apps\/customer-site\/pages\/ \/usr\/share\/nginx\/html\/$/m);
  assert.match(docker, /\$\(find \/usr\/share\/nginx\/html -mindepth 2 -name index\.html ! -path '\/usr\/share\/nginx\/html\/app\/\*'/);
  // pages.css, sitemap.xml and robots.txt travel with pages/.
  for (const f of ['pages.css', 'sitemap.xml', 'robots.txt']) assert.ok(existsSync(join(pagesDir, f)), f);
  // Nothing in pages/ would overwrite a hand-written file or the shop.
  for (const f of walk(pagesDir).map((x) => relative(pagesDir, x).split(sep).join('/'))) {
    assert.ok(!existsSync(join(site, f)) || f.includes('/'), `pages/${f} would replace ${f}`);
    assert.ok(!f.startsWith('app/') && !f.startsWith('assets/'), f);
  }
});

test('nginx serves the SEO pages at clean URLs and leaves /app to the shop', () => {
  const conf = readFileSync(join(site, 'nginx.conf'), 'utf8');
  const m = conf.match(/location ~ "(\^\/\(\?!app[^"]+)" \{[\s\S]*?try_files \/\$1\/index\.html \/index\.html;/);
  assert.ok(m, 'clean-URL location');
  const re = new RegExp(m[1]);
  for (const p of PAGES.filter((x) => x.file.startsWith(pagesDir))) {
    for (const variant of [p.path, p.path.endsWith('/') ? p.path.slice(0, -1) : `${p.path}/`]) {
      const hit = variant.match(re);
      assert.ok(hit, `${variant} not matched`);
      assert.ok(existsSync(join(pagesDir, hit[1], 'index.html')), `${variant} -> ${hit[1]}/index.html`);
    }
  }
  for (const p of ['/app', '/app/', '/app/index.html', '/p/abc', '/assets/logo-mark.png', '/download/x.apk']) {
    assert.doesNotMatch(p, re, p);
  }
  // The legal pages' own location comes first, so it still serves them.
  assert.ok(conf.indexOf('(privacy|terms|refunds)') < conf.indexOf(m[0]));
  assert.match(conf, /location = \/robots\.txt/);
  assert.match(conf, /location = \/sitemap\.xml/);
  assert.match(conf, /^\s*charset utf-8;$/m);
});
