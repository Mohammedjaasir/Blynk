#!/usr/bin/env node
// Blynk legal pages (owner's policy text, 2026-10-15): /terms, /privacy, /refunds.
//
// Writes apps/customer-site/terms.html, privacy.html and refunds.html (the
// Dockerfile copies them to the site root; nginx serves them at clean URLs) from:
//   legal/terms.md, legal/privacy.md, legal/refunds.md   the owner's wording
//   legal/legal-config.json                               the owner's details
//
// To fill in a detail the owner has not given yet (registration no., address,
// emails, data-protection contact), set it in legal-config.json and run:
//   node apps/customer-site/scripts/build-legal-pages.mjs          write the pages
//   node apps/customer-site/scripts/build-legal-pages.mjs --check  fail if a page is out of date
//
// The .md files use a small part of Markdown: "### n. Heading" (one section
// each), paragraphs, "1." and "-" lists, | tables | and **bold**. Details come
// in as {{name}}; {{?name}} drops its whole line when that detail is empty, so
// the pages never show a [placeholder].
//
// Rules (owner): no tracking scripts on these pages; the phone number is never
// shown as text, only inside the Call us / WhatsApp us links (2026-10-15).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const siteDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const legalDir = join(siteDir, 'legal');

const SITE = 'https://blynk.lk';
const CSS = '/styles.css?v=20261015a';
const OG_IMAGE = `${SITE}/assets/og-image.jpg`;

export const LEGAL_PAGES = [
  {
    name: 'terms',
    title: 'Terms and Conditions',
    lead: 'The rules for using the Blynk app, website and delivery service: orders, delivery, payment, Blynk Points and the Blynk Wallet.',
    description: 'The terms for ordering from Blynk in Aluthgama and Dharga Town, Sri Lanka: orders, delivery, payment, Blynk Points and the Blynk Wallet.',
    footer: 'Terms of Service',
  },
  {
    name: 'privacy',
    title: 'Privacy Policy',
    description: "How Blynk collects, uses, shares and protects your personal data under Sri Lanka's Personal Data Protection Act, and how to use your rights.",
    footer: 'Privacy Policy',
  },
  {
    name: 'refunds',
    title: 'Return, Refund and Cancellation Policy',
    description: 'How to report missing, damaged or wrong items from a Blynk order, what can be returned, how refunds to your Blynk Wallet work and how to cancel.',
    footer: 'Cancellations & Refunds',
  },
];

// ---------------------------------------------------------------- helpers
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};
const slug = (s) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const readConfig = () => JSON.parse(readFileSync(join(legalDir, 'legal-config.json'), 'utf8'));

function checkConfig(c) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.lastUpdated || '')) throw new Error('legal-config.json: lastUpdated must be YYYY-MM-DD');
  for (const k of ['businessName', 'phone', 'whatsappUrl', 'hours']) if (!c[k]) throw new Error(`legal-config.json: ${k} is required`);
  for (const [k, v] of Object.entries(c)) {
    if (typeof v === 'string' && /\[[^\]]*\]/.test(v)) throw new Error(`legal-config.json: ${k} still holds a [placeholder]`);
  }
}

/** The {{tokens}} as HTML. An empty string means "not given yet". */
function tokens(c) {
  const mail = (addr) => (addr ? `<a href="mailto:${esc(addr)}">${esc(addr)}</a>` : '');
  const tel = (text) => `<a href="tel:${esc(c.phone)}">${text}</a>`;
  const wa = (text) => `<a href="${esc(c.whatsappUrl)}" target="_blank" rel="noopener">${text}</a>`;
  const privacyEmail = c.privacyEmail || c.supportEmail;
  return {
    business: esc(c.businessName),
    regClause: (c.businessRegistrationNo ? `, business registration no. <strong>${esc(c.businessRegistrationNo)}</strong>` : '')
      + (c.registeredAddress ? `, of <strong>${esc(c.registeredAddress)}</strong>` : ''),
    callUs: tel('Call us'),
    whatsappUs: wa('WhatsApp us'),
    phoneLink: tel('phone'),
    whatsappLink: wa('WhatsApp'),
    hours: esc(c.hours),
    supportEmail: mail(c.supportEmail),
    privacyEmail: mail(privacyEmail),
    registeredAddress: esc(c.registeredAddress || ''),
    dataProtectionContact: c.dataProtectionContact ? `<strong>${esc(c.dataProtectionContact)}</strong>` : '',
    privacyRequestsTo: privacyEmail ? `<strong>${mail(privacyEmail)}</strong>` : `us by ${tel('phone')} or ${wa('WhatsApp')}`,
  };
}

// ---------------------------------------------------------------- markdown
function inline(line, tok) {
  return escText(line)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\{\{\??(\w+)\}\}/g, (_, k) => {
      if (!(k in tok)) throw new Error(`unknown detail {{${k}}}`);
      return tok[k];
    });
}

/** A line with an empty {{?detail}} is dropped. */
const keepLine = (line, tok) => [...line.matchAll(/\{\{\?(\w+)\}\}/g)].every((m) => {
  if (!(m[1] in tok)) throw new Error(`unknown detail {{?${m[1]}}}`);
  return tok[m[1]] !== '';
});

function table(lines, tok) {
  const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((x) => x.trim());
  const head = cells(lines[0]);
  const rows = lines.slice(2).map(cells);
  const th = head.map((h) => `<th scope="col" role="columnheader">${inline(h, tok)}</th>`).join('');
  const body = rows.map((r) => `            <tr role="row">${r.map((x, i) => (i === 0
    ? `<th scope="row" role="rowheader" data-label="${esc(head[i])}">${inline(x, tok)}</th>`
    : `<td role="cell" data-label="${esc(head[i])}">${inline(x, tok)}</td>`)).join('')}</tr>`).join('\n');
  return `<div class="legal-table-wrap">
          <table class="legal-table" role="table">
            <thead role="rowgroup"><tr role="row">${th}</tr></thead>
            <tbody role="rowgroup">
${body}
            </tbody>
          </table>
          </div>`;
}

/** Parses a policy .md into { intro: html[], sections: [{ id, title, html[] }] }. */
export function parse(md, tok) {
  const blocks = md.replace(/\r\n/g, '\n').split(/\n{2,}/).map((b) => b.split('\n').filter((l) => l.trim() && keepLine(l, tok))).filter((b) => b.length);
  const intro = [];
  const sections = [];
  for (const b of blocks) {
    const h = b[0].match(/^###\s+(.+)$/);
    if (h) {
      const title = h[1].trim();
      let id = slug(title.replace(/^\d+\.\s*/, ''));
      while (sections.some((s) => s.id === id)) id += '-2';
      sections.push({ id, title, html: [] });
      continue;
    }
    const target = sections.length ? sections.at(-1) : null;
    let html;
    if (b.every((l) => l.trim().startsWith('|'))) html = table(b, tok);
    else if (b.every((l) => /^\d+\.\s/.test(l))) html = `<ol>\n${b.map((l) => `            <li>${inline(l.replace(/^\d+\.\s+/, ''), tok)}</li>`).join('\n')}\n          </ol>`;
    else if (b.every((l) => /^-\s/.test(l))) {
      const contact = target && /contact/i.test(target.title);
      const item = (l) => {
        const text = l.replace(/^-\s+/, '');
        const m = contact && text.match(/^([^:]+):\s(.*)$/);
        return m ? `<strong>${inline(m[1], tok)}:</strong> ${inline(m[2], tok)}` : inline(text, tok);
      };
      html = `<ul${contact ? ' class="legal-contact"' : ''}>\n${b.map((l) => `            <li>${item(l)}</li>`).join('\n')}\n          </ul>`;
    } else html = `<p>${b.map((l) => inline(l, tok)).join(' ')}</p>`;
    (target ? target.html : intro).push(html);
  }
  return { intro, sections };
}

// ---------------------------------------------------------------- page
function render(meta, c) {
  const tok = tokens(c);
  const { intro, sections } = parse(readFileSync(join(legalDir, `${meta.name}.md`), 'utf8'), tok);
  const url = `${SITE}/${meta.name}`;
  const fullTitle = `${meta.title} — Blynk`;
  // The page's own opening paragraph (Privacy, Refunds) is its lead; Terms has none, so it gets a short one.
  const lead = intro.length ? intro.map((p) => p.replace(/^<p>/, '<p class="lead">')).join('\n        ') : `<p class="lead">${esc(meta.lead)}</p>`;
  const toc = sections.map((s) => `          <li><a href="#${s.id}">${esc(s.title)}</a></li>`).join('\n');
  const body = sections.map((s) => `        <section id="${s.id}" aria-labelledby="${s.id}-h">
          <h2 id="${s.id}-h">${esc(s.title)}</h2>
          ${s.html.join('\n          ')}
        </section>`).join('\n\n');
  const footerLink = (p) => `<a href="/${p.name}"${p.name === meta.name ? ' aria-current="page"' : ''}>${esc(p.footer)}</a>`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${esc(fullTitle)}</title>
  <meta name="description" content="${esc(meta.description)}">
  <meta name="theme-color" content="#FFE141">
  <link rel="canonical" href="${url}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Blynk">
  <meta property="og:title" content="${esc(fullTitle)}">
  <meta property="og:description" content="${esc(meta.description)}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${OG_IMAGE}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:locale" content="en_LK">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png">
  <link rel="apple-touch-icon" href="/assets/icon-192.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="${CSS}">
</head>
<body>
  <!-- Generated by apps/customer-site/scripts/build-legal-pages.mjs from
       legal/${meta.name}.md and legal/legal-config.json: edit those, not this file.
       Same header, fonts and footer as the landing page; no tracking scripts on
       this page (owner, 2026-10-14). -->
  <header class="nav">
    <a class="nav__brand" href="/" aria-label="Blynk home">
      <img src="/assets/logo-mark.png" alt="" width="50" height="60">
      <span>blynk</span>
    </a>
    <a class="btn btn--ink btn--pill nav__home" href="/">Back to home</a>
  </header>

  <main id="top">
    <div class="wrap">
      <div class="legal-head">
        <p class="kicker">Legal</p>
        <h1>${esc(meta.title)}</h1>
        ${lead}
        <p class="legal-meta">Last updated: <time datetime="${c.lastUpdated}">${longDate(c.lastUpdated)}</time></p>
      </div>

      <div class="legal">
        <nav class="legal-toc" aria-labelledby="toc-h">
          <h2 id="toc-h">On this page</h2>
          <ol class="legal-toc__list">
${toc}
          </ol>
        </nav>

        <article class="legal-body">
${body}
        </article>
      </div>
    </div>
  </main>

  <footer class="footer">
    <div class="wrap footer__inner">
      <a class="footer__brand" href="/"><img src="/assets/logo-mark.png" alt="" width="28" height="34" loading="lazy"> blynk</a>
      <nav aria-label="Footer">
        <a href="/#how">How it works</a>
        <a href="/#products">Products</a>
        <a href="/#delivery">Delivery</a>
        <a href="/#about">About</a>
      </nav>
      <p class="footer__help">Need help? ${tok.callUs}
        ${tok.whatsappUs}</p>
      <small>© ${c.lastUpdated.slice(0, 4)} Blynk · Dharga Town &amp; Aluthgama, Sri Lanka</small>
      <nav class="footer__legal" aria-label="Legal">
        ${[LEGAL_PAGES[1], LEGAL_PAGES[0], LEGAL_PAGES[2]].map(footerLink).join('\n        ')}
      </nav>
    </div>
  </footer>
</body>
</html>
`;
}

/** Map of file name (relative to apps/customer-site) to its HTML; c defaults to legal-config.json. */
export function build(c = readConfig()) {
  checkConfig(c);
  return new Map(LEGAL_PAGES.map((p) => [`${p.name}.html`, render(p, c)]));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const check = process.argv.includes('--check');
  const stale = [];
  for (const [rel, content] of build()) {
    const file = join(siteDir, rel);
    const current = existsSync(file) ? readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : null;
    if (current === content) continue;
    if (check) { stale.push(rel); continue; }
    writeFileSync(file, content);
    console.log(`wrote ${rel}`);
  }
  if (check && stale.length) {
    console.error(`out of date (run node apps/customer-site/scripts/build-legal-pages.mjs): ${stale.join(', ')}`);
    process.exit(1);
  }
  if (check) console.log('legal pages are up to date');
}
