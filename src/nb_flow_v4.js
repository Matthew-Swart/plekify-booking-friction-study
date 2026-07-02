// NightsBridge v4 — proven flow:
//  Landing -> VIEW CALENDAR (opens 2-month daterangepicker) -> click Aug-16 then Aug-18
//  -> (calendar auto-closes / apply) -> CHECK AVAILABILITY -> VIEW RATES AND BOOK -> BOOK NOW -> payment
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
const ciMonthLabel = `${MONTHS_L[ci.getMonth()]}  ${ci.getFullYear()}`; // NB renders "August  2026" (2 spaces)

const log = (...a) => console.log('[nb]', ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// click a day cell in the calendar table whose month header matches `monthLabel`
async function clickDayInMonth(page, day, monthLabel){
  // Each month is its own table.calendar-table. Locate the table whose th.month === monthLabel, then click the td with that day text.
  const result = await page.evaluate(({day, monthLabel}) => {
    const tables = [...document.querySelectorAll('table.calendar-table, table.table-condensed')];
    let target = null;
    for (const t of tables){
      const hdr = t.querySelector('th.month');
      if (hdr && hdr.innerText.trim() === monthLabel){ target = t; break; }
    }
    if (!target) return {ok:false, reason:'no table for month', monthLabel, tables: tables.map(t=>t.querySelector('th.month')?.innerText?.trim())};
    const cells = [...target.querySelectorAll('td.available, td:not(.off):not(.week)')];
    // Note: leading days from prev month may have class "off"
    const candidates = cells.filter(c => c.innerText.trim() === String(day) && !/off|disabled/i.test(c.className||''));
    if (!candidates.length) return {ok:false, reason:'no day cell', day, allCells: cells.map(c=>({t:c.innerText.trim(),c:(c.className||'').slice(0,30)})).slice(0,40)};
    candidates[0].scrollIntoView({block:'center'});
    return {ok:true, idx:[...cells].indexOf(candidates[0])};
  }, {day, monthLabel});
  if (!result.ok){ log(`  clickDay ${day} fail:`, JSON.stringify(result)); return false; }
  // click via the cell index in that table
  const clicked = await page.evaluate(({day, monthLabel}) => {
    const tables = [...document.querySelectorAll('table.calendar-table, table.table-condensed')];
    const target = tables.find(t => t.querySelector('th.month')?.innerText?.trim() === monthLabel);
    if (!target) return false;
    const cells = [...target.querySelectorAll('td.available, td:not(.off):not(.week)')];
    const c = cells.filter(x => x.innerText.trim() === String(day) && !/off|disabled/i.test(x.className||''))[0];
    if (!c) return false;
    c.click();
    return true;
  }, {day, monthLabel});
  log(`  clickDay ${day} in "${monthLabel}": ${clicked}`);
  return clicked;
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
  const out = { system:'nightsbridge', id:ID, BASE, ciISO, coISO, ciMonthLabel };

  await page.goto(BASE, { waitUntil:'networkidle' });
  await sleep(2500);

  // VIEW CALENDAR opens the daterangepicker
  try { await page.click('button.avl-cl-btn', {timeout:5000}); log('VIEW CALENDAR clicked'); }
  catch(e){ log('view-cal err', e.message.split('\n')[0]); }
  await sleep(1000);

  // If target month not visible, navigate forward. Check both visible tables.
  const monthVisible = async () => page.evaluate((label) => {
    const hdrs = [...document.querySelectorAll('table.calendar-table th.month, table.table-condensed th.month')].map(e=>e.innerText.trim());
    return hdrs.includes(label);
  }, ciMonthLabel);
  let months = await monthVisible();
  log(`target month "${ciMonthLabel}" visible=${months}`);
  for (let i=0;i<14 && !months;i++){
    // NB uses th.ng-star-inserted as arrows; first/last empty th in a table header. Find a clickable next arrow.
    const clicked = await page.evaluate(() => {
      const ths = [...document.querySelectorAll('th.available, th.next, th.ng-star-inserted')];
      // Prefer one with class "next" or right-most
      let target = document.querySelector('th.next.available') || document.querySelector('th.next');
      if (!target){
        // Fallback: the last empty th in the SECOND month table header
        const tables = [...document.querySelectorAll('table.calendar-table, table.table-condensed')];
        if (tables.length){
          const last = tables[tables.length-1];
          const empties = [...last.querySelectorAll('thead th')].filter(th => !th.className.includes('month') && (th.innerText||'').trim()==='');
          if (empties.length) target = empties[empties.length-1];
        }
      }
      if (target){ target.click(); return target.className.slice(0,40); }
      return null;
    });
    log(`  nav ${i} clicked arrow: ${clicked}`);
    if (!clicked) break;
    await sleep(350);
    months = await monthVisible();
  }

  out.ciDayClicked = await clickDayInMonth(page, ciD, ciMonthLabel);
  await sleep(500);
  out.coDayClicked = await clickDayInMonth(page, coD, ciMonthLabel);
  await sleep(700);
  out.dateRangeVal = await page.inputValue('input.landing-date-range-pick').catch(()=>null);
  log(`dateRangeVal="${out.dateRangeVal}"`);

  // Apply (NB daterangepicker auto-applies on second click usually). Try apply button if present.
  try { const el = await page.$('button.applyBtn, button:has-text("Apply")'); if (el){ await el.click({timeout:2000}); log('apply clicked'); } } catch {}
  await sleep(500);

  // CHECK AVAILABILITY
  try { await page.click('button.check-avl-btn', {timeout:5000}); log('CHECK AVAILABILITY clicked'); }
  catch(e){ log('check-avl err', e.message.split('\n')[0]); }
  await sleep(3500);

  // Results: rooms appear with "VIEW RATES AND BOOK" (collapses to rate cards with BOOK NOW).
  // Try rate-level BOOK NOW first; if absent, expand via VIEW RATES AND BOOK, then BOOK NOW.
  let bookSel = null;
  for (const s of ['button.btn-book-now','button:has-text("BOOK NOW")']){
    if (await page.$(s)){ bookSel = s; break; }
  }
  if (!bookSel){
    try { await page.click('button.btn-show-rates, button:has-text("VIEW RATES AND BOOK")', {timeout:5000}); log('VIEW RATES expanded'); await sleep(1500); }
    catch(e){ log('view-rates err', e.message.split('\n')[0]); }
    for (const s of ['button.btn-book-now','button:has-text("BOOK NOW")']){
      if (await page.$(s)){ bookSel = s; break; }
    }
  }
  out.bookSel = bookSel;
  const urlBefore = page.url();
  let navHappened = false;
  if (bookSel){
    try {
      const navP = page.waitForURL(u=>u!==urlBefore,{timeout:8000}).catch(()=>null);
      await page.click(bookSel, {timeout:5000});
      log('BOOK NOW clicked');
      await Promise.race([navP, sleep(5000)]);
      navHappened = page.url() !== urlBefore;
    } catch(e){ log('book click err', e.message.split('\n')[0]); }
  } else { log('no BOOK NOW found'); }
  await sleep(3000);

  const finalUrl = page.url();
  const bodyText = await page.evaluate(() => document.body.innerText.slice(0,5000));
  // Use innerText scanning (querySelector can't take :has-text)
  const hints = await page.evaluate(() => {
    const txt = document.body.innerText;
    return {
      cardNum: !!document.querySelector('input[name*="card" i], input[autocomplete="cc-number"], input[placeholder*="card number" i]'),
      cvv: !!document.querySelector('input[autocomplete="cc-csc"], input[name*="cvv" i], input[placeholder*="cvv" i]'),
      payBtn: /pay now|pay \& confirm|confirm booking|make payment|secure payment/i.test(txt),
      payIframe: !!document.querySelector('iframe[name*="pay" i], iframe[src*="pay" i], iframe[src*="checkout" i], iframe[src*="bridgepay" i], iframe[src*="peach" i], iframe[src*="network" i]'),
      guestFields: !!document.querySelector('input[name*="firstname" i], input[name*="first_name" i], input[id*="firstname" i], input[placeholder*="first name" i]'),
    };
  });
  const urlPays = /payment|paynow|bridgepay|checkout|secure-payment|pay-|booking-confirm|guest-details/i.test(finalUrl) && finalUrl !== BASE;
  const paymentReached = urlPays || hints.cardNum || hints.cvv || hints.payIframe ||
    /card number|cvv|pay now|credit card|payment details|secure payment/i.test(bodyText);
  out.finalUrl = finalUrl;
  out.paymentReached = !!paymentReached;
  out.paymentIndicator = urlPays ? `URL: ${finalUrl}`
    : hints.cardNum ? 'card-number input visible'
    : hints.cvv ? 'cvv input visible'
    : hints.payIframe ? 'payment iframe present'
    : hints.payBtn ? 'pay/confirm copy'
    : /card number|cvv|pay now|credit card/i.test(bodyText) ? 'payment-related copy'
    : hints.guestFields ? 'STOPPED at guest-details form (pre-payment)'
    : 'NONE — still on availability/results page';
  out.navAfterBook = navHappened;
  out.bodyHead = bodyText.slice(0,1800).replace(/\n+/g,' | ');
  out.hints = hints;

  try {
    const fs = await import('node:fs');
    await page.screenshot({ path:`tmp/nb_${ID}_v4_final.png`, fullPage:true });
    fs.writeFileSync(`tmp/nb_${ID}_v4_body.txt`, bodyText);
    fs.writeFileSync(`tmp/nb_${ID}_v4_result.json`, JSON.stringify(out,null,2));
  } catch(e){}

  log('\n=== RESULT ===');
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
}
run().catch(e=>{console.error('[nb] FATAL',e.message);process.exit(1);});
