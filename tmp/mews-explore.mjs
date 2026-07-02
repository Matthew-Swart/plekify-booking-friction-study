// Mews Distributor flow exploration — headless.
// Goal: reach the PAYMENT page (stop there, no real booking).
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
if (!entryUrl) { console.error('bad target'); process.exit(2); }

// Dates: T+45 to T+47
const today = new Date();
const cin = new Date(today.getTime() + 45 * 86400000);
const cout = new Date(today.getTime() + 47 * 86400000);
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const startISO = iso(cin), endISO = iso(cout);
console.log(`TARGET=${target}  cin=${startISO}  cout=${endISO}`);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1366, height: 900 },
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  locale: 'en-US',
});

const page = await ctx.newPage();

// ---- STEP 0: try a date-prefilled deep link first ----
const deepVariants = [
  `${entryUrl}?start=${startISO}&end=${endISO}&adults=2`,
  `${entryUrl}?startDate=${startISO}&endDate=${endISO}&adults=2`,
  `${entryUrl}?from=${startISO}&to=${endISO}&adults=2`,
];

const probe = {};
await page.goto(entryUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(3000); // let React hydrate

// iframe check
let frames = page.frames();
console.log('FRAMES after load:', frames.map(f => ({url: f.url(), name: f.name()})));
const mewsFrame = page.frameLocator('iframe').first();

// cookie banner discovery
const cookieSel = [
  '#onetrust-accept-btn-handler',
  'button:has-text("Accept all")',
  'button:has-text("Accept")',
  'button:has-text("I agree")',
  '[aria-label*="cookie" i] button',
  '[id*="cookie" i] button',
];
let cookieBtn = null;
for (const s of cookieSel) {
  try { const el = await page.$(s); if (el) { cookieBtn = s; break; } } catch {}
}
console.log('COOKIE selector guess:', cookieBtn);

// Dump: all visible buttons + their text + bounding boxes (top of page)
const btnDump = await page.evaluate(() => {
  const out = [];
  for (const b of document.querySelectorAll('button, [role=button], a')) {
    const t = (b.innerText||b.textContent||'').trim().slice(0,40);
    const r = b.getBoundingClientRect();
    if (r.width>0 && r.height>0 && t) out.push({tag:b.tagName, text:t, cls:(b.className||'').toString().slice(0,60), id:b.id, x:Math.round(r.x), y:Math.round(r.y)});
  }
  return out.slice(0,60);
});
console.log('BUTTONS (page root):', JSON.stringify(btnDump, null, 1).slice(0, 2500));

// Look inside iframes for buttons (availability search)
for (const f of page.frames()) {
  if (f === page.mainFrame()) continue;
  try {
    const ib = await f.evaluate(() => {
      const out = [];
      for (const b of document.querySelectorAll('button, [role=button], a, input[type=submit]')) {
        const t = (b.innerText||b.textContent||b.getAttribute('aria-label')||b.getAttribute('value')||'').trim().slice(0,40);
        const r = b.getBoundingClientRect();
        if (r.width>0 && r.height>0) out.push({tag:b.tagName, text:t||b.getAttribute('data-testid')||'(no-text)', cls:(b.className||'').toString().slice(0,60), id:b.id, testid:b.getAttribute('data-testid'), type:b.getAttribute('type'), x:Math.round(r.x), y:Math.round(r.y)});
      }
      return out.slice(0,80);
    });
    console.log(`FRAME ${f.url().slice(0,70)} BUTTONS:`, JSON.stringify(ib, null, 1).slice(0, 3500));
  } catch(e) { console.log('frame eval err', e.message.slice(0,80)); }
}

// Inputs (esp. date / occupancy)
for (const f of page.frames()) {
  try {
    const ii = await f.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('input, [role=combobox], [role=textbox], select')) {
        const r = el.getBoundingClientRect();
        out.push({frame: f===window? 'main':'sub', tag:el.tagName, type:el.getAttribute('type'), name:el.getAttribute('name'), ph:el.getAttribute('placeholder'), testid:el.getAttribute('data-testid'), aria:el.getAttribute('aria-label'), vis: r.width>0&&r.height>0, x:Math.round(r.x), y:Math.round(r.y)});
      }
      return out;
    });
    console.log(`INPUTS (${f.url().slice(0,50)}):`, JSON.stringify(ii, null, 1).slice(0, 2000));
  } catch(e){}
}

await page.screenshot({ path: `tmp/mews-${target}-01-load.png`, fullPage: false });
console.log('saved screenshot tmp/mews-'+target+'-01-load.png');

await browser.close();
console.log('DONE phase1');
