// Stayntouch IBE v2 — focused flow explorer.
// Lesson from v1: the landing hero has a "Book Now" CTA that opens the booking
// widget (which contains date inputs/selects). jQuery UI datepicker uses <td>
// cells with data-* attrs (NOT data-date) and event handlers (need real click).
//
// Run: node src/explore-stayntouch-v2.js [propertyName]

import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'node:fs';

chromium.use(StealthPlugin());

const PROPERTIES = {
  americana: { name: 'Americana Motor Hotel', url: 'https://americanamotorhotel.ibe.stayntouch.com/' },
  essex: { name: 'The Essex Resort & Spa', url: 'https://essexresort.ibe.stayntouch.com/' },
  parkring: { name: 'Hotel Am Parkring', url: 'https://hotelamparkring.ibe.stayntouch.com/?lang=en' },
};

function dates() {
  const ci = new Date(); ci.setDate(ci.getDate() + 45);
  const co = new Date(); co.setDate(co.getDate() + 47);
  const pad = (n) => String(n).padStart(2, '0');
  return {
    iso: { ci: `${ci.getFullYear()}-${pad(ci.getMonth() + 1)}-${pad(ci.getDate())}`,
           co: `${co.getFullYear()}-${pad(co.getMonth() + 1)}-${pad(co.getDate())}` },
    dayNum: { ci: String(ci.getDate()), co: String(co.getDate()) },
    monthYear: { ci: { month: ci.toLocaleDateString('en-US', { month: 'long' }), year: ci.getFullYear() },
                 co: { month: co.toLocaleDateString('en-US', { month: 'long' }), year: co.getFullYear() } },
    localized: {
      ci: ci.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      co: co.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    },
    mmddyy: {
      ci: `${pad(ci.getMonth() + 1)}/${pad(ci.getDate())}/${String(ci.getFullYear()).slice(2)}`,
      co: `${pad(co.getMonth() + 1)}/${pad(co.getDate())}/${String(co.getFullYear()).slice(2)}`,
    },
  };
}

const log = (...a) => console.log('[v2]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function dismissCookie(page) {
  const candidates = [
    '#onetrust-accept-btn-handler', '#truste-consent-button',
    'button:has-text("Accept All")', 'button:has-text("Accept all")',
    'button:has-text("Accept")', 'button:has-text("Got it")',
    'button:has-text("Allow all")', 'button:has-text("I Agree")',
    '[class*="cookie" i] button', '[id*="cookie" i] button',
  ];
  for (const sel of candidates) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 700 }).catch(() => false)) {
      try { await el.click({ timeout: 1500 }); log('cookie:', sel); await sleep(400); return sel; } catch {}
    }
  }
  return null;
}

async function dumpDom(page, label, fileKey) {
  log(`--- ${label} ---`);
  log('url:', page.url(), 'title:', await page.title().catch(() => ''));
  const dom = await page.evaluate(() => {
    const fmt = (el) => ({
      tag: el.tagName.toLowerCase(), id: el.id || null, class: typeof el.className === 'string' ? el.className : null,
      type: el.type || null, name: el.getAttribute('name'), ph: el.placeholder || null,
      aria: el.getAttribute('aria-label'), value: el.value || null,
      data: Object.fromEntries(Array.from(el.attributes).filter((a) => a.name.startsWith('data-')).map((a) => [a.name, a.value])),
      text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 50),
      vis: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length),
    });
    const pick = (sel) => Array.from(document.querySelectorAll(sel)).map(fmt);
    return {
      inputs: pick('input, select, textarea').filter((x) => x.vis),
      buttons: pick('button').filter((x) => x.vis || x.type === 'submit'),
      links: pick('a').filter((x) => x.vis && /book|reserv|check|search|availab|select|continue|pay/i.test(x.text + x.id + x.class)),
      datepickerCells: pick('#ui-datepicker-div td, .ui-datepicker td').slice(0, 50),
      datepickerHeaders: pick('#ui-datepicker-div .ui-datepicker-title, .ui-datepicker .ui-datepicker-title'),
    };
  }).catch((e) => ({ error: e.message }));
  fs.writeFileSync(`/tmp/${fileKey}-${label.replace(/\W+/g, '_')}.json`, JSON.stringify(dom, null, 2));
  log(`inputs:${(dom.inputs || []).length} buttons:${(dom.buttons || []).length} links:${(dom.links || []).length} dpcells:${(dom.datepickerCells || []).length}`);
  return dom;
}

async function clickByText(page, matchers, { timeout = 2500 } = {}) {
  for (const m of matchers) {
    const loc = page.locator(m).first();
    if (await loc.isVisible({ timeout: 600 }).catch(() => false)) {
      try { await loc.click({ timeout }); await sleep(800); return m; } catch (e) { log('click err', m, e.message); }
    }
  }
  return null;
}

async function pickJquiDate(page, d, which /* 'ci' | 'co' */, fileKey) {
  // Navigate to the right month, then click the day cell.
  const targetMonth = d.monthYear[which].month;
  const targetYear = d.monthYear[which].year;
  const targetDay = d.dayNum[which];
  log(`pickDate(${which}): target ${targetMonth} ${targetDay}, ${targetYear}`);

  // ensure datepicker visible
  const dp = page.locator('#ui-datepicker-div:visible').first();
  if (!(await dp.isVisible({ timeout: 1000 }).catch(() => false))) {
    log('  datepicker not visible');
    return null;
  }

  // navigate months until header matches
  for (let i = 0; i < 24; i++) {
    const title = await dp.locator('.ui-datepicker-title').first().innerText().catch(() => '');
    if (title.toLowerCase().includes(targetMonth.toLowerCase()) && title.includes(String(targetYear))) break;
    // determine direction
    const monthIdxTitle = await dp.locator('.ui-datepicker-month').first().innerText().catch(() => '');
    const targetIdx = ['January','February','March','April','May','June','July','August','September','October','November','December'].indexOf(targetMonth);
    const curIdx = ['January','February','March','April','May','June','July','August','September','October','November','December'].indexOf(monthIdxTitle.trim());
    const yearTxt = await dp.locator('.ui-datepicker-year').first().innerText().catch(() => '');
    const curYear = parseInt(yearTxt, 10) || targetYear;
    let forward;
    if (curYear !== targetYear) forward = curYear < targetYear;
    else forward = curIdx < targetIdx;
    const sel = forward ? '.ui-datepicker-next' : '.ui-datepicker-prev';
    try {
      await dp.locator(sel).first().click({ timeout: 1500 });
      await sleep(400);
    } catch (e) { log('  nav click err', sel, e.message); break; }
  }

  // click day cell — prefer data handlers, target cells WITHOUT "other-month" class
  const dayCell = page.locator(`#ui-datepicker-div td a:visible`).filter({ hasText: new RegExp(`^${targetDay}$`) }).first();
  if (await dayCell.isVisible({ timeout: 1000 }).catch(() => false)) {
    // make sure it's not an "other-month" cell
    const parentClass = await dayCell.evaluate((el) => el.closest('td').className).catch(() => '');
    if (/other-month/i.test(parentClass)) {
      // navigate one more
      try { await dp.locator('.ui-datepicker-next').first().click({ timeout: 1500 }); await sleep(400); } catch {}
    }
    try { await dayCell.click({ timeout: 2500 }); log(`  clicked ${which} day cell`); await sleep(900); return 'td a (jqui)'; }
    catch (e) { log('  day click err', e.message); }
  }

  // fallback: data-date attribute or aria-label
  const byData = page.locator(`#ui-datepicker-div td[data-date="${d.iso[which]}"] a`).first();
  if (await byData.isVisible({ timeout: 500 }).catch(() => false)) {
    try { await byData.click({ timeout: 2000 }); log(`  clicked ${which} via data-date`); return 'td[data-date] a'; } catch {}
  }
  const byAria = page.locator(`#ui-datepicker-div td[aria-label="${d.localized[which]}"] a`).first();
  if (await byAria.isVisible({ timeout: 500 }).catch(() => false)) {
    try { await byAria.click({ timeout: 2000 }); log(`  clicked ${which} via aria-label`); return 'td[aria-label] a'; } catch {}
  }
  log(`  could not pick ${which}`);
  return null;
}

async function explore(key) {
  const prop = PROPERTIES[key];
  const d = dates();
  log(`\n################ ${prop.name} (${key}) ################`);
  log(`dates iso ci=${d.iso.ci} co=${d.iso.co}  short=${d.mmddyy.ci}-${d.mmddyy.co}`);

  const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'] });
  const ctx = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'en-US',
  });
  await ctx.route('**/*.{png,jpg,jpeg,webp,gif,svg,woff,woff2,ttf,mp4}', (r) => r.abort());
  const page = await ctx.newPage();

  const out = { propKey: key, name: prop.name, dates: d.iso, steps: [], gotchas: [] };
  try {
    await page.goto(prop.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(3500);
    out.steps.push({ action: 'goto', url: prop.url, finalUrl: page.url() });
    out.cookieDismissSelector = await dismissCookie(page);

    // 1. Open the booking widget via hero "Book Now"
    log('\n=== STEP 1: open booking widget ===');
    const bookNowSel = await clickByText(page, [
      'button[aria-label="Book Now"]:visible',
      'button:has-text("Book Now")',
      'a:has-text("Book Now")',
    ], { timeout: 3000 });
    out.steps.push({ action: 'click', desc: 'hero Book Now — opens booking widget', selector: bookNowSel });
    await sleep(2500);
    const dom1 = await dumpDom(page, 'afterBookNow', key);
    if (!bookNowSel) {
      // Maybe the date inputs are already on the homepage (no modal). Check.
      log('no Book Now — checking if date widget already visible');
    }

    // 2. Open check-in datepicker
    log('\n=== STEP 2: open check-in datepicker ===');
    const ciTrigSel = await clickByText(page, [
      'input[placeholder*="Check In" i]:visible',
      'input[placeholder*="Check-in" i]:visible',
      'input[placeholder*="Arrival" i]:visible',
      'input[name*="check" i]:visible',
      'input[name*="arrival" i]:visible',
      'div[role="button"]:has-text("Check In")',
      'div[role="button"]:has-text("Arrival")',
      'button:has-text("Check In")',
      '[class*="check-in" i]:visible',
      '[class*="date-range" i] > div:visible',
    ]);
    out.steps.push({ action: 'click', desc: 'open check-in datepicker', selector: ciTrigSel });
    await sleep(1500);

    // 3. Pick CI then CO in the datepicker
    log('\n=== STEP 3: pick check-in date ===');
    const ciPick = await pickJquiDate(page, d, 'ci', key);
    out.steps.push({ action: 'clickDate', desc: `select check-in ${d.iso.ci}`, selector: ciPick, value: d.iso.ci });

    // datepicker may auto-close after CI; reopen for CO
    const dpVisible = await page.locator('#ui-datepicker-div:visible').first().isVisible({ timeout: 600 }).catch(() => false);
    if (!dpVisible) {
      const coTrig = await clickByText(page, [
        'input[placeholder*="Check Out" i]:visible',
        'input[placeholder*="Check-out" i]:visible',
        'input[placeholder*="Departure" i]:visible',
        'input[name*="check" i]:visible',
        'div[role="button"]:has-text("Check Out")',
        'div[role="button"]:has-text("Departure")',
      ]);
      out.steps.push({ action: 'click', desc: 'reopen datepicker for check-out', selector: coTrig });
      await sleep(1200);
    }
    log('\n=== STEP 4: pick check-out date ===');
    const coPick = await pickJquiDate(page, d, 'co', key);
    out.steps.push({ action: 'clickDate', desc: `select check-out ${d.iso.co}`, selector: coPick, value: d.iso.co });
    await sleep(700);

    // 4. Set adults = 2 (default often 2, but try)
    const adultsSel = await clickByText(page, [
      'select[name*="adult" i]:visible',
      '[class*="adult" i] [aria-label*="increase" i]',
    ]);
    if (adultsSel && adultsSel.includes('select')) {
      try {
        await page.locator(adultsSel).first().selectOption({ index: 1 }).catch(() => {}); // often 1 adult=idx0, 2=idx1
        log('adults select set');
      } catch {}
    }
    out.steps.push({ action: 'selectOption', desc: 'set adults=2', selector: adultsSel });

    // 5. Click Search/Check Availability
    log('\n=== STEP 5: search ===');
    const domPreSearch = await dumpDom(page, 'preSearch', key);
    const searchSel = await clickByText(page, [
      'button:has-text("Check Availability")',
      'button:has-text("Search")',
      'button:has-text("Find Rooms")',
      'button:has-text("Get Rates")',
      'button:has-text("Update")',
      'input[type="submit"]:visible',
      'button[type="submit"]:visible',
    ], { timeout: 3000 });
    out.steps.push({ action: 'click', desc: 'search availability', selector: searchSel });
    await sleep(5000);
    await dumpDom(page, 'afterSearch', key);
    log('url after search:', page.url());

    // 6. Pick first available room/rate
    log('\n=== STEP 6: pick room/rate ===');
    const bookSel = await clickByText(page, [
      'button:has-text("Book")',
      'button:has-text("Reserve")',
      'button:has-text("Select")',
      'button:has-text("Choose")',
      'a:has-text("Book")',
      'a:has-text("Reserve")',
      'a:has-text("Select")',
      '[class*="rate" i] button:visible',
      '[class*="room" i] button:visible',
    ], { timeout: 3000 });
    out.steps.push({ action: 'click', desc: 'first available room/rate CTA', selector: bookSel });
    await sleep(4500);
    await dumpDom(page, 'afterRate', key);
    log('url after rate click:', page.url());

    // 7. Fill guest form (best-effort)
    const guestFilled = [];
    for (const [sel, val, kind] of [
      ['input[name*="first" i]:visible', 'Test', 'fill'],
      ['input[name*="last" i]:visible', 'Guest', 'fill'],
      ['input[type="email"]:visible', 'friction.test@example.com', 'fill'],
      ['input[name*="email" i]:visible', 'friction.test@example.com', 'fill'],
      ['input[type="tel"]:visible', '5555555555', 'fill'],
      ['select[name*="country" i]:visible', 'US', 'select'],
    ]) {
      const loc = page.locator(sel).first();
      if (await loc.isVisible({ timeout: 400 }).catch(() => false)) {
        try { kind === 'select' ? await loc.selectOption(val) : await loc.fill(val); guestFilled.push(sel); } catch {}
      }
    }
    out.steps.push({ action: 'fill', desc: 'guest form best-effort', value: guestFilled });

    // 8. Continue → payment
    log('\n=== STEP 7: continue to payment ===');
    const contSel = await clickByText(page, [
      'button:has-text("Continue to Payment")',
      'button:has-text("Continue")',
      'button:has-text("Next")',
      'button:has-text("Proceed")',
      'button:has-text("Review")',
      'a:has-text("Continue")',
    ], { timeout: 3000 });
    out.steps.push({ action: 'click', desc: 'continue to payment', selector: contSel });
    await sleep(5500);
    await dumpDom(page, 'afterContinue', key);
    log('url after continue:', page.url());

    // 9. Payment detection
    log('\n=== PAYMENT DETECTION ===');
    const paymentUrlRegex = /(\/checkouts?\/)|(\/checkout)|(\/?payment)|(\/book\/.*pay)|(\/reservation.*pay)|(\/pay($|\/))/i;
    const url = page.url();
    const urlHit = paymentUrlRegex.test(url);
    const cardIframes = await page.$$eval('iframe', (fs) => fs.map((f) => ({ src: f.src, name: f.name, id: f.id, title: f.title }))).catch(() => []);
    const paymentCardIframes = cardIframes.filter((f) =>
      /card|payment|stripe|spreedly|worldpay|authorize|cybersource|hps|securesubmit|tokenex|checkout|sagepay|adyen|braintree/i.test(JSON.stringify(f)));
    const cardInputVisible = await page.locator('input[name*="card" i]:visible, input[id*="card" i]:visible, input[autocomplete="cc-number"]:visible').first().isVisible({ timeout: 600 }).catch(() => false);
    const paymentHeadingVisible = await page.locator('h1:has-text("Payment"), h2:has-text("Payment"), h2:has-text("Billing"), [class*="payment" i]:visible').first().isVisible({ timeout: 600 }).catch(() => false);
    const recaptcha = {
      script: await page.locator('script[src*="recaptcha"]').count(),
      iframe: await page.locator('iframe[src*="recaptcha"], iframe[title*="reCAPTCHA" i]').count(),
      grecaptcha: await page.evaluate(() => typeof window.grecaptcha !== 'undefined').catch(() => false),
    };

    out.paymentReached = urlHit || cardInputVisible || paymentHeadingVisible || paymentCardIframes.length > 0;
    out.paymentIndicator = { urlHit, finalUrl: url, cardInputVisible, paymentHeadingVisible, paymentCardIframes };
    out.final = {
      url, iframes: cardIframes, recaptcha,
      heading: await page.locator('h1:visible, h2:visible').first().innerText().catch(() => ''),
    };
    log('PAYMENT DETECTION:', JSON.stringify(out.paymentIndicator));
    log('iframes:', JSON.stringify(cardIframes));
    log('recaptcha:', JSON.stringify(recaptcha));

    fs.writeFileSync(`/tmp/${key}-final.html`, await page.content());
    await page.screenshot({ path: `/tmp/${key}-final.png`, fullPage: false }).catch(() => {});

  } catch (e) {
    out.error = e.message; log('FATAL', e.message, e.stack);
  } finally {
    fs.writeFileSync(`/tmp/${key}-result-v2.json`, JSON.stringify(out, null, 2));
    await browser.close();
  }
  return out;
}

const arg = process.argv[2] || 'americana';
if (arg === 'all') {
  (async () => {
    const R = {};
    for (const k of Object.keys(PROPERTIES)) R[k] = await explore(k);
    fs.writeFileSync('/tmp/stayntouch-all-v2.json', JSON.stringify(R, null, 2));
    log('\nALL DONE');
  })();
} else {
  explore(arg);
}
