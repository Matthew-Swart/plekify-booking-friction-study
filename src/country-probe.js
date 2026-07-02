// Stayntouch IBE v9 — final surgical: handle Country as a v-select div + tel via keyboard.
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
chromium.use(StealthPlugin());

const log = (...a) => console.log('[v9]', ...a);
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

try {
  log('goto', DEEPLINK);
  await page.goto(DEEPLINK, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(4500);

  // rate → checkout → continue-without-login
  await page.locator('.btn-book button.btn-pri-md:visible').first().click({ timeout: 3000 });
  await sleep(4500);
  await page.locator('button[aria-label="Checkout"]:visible').first().click({ timeout: 3000 });
  await sleep(4500);
  await page.locator('button.changefields.guest-login:visible').first().click({ timeout: 3000 }).catch(() => {});
  await sleep(2500);
  await page.locator('input[aria-label="First Name"]').first().waitFor({ state: 'visible', timeout: 15000 });
  await sleep(1500);

  // Use Playwright's native fill (dispatches proper events) on the VISIBLE instance of each field.
  // Visible instance: filter by :visible.
  async function visFill(sel, val) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible({ timeout: 1000 }).catch(() => false)) {
      try { await loc.click({ timeout: 1500 }); await loc.fill(val); await loc.press('Tab'); await sleep(300); return true; }
      catch (e) { log('err', sel, e.message.slice(0, 60)); }
    }
    return false;
  }

  await visFill('input[aria-label="First Name"]', 'Test');
  await visFill('input[aria-label="Last Name"]', 'Guest');
  await visFill('input[aria-label="Customer email"]', 'friction.test@example.com');
  // tel: the visible one (desktop) — tabindex=0
  await visFill('input.vti__input[tabindex="0"]', '5555555555');
  await visFill('input[aria-label="Customer address"]', '1 Test St');
  await visFill('input[aria-label="City"]', 'Testville');
  await visFill('input[aria-label="ZipCode"]', '00000');

  // Country — it's a v-select rendered as a div with role=button (or combobox). Click to open menu.
  log('handling Country v-select...');
  // The element with aria-label="Country" is a div. Click it to open the dropdown.
  const countryDiv = page.locator('div[aria-label="Country"][tabindex="0"]').first();
  if (await countryDiv.isVisible({ timeout: 1000 }).catch(() => false)) {
    await countryDiv.click({ timeout: 2000 });
    await sleep(1200);
    // Now a v-select menu should be open. Look for list items.
    // Try to find "United States" option
    const optionMatchers = [
      '[role="listbox"] [role="option"]:visible >> text=United States',
      '.v-select__content [role="option"]:visible >> text=United States',
      '.v-overlay__content [role="option"]:visible >> text=United States',
      '[role="menu"] [role="menuitem"]:visible >> text=United States',
      '.v-list-item:visible >> text=United States',
    ];
    let picked = null;
    for (const m of optionMatchers) {
      const it = page.locator(m).first();
      if (await it.isVisible({ timeout: 800 }).catch(() => false)) {
        try { await it.click({ timeout: 2000 }); picked = m; break; } catch {}
      }
    }
    log('country picked:', picked);
    if (!picked) {
      // Maybe it's a combobox: type to filter
      const countryInput = page.locator('input[aria-label="Country"]').first();
      if (await countryInput.isVisible({ timeout: 500 }).catch(() => false)) {
        await countryInput.fill('United States');
        await sleep(1000);
        await countryInput.press('ArrowDown');
        await countryInput.press('Enter');
        log('country via combobox kbd');
      }
    }
  } else {
    log('country div not visible');
  }
  await sleep(800);

  // Check live state
  const live = await page.evaluate(() => {
    const vals = {};
    document.querySelectorAll('input, div[aria-label]').forEach((i) => {
      const k = i.ariaLabel || i.id;
      if (k) vals[k] = i.value || i.getAttribute('value') || '';
    });
    const errs = Array.from(document.querySelectorAll('.v-messages__message, .error--text')).map((e) => (e.innerText || '').trim()).filter(Boolean);
    return { vals, errs };
  }).catch(() => ({}));
  log('live:', JSON.stringify(live));

  const enabled = await page.locator('button:has-text("Next Step")').first().evaluate((el) => !el.disabled && !/disabled/i.test(el.className)).catch(() => false);
  log('Next enabled?', enabled);
  await page.screenshot({ path: '/tmp/v9-guestform.png', fullPage: false });

  if (enabled) {
    await page.locator('button:has-text("Next Step")').first().click({ timeout: 3000 });
    await sleep(6000);
    log('after Next url:', page.url());
    // Inspect payment step
    const pState = await page.evaluate(() => ({
      url: location.href,
      headings: Array.from(document.querySelectorAll('h1,h2,h3,h4')).filter((e) => e.offsetWidth).map((e) => (e.innerText || '').trim().slice(0, 60)),
      inputs: Array.from(document.querySelectorAll('input')).filter((i) => i.offsetWidth).map((i) => ({ id: i.id, name: i.name, aria: i.ariaLabel, type: i.type, ph: i.placeholder, autocomplete: i.autocomplete })),
      iframes: Array.from(document.querySelectorAll('iframe')).map((f) => ({ src: f.src, name: f.name, id: f.id, title: f.title })),
      recaptcha: { script: document.querySelectorAll('script[src*="recaptcha"]').length, iframe: document.querySelectorAll('iframe[src*="recaptcha"]').length, grecaptcha: typeof window.grecaptcha !== 'undefined' },
    }));
    log('PAYMENT STEP:', JSON.stringify(pState, null, 2));
    await page.screenshot({ path: '/tmp/v9-payment.png', fullPage: true });
  } else {
    log('NEXT STILL DISABLED — could not reach payment step');
  }
} catch (e) { log('FATAL', e.message); }
finally { await browser.close(); }
