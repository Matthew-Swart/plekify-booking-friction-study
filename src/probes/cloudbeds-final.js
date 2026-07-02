/**
 * Final Fatwave probe:
 *  1. Test the checkin=/checkout= deep link (does it prefill + auto-search?).
 *  2. Drive to cart: Add a room, then wait + dump EVERYTHING to find the
 *     post-cart next-step button (Reserve Now / Checkout).
 *  3. Click it, follow to payment, detect payment page precisely.
 */
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { sleep } from '../util.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

async function dumpAll(page, tag) {
  const all = await page.evaluate(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const btns = Array.from(document.querySelectorAll('button, a, [role="button"], input[type="submit"]')).filter(vis).map((b) => ({
      tag: b.tagName, text: (b.innerText || b.value || '').trim().slice(0, 30), cls: (b.className || '').toString().slice(0, 70),
      id: b.id || null, href: b.getAttribute('href') || null, disabled: !!b.disabled, aria: b.getAttribute('aria-label') || null,
    }));
    // cart / sidebar / summary
    const cart = Array.from(document.querySelectorAll('[class*="cart" i], [class*="summary" i], [class*="sidebar" i], [class*="booking-summary" i], [class*="reserve" i], [class*="checkout" i]')).filter(vis).map((e) => ({ cls: (e.className || '').toString().slice(0, 70), text: (e.innerText || '').replace(/\n/g, ' ').slice(0, 120) }));
    return { btns, cart };
  }).catch(() => ({ btns: [], cart: [] }));
  console.log(`\n--- ${tag} ---`);
  console.log('buttons:', JSON.stringify(all.btns.filter((b) => b.text || b.id).slice(0, 30), null, 1));
  console.log('cart-ish:', JSON.stringify(all.cart.slice(0, 8), null, 1));
  return all;
}

async function main() {
  chromium.use(StealthPlugin());
  const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });
  const today = new Date();
  const cinIso = iso(new Date(today.getTime() + 45 * 86400000));
  const coutIso = iso(new Date(today.getTime() + 47 * 86400000));

  // ---- 1. checkin=/checkout= deep link ----
  console.log('===== TEST: checkin/checkout deep link =====');
  {
    const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 900 }, locale: 'en-US' });
    const page = await ctx.newPage();
    const deep = `https://hotels.cloudbeds.com/en/reservation/SoRbvN/?checkin=${cinIso}&checkout=${coutIso}&adults=2`;
    await page.goto(deep, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await sleep(7000);
    const s = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button')).filter((b) => b.getBoundingClientRect().width > 0);
      const cin = btns.find((b) => /check.?in/i.test(b.getAttribute('aria-label') || '') || /check.?in/i.test(b.innerText || ''));
      // after prefill, the button shows a date not "Check-in" — capture the first chakra date button
      const dateBtns = btns.filter((b) => /chakra-button d-1nt62lc/.test((b.className || '').toString())).map((b) => b.innerText.replace(/\n/g, ' ').slice(0, 24));
      const guest = btns.find((b) => /guest/i.test(b.innerText || ''));
      const search = document.querySelector('.cb-search-button');
      const roomCards = !!document.querySelector('.cb-accommodation-card, .cb-rate-plan');
      const availTxt = /available rooms|availability/i.test(document.body.innerText || '');
      return { cinText: cin ? cin.innerText.replace(/\n/g, ' ').slice(0, 24) : null, dateBtns, guestText: guest ? guest.innerText.replace(/\n/g, ' ').slice(0, 24) : null, searchDisabled: search ? search.disabled : null, roomCards, availTxt };
    }).catch(() => ({}));
    console.log('checkin/checkout deep-link state:', JSON.stringify(s, null, 2));
    await ctx.close();
  }

  // ---- 2. Full flow, then deep inspect after Add ----
  console.log('\n===== FULL FLOW + post-Add inspect =====');
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 900 }, locale: 'en-US' });
  ctx.setDefaultTimeout(15000);
  const page = await ctx.newPage();
  await page.goto('https://hotels.cloudbeds.com/en/reservation/SoRbvN', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(5000);
  await page.locator('button:has-text("Check-in")').first().click({ timeout: 6000 });
  await sleep(1000);
  for (let i = 0; i < 10; i++) {
    const c = page.locator(`[data-date="${cinIso}"]`).first();
    if (await c.isVisible().catch(() => false)) { await c.click({ timeout: 5000 }); break; }
    await page.evaluate(() => { const n = Array.from(document.querySelectorAll('button,[role="button"],a')).find((b) => /next|>|›|→/i.test((b.getAttribute('aria-label') || '') + (b.innerText || '').trim())); if (n) n.click(); }).catch(() => {});
    await sleep(400);
  }
  await sleep(700);
  for (let i = 0; i < 10; i++) {
    const c = page.locator(`[data-date="${coutIso}"]`).first();
    if (await c.isVisible().catch(() => false)) { await c.click({ timeout: 5000 }); break; }
    await page.evaluate(() => { const n = Array.from(document.querySelectorAll('button,[role="button"],a')).find((b) => /next|>|›|→/i.test((b.getAttribute('aria-label') || '') + (b.innerText || '').trim())); if (n) n.click(); }).catch(() => {});
    await sleep(400);
  }
  await sleep(800);
  await page.locator('button.cb-search-button').first().click({ timeout: 6000 });
  await sleep(6000);
  console.log('search done, url:', page.url());

  // click first Add
  await page.locator('button.cb-select-button').first().click({ timeout: 6000 });
  console.log('Add clicked');
  await sleep(3500);
  await dumpAll(page, 'AFTER ADD (first room)');

  // The post-Add next-step is often a button whose text changed to a count or "Reserve".
  // Try common Chakra engine checkout-button selectors explicitly:
  const nextSelCandidates = [
    'button:has-text("Reserve")', 'button:has-text("Reserve Now")', 'button:has-text("Book Now")',
    'button:has-text("Checkout")', 'button:has-text("Continue")', 'button:has-text("Next")',
    'button:has-text("Review")', 'button:has-text("Review and Reserve")',
    '.cb-reserve-button', '.cb-checkout-button', '[class*="reserve" i] button', '[class*="checkout" i] button',
    'button[class*="reserve" i]', 'button[class*="checkout" i]',
  ];
  let nextClicked = null;
  for (const sel of nextSelCandidates) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible().catch(() => false)) {
      const t = await loc.innerText().catch(() => '');
      await loc.click({ timeout: 6000 }).catch(() => {});
      nextClicked = `${sel} => "${t.replace(/\n/g, ' ').slice(0, 30)}"`;
      console.log('NEXT clicked:', nextClicked);
      break;
    }
  }
  if (!nextClicked) {
    // maybe a slide-in cart with the button. Wait + retry.
    await sleep(2500);
    await dumpAll(page, 'AFTER ADD + wait (retry)');
    for (const sel of nextSelCandidates) {
      const loc = page.locator(sel).first();
      if (await loc.isVisible().catch(() => false)) {
        const t = await loc.innerText().catch(() => '');
        await loc.click({ timeout: 6000 }).catch(() => {});
        nextClicked = `${sel} => "${t.replace(/\n/g, ' ').slice(0, 30)}"`;
        console.log('NEXT clicked (retry):', nextClicked);
        break;
      }
    }
  }
  if (!nextClicked) console.log('NO next-step button matched — taking screenshot');
  await page.screenshot({ path: 'data/fatwave-cart.png', fullPage: false }).catch(() => {});
  await sleep(5000);

  console.log('url after next:', page.url());
  await dumpAll(page, 'AFTER NEXT-STEP');

  // precise payment detection (exclude amenity text false positives)
  const pay = await page.evaluate(() => {
    // visible text only, from headings + labels + buttons
    const visText = Array.from(document.querySelectorAll('h1,h2,h3,h4,label,button,p')).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).map((e) => (e.innerText || '').replace(/\n/g, ' ').trim()).filter(Boolean).join(' | ');
    const payHeading = /payment information|card details|enter your card|billing address|secure payment|deposit due|pay now|review your (booking|reservation)/i.test(visText);
    const cardIfr = Array.from(document.querySelectorAll('iframe')).filter((f) => /js\.stripe|payments\.cloudbeds|checkout\.cloudbeds|spreedly|recurly|braintree|adyen|card-number|hosted/i.test(f.src || '') || /card|payment|cc/i.test(f.name || '')).map((f) => f.src.slice(0, 80));
    const cardInput = !!document.querySelector('input[autocomplete*="cc-number" i], input[name*="ccnumber" i], input[name="cardnumber" i], [data-elements-stable-field-name*="cardNumber"], input[id*="card-number" i]');
    const guestForm = /first name|last name|email address|phone number/i.test(visText);
    return { url: location.href, payHeading, cardIfr, cardInput, guestForm, visTextHead: visText.slice(0, 400) };
  }).catch(() => ({ url: page.url() }));
  console.log('\nPAYMENT probe (precise):', JSON.stringify(pay, null, 2));
  await page.screenshot({ path: 'data/fatwave-final.png', fullPage: false }).catch(() => {});

  await ctx.close();
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
