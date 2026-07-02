// NightsBridge booking-engine flow probe.
// Drives book.nightsbridge.com/{id} to the payment page (no booking completed).
// Output: selector-level JSON flow spec + honest go/no-go on payment reached.
//
// Usage: node src/nb_flow_probe.js [propertyId]
//   propertyId default: 19876 (Thali Thali). Others: 30738 (Atlantic View), 12292 (Lairds Lodge).

import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
chromium.use(StealthPlugin());

const ID = process.argv[2] || '19876';
const BASE = `https://book.nightsbridge.com/${ID}`;

// T+45 / T+47 (matches PROTOCOL-v2 §4 Study B fixed dates).
const today = new Date(); today.setHours(0,0,0,0);
const ci = new Date(today.getTime() + 45*86400000);
const co = new Date(today.getTime() + 47*86400000);
const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const ciISO = fmt(ci), coISO = fmt(co);
// NB long-form (e.g. 16 August 2026) — some NB app builds parse this.
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const ciLong = `${ci.getDate()} ${MONTHS[ci.getMonth()]} ${ci.getFullYear()}`;
const coLong = `${co.getDate()} ${MONTHS[co.getMonth()]} ${co.getFullYear()}`;

const log = (...a) => console.log('[nb]', ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function dump(page, tag){
  const info = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    // grab visible text of buttons/links cheaply
    buttons: [...document.querySelectorAll('button, a, [role="button"]')]
      .map(e => (e.innerText||e.textContent||'').trim()).filter(t=>t).slice(0,60),
    iframes: [...document.querySelectorAll('iframe')].map(f=>({src:f.src,name:f.name,id:f.id})).slice(0,10),
  }));
  log(`--- ${tag} ---`);
  log('URL:', info.url);
  log('title:', info.title);
  log('buttons/links:', JSON.stringify(info.buttons));
  log('iframes:', JSON.stringify(info.iframes));
  return info;
}

async function run(){
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    locale: 'en-GB',
    timezoneId: 'Africa/Johannesburg',
  });
  ctx.setDefaultTimeout(15000);
  const page = await ctx.newPage();

  const out = { system:'nightsbridge', id:ID, ciISO, coISO };

  // ---- PHASE 1: probe deep-link query-param shapes -----------------------
  const candidates = [
    { label:'checkin/checkout ISO', qs:`?checkin=${ciISO}&checkout=${coISO}&adults=2` },
    { label:'arrival/departure ISO', qs:`?arrival=${ciISO}&departure=${coISO}&adults=2` },
    { label:'dd range',             qs:`?dd=${ciISO}&ad=${coISO}&adults=2` },
    { label:'nb_ classic',          qs:`?nb_a=${ciISO.replace(/-/g,'')}&nb_d=${coISO.replace(/-/g,'')}&adults=2` },
    { label:'qid single',           qs:`?qid=${ciISO}|${coISO}|2` },
  ];

  let bestLink = null;
  for (const c of candidates){
    const url = BASE + c.qs;
    log(`\n=== DEEP-LINK TRY: ${c.label} -> ${url}`);
    try {
      await page.goto(url, { waitUntil: 'networkidle' });
      await sleep(2500);
      const info = await dump(page, `after ${c.label}`);
      const urlHasResults = /results|availability|rooms|listing|rate/i.test(info.url);
      const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 4000));
      const showsRates = /per room|night|rate|rooms? available|available rooms|select room|book now/i.test(bodyText);
      const hasArrivalPrefilled = await page.evaluate((d) => {
        const t = document.body.innerText;
        return t.includes(d);
      }, ciLong) || await page.evaluate((d)=>document.body.innerText.includes(d), `${ci.getDate()} ${MONTHS[ci.getMonth()]}`);
      log(`  urlHasResults=${urlHasResults} showsRates=${showsRates} arrivalPrefilled=${hasArrivalPrefilled}`);
      if ((urlHasResults || showsRates) && hasArrivalPrefilled) {
        bestLink = { ...c, url, infoUrl: info.url };
        log(`  >> ACCEPTED as deep link`);
        break;
      }
    } catch(e){ log('  try error:', e.message.split('\n')[0]); }
  }

  // ---- PHASE 2: walk the app UI to discover the canonical flow -----------
  // Always continue from the bare URL so we capture real selectors.
  log(`\n=== FLOW: opening bare ${BASE}`);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await sleep(3000);
  await dump(page, 'landing');

  // cookie / consent dismiss (try common vendors)
  const cookieSelectors = [
    '#onetrust-accept-btn-handler','button#accept-recommended-btn-handler',
    'button:has-text("Accept All")','button:has-text("Accept all")',
    'button:has-text("Allow all")','button:has-text("I Accept")','button:has-text("Got it")',
    'a.cc-accept','button.cc-accept','.sp-cc-accept-btn',
  ];
  let cookieSel = null;
  for (const s of cookieSelectors){
    try { const el = await page.$(s); if (el){ await el.click({timeout:2000}); cookieSel = s; log('cookie dismiss clicked:', s); await sleep(800); break; } }
    catch {}
  }
  out.cookieDismiss = cookieSel ? { selector: cookieSel } : null;

  // The Angular search form: find the Check Availability / Search button + date inputs.
  // Inspect the search controls.
  const searchForm = await page.evaluate(() => {
    const all = [...document.querySelectorAll('input, button, mat-form-field, [role="button"], select')];
    return all.map(e => ({
      tag: e.tagName.toLowerCase(),
      type: e.type||null,
      id: e.id||null,
      cls: (e.className||'').toString().slice(0,80),
      ph: e.placeholder||null,
      text: (e.innerText||e.value||'').trim().slice(0,40),
      aria: e.getAttribute('aria-label')||null,
    })).slice(0,80);
  });
  log('\nSEARCH FORM CONTROLS:');
  console.table(searchForm.slice(0,40));

  // Try to type the arrival date into the date input(s). NB uses Angular Material datepickers.
  // Heuristic: the first mat-datepicker input is check-in, the second is check-out.
  const dateInputs = await page.$$('input[matinput], input.mat-datepicker-input, input[placeholder*="Arrival" i], input[placeholder*="Check-in" i], input[placeholder*="Date" i], input[type="date"]');
  log(`date input count: ${dateInputs.length}`);
  for (let i=0;i<Math.min(dateInputs.length,2);i++){
    const val = i===0 ? ciISO : coISO;
    try {
      await dateInputs[i].scrollIntoViewIfNeeded();
      await dateInputs[i].click({timeout:3000});
      await dateInputs[i].fill('');
      await dateInputs[i].type(val, {delay:30});
      log(`filled date input #${i} with ${val}`);
      await page.keyboard.press('Tab');
      await sleep(300);
    } catch(e){ log(`date input #${i} fill error:`, e.message.split('\n')[0]); }
  }

  // Adults: try to set 2 if a guests control exists.
  for (const sel of ['select', 'mat-select', '[aria-label*="Guest" i]', '[aria-label*="Adult" i]']){
    const el = await page.$(sel);
    if (el){ log('guests control found:', sel); break; }
  }

  // Find & click the search/availability action.
  const searchSelCandidates = [
    'button:has-text("Check Availability")',
    'button:has-text("Search")',
    'button:has-text("View Rates")',
    'button:has-text("Book Now")',
    'button:has-text("Search Availability")',
    'a:has-text("Check Availability")',
  ];
  let searchSel = null;
  for (const s of searchSelCandidates){
    try { const el = await page.$(s); if (el){ await el.click({timeout:4000}); searchSel = s; log('search clicked:', s); break; } }
    catch {}
  }
  out.searchAction = searchSel;
  await sleep(3500);
  await dump(page, 'after search');

  // ---- PHASE 3: results -> room Book button -----------------------------
  const bookSelCandidates = [
    'button:has-text("Book")',
    'button:has-text("Book Now")',
    'button:has-text("Select")',
    'a:has-text("Book")',
    'button:has-text("View Rates")',
    '[role="button"]:has-text("Book")',
  ];
  let bookSel = null;
  for (const s of bookSelCandidates){
    try { const el = await page.$(s); if (el){ await el.scrollIntoViewIfNeeded(); await el.click({timeout:4000}); bookSel = s; log('book clicked:', s); break; } }
    catch {}
  }
  out.bookAction = bookSel;
  await sleep(3500);
  const afterBook = await dump(page, 'after book');

  // ---- PHASE 4: payment-page indicator ----------------------------------
  await sleep(1500);
  const finalUrl = page.url();
  const bodyText = await page.evaluate(() => document.body.innerText.slice(0,6000));
  const cardHints = await page.evaluate(() => ({
    cardNum: !!document.querySelector('input[name*="card" i], input[autocomplete="cc-number"], input[placeholder*="card number" i]'),
    cvv: !!document.querySelector('input[autocomplete="cc-csc"], input[name*="cvv" i], input[placeholder*="cvv" i]'),
    paynow: /pay now|payment|deposit|credit card|card number/i.test(document.body.innerText),
    iframePay: !!document.querySelector('iframe[name*="pay" i], iframe[src*="pay" i], iframe[src*="checkout" i]'),
  }));
  const urlIndicatesPayment = /payment|checkout|paynow|secure/i.test(finalUrl) && finalUrl !== BASE;
  const paymentReached = urlIndicatesPayment || cardHints.cardNum || cardHints.cvv || cardHints.iframePay;
  out.finalUrl = finalUrl;
  out.paymentReached = !!paymentReached;
  out.paymentIndicator = urlIndicatesPayment
    ? `URL pattern: ${finalUrl}`
    : (cardHints.cardNum ? 'card-number input visible' :
       cardHints.cvv ? 'cvv input visible' :
       cardHints.iframePay ? 'payment iframe present' :
       (cardHints.paynow ? 'payment-related copy on page' : 'none'));

  log('\n=== RESULT ===');
  console.log(JSON.stringify(out, null, 2));

  // Save a screenshot + html for evidence
  try {
    const fs = await import('node:fs');
    const dir = 'tmp';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: `${dir}/nb_${ID}_final.png`, fullPage: true });
    fs.writeFileSync(`${dir}/nb_${ID}_final.html`, await page.content());
    fs.writeFileSync(`${dir}/nb_${ID}_body.txt`, bodyText);
    log(`evidence saved to tmp/nb_${ID}_final.{png,html} + _body.txt`);
  } catch(e){ log('evidence save err:', e.message); }

  await browser.close();
  return out;
}

run().catch(e => { console.error('[nb] FATAL', e); process.exit(1); });
