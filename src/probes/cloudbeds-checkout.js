/**
 * Fatwave: complete the flow to the payment page.
 *  - pick dates (calendar)
 *  - set 2 adults (find real increment selector)
 *  - search
 *  - click first "Add" button
 *  - follow Reserve/Continue/Checkout
 *  - detect payment page
 * Also: re-test date-prefilled deep link with longer hydration wait.
 */
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { sleep } from '../util.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

async function main() {
  chromium.use(StealthPlugin());
  const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });

  // ---- Deep-link re-test: does ?date= hydrate the Check-in button? ----
  console.log('\n===== DEEP-LINK RE-TEST (hydration) =====');
  {
    const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 900 }, locale: 'en-US' });
    const page = await ctx.newPage();
    const today = new Date();
    const cinIso = iso(new Date(today.getTime() + 45 * 86400000));
    const coutIso = iso(new Date(today.getTime() + 47 * 86400000));
    const deep = `https://hotels.cloudbeds.com/en/reservation/SoRbvN?date=${cinIso}&nights=2&adults=2`;
    await page.goto(deep, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await sleep(6000);
    const state = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button')).filter((b) => b.getBoundingClientRect().width > 0);
      const cin = btns.find((b) => /check.?in/i.test((b.getAttribute('aria-label') || '') + (b.innerText || '')) || /aug|sep|oct|nov|dec|jan|feb|mar|apr|may|jun|jul/i.test(b.innerText || ''));
      const guest = btns.find((b) => /guest/i.test(b.innerText || ''));
      const search = document.querySelector('.cb-search-button');
      // visible body text excluding script/JSON-LD
      const visible = Array.from(document.querySelectorAll('h1,h2,h3,h4,p,span,div')).filter((e) => e.children.length === 0 && e.getBoundingClientRect().width > 0).map((e) => (e.innerText || '').trim()).filter((t) => t && t.length < 80).slice(0, 40);
      return {
        cinBtnText: cin ? cin.innerText.replace(/\n/g, ' ').slice(0, 40) : null,
        cinBtnLabel: cin ? cin.getAttribute('aria-label') : null,
        guestText: guest ? guest.innerText.replace(/\n/g, ' ').slice(0, 40) : null,
        searchDisabled: search ? search.disabled : null,
        visibleText: visible,
      };
    }).catch(() => ({}));
    console.log('deep-link state:', JSON.stringify(state, null, 2));
    await ctx.close();
  }

  // ---- Full manual flow to payment ----
  console.log('\n===== FULL MANUAL FLOW =====');
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 900 }, locale: 'en-US' });
  ctx.setDefaultTimeout(15000);
  const page = await ctx.newPage();
  const today = new Date();
  const cinIso = iso(new Date(today.getTime() + 45 * 86400000));
  const coutIso = iso(new Date(today.getTime() + 47 * 86400000));
  console.log('dates', cinIso, coutIso);
  await page.goto('https://hotels.cloudbeds.com/en/reservation/SoRbvN', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(5000);

  // open calendar
  await page.locator('button:has-text("Check-in")').first().click({ timeout: 6000 });
  await sleep(1000);
  // pick checkin
  for (let i = 0; i < 10; i++) {
    const c = page.locator(`[data-date="${cinIso}"]`).first();
    if (await c.isVisible().catch(() => false)) { await c.click({ timeout: 5000 }); console.log(`checkin clicked att${i}`); break; }
    await page.evaluate(() => { const n = Array.from(document.querySelectorAll('button,[role="button"],a')).find((b) => /next|>|›|→/i.test((b.getAttribute('aria-label') || '') + (b.innerText || '').trim())); if (n) n.click(); }).catch(() => {});
    await sleep(400);
  }
  await sleep(700);
  // pick checkout
  for (let i = 0; i < 10; i++) {
    const c = page.locator(`[data-date="${coutIso}"]`).first();
    if (await c.isVisible().catch(() => false)) { await c.click({ timeout: 5000 }); console.log(`checkout clicked att${i}`); break; }
    await page.evaluate(() => { const n = Array.from(document.querySelectorAll('button,[role="button"],a')).find((b) => /next|>|›|→/i.test((b.getAttribute('aria-label') || '') + (b.innerText || '').trim())); if (n) n.click(); }).catch(() => {});
    await sleep(400);
  }
  await sleep(800);

  // guests: open panel and inspect increment buttons precisely
  await page.locator('button:has-text("Guest")').first().click({ timeout: 5000 }).catch(() => {});
  await sleep(900);
  const guestDom = await page.evaluate(() => {
    // find the guests popup/modal
    const pop = document.querySelector('[role="dialog"], [class*="popover" i], [class*="popup" i], [class*="guest" i]');
    const root = pop || document.body;
    const btns = Array.from(root.querySelectorAll('button, [role="button"], svg, [aria-label]')).map((b) => ({
      label: b.getAttribute('aria-label'), text: (b.innerText || '').trim().slice(0, 12),
      cls: (b.className || '').toString().slice(0, 50), tag: b.tagName, vis: b.getBoundingClientRect().width > 0,
    })).filter((b) => b.vis);
    return btns.slice(0, 20);
  }).catch(() => []);
  console.log('guest panel buttons:', JSON.stringify(guestDom, null, 2));

  // try clicking the adults stepper: look for a button labelled with adult+/add
  const incResult = await page.evaluate(() => {
    const cands = Array.from(document.querySelectorAll('button, [role="button"], [aria-label]'));
    // 1. aria-label containing "adult" and "increase/add/plus"
    let hit = cands.find((b) => /adult/i.test(b.getAttribute('aria-label') || '') && /increase|add|plus|more|\+/i.test(b.getAttribute('aria-label') || ''));
    if (hit) { hit.click(); return 'aria-adult: ' + hit.getAttribute('aria-label'); }
    // 2. svg/button with title "Add adult" or similar
    hit = cands.find((b) => /add.*adult|adult.*add|increase.*adult|adult.*increase/i.test((b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || '')));
    if (hit) { hit.click(); return 'addadult: ' + hit.getAttribute('aria-label'); }
    // 3. any "+" svg whose parent row says "Adults"
    const rows = Array.from(document.querySelectorAll('[class*="counter" i], [class*="stepper" i], [class*="adult" i], li, tr'));
    for (const r of rows) { // eslint-disable-line
      if (/^adults?$/im.test(r.innerText || '')) {
        const plus = Array.from(r.querySelectorAll('button, [role="button"], svg')).find((b) => /\+|add|plus|increase/i.test((b.innerText || '') + (b.getAttribute('aria-label') || '') + (b.className || '').toString()));
        if (plus) { plus.click(); return 'row-plus'; }
      }
    }
    return 'NOT FOUND';
  }).catch((e) => 'eval err ' + String(e).slice(0, 60));
  console.log('adult increment:', incResult);
  await sleep(500);
  const guestNow = await page.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => /guest/i.test(x.innerText || '')); return b ? b.innerText.replace(/\n/g, ' ').slice(0, 30) : null; }).catch(() => '?');
  console.log('guest btn after inc:', guestNow);
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(400);

  // search
  const search = page.locator('button.cb-search-button').first();
  if (!(await search.isDisabled().catch(() => true))) {
    await search.click({ timeout: 6000 });
    console.log('search clicked');
  } else { console.log('search DISABLED — cannot proceed'); }
  await sleep(6000);

  // click first "Add" button on a rate plan
  const addBtn = page.locator('.cb-rate-plan button:has-text("Add"), button:has-text("Add")').first();
  const addVisible = await addBtn.isVisible().catch(() => false);
  console.log('Add button visible?', addVisible);
  if (addVisible) {
    await addBtn.click({ timeout: 6000 });
    console.log('Add clicked');
  } else {
    // dump again in case DOM changed
    const rb = await page.evaluate(() => Array.from(document.querySelectorAll('.cb-rate-plan button, .cb-accommodation-card button, [class*="rate"] button')).map((b) => ({ text: (b.innerText || '').trim().slice(0, 20), cls: (b.className || '').toString().slice(0, 60), dis: b.disabled, vis: b.getBoundingClientRect().width > 0 })).filter((b) => b.vis)).catch(() => []);
    console.log('rate buttons after search:', JSON.stringify(rb));
  }
  await sleep(4000);

  // after Add: a cart/sidebar appears with Reserve/Continue. Find + click.
  const afterAdd = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button, a')).filter((b) => b.getBoundingClientRect().width > 0).map((b) => ({ text: (b.innerText || '').trim().slice(0, 24), cls: (b.className || '').toString().slice(0, 60), href: b.getAttribute('href') })).filter((b) => b.text);
    return btns;
  }).catch(() => []);
  console.log('buttons after Add:', JSON.stringify(afterAdd.slice(0, 20), null, 2));
  await page.screenshot({ path: 'data/fatwave-after-add.png', fullPage: false }).catch(() => {});

  // click the next-step button (Reserve / Continue / Checkout / Book Now)
  for (const t of ['Reserve', 'Continue', 'Checkout', 'Book Now', 'Reserve Now', 'Next']) {
    const b = page.locator(`button:has-text("${t}"), a:has-text("${t}")`).first();
    if (await b.isVisible().catch(() => false)) {
      await b.click({ timeout: 6000 }).catch(() => {});
      console.log(`clicked "${t}"`);
      break;
    }
  }
  await sleep(5000);
  console.log('url after reserve:', page.url());

  // payment detection
  const pay = await page.evaluate(() => ({
    url: location.href,
    cardIfr: Array.from(document.querySelectorAll('iframe')).filter((f) => /stripe|js\.stripe|payments|checkout|card|spreedly|recurly/i.test(f.src || '')).map((f) => f.src.slice(0, 60)),
    cardInput: !!document.querySelector('input[autocomplete*="cc-number" i], input[name*="card" i], input[name*="cc" i], [data-elements-stable-field-name*="cardNumber"], input[id*="card" i]'),
    payHeading: /payment|billing|card details|deposit|pay now|secure payment/i.test(document.body.innerText || ''),
    payUrl: /\/payment|\/checkout|\/pay\b|\/confirm|\/billing/i.test(location.href),
    bodyHead: (document.body.innerText || '').replace(/[{}"@].*/g, '').slice(0, 300),
  })).catch(() => ({ url: page.url() }));
  console.log('PAYMENT probe:', JSON.stringify(pay, null, 2));
  await page.screenshot({ path: 'data/fatwave-payment-page.png', fullPage: false }).catch(() => {});

  await ctx.close();
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
