// Stayntouch IBE v5 — VERIFIED FLOW:
//   1. /search-results?checkin=MM-DD-YYYY&checkout=MM-DD-YYYY&adults=N&kids=N  (DIRECT deep link!)
//   2. click .btn-book button.btn-pri-md  (rate "Book Now") → adds to cart, opens cart drawer
//   3. click button[aria-label="Checkout"] (or has-text "Checkout") → /reservation page
//   4. fill guest form
//   5. click Continue → payment
//
// Run: node src/explore-stayntouch-v5.js [propertyName|all]

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
    mmddyyyy: {
      ci: `${pad(ci.getMonth() + 1)}-${pad(ci.getDate())}-${ci.getFullYear()}`,
      co: `${pad(co.getMonth() + 1)}-${pad(co.getDate())}-${co.getFullYear()}`,
    },
  };
}

const log = (...a) => console.log('[v5]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function dismissCookie(page) {
  const sels = ['#onetrust-accept-btn-handler', '#truste-consent-button',
    'button:has-text("Accept All")', 'button:has-text("Accept all")', 'button:has-text("Accept")',
    'button:has-text("Got it")', '[class*="cookie" i] button', '[id*="cookie" i] button'];
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
    };
  }).catch((e) => ({ error: e.message }));
  log(`--- ${label} ---  url=${dom.url}  inputs:${(dom.inputs||[]).length} buttons:${(dom.buttons||[]).length} links:${(dom.links||[]).length} iframes:${(dom.iframes||[]).length}`);
  if (fileKey) fs.writeFileSync(`/tmp/${fileKey}-${label.replace(/\W+/g,'_')}.json`, JSON.stringify(dom, null, 2));
  return dom;
}

async function clickFirst(page, matchers, { timeout = 2500, waitAfter = 4000 } = {}) {
  for (const m of matchers) {
    const loc = page.locator(m).first();
    if (await loc.isVisible({ timeout: 900 }).catch(() => false)) {
      try { await loc.click({ timeout }); await sleep(waitAfter); return m; }
      catch (e) { log('  click err', m, e.message.slice(0, 80)); }
    }
  }
  return null;
}

async function explore(key) {
  const prop = PROPERTIES[key];
  const d = datesFixed();
  // DIRECT deep link to /search-results — bypasses calendar entirely
  const deepLink = `${prop.base}/search-results?checkin=${d.mmddyyyy.ci}&checkout=${d.mmddyyyy.co}&adults=2&kids=0`;
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
    // 1. Deep link to /search-results
    await page.goto(deepLink, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(4500);
    out.cookieDismissSelector = await dismissCookie(page);
    out.steps.push({ action: 'goto', selector: null, desc: 'direct deep link to /search-results (skip calendar)', value: deepLink });
    log('post-deeplink url:', page.url());
    await domSummary(page, 'search-results', key);
    fs.writeFileSync(`/tmp/${key}-v5-search.html`, await page.content());

    // Verify the dates stuck (not reset to defaults)
    const urlHasOurDates = page.url().includes(d.mmddyyyy.ci) && page.url().includes(d.mmddyyyy.co);
    out.deepLinkWorked = urlHasOurDates;
    log('deep-link dates preserved in URL:', urlHasOurDates);

    // 2. Click first rate "Book Now" (.btn-book button.btn-pri-md) → adds to cart
    log('\n=== STEP 2: pick first rate ===');
    const rateSel = await clickFirst(page, [
      '.btn-book button.btn-pri-md:visible',
      '.btn-book button[aria-label="Book now"]:visible',
      '.btn-book button:visible',
    ]);
    out.steps.push({ action: 'click', selector: rateSel, desc: 'first rate-card Book Now → adds to cart' });
    log('rate selector:', rateSel);
    await domSummary(page, 'after-rate', key);

    // 3. Click "Checkout" (cart drawer CTA) → /reservation page
    log('\n=== STEP 3: checkout ===');
    const checkoutSel = await clickFirst(page, [
      'button[aria-label="Checkout"]:visible',
      'button.btn-pri-md[aria-label="Checkout"]:visible',
      'button:has-text("Checkout"):visible',
      'button:has-text("Continue to Checkout"):visible',
    ]);
    out.steps.push({ action: 'click', selector: checkoutSel, desc: 'cart Checkout → reservation page' });
    log('checkout selector:', checkoutSel);
    await domSummary(page, 'after-checkout', key);
    fs.writeFileSync(`/tmp/${key}-v5-reservation.html`, await page.content());

    // 4. Fill guest form
    log('\n=== STEP 4: guest form ===');
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
      ['input[name*="card" i]:visible', '', 'skip'], // don't fill payment fields yet
    ]) {
      if (kind === 'skip') continue;
      const loc = page.locator(sel).first();
      if (await loc.isVisible({ timeout: 300 }).catch(() => false)) {
        try { kind === 'select' ? await loc.selectOption(val).catch(() => {}) : await loc.fill(val).catch(() => {}); guestFilled.push(sel); } catch {}
      }
    }
    out.steps.push({ action: 'fill', selector: null, desc: 'guest form best-effort', value: guestFilled });
    log('guest filled:', guestFilled.length, guestFilled);
    await domSummary(page, 'after-guest', key);

    // 5. Continue → payment
    log('\n=== STEP 5: continue to payment ===');
    const contSel = await clickFirst(page, [
      'button:has-text("Continue to Payment")',
      'button:has-text("Proceed to Payment")',
      'button:has-text("Continue")',
      'button:has-text("Next")',
      'button:has-text("Review")',
      'a:has-text("Continue")',
    ]);
    out.steps.push({ action: 'click', selector: contSel, desc: 'continue to payment' });
    log('continue selector:', contSel);
    await domSummary(page, 'after-continue', key);
    fs.writeFileSync(`/tmp/${key}-v5-payment.html`, await page.content());

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
    await page.screenshot({ path: `/tmp/${key}-v5-final.png`, fullPage: false }).catch(() => {});

  } catch (e) {
    out.error = e.message; log('FATAL', e.message);
  } finally {
    fs.writeFileSync(`/tmp/${key}-result-v5.json`, JSON.stringify(out, null, 2));
    await browser.close();
  }
  return out;
}

const arg = process.argv[2] || 'americana';
if (arg === 'all') {
  (async () => {
    const R = {};
    for (const k of Object.keys(PROPERTIES)) R[k] = await explore(k);
    fs.writeFileSync('/tmp/stayntouch-all-v5.json', JSON.stringify(R, null, 2));
    log('\nALL DONE');
  })();
} else explore(arg);
