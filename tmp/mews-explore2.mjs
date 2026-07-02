// Mews Distributor flow exploration v2 — wait for React mount inside the named iframe.
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

// Capture console + errors
page.on('console', m => { if (m.type()==='error') console.log('PAGE-ERR:', m.text().slice(0,160)); });
page.on('pageerror', e => console.log('JS-ERR:', e.message.slice(0,160)));

await page.goto(entryUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
// Wait for the named distributor iframe to populate
try { await page.waitForSelector(`iframe[name^="mews-distributor"]`, { timeout: 30000 }); } catch {}
// Wait for any visible button to appear inside it
try { await page.frameLocator(`iframe[name^="mews-distributor"]`).locator('button').first().waitFor({ state:'visible', timeout: 30000 }); } catch(e){ console.log('no visible btn yet:', e.message.slice(0,80)); }
await page.waitForTimeout(4000);

// Inspect ALL frames
const frames = page.frames();
console.log('FRAMES:', frames.map(f => f.url()));

// Find the distributor frame
let dframe = null;
for (const f of frames) {
  if (f.name().startsWith('mews-distributor')) { dframe = f; break; }
}
if (!dframe) {
  // fallback: any non-about:blank subframe or the main frame
  for (const f of frames) { if (f.url().includes('mews.com')) { dframe = f; break; } }
}
console.log('DFRAME url:', dframe ? dframe.url() : 'NULL');

async function dumpFrame(label, fr) {
  if (!fr) { console.log(`${label}: no frame`); return; }
  try {
    const data = await fr.evaluate(() => {
      const out = { buttons:[], inputs:[], text:[] };
      for (const b of document.querySelectorAll('button, [role=button], a[href], input[type=submit]')) {
        const t = (b.innerText||b.textContent||b.getAttribute('aria-label')||b.value||'').trim().slice(0,50);
        const r = b.getBoundingClientRect();
        if (r.width<=0||r.height<=0) continue;
        out.buttons.push({tag:b.tagName, text:t||b.getAttribute('data-testid')||'(notext)', testid:b.getAttribute('data-testid'), id:b.id, cls:(b.className||'').toString().slice(0,50), x:Math.round(r.x), y:Math.round(r.y)});
      }
      for (const el of document.querySelectorAll('input, [role=combobox], [role=textbox], select, [data-testid*=occupancy i], [data-testid*=date i]')) {
        const r = el.getBoundingClientRect();
        out.inputs.push({tag:el.tagName, type:el.type||el.getAttribute('type'), name:el.name||el.getAttribute('name'), ph:el.getAttribute('placeholder'), testid:el.getAttribute('data-testid'), aria:el.getAttribute('aria-label'), vis: r.width>0&&r.height>0, x:Math.round(r.x), y:Math.round(r.y)});
      }
      // any text resembling "search"/"check availability"/"book"
      const body = document.body ? document.body.innerText.slice(0,800) : '';
      out.bodyPreview = body;
      return out;
    });
    console.log(`--- ${label} BUTTONS (${data.buttons.length}) ---`);
    console.log(JSON.stringify(data.buttons.slice(0,40), null, 1));
    console.log(`--- ${label} INPUTS (${data.inputs.length}) ---`);
    console.log(JSON.stringify(data.inputs.slice(0,30), null, 1));
    console.log(`--- ${label} BODY ---`);
    console.log(data.bodyPreview.replace(/\s+/g,' ').slice(0,400));
  } catch(e) { console.log(`${label} eval err: ${e.message.slice(0,120)}`); }
}

await dumpFrame('DFRAME', dframe);
await dumpFrame('MAIN', page.mainFrame());

await page.screenshot({ path: `tmp/mews-${target}-02-afterwait.png`, fullPage: false });
console.log('saved tmp/mews-'+target+'-02-afterwait.png');

await browser.close();
console.log('DONE v2');
