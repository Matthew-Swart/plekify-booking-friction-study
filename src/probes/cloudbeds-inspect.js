/**
 * DOM inspector — dump the key markup for Saltline (find real book link) and
 * Fatwave (find real room Book button + confirm date-param engine state).
 * Run:  node src/probes/cloudbeds-inspect.js
 */
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { sleep } from '../util.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function dump(ctx, label) {
  const page = await ctx.newPage();
  console.log(`\n========== ${label} ==========`);
  return page;
}

async function main() {
  chromium.use(StealthPlugin());
  const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });

  // ---- SALTLINE: find the real booking widget/link ----
  {
    const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 850 }, locale: 'en-US' });
    const page = await dump(ctx, 'SALTLINE homepage');
    await page.goto('https://www.saltlinehotel.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);
    // every anchor + button mentioning book/reserve/check, with href
    const aff = await page.evaluate(() => {
      const out = [];
      for (const a of document.querySelectorAll('a, button')) {
        const t = ((a.innerText || a.textContent || '') + ' ' + (a.getAttribute('aria-label') || '')).trim();
        const href = a.getAttribute('href') || '';
        if (/book|reserve|check.*avail|availability|reservation|stay/i.test(t) || /cloudbeds|reservation|booking/i.test(href)) {
          out.push({ tag: a.tagName, text: t.slice(0, 50), href, id: a.id || null, cls: (a.className || '').slice(0, 60) });
        }
      }
      return out;
    }).catch(() => []);
    console.log('book-ish elements:', JSON.stringify(aff, null, 2));
    // any iframe / cloudbeds reference anywhere
    const ifrs = await page.evaluate(() => Array.from(document.querySelectorAll('iframe')).map((f) => ({ src: f.src, id: f.id })).filter((f) => f.src)).catch(() => []);
    console.log('iframes:', JSON.stringify(ifrs));
    // search the raw HTML for cloudbeds / reservation IDs
    const html = await page.content();
    const cbMatches = [...html.matchAll(/hotels\.cloudbeds\.com\/reservation\/[A-Za-z0-9]+|cloudbeds[^"'\s]{0,40}/gi)].map((m) => m[0]).slice(0, 8);
    console.log('cloudbeds refs in HTML:', [...new Set(cbMatches)]);
    await ctx.close();
  }

  // ---- FATWAVE: prefilled date URL, then dump room buttons ----
  {
    const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 850 }, locale: 'en-US' });
    const page = await dump(ctx, 'FATWAVE engine (prefilled date)');
    const url = 'https://hotels.cloudbeds.com/en/reservation/SoRbvN?date=2026-08-16&nights=2&adults=2';
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(6000); // engine render + auto-search
    console.log('url:', page.url());
    console.log('title:', await page.title().catch(() => ''));
    // date inputs + adults
    const head = await page.evaluate(() => {
      const txt = (document.body.innerText || '').slice(0, 600);
      return txt;
    }).catch(() => '');
    console.log('body text head:\n', head);
    // all buttons
    const btns = await page.evaluate(() => Array.from(document.querySelectorAll('button, input[type="submit"], a.btn, a[class*="book"], a[class*="reserve"]')).map((b) => ({
      tag: b.tagName, text: (b.innerText || b.value || '').trim().slice(0, 30), id: b.id || null,
      cls: (b.className || '').toString().slice(0, 80), name: b.name || null, type: b.type || null,
      disabled: b.disabled, vis: b.getBoundingClientRect().width > 0,
    })).filter((b) => b.text || b.cls)).catch(() => []);
    console.log('buttons:', JSON.stringify(btns, null, 2));
    // room/rate cards
    const cards = await page.evaluate(() => {
      const sels = ['.room-type', '[class*="room-type"]', '[class*="RoomType"]', '[class*="rate"]', '[data-room-id]', '[class*="room"]', '.accommodation'];
      const out = {};
      for (const s of sels) { const e = document.querySelectorAll(s); if (e.length) out[s] = e.length; }
      // also any element whose class contains "book"/"reserve"
      const bookish = Array.from(document.querySelectorAll('[class*="book" i], [class*="reserve" i], [class*="select" i]')).slice(0, 6).map((e) => ({ tag: e.tagName, cls: (e.className || '').toString().slice(0, 80), text: (e.innerText || '').slice(0, 40) }));
      return { cardSelectors: out, bookish };
    }).catch(() => ({}));
    console.log('cards:', JSON.stringify(cards, null, 2));
    // sold-out indicators
    const sold = await page.evaluate(() => {
      const t = (document.body.innerText || '').toLowerCase();
      return {
        noAvail: /no (rooms |availability|rates)|sold out|not available|unavailable/.test(t),
        availHeading: /availability|available rooms|rooms.*available|select your room/.test(t),
      };
    }).catch(() => ({}));
    console.log('soldout probe:', JSON.stringify(sold));
    // screenshot for the record
    await page.screenshot({ path: 'data/fatwave-engine-prefilled.png', fullPage: false }).catch(() => {});
    await ctx.close();
  }

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
