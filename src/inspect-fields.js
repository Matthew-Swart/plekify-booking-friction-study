// Surgical inspection: find EXACT visible Country + telephone elements, then drive them.
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
chromium.use(StealthPlugin());

const log = (...a) => console.log('[insp]', ...a);
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
  await page.goto(DEEPLINK, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(4500);
  await page.locator('.btn-book button.btn-pri-md:visible').first().click({ timeout: 3000 });
  await sleep(4500);
  await page.locator('button[aria-label="Checkout"]:visible').first().click({ timeout: 3000 });
  await sleep(4500);
  await page.locator('button.changefields.guest-login:visible').first().click({ timeout: 3000 }).catch(() => {});
  await sleep(2500);
  await page.locator('input[aria-label="First Name"]').first().waitFor({ state: 'visible', timeout: 15000 });
  await sleep(2000);

  // DUMP everything Country-related and telephone-related with full attributes + visibility + bounding box
  const dump = await page.evaluate(() => {
    const out = { country: [], tel: [], allAria: [] };
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    document.querySelectorAll('[aria-label="Country"], [aria-label*="country" i]').forEach((el) => {
      out.country.push({
        tag: el.tagName.toLowerCase(), id: el.id, class: el.className,
        role: el.getAttribute('role'), tabindex: el.getAttribute('tabindex'),
        value: el.getAttribute('value'), text: (el.innerText || '').slice(0, 40), vis: vis(el),
        bbox: (() => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })(),
        parentClass: el.parentElement?.className,
      });
    });
    document.querySelectorAll('input.vti__input, #telephone, input[name="telephone"], input[autocomplete="tel"]').forEach((el) => {
      out.tel.push({
        tag: el.tagName.toLowerCase(), id: el.id, class: el.className, name: el.name,
        tabindex: el.getAttribute('tabindex'), value: el.value, vis: vis(el),
        bbox: (() => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })(),
        parentClass: el.parentElement?.className?.slice(0, 60),
      });
    });
    document.querySelectorAll('[aria-label]').forEach((el) => {
      if (vis(el)) out.allAria.push({ aria: el.ariaLabel, tag: el.tagName.toLowerCase(), id: el.id });
    });
    return out;
  });
  console.log(JSON.stringify(dump, null, 2));

  // Try to interact using the bounding box info
  const visCountry = dump.country.find((c) => c.vis);
  const visTel = dump.tel.find((t) => t.vis);
  log('visible country:', JSON.stringify(visCountry));
  log('visible tel:', JSON.stringify(visTel));

  // Drive telephone using the visible one
  if (visTel) {
    const telSel = visTel.id ? `#${visTel.id}` : `input.vti__input`;
    // there may be 2 with same id; use nth
    const telLoc = page.locator(telSel).filter({ has: page.locator(':scope') }).nth(dump.tel.filter((t)=>t.vis).length > 0 ? dump.tel.indexOf(visTel) : 0);
    log('typing into tel with keyboard...');
    await telLoc.click({ timeout: 2000 });
    await page.keyboard.type('5555555555', { delay: 40 });
    await page.keyboard.press('Tab');
    await sleep(500);
    const telVal = await telLoc.inputValue().catch(() => 'ERR');
    log('tel value after type:', telVal);
  }

  // Drive Country — the visible one is a div. Click, then pick from menu.
  if (visCountry) {
    log('clicking country div...');
    // Use a precise selector based on the dump
    const countryLoc = page.locator(`[aria-label="Country"][tabindex="${visCountry.tabindex || '0'}"]`).first();
    await countryLoc.click({ timeout: 2000 });
    await sleep(1500);
    // Inspect what menu opened
    const menuDump = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('[role="option"], [role="menuitem"], .v-list-item')).filter((el) => {
        const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0;
      }).slice(0, 10).map((el) => ({ role: el.getAttribute('role'), text: (el.innerText || '').slice(0, 50), class: el.className.slice(0, 60) }));
      return items;
    });
    log('menu items after country click:', JSON.stringify(menuDump));
    // Try typing to filter (it may be a combobox)
    await page.keyboard.type('United States', { delay: 30 });
    await sleep(1500);
    const filteredItems = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('[role="option"], .v-list-item')).filter((el) => {
        const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0;
      }).slice(0, 5).map((el) => (el.innerText || '').slice(0, 50));
    });
    log('filtered items:', JSON.stringify(filteredItems));
    // Press Enter to select first
    await page.keyboard.press('Enter');
    await sleep(800);
  }

  // Re-check Next
  const live = await page.evaluate(() => {
    const vals = {};
    document.querySelectorAll('input, div[aria-label="Country"]').forEach((i) => {
      const k = i.ariaLabel || i.id; if (k) vals[k] = i.value || i.getAttribute('value') || '';
    });
    return vals;
  });
  log('final live vals:', JSON.stringify(live));
  const enabled = await page.locator('button:has-text("Next Step")').first().evaluate((el) => !el.disabled && !/disabled/i.test(el.className)).catch(() => false);
  log('Next enabled?', enabled);
  await page.screenshot({ path: '/tmp/insp-final.png', fullPage: false });

  if (enabled) {
    await page.locator('button:has-text("Next Step")').first().click({ timeout: 3000 });
    await sleep(6000);
    const ps = await page.evaluate(() => ({
      url: location.href,
      headings: Array.from(document.querySelectorAll('h1,h2,h3,h4')).filter((e) => e.offsetWidth).map((e) => (e.innerText || '').trim()),
      cardInputs: Array.from(document.querySelectorAll('input')).filter((i) => i.offsetWidth && /card|cc|cvc|cvv|exp|payment|account/i.test((i.name||'')+(i.id||'')+(i.autocomplete||'')+(i.ariaLabel||''))).map((i)=>({id:i.id,name:i.name,aria:i.ariaLabel,ac:i.autocomplete})),
      iframes: Array.from(document.querySelectorAll('iframe')).map((f)=>({src:f.src,name:f.name,title:f.title,id:f.id})),
    }));
    log('PAYMENT STEP:', JSON.stringify(ps, null, 2));
    await page.screenshot({ path: '/tmp/insp-payment.png', fullPage: true });
  }
} catch (e) { log('FATAL', e.message, e.stack); }
finally { await browser.close(); }
