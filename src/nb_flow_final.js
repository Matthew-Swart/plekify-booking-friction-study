// NightsBridge FINAL flow probe — proven flow + correct payment detection.
// Flow: BASE -> VIEW CALENDAR (opens 2-month daterangepicker) -> click CI day in CI month table
//       -> click CO day -> CHECK AVAILABILITY -> VIEW RATES AND BOOK -> first BOOK NOW -> payment panel.
// Payment page indicator = "Payment Method" select + "CONFIRM BOOKING" button + Personal Info form
// (URL never changes; NB is a single-route Angular SPA — booking panel slides in).
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
const MONTHS_L = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const ciD = String(ci.getDate()), coD = String(co.getDate());
// NB renders the daterangepicker month header with TWO spaces: "August  2026"
const ciMonthLabel = `${MONTHS_L[ci.getMonth()]}  ${ci.getFullYear()}`;
const log = (...a) => console.log('[nb]', ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function clickDayInMonth(page, day, monthLabel){
  const ok = await page.evaluate(({day, monthLabel}) => {
    const tables = [...document.querySelectorAll('table.calendar-table, table.table-condensed')];
    const target = tables.find(t => t.querySelector('th.month')?.innerText?.trim() === monthLabel);
    if (!target) return false;
    const cells = [...target.querySelectorAll('td:not(.week)')];
    const c = cells.filter(x => x.innerText.trim() === String(day) && !/off|disabled/i.test(x.className||''))[0];
    if (!c) return false;
    c.click(); return true;
  }, {day, monthLabel});
  log(`  clickDay ${day} in "${monthLabel}": ${ok}`);
  return ok;
}

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

  // cookie banner (NB itself has none; GTM only) — confirm
  out.cookieBanner = await page.evaluate(() => /onetrust|cookie consent|accept all cookies/i.test(document.body.innerText));

  // VIEW CALENDAR opens the daterangepicker
  try { await page.click('button.avl-cl-btn', {timeout:5000}); log('VIEW CALENDAR clicked'); }
  catch(e){ log('view-cal err', e.message.split('\n')[0]); }
  await sleep(1000);

  // If target month not visible, navigate forward
  const monthVisible = () => page.evaluate((label) =>
    [...document.querySelectorAll('table.calendar-table th.month, table.table-condensed th.month')]
      .map(e=>e.innerText.trim()).includes(label), ciMonthLabel);
  for (let i=0;i<14 && !await monthVisible();i++){
    const clicked = await page.evaluate(() => {
      let t = document.querySelector('th.next.available') || document.querySelector('th.next');
      if (!t){
        const tables = [...document.querySelectorAll('table.calendar-table, table.table-condensed')];
        if (tables.length){
          const empties = [...tables[tables.length-1].querySelectorAll('thead th')]
            .filter(th => !/month/.test(th.className||'') && (th.innerText||'').trim()==='');
          if (empties.length) t = empties[empties.length-1];
        }
      }
      if (t){ t.click(); return true; } return false;
    });
    if (!clicked) break;
    await sleep(350);
  }
  out.ciDayClicked = await clickDayInMonth(page, ciD, ciMonthLabel);
  await sleep(500);
  out.coDayClicked = await clickDayInMonth(page, coD, ciMonthLabel);
  await sleep(700);
  out.dateRangeVal = await page.inputValue('input.landing-date-range-pick').catch(()=>null);

  // CHECK AVAILABILITY
  try { await page.click('button.check-avl-btn', {timeout:5000}); log('CHECK AVAILABILITY clicked'); }
  catch(e){ log('check-avl err', e.message.split('\n')[0]); }
  await sleep(3500);

  // Expand first room rates then click first BOOK NOW
  let bookSel = await page.$('button.btn-book-now, button:has-text("BOOK NOW")') ? 'button.btn-book-now, button:has-text("BOOK NOW")' : null;
  if (!bookSel){
    try { await page.click('button.btn-show-rates, button:has-text("VIEW RATES AND BOOK")', {timeout:5000}); await sleep(1500); log('rates expanded'); }
    catch(e){}
    bookSel = await page.$('button.btn-book-now, button:has-text("BOOK NOW")') ? 'button.btn-book-now, button:has-text("BOOK NOW")' : null;
  }
  out.bookSel = bookSel;
  if (bookSel){
    try { await page.click(bookSel, {timeout:5000}); log('BOOK NOW clicked'); }
    catch(e){ log('book click err', e.message.split('\n')[0]); }
  }
  await sleep(3500);

  // PAYMENT-PAGE detection — NB has NO route change; panel slides in within the SPA.
  const finalUrl = page.url();
  const detection = await page.evaluate(() => {
    const txt = document.body.innerText;
    const has = re => re.test(txt);
    return {
      paymentMethodCopy:  has(/Payment Method/i),
      confirmBookingBtn:  has(/CONFIRM BOOKING/i),
      personalInfoForm:   has(/Personal Information/i) && has(/First Name/i) && has(/Email/i),
      depositCopy:        has(/Deposit Required/i),
      termsCopy:          has(/I have read and accepted the terms/i),
      cardNumInput:       !!document.querySelector('input[name*="card" i], input[autocomplete="cc-number"], input[placeholder*="card number" i]'),
      cvvInput:           !!document.querySelector('input[autocomplete="cc-csc"], input[name*="cvv" i], input[placeholder*="cvv" i]'),
      payIframe:          !!document.querySelector('iframe[name*="pay" i], iframe[src*="pay" i], iframe[src*="checkout" i], iframe[src*="bridgepay" i], iframe[src*="peach" i]'),
      captcha:            has(/captcha|recaptcha|hcaptcha|turnstile/i) || !!document.querySelector('iframe[src*="captcha" i], .g-recaptcha, .h-captcha'),
    };
  });
  const paymentReached = (detection.paymentMethodCopy && detection.confirmBookingBtn) || detection.cardNumInput || detection.cvvInput || detection.payIframe;
  out.finalUrl = finalUrl;
  out.paymentReached = !!paymentReached;
  out.paymentIndicator = paymentReached
    ? (detection.cardNumInput ? 'card-number input visible'
       : detection.payIframe ? 'payment iframe present'
       : '"Payment Method" + "CONFIRM BOOKING" controls visible (guest-details/payment panel within SPA)')
    : 'NONE';
  out.detection = detection;
  out.urlChanged = finalUrl !== BASE;

  // evidence
  try {
    const fs = await import('node:fs');
    await page.screenshot({ path:`tmp/nb_${ID}_final.png`, fullPage:true });
    fs.writeFileSync(`tmp/nb_${ID}_body.txt`, await page.evaluate(()=>document.body.innerText));
    fs.writeFileSync(`tmp/nb_${ID}_result.json`, JSON.stringify(out,null,2));
  } catch(e){}

  log('\n=== RESULT ===');
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
  return out;
}
run().catch(e=>{console.error('[nb] FATAL',e.message);process.exit(1);});
