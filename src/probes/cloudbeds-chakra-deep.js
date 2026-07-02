/**
 * Fatwave Chakra-engine deep dive: drive the calendar for real, search,
 * then dump the actual room-rate "Book" button markup.
 */
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { sleep } from '../util.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function main() {
  chromium.use(StealthPlugin());
  const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 900 }, locale: 'en-US' });
  const page = await ctx.newPage();
  const url = 'https://hotels.cloudbeds.com/en/reservation/SoRbvN';
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(5000);

  // click Check-in
  const cin = page.locator('button:has-text("Check-in")').first();
  await cin.click({ timeout: 6000 }).catch((e) => console.log('cin click err', String(e).slice(0, 80)));
  await sleep(1200);
  // inspect calendar
  const cal = await page.evaluate(() => {
    const root = document.querySelector('[class*="calendar" i], [class*="month" i], .flatpickr-calendar, [role="dialog"]');
    const cells = Array.from(document.querySelectorAll('[data-date], [class*="day" i], td[role="gridcell"], button[class*="day" i]')).slice(0, 12).map((c) => ({
      tag: c.tagName, cls: (c.className || '').toString().slice(0, 60), dataDate: c.getAttribute('data-date'),
      text: (c.innerText || '').trim().slice(0, 12), dis: c.getAttribute('aria-disabled') || c.disabled,
    }));
    const navBtns = Array.from(document.querySelectorAll('button, [role="button"]')).filter((b) => /next|prev|›|‹|>|</.test((b.getAttribute('aria-label') || '') + ' ' + (b.innerText || ''))).slice(0, 4).map((b) => ({ label: b.getAttribute('aria-label'), text: (b.innerText || '').trim().slice(0, 6), cls: (b.className || '').toString().slice(0, 50) }));
    return { rootFound: !!root, cells, navBtns };
  }).catch(() => ({}));
  console.log('CALENDAR after Check-in click:', JSON.stringify(cal, null, 2));

  // compute target dates
  const today = new Date();
  const cinD = new Date(today.getTime() + 45 * 86400000);
  const coutD = new Date(today.getTime() + 47 * 86400000);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const cinIso = iso(cinD), coutIso = iso(coutD);
  console.log('target dates', cinIso, coutIso);

  // click checkin cell, advancing months
  let clicked = false;
  for (let i = 0; i < 8; i++) {
    const cell = page.locator(`[data-date="${cinIso}"]`).first();
    if (await cell.isVisible().catch(() => false)) {
      await cell.click({ timeout: 5000 }).catch(() => {});
      console.log(`clicked checkin ${cinIso} on attempt ${i}`);
      clicked = true; break;
    }
    // advance
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, [role="button"], a'));
      const next = btns.find((b) => /^next|>|›|→|next month/i.test((b.getAttribute('aria-label') || '') + ' ' + (b.innerText || '').trim()));
      if (next) next.click();
    }).catch(() => {});
    await sleep(500);
  }
  await sleep(700);
  // checkout
  for (let i = 0; i < 8; i++) {
    const cell = page.locator(`[data-date="${coutIso}"]`).first();
    if (await cell.isVisible().catch(() => false)) {
      await cell.click({ timeout: 5000 }).catch(() => {});
      console.log(`clicked checkout ${coutIso}`);
      break;
    }
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, [role="button"], a'));
      const next = btns.find((b) => /^next|>|›|→|next month/i.test((b.getAttribute('aria-label') || '') + ' ' + (b.innerText || '').trim()));
      if (next) next.click();
    }).catch(() => {});
    await sleep(500);
  }
  await sleep(800);
  // confirm the Check-in button now shows the date
  const cinText = await page.locator('button:has-text("Check-in")').first().innerText().catch(() => '?');
  const coutText = await page.locator('button:has-text("Check-out")').first().innerText().catch(() => '?');
  console.log('after pick — Check-in btn text:', JSON.stringify(cinText), ' Check-out btn text:', JSON.stringify(coutText));

  // adults: default is "1 Guest"; need 2. Click guests, increment.
  const guestBtn = page.locator('button:has-text("Guest")').first();
  await guestBtn.click({ timeout: 5000 }).catch((e) => console.log('guest click err', String(e).slice(0, 60)));
  await sleep(700);
  const guestPanel = await page.evaluate(() => {
    const txt = (document.body.innerText || '').slice(0, 400);
    const inc = Array.from(document.querySelectorAll('button, [role="button"], svg')).filter((b) => /plus|add|increment|more|\+|adult/i.test((b.getAttribute('aria-label') || '') + (b.className || '').toString())).slice(0, 6).map((b) => ({ label: b.getAttribute('aria-label'), cls: (b.className || '').toString().slice(0, 50), tag: b.tagName }));
    return { txt: txt.slice(0, 200), inc };
  }).catch(() => ({}));
  console.log('GUEST panel:', JSON.stringify(guestPanel, null, 2));

  // click the adults + button by aria-label heuristics
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button, [role="button"], [aria-label]'));
    const inc = btns.find((b) => /adult.*(increase|plus|add|more)|increase.*adult|add.*adult|\+ .*adult/i.test((b.getAttribute('aria-label') || '') + ' ' + (b.innerText || '')));
    if (inc) { inc.click(); return 'aria-inc'; }
    // fallback: a "+" button near "Adults"
    const plus = btns.find((b) => /^\+$/.test((b.innerText || '').trim()) || /add|plus|increase/i.test(b.getAttribute('aria-label') || ''));
    if (plus) { plus.click(); return 'plus-fallback'; }
    return 'none';
  }).then((r) => console.log('adults + click:', r)).catch(() => {});
  await sleep(500);
  const guestText2 = await page.locator('button:has-text("Guest")').first().innerText().catch(() => '?');
  console.log('guest btn now:', JSON.stringify(guestText2));
  // close guest panel by clicking Search (or pressing Escape)
  await page.keyboard.press('Escape').catch(() => {});

  // Search button
  const search = page.locator('button.cb-search-button').first();
  const disabled = await search.isDisabled().catch(() => 'err');
  console.log('search disabled?', disabled);
  if (!disabled) {
    await search.click({ timeout: 6000 }).catch((e) => console.log('search click err', String(e).slice(0, 80)));
    console.log('search clicked');
  }
  await sleep(6000); // results load

  // dump room/rate Book buttons
  const rooms = await page.evaluate(() => {
    const out = [];
    // Chakra engine: each rate has a "Book Now" or "Reserve" or currency button. Capture all visible book-ish buttons.
    const cands = Array.from(document.querySelectorAll('button, a')).filter((b) => {
      const t = ((b.innerText || '') + ' ' + (b.getAttribute('aria-label') || '')).trim();
      return /book|reserve|select|continue|book now|reserve now/i.test(t) && b.getBoundingClientRect().width > 0;
    });
    for (const b of cands.slice(0, 12)) {
      out.push({ tag: b.tagName, text: (b.innerText || '').trim().slice(0, 24), cls: (b.className || '').toString().slice(0, 70), id: b.id || null, disabled: b.disabled });
    }
    // room card containers
    const cards = Array.from(document.querySelectorAll('[class*="room" i], [class*="rate" i], [class*="accommodation" i]')).filter((e) => e.getBoundingClientRect().width > 0).slice(0, 8).map((e) => ({ tag: e.tagName, cls: (e.className || '').toString().slice(0, 70), text: (e.innerText || '').slice(0, 60).replace(/\n/g, ' ') }));
    // availability text
    const bodyHead = (document.body.innerText || '').slice(0, 300);
    return { bookBtns: out, cards, bodyHead };
  }).catch(() => ({}));
  console.log('ROOMS after search:', JSON.stringify(rooms, null, 2));

  await page.screenshot({ path: 'data/fatwave-search-results.png', fullPage: false }).catch(() => {});
  await ctx.close();
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
