// Stayntouch IBE v7 — push to actual payment step.
// Fixes: vue-tel-input (.vti__input), Country autocomplete, then click enabled Next Step.
//
// Run: node src/explore-stayntouch-v7.js [propertyName|all]

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

const log = (...a) => console.log('[v7]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function dismissCookie(page) {
  const sels = ['#onetrust-accept-btn-handler', 'button:has-text("Accept All")', 'button:has-text("Accept")', '[class*="cookie" i] button'];
  for (const s of sels) {
    const el = page.locator(s).first();
    if (await el.isVisible({ timeout: 700 }).catch(() => false)) {
      try { await el.click({ timeout: 1500 }); return s; } catch {}
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
      inputs: pick('input, select, textarea'),
      buttons: pick('button').filter((x) => x.vis || x.type === 'submit'),
      headings: pick('h1, h2, h3, h4').filter((x) => x.vis).slice(0, 10),
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

async function vFill(page, sel, val) {
  const loc = page.locator(sel).first();
  if (await loc.isVisible({ timeout: 800 }).catch(() => false)) {
    try {
      await loc.click({ timeout: 1500 });
      await loc.fill('');
      await loc.pressSequentially(val, { delay: 25 });
      await loc.press('Tab');
      await sleep(250);
      return true;
    } catch (e) { log('  vFill err', sel, e.message.slice(0, 80)); }
  }
  return false;
}

async function nextStepEnabled(page) {
  return await page.locator('button:has-text("Next Step")').first().evaluate((el) => !el.disabled && !el.className.includes('disabled')).catch(() => false);
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

  const out = { propKey: key, name: prop.name, dates: d.iso, deepLink, steps: [] };
  try {
    // 1. Deep link
    await page.goto(deepLink, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(4500);
    out.cookieDismissSelector = await dismissCookie(page);
    out.steps.push({ action: 'goto', desc: 'deep link /search-results', value: deepLink });

    // 2. Rate card Book Now
    const rateSel = await clickFirst(page, ['.btn-book button.btn-pri-md:visible', '.btn-book button[aria-label="Book now"]:visible']);
    out.steps.push({ action: 'click', selector: rateSel, desc: 'rate Book Now → cart' });

    // 3. Checkout
    const coSel = await clickFirst(page, ['button[aria-label="Checkout"]:visible', 'button:has-text("Checkout"):visible']);
    out.steps.push({ action: 'click', selector: coSel, desc: 'cart Checkout → /checkout' });

    // 4. Continue Without Login
    const cwlSel = await clickFirst(page, ['button.changefields.guest-login:visible', 'button:has-text("Continue Without Login"):visible'], { timeout: 3000, waitAfter: 2500 });
    out.steps.push({ action: 'click', selector: cwlSel, desc: 'Continue Without Login' });

    // Wait for guest form
    await page.locator('input[aria-label="First Name"]').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    await sleep(1500);
    await domSummary(page, 'guest-form', key);

    // 5. Fill the form — verified selectors
    log('\n=== fill guest form ===');
    const filled = [];
    if (await vFill(page, 'input[aria-label="First Name"]', 'Test')) filled.push('First Name');
    if (await vFill(page, 'input[aria-label="Last Name"]', 'Guest')) filled.push('Last Name');
    if (await vFill(page, 'input[aria-label="Customer email"]', 'friction.test@example.com')) filled.push('email');
    // Telephone: vue-tel-input — type into .vti__input (the dial code is auto-US)
    if (await vFill(page, '.vti__input', '5555555555')) filled.push('telephone');
    if (await vFill(page, 'input[aria-label="Customer address"]', '1 Test St')) filled.push('address');
    if (await vFill(page, 'input[aria-label="City"]', 'Testville')) filled.push('City');
    if (await vFill(page, 'input[aria-label="ZipCode"]', '00000')) filled.push('ZipCode');

    // Country autocomplete — click, type, wait for dropdown, select
    let countryOk = false;
    try {
      const countryIn = page.locator('input[aria-label="Country"]').first();
      if (await countryIn.isVisible({ timeout: 800 }).catch(() => false)) {
        await countryIn.click({ timeout: 1500 });
        await sleep(400);
        await countryIn.fill('');
        await countryIn.pressSequentially('United States', { delay: 30 });
        await sleep(1200); // wait for autocomplete dropdown
        // Vuetify autocomplete dropdown items
        const itemMatchers = [
          '.v-list-item:visible >> text=United States',
          '[role="option"]:visible >> text=United States',
          '.v-autocomplete__content [role="listitem"]:visible',
          'div[role="listbox"] [role="option"]:visible',
        ];
        for (const m of itemMatchers) {
          const it = page.locator(m).first();
          if (await it.isVisible({ timeout: 800 }).catch(() => false)) {
            try { await it.click({ timeout: 2000 }); countryOk = true; filled.push('Country'); break; } catch {}
          }
        }
        if (!countryOk) {
          // press Down + Enter as fallback
          await countryIn.press('ArrowDown');
          await sleep(300);
          await countryIn.press('Enter');
          countryOk = true; filled.push('Country (via keyboard)');
        }
      }
    } catch (e) { log('country err', e.message.slice(0, 80)); }

    out.steps.push({ action: 'fill', desc: 'guest form', value: filled });
    log('filled:', filled);

    // Verify live values + check Next enabled
    const live = await page.evaluate(() => {
      const vals = {};
      document.querySelectorAll('input').forEach((i) => { const k = i.ariaLabel || i.id || i.name; if (k) vals[k] = i.value; });
      const errs = Array.from(document.querySelectorAll('.v-messages__message, .error--text')).map((e) => (e.innerText || '').trim()).filter(Boolean);
      return { vals, errs };
    }).catch(() => ({ vals: {}, errs: [] }));
    log('live vals:', JSON.stringify(live.vals));
    log('validation errs:', JSON.stringify(live.errs));
    out.guestFormLive = live;

    const enabled = await nextStepEnabled(page);
    log('Next Step enabled?', enabled);
    await page.screenshot({ path: `/tmp/${key}-v7-guestform.png`, fullPage: false }).catch(() => {});

    // 6. Click Next Step (enabled or not — try)
    log('\n=== click Next Step ===');
    let nextSel = null;
    if (enabled) {
      nextSel = await clickFirst(page, ['button:has-text("Next Step"):not([disabled])'], { timeout: 3000, waitAfter: 6000 });
    } else {
      // force-click disabled to see what happens, or try alternate
      nextSel = await clickFirst(page, ['button:has-text("Next Step")', 'button:has-text("NEXT STEP")'], { timeout: 2000, waitAfter: 4000 });
    }
    out.steps.push({ action: 'click', selector: nextSel, desc: 'Next Step' });
    await domSummary(page, 'after-next', key);
    fs.writeFileSync(`/tmp/${key}-v7-afternext.html`, await page.content());

    // PAYMENT DETECTION — broaden
    log('\n=== PAYMENT DETECTION ===');
    const url = page.url();
    const urlHit = /(\/checkouts?\/)|(\/checkout)|(\/?payment)|(\/pay)/i.test(url);
    const allIframes = await page.$$eval('iframe', (fs) => fs.map((f) => ({ src: f.src, name: f.name, id: f.id, title: f.title, class: f.className }))).catch(() => []);
    const cardIframes = allIframes.filter((f) => /card|payment|stripe|spreedly|worldpay|authorize|cybersource|hps|tokenex|sagepay|adyen|braintree|vantiv|globalpay|moneris|recurly|nmi|square|hosted/i.test(JSON.stringify(f)));
    const cardInputVisible = await page.locator('input[autocomplete*="cc" i]:visible, input[name*="card" i]:visible, input[id*="card" i]:visible, input[placeholder*="card" i]:visible, input[aria-label*="card" i]:visible').first().isVisible({ timeout: 1000 }).catch(() => false);
    const paymentHeadingVisible = await page.locator('h1:has-text("Payment"), h2:has-text("Payment"), h3:has-text("Payment"), h2:has-text("Billing"), [class*="payment" i]:visible').first().isVisible({ timeout: 1000 }).catch(() => false);
    const recaptcha = {
      script: await page.locator('script[src*="recaptcha"]').count(),
      iframe: await page.locator('iframe[src*="recaptcha"], iframe[title*="reCAPTCHA" i]').count(),
      grecaptcha: await page.evaluate(() => typeof window.grecaptcha !== 'undefined').catch(() => false),
    };
    out.paymentReached = urlHit || cardInputVisible || paymentHeadingVisible || cardIframes.length > 0;
    out.paymentIndicator = { urlHit, finalUrl: url, cardInputVisible, paymentHeadingVisible, cardIframes };
    out.final = { url, allIframes, recaptcha };
    log('PAYMENT DETECTION:', JSON.stringify(out.paymentIndicator));
    log('all iframes:', JSON.stringify(allIframes));
    log('recaptcha:', JSON.stringify(recaptcha));
    await page.screenshot({ path: `/tmp/${key}-v7-final.png`, fullPage: true }).catch(() => {});

  } catch (e) {
    out.error = e.message; log('FATAL', e.message);
  } finally {
    fs.writeFileSync(`/tmp/${key}-result-v7.json`, JSON.stringify(out, null, 2));
    await browser.close();
  }
  return out;
}

const arg = process.argv[2] || 'americana';
if (arg === 'all') {
  (async () => {
    const R = {};
    for (const k of Object.keys(PROPERTIES)) R[k] = await explore(k);
    fs.writeFileSync('/tmp/stayntouch-all-v7.json', JSON.stringify(R, null, 2));
    log('\nALL DONE');
  })();
} else explore(arg);
