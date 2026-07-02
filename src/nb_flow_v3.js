// NightsBridge v3 — corrected flow.
// Landing = (default dates text + "CHECK AVAILABILITY" + "VIEW CALENDAR"). The date-range <input>
// is in a hidden panel that "VIEW CALENDAR" reveals. Drive that, then BOOK NOW -> payment.
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
chromium.use(StealthPlugin());

const ID = process.argv[2] || '19876';
const BASE = `https://book.nightsbridge.com/${ID}`;
const today = new Date(); today.setHours(0,0,0,0);
const ci = new Date(today.getTime() + 45*86400000);
const co = new Date(today.getTime() + 47*86400000);
const pad = n => String(n).padStart(2,'0');
const ciISO = `${ci.getFullYear()}-${pad(ci.getMonth()+1)}-${pad(ci.getDate())}`;
const coISO = `${co.getFullYear()}-${pad(co.getMonth()+1)}-${pad(co.getDate())}`;
const MONTHS_S = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTHS_L = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const ciD = String(ci.getDate()), coD = String(co.getDate());

const log = (...a) => console.log('[nb]', ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run(){
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    locale: 'en-GB', timezoneId: 'Africa/Johannesburg',
  });
  ctx.setDefaultTimeout(10000);
  const page = await ctx.newPage();
  const out = { system:'nightsbridge', id:ID, BASE, ciISO, coISO };

  await page.goto(BASE, { waitUntil:'networkidle' });
  await sleep(2500);

  // Click VIEW CALENDAR to open the search panel
  const viewCal = 'button.avl-cl-btn, button:has-text("VIEW CALENDAR"), button:has-text("View Calendar")';
  try { await page.click(viewCal, {timeout:5000}); log('VIEW CALENDAR clicked'); }
  catch(e){ log('VIEW CALENDAR err', e.message.split('\n')[0]); }
  await sleep(1200);

  // Now the date-range input should be visible. Click it to open the calendar popup.
  const dr = 'input.landing-date-range-pick';
  try { await page.click(dr, {timeout:5000}); log('date-range input clicked'); }
  catch(e){ log('date-range click err', e.message.split('\n')[0]); }
  await sleep(900);

  // Inspect the calendar DOM to pick the right next-arrow + day cells.
  const calDom = await page.evaluate(() => {
    const pick = (sel, attrs=[]) => [...document.querySelectorAll(sel)].map(e => {
      const o = {cls:(e.className||'').toString().slice(0,80), tag:e.tagName.toLowerCase(), txt:(e.innerText||'').trim().slice(0,30)};
      for (const a of attrs) o[a] = e.getAttribute(a);
      return o;
    });
    return {
      tables: pick('table'),
      thArrows: pick('th', ['class','data-handler']),
      tds: pick('td.available, td.off, td:not(.week)').slice(0,60),
      divs: pick('div[class*="calendar"], div[class*="month"]').slice(0,12),
      visibleHdr: (document.querySelector('.calendar-table thead th.month, .daterangepicker .calendar-table th.month, [class*="month"]')||{}).innerText || null,
    };
  });
  log('calDom:', JSON.stringify(calDom).slice(0,800));

  // Navigate forward to ci's month using the standard daterangepicker .next arrow.
  for (let i=0;i<14;i++){
    const hdr = await page.evaluate(() => {
      const el = document.querySelector('.calendar-table thead th.month, .daterangepicker .calendar-table th.month, .month');
      return el ? el.innerText.trim() : null;
    });
    log(`  nav ${i} header="${hdr}"`);
    if (hdr && hdr.includes(MONTHS_L[ci.getMonth()]) && hdr.includes(String(ci.getFullYear()))) break;
    const nextSel = '.calendar-table th.next, th.next.available';
    try { await page.click(nextSel, {timeout:3000}); await sleep(350); }
    catch(e){ log('  next err', e.message.split('\n')[0]); break; }
  }

  // Click ci day, then co day
  const clickDay = async (day) => {
    const cells = await page.$$('td.available, td:not(.off):not(.week)');
    for (const c of cells){
      const t = (await c.innerText().catch(()=>'')).trim();
      if (t === day){
        const cls = await c.getAttribute('class').catch(()=> '');
        if (/off|disabled|unselectable/i.test(cls||'')) continue;
        try { await c.click({timeout:3000}); log(`  day ${day} clicked`); return true; }
        catch(e){}
      }
    }
    return false;
  };
  out.ciDayClicked = await clickDay(ciD);
  await sleep(500);
  out.coDayClicked = await clickDay(coD);
  await sleep(700);
  out.dateRangeVal = await page.inputValue('input.landing-date-range-pick').catch(()=>null);
  log(`dateRangeVal="${out.dateRangeVal}"`);

  // Apply / close calendar if there's an apply button
  for (const s of ['button.applyBtn', 'button:has-text("Apply")', 'button[data-handler="customRange"]']){
    try { const el = await page.$(s); if (el){ await el.click({timeout:2000}); log('apply clicked',s); break; } } catch {}
  }
  await sleep(500);

  // CHECK AVAILABILITY
  try { await page.click('button.check-avl-btn, button:has-text("CHECK AVAILABILITY")', {timeout:5000}); log('CHECK AVAILABILITY clicked'); }
  catch(e){ log('check-avl err', e.message.split('\n')[0]); }
  await sleep(3500);

  // First per-rate BOOK NOW. The body text earlier showed "BOOK NOW" appears at rate level after View Rates expands.
  // On NB the rate-level book button class is .btn-book-now; also try text.
  const bookSel = '.btn-book-now, button:has-text("BOOK NOW")';
  const urlBefore = page.url();
  let navHappened = false;
  try {
    const navP = page.waitForURL(u=>u!==urlBefore,{timeout:8000}).catch(()=>null);
    await page.click(bookSel, {timeout:5000});
    out.bookSel = bookSel; log('BOOK NOW clicked');
    await Promise.race([navP, sleep(5000)]);
    navHappened = page.url() !== urlBefore;
  } catch(e){ out.bookSel = null; log('book err', e.message.split('\n')[0]); }
  await sleep(3000);

  const finalUrl = page.url();
  const bodyText = await page.evaluate(() => document.body.innerText.slice(0,5000));
  const hints = await page.evaluate(() => ({
    cardNum: !!document.querySelector('input[name*="card" i], input[autocomplete="cc-number"], input[placeholder*="card number" i]'),
    cvv: !!document.querySelector('input[autocomplete="cc-csc"], input[name*="cvv" i], input[placeholder*="cvv" i]'),
    payNowBtn: !!document.querySelector('button:has-text("Pay"), button:has-text("PAY NOW"), button:has-text("Confirm Booking")'),
    payIframe: !!document.querySelector('iframe[name*="pay" i], iframe[src*="pay" i], iframe[src*="checkout" i], iframe[src*="bridgepay" i], iframe[src*="peach" i]'),
  }));
  const urlPays = /payment|paynow|bridgepay|checkout|secure-payment|pay-/i.test(finalUrl) && finalUrl !== BASE;
  const paymentReached = urlPays || hints.cardNum || hints.cvv || hints.payNowBtn || hints.payIframe ||
    /card number|cvv|pay now|credit card|payment details/i.test(bodyText);
  out.finalUrl = finalUrl;
  out.paymentReached = !!paymentReached;
  out.paymentIndicator = urlPays ? `URL: ${finalUrl}`
    : hints.cardNum ? 'card-number input visible'
    : hints.cvv ? 'cvv input visible'
    : hints.payNowBtn ? 'PAY/Confirm button visible'
    : hints.payIframe ? 'payment iframe present'
    : /card number|cvv|pay now|credit card/i.test(bodyText) ? 'payment-related copy'
    : 'NONE — still on availability/results page';
  out.navAfterBook = navHappened;
  out.bodyHead = bodyText.slice(0,1500).replace(/\n+/g,' | ');

  try {
    const fs = await import('node:fs');
    await page.screenshot({ path:`tmp/nb_${ID}_v3_final.png`, fullPage:true });
    fs.writeFileSync(`tmp/nb_${ID}_v3_body.txt`, bodyText);
    fs.writeFileSync(`tmp/nb_${ID}_v3_result.json`, JSON.stringify(out,null,2));
  } catch(e){}

  log('\n=== RESULT ===');
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
}
run().catch(e=>{console.error('[nb] FATAL',e);process.exit(1);});
