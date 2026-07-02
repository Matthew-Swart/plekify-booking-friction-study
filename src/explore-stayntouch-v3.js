// Stayntouch IBE v3 — confirmed inline datepicker + per-rate Book Now CTA.
// Selectors verified against /tmp/americana-final.html.
//
// Run: node src/explore-stayntouch-v3.js [propertyName]

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
  const pad = (n) => String(n(n));
  return {
    iso: { ci: `${ci.getFullYear()}-${pad(ci.getMonth() + 1)}-${pad(ci.getDate())}`,
           co: `${co.getFullYear()}-${pad(co.getMonth() + 1)}-${pad(co.getDate())}` },
    dayNum: { ci: String(ci.getDate()), co: String(co.getDate()) },
    jsMonthIdx: { ci: ci.getMonth(), co: co.getMonth() }, // 0-indexed for data-month attr
    year: { ci: ci.getFullYear(), co: co.getFullYear() },
  };
}
const _pad = (n) => String(n).padStart(2, '0');
function datesFixed() {
  const ci = new Date(); ci.setDate(ci.getDate() + 45);
  const co = new Date(); co.setDate(co.getDate() + 47);
  return {
    iso: { ci: `${ci.getFullYear()}-${_pad(ci.getMonth() + 1)}-${_pad(ci.getDate())}`,
           co: `${co.getFullYear()}-${_pad(co.getMonth() + 1)}-${_pad(co.getDate())}` },
    dayNum: { ci: String(ci.getDate()), co: String(co.getDate()) },
    jsMonthIdx: { ci: ci.getMonth(), co: co.getMonth() }, // data-month uses JS 0-indexed
    year: { ci: ci.getFullYear(), co: co.getFullYear() },
    monthName: { ci: ci.toLocaleDateString('en-US', { month: 'long' }), co: co.toLocaleDateString('en-US', { month: 'long' }) },
  };
}

const log = (...a) => console.log('[v3]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function dismissCookie(page) {
  const sels = [
    '#onetrust-accept-btn-handler', '#truste-consent-button',
    'button:has-text("Accept All")', 'button:has-text("Accept all")',
    'button:has-text("Accept")', 'button:has-text("Got it")',
    'button:has-text("Allow all")', 'button:has-text("I Agree")',
    '[class*="cookie" i] button', '[id*="cookie" i] button',
  ];
  for (const s of sels) {
    const el = page.locator(s).first();
    if (await el.isVisible({ timeout: 700 }).catch(() => false)) {
      try { await el.click({ timeout: 1500 }); log('cookie:', s); await sleep(400); return s; } catch {}
    }
  }
  return null;
}

// Pick a date in Stayntouch's inline jQuery UI datepicker.
// Selector: td[data-handler="selectDay"][data-month="{jsIdx}"][data-year="{year}"] a (text=dayNum)
// Must navigate months first if the target isn't visible in either of the 2 shown months.
async function pickDate(page, d, which) {
  const targetDay = d.dayNum[which];
  const targetMonthIdx = d.jsMonthIdx[which];
  const targetYear = d.year[which];
  log(`pickDate(${which}): day=${targetDay} jsMonthIdx=${targetMonthIdx} year=${targetYear}`);

  // Try direct click on the cell if it's in the visible 2-month spread
  async function tryClickDirect() {
    const cell = page.locator(
      `.ui-datepicker-inline td[data-handler="selectDay"][data-month="${targetMonthIdx}"][data-year="${targetYear}"]`
    ).filter({ hasText: new RegExp(`^${targetDay}$`) }).first();
    if (await cell.isVisible({ timeout: 800 }).catch(() => false)) {
      try {
        await cell.locator('a').first().click({ timeout: 2500 });
        log(`  clicked ${which} directly`);
        return true;
      } catch (e) { log('  direct click err', e.message); }
    }
    return false;
  }

  if (await tryClickDirect()) return 'td[data-handler="selectDay"][data-month][data-year] a';

  // Navigate forward until the target month appears in the multi-cal
  const inline = page.locator('.ui-datepicker-inline').first();
  for (let i = 0; i < 18; i++) {
    // Read both shown months/years
    const shown = await inline.evaluate((root) => {
      const titles = Array.from(root.querySelectorAll('.ui-datepicker-title')).map((t) => ({
        month: (t.querySelector('.ui-datepicker-month')?.innerText || '').trim(),
        year: parseInt((t.querySelector('.ui-datepicker-year')?.innerText || '0'), 10),
      }));
      return titles;
    }).catch(() => []);
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const targetMonthName = months[targetMonthIdx];
    const inView = shown.some((s) => s.year === targetYear && s.month.toLowerCase() === targetMonthName.toLowerCase());
    if (inView) break;
    // click next
    const next = inline.locator('.ui-datepicker-next').first();
    try { await next.click({ timeout: 1500 }); await sleep(450); }
    catch (e) { log('  next click err', e.message); break; }
  }
  if (await tryClickDirect()) return 'td[data-handler="selectDay"][data-month][data-year] a (after nav)';

  // Fallback: any td with the right data-month/year + text
  const fallback = page.locator(`.ui-datepicker-inline td[data-month="${targetMonthIdx}"][data-year="${targetYear}"]`).filter({ hasText: targetDay }).first();
  if (await fallback.isVisible({ timeout: 800 }).catch(() => false)) {
    try { await fallback.click({ timeout: 2500 }); log(`  clicked ${which} via fallback`); return 'td[data-month][data-year] fallback'; } catch {}
  }
  log(`  FAILED to pick ${which}`);
  return null;
}

async function domSummary(page, label) {
  const dom = await page.evaluate(() => {
    const fmt = (el) => ({
      tag: el.tagName.toLowerCase(), id: el.id || null, class: typeof el.className === 'string' ? el.className.slice(0, 80) : null,
      type: el.type || null, name: el.getAttribute('name'), aria: el.getAttribute('aria-label'),
      text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60),
      vis: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length),
    });
    const pick = (sel) => Array.from(document.querySelectorAll(sel)).map(fmt);
    return {
      url: location.href,
      inputs: pick('input, select, textarea').filter((x) => x.vis),
      buttons: pick('button').filter((x) => x.vis || x.type === 'submit'),
      links: pick('a').filter((x) => x.vis && /book|reserv|check|search|availab|select|continue|pay|add/i.test((x.text || '') + (x.id || '') + (x.class || ''))),
      rateCards: pick('[class*="rate" i], [class*="room" i]').filter((x) => x.vis).slice(0, 8),
      headings: pick('h1, h2').filter((x) => x.vis).slice(0, 5),
      iframes: pick('iframe'),
    };
  }).catch((e) => ({ error: e.message }));
  log(`--- ${label} ---  url=${dom.url}  inputs:${(dom.inputs||[]).length} buttons:${(dom.buttons||[]).length} links:${(dom.links||[]).length}`);
  return dom;
}

async function explore(key) {
  const prop = PROPERTIES[key];
  const d = datesFixed();
  log(`\n################ ${prop.name} (${key}) ################`);
  log(`ci=${d.iso.ci} (day ${d.dayNum.ci}, JS month ${d.jsMonthIdx.ci}=${d.monthName.ci})  co=${d.iso.co}`);

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
    await sleep(4000);
    out.cookieDismissSelector = await dismissCookie(page);
    out.steps.push({ action: 'goto', selector: null, desc: 'load IBE homepage', value: prop.url });

    // Adults default = 2 already; verify and confirm
    const adultsVal = await page.locator('#adults').first().inputValue().catch(() => null);
    out.steps.push({ action: 'verifyAdults', selector: '#adults', desc: `adults select (default ${adultsVal})`, value: adultsVal });
    if (adultsVal !== '2') {
      try { await page.locator('#adults').first().selectOption('2'); out.steps.push({ action: 'selectOption', selector: '#adults', desc: 'set adults=2', value: '2' }); } catch {}
    }

    // Pick CI then CO in inline datepicker (this auto-submits search in Stayntouch)
    const ciPick = await pickDate(page, d, 'ci');
    out.steps.push({ action: 'clickDate', selector: ciPick, desc: `select check-in ${d.iso.ci}`, value: d.iso.ci });
    await sleep(1200);
    const coPick = await pickDate(page, d, 'co');
    out.steps.push({ action: 'clickDate', selector: coPick, desc: `select check-out ${d.iso.co}`, value: d.iso.co });
    await sleep(4500); // let availability results render

    await domSummary(page, 'after dates picked');
    fs.writeFileSync(`/tmp/${key}-afterdates.html`, await page.content());

    // Look for rate/room cards with a Book Now CTA
    // We saw: <div class="hotel-price-book"><button class="btn" aria-label="Book now"><span>Book Now</span></button></div>
    log('\n=== pick first available room/rate ===');
    const rateBookMatchers = [
      '.hotel-price-book button:visible',
      '.hotel-pricemain-block button:visible',
      'button.btn[aria-label="Book now"]:visible',
      'button:has-text("Book Now"):visible',
      'button:has-text("Reserve"):visible',
      'button:has-text("Select"):visible',
      'a:has-text("Book Now"):visible',
      '[class*="rate" i] button:visible',
    ];
    let rateBookSel = null;
    for (const m of rateBookMatchers) {
      const loc = page.locator(m).first();
      if (await loc.isVisible({ timeout: 800 }).catch(() => false)) {
        rateBookSel = m; break;
      }
    }
    out.steps.push({ action: 'click', selector: rateBookSel, desc: 'first room/rate "Book Now"' });
    log('rate book selector:', rateBookSel);
    if (rateBookSel) {
      try { await page.locator(rateBookSel).first().click({ timeout: 3000 }); } catch (e) { log('rate click err', e.message); }
      await sleep(5000);
    }
    await domSummary(page, 'after rate book click');
    fs.writeFileSync(`/tmp/${key}-afterrate.html`, await page.content());

    // Possible intermediate: "Add to Cart" / extras page. Click any Continue/Add to Cart.
    const interMatchers = [
      'button:has-text("Add to Cart")',
      'button:has-text("Add to Stay")',
      'button:has-text("Continue")',
      'button:has-text("Next")',
      'a:has-text("Continue")',
      'button:has-text("Reserve")',
    ];
    let interSel = null;
    for (const m of interMatchers) {
      const loc = page.locator(m).first();
      if (await loc.isVisible({ timeout: 700 }).catch(() => false)) { interSel = m; break; }
    }
    if (interSel) {
      out.steps.push({ action: 'click', selector: interSel, desc: 'intermediate continue (extras/cart)' });
      log('intermediate continue:', interSel);
      try { await page.locator(interSel).first().click({ timeout: 3000 }); } catch (e) { log('inter err', e.message); }
      await sleep(4000);
      await domSummary(page, 'after intermediate');
    }

    // Guest details page — fill required fields
    log('\n=== fill guest form (best-effort) ===');
    const guestFilled = [];
    for (const [sel, val, kind] of [
      ['input[name*="first" i]:visible', 'Test', 'fill'],
      ['input[name*="last" i]:visible', 'Guest', 'fill'],
      ['input[type="email"]:visible', 'friction.test@example.com', 'fill'],
      ['input[name*="email" i]:visible', 'friction.test@example.com', 'fill'],
      ['input[type="tel"]:visible', '5555555555', 'fill'],
      ['input[name*="phone" i]:visible', '5555555555', 'fill'],
      ['select[name*="country" i]:visible', 'US', 'select'],
      ['select[id*="country" i]:visible', 'US', 'select'],
      ['input[name*="zip" i]:visible', '00000', 'fill'],
      ['input[name*="postal" i]:visible', '00000', 'fill'],
      ['input[name*="address" i]:visible', '1 Test St', 'fill'],
      ['input[name*="city" i]:visible', 'Testville', 'fill'],
    ]) {
      const loc = page.locator(sel).first();
      if (await loc.isVisible({ timeout: 350 }).catch(() => false)) {
        try { kind === 'select' ? await loc.selectOption(val).catch(() => {}) : await loc.fill(val).catch(() => {}); guestFilled.push(sel); } catch {}
      }
    }
    out.steps.push({ action: 'fill', selector: null, desc: 'guest form best-effort', value: guestFilled });
    log('guest fields filled:', guestFilled.length);

    // Continue → payment
    log('\n=== continue to payment ===');
    const contMatchers = [
      'button:has-text("Continue to Payment")',
      'button:has-text("Continue")',
      'button:has-text("Proceed to Payment")',
      'button:has-text("Review Payment")',
      'button:has-text("Pay Now")',
      'button:has-text("Review")',
      'button:has-text("Next")',
      'a:has-text("Continue")',
    ];
    let contSel = null;
    for (const m of contMatchers) {
      const loc = page.locator(m).first();
      if (await loc.isVisible({ timeout: 700 }).catch(() => false)) { contSel = m; break; }
    }
    out.steps.push({ action: 'click', selector: contSel, desc: 'continue to payment' });
    log('continue selector:', contSel);
    if (contSel) {
      try { await page.locator(contSel).first().click({ timeout: 3000 }); } catch (e) { log('cont err', e.message); }
      await sleep(6000);
    }
    await domSummary(page, 'after continue');
    fs.writeFileSync(`/tmp/${key}-aftercontinue.html`, await page.content());

    // PAYMENT DETECTION
    log('\n=== PAYMENT DETECTION ===');
    const url = page.url();
    const paymentUrlRegex = /(\/checkouts?\/)|(\/checkout)|(\/?payment)|(\/book\/.*pay)|(\/reservation.*pay)|(\/pay($|\/))/i;
    const urlHit = paymentUrlRegex.test(url);
    const cardIframes = await page.$$eval('iframe', (fs) => fs.map((f) => ({ src: f.src, name: f.name, id: f.id, title: f.title }))).catch(() => []);
    const paymentCardIframes = cardIframes.filter((f) => /card|payment|stripe|spreedly|worldpay|authorize|cybersource|hps|securesubmit|tokenex|sagepay|adyen|braintree|vantiv|globalpay|moneris/i.test(JSON.stringify(f)));
    const cardInputVisible = await page.locator('input[name*="card" i]:visible, input[id*="card" i]:visible, input[autocomplete="cc-number"]:visible, input[name*="cc" i]:visible').first().isVisible({ timeout: 700 }).catch(() => false);
    const paymentHeadingVisible = await page.locator('h1:has-text("Payment"), h2:has-text("Payment"), h2:has-text("Billing"), [class*="payment" i]:visible').first().isVisible({ timeout: 700 }).catch(() => false);
    const recaptcha = {
      script: await page.locator('script[src*="recaptcha"]').count(),
      iframe: await page.locator('iframe[src*="recaptcha"], iframe[title*="reCAPTCHA" i]').count(),
      grecaptcha: await page.evaluate(() => typeof window.grecaptcha !== 'undefined').catch(() => false),
    };

    out.paymentReached = urlHit || cardInputVisible || paymentHeadingVisible || paymentCardIframes.length > 0;
    out.paymentIndicator = { urlHit, finalUrl: url, cardInputVisible, paymentHeadingVisible, paymentCardIframes };
    out.final = { url, iframes: cardIframes, recaptcha };
    log('PAYMENT DETECTION:', JSON.stringify(out.paymentIndicator));
    log('iframes:', JSON.stringify(cardIframes));
    log('recaptcha:', JSON.stringify(recaptcha));

    await page.screenshot({ path: `/tmp/${key}-final.png`, fullPage: false }).catch(() => {});

  } catch (e) {
    out.error = e.message; log('FATAL', e.message);
  } finally {
    fs.writeFileSync(`/tmp/${key}-result-v3.json`, JSON.stringify(out, null, 2));
    await browser.close();
  }
  return out;
}

const arg = process.argv[2] || 'americana';
if (arg === 'all') {
  (async () => {
    const R = {};
    for (const k of Object.keys(PROPERTIES)) R[k] = await explore(k);
    fs.writeFileSync('/tmp/stayntouch-all-v3.json', JSON.stringify(R, null, 2));
    log('\nALL DONE');
  })();
} else explore(arg);
