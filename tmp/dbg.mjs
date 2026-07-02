import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
chromium.use(StealthPlugin());
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', viewport: {width:1366,height:900}, locale:'en-US' });
const p = await ctx.newPage();
const url = 'https://direct-book.com/properties/ivycityhoteldirect/book?locale=en&items[0][adults]=2&items[0][children]=0&items[0][infants]=0&items[0][rateId]=188501&currency=USD&checkInDate=2026-08-16&checkOutDate=2026-08-18&trackPage=yes&selected=0&step=step1';
await p.goto(url, { waitUntil:'domcontentloaded', timeout: 60000 });
// dismiss cookies
await p.evaluate(() => { const b=document.querySelector('button[data-sm-test="cookies-accept-all"]'); if(b) b.click(); });
await p.waitForTimeout(2000);
const probe = await p.evaluate(() => {
  const f = document.querySelector('#firstName');
  if (!f) return { exists:false };
  const r = f.getBoundingClientRect();
  const cs = getComputedStyle(f);
  // What element is at the center of the field?
  const el = document.elementFromPoint(r.x+r.width/2, r.y+r.height/2);
  return {
    exists:true, visible: cs.visibility!=='hidden' && cs.display!=='none' && r.width>0 && r.height>0,
    rect:{x:r.x,y:r.y,w:r.width,h:r.height},
    elementAtCenter: el ? (el.tagName + (el.id?('#'+el.id):'') + (el.className?('.'+el.className):'')) : null,
    bodyTextLen: document.body.innerText.length,
    title: document.title,
  };
});
console.log(JSON.stringify(probe, null, 2));
// try fill
try {
  await p.locator('#firstName').click({ timeout: 5000 });
  console.log('CLICK OK');
} catch(e) { console.log('CLICK ERR:', e.message.split('\n')[0]); }
await b.close();
