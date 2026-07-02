/**
 * Fatwave: use the working checkin/checkout deep link, then robustly Add a
 * room (with retries + wait for cart to populate), then click the cart's
 * checkout button and detect the payment page.
 */
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { sleep } from '../util.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

async function cartCount(page) {
  return page.evaluate(() => {
    const cart = document.querySelector('.cb-shopping-cart, [class*="shopping-cart" i]');
    if (!cart) return { found: false };
    const txt = (cart.innerText || '').replace(/\n/g, ' ');
    return { found: true, txt: txt.slice(0, 160), empty: /no accommodations added|your cart is empty|0 rooms/i.test(txt) };
  }).catch(() => ({ found: false }));
}

async function main() {
  chromium.use(StealthPlugin());
  const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });
  const today = new Date();
  const cinIso = iso(new Date(today.getTime() + 45 * 86400000));
  const coutIso = iso(new Date(today.getTime() + 47 * 86400000));

  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 900 }, locale: 'en-US' });
  ctx.setDefaultTimeout(15000);
  const page = await ctx.newPage();

  // Deep link — auto-fills dates + auto-searches
  const deep = `https://hotels.cloudbeds.com/en/reservation/SoRbvN/?checkin=${cinIso}&checkout=${coutIso}&adults=2`;
  console.log('goto deep link:', deep);
  await page.goto(deep, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await sleep(7000);
  console.log('url:', page.url());

  // wait for at least one Add button
  await page.locator('button.cb-select-button').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  await sleep(1000);

  // Robust Add: click, then check cart; retry up to 4x
  let added = false;
  for (let i = 0; i < 4; i++) {
    const addBtns = await page.locator('button.cb-select-button').all();
    console.log(`attempt ${i}: ${addBtns.length} Add buttons visible`);
    if (addBtns.length) {
      await addBtns[0].click({ timeout: 5000 }).catch(() => {});
      await sleep(2500);
      const c = await cartCount(page);
      console.log(`  cart after click: found=${c.found} empty=${c.empty} txt="${(c.txt || '').slice(0, 80)}"`);
      if (c.found && !c.empty) { added = true; break; }
    }
    await sleep(1000);
  }
  console.log('room added to cart?', added);
  await page.screenshot({ path: 'data/fatwave-cart-after-add.png', fullPage: false }).catch(() => {});

  // Now find the checkout/reserve button in the cart
  const nextBtns = await page.evaluate(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    return Array.from(document.querySelectorAll('button, a, [role="button"]')).filter(vis).map((b) => ({
      text: (b.innerText || '').trim().slice(0, 30), cls: (b.className || '').toString().slice(0, 70),
      id: b.id || null, aria: b.getAttribute('aria-label') || null, href: b.getAttribute('href') || null,
    })).filter((b) => b.text && /reserve|checkout|continue|book|next|review|proceed|pay|confirm/i.test(b.text + ' ' + b.aria));
  }).catch(() => []);
  console.log('cart next-step candidates:', JSON.stringify(nextBtns, null, 1));

  // Also dump the full cart DOM to see its buttons
  const cartDom = await page.evaluate(() => {
    const cart = document.querySelector('.cb-shopping-cart, [class*="shopping-cart" i]');
    if (!cart) return null;
    return {
      txt: (cart.innerText || '').replace(/\n/g, ' ').slice(0, 300),
      btns: Array.from(cart.querySelectorAll('button, a, [role="button"]')).map((b) => ({ text: (b.innerText || '').trim().slice(0, 30), cls: (b.className || '').toString().slice(0, 70), aria: b.getAttribute('aria-label') || null })),
    };
  }).catch(() => null);
  console.log('cart DOM:', JSON.stringify(cartDom, null, 1));

  // Click the first matching next-step button
  let clickedTxt = null;
  for (const cand of nextBtns) {
    const sel = cand.id ? `#${cand.id}` : `button:has-text("${cand.text}")`;
    const loc = page.locator(sel).first();
    if (await loc.isVisible().catch(() => false)) {
      await loc.click({ timeout: 6000 }).catch(() => {});
      clickedTxt = cand.text;
      console.log('clicked next-step:', cand.text, '(' + sel + ')');
      break;
    }
  }
  if (!clickedTxt) console.log('NO next-step button clicked');
  await sleep(6000);
  console.log('url after next:', page.url());

  // payment detection
  const pay = await page.evaluate(() => {
    const visText = Array.from(document.querySelectorAll('h1,h2,h3,h4,label,button,p')).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).map((e) => (e.innerText || '').replace(/\n/g, ' ').trim()).filter(Boolean).join(' | ');
    const payHeading = /payment information|card details|enter your card|billing address|secure payment|deposit due|pay now|review your (booking|reservation)|guest details/i.test(visText);
    const cardIfr = Array.from(document.querySelectorAll('iframe')).filter((f) => /js\.stripe|payments\.cloudbeds|checkout\.cloudbeds|spreedly|recurly|braintree|adyen|hosted/i.test(f.src || '') || /card|payment|cc/i.test(f.name || '')).map((f) => f.src.slice(0, 80));
    const cardInput = !!document.querySelector('input[autocomplete*="cc-number" i], input[name*="ccnumber" i], input[name="cardnumber" i], [data-elements-stable-field-name*="cardNumber"], input[id*="card-number" i]');
    const guestForm = /first name|last name|email address|phone number/i.test(visText);
    return { url: location.href, payHeading, cardIfr, cardInput, guestForm, visTextHead: visText.slice(0, 500) };
  }).catch(() => ({ url: page.url() }));
  console.log('\nPAYMENT probe:', JSON.stringify(pay, null, 2));
  await page.screenshot({ path: 'data/fatwave-payment.png', fullPage: false }).catch(() => {});

  await ctx.close();
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
