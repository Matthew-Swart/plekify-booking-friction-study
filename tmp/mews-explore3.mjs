// Mews Distributor deep-link test + full flow drive.
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
console.log(`TARGET=${target} cin=${startISO} cout=${endISO}`);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1366, height: 900 },
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  locale: 'en-US',
});
const page = await ctx.newPage();
page.on('pageerror', e => console.log('JS-ERR:', e.message.slice(0,120)));

// ============================ PART A: deep-link probe ============================
// Try several param formats on a throwaway page; just see if dates pre-fill.
const variants = [
  {label:'start/end', url:`${entryUrl}?start=${startISO}&end=${endISO}&adults=2`},
  {label:'startDate/endDate', url:`${entryUrl}?startDate=${startISO}&endDate=${endISO}&adults=2`},
  {label:'arrival/departure', url:`${entryUrl}?arrival=${startISO}&departure=${endISO}&adults=2`},
  {label:'from/to', url:`${entryUrl}?from=${startISO}&to=${endISO}&adults=2`},
  {label:'checkin/checkout', url:`${entryUrl}?checkin=${startISO}&checkout=${endISO}&adults=2`},
  {label:'cin/cout', url:`${entryUrl}?cin=${startISO}&cout=${endISO}&adults=2`},
];
const dl = await ctx.newPage();
for (const v of variants) {
  await dl.goto(v.url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e=>console.log('  goto-err', e.message.slice(0,60)));
  try { await dl.waitForSelector(`iframe[name^="mews-distributor"]`, { timeout: 15000 }); } catch {}
  await dl.waitForTimeout(3500);
  // read the date area text inside the iframe
  let txt = '';
  try {
    const fr = dl.frames().find(f=>f.name().startsWith('mews-distributor'));
    if (fr) txt = await fr.evaluate(()=>document.body.innerText.replace(/\s+/g,' ').slice(0,300));
  } catch(e){}
  const prefilled = txt.includes(startISO.replace(/-/g,'/')) || txt.includes(startISO) || /\bAug 1[56]\b/.test(txt);
  console.log(`[DEEPLINK ${v.label}] prefilled=${prefilled}  body="${txt.slice(0,140)}"`);
}
await dl.close();

// ============================ PART B: drive the flow ============================
await page.goto(entryUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
try { await page.waitForSelector(`iframe[name^="mews-distributor"]`, { timeout: 30000 }); } catch {}
await page.waitForTimeout(3500);

// 1) cookie banner (main frame)
try {
  await page.locator('[data-testid="actionButton-accept"]').click({ timeout: 5000 });
  console.log('[STEP] cookie dismissed');
} catch(e){ console.log('[STEP] no/already-dismissed cookie'); }
await page.waitForTimeout(800);

const fl = page.frameLocator('iframe[name^="mews-distributor"]');

// 2) open date picker
try {
  await fl.getByText('Select dates', { exact: true }).click({ timeout: 8000 });
  console.log('[STEP] clicked "Select dates"');
} catch(e){
  try { await fl.locator('button', { hasText: 'Select dates' }).first().click({ timeout: 5000 }); console.log('[STEP] clicked Select dates (btn)'); }
  catch(e2){ console.log('[STEP] could not open date picker:', e2.message.slice(0,80)); }
}
await page.waitForTimeout(1500);
await page.screenshot({ path: `tmp/mews-${target}-03-picker-open.png` });

// Inspect calendar DOM
const cframe = page.frames().find(f=>f.name().startsWith('mews-distributor'));
try {
  const cal = await cframe.evaluate((startISO)=>{
    const days = [...document.querySelectorAll('[role=gridcell], [role=button], td, [data-testid*=day i], button')];
    const out = [];
    for (const d of days) {
      const t = (d.innerText||d.textContent||'').trim();
      const aria = d.getAttribute('aria-label')||'';
      const r = d.getBoundingClientRect();
      if (r.width>0 && r.height>0 && /^\d{1,2}$/.test(t)) out.push({text:t, aria:aria.slice(0,40), cls:(d.className||'').toString().slice(0,40), x:Math.round(r.x), y:Math.round(r.y)});
    }
    return out.slice(0,50);
  }, startISO);
  console.log('[CAL] day cells:', JSON.stringify(cal.slice(0,25)));
  // also dump month header + nav
  const hdr = await cframe.evaluate(()=>{
    const sels = ['[aria-label*=next i]','[aria-label*=previous i]','[data-testid*=next i]','[data-testid*=previous i]','button'];
    const out=[];
    for(const s of sels){ for(const b of document.querySelectorAll(s)){ const r=b.getBoundingClientRect(); const t=(b.getAttribute('aria-label')||b.innerText||'').trim().slice(0,30); if(r.width>0&&r.height>0&&t) out.push({s, t, x:Math.round(r.x), y:Math.round(r.y)}); } }
    // month labels = bigger text headings
    const months=[...document.querySelectorAll('h1,h2,h3,h4,[class*=Month],[class*=Header]')].map(h=>(h.innerText||'').trim().slice(0,30)).filter(Boolean);
    return {nav:out.slice(0,10), months:[...new Set(months)].slice(0,4)};
  });
  console.log('[CAL] nav/months:', JSON.stringify(hdr));
} catch(e){ console.log('[CAL] inspect err', e.message.slice(0,80)); }

// 3) pick start date — try aria-label match first
const startDay = cin.getDate();
const endDay = cout.getDate();
const startMonthName = cin.toLocaleString('en-US',{month:'long'});
const endMonthName = cout.toLocaleString('en-US',{month:'long'});
console.log(`[STEP] picking start=${startMonthName} ${startDay}, end=${endMonthName} ${endDay}`);

// navigate to correct month if needed (we may be on current month — click Next)
async function clickDay(day, monthName) {
  // Strategy A: aria-label contains "<Month> <day>"
  const aria = cframe.locator(`[aria-label*="${monthName}"][aria-label*="${day} "], [aria-label*="${day} ${monthName}"]`).first();
  try { await aria.click({ timeout: 4000 }); console.log(`[STEP] clicked day ${day} via aria`); return true; } catch {}
  // Strategy B: visible gridcell with text === day
  const cells = cframe.locator('[role=gridcell], td');
  const n = await cells.count();
  for (let i=0;i<n;i++){
    const t = (await cells.nth(i).innerText().catch(()=>'')).trim();
    if (t === String(day)) { await cells.nth(i).click({ timeout: 4000 }); console.log(`[STEP] clicked day ${day} via gridcell`); return true; }
  }
  return false;
}

// Need to make sure picker is on a month showing `cin`. Today is 2026-07-02, cin=2026-08-16.
// Click "Next" month nav 0 or 1 time until August is visible.
async function currentMonths() {
  return await cframe.evaluate(()=>[...document.querySelectorAll('h1,h2,h3,h4,[class*=Month]')].map(h=>(h.innerText||'').trim()).filter(Boolean).slice(0,2));
}
console.log('[STEP] months before nav:', await currentMonths().catch(()=>'?'));
// Try clicking next until August appears or 4 tries
for (let i=0;i<4;i++){
  const months = await currentMonths().catch(()=>[]);
  if (months.join(' ').toLowerCase().includes(startMonthName.toLowerCase())) break;
  try { await cframe.locator('[aria-label*=next i], [data-testid*=next i]').first().click({ timeout: 4000 }); console.log('[STEP] clicked next-month'); }
  catch(e){ console.log('[STEP] next-month click fail:', e.message.slice(0,60)); break; }
  await page.waitForTimeout(700);
}
console.log('[STEP] months after nav:', await currentMonths().catch(()=>'?'));

await clickDay(startDay, startMonthName);
await page.waitForTimeout(800);
await clickDay(endDay, endMonthName);
await page.waitForTimeout(800);
await page.screenshot({ path: `tmp/mews-${target}-04-dates-picked.png` });

// 4) Ensure adults=2 (start at 1 by default; click Increment once for adults)
// Adults increment is the 1st increment button (x~638 in earlier dump).
try {
  // find the "Increment" button adjacent to Adults
  const incs = cframe.locator('button', { hasText: 'Increment' });
  const cnt = await incs.count();
  console.log('[STEP] increment buttons found:', cnt);
  // Adults is the first occupancy group; click first increment
  if (cnt>0) { await incs.first().click({ timeout: 4000 }); console.log('[STEP] clicked Adults Increment'); }
} catch(e){ console.log('[STEP] adults-inc fail:', e.message.slice(0,60)); }
await page.waitForTimeout(700);

// 5) click Next to go to Categories (rooms)
try {
  await fl.locator('button', { hasText: 'Next' }).first().click({ timeout: 8000 });
  console.log('[STEP] clicked Next (->Categories)');
} catch(e){ console.log('[STEP] Next fail:', e.message.slice(0,80)); }
await page.waitForTimeout(3500);
await page.screenshot({ path: `tmp/mews-${target}-05-categories.png` });

// dump categories page
try {
  const cats = await cframe.evaluate(()=>{
    const out=[];
    for (const b of document.querySelectorAll('button, [role=button]')) {
      const t=(b.innerText||b.textContent||'').trim().slice(0,80);
      const r=b.getBoundingClientRect();
      if(r.width>0&&r.height>0&&t) out.push({text:t, testid:b.getAttribute('data-testid'), cls:(b.className||'').toString().slice(0,40), x:Math.round(r.x), y:Math.round(r.y)});
    }
    return out.slice(0,40);
  });
  console.log('[CATS] buttons:', JSON.stringify(cats, null, 1).slice(0,3000));
} catch(e){}

// 6) find first "Book"/"Reserve"/"Select" button and click
async function clickFirstBook() {
  const candidates = [
    {how:'text', sel:'Book'}, {how:'text', sel:'Reserve'}, {how:'text', sel:'Select'},
    {how:'text', sel:'Book now'}, {how:'text', sel:'Continue'}, {how:'text', sel:'Choose room'},
  ];
  for (const c of candidates) {
    try {
      const loc = fl.locator('button, [role=button]', { hasText: c.sel }).first();
      await loc.click({ timeout: 4000 });
      console.log(`[STEP] clicked "${c.sel}"`);
      return c.sel;
    } catch {}
  }
  return null;
}
const booked = await clickFirstBook();
console.log('[STEP] book-button clicked:', booked);
await page.waitForTimeout(3500);
await page.screenshot({ path: `tmp/mews-${target}-06-after-book.png` });

// dump whatever page we are on now
try {
  const now = await cframe.evaluate(()=>{
    const out=[];
    for (const b of document.querySelectorAll('button, [role=button]')) {
      const t=(b.innerText||b.textContent||'').trim().slice(0,80);
      const r=b.getBoundingClientRect();
      if(r.width>0&&r.height>0&&t) out.push({text:t, x:Math.round(r.x), y:Math.round(r.y)});
    }
    const inputs=[...document.querySelectorAll('input')].map(i=>({type:i.type,name:i.name,ph:i.placeholder,aria:i.getAttribute('aria-label')}));
    return {btns:out.slice(0,30), inputs:inputs.slice(0,20), body:document.body.innerText.replace(/\s+/g,' ').slice(0,400)};
  });
  console.log('[AFTER-BOOK] btns:', JSON.stringify(now.btns.slice(0,15)));
  console.log('[AFTER-BOOK] inputs:', JSON.stringify(now.inputs));
  console.log('[AFTER-BOOK] body:', now.body.slice(0,300));
} catch(e){}

// 7) keep clicking "Next"/"Continue"/"Book" until we hit payment or get stuck
let guard=0;
while (guard++ < 6) {
  // Payment indicators: card-number field, "Payment" heading, URL change, payment-method buttons
  let onPayment=false;
  try {
    onPayment = await cframe.evaluate(()=>{
      const t = document.body.innerText;
      return /payment|card number|credit card|cvv|expiry/i.test(t) ||
        !!document.querySelector('input[name*=card i], input[autocomplete*=cc-number i], input[id*=card i], [data-testid*=payment i]');
    });
  } catch{}
  if (onPayment) { console.log(`[STEP] PAYMENT DETECTED on iter ${guard}`); break; }
  const c = await clickFirstBook();
  if (!c) {
    // try a generic "Next"
    try { await fl.locator('button', { hasText: 'Next' }).first().click({ timeout: 4000 }); console.log('[STEP] clicked Next'); }
    catch { console.log('[STEP] no more buttons to click; stopping'); break; }
  }
  await page.waitForTimeout(2500);
}
await page.screenshot({ path: `tmp/mews-${target}-07-final.png`, fullPage: true });

// Final state summary
const finalUrl = page.url();
let paymentEl=null;
try {
  paymentEl = await cframe.evaluate(()=>{
    const card = document.querySelector('input[name*=card i], input[autocomplete*=cc-number i], [data-testid*=card-number i], input[id*=cardnumber i]');
    return card ? {name:card.name, id:card.id, auto:card.getAttribute('autocomplete')} : null;
  });
} catch{}
console.log('[FINAL] url=', finalUrl);
console.log('[FINAL] paymentElement=', JSON.stringify(paymentEl));

await browser.close();
console.log('DONE v3');
