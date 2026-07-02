// Stayntouch IBE v8 — surgical: enable the Next Step button to reach payment step.
// Fixes: target the VISIBLE vue-tel-input (tabindex=0), dispatch native input events
// for Vuetify reactivity, properly select Country autocomplete.
//
// Run: node src/explore-stayntouch-v8.js [propertyName|all]

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

const log = (...a) => console.log('[v8]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function dismissCookie(page) {
  for (const s of ['#onetrust-accept-btn-handler', 'button:has-text("Accept All")', '[class*="cookie" i] button']) {
    const el = page.locator(s).first();
    if (await el.isVisible({ timeout: 700 }).catch(() => false)) {
      try { await el.click({ timeout: 1500 }); return s; } catch {}
    }
  }
  return null;
}

async function clickFirst(page, matchers, { timeout = 2500, waitAfter = 4000 } = {}) {
  for (const m of matchers) {
    const loc = page.locator(m).first();
    if (await loc.isVisible({ timeout: 900 }).catch(() => false)) {
      try { await loc.click({ timeout }); await sleep(waitAfter); return m; }
      catch (e) { log('  click err', m, e.message.slice(0, 60)); }
    }
  }
  return null;
}

// Vuetify-aware fill: focus, set value natively, fire input + change + blur events.
async function vueFill(page, sel, val) {
  const loc = page.locator(sel).first();
  if (!(await loc.isVisible({ timeout: 800 }).catch(() => false))) return false;
  try {
    await loc.click({ timeout: 1500 });
    await loc.evaluate((el, v) => {
      const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value')?.set;
      setter ? setter.call(el, v) : (el.value = v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, val);
    await sleep(150);
    await loc.evaluate((el) => el.dispatchEvent(new Event('blur', { bubbles: true })));
    await sleep(250);
    return true;
  } catch (e) { log('  vueFill err', sel, e.message.slice(0, 60)); return false; }
}

async function nextEnabled(page) {
  return await page.locator('button:has-text("Next Step")').first().evaluate((el) => !el.disabled && !/disabled/i.test(el.className)).catch(() => false);
}

async function explore(key) {
  const prop = PROPERTIES[key];
  const d = datesFixed();
  const deepLink = `${prop.base}/search-results?checkin=${d.mmddyyyy.ci}&checkout=${d.mmddyyyy.co}&adults=2&kids=0`;
  log(`\n################ ${prop.name} ################`);

  const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'en-US',
  });
  await ctx.route('**/*.{png,jpg,jpeg,webp,gif,svg,woff,woff2,ttf,mp4}', (r) => r.abort());
  const page = await ctx.newPage();

  const out = { propKey: key, deepLink, steps: [] };
  try {
    await page.goto(deepLink, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(4500);
    await dismissCookie(page);
    out.steps.push({ action: 'goto', value: deepLink });

    await clickFirst(page, ['.btn-book button.btn-pri-md:visible']);
    out.steps.push({ action: 'click', desc: 'rate Book Now' });
    await clickFirst(page, ['button[aria-label="Checkout"]:visible']);
    out.steps.push({ action: 'click', desc: 'Checkout' });
    await clickFirst(page, ['button.changefields.guest-login:visible'], { timeout: 3000, waitAfter: 2500 });
    out.steps.push({ action: 'click', desc: 'Continue Without Login' });

    await page.locator('input[aria-label="First Name"]').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    await sleep(1500);

    // Fill guest fields with native event dispatch
    log('filling guest form...');
    const filled = [];
    if (await vueFill(page, 'input[aria-label="First Name"]', 'Test')) filled.push('First');
    if (await vueFill(page, 'input[aria-label="Last Name"]', 'Guest')) filled.push('Last');
    if (await vueFill(page, 'input[aria-label="Customer email"]', 'friction.test@example.com')) filled.push('email');
    // telephone: the VISIBLE vue-tel-input (tabindex=0)
    if (await vueFill(page, 'input.vti__input[tabindex="0"]', '5555555555')) filled.push('tel');
    if (await vueFill(page, 'input[aria-label="Customer address"]', '1 Test St')) filled.push('addr');
    if (await vueFill(page, 'input[aria-label="City"]', 'Testville')) filled.push('city');
    if (await vueFill(page, 'input[aria-label="ZipCode"]', '00000')) filled.push('zip');

    // Country: Vuetify v-autocomplete
    let countryOk = false;
    try {
      const countryIn = page.locator('input[aria-label="Country"]').first();
      if (await countryIn.isVisible({ timeout: 800 }).catch(() => false)) {
        await countryIn.click({ timeout: 1500 });
        await sleep(400);
        await countryIn.fill('');
        await countryIn.pressSequentially('United States', { delay: 30 });
        await sleep(1500);
        // Try multiple dropdown selectors
        for (const m of [
          '.v-autocomplete__content [role="option"]:visible >> text=United States',
          '[role="listbox"] [role="option"]:visible >> text=United States',
          '.v-list-item:visible >> text=United States',
          'div.v-list-item-title:visible >> text=United States',
        ]) {
          const it = page.locator(m).first();
          if (await it.isVisible({ timeout: 600 }).catch(() => false)) {
            try { await it.click({ timeout: 2000 }); countryOk = true; filled.push('Country'); break; } catch {}
          }
        }
        if (!countryOk) {
          await countryIn.press('ArrowDown'); await sleep(300);
          await countryIn.press('Enter'); await sleep(400);
          countryOk = true; filled.push('Country(kbd)');
        }
      }
    } catch (e) { log('country err', e.message.slice(0, 60)); }

    out.steps.push({ action: 'fill', value: filled });
    log('filled:', filled);

    // Also fill any visible traveller-form fields that may be required
    // (each room has a traveller form; main travellerLocation_0 etc.)
    const travFields = await page.locator('.traveller-form-block input:visible').all().catch(() => []);
    log('traveller-form fields visible:', travFields.length);
    // Don't aggressively fill traveller forms — they may not be required for Next.

    const live = await page.evaluate(() => {
      const vals = {};
      document.querySelectorAll('input').forEach((i) => { const k = i.ariaLabel || i.id; if (k) vals[k] = i.value; });
      const errs = Array.from(document.querySelectorAll('.v-messages__message, .error--text')).map((e) => (e.innerText || '').trim()).filter(Boolean);
      return { vals, errs };
    }).catch(() => ({}));
    log('live:', JSON.stringify(live));
    out.guestFormLive = live;
    const enabled = await nextEnabled(page);
    log('Next enabled?', enabled);

    // If still disabled, try forcing validation by clicking a non-button area then re-checking
    if (!enabled) {
      log('Next still disabled — attempting to trigger validation...');
      // Click somewhere to blur everything
      await page.locator('h1').first().click().catch(() => {});
      await sleep(1000);
      // Re-fill tel with keyboard as a last resort
      const tel = page.locator('input.vti__input[tabindex="0"]').first();
      await tel.click({ timeout: 1500 }).catch(() => {});
      await tel.pressSequentially('5555555555', { delay: 30 }).catch(() => {});
      await tel.press('Tab').catch(() => {});
      await sleep(800);
      log('Next enabled after tel retry?', await nextEnabled(page));
    }
    await page.screenshot({ path: `/tmp/${key}-v8-guestform.png`, fullPage: false }).catch(() => {});

    // Click Next Step
    const nextSel = await clickFirst(page, [
      'button:has-text("Next Step"):not([disabled])',
      'button:has-text("Next Step")',
    ], { timeout: 3000, waitAfter: 6000 });
    out.steps.push({ action: 'click', selector: nextSel, desc: 'Next Step' });
    log('next sel:', nextSel, 'url after:', page.url());

    // Dump final state
    const finalDom = await page.evaluate(() => {
      const fmt = (el) => ({ tag: el.tagName.toLowerCase(), id: el.id, aria: el.getAttribute('aria-label'), name: el.getAttribute('name'),
        type: el.type, text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 50),
        vis: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) });
      return {
        url: location.href,
        headings: Array.from(document.querySelectorAll('h1,h2,h3,h4')).filter((e) => e.offsetWidth).map((e) => (e.innerText || '').trim().slice(0, 60)),
        inputs: Array.from(document.querySelectorAll('input')).filter((i) => i.offsetWidth).map(fmt),
        iframes: Array.from(document.querySelectorAll('iframe')).map((f) => ({ src: f.src, name: f.name, id: f.id, title: f.title })),
        buttons: Array.from(document.querySelectorAll('button')).filter((b) => b.offsetWidth).map(fmt).slice(0, 20),
        recaptchaScript: document.querySelectorAll('script[src*="recaptcha"]').length,
        recaptchaIframe: document.querySelectorAll('iframe[src*="recaptcha"]').length,
        grecaptcha: typeof window.grecaptcha !== 'undefined',
      };
    }).catch((e) => ({ error: e.message }));
    fs.writeFileSync(`/tmp/${key}-v8-final.json`, JSON.stringify(finalDom, null, 2));
    log('FINAL url:', finalDom.url);
    log('FINAL headings:', JSON.stringify(finalDom.headings));
    log('FINAL inputs:', finalDom.inputs?.length);
    log('FINAL iframes:', JSON.stringify(finalDom.iframes));

    const cardIframes = (finalDom.iframes || []).filter((f) => /card|payment|stripe|spreedly|worldpay|authorize|cybersource|hps|tokenex|sagepay|adyen|braintree|vantiv|globalpay|moneris|recurly|nmi|square|hosted/i.test(JSON.stringify(f)));
    const cardInput = (finalDom.inputs || []).find((i) => /card|cc|payment/i.test((i.name || '') + (i.id || '') + (i.aria || '') + (i.type || '')));
    out.paymentReached = /\/checkout|\/payment|\/pay/i.test(finalDom.url || '') && (!!cardInput || cardIframes.length > 0 || /payment|billing|card/i.test(JSON.stringify(finalDom.headings)));
    out.paymentStep = {
      url: finalDom.url,
      headings: finalDom.headings,
      cardInput: cardInput || null,
      cardIframes,
      allIframes: finalDom.iframes,
      recaptcha: { script: finalDom.recaptchaScript, iframe: finalDom.recaptchaIframe, grecaptcha: finalDom.grecaptcha },
    };
    log('PAYMENT REACHED:', out.paymentReached);
    log('cardInput:', JSON.stringify(cardInput));
    log('cardIframes:', JSON.stringify(cardIframes));
    await page.screenshot({ path: `/tmp/${key}-v8-final.png`, fullPage: true }).catch(() => {});

  } catch (e) {
    out.error = e.message; log('FATAL', e.message);
  } finally {
    fs.writeFileSync(`/tmp/${key}-result-v8.json`, JSON.stringify(out, null, 2));
    await browser.close();
  }
  return out;
}

const arg = process.argv[2] || 'americana';
if (arg === 'all') {
  (async () => {
    const R = {};
    for (const k of Object.keys(PROPERTIES)) R[k] = await explore(k);
    fs.writeFileSync('/tmp/stayntouch-all-v8.json', JSON.stringify(R, null, 2));
    log('\nALL DONE');
  })();
} else explore(arg);
