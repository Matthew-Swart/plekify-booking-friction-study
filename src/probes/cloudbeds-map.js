/**
 * Cloudbeds booking-flow mapper — produces a selector-level JSON spec.
 *
 * For each property:
 *   1. Load homepage, find + click the "Book Now" / "Check Availability" affordance.
 *   2. Follow it to the Cloudbeds booking engine (iframe or hotels.cloudbeds.com redirect).
 *   3. Determine the canonical reservation URL pattern + whether date query params work.
 *   4. Drive the flow: date entry (URL or calendar) → search → first room → Book → payment page.
 *   5. Record real selectors only.
 *
 * Run:  node src/probes/cloudbeds-map.js
 * Output: printed to stdout + written to data/cloudbeds-flow-spec.json
 */
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sleep } from '../util.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const PROPS = [
  { name: 'Saltline Hotel', homepageUrl: 'https://www.saltlinehotel.com/' },
  { name: 'Sea Esta Komodo', homepageUrl: 'https://seaestakomodo.com/' },
  { name: 'Fatwave Surf Resort', homepageUrl: 'https://www.fatwavesurfresort.com/' },
];

// Rolling dates: T+45 / T+47 (Protocol §4)
function studyDates(from = new Date()) {
  const cin = new Date(from.getTime() + 45 * 86400000);
  const cout = new Date(from.getTime() + 47 * 86400000);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const slash = (d) => `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
  return { checkin: iso(cin), checkout: iso(cout), cinSlash: slash(cin), coutSlash: slash(cout), cin, cout };
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function discover(page, log) {
  // Walk every iframe on the current page and report any cloudbeds one.
  const frames = page.frames();
  const cb = frames.filter((f) => /hotels\.cloudbeds\.com|booking\.cloudbeds/i.test(f.url()));
  for (const f of cb) log(`  iframe cloudbeds: ${f.url()}`);
  return cb;
}

async function runProp(browser, prop, dates) {
  const out = {
    property: prop.name,
    homepageUrl: prop.homepageUrl,
    bookingEngineUrl: null,
    iframe: { present: false, selector: null },
    cookieDismiss: { selector: null },
    dateParams: { works: false, sampleUrl: null, format: null },
    captcha: { visible: false, kind: null },
    steps: [],
    paymentReached: false,
    paymentIndicator: null,
    gotchas: [],
    errors: [],
  };
  const log = (m) => { console.log(`  [${prop.name}] ${m}`); out.steps._log = out.steps._log || []; };
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 850 }, locale: 'en-US' });
  ctx.setDefaultTimeout(20000);
  const page = await ctx.newPage();

  // Track all navigations + iframe appearances so we can spot the cloudbeds URL.
  const navUrls = [];
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) navUrls.push(f.url()); });

  try {
    // ---- 1. Homepage ----
    log(`goto ${prop.homepageUrl}`);
    await page.goto(prop.homepageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(2500); // SPA grace

    // cookie banner capture (so spec can dismiss it)
    for (const sel of ['#onetrust-accept-btn-handler', '.cookie-accept', 'button:has-text("Accept")', '#consent-accept', 'a:has-text("Accept All")', '#catapultCookie', '.cc-dismiss']) {
      if (await page.locator(sel).first().isVisible().catch(() => false)) {
        out.cookieDismiss.selector = sel;
        await page.locator(sel).first().click({ timeout: 4000 }).catch(() => {});
        log(`cookie banner dismissed via ${sel}`);
        break;
      }
    }

    // ---- 2. Find + click the Book affordance ----
    const bookTexts = ['Book Now', 'Book', 'Check Availability', 'Reserve', 'Reservations', 'Book Your Stay'];
    let clicked = false;
    for (const t of bookTexts) {
      // try link + button by visible text
      for (const el of await page.getByText(t, { exact: true }).all().catch(() => [])) {
        if (await el.isVisible().catch(() => false)) {
          const href = await el.getAttribute('href').catch(() => null);
          out.steps.push({ action: 'click', selector: `text="${t}"`, desc: `homepage Book affordance${href ? ` (href=${href})` : ''}` });
          try { await el.click({ timeout: 5000 }); clicked = true; log(`clicked "${t}"`); break; } catch { /* next */ }
        }
      }
      if (clicked) break;
      // fallback: link by role
      for (const el of await page.getByRole('link', { name: t }).all().catch(() => [])) {
        if (await el.isVisible().catch(() => false)) {
          const href = await el.getAttribute('href').catch(() => null);
          out.steps.push({ action: 'click', selector: `role=link[name="${t}"]`, desc: `homepage Book link${href ? ` (href=${href})` : ''}` });
          try { await el.click({ timeout: 5000 }); clicked = true; log(`clicked link "${t}"`); break; } catch { /* next */ }
        }
      }
      if (clicked) break;
    }
    if (!clicked) {
      // last resort: any anchor whose href contains cloudbeds / reservation
      const a = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a[href]'));
        const hit = links.find((l) => /hotels\.cloudbeds\.com|\/reservation|booking\.|\/book/i.test(l.href));
        return hit ? { href: hit.href, text: (hit.innerText || '').trim().slice(0, 40) } : null;
      }).catch(() => null);
      if (a) {
        out.steps.push({ action: 'goto', selector: null, desc: `direct booking link: "${a.text}"`, value: a.href });
        await page.goto(a.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
        clicked = true; log(`direct-goto booking link ${a.href}`);
      }
    }
    if (!clicked) { out.errors.push('no Book affordance found on homepage'); log('NO book affordance found'); }

    await sleep(4000); // let booking engine / redirect settle
    log(`post-click main URL: ${page.url()}`);
    navUrls.forEach((u) => log(`  nav: ${u}`));

    // ---- 3. Detect iframe vs full-page redirect to cloudbeds ----
    let engineFrame = null;
    let engineUrl = null;
    // (a) iframe on the hotel page
    const cbFrames = await discover(page, log);
    if (cbFrames.length) {
      engineFrame = cbFrames[0];
      engineUrl = engineFrame.url();
      out.iframe.present = true;
      // selector: try to find the iframe element in DOM by src substring
      const sel = await page.evaluate((needle) => {
        const f = Array.from(document.querySelectorAll('iframe')).find((x) => (x.src || '').includes(needle));
        if (!f) return null;
        if (f.id) return `#${f.id}`;
        if (f.name) return `iframe[name="${f.name}"]`;
        // build a CSS attr selector from the src
        const s = f.getAttribute('src') || '';
        return `iframe[src*="${s.slice(0, 40)}"]`;
      }, 'hotels.cloudbeds.com').catch(() => null);
      out.iframe.selector = sel;
      log(`iframe mode; engine URL ${engineUrl}; selector ${sel}`);
    } else if (/hotels\.cloudbeds\.com/i.test(page.url())) {
      // (b) full-page redirect
      engineFrame = page.mainFrame();
      engineUrl = page.url();
      log(`full-page redirect; engine URL ${engineUrl}`);
    }
    out.bookingEngineUrl = engineUrl;

    if (!engineFrame) {
      // maybe a popup opened
      const pages = ctx.pages();
      for (const p of pages) {
        if (/hotels\.cloudbeds\.com/i.test(p.url())) { engineFrame = p.mainFrame(); engineUrl = p.url(); log(`popup engine ${engineUrl}`); out.bookingEngineUrl = engineUrl; break; }
      }
    }
    if (!engineFrame) { out.errors.push('no cloudbeds engine reached'); log('NO engine reached'); }

    // capture captcha presence on the engine
    const cap = await engineFrame?.evaluate(() => {
      const vis = Array.from(document.querySelectorAll('iframe')).some((f) => /recaptcha|hcaptcha|turnstile|challenges\.cloudflare/.test(f.src || '') && f.getBoundingClientRect().width > 60);
      const widget = !!document.querySelector('.cf-turnstile, .h-captcha, [data-sitekey]');
      const body = (document.body && document.body.innerText) || '';
      const text = /verify you are human|just a moment|are you a robot|access denied/i.test(body);
      const kind = document.querySelector('[data-sitekey]') ? (document.querySelector('iframe[src*="recaptcha"]') ? 'recaptcha' : (document.querySelector('iframe[src*="hcaptcha"]') ? 'hcaptcha' : 'turnstile')) : null;
      return { vis, widget, text, kind };
    }).catch(() => ({ vis: false, widget: false, text: false, kind: null }));
    const capSafe = cap || { vis: false, widget: false, text: false, kind: null };
    out.captcha = { visible: !!(capSafe.vis || capSafe.widget || capSafe.text), kind: capSafe.kind };

    // ---- 4. Test date-prefilled URL params ----
    // VERIFIED (2026-07-02): the working deep-link format is checkin + checkout
    // (ISO YYYY-MM-DD). The older ?date=&nights= format does NOT hydrate the
    // Chakra engine UI. See data/cloudbeds-flow-spec.json.
    if (engineUrl) {
      const trials = [
        { format: 'checkin+checkout', q: `?checkin=${dates.checkin}&checkout=${dates.checkout}&adults=2` },
        { format: 'date+nights', q: `?date=${dates.checkin}&nights=2&adults=2` },
      ];
      for (const tr of trials) {
        const testUrl = engineUrl.split('?')[0] + tr.q;
        const tctx = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 850 } });
        const tpage = await tctx.newPage();
        try {
          await tpage.goto(testUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await sleep(4500); // engine render + auto-search
          // Did the engine apply the date? Look for a visible "selected" check-in, or that rooms load
          // without us touching the calendar, and no "please select dates" error.
          const applied = await tpage.evaluate(() => {
            const txt = (document.body.innerText || '').toLowerCase();
            const hasRooms = /per night|night from|select room|book now|availability/.test(txt);
            const selDates = !!document.querySelector('.cb-day-selected, .selected, [aria-selected="true"]');
            const askDate = /please (select|choose).*date|select your dates/i.test(txt);
            return { hasRooms, selDates, askDate };
          }).catch(() => ({ hasRooms: false, selDates: false, askDate: true }));
          log(`dateparam ${tr.format} ${testUrl} => ${JSON.stringify(applied)}`);
          if ((applied.hasRooms || applied.selDates) && !applied.askDate) {
            out.dateParams.works = true;
            out.dateParams.format = tr.format;
            out.dateParams.sampleUrl = testUrl;
            tctx.close().catch(() => {});
            break;
          }
        } catch (e) { log(`dateparam ${tr.format} failed: ${String(e).slice(0, 80)}`); }
        await tctx.close().catch(() => {});
      }
    }

    // ---- 5. Drive the calendar (if URL params didn't work) ----
    const target = engineFrame; // Frame or Page
    if (!out.dateParams.works && target) {
      log('driving calendar manually');
      // Cloudbeds classic engine: date inputs + a calendar popup. Try the usual selectors.
      const dateInputs = await target.evaluate(() => {
        const map = {};
        const all = Array.from(document.querySelectorAll('input'));
        for (const i of all) {
          const ph = (i.placeholder || '').toLowerCase();
          const id = (i.id || '').toLowerCase();
          const nm = (i.name || '').toLowerCase();
          if (/check.?in|arrival|from/.test(ph + ' ' + id + ' ' + nm)) map.checkin = '#' + (i.id || '') || `[name="${i.name}"]`;
          if (/check.?out|departure|to/.test(ph + ' ' + id + ' ' + nm)) map.checkout = '#' + (i.id || '') || `[name="${i.name}"]`;
        }
        // also collect obvious date-pickers
        const pickers = Array.from(document.querySelectorAll('[class*="datepicker"], [class*="date-picker"], .cb-date, [data-testid*="date"]')).map((e) => e.className).slice(0, 3);
        return { map, pickers, sampleInputIds: all.slice(0, 8).map((i) => ({ id: i.id, name: i.name, ph: i.placeholder, type: i.type })) };
      }).catch(() => ({}));
      log(`date inputs: ${JSON.stringify(dateInputs).slice(0, 300)}`);

      // Try clicking a "Check-in" labelled input by text
      const openCin = await target.locator('input:has-text("Check-in"), input[placeholder*="Check-in" i], [aria-label*="Check-in" i]').first().click({ timeout: 4000 }).catch(() => null);
      // fallback: any date-ish input
      if (!openCin) await target.locator('input[type="text"], input[type="date"]').first().click({ timeout: 4000 }).catch(() => {});

      await sleep(800);
      // Look for a calendar with day cells identified by data-date (Cloudbeds uses .day, .has-content, [data-date])
      // First, try the modern flatpickr-style: [data-date="YYYY-MM-DD"] — but if not present, fall back to text day cells.
      const calInfo = await target.evaluate((d) => {
        const byAttr = document.querySelector(`[data-date="${d}"]`);
        // Cloudbeds "monthCalendar" cells: <a class="day has-content" data-date="2026-08-16"> or text day number
        const byText = Array.from(document.querySelectorAll('.day, td, a')).find((e) => (e.getAttribute('data-date') === d) || ((e.innerText || '').trim() === String(new Date(d).getDate()) && /available|has-content|valid/i.test(e.className)));
        return {
          byAttr: !!byAttr,
          dayClasses: Array.from(document.querySelectorAll('.day, [class*="day"]')).slice(0, 5).map((e) => e.className),
          calRoot: !!document.querySelector('.calendar, [class*="calendar"], .flatpickr-calendar'),
        };
      }, dates.checkin).catch(() => ({ byAttr: false }));
      log(`calendar for ${dates.checkin}: ${JSON.stringify(calInfo).slice(0, 200)}`);

      // Best-effort: click the [data-date] cell, advancing months if needed
      for (let attempt = 0; attempt < 6; attempt++) {
        const cell = target.locator(`[data-date="${dates.checkin}"]`).first();
        if (await cell.isVisible().catch(() => false)) {
          await cell.click({ timeout: 4000 }).catch(() => {});
          out.steps.push({ action: 'clickDate', selector: `[data-date="${dates.checkin}"]`, desc: 'check-in day cell' });
          log(`clicked checkin ${dates.checkin}`);
          break;
        }
        await target.locator('[class*="next"], [aria-label*="ext" i], .next-month').first().click({ timeout: 3000 }).catch(() => {});
        await sleep(400);
      }
      // checkout
      for (let attempt = 0; attempt < 6; attempt++) {
        const cell = target.locator(`[data-date="${dates.checkout}"]`).first();
        if (await cell.isVisible().catch(() => false)) {
          await cell.click({ timeout: 4000 }).catch(() => {});
          out.steps.push({ action: 'clickDate', selector: `[data-date="${dates.checkout}"]`, desc: 'check-out day cell' });
          log(`clicked checkout ${dates.checkout}`);
          break;
        }
        await target.locator('[class*="next"], [aria-label*="ext" i], .next-month').first().click({ timeout: 3000 }).catch(() => {});
        await sleep(400);
      }
      // adults = 2 (default is usually 2 on Cloudbeds; check + capture selector if +/- present)
      const adultsSel = await target.evaluate(() => {
        const p = document.querySelector('[class*="adult"], [data-testid*="adult"], select[name*="adult"]');
        return p ? (p.id ? `#${p.id}` : `[class*="adult"]`) : null;
      }).catch(() => null);
      if (adultsSel) out.steps.push({ action: 'verify', selector: adultsSel, desc: 'adults default = 2 (no change)' });

      // ---- 6. Search ----
      const searchSel = await target.evaluate(() => {
        const cands = ['button:has-text("Search")', 'button:has-text("Check Availability")', 'button:has-text("Update")', 'input[type="submit"]', '.search-button', '#search'];
        for (const c of cands) {
          const e = document.querySelector(c);
          if (e) return c;
        }
        return null;
      }).catch(() => null);
      if (searchSel) {
        await target.locator(searchSel).first().click({ timeout: 6000 }).catch(() => {});
        out.steps.push({ action: 'click', selector: searchSel, desc: 'search/refresh availability' });
        log(`search clicked: ${searchSel}`);
      }
      await sleep(4000);
    }

    // ---- 7. Select first available room ----
    if (target) {
      const roomSel = await target.evaluate(() => {
        // Cloudbeds: each available rate shows a "Book Now" / "Reserve" / "Select" button per room type
        const c = ['button:has-text("Book Now")', 'button:has-text("Reserve")', 'button:has-text("Select")', '.btn-book', 'a:has-text("Book Now")', '[class*="book"]'];
        for (const sel of c) {
          const e = document.querySelector(sel);
          if (e && e.getBoundingClientRect().width > 0) return sel;
        }
        // fallback: any visible book-ish button text
        const btns = Array.from(document.querySelectorAll('button, a')).filter((b) => /book|reserve|select|continue/i.test(b.innerText || ''));
        return btns.length ? `button:has-text("${(btns[0].innerText || '').trim()}")` : null;
      }).catch(() => null);
      if (roomSel) {
        await target.locator(roomSel).first().click({ timeout: 6000 }).catch(() => {});
        out.steps.push({ action: 'click', selector: roomSel, desc: 'first available room Book/Reserve' });
        log(`room selected via ${roomSel}`);
        await sleep(3500);
      } else {
        log('no room Book button found (sold out? selector mismatch?)');
        out.errors.push('no room Book button found');
      }
    }

    // ---- 8. Continue to payment ----
    if (target) {
      // After selecting a room, Cloudbeds shows a cart/summary; "Continue" → customer details → payment.
      const contSel = await target.evaluate(() => {
        const c = ['button:has-text("Continue")', 'button:has-text("Next")', 'button:has-text("Checkout")', 'button:has-text("Pay")', 'a:has-text("Continue")', '.btn-checkout'];
        for (const sel of c) {
          const e = document.querySelector(sel);
          if (e && e.getBoundingClientRect().width > 0) return sel;
        }
        return null;
      }).catch(() => null);
      if (contSel) {
        await target.locator(contSel).first().click({ timeout: 6000 }).catch(() => {});
        out.steps.push({ action: 'click', selector: contSel, desc: 'continue to checkout' });
        log(`continue clicked ${contSel}`);
        await sleep(3000);
      }

      // Payment-page indicator: card-number iframe / known Cloudbeds payment URL segment / "Payment" heading
      const pay = await target.evaluate(() => {
        const url = location.href;
        const cardIfr = Array.from(document.querySelectorAll('iframe')).some((f) => /stripe|js\.stripe|payments\.cloudbeds|checkout|card/i.test(f.src || '') || /card|payment/i.test(f.name || ''));
        const heading = /payment|billing|card details|deposit|pay now/i.test(document.body.innerText || '');
        const payUrl = /\/payment|\/checkout|\/pay\b|\/confirm/i.test(url);
        const cardInput = !!document.querySelector('input[autocomplete*="cc-number" i], input[name*="card" i], input[name*="ccnumber" i], [data-elements-stable-field-name*="cardNumber"]');
        return { url, cardIfr, heading, payUrl, cardInput };
      }).catch(() => ({ url: target.url(), cardIfr: false, heading: false, payUrl: false, cardInput: false }));
      log(`payment probe: ${JSON.stringify(pay).slice(0, 300)}`);
      if (pay.cardIfr || pay.payUrl || pay.cardInput) {
        out.paymentReached = true;
        out.paymentIndicator = pay.cardIfr
          ? 'card iframe (Stripe/cloudbeds) present'
          : pay.cardInput
            ? 'cc-number input present'
            : 'payment URL segment: ' + pay.url;
        out.steps.push({ action: 'waitForPayment', selector: null, desc: 'payment page reached' });
      } else {
        out.paymentReached = false;
        out.paymentIndicator = null;
        // record where we got stuck
        out.gotchas.push(`stopped at: ${pay.url}`);
      }
    }
  } catch (e) {
    out.errors.push(String(e).slice(0, 240));
    log(`ERROR ${String(e).slice(0, 240)}`);
  } finally {
    // attach final nav history for diagnosis
    out.navHistory = navUrls;
    await ctx.close().catch(() => {});
  }
  return out;
}

async function main() {
  chromium.use(StealthPlugin());
  const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });
  const dates = studyDates();
  console.log(`Dates: checkin=${dates.checkin} checkout=${dates.checkout}`);
  const results = [];
  for (const prop of PROPS) {
    console.log(`\n=== ${prop.name} ===`);
    const r = await runProp(browser, prop, dates);
    results.push(r);
  }
  await browser.close();

  // Aggregate into a single Cloudbeds spec
  const spec = {
    system: 'cloudbeds',
    deepLinkPattern: results.find((r) => r.dateParams.works)?.dateParams.sampleUrl || null,
    deepLinkFormat: results.find((r) => r.dateParams.works)?.dateParams.format || null,
    canonicalReservationPattern: 'https://hotels.cloudbeds.com/reservation/<PROPERTY_ID>',
    iframe: { present: results.some((r) => r.iframe.present), selector: results.map((r) => r.iframe.selector).filter(Boolean)[0] || null, notes: 'mixed: some sites embed in iframe, others full-page redirect' },
    cookieDismiss: { selector: results.map((r) => r.cookieDismiss.selector).filter(Boolean)[0] || null },
    steps: results[0]?.steps.filter((s) => s.action) || [],
    captchaObserved: results.some((r) => r.captcha.visible),
    paymentReached: results.some((r) => r.paymentReached),
    paymentIndicator: results.find((r) => r.paymentIndicator)?.paymentIndicator || null,
    perProperty: results,
    gotchas: Array.from(new Set(results.flatMap((r) => r.gotchas).concat([
      'Cloudbeds reservation ID is per-property in the path; date query params work (date=YYYY-MM-DD&nights=N&adults=N)',
      'Calendar day cells use [data-date="YYYY-MM-DD"]; advance month with [class*="next"] / aria-label*="ext"',
      'When sold out for the test dates, no Book button appears — use rolling dates T+45/T+47',
    ]))),
    testDates: { checkin: dates.checkin, checkout: dates.checkout },
  };

  mkdirSync(join(ROOT, 'data'), { recursive: true });
  writeFileSync(join(ROOT, 'data', 'cloudbeds-flow-spec.json'), JSON.stringify(spec, null, 2));
  console.log('\n=== AGGREGATED SPEC ===');
  console.log(JSON.stringify(spec, null, 2));
  console.log(`\nWrote data/cloudbeds-flow-spec.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
