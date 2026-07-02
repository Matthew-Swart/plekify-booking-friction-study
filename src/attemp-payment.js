// v11 — final-final: no .fill(''), just click+type. Click "Proceed To Payment" (the real submit).
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'node:fs';
chromium.use(StealthPlugin());

const log = (...a) => console.log('[v11]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BASE = process.argv[2] || 'https://americanamotorhotel.ibe.stayntouch.com';
const pad = (n) => String(n).padStart(2, '0');
const ci = new Date(); ci.setDate(ci.getDate() + 45);
const co = new Date(); co.setDate(co.getDate() + 47);
const DEEPLINK = `${BASE}/search-results?checkin=${pad(ci.getMonth()+1)}-${pad(ci.getDate())}-${ci.getFullYear()}&checkout=${pad(co.getMonth()+1)}-${pad(co.getDate())}-${co.getFullYear()}&adults=2&kids=0`;

const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'en-US',
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' });
await ctx.route('**/*.{png,jpg,jpeg,webp,gif,svg,woff,woff2,ttf,mp4}', (r) => r.abort());
const page = await ctx.newPage();

const out = { deepLink: DEEPLINK, base: BASE };
try {
  await page.goto(DEEPLINK, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(4500);

  // search → rate → checkout → continue-without-login
  await page.locator('.btn-book button.btn-pri-md:visible').first().click({ timeout: 3000 });
  await sleep(4500);
  await page.locator('button[aria-label="Checkout"]:visible').first().click({ timeout: 3000 });
  await sleep(4500);
  await page.locator('button.changefields.guest-login:visible').first().click({ timeout: 3000 }).catch(() => {});
  await sleep(2500);
  await page.locator('input[aria-label="First Name"]').first().waitFor({ state: 'visible', timeout: 15000 });
  await sleep(2000);

  // typeWithoutClear: focus via click, select-all + delete, then type char by char (real keyboard)
  async function typeField(sel, val) {
    const loc = page.locator(sel).first();
    if (!(await loc.isVisible({ timeout: 1000 }).catch(() => false))) return false;
    try {
      await loc.click({ timeout: 1500 });
      await page.keyboard.press('Meta+A');
      await page.keyboard.press('Backspace');
      await sleep(100);
      await page.keyboard.type(val, { delay: 35 });
      return true;
    } catch (e) { log('err', sel, e.message.slice(0, 50)); return false; }
  }

  await typeField('input[aria-label="First Name"]', 'Test');
  await page.keyboard.press('Tab'); await sleep(200);
  await typeField('input[aria-label="Last Name"]', 'Guest');
  await page.keyboard.press('Tab'); await sleep(200);
  await typeField('input[aria-label="Customer email"]', 'friction.test@example.com');
  await page.keyboard.press('Tab'); await sleep(200);
  await typeField('input[aria-label="Customer address"]', '1 Test St');
  await page.keyboard.press('Tab'); await sleep(200);
  await typeField('input[aria-label="City"]', 'Testville');
  await page.keyboard.press('Tab'); await sleep(200);

  // Country — type and pick EXACT option
  log('Country select...');
  const countryIn = page.locator('input[aria-label="Country"]').first();
  await countryIn.click({ timeout: 2000 });
  await page.keyboard.press('Meta+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('United States', { delay: 35 });
  await sleep(1800);
  // click exact "United States" (not "Virgin Islands")
  const exact = page.locator('[role="option"]:visible, .v-list-item:visible').filter({ hasText: /^United States$/ }).first();
  if (await exact.isVisible({ timeout: 1500 }).catch(() => false)) {
    await exact.click({ timeout: 2000 });
    log('  selected exact United States');
  } else {
    log('  exact option not found');
  }
  await sleep(800);

  // ZipCode
  await typeField('input[aria-label="ZipCode"]', '00000');
  await page.keyboard.press('Tab'); await sleep(200);

  // State — it's a v-select (like Country). Click, type to filter, pick exact.
  log('State select...');
  const stateIn = page.locator('input[aria-label="State"]').first();
  if (await stateIn.isVisible({ timeout: 800 }).catch(() => false)) {
    await stateIn.click({ timeout: 2000 });
    await page.keyboard.type('California', { delay: 35 });
    await sleep(1500);
    const stateExact = page.locator('[role="option"]:visible, .v-list-item:visible').filter({ hasText: /^California$/ }).first();
    if (await stateExact.isVisible({ timeout: 1200 }).catch(() => false)) {
      await stateExact.click({ timeout: 2000 });
      log('  selected California');
    } else {
      log('  CA option not found; pressing Enter on first');
      await page.keyboard.press('ArrowDown'); await sleep(200);
      await page.keyboard.press('Enter');
    }
    await sleep(600);
  }

  // Telephone — vue-tel-input; click the input, type digits
  log('Telephone...');
  const tel = page.locator('input.vti__input[tabindex="0"]').first();
  await tel.click({ timeout: 2000 });
  await page.keyboard.type('5555555555', { delay: 40 });
  await page.keyboard.press('Tab');
  await sleep(800);

  // Check live + Next/Proceed enabled
  const live = await page.evaluate(() => {
    const vals = {};
    document.querySelectorAll('input').forEach((i) => { const k = i.ariaLabel || i.id; if (k) vals[k] = i.value; });
    const errs = Array.from(document.querySelectorAll('.v-messages__message, .error--text, .v-field--error')).map((e) => (e.innerText||'').trim()).filter(Boolean);
    return { vals, errs };
  });
  log('live:', JSON.stringify(live));
  const procs = await page.locator('button:has-text("Proceed To Payment")').first().evaluate((el) => !el.disabled && !/disabled/i.test(el.className)).catch(() => false);
  log('Proceed To Payment enabled?', procs);
  await page.screenshot({ path: '/tmp/v11-guestform.png', fullPage: false });

  if (procs) {
    log('CLICKING Proceed To Payment...');
    await page.locator('button:has-text("Proceed To Payment")').first().click({ timeout: 3000 });
    await sleep(8000);
    log('url after Proceed:', page.url());

    // Inspect the payment-container + page
    const ps = await page.evaluate(() => ({
      url: location.href,
      headings: Array.from(document.querySelectorAll('h1,h2,h3,h4,h5')).filter((e) => e.offsetWidth).map((e) => (e.innerText||'').trim().slice(0,80)),
      paymentContainer: (() => { const pc = document.getElementById('payment-container'); return pc ? { display: pc.style.display, childCount: pc.children.length, innerHTMLLen: pc.innerHTML.length, hasIframe: !!pc.querySelector('iframe'), firstChildTag: pc.firstElementChild?.tagName } : null; })(),
      cardInputs: Array.from(document.querySelectorAll('input')).filter((i) => i.offsetWidth && /card|cc|cvc|cvv|expir|exp-|exp_|account number|security code|cardnumber|ccnumber/i.test((i.name||'')+(i.id||'')+(i.autocomplete||'')+(i.ariaLabel||'')+(i.placeholder||''))).map((i)=>({id:i.id,name:i.name,aria:i.ariaLabel,ac:i.autocomplete,ph:i.placeholder})),
      allPaymentIframes: Array.from(document.querySelectorAll('iframe')).filter((f) => /card|payment|stripe|spreedly|worldpay|authorize|cybersource|hps|tokenex|sagepay|adyen|braintree|vantiv|globalpay|moneris|recurly|nmi|square|hosted|hps/i.test(f.src+f.name+f.id+(f.title||''))).map((f)=>({src:f.src.slice(0,80),name:f.name,id:f.id,title:f.title})),
      allIframes: Array.from(document.querySelectorAll('iframe')).map((f)=>({src:(f.src||'').slice(0,80),name:f.name,id:f.id,title:f.title})),
      recaptcha: { script: document.querySelectorAll('script[src*="recaptcha"]').length, iframe: document.querySelectorAll('iframe[src*="recaptcha"], iframe[title*="reCAPTCHA" i]').length, grecaptcha: typeof window.grecaptcha !== 'undefined' },
    }));
    log('PAYMENT STEP:', JSON.stringify(ps, null, 2));
    out.paymentStep = ps;
    out.paymentReached = true;
    await page.screenshot({ path: '/tmp/v11-payment.png', fullPage: true });
  } else {
    out.paymentReached = false;
    out.blocker = 'Proceed To Payment still disabled (Vuetify form validation — telephone/Country reactivity)';
  }
  out.finalUrl = page.url();
} catch (e) { out.error = e.message; log('FATAL', e.message, e.stack); }
finally {
  fs.writeFileSync('/tmp/v11-result.json', JSON.stringify(out, null, 2));
  await browser.close();
}
log('RESULT paymentReached:', out.paymentReached);
