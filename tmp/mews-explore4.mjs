// Mews Distributor full flow v4 — Categories -> Rates -> Reserve -> Payment.
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
chromium.use(StealthPlugin());

const URLS = {
  musa:    'https://app.mews.com/distributor/c99e4a6b-920b-401c-af99-ae200094de71',
  elmhirst:'https://app.mews.com/distributor/2498d048-7b66-4e46-a563-b26700598ec2',
  sunski:  'https://app.mews.com/distributor/a18e5b73-4fe4-468f-8cd7-b17e008232ec',
};
const target = process.env.TARGET || 'musa';
const entryUrl = URLS[target];
const today = new Date();
const cin = new Date(today.getTime() + 45 * 86400000);
const cout = new Date(today.getTime() + 47 * 86400000);
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const startISO = iso(cin), endISO = iso(cout);
const startDay = cin.getDate(), endDay = cout.getDate();
const startMonthName = cin.toLocaleString('en-US',{month:'long'});
const endMonthName = cout.toLocaleString('en-US',{month:'long'});
console.log(`TARGET=${target} cin=${startISO} cout=${endISO}`);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1366, height: 900 },
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  locale: 'en-US',
});
const page = await ctx.newPage();
page.on('pageerror', e => console.log('JS-ERR:', e.message.slice(0,120)));

function dframe() { return page.frames().find(f=>f.name().startsWith('mews-distributor')); }
function fl() { return page.frameLocator('iframe[name^="mews-distributor"]'); }

async function dumpFrame(label) {
  const fr = dframe();
  if (!fr) { console.log(`[${label}] no frame`); return null; }
  try {
    return await fr.evaluate(()=>{
      const out = {btns:[], inputs:[], headings:[]};
      for (const b of document.querySelectorAll('button, [role=button]')) {
        const t=(b.innerText||b.textContent||b.getAttribute('aria-label')||'').trim().slice(0,60);
        const r=b.getBoundingClientRect();
        if(r.width>0&&r.height>0&&t) out.btns.push({text:t, testid:b.getAttribute('data-testid'), cls:(b.className||'').toString().slice(0,40), x:Math.round(r.x), y:Math.round(r.y)});
      }
      for (const el of document.querySelectorAll('input, [role=textbox], textarea')) {
        const r=el.getBoundingClientRect();
        if(r.width>0||r.height>0) out.inputs.push({type:el.type, name:el.name, id:el.id, ph:el.getAttribute('placeholder'), aria:el.getAttribute('aria-label'), auto:el.getAttribute('autocomplete')});
      }
      out.headings = [...document.querySelectorAll('h1,h2,h3,h4')].map(h=>(h.innerText||'').trim().slice(0,40)).filter(Boolean);
      out.body = document.body.innerText.replace(/\s+/g,' ').slice(0,500);
      return out;
    });
  } catch(e){ console.log(`[${label}] eval err ${e.message.slice(0,80)}`); return null; }
}

await page.goto(entryUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
try { await page.waitForSelector(`iframe[name^="mews-distributor"]`, { timeout: 30000 }); } catch {}
try { await fl().locator('button').first().waitFor({ state:'visible', timeout: 25000 }); } catch {}
await page.waitForTimeout(2500);

// cookie
try { await page.locator('[data-testid="actionButton-accept"]').click({ timeout: 5000 }); console.log('[1] cookie dismissed'); }
catch { console.log('[1] no cookie banner'); }
await page.waitForTimeout(500);

// open date picker
await fl().getByText('Select dates', { exact: true }).click({ timeout: 8000 });
console.log('[2] opened date picker');
await page.waitForTimeout(1200);

// navigate months until target month visible, then click by aria-label
async function currentMonths() { try { return await dframe().evaluate(()=>[...document.querySelectorAll('h2,h3,[class*=Month]')].map(h=>(h.innerText||'').trim()).filter(Boolean)); } catch { return []; } }
async function hasNext() { try { return await dframe().locator('[aria-label*="next month" i]').count(); } catch { return 0; } }

// Calendar shows months; click "Next month" until start month visible
for (let i=0;i<6;i++){
  const m = await currentMonths();
  const joined = m.join(' ').toLowerCase();
  if (joined.includes(startMonthName.toLowerCase())) { console.log(`[3] month nav done at iter ${i}, months=${m.join('|')}`); break; }
  // try aria-label "Next month"
  try { await dframe().locator('[aria-label*="next month" i]').first().click({ timeout: 3500 }); }
  catch {
    try { await dframe().locator('button', { hasText: 'Next month' }).first().click({ timeout: 3500 }); }
    catch(e){ console.log(`[3] next-month click failed at iter ${i}: ${e.message.slice(0,60)}`); break; }
  }
  await page.waitForTimeout(600);
}

// click start day by aria-label "<Day> <Month> <Year>, <Weekday>"
async function clickDayAria(day, monthName, year) {
  // aria-label format observed: "16 August 2026, Sunday"
  const candidates = [
    `[aria-label^="${day} ${monthName} ${year}"]`,
    `[aria-label*="${day} ${monthName} ${year}"]`,
    `[aria-label*="${monthName} ${day}"]`,
  ];
  for (const sel of candidates) {
    try { const c = await dframe().locator(sel).count(); if (c>0) { await dframe().locator(sel).first().click({ timeout: 4000 }); console.log(`[4] clicked day ${day} ${monthName} via ${sel}`); return true; } } catch {}
  }
  return false;
}
await clickDayAria(startDay, startMonthName, cin.getFullYear());
await page.waitForTimeout(700);
await clickDayAria(endDay, endMonthName, cout.getFullYear());
await page.waitForTimeout(700);

// Ensure 2 adults: occupancy default may already be 1 Adult; click Adults Increment once
// Identify adults increment: it's the increment button that comes BEFORE children's group.
// Simpler: read current Adults count from the displayed text.
let adultsNow = 0;
try { adultsNow = parseInt((await dframe().evaluate(()=>{ const m=document.body.innerText.match(/(\d+)\s*Adult/); return m?m[1]:'0'; })) || '0',10); } catch {}
console.log(`[5] adults now=${adultsNow}`);
if (adultsNow < 2) {
  // the Adults Increment is the FIRST increment button on the dates page
  try { await dframe().locator('button', { hasText: 'Increment' }).first().click({ timeout: 4000 }); console.log('[5] clicked Adults Increment'); }
  catch(e){ console.log('[5] adults-inc fail:', e.message.slice(0,60)); }
  await page.waitForTimeout(500);
}

// Next -> Categories
await fl().locator('button', { hasText: 'Next' }).first().click({ timeout: 8000 });
console.log('[6] clicked Next -> Categories');
await page.waitForTimeout(3000);
await page.screenshot({ path: `tmp/mews-${target}-v4-05-categories.png` });

// Categories page: click first "Show rates"
try {
  await fl().locator('button', { hasText: 'Show rates' }).first().click({ timeout: 8000 });
  console.log('[7] clicked first Show rates');
} catch(e){ console.log('[7] show-rates fail:', e.message.slice(0,80)); }
await page.waitForTimeout(2500);
await page.screenshot({ path: `tmp/mews-${target}-v4-06-rates-expanded.png` });

const d1 = await dumpFrame('AFTER-SHOW-RATES');
if (d1) {
  console.log('[AFTER-SHOW-RATES] headings:', d1.headings);
  console.log('[AFTER-SHOW-RATES] btns:', JSON.stringify(d1.btns.slice(0,30)));
  console.log('[AFTER-SHOW-RATES] body:', d1.body.slice(0,400));
}

// Now find a Reserve/Book/Select rate button
async function clickReserve() {
  const candidates = ['Reserve', 'Book', 'Book now', 'Select', 'Choose'];
  for (const c of candidates) {
    try {
      const loc = fl().locator('button, [role=button]', { hasText: c }).first();
      const cnt = await loc.count();
      if (cnt>0) { await loc.click({ timeout: 5000 }); console.log(`[8] clicked "${c}"`); return c; }
    } catch {}
  }
  return null;
}
const reserved = await clickReserve();
console.log('[8] reserve clicked:', reserved);
await page.waitForTimeout(3000);
await page.screenshot({ path: `tmp/mews-${target}-v4-07-after-reserve.png` });

const d2 = await dumpFrame('AFTER-RESERVE');
if (d2) {
  console.log('[AFTER-RESERVE] headings:', d2.headings);
  console.log('[AFTER-RESERVE] btns:', JSON.stringify(d2.btns.slice(0,30)));
  console.log('[AFTER-RESERVE] inputs:', JSON.stringify(d2.inputs));
  console.log('[AFTER-RESERVE] body:', d2.body.slice(0,400));
}

// After Reserve -> typically lands on a "Details" page (guest info form). Fill minimal then Next.
// Detect payment at each step.
async function onPayment() {
  const fr = dframe(); if (!fr) return false;
  try {
    return await fr.evaluate(()=>{
      const t = document.body.innerText;
      const has = /payment method|card number|credit card|cvv|cvc|expiry|cardholder/i.test(t);
      const el = document.querySelector('input[name*=card i], input[autocomplete*=cc-number i], [data-testid*=card-number i], iframe[name*=card i], [data-testid*=payment i]');
      return has || !!el;
    });
  } catch { return false; }
}

// Possibly need to fill guest details to reach payment. Try to fill generic fields then Next.
async function fillDetailsAndNext() {
  const fr = dframe(); if (!fr) return;
  try {
    await fr.evaluate(async ()=>{
      const fill = (sel, val) => { const el=document.querySelector(sel); if(el){ const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; setter.call(el,val); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); } };
      fill('input[type=email], input[name*=email i], input[autocomplete=email]', 'friction.test@example.com');
      fill('input[name*=first i], input[autocomplete=given-name]', 'Jane');
      fill('input[name*=last i], input[autocomplete=family-name]', 'Doe');
      fill('input[name*=phone i], input[type=tel], input[autocomplete=tel]', '+27123456789');
    });
    console.log('[9] filled details inputs');
  } catch(e){ console.log('[9] fill err:', e.message.slice(0,60)); }
  await page.waitForTimeout(700);
  // click Next / Continue / Book
  for (const t of ['Next','Continue','Book','Confirm','Pay']) {
    try { const c = await fl().locator('button', { hasText: t }).count(); if (c>0){ await fl().locator('button', { hasText: t }).first().click({ timeout: 5000 }); console.log(`[9] clicked "${t}"`); return; } } catch {}
  }
}

// From Summary page, the forward CTA is "Continue". From Details it may be "Continue"/"Pay"/"Book".
// IMPORTANT: "Next" matches the carousel "Next image" — use exact text or filter.
async function clickForward(label) {
  // Prefer exact match to avoid "Next image"
  try {
    const exact = fl().locator('button', { hasText: label }).filter({ hasNot: fl().locator('button', { hasText: 'image' }) });
    // simpler: find buttons whose trimmed text === label
  } catch {}
  // Use a JS-level filter via the frame
  const fr = dframe();
  try {
    const handle = await fr.locator('button, [role=button]').filter({ hasText: label }).elementHandles();
    for (const h of handle) {
      const t = (await h.innerText().catch(()=>'')).trim();
      // exact text match (no "image" suffix)
      if (t === label || t.startsWith(label) && !/image/i.test(t)) {
        await h.click({ timeout: 5000 });
        console.log(`[fwd] clicked exact "${label}"`);
        return true;
      }
    }
  } catch {}
  return false;
}

let guard=0;
let reached=false;
while (guard++ < 8) {
  if (await onPayment()) { reached = true; console.log(`[PAYMENT] detected on iter ${guard}`); break; }
  // Detect current step
  const fr = dframe();
  let step = '';
  try { step = await fr.evaluate(()=>{ const sels=[...document.querySelectorAll('[class*=StepButton]')]; const active = sels.find(s=>/cmxZoN|Active|Selected/i.test(s.className)); return active? active.innerText.replace(/\s+/g,' ').trim().slice(0,40) : ''; }); } catch {}
  console.log(`[iter${guard}] step="${step}"`);

  // try a sequence of CTAs by EXACT text
  const ctas = ['Continue','Book now','Reserve','Pay','Confirm'];
  let clickedAny=false;
  for (const c of ctas) { if (await clickForward(c)) { clickedAny=true; break; } }
  if (!clickedAny) {
    // try Next but EXACT (must equal "Next", not "Next image")
    if (await clickForward('Next')) { clickedAny=true; }
  }
  if (!clickedAny) { console.log(`[iter${guard}] no CTA; trying fillDetails`); await fillDetailsAndNext(); }
  await page.waitForTimeout(2500);

  // safety: stop if step hasn't advanced in a while (filled details already)
  if (guard===4) {
    // try filling details once (in case we are on Details page)
    await fillDetailsAndNext();
    await page.waitForTimeout(2000);
  }
}

await page.screenshot({ path: `tmp/mews-${target}-v4-08-final.png`, fullPage: true });
const finalUrl = page.url();
let paymentEl=null;
try { paymentEl = await dframe().evaluate(()=>{ const c=document.querySelector('input[name*=card i], input[autocomplete*=cc-number i], [data-testid*=card-number i], iframe[name*=card-number i], iframe[title*=card i]'); return c?{tag:c.tagName,name:c.name,id:c.id,auto:c.getAttribute('autocomplete'),title:c.getAttribute('title')}:null; }); } catch{}
console.log('[FINAL] url=', finalUrl);
console.log('[FINAL] paymentElement=', JSON.stringify(paymentEl));
console.log('[FINAL] paymentReached=', reached);

await browser.close();
console.log('DONE v4');
