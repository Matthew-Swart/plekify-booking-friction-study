// Stayntouch IBE v6 — VERIFIED SELECTORS for the /checkout guest form.
//   Inputs have aria-labels: "First Name", "Last Name", "Customer email",
//   "Customer address", "City", "Country", "ZipCode", and #telephone (tel input).
//   "Next Step" button is disabled until required fields are valid.
//
// Run: node src/explore-stayntouch-v6.js [propertyName|all]

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

const log = (...a) => console.log('[v6]', ...a);
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
      text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60),
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
  log(`--- ${label} ---  url=${dom.url}  inputs:${(dom.inputs||[]).length} buttons:${(dom.buttons||[]).length} iframes:${(dom.iframes||[]).length}`);
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

// Vue Vuetify inputs: type into the visible input then press Tab (forces blur+validation)
async function vFill(page, sel, val) {
  const loc = page.locator(sel).first();
  if (await loc.isVisible({ timeout: 600 }).catch(() => false)) {
    try {
      await loc.click({ timeout: 1500 });
      await loc.fill('');
      await loc.pressSequentially(val, { delay: 25 });
      await loc.press('Tab'); // force blur + Vuetify validation
      await sleep(250);
      return true;
    } catch (e) { log('  vFill err', sel, e.message.slice(0, 80)); }
  }
  return false;
}

async function explore(key) {
  const prop = PROPERTIES[key];
  const d = datesFixed();
  const deepLink = `${prop.base}/search-results?checkin=${d.mmddyyyy.ci}&checkout=${d.mmddyyyy.co}&adults=2&kids=0`;
  log(`\n################ ${prop.name} (${key}) ################`);

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
    out.steps.push({ action: 'goto', selector: null, desc: 'direct deep link to /search-results', value: deepLink });
    log('post-deeplink url:', page.url());

    // 2. Rate card "Book Now"
    log('\n=== pick first rate ===');
    const rateSel = await clickFirst(page, [
      '.btn-book button.btn-pri-md:visible',
      '.btn-book button[aria-label="Book now"]:visible',
    ]);
    out.steps.push({ action: 'click', selector: rateSel, desc: 'rate-card Book Now → cart' });

    // 3. Checkout
    log('\n=== checkout ===');
    const checkoutSel = await clickFirst(page, [
      'button[aria-label="Checkout"]:visible',
      'button.btn-pri-md[aria-label="Checkout"]:visible',
      'button:has-text("Checkout"):visible',
    ]);
    out.steps.push({ action: 'click', selector: checkoutSel, desc: 'cart Checkout → /checkout guest form' });
    // /checkout initially shows a LOGIN wall. Click "Continue Without Login" to reveal the guest form.
    log('\n=== bypass login wall ===');
    const continueNoLogin = await clickFirst(page, [
      'button.changefields.guest-login:visible',
      'button:has-text("Continue Without Login"):visible',
      'a:has-text("Continue Without Login"):visible',
    ], { timeout: 3000, waitAfter: 2500 });
    out.steps.push({ action: 'click', selector: continueNoLogin, desc: 'Continue Without Login → reveals guest form' });
    log('continue-without-login selector:', continueNoLogin);

    // WAIT for the guest form to render
    log('waiting for guest form to render...');
    await page.locator('input[aria-label="First Name"]').first().waitFor({ state: 'visible', timeout: 15000 }).catch((e) => log('form wait err', e.message.slice(0, 80)));
    await sleep(1200);
    await domSummary(page, 'checkout-page', key);

    // 4. Fill Vue guest form by aria-label (verified selectors)
    log('\n=== fill guest form (Vue, aria-label selectors) ===');
    const fields = [
      ['input[aria-label="First Name"]', 'Test'],
      ['input[aria-label="Last Name"]', 'Guest'],
      ['input[aria-label="Customer email"]', 'friction.test@example.com'],
      ['#telephone', '5555555555'],
      ['input[aria-label="Customer address"]', '1 Test St'],
      ['input[aria-label="City"]', 'Testville'],
      ['input[aria-label="ZipCode"]', '00000'],
    ];
    const filled = [];
    for (const [sel, val] of fields) {
      if (await vFill(page, sel, val)) filled.push(sel);
    }
    // Country is a Vue combobox/autocomplete. Try clicking then selecting.
    let countryFilled = null;
    try {
      const countryInput = page.locator('input[aria-label="Country"]').first();
      if (await countryInput.isVisible({ timeout: 700 }).catch(() => false)) {
        await countryInput.click({ timeout: 1500 });
        await sleep(500);
        // Type to filter
        await countryInput.type('United States', { delay: 30 });
        await sleep(800);
        // Click first dropdown item
        const item = page.locator('.v-list-item:visible, [role="option"]:visible, [role="listitem"]:visible').first();
        if (await item.isVisible({ timeout: 1200 }).catch(() => false)) {
          await item.click({ timeout: 2000 });
          countryFilled = 'input[aria-label="Country"] → .v-list-item';
          filled.push('input[aria-label="Country"]');
        } else {
          // Maybe it's a native select under a label
          const sel2 = page.locator('select').first();
          if (await sel2.isVisible({ timeout: 500 }).catch(() => false)) {
            await sel2.selectOption({ label: 'United States' }).catch(() => {});
            countryFilled = 'select[label=US]';
            filled.push('select country');
          }
        }
      }
    } catch (e) { log('  country err', e.message.slice(0, 80)); }
    out.steps.push({ action: 'fill', selector: null, desc: 'Vue guest form by aria-label', value: filled });
    log('filled:', filled.length, filled, 'country:', countryFilled);

    // Check if "Next Step" is now enabled + dump any Vuetify validation errors
    const nextDisabled = await page.locator('button:has-text("Next Step"), button:has-text("NEXT STEP")').first().evaluate((el) => el.disabled || el.className.includes('disabled')).catch(() => null);
    log('Next Step disabled?', nextDisabled);
    // Dump validation errors and field values from the live DOM
    const liveState = await page.evaluate(() => {
      const errs = Array.from(document.querySelectorAll('.v-messages__message, .error--text, .v-field--error'))
        .map((e) => (e.innerText || e.textContent || '').trim()).filter(Boolean);
      const vals = {};
      document.querySelectorAll('input').forEach((i) => { if (i.ariaLabel || i.id) vals[i.ariaLabel || i.id] = i.value; });
      return { errs, vals };
    }).catch(() => ({ errs: [], vals: {} }));
    log('validation errors:', JSON.stringify(liveState.errs));
    log('live field values:', JSON.stringify(liveState.vals));
    out.guestFormState = liveState;
    await page.screenshot({ path: `/tmp/${key}-v6-guestform.png`, fullPage: false }).catch(() => {});
    await domSummary(page, 'after-guest-fill', key);

    // 5. Click Next Step / Continue
    log('\n=== click Next Step ===');
    const nextSel = await clickFirst(page, [
      'button:has-text("Next Step"):not([disabled])',
      'button:has-text("NEXT STEP"):not([disabled])',
      'button:has-text("Continue to Payment")',
      'button:has-text("Continue")',
      'button:has-text("Next")',
    ]);
    out.steps.push({ action: 'click', selector: nextSel, desc: 'Next Step → payment section' });
    log('next selector:', nextSel);
    await sleep(6000);
    await domSummary(page, 'after-next-step', key);
    fs.writeFileSync(`/tmp/${key}-v6-afternext.html`, await page.content());

    // The payment section may be a *part* of the same /checkout page (multi-step)
    // Look for card iframe / payment fields now
    log('\n=== PAYMENT DETECTION ===');
    const url = page.url();
    const paymentUrlRegex = /(\/checkouts?\/)|(\/checkout)|(\/?payment)|(\/book\/.*pay)|(\/reservation.*pay)|(\/pay($|\/))/i;
    const urlHit = paymentUrlRegex.test(url);
    const cardIframes = await page.$$eval('iframe', (fs) => fs.map((f) => ({ src: f.src, name: f.name, id: f.id, title: f.title }))).catch(() => []);
    const paymentCardIframes = cardIframes.filter((f) => /card|payment|stripe|spreedly|worldpay|authorize|cybersource|hps|securesubmit|tokenex|sagepay|adyen|braintree|vantiv|globalpay|moneris|recurly|iats|nmi|square/i.test(JSON.stringify(f)));
    const cardInputVisible = await page.locator('input[name*="card" i]:visible, input[id*="card" i]:visible, input[autocomplete*="cc" i]:visible, input[name*="cc" i]:visible, input[placeholder*="card" i]:visible, input[placeholder*="Card" i]:visible').first().isVisible({ timeout: 800 }).catch(() => false);
    const paymentHeadingVisible = await page.locator('h1:has-text("Payment"), h2:has-text("Payment"), h2:has-text("Billing"), h3:has-text("Payment"), [class*="payment" i]:visible').first().isVisible({ timeout: 800 }).catch(() => false);
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
    await page.screenshot({ path: `/tmp/${key}-v6-final.png`, fullPage: true }).catch(() => {});

  } catch (e) {
    out.error = e.message; log('FATAL', e.message);
  } finally {
    fs.writeFileSync(`/tmp/${key}-result-v6.json`, JSON.stringify(out, null, 2));
    await browser.close();
  }
  return out;
}

const arg = process.argv[2] || 'americana';
if (arg === 'all') {
  (async () => {
    const R = {};
    for (const k of Object.keys(PROPERTIES)) R[k] = await explore(k);
    fs.writeFileSync('/tmp/stayntouch-all-v6.json', JSON.stringify(R, null, 2));
    log('\nALL DONE');
  })();
} else explore(arg);
