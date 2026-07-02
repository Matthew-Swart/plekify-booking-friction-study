// Mews Distributor canonical flow spec — drives to PAYMENT page, no real booking.
// Uses data-test-id where available; falls back to aria-label/text.
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
const startMonthName = cin.toLocaleString('en-US',{month:'long'});
console.log(`TARGET=${target} cin=${iso(cin)} cout=${iso(cout)}`);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport:{width:1366,height:900}, userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', locale:'en-US' });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('JS-ERR:', e.message.slice(0,100)));
const dframe = () => page.frames().find(f=>f.name().startsWith('mews-distributor'));
const fl = () => page.frameLocator('iframe[name^="mews-distributor"]');

// ---- goto ----
await page.goto(entryUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForSelector('iframe[name^="mews-distributor"]', { timeout: 30000 });
await fl().locator('button').first().waitFor({ state:'visible', timeout: 25000 });
await page.waitForTimeout(2000);

// ---- cookie dismiss (main frame) ----
try { await page.locator('[data-testid="actionButton-accept"]').click({ timeout: 5000 }); console.log('[1] cookie dismissed'); }
catch { console.log('[1] cookie banner not present'); }
await page.waitForTimeout(400);

// ---- open date picker ----
await fl().locator('button[data-test-id*="dates" i], button').filter({ hasText: 'Select dates' }).first().click({ timeout: 8000 });
console.log('[2] date picker opened');
await page.waitForTimeout(1000);

// ---- navigate to start month ----
for (let i=0;i<6;i++){
  const m = await dframe().evaluate(()=>[...document.querySelectorAll('[class*=MonthHeader],[class*=Month] h2,h2,h3')].map(h=>(h.innerText||'').trim()).filter(Boolean).join('|')).catch(()=>'');
  if (m.toLowerCase().includes(startMonthName.toLowerCase())) { console.log(`[3] month nav ok iter=${i}`); break; }
  try { await dframe().locator('[aria-label*="next month" i]').first().click({ timeout: 3000 }); } catch { break; }
  await page.waitForTimeout(400);
}

// ---- pick enabled start & end days (skip aria-disabled / data-test-date=disabled-) ----
async function pickEnabledDay(targetDate) {
  const want = targetDate.toLocaleString('en-US',{ weekday:'long', year:'numeric', month:'long', day:'numeric'});
  // Build "16 August 2026, Sunday"
  const label = `${targetDate.getDate()} ${targetDate.toLocaleString('en-US',{month:'long'})} ${targetDate.getFullYear()}, ${targetDate.toLocaleString('en-US',{weekday:'long'})}`;
  // first try exact
  for (const l of [label, label.replace(/,.*/,'')]) {
    const loc = dframe().locator(`button[aria-label="${l}"]`);
    const c = await loc.count();
    for (let i=0;i<c;i++){
      const dis = await loc.nth(i).getAttribute('aria-disabled');
      const tdate = await loc.nth(i).getAttribute('data-test-date');
      if (dis!=='true' && !(tdate||'').startsWith('disabled')) {
        await loc.nth(i).click({ timeout: 5000 });
        return l;
      }
    }
  }
  // fallback: any enabled day in the same month close to target day
  const fallback = await dframe().evaluate((yr, mo, day)=>{
    const btns=[...document.querySelectorAll('button[aria-label]')].filter(b=>{
      if (b.getAttribute('aria-disabled')==='true') return false;
      const td=b.getAttribute('data-test-date')||'';
      if (td.startsWith('disabled')) return false;
      const al=b.getAttribute('aria-label');
      const d=new Date(al.replace(',','').split(' ').slice(0,3).join(' '));
      return d.getFullYear()===yr && d.getMonth()===mo;
    });
    btns.sort((a,b)=>Math.abs(parseInt(a.innerText,10)-day) - Math.abs(parseInt(b.innerText,10)-day));
    return btns[0]? btns[0].getAttribute('aria-label') : null;
  }, targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate()).catch(()=>null);
  if (fallback) { await dframe().locator(`button[aria-label="${fallback}"]`).click({ timeout: 5000 }); return fallback; }
  return null;
}

const sLabel = await pickEnabledDay(cin);
console.log('[4] start picked:', sLabel);
await page.waitForTimeout(700);
const actualEnd = new Date((sLabel ? new Date(sLabel.replace(',','').split(' ').slice(0,3).join(' ')) : cin).getTime() + 2*86400000);
// navigate to end month if different
const eMonth = actualEnd.toLocaleString('en-US',{month:'long'});
for (let i=0;i<4;i++){
  const m = await dframe().evaluate(()=>[...document.querySelectorAll('h2,h3')].map(h=>(h.innerText||'').trim()).filter(Boolean).join('|')).catch(()=>'');
  if (m.toLowerCase().includes(eMonth.toLowerCase())) break;
  try { await dframe().locator('[aria-label*="next month" i]').first().click({ timeout: 3000 }); } catch { break; }
  await page.waitForTimeout(400);
}
const eLabel = await pickEnabledDay(actualEnd);
console.log('[4] end picked:', eLabel);
await page.waitForTimeout(700);

// ---- adults -> 2 (if default is 1, click first Increment) ----
let adultsNow=0;
try { const t = await dframe().evaluate(()=>document.body.innerText); const m=t.match(/Guests selected\s*(\d+)\s*Adult/)||t.match(/^\s*(\d+)\s*Adult/m); adultsNow = m?parseInt(m[1],10):1; } catch {}
if (adultsNow < 2) { try { await dframe().locator('button[aria-label="Increment"]').first().click({ timeout: 4000 }); console.log('[5] adults -> 2'); } catch(e){ console.log('[5] adults inc fail', e.message.slice(0,50)); } }

// ---- dismiss calendar popup (portal-container overlay) then click Next ----
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
// Click Next via JS to bypass any overlay intercept
try {
  await dframe().evaluate(()=>{ const b=document.querySelector('button[data-test-id="dates-next-button"], button[aria-label="Next"]'); if(b) b.click(); });
  console.log('[6] Next -> Categories (via JS click)');
} catch(e){ console.log('[6] Next JS-click fail, trying locator:', e.message.slice(0,60)); try { await fl().locator('button[aria-label="Next"]').click({ timeout: 8000 }); } catch {} }
await page.waitForTimeout(3500);

// ---- Categories: Show rates then first "Book now" (both via JS click to dodge overlays) ----
try {
  await dframe().evaluate(()=>{ const b=[...document.querySelectorAll('button')].find(x=>/show rates/i.test(x.innerText)); if(b) b.click(); });
  console.log('[7] clicked Show rates');
} catch(e){ console.log('[7] show-rates fail', e.message.slice(0,60)); }
await page.waitForTimeout(3000);

try {
  await dframe().evaluate(()=>{ const b=[...document.querySelectorAll('button')].find(x=>/^book now$/i.test(x.innerText.trim())); if(b) b.click(); });
  console.log('[8] clicked Book now -> Summary');
} catch(e){ console.log('[8] book-now fail', e.message.slice(0,60)); }
await page.waitForTimeout(3000);

// ---- Summary -> Continue (Details page) ----
try {
  await dframe().evaluate(()=>{ const b=[...document.querySelectorAll('button')].find(x=>/^continue$/i.test(x.innerText.trim())); if(b) b.click(); });
  console.log('[9] Summary -> Continue -> Details');
} catch(e){ console.log('[9] continue fail', e.message.slice(0,60)); }
await page.waitForTimeout(3000);

// ---- PAYMENT PAGE = Details page (combined contact + payment). Verify. ----
const pay = await dframe().evaluate(()=>{
  const body=document.body.innerText;
  const hasPaymentHeading = !![...document.querySelectorAll('h1,h2,h3,h4')].find(h=>/payment/i.test(h.innerText));
  const cardNumberIframe = !!document.querySelector('iframe[name*="securefields"][name*="cardNumber"]');
  const cvvIframe = !!document.querySelector('iframe[name*="securefields"][name*="cvv"]');
  const holderName = !!document.querySelector('input#holderName');
  const expiration = !!document.querySelector('input#expiration');
  const confirmBtn = !![...document.querySelectorAll('button')].find(b=>/^confirm$/i.test(b.innerText.trim()));
  return { hasPaymentHeading, cardNumberIframe, cvvIframe, holderName, expiration, confirmBtn, body:body.slice(0,300) };
}).catch(()=>null);

console.log('[PAYMENT PAGE REACHED]:', JSON.stringify(pay));
await page.screenshot({ path: `tmp/mews-${target}-FINAL-payment.png`, fullPage: true });

const finalUrl = page.url();
console.log('[FINAL URL]:', finalUrl);
console.log('[RESULT] paymentReached=', !!(pay && (pay.cardNumberIframe || (pay.hasPaymentHeading && pay.holderName))));

await browser.close();
console.log('DONE final-spec');
