// Mews: confirm what "payment" page looks like after Continue. Dump everything.
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
const ctx = await browser.newContext({ viewport:{width:1366,height:900}, userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', locale:'en-US' });
const page = await ctx.newPage();
const dframe = () => page.frames().find(f=>f.name().startsWith('mews-distributor'));
const fl = () => page.frameLocator('iframe[name^="mews-distributor"]');

await page.goto(entryUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
try { await page.waitForSelector('iframe[name^="mews-distributor"]', { timeout: 30000 }); } catch {}
try { await fl().locator('button').first().waitFor({ state:'visible', timeout: 25000 }); } catch {}
await page.waitForTimeout(2500);
try { await page.locator('[data-testid="actionButton-accept"]').click({ timeout: 5000 }); } catch {}
await page.waitForTimeout(400);

// open picker + navigate to start month
await fl().getByText('Select dates', { exact: true }).click({ timeout: 8000 });
await page.waitForTimeout(1000);
for (let i=0;i<6;i++){
  const m = await dframe().evaluate(()=>[...document.querySelectorAll('h2,h3,[class*=Month]')].map(h=>(h.innerText||'').trim()).filter(Boolean).join('|')).catch(()=>'');
  if (m.toLowerCase().includes(startMonthName.toLowerCase())) break;
  try { await dframe().locator('[aria-label*="next month" i]').first().click({ timeout: 3500 }); } catch { break; }
  await page.waitForTimeout(500);
}
// Pick an AVAILABLE day. Days have data-test-date="disabled-M/D/YYYY" when booked,
// aria-disabled="true" when not selectable. Use JS to find first enabled day >=15 in start month.
const picked = await dframe().evaluate((yr, moIdx) => {
  // moIdx is 0-based
  const btns = [...document.querySelectorAll('button[aria-label]')].filter(b => {
    if (b.getAttribute('aria-disabled') === 'true') return false;
    const al = b.getAttribute('aria-label') || '';
    if (!/^\d{1,2} \w+ \d{4}/.test(al)) return false;
    const d = new Date(al.replace(',', '').split(' ').slice(0,3).join(' '));
    return d.getFullYear()===yr && d.getMonth()===moIdx;
  });
  // sort by day-of-month ascending
  btns.sort((a,b)=> parseInt(a.innerText,10) - parseInt(b.innerText,10));
  // pick one with day>=15 if possible, else the latest available
  const late = btns.find(b=>parseInt(b.innerText,10)>=15);
  return (late||btns[btns.length-1] || null);
}, cin.getFullYear(), cin.getMonth()).catch(()=>null);

let chosenStart=null, chosenEnd=null;
if (picked) {
  // re-resolve inside frame and click
  const label = picked.getAttribute && picked.getAttribute('aria-label');
  // We can't click a deserialised node; click by aria-label instead.
  if (label) {
    try { await dframe().locator(`button[aria-label="${label}"]`).click({ timeout: 5000 }); chosenStart=label; console.log('[4] start picked:', label); } catch(e){ console.log('[4] start click fail', e.message.slice(0,60)); }
  }
}
await page.waitForTimeout(700);
// End: pick an enabled day 2 days later in the same month (or next).
if (chosenStart) {
  const sd = new Date(chosenStart.replace(',','').split(' ').slice(0,3).join(' '));
  const ed = new Date(sd.getTime() + 2*86400000);
  const eDay = ed.getDate();
  const eMonth = ed.toLocaleString('en-US',{month:'long'});
  const eYr = ed.getFullYear();
  // navigate to that month if needed
  for (let i=0;i<4;i++){
    const m = await dframe().evaluate(()=>[...document.querySelectorAll('h2,h3,[class*=Month]')].map(h=>(h.innerText||'').trim()).filter(Boolean).join('|')).catch(()=>'');
    if (m.toLowerCase().includes(eMonth.toLowerCase())) break;
    try { await dframe().locator('[aria-label*="next month" i]').first().click({ timeout: 3500 }); } catch { break; }
    await page.waitForTimeout(500);
  }
  // find enabled end-day
  const eLabel = await dframe().evaluate((d,mname,y)=>{
    const btns=[...document.querySelectorAll('button[aria-label]')].filter(b=>b.getAttribute('aria-disabled')!=='true' && new Date((b.getAttribute('aria-label')||'').replace(',','').split(' ').slice(0,3).join(' ')).getMonth()===new Date(`${d} ${mname} ${y}`).getMonth());
    const hit = btns.find(b=>parseInt(b.innerText,10)===d);
    return hit? hit.getAttribute('aria-label') : null;
  }, eDay, eMonth, eYr).catch(()=>null);
  if (eLabel) {
    try { await dframe().locator(`button[aria-label="${eLabel}"]`).click({ timeout: 5000 }); chosenEnd=eLabel; console.log('[4] end picked:', eLabel); } catch(e){ console.log('[4] end click fail', e.message.slice(0,60)); }
  }
}
// adults: ensure 2
let adultsNow = 0;
try { const txt = await dframe().evaluate(()=>document.body.innerText); const m = txt.match(/Guests selected\s*(\d+)\s*Adult/); adultsNow = m?parseInt(m[1],10):0; } catch {}
if (!adultsNow) { try { const txt = await dframe().evaluate(()=>document.body.innerText); const m = txt.match(/(\d+)\s*Adults?/); adultsNow = m?parseInt(m[1],10):0; } catch {} }
console.log('[5] adults now=', adultsNow);
if (adultsNow < 2) { try { await dframe().locator('button', { hasText: 'Increment' }).first().click({ timeout: 4000 }); } catch {} }
await page.waitForTimeout(500);
await fl().locator('button', { hasText: 'Next' }).first().click({ timeout: 8000 });
console.log('[6] -> Categories');
await page.waitForTimeout(3000);

// Show rates -> first Book now
await fl().locator('button', { hasText: 'Show rates' }).first().click({ timeout: 8000 });
await page.waitForTimeout(3000);
await dframe().locator('button').filter({ hasText: /^Book now$/ }).first().click({ timeout: 8000 });
console.log('[7] -> Summary');
await page.waitForTimeout(3000);
await page.screenshot({ path: `tmp/mews-${target}-payd-01-summary.png` });

// Continue -> Details (guest form)
try { await dframe().locator('button').filter({ hasText: /^Continue$/ }).first().click({ timeout: 8000 }); console.log('[8] Continue -> Details'); } catch(e){ console.log('[8] continue fail', e.message.slice(0,80)); }
await page.waitForTimeout(3000);
await page.screenshot({ path: `tmp/mews-${target}-payd-02-details.png` });

// Dump Details page thoroughly
const dd = await dframe().evaluate(()=>{
  return {
    headings:[...document.querySelectorAll('h1,h2,h3,h4')].map(h=>(h.innerText||'').trim()).filter(Boolean),
    btns:[...document.querySelectorAll('button, [role=button]')].filter(b=>{const r=b.getBoundingClientRect();return r.width>0&&r.height>0;}).map(b=>({text:(b.innerText||'').trim().slice(0,40), x:Math.round(b.getBoundingClientRect().x)})),
    inputs:[...document.querySelectorAll('input, [role=textbox], textarea, select')].map(i=>({type:i.type, name:i.name, id:i.id, ph:i.getAttribute('placeholder'), aria:i.getAttribute('aria-label'), auto:i.getAttribute('autocomplete'), vis:i.getBoundingClientRect().width>0})),
    body: document.body.innerText.replace(/\s+/g,' ').slice(0,700),
  };
}).catch(()=>null);
console.log('[DETAILS] headings:', JSON.stringify(dd?.headings));
console.log('[DETAILS] btns:', JSON.stringify(dd?.btns?.slice(0,25)));
console.log('[DETAILS] inputs:', JSON.stringify(dd?.inputs));
console.log('[DETAILS] body:', dd?.body);

// Fill the details form. Mews Details page asks for: First name, Last name, Email, Phone, Country, etc.
try {
  await dframe().evaluate(()=>{
    const setVal=(el,val)=>{ const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; s.call(el,val); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); el.dispatchEvent(new Event('blur',{bubbles:true})); };
    for (const el of document.querySelectorAll('input, textarea')) {
      const ph = (el.getAttribute('placeholder')||'').toLowerCase();
      const aria = (el.getAttribute('aria-label')||'').toLowerCase();
      const auto = (el.getAttribute('autocomplete')||'').toLowerCase();
      const lbl = ph+' '+aria+' '+auto;
      if (/first name|given-name/.test(lbl)) setVal(el,'Jane');
      else if (/last name|family-name|surname/.test(lbl)) setVal(el,'Doe');
      else if (/email|e-mail/.test(lbl)) setVal(el,'friction.test@example.com');
      else if (/phone|tel/.test(lbl)) setVal(el,'+27123456789');
      else if (/address/.test(auto)) setVal(el,'1 Test St');
      else if (/city|locality/.test(auto)) setVal(el,'Testville');
      else if (/zip|postal/.test(auto)) setVal(el,'8001');
    }
  });
  console.log('[9] filled details');
} catch(e){ console.log('[9] fill err', e.message.slice(0,80)); }
await page.waitForTimeout(800);
await page.screenshot({ path: `tmp/mews-${target}-payd-03-details-filled.png` });

// click Continue / Pay / Book again
for (const c of ['Continue','Pay','Book','Confirm','Complete']) {
  try { const h = await dframe().locator('button').filter({ hasText: new RegExp('^'+c+'$') }).elementHandles(); for (const x of h){ const t=(await x.innerText().catch(()=>'')).trim(); if (t===c) { await x.click({ timeout: 5000 }); console.log(`[10] clicked "${c}"`); break; } } } catch {}
}

// Wait for payment
await page.waitForTimeout(5000);
await page.screenshot({ path: `tmp/mews-${target}-payd-04-after-continue.png`, fullPage: true });

// FINAL payment-page inspection. Look for: card input, payment-method radio, "Payment" heading,
// and crucially: nested iframes (Stripe/Mangopay/Adyen card fields live in iframes)
const allFrames = page.frames().map(f=>({url:f.url(), name:f.name()}));
console.log('[FINAL] all frames:', JSON.stringify(allFrames));
const fpay = await dframe().evaluate(()=>{
  return {
    headings:[...document.querySelectorAll('h1,h2,h3,h4')].map(h=>(h.innerText||'').trim()).filter(Boolean),
    body: document.body.innerText.replace(/\s+/g,' ').slice(0,800),
    iframes:[...document.querySelectorAll('iframe')].map(i=>({src:(i.src||'').slice(0,80), name:i.name, title:i.title, id:i.id})),
    paymentTexts: [...document.querySelectorAll('*')].filter(e=>/payment method|card number|cvv|expiry|cardholder/i.test(e.innerText||'') && e.children.length===0).map(e=>(e.innerText||'').trim().slice(0,60)).slice(0,10),
    inputs:[...document.querySelectorAll('input, [role=textbox]')].map(i=>({type:i.type, name:i.name, id:i.id, aria:i.getAttribute('aria-label'), auto:i.getAttribute('autocomplete')})),
  };
}).catch(()=>null);
console.log('[PAY-PAGE] headings:', JSON.stringify(fpay?.headings));
console.log('[PAY-PAGE] iframes:', JSON.stringify(fpay?.iframes));
console.log('[PAY-PAGE] paymentTexts:', JSON.stringify(fpay?.paymentTexts));
console.log('[PAY-PAGE] inputs:', JSON.stringify(fpay?.inputs));
console.log('[PAY-PAGE] body:', fpay?.body);

const finalUrl = page.url();
console.log('[FINAL] url=', finalUrl);

await browser.close();
console.log('DONE paydump');
