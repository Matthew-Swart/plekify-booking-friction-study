import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
chromium.use(StealthPlugin());
const b = await chromium.launch({headless:true});
const ctx = await b.newContext({viewport:{width:1366,height:900},locale:'en-US',userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'});
await ctx.route('**/*.{png,jpg,jpeg,webp,gif,svg,woff,woff2,ttf,mp4}', r=>r.abort());
const p = await ctx.newPage();
const pad=n=>String(n).padStart(2,'0');
const ci=new Date(); ci.setDate(ci.getDate()+45); const co=new Date(); co.setDate(co.getDate()+47);
const url = 'https://hotelamparkring.ibe.stayntouch.com/search-results?checkin='+pad(ci.getMonth()+1)+'-'+pad(ci.getDate())+'-'+ci.getFullYear()+'&checkout='+pad(co.getMonth()+1)+'-'+pad(co.getDate())+'-'+co.getFullYear()+'&adults=2&kids=0&lang=en';
console.log('url:', url);
await p.goto(url, {waitUntil:'domcontentloaded', timeout:45000});
await new Promise(r=>setTimeout(r,5000));
console.log('final url:', p.url());
const dom = await p.evaluate(()=>({
  title: document.title,
  headings: Array.from(document.querySelectorAll('h1,h2,h3')).filter(e=>e.offsetWidth).map(e=>(e.innerText||'').trim().slice(0,60)),
  btnBookCount: document.querySelectorAll('.btn-book').length,
  allBookBtns: Array.from(document.querySelectorAll('button')).filter(b=>/book now/i.test(b.innerText)).length,
  noResults: /no (rooms|availability|results)|sold ?out|unavailable/i.test(document.body.innerText),
  bodyTextStart: document.body.innerText.replace(/\s+/g,' ').slice(0,400),
  rateClasses: Array.from(document.querySelectorAll('[class*="rate" i],[class*="room" i]')).filter(e=>e.offsetWidth).length,
}));
console.log(JSON.stringify(dom, null, 2));
await b.close();
