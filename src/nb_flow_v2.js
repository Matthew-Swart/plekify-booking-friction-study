// NightsBridge v2 probe — drives the real Angular UI:
//  1. Tests MORE deep-link param shapes (incl. NB's documented `?dd=...` & `nbid`/`rid` shapes)
//  2. Drives the single date-RANGE picker (calendar) to T+45/T+47
//  3. Clicks CHECK AVAILABILITY -> first BOOK NOW -> reports payment-page indicator
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
chromium.use(StealthPlugin());

const ID = process.argv[2] || '19876';
const BASE = `https://book.nightsbridge.com/${ID}`;
const today = new Date(); today.setHours(0,0,0,0);
const ci = new Date(today.getTime() + 45*86400000);
const co = new Date(today.getTime() + 47*86400000);
const pad = n => String(n).padStart(2,'0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const ciISO = iso(ci), coISO = iso(co);
const MONTHS_S = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTHS_L = ['January','February','March','April','May','June','July','August','September','October','November','December'];
// Visible-calendar text formats observed on NB
const ciDMoY = `${pad(ci.getDate())} ${MONTHS_L[ci.getMonth()]} ${ci.getFullYear()}`;
const ciDMoShort = `${pad(ci.getDate())} ${MONTHS_S[ci.getMonth()]} ${ci.getFullYear()}`;
const ciD = String(ci.getDate());
const coD = String(co.getDate());

const log = (...a) => console.log('[nb]', ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function deepLinkProbe(page){
  // Expanded list — covers NB public docs (`?dd=`, `&adults=`, `nbid`/`rid`) plus common shapes.
  const cands = [
    `?dd=${ciISO}&ad=${coISO}&adults=2`,
    `?dd=${ciISO}&dd2=${coISO}&adults=2`,
    `?arrival=${ciISO}&departure=${coISO}`,
    `?checkin=${ciISO}&checkout=${coISO}`,
    `?cid=${ciISO.replace(/-/g,'')}&cod=${coISO.replace(/-/g,'')}`,
    `?dd=${ciISO}|${coISO}|2`,
    // NB documented multi-property search shape
    `?nbid=${ID}&dd=${ciISO}&ad=${coISO}`,
  ];
  for (const qs of cands){
    const url = BASE + qs;
    log(`\nTRY ${url}`);
    try {
      await page.goto(url, { waitUntil: 'networkidle' });
      await sleep(2500);
      const val = await page.inputValue('input.landing-date-range-pick').catch(()=>null);
      const bodyHasCi = await page.evaluate(([d1,d2]) => document.body.innerText.includes(d1)||document.body.innerText.includes(d2), [ciDMoY, ciDMoShort]);
      log(`  dateRangeValue="${val}" bodyHasTargetCi=${bodyHasCi}`);
      if (bodyHasCi || (val && val.includes(String(ci.getDate())) && val.includes(String(co.getDate())))) {
        log(`  >>> DEEP LINK ACCEPTED: ${qs}`);
        return qs;
      }
    } catch(e){ log('  err', e.message.split('\n')[0]); }
  }
  return null;
}

async function pickDatesViaCalendar(page){
  // Click the date-range input -> opens a calendar popup. Navigate months forward to ci's month.
  const input = await page.$('input.landing-date-range-pick');
  if (!input) { log('NO date-range input!'); return false; }
  await input.click({timeout:5000});
  await sleep(800);
  await dumpCal(page, 'calendar open');
  // Navigate forward until we see ci's month/year.
  for (let i=0;i<14;i++){
    const header = await page.evaluate(() => {
      const el = document.querySelector('.mat-calendar-content, [class*="calendar"], .drp-calendar, .day-calendar, .month-calendar, .daterangepicker');
      return el ? el.innerText.slice(0,200) : null;
    });
    const inMonth = header && header.includes(MONTHS_L[ci.getMonth()]) && header.includes(String(ci.getFullYear()));
    log(`  cal nav ${i}: header=${JSON.stringify(header&&header.slice(0,60))} inTargetMonth=${inMonth}`);
    if (inMonth) break;
    // click next-month arrow (try several selectors)
    const next = await page.$('[class*="next"], .mat-calendar-next-button, .calendar-right-icon, [aria-label*="next month" i], button.daterangepicker + .next, th.next') ||
                 await page.$('button:has(svg[class*="right"]), .chevron-right, [data-handler="next"]');
    if (!next){ log('  no next-arrow found, abort nav'); break; }
    try { await next.click({timeout:3000}); await sleep(400); } catch(e){ log('  next click err', e.message.split('\n')[0]); break; }
  }
  // Now click ci day then co day. NB uses daterangepicker-style .available cells.
  const ciCell = await page.$(`[data-title="${MONTHS_S[ci.getMonth()].toLowerCase()}${ci.getDate()}"] .available, td.available_off:not(.off):has-text("${ciD}"), .calendar-table td:not(.off):has-text("${ciD}")`);
  let ciClicked = false;
  try {
    // Generic approach: click the cell whose text === ciD and is not disabled/off.
    const cells = await page.$$(`.calendar-table td, .drp-calendar td, .mat-calendar-body-cell, td.available`);
    for (const c of cells){
      const t = (await c.innerText()).trim();
      if (t === ciD){ const cls = await c.getAttribute('class'); if (!/off|disabled|unselectable/i.test(cls||'')){ await c.click({timeout:3000}); ciClicked = true; log(`  ci day clicked via generic`); break; } }
    }
  } catch(e){ log('  ci click err', e.message.split('\n')[0]); }
  await sleep(500);
  // checkout day
  try {
    const cells = await page.$$(`.calendar-table td, .drp-calendar td, .mat-calendar-body-cell, td.available`);
    for (const c of cells){
      const t = (await c.innerText()).trim();
      if (t === coD){ const cls = await c.getAttribute('class'); if (!/off|disabled|unselectable/i.test(cls||'')){ await c.click({timeout:3000}); log(`  co day clicked via generic`); break; } }
    }
  } catch(e){ log('  co click err', e.message.split('\n')[0]); }
  await sleep(700);
  const finalVal = await page.inputValue('input.landing-date-range-pick').catch(()=>null);
  log(`  final dateRangeValue="${finalVal}"`);
  return finalVal && finalVal.includes(coD);
}

async function dumpCal(page, tag){
  const info = await page.evaluate(() => {
    const popups = [...document.querySelectorAll('[class*="calendar"], [class*="daterangepicker"], [class*="popup"], [role="dialog"]')]
      .map(e => ({cls:(e.className||'').toString().slice(0,90), vis: !!(e.offsetWidth||e.offsetHeight)}))
      .slice(0,8);
    return {popups, hasCalTd: !!document.querySelector('td.available, .calendar-table td')};
  });
  log(`  [${tag}] cal popups=${JSON.stringify(info)}`);
}

async function run(){
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    locale: 'en-GB', timezoneId: 'Africa/Johannesburg',
  });
  ctx.setDefaultTimeout(12000);
  const page = await ctx.newPage();
  const out = { system:'nightsbridge', id:ID, BASE, ciISO, coISO };

  // 1) deep link
  out.deepLinkPattern = await deepLinkProbe(page);

  // 2) reset to bare and drive calendar
  log(`\n=== FLOW from bare ${BASE}`);
  await page.goto(BASE, { waitUntil:'networkidle' });
  await sleep(2500);

  // cookie banner? NB itself has none; GTM only. Record if any.
  out.cookieDismiss = null;

  out.datesPicked = await pickDatesViaCalendar(page);

  // capture search-action selector that worked
  const searchSel = 'button.check-avl-btn, button.pr-button.check-avl-btn';
  try { await page.click(searchSel, {timeout:5000}); out.searchSel = searchSel; log('search clicked'); }
  catch(e){ log('search click err', e.message.split('\n')[0]); out.searchSel = null; }
  await sleep(3500);

  // results: first per-rate BOOK NOW
  const bookSel = 'button.btn-book-now, button:has-text("BOOK NOW")';
  const finalUrlBefore = page.url();
  let navHappened = false;
  try {
    const navP = page.waitForURL(u => u !== finalUrlBefore, {timeout:8000}).catch(()=>null);
    await page.click(bookSel, {timeout:5000});
    out.bookSel = bookSel; log('book clicked');
    await Promise.race([navP, sleep(5000)]);
    navHappened = page.url() !== finalUrlBefore;
  } catch(e){ out.bookSel = null; log('book click err', e.message.split('\n')[0]); }
  await sleep(3000);

  const finalUrl = page.url();
  const bodyText = await page.evaluate(() => document.body.innerText.slice(0,5000));
  const hints = await page.evaluate(() => ({
    cardNum: !!document.querySelector('input[name*="card" i], input[autocomplete="cc-number"], input[placeholder*="card number" i], input[id*="cardnumber" i]'),
    cvv: !!document.querySelector('input[autocomplete="cc-csc"], input[name*="cvv" i], input[placeholder*="cvv" i]'),
    payNowBtn: !!document.querySelector('button:has-text("Pay"), button:has-text("PAY NOW"), button:has-text("Confirm")'),
    payIframe: !!document.querySelector('iframe[name*="pay" i], iframe[src*="pay" i], iframe[src*="checkout" i], iframe[src*="bridgepay" i]'),
  }));
  const urlPays = /payment|paynow|bridgepay|checkout|secure-payment|nb_pay/i.test(finalUrl) && finalUrl !== BASE;
  const paymentReached = urlPays || hints.cardNum || hints.cvv || hints.payNowBtn || hints.payIframe ||
    /payment details|card number|cvv|pay now|deposit|credit card/i.test(bodyText);
  out.finalUrl = finalUrl;
  out.paymentReached = !!paymentReached;
  out.paymentIndicator = urlPays ? `URL: ${finalUrl}`
    : hints.cardNum ? 'card-number input visible'
    : hints.cvv ? 'cvv input visible'
    : hints.payNowBtn ? 'PAY/Confirm button visible'
    : hints.payIframe ? 'payment iframe present'
    : /payment|card number|cvv|pay now/i.test(bodyText) ? 'payment-related copy on page'
    : 'NONE — still on availability page';
  out.bodyHead = bodyText.slice(0,1200).replace(/\n+/g,' | ');
  out.navAfterBook = navHappened;

  // evidence
  try {
    const fs = await import('node:fs');
    await page.screenshot({ path:`tmp/nb_${ID}_v2_final.png`, fullPage:true });
    fs.writeFileSync(`tmp/nb_${ID}_v2_body.txt`, bodyText);
    fs.writeFileSync(`tmp/nb_${ID}_v2_result.json`, JSON.stringify(out,null,2));
  } catch(e){ log('ev err', e.message); }

  log('\n=== RESULT ===');
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
}
run().catch(e=>{console.error('[nb] FATAL',e);process.exit(1);});
