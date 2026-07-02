// Stayntouch IBE v4 — DEEP-LINK confirmed: ?checkin=MM-DD-YYYY&checkout=MM-DD-YYYY&adults=N&kids=N
// Skip the calendar entirely. Drive /search-results → rate Book Now → guest → payment.
//
// Run: node src/explore-stayntouch-v4.js [propertyName]

import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'node:fs';

chromium.use(StealthPlugin());

const PROPERTIES = {
  americana: { name: 'Americana Motor Hotel', base: 'https://americanamotorhotel.ibe.stayntouch.com' },
  essex: { name: 'The Essex Resort & Spa', base: 'https://essexresort.ibe.stayntouch.com' },
  parkring: { name: 'Hotel Am Parkring', base: 'https://hotelamparkring.ibe.stayntouch.com' },
};

function datesFixed() {
  const ci = new Date(); ci.setDate(ci.getDate() + 45);
  const co = new Date(); co.setDate(co.getDate() + 47);
  const pad = (n) => String(n).padStart(2, '0');
  return {
    iso: { ci: `${ci.getFullYear()}-${pad(ci.getMonth() + 1)}-${pad(ci.getDate())}`,
           co: `${co.getFullYear()}-${pad(co.getMonth() + 1)}-${pad(co.getDate())}` },
    mmddyyyy: { // Stayntouch format
      ci: `${pad(ci.getMonth() + 1)}-${pad(ci.getDate())}-${ci.getFullYear()}`,
      co: `${pad(co.getMonth() + 1)}-${pad(co.getDate())}-${co.getFullYear()}`,
    },
  };
}

const log = (...a) => console.log('[v4]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function dismissCookie(page) {
  const sels = [
    '#onetrust-accept-btn-handler', '#truste-consent-button',
    'button:has-text("Accept All")', 'button:has-text("Accept all")',
    'button:has-text("Accept")', 'button:has-text("Got it")',
    '[class*="cookie" i] button', '[id*="cookie" i] button',
  ];
  for (const s of sels) {
    const el = page.locator(s).first();
    if (await el.isVisible({ timeout: 700 }).catch(() => false)) {
      try { await el.click({ timeout: 1500 }); log('cookie:', s); await sleep(400); return s; } catch {}
    }
  }
  return null;
}

async function domSummary(page, label, fileKey) {
  const dom = await page.evaluate(() => {
    const fmt = (el) => ({
      tag: el.tagName.toLowerCase(), id: el.id || null, class: typeof el.className === 'string' ? el.className.slice(0, 80) : null,
      type: el.type || null, name: el.getAttribute('name'), aria: el.getAttribute('aria-label'),
      text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 50),
      vis: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length),
    });
    const pick = (sel) => Array.from(document.querySelectorAll(sel)).map(fmt);
    return {
      url: location.href,
      inputs: pick('input, select, textarea').filter((x) => x.vis),
      buttons: pick('button').filter((x) => x.vis || x.type === 'submit'),
      links: pick('a').filter((x) => x.vis && /book|reserv|check|search|availab|select|continue|pay|add|cart|checkout/i.test((x.text || '') + (x.id || '') + (x.class || '') + (x.href || ''))),
      headings: pick('h1, h2').filter((x) => x.vis).slice(0, 6),
      iframes: pick('iframe'),
      formLabels: pick('label').filter((x) => x.vis).map((x) => x.text).slice(0, 30),
    };
  }).catch((e) => ({ error: e.message }));
  log(`--- ${label} ---  url=${dom.url}  inputs:${(dom.inputs||[]).length} buttons:${(dom.buttons||[]).length} links:${(dom.links||[]).length} iframes:${(dom.iframes||[]).length}`);
  if (fileKey) fs.writeFileSync(`/tmp/${fileKey}-${label.replace(/\W+/g,'_')}.json`, JSON.stringify(dom, null, 2));
  return dom;
}

async function explore(key) {
  const prop = PROPERTIES[key];
  const d = datesFixed();
  const deepLink = `${prop.base}/?checkin=${d.mmddyyyy.ci}&checkout=${d.mmddyyyy.co}&adults=2&kids=0`;
  log(`\n################ ${prop.name} (${key}) ################`);
  log(`deepLink: ${deepLink}`);

  const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'] });
  const ctx = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'en-US',
  });
  await ctx.route('**/*.{png,jpg,jpeg,webp,gif,svg,woff,woff2,ttf,mp4}', (r) => r.abort());
  const page = await ctx.newPage();

  const out = { propKey: key, name: prop.name, dates: d.iso, deepLink, steps: [], gotchas: [] };
  try {
    // 1. Goto deep link — Stayntouch should redirect to /search-results with the dates prefilled
    await page.goto(deepLink, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(3500);
    out.cookieDismissSelector = await dismissCookie(page);
    out.steps.push({ action: 'goto', selector: null, desc: 'deep link — prefilled dates', value: deepLink });

    // Did it redirect to /search-results?
    const url1 = page.url();
    log('post-deeplink url:', url1);
    const onSearch = /\/search-results/.test(url1);
    if (!onSearch) {
      // Click the hero "Book Now" CTA (the price/promo block) to submit search.
      // Verified v3: this navigates to /search-results?checkin=...&checkout=...&adults=...
      const heroMatchers = [
        '.hotel-price-book button:visible',
        '.hotel-pricemain-block button:visible',
        'button[aria-label="Book now"]:visible',
        'button[aria-label="Book Now"]:visible',
        'button:has-text("Book Now"):visible',
      ];
      let heroSel = null;
      for (const m of heroMatchers) {
        const loc = page.locator(m).first();
        if (await loc.isVisible({ timeout: 1200 }).catch(() => false)) { heroSel = m; break; }
      }
      log('hero Book Now selector:', heroSel);
      if (heroSel) {
        try { await page.locator(heroSel).first().click({ timeout: 3000 }); await sleep(5000); } catch (e) { log('hero err', e.message); }
        out.steps.push({ action: 'click', selector: heroSel, desc: 'hero Book Now — submits search to /search-results' });
        log('post-hero url:', page.url());
      } else {
        log('NO hero Book Now visible — flow will likely stall');
      }
    }
    await domSummary(page, 'search-results', key);
    fs.writeFileSync(`/tmp/${key}-searchresults.html`, await page.content());

    // 2. Click first available rate-card "Book Now" (inside .btn-book, NOT the filter Apply)
    log('\n=== pick first rate ===');
    const rateMatchers = [
      '.btn-book button.btn-pri-md:visible',         // verified in HTML
      '.btn-book button[aria-label="Book now"]:visible',
      '.btn-book button:visible',
      'button.btn-pri-md[aria-label="Book now"]:visible',
      '[class*="rate" i] button[aria-label="Book now"]:visible',
    ];
    let rateSel = null;
    for (const m of rateMatchers) {
      const loc = page.locator(m).first();
      if (await loc.isVisible({ timeout: 1000 }).catch(() => false)) { rateSel = m; break; }
    }
    log('rate selector:', rateSel);
    out.steps.push({ action: 'click', selector: rateSel, desc: 'first rate-card Book Now' });
    if (rateSel) {
      try { await page.locator(rateSel).first().click({ timeout: 3000 }); } catch (e) { log('rate click err', e.message); }
      await sleep(5000);
    }
    await domSummary(page, 'after-rate', key);
    fs.writeFileSync(`/tmp/${key}-afterrate.html`, await page.content());

    // 3. Possible intermediate "Add to Cart" / extras page
    const interMatchers = [
      'button:has-text("Add to Cart")',
      'button:has-text("Add to Stay")',
      'button:has-text("Continue")',
      'button:has-text("Proceed")',
      'a:has-text("Continue")',
      'button:has-text("Checkout")',
      'button:has-text("Review")',
    ];
    let interSel = null;
    for (const m of interMatchers) {
      const loc = page.locator(m).first();
      if (await loc.isVisible({ timeout: 800 }).catch(() => false)) { interSel = m; break; }
    }
    if (interSel) {
      out.steps.push({ action: 'click', selector: interSel, desc: 'intermediate continue (extras/cart)' });
      log('intermediate:', interSel);
      try { await page.locator(interSel).first().click({ timeout: 3000 }); } catch (e) { log('inter err', e.message); }
      await sleep(4500);
      await domSummary(page, 'after-inter', key);
      fs.writeFileSync(`/tmp/${key}-afterinter.html`, await page.content());
    }

    // 4. Guest details form
    log('\n=== guest form ===');
    const guestFilled = [];
    for (const [sel, val, kind] of [
      ['input[name*="first" i]:visible', 'Test', 'fill'],
      ['input[name*="last" i]:visible', 'Guest', 'fill'],
      ['input[type="email"]:visible', 'friction.test@example.com', 'fill'],
      ['input[name*="email" i]:visible', 'friction.test@example.com', 'fill'],
      ['input[type="tel"]:visible', '5555555555', 'fill'],
      ['input[name*="phone" i]:visible', '5555555555', 'fill'],
      ['select[name*="country" i]:visible', 'US', 'select'],
      ['select[id*="country" i]:visible', 'US', 'select'],
      ['input[name*="zip" i]:visible', '00000', 'fill'],
      ['input[name*="postal" i]:visible', '00000', 'fill'],
      ['input[name*="address" i]:visible', '1 Test St', 'fill'],
      ['input[name*="city" i]:visible', 'Testville', 'fill'],
      ['input[name*="state" i]:visible', 'CA', 'fill'],
    ]) {
      const loc = page.locator(sel).first();
      if (await loc.isVisible({ timeout: 300 }).catch(() => false)) {
        try { kind === 'select' ? await loc.selectOption(val).catch(() => {}) : await loc.fill(val).catch(() => {}); guestFilled.push(sel); } catch {}
      }
    }
    out.steps.push({ action: 'fill', selector: null, desc: 'guest form best-effort', value: guestFilled });
    log('guest filled:', guestFilled.length, guestFilled);

    await domSummary(page, 'after-guest-fill', key);

    // 5. Continue → payment
    log('\n=== continue to payment ===');
    const contMatchers = [
      'button:has-text("Continue to Payment")',
      'button:has-text("Proceed to Payment")',
      'button:has-text("Review Payment")',
      'button:has-text("Continue")',
      'button:has-text("Checkout")',
      'button:has-text("Pay Now")',
      'button:has-text("Review")',
      'button:has-text("Next")',
      'a:has-text("Continue")',
      'a:has-text("Checkout")',
      'input[type="submit"]:visible',
    ];
    let contSel = null;
    for (const m of contMatchers) {
      const loc = page.locator(m).first();
      if (await loc.isVisible({ timeout: 800 }).catch(() => false)) { contSel = m; break; }
    }
    out.steps.push({ action: 'click', selector: contSel, desc: 'continue to payment' });
    log('continue selector:', contSel);
    if (contSel) {
      try { await page.locator(contSel).first().click({ timeout: 3000 }); } catch (e) { log('cont err', e.message); }
      await sleep(6000);
    }
    await domSummary(page, 'after-continue', key);
    fs.writeFileSync(`/tmp/${key}-aftercontinue.html`, await page.content());

    // PAYMENT DETECTION
    log('\n=== PAYMENT DETECTION ===');
    const url = page.url();
    const paymentUrlRegex = /(\/checkouts?\/)|(\/checkout)|(\/?payment)|(\/book\/.*pay)|(\/reservation.*pay)|(\/pay($|\/))/i;
    const urlHit = paymentUrlRegex.test(url);
    const cardIframes = await page.$$eval('iframe', (fs) => fs.map((f) => ({ src: f.src, name: f.name, id: f.id, title: f.title }))).catch(() => []);
    const paymentCardIframes = cardIframes.filter((f) => /card|payment|stripe|spreedly|worldpay|authorize|cybersource|hps|securesubmit|tokenex|sagepay|adyen|braintree|vantiv|globalpay|moneris/i.test(JSON.stringify(f)));
    const cardInputVisible = await page.locator('input[name*="card" i]:visible, input[id*="card" i]:visible, input[autocomplete="cc-number"]:visible, input[name*="cc" i]:visible').first().isVisible({ timeout: 800 }).catch(() => false);
    const paymentHeadingVisible = await page.locator('h1:has-text("Payment"), h2:has-text("Payment"), h2:has-text("Billing"), [class*="payment" i]:visible').first().isVisible({ timeout: 800 }).catch(() => false);
    const recaptcha = {
      script: await page.locator('script[src*="recaptcha"]').count(),
      iframe: await page.locator('iframe[src*="recaptcha"], iframe[title*="reCAPTCHA" i]').count(),
      grecaptcha: await page.evaluate(() => typeof window.grecaptcha !== 'undefined').catch(() => false),
    };

    out.paymentReached = urlHit || cardInputVisible || paymentHeadingVisible || paymentCardIframes.length > 0;
    out.paymentIndicator = { urlHit, finalUrl: url, cardInputVisible, paymentHeadingVisible, paymentCardIframes };
    out.final = { url, iframes: cardIframes, recaptcha };
    log('PAYMENT DETECTION:', JSON.stringify(out.paymentIndicator));
    log('iframes:', JSON.stringify(cardIframes));
    log('recaptcha:', JSON.stringify(recaptcha));
    await page.screenshot({ path: `/tmp/${key}-final.png`, fullPage: false }).catch(() => {});

  } catch (e) {
    out.error = e.message; log('FATAL', e.message);
  } finally {
    fs.writeFileSync(`/tmp/${key}-result-v4.json`, JSON.stringify(out, null, 2));
    await browser.close();
  }
  return out;
}

const arg = process.argv[2] || 'americana';
if (arg === 'all') {
  (async () => {
    const R = {};
    for (const k of Object.keys(PROPERTIES)) R[k] = await explore(k);
    fs.writeFileSync('/tmp/stayntouch-all-v4.json', JSON.stringify(R, null, 2));
    log('\nALL DONE');
  })();
} else explore(arg);
