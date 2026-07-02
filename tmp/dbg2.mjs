import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
chromium.use(StealthPlugin());
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', viewport: {width:1366,height:900}, locale:'en-US' });
const p = await ctx.newPage();
const url = 'https://direct-book.com/properties/ivycityhoteldirect/book?locale=en&items[0][adults]=2&items[0][children]=0&items[0][infants]=0&items[0][rateId]=188501&currency=USD&checkInDate=2026-08-16&checkOutDate=2026-08-18&trackPage=yes&selected=0&step=step1';
await p.goto(url, { waitUntil:'domcontentloaded', timeout: 60000 });
// Wait for the cookie accept button to actually be present, then Playwright-click it (real event)
await p.locator('button[data-sm-test="cookies-accept-all"]').first().click({ timeout: 15000 });
await p.waitForTimeout(1500);
const probe = await p.evaluate(() => {
  const f = document.querySelector('#firstName');
  const r = f.getBoundingClientRect();
  const el = document.elementFromPoint(r.x+r.width/2, r.y+r.height/2);
  const overlay = document.querySelector('.cookie-overlay');
  return {
    elementAtCenter: el ? (el.tagName + (el.id?('#'+el.id):'')) : null,
    overlayStillInDOM: !!overlay,
    overlayDisplay: overlay ? getComputedStyle(overlay).display : null,
  };
});
console.log(JSON.stringify(probe, null, 2));
try { await p.locator('#firstName').click({ timeout: 5000 }); console.log('CLICK OK'); } catch(e){ console.log('CLICK ERR:', e.message.split('\n')[0]); }
await b.close();
