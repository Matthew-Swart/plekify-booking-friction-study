// v10 — final: select exact "United States" from Country dropdown, re-fill tel after.
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'node:fs';
chromium.use(StealthPlugin());

const log = (...a) => console.log('[v10]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BASE = 'https://americanamotorhotel.ibe.stayntouch.com';
const pad = (n) => String(n).padStart(2, '0');
const ci = new Date(); ci.setDate(ci.getDate() + 45);
const co = new Date(); co.setDate(co.getDate() + 47);
const DEEPLINK = `${BASE}/search-results?checkin=${pad(ci.getMonth()+1)}-${pad(ci.getDate())}-${ci.getFullYear()}&checkout=${pad(co.getMonth()+1)}-${pad(co.getDate())}-${co.getFullYear()}&adults=2&kids=0`;

const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'en-US',
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' });
await ctx.route('**/*.{png,jpg,jpeg,webp,gif,svg,woff,woff2,ttf,mp4}', (r) => r.abort());
const page = await ctx.newPage();

const out = { deepLink: DEEPLINK, steps: [] };
try {
  await page.goto(DEEPLINK, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(4500);
  out.steps.push('goto search-results');

  await page.locator('.btn-book button.btn-pri-md:visible').first().click({ timeout: 3000 });
  await sleep(4500);
  await page.locator('button[aria-label="Checkout"]:visible').first().click({ timeout: 3000 });
  await sleep(4500);
  await page.locator('button.changefields.guest-login:visible').first().click({ timeout: 3000 }).catch(() => {});
  await sleep(2500);
  await page.locator('input[aria-label="First Name"]').first().waitFor({ state: 'visible', timeout: 15000 });
  await sleep(2000);

  async function visFill(sel, val) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible({ timeout: 1000 }).catch(() => false)) {
      try { await loc.click({ timeout: 1500 }); await loc.fill(val); await loc.press('Tab'); await sleep(300); return true; } catch (e) { log('err', sel, e.message.slice(0,50)); }
    }
    return false;
  }

  // Fill text fields
  await visFill('input[aria-label="First Name"]', 'Test');
  await visFill('input[aria-label="Last Name"]', 'Guest');
  await visFill('input[aria-label="Customer email"]', 'friction.test@example.com');
  await visFill('input[aria-label="Customer address"]', '1 Test St');
  await visFill('input[aria-label="City"]', 'Testville');
  await visFill('input[aria-label="ZipCode"]', '00000');

  // Country: input id=input-v-24 (or input[aria-label="Country"]). Click → type "United States" → click EXACT option.
  log('selecting Country...');
  const countryIn = page.locator('input[aria-label="Country"]').first();
  await countryIn.click({ timeout: 2000 });
  await sleep(700);
  await countryIn.fill('United States');
  await sleep(1500);
  // The filtered list showed: "United States Virgin Islands", "United States", "United States of America"
  // Click the EXACT "United States" option (not Virgin Islands)
  const exactOpt = page.locator('[role="option"]:visible, .v-list-item:visible').filter({ hasText: /^United States$/ }).first();
  if (await exactOpt.isVisible({ timeout: 1500 }).catch(() => false)) {
    await exactOpt.click({ timeout: 2000 });
    log('clicked exact "United States" option');
  } else {
    log('exact option not found — listing options:');
    const opts = await page.evaluate(() => Array.from(document.querySelectorAll('[role="option"], .v-list-item')).filter((e) => { const r = e.getBoundingClientRect(); return r.width>0 && r.height>0; }).slice(0,10).map((e) => (e.innerText||'').trim()));
    log('options:', JSON.stringify(opts));
  }
  await sleep(800);

  // Telephone — NOW fill it (after Country, to avoid re-render clearing it)
  log('filling telephone...');
  const tel = page.locator('input.vti__input[tabindex="0"]').first();
  await tel.click({ timeout: 2000 });
  await page.keyboard.type('5555555555', { delay: 30 });
  await page.keyboard.press('Tab');
  await sleep(500);

  // Live check
  const live = await page.evaluate(() => {
    const vals = {};
    document.querySelectorAll('input').forEach((i) => { const k = i.ariaLabel || i.id; if (k) vals[k] = i.value; });
    const errs = Array.from(document.querySelectorAll('.v-messages__message, .error--text')).map((e) => (e.innerText||'').trim()).filter(Boolean);
    return { vals, errs };
  });
  log('live:', JSON.stringify(live));
  const enabled = await page.locator('button:has-text("Next Step")').first().evaluate((el) => !el.disabled && !/disabled/i.test(el.className)).catch(() => false);
  log('Next enabled?', enabled);
  await page.screenshot({ path: '/tmp/v10-guestform.png', fullPage: false });

  if (enabled) {
    log('clicking Next Step...');
    await page.locator('button:has-text("Next Step")').first().click({ timeout: 3000 });
    await sleep(7000);
    log('url after Next:', page.url());
    const ps = await page.evaluate(() => ({
      url: location.href,
      headings: Array.from(document.querySelectorAll('h1,h2,h3,h4')).filter((e) => e.offsetWidth).map((e) => (e.innerText||'').trim()),
      cardInputs: Array.from(document.querySelectorAll('input')).filter((i) => i.offsetWidth && /card|cc|cvc|cvv|expir|exp-|exp_|payment|account number|security code/i.test((i.name||'')+(i.id||'')+(i.autocomplete||'')+(i.ariaLabel||'')+(i.placeholder||''))).map((i)=>({id:i.id,name:i.name,aria:i.ariaLabel,ac:i.autocomplete,ph:i.placeholder})),
      allInputs: Array.from(document.querySelectorAll('input')).filter((i)=>i.offsetWidth).map((i)=>({id:i.id,name:i.name,aria:i.ariaLabel,ac:i.autocomplete,type:i.type,ph:i.placeholder})),
      iframes: Array.from(document.querySelectorAll('iframe')).map((f)=>({src:f.src,name:f.name,title:f.title,id:f.id,class:f.className.slice(0,60)})),
      recaptcha: { script: document.querySelectorAll('script[src*="recaptcha"]').length, iframe: document.querySelectorAll('iframe[src*="recaptcha"]').length, grecaptcha: typeof window.grecaptcha !== 'undefined' },
    }));
    log('PAYMENT STEP STATE:', JSON.stringify(ps, null, 2));
    out.paymentStep = ps;
    out.paymentReached = /\/checkout|payment/i.test(ps.url) && (ps.cardInputs.length > 0 || /payment|billing|card|pay/i.test(JSON.stringify(ps.headings)) || ps.iframes.some((f)=>/card|payment|stripe|spreedly|worldpay|authorize|cybersource|adyen|braintree/i.test(JSON.stringify(f))));
    await page.screenshot({ path: '/tmp/v10-payment.png', fullPage: true });
  } else {
    out.paymentReached = false;
    out.blocker = 'Next Step disabled — telephone or Country field not satisfying Vuetify validation';
  }
  out.finalUrl = page.url();
} catch (e) { out.error = e.message; log('FATAL', e.message, e.stack); }
finally {
  fs.writeFileSync('/tmp/v10-result.json', JSON.stringify(out, null, 2));
  await browser.close();
}
log('DONE — paymentReached:', out.paymentReached);
