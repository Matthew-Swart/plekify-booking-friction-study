// Stayntouch IBE flow-exploration probe.
// Headless Playwright + stealth. Goal: find exact selectors entry → payment.
// Run: node src/explore-stayntouch.js [propertyName]

import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'node:fs';

chromium.use(StealthPlugin());

const PROPERTIES = {
  americana: {
    name: 'Americana Motor Hotel',
    url: 'https://americanamotorhotel.ibe.stayntouch.com/',
  },
  essex: {
    name: 'The Essex Resort & Spa',
    url: 'https://essexresort.ibe.stayntouch.com/',
  },
  parkring: {
    name: 'Hotel Am Parkring',
    url: 'https://hotelamparkring.ibe.stayntouch.com/?lang=en',
  },
};

// Dates: ~45 / ~47 days from today
function dates() {
  const ci = new Date(); ci.setDate(ci.getDate() + 45);
  const co = new Date(); co.setDate(co.getDate() + 47);
  const pad = (n) => String(n).padStart(2, '0');
  return {
    iso: { ci: `${ci.getFullYear()}-${pad(ci.getMonth() + 1)}-${pad(ci.getDate())}`,
           co: `${co.getFullYear()}-${pad(co.getMonth() + 1)}-${pad(co.getDate())}` },
    short: { ci: `${pad(ci.getMonth() + 1)}/${pad(ci.getDate())}/${String(ci.getFullYear()).slice(2)}`,
             co: `${pad(co.getMonth() + 1)}/${pad(co.getDate())}/${String(co.getFullYear()).slice(2)}` },
    localized: {
      ci: `${ci.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
      co: `${co.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
    },
  };
}

const log = (...a) => console.log('[probe]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Candidate deep-link param formats to test
const DEEP_LINK_FORMATS = [
  // [template, label]
  ['{base}?arrival_date={ci}&departure_date={co}&adults=2&rooms=1', 'arrival_date/departure_date/adults/rooms'],
  ['{base}?checkin={ci}&checkout={co}&adults=2&rooms=1', 'checkin/checkout/adults/rooms'],
  ['{base}?check_in={ci}&check_out={co}&adults=2&rooms=1', 'check_in/check_out/adults/rooms'],
  ['{base}?checkIn={ci}&checkOut={co}&adults=2&rooms=1', 'checkIn/checkOut'],
  ['{base}?date_checkin={ci}&date_checkout={co}&num_adults=2&num_rooms=1', 'date_checkin/date_checkout'],
  ['{base}?arrive={ci}&depart={co}&adults=2&rooms=1', 'arrive/depart'],
];

async function dismissCookie(page) {
  // Try common cookie-banner selectors, return whichever worked
  const candidates = [
    '#onetrust-accept-btn-handler',
    '#truste-consent-button',
    'button:has-text("Accept All")',
    'button:has-text("Accept all")',
    'button:has-text("Accept")',
    'button:has-text("Got it")',
    'button:has-text("Allow all")',
    'button:has-text("I Agree")',
    '[aria-label="accept"]',
    '[class*="cookie" i] button:has-text("Accept")',
    '[id*="cookie" i] button',
  ];
  for (const sel of candidates) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 800 }).catch(() => false)) {
      try {
        await el.click({ timeout: 2000 });
        log('cookie dismissed with selector:', sel);
        await sleep(400);
        return sel;
      } catch {}
    }
  }
  log('no cookie banner detected (or none matched)');
  return null;
}

async function dumpState(page, label) {
  const url = page.url();
  const title = await page.title().catch(() => '');
  log(`--- ${label} ---`);
  log('url:', url);
  log('title:', title);
  return { url, title };
}

async function findVisibleByMatchers(page, matchers) {
  // matchers: array of Playwright locators or selector strings, in priority order.
  // returns first visible+enabled hit
  for (const m of matchers) {
    const loc = typeof m === 'string' ? page.locator(m) : m;
    const first = loc.first();
    if (await first.isVisible({ timeout: 600 }).catch(() => false)) {
      const enabled = await first.isEnabled({ timeout: 400 }).catch(() => false);
      if (enabled) return m;
    }
  }
  return null;
}

async function probeDeepLinks(page, base, d, propKey, trace) {
  log('\n=== DEEP-LINK TESTS ===');
  const results = [];
  for (const [tmpl, label] of DEEP_LINK_FORMATS) {
    const target = tmpl
      .replace('{base}', base.replace(/\?.*$/, ''))
      .replace('{ci}', d.iso.ci)
      .replace('{co}', d.iso.co);
    try {
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(2500);
      // Heuristic: did the page show availability results, OR did a date input get prefilled?
      const html = await page.content();
      const showsResults = /no availab|sold ?out|available\s+rooms|rate\s+plans|room\s+types|rooms\s+available|from\s+\$|/i.test(html) &&
        await page.locator('[class*="room" i], [class*="rate" i], [class*="result" i]').first().isVisible({ timeout: 1000 }).catch(() => false);
      // Check for visible date chips/labels matching our CI/CO
      const txt = html.toLowerCase();
      const hasCi = txt.includes(d.iso.ci.replace(/-/g, '/')) || txt.includes(d.short.ci) || txt.includes(d.iso.ci) || txt.includes(d.localized.ci.toLowerCase());
      const prefilled = showsResults || hasCi;
      results.push({ label, target, prefilled, showsResults, hasCi, finalUrl: page.url() });
      trace.push({ step: 'deepLinkTest', label, target, prefilled, finalUrl: page.url(), showsResults });
      log(`  [${label}] prefilled=${prefilled} results=${showsResults} ci=${hasCi} url=${page.url()}`);
      if (prefilled) {
        log('  >>> PREFILL DETECTED — using this URL');
        return { ok: true, url: target, label, evidence: { showsResults, hasCi } };
      }
    } catch (e) {
      log(`  [${label}] error ${e.message}`);
      results.push({ label, target, error: e.message });
    }
  }
  return { ok: false, results };
}

async function exploreProperty(propKey) {
  const prop = PROPERTIES[propKey];
  if (!prop) { console.error('unknown property'); process.exit(2); }
  const d = dates();
  log(`\n################ ${prop.name} (${propKey}) ################`);
  log(`dates ci=${d.iso.ci} co=${d.iso.co} (short ${d.short.ci}–${d.short.co})`);

  const trace = [];
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'en-US',
  });
  // Block heavyweight resources we don't need (speeds up, less noise). Keep XHR/fetch.
  await ctx.route('**/*.{png,jpg,jpeg,webp,gif,svg,woff,woff2,ttf,mp4}', (r) => r.abort());
  const page = await ctx.newPage();

  const out = { propKey, name: prop.name, dates: d.iso, trace: [], final: {} };
  try {
    // 1. Initial load
    await page.goto(prop.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(3000);
    let st = await dumpState(page, 'initial load');

    // iframes at landing
    const landingIframes = await page.$$eval('iframe', (fs) => fs.map((f) => ({ src: f.src, id: f.id, name: f.name, class: f.className }))).catch(() => []);
    log('iframes on landing:', JSON.stringify(landingIframes));

    // reCAPTCHA presence
    const recaptcha = {
      script: await page.locator('script[src*="recaptcha"]').count(),
      iframe: await page.locator('iframe[src*="recaptcha"], iframe[title*="reCAPTCHA" i]').count(),
      grecaptcha: await page.evaluate(() => typeof window.grecaptcha !== 'undefined').catch(() => false),
    };
    log('recaptcha presence:', JSON.stringify(recaptcha));

    // cookie dismiss
    const cookieSel = await dismissCookie(page);
    out.cookieDismissSelector = cookieSel;
    trace.push({ step: 'cookieDismiss', selector: cookieSel });

    // 2. Deep-link attempts
    const deepLink = await probeDeepLinks(page, prop.url, d, propKey, trace);
    out.deepLink = deepLink;

    // 3. If no deep link, explore manual flow. Re-open base URL fresh.
    if (!deepLink.ok) {
      log('\n=== MANUAL FLOW EXPLORATION ===');
      await page.goto(prop.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await sleep(3000);
      await dismissCookie(page);

      // Dump key candidate inputs/buttons for diagnosis
      const diag = await page.evaluate(() => {
        const all = (sel) => Array.from(document.querySelectorAll(sel)).map((el) => ({
          tag: el.tagName.toLowerCase(),
          id: el.id || null,
          class: el.className || null,
          type: el.type || null,
          name: el.getAttribute('name'),
          placeholder: el.placeholder || null,
          aria: el.getAttribute('aria-label') || null,
          dataAttrs: Object.fromEntries(Array.from(el.attributes).filter((a) => a.name.startsWith('data-')).map((a) => [a.name, a.value])),
          text: (el.innerText || '').slice(0, 60),
        }));
        return {
          inputs: all('input'),
          buttons: all('button'),
          aLinks: all('a').filter((a) => /book|reserv|check|search|availab|select|continue/i.test(a.text + ' ' + (a.class || '') + ' ' + (a.id || ''))).slice(0, 30),
          selects: all('select'),
        };
      }).catch((e) => ({ error: e.message }));
      fs.writeFileSync(`/tmp/${propKey}-diag.json`, JSON.stringify(diag, null, 2));
      trace.push({ step: 'diagDump', file: `/tmp/${propKey}-diag.json` });
      log('diag inputs:', (diag.inputs || []).length, 'buttons:', (diag.buttons || []).length, 'links:', (diag.aLinks || []).length);

      // 3a. open date picker / set dates
      // Try many date-picker triggers
      const dateTriggers = [
        'input[placeholder*="Check In" i]',
        'input[placeholder*="Check-in" i]',
        'input[placeholder*="Arrival" i]',
        'input[placeholder*="checkin" i]',
        'input[name*="check" i]',
        'input[name*="arrival" i]',
        'input[id*="check" i]',
        'input[id*="date" i]',
        'input[type="date"]',
        '[class*="date-range" i]',
        '[class*="datepicker" i]',
        '[class*="check-in" i]',
        '[class*="arrival" i]',
        'button:has-text("Check In")',
        'button:has-text("Check-in")',
        'button:has-text("Arrival")',
        'div[role="button"]:has-text("Check")',
      ];
      let dateTriggerUsed = null;
      for (const sel of dateTriggers) {
        const loc = page.locator(sel).first();
        if (await loc.isVisible({ timeout: 600 }).catch(() => false)) {
          try { await loc.click({ timeout: 2500 }); dateTriggerUsed = sel; await sleep(1200); break; } catch {}
        }
      }
      log('date trigger used:', dateTriggerUsed);
      trace.push({ step: 'dateTriggerOpen', selector: dateTriggerUsed });

      // 3b. If calendar opened, look for day cells matching our CI/CO
      let ciSelector = null, coSelector = null;
      if (dateTriggerUsed) {
        const calDiag = await page.evaluate(() => {
          const cells = Array.from(document.querySelectorAll('[data-date], .calendar-day, [class*="day" i], td, [role="gridcell"], [role="option"]'));
          return cells.slice(0, 60).map((c) => ({
            tag: c.tagName.toLowerCase(),
            class: c.className || null,
            dataDate: c.getAttribute('data-date'),
            ariaLabel: c.getAttribute('aria-label'),
            text: (c.innerText || '').trim().slice(0, 20),
          }));
        }).catch(() => []);
        fs.writeFileSync(`/tmp/${propKey}-calcells.json`, JSON.stringify(calDiag, null, 2));
        log('calendar cell sample size:', calDiag.length, 'first:', JSON.stringify(calDiag[0]));

        // pick CI by data-date exact, fallback to aria-label/text
        const ciByDataDate = await page.locator(`[data-date="${d.iso.ci}"]`).first();
        if (await ciByDataDate.isVisible({ timeout: 800 }).catch(() => false)) {
          await ciByDataDate.click({ timeout: 2500 }); ciSelector = `[data-date="${d.iso.ci}"]`; await sleep(900);
        } else {
          // try aria-label "Month DD, YYYY"
          const ariaCi = await page.locator(`[aria-label="${d.localized.ci}"]`).first();
          if (await ariaCi.isVisible({ timeout: 800 }).catch(() => false)) {
            await ariaCi.click({ timeout: 2500 }); ciSelector = `[aria-label="${d.localized.ci}"]`; await sleep(900);
          }
        }
        const coByDataDate = await page.locator(`[data-date="${d.iso.co}"]`).first();
        if (await coByDataDate.isVisible({ timeout: 800 }).catch(() => false)) {
          await coByDataDate.click({ timeout: 2500 }); coSelector = `[data-date="${d.iso.co}"]`; await sleep(900);
        } else {
          const ariaCo = await page.locator(`[aria-label="${d.localized.co}"]`).first();
          if (await ariaCo.isVisible({ timeout: 800 }).catch(() => false)) {
            await ariaCo.click({ timeout: 2500 }); coSelector = `[aria-label="${d.localized.co}"]`; await sleep(900);
          }
        }
        log('date cells used: ci=', ciSelector, 'co=', coSelector);
        trace.push({ step: 'dateSelect', ciSelector, coSelector });
      }

      // 3c. set adults/rooms (best-effort)
      // skip if we can't find — many IBEs default to 2/1
      const adultsSel = await findVisibleByMatchers(page, [
        'select[name*="adult" i]', 'select[id*="adult" i]',
        '[class*="adults" i] [aria-label*="increase" i]',
      ]);
      log('adults control:', adultsSel);
      trace.push({ step: 'adultsControl', selector: adultsSel });

      // 3d. search/availability button
      const searchMatchers = [
        'button:has-text("Search")',
        'button:has-text("Check Availability")',
        'button:has-text("Find Rooms")',
        'button:has-text("Get Rates")',
        'button:has-text("Book Now")',
        'button:has-text("Update")',
        'input[type="submit"]',
        'a:has-text("Check Availability")',
      ];
      const searchSel = await findVisibleByMatchers(page, searchMatchers);
      log('search button:', searchSel);
      if (searchSel) {
        try { await page.locator(searchSel).first().click({ timeout: 3000 }); } catch {}
        await sleep(4000);
      }
      trace.push({ step: 'searchClick', selector: searchSel, urlAfter: page.url() });
      await dumpState(page, 'after search');

      // 3e. room/rate selection
      // matchers that should hit the "Book"/"Reserve"/"Select" CTA on a rate card
      const bookMatchers = [
        'button:has-text("Book")',
        'button:has-text("Reserve")',
        'button:has-text("Select")',
        'button:has-text("Choose")',
        'button:has-text("Continue")',
        'a:has-text("Book")',
        'a:has-text("Reserve")',
        'a:has-text("Select")',
        '[class*="rate" i] button',
        '[class*="room" i] button',
      ];
      const bookSel = await findVisibleByMatchers(page, bookMatchers);
      log('first book/reserve button:', bookSel);
      trace.push({ step: 'bookClickSelector', selector: bookSel });
      if (bookSel) {
        try { await page.locator(bookSel).first().click({ timeout: 3000 }); } catch (e) { log('book click err', e.message); }
        await sleep(4000);
      }
      await dumpState(page, 'after book click');
      trace.push({ step: 'afterBookClick', url: page.url() });

      // 3f. guest details page → "Continue to payment"
      const contMatchers = [
        'button:has-text("Continue to Payment")',
        'button:has-text("Continue")',
        'button:has-text("Next")',
        'button:has-text("Proceed")',
        'button:has-text("Review")',
        'a:has-text("Continue")',
      ];
      // If a guest form is present, we may need to fill required fields to unlock Continue.
      const guestFieldsFilled = await fillGuestFormIfPresent(page);
      trace.push({ step: 'guestFormFilled', fields: guestFieldsFilled });

      const contSel = await findVisibleByMatchers(page, contMatchers);
      log('continue button:', contSel);
      if (contSel) {
        try { await page.locator(contSel).first().click({ timeout: 3000 }); } catch (e) { log('continue err', e.message); }
        await sleep(4500);
      }
      trace.push({ step: 'afterContinue', url: page.url() });
      await dumpState(page, 'after continue');
    }

    // 4. PAYMENT DETECTION — across all paths
    st = await dumpState(page, 'final payment check');
    const paymentUrlRegex = /(\/checkouts?\/)|(\/checkout)|(\/?payment)|(\/book\/.*pay)|(\/reservation.*pay)|(\/pay($|\/))/i;
    const urlHit = paymentUrlRegex.test(st.url);
    // Card-number iframe detection (common: Stripe/worldpay/Spreedly/AuthorizeNet)
    const cardIframes = await page.$$eval('iframe', (fs) => fs.map((f) => ({ src: f.src, name: f.name, id: f.id, title: f.title })).filter((f) =>
      /card|payment|stripe|spreedly|worldpay|authorize|cybersource|hps|securesubmit|tokenex|checkout|recaptcha/i.test(JSON.stringify(f)))).catch(() => []);
    const cardInputByLabel = await page.locator('input[name*="card" i], input[id*="card" i], input[autocomplete="cc-number"], input[name*="cc" i]').first().isVisible({ timeout: 500 }).catch(() => false);
    const paymentHeading = await page.locator('h1:has-text("Payment"), h2:has-text("Payment"), h2:has-text("Billing"), [class*="payment" i]').first().isVisible({ timeout: 500 }).catch(() => false);

    const paymentReached = urlHit || cardInputByLabel || paymentHeading || cardIframes.length > 0;
    log('PAYMENT DETECTION:', { urlHit, cardInputByLabel, paymentHeading, cardIframes });

    out.paymentReached = paymentReached;
    out.paymentIndicator = {
      urlHit, finalUrl: st.url,
      cardInputByLabel, paymentHeading,
      cardIframes,
    };

    // capture final iframes + recaptcha again
    out.final = {
      url: st.url,
      title: st.title,
      iframes: await page.$$eval('iframe', (fs) => fs.map((f) => ({ src: f.src, name: f.name, id: f.id, title: f.title }))).catch(() => []),
      recaptcha: {
        script: await page.locator('script[src*="recaptcha"]').count(),
        iframe: await page.locator('iframe[src*="recaptcha"], iframe[title*="reCAPTCHA" i]').count(),
        grecaptcha: await page.evaluate(() => typeof window.grecaptcha !== 'undefined').catch(() => false),
      },
    };
    out.trace = trace;

    // screenshot + html
    fs.writeFileSync(`/tmp/${propKey}-final.html`, await page.content());
    await page.screenshot({ path: `/tmp/${propKey}-final.png`, fullPage: false }).catch(() => {});

  } catch (e) {
    out.error = e.message;
    log('FATAL', e.message);
  } finally {
    out.trace = trace;
    fs.writeFileSync(`/tmp/${propKey}-result.json`, JSON.stringify(out, null, 2));
    await browser.close();
  }
  return out;
}

async function fillGuestFormIfPresent(page) {
  const filled = [];
  const tries = [
    ['input[name*="first" i]', 'Test'],
    ['input[name*="last" i]', 'Guest'],
    ['input[name*="email" i]', 'friction.test@example.com'],
    ['input[type="email"]', 'friction.test@example.com'],
    ['input[name*="phone" i]', '5555555555'],
    ['input[type="tel"]', '5555555555'],
    ['select[name*="country" i]', 'US'],
  ];
  for (const [sel, val] of tries) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible({ timeout: 400 }).catch(() => false)) {
      try {
        const tag = await loc.evaluate((el) => el.tagName).catch(() => 'INPUT');
        if (tag === 'SELECT') await loc.selectOption(val).catch(() => {});
        else await loc.fill(val).catch(() => {});
        filled.push(sel);
      } catch {}
    }
  }
  return filled;
}

// --- main ---
const arg = process.argv[2] || 'americana';
if (arg === 'all') {
  (async () => {
    const results = {};
    for (const key of Object.keys(PROPERTIES)) {
      results[key] = await exploreProperty(key);
    }
    fs.writeFileSync('/tmp/stayntouch-all-results.json', JSON.stringify(results, null, 2));
    log('\nALL DONE — /tmp/stayntouch-all-results.json');
  })();
} else {
  exploreProperty(arg);
}
