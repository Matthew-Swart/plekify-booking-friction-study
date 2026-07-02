// Enumerate data-test-id attributes across the Mews flow.
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
chromium.use(StealthPlugin());
const URLS = {
  musa:    'https://app.mews.com/distributor/c99e4a6b-920b-401c-af99-ae200094de71',
  elmhirst:'https://app.mews.com/distributor/2498d048-7b66-4e46-a563-b26700598ec2',
};
const target = process.env.TARGET || 'musa';
const entryUrl = URLS[target];
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport:{width:1366,height:900}, userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', locale:'en-US' });
const page = await ctx.newPage();
const dframe = () => page.frames().find(f=>f.name().startsWith('mews-distributor'));
const fl = () => page.frameLocator('iframe[name^="mews-distributor"]');

async function dumpTestIds(stage) {
  const ids = await dframe().evaluate(()=>{
    const out=[];
    for (const el of document.querySelectorAll('[data-test-id],[data-testid]')) {
      const r=el.getBoundingClientRect();
      const tid = el.getAttribute('data-test-id') || el.getAttribute('data-testid');
      out.push({tid, tag:el.tagName, text:(el.innerText||el.getAttribute('aria-label')||'').trim().slice(0,30), vis:r.width>0&&r.height>0});
    }
    return out;
  }).catch(()=>[]);
  console.log(`[TESTIDS ${stage}]:`, JSON.stringify(ids.filter(x=>x.vis).map(x=>`${x.tid}=${x.tag}/${x.text||'-'}`)));
}

await page.goto(entryUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
try { await page.waitForSelector('iframe[name^="mews-distributor"]', { timeout: 30000 }); } catch {}
try { await fl().locator('button').first().waitFor({ state:'visible', timeout: 25000 }); } catch {}
await page.waitForTimeout(2500);
try { await page.locator('[data-testid="actionButton-accept"]').click({ timeout: 5000 }); } catch {}
await page.waitForTimeout(400);
await dumpTestIds('DATES_PAGE');
