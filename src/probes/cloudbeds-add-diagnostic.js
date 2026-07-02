/**
 * Diagnostic: on Add click, what network requests fire? Is there Cloudflare?
 * Confirms whether the click reaches Cloudbeds' backend or is silently dropped.
 */
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { sleep } from '../util.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

async function main() {
  chromium.use(StealthPlugin());
  const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 900 }, locale: 'en-US' });
  const page = await ctx.newPage();

  const reqs = [];
  page.on('request', (r) => { const u = r.url(); if (/cart|add|reservation|graphql|api/i.test(u)) reqs.push({ m: r.method(), u: u.slice(0, 110), ct: r.headers()['content-type'] || '' }); });
  page.on('response', (r) => { const u = r.url(); if (/cart|add/i.test(u)) reqs.push({ resp: r.status(), u: u.slice(0, 110) }); });
  const cons = [];
  page.on('console', (m) => cons.push(`${m.type()}: ${m.text().slice(0, 100)}`));
  page.on('pageerror', (e) => cons.push('PAGEERR: ' + String(e).slice(0, 120)));

  const today = new Date();
  const cinIso = iso(new Date(today.getTime() + 45 * 86400000));
  const coutIso = iso(new Date(today.getTime() + 47 * 86400000));
  await page.goto(`https://hotels.cloudbeds.com/en/reservation/SoRbvN/?checkin=${cinIso}&checkout=${coutIso}&adults=2`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await sleep(7000);

  // Cloudflare / bot-detection probes
  const sec = await page.evaluate(() => {
    return {
      cfBrowser: typeof navigator.__cfChallengeRunning !== 'undefined' || /cloudflare/i.test(navigator.userAgent),
      turnstile: !!document.querySelector('.cf-turnstile, [data-sitekey], iframe[src*="turnstile"]'),
      challengeCookie: document.cookie.includes('cf_') || document.cookie.includes('__cf'),
      reCAPTCHA: !!document.querySelector('iframe[src*="recaptcha"]'),
      cookies: document.cookie.split(';').map((c) => c.trim().split('=')[0]).slice(0, 20),
      webdriver: navigator.webdriver,
    };
  }).catch(() => ({}));
  console.log('security probes:', JSON.stringify(sec, null, 2));

  // baseline request count before click
  const before = reqs.length;
  console.log('\n--- clicking Add ---');
  await page.locator('button.cb-select-button').first().click({ timeout: 5000 }).catch(() => {});
  await sleep(3000);
  console.log('requests during/after Add (delta ' + (reqs.length - before) + '):');
  reqs.slice(before).forEach((r) => console.log('  ', JSON.stringify(r)));
  console.log('console msgs (last 12):');
  cons.slice(-12).forEach((c) => console.log('  ', c));

  await ctx.close();
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
