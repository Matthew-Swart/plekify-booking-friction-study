/**
 * Mews Distributor — canonical booking flow to PAYMENT page (no real booking).
 * ---------------------------------------------------------------------
 * Drives: entry URL -> dismiss cookie -> dates -> categories -> rates ->
 *         book now -> summary -> continue -> DETAILS (= payment page).
 * STOPS at the payment page. Does NOT click "Confirm" (which would charge).
 *
 * Verified 2026-07-02 against three Mews Distributor properties:
 *   musa     (MUSA Lago di Como)        — paymentReached: true
 *   elmhirst (Elmhirst's Resort)        — paymentReached: true
 *   sunski   (Sun & Ski Inn and Suites) — paymentReached: true
 *
 * Selector notes:
 *   - The whole booking app is a React SPA inside a NAMED iframe:
 *       iframe[name^="mews-distributor"]   (frameLocator)
 *     The iframe is same-origin (app.mews.com -> app.mews.com) but Playwright
 *     still needs frameLocator / frame.evaluate to reach into it.
 *   - No URL change between steps (single-page app). The URL stays
 *     https://app.mews.com/distributor/{uuid} throughout.
 *   - NO date-prefilled deep link exists. Tested param formats ALL fail:
 *       ?start=, ?startDate=, ?arrival=, ?from=, ?checkin=, ?cin= (and end/to/...)
 *     The calendar must be driven manually.
 *   - Day cells: <button aria-label="16 August 2026, Sunday">16</button>
 *     After selection the label gains ", SelectedAsStartDate" / ", SelectedAsEndDate".
 *     Disabled days: aria-disabled="true" AND data-test-date="disabled-M/D/YYYY".
 *   - Calendar shows two months side-by-side; "Next month" button advances one.
 *   - The dates "Next" button carries data-test-id="dates-next-button".
 *   - On the "Details" (payment) page the card number + CVV render inside
 *     NESTED Datatrans Secure-Fields iframes:
 *       iframe[name^="securefields-"][name$="--cardNumber"]
 *       iframe[name^="securefields-"][name$="--cvv"]
 *     Expiration (input#expiration) and cardholder name (input#holderName)
 *     are NOT in an iframe.
 *   - A "Confirm" button on Details would attempt the charge — DO NOT click.
 *   - reCAPTCHA Enterprise (invisible) loads on the Details page.
 */

import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
chromium.use(StealthPlugin());

const URLS = {
  musa:    'https://app.mews.com/distributor/c99e4a6b-920b-401c-af99-ae200094de71',
  elmhirst:'https://app.mews.com/distributor/2498d048-7b66-4e46-a563-b26700598ec2',
  sunski:  'https://app.mews.com/distributor/a18e5b73-4fe4-468f-8cd7-b17e008232ec',
};

export async function driveToPayment(target = 'musa', { headless = true } = {}) {
  const entryUrl = URLS[target];
  if (!entryUrl) throw new Error(`unknown target: ${target}`);

  // Study-B rolling dates: check-in T+45, check-out T+47.
  const today = new Date();
  const cin  = new Date(today.getTime() + 45 * 86400000);
  const cout = new Date(today.getTime() + 47 * 86400000);
  const startMonthName = cin.toLocaleString('en-US', { month: 'long' });

  const browser = await chromium.launch({ headless });
  const ctx = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    locale: 'en-US',
  });
  const page = await ctx.newPage();
  const dframe = () => page.frames().find(f => f.name().startsWith('mews-distributor'));
  const fl = () => page.frameLocator('iframe[name^="mews-distributor"]');

  // 1. goto
  await page.goto(entryUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('iframe[name^="mews-distributor"]', { timeout: 30000 });
  await fl().locator('button').first().waitFor({ state: 'visible', timeout: 25000 });
  await page.waitForTimeout(2000);

  // 2. cookie banner (lives in the TOP page, not the iframe)
  await page.locator('[data-testid="actionButton-accept"]').click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);

  // 3. open date picker
  await fl().locator('button').filter({ hasText: 'Select dates' }).first().click({ timeout: 8000 });
  await page.waitForTimeout(1200);

  // helper: advance calendar until target month is visible in day-button labels
  const navToMonth = async (monthName) => {
    for (let i = 0; i < 10; i++) {
      const sample = await dframe().evaluate(() => {
        const ls = [...document.querySelectorAll('button[aria-label]')]
          .map(b => b.getAttribute('aria-label') || '')
          .filter(s => /^\d{1,2} \w+ \d{4}/.test(s));
        return ls.slice(0, 1).concat(ls.slice(-1));
      }).catch(() => []);
      if (sample.join(' ').toLowerCase().includes(monthName.toLowerCase())) return true;
      await dframe().evaluate(() => {
        const b = [...document.querySelectorAll('button[aria-label]')]
          .find(x => /next month/i.test(x.getAttribute('aria-label') || ''));
        if (b) b.click();
      }).catch(() => {});
      await page.waitForTimeout(450);
    }
    return false;
  };

  // helper: pick an enabled day by prefix match on aria-label
  const pickDay = async (d) => {
    const prefix = `${d.getDate()} ${d.toLocaleString('en-US', { month: 'long' })} ${d.getFullYear()}`;
    return await dframe().evaluate((prefix) => {
      const btns = [...document.querySelectorAll('button[aria-label]')].filter(b => {
        if (b.getAttribute('aria-disabled') === 'true') return false;
        if ((b.getAttribute('data-test-date') || '').startsWith('disabled')) return false;
        return (b.getAttribute('aria-label') || '').startsWith(prefix);
      });
      if (btns.length) { btns[0].click(); return btns[0].getAttribute('aria-label'); }
      return null;
    }, prefix).catch(() => null);
  };

  // 4. navigate + pick start, then navigate + pick end
  await navToMonth(startMonthName);
  const sLabel = await pickDay(cin);
  await page.waitForTimeout(700);
  const actualEnd = new Date(
    (sLabel ? new Date(sLabel.replace(',', '').split(' ').slice(0, 3).join(' ')) : cin).getTime() + 2 * 86400000
  );
  await navToMonth(actualEnd.toLocaleString('en-US', { month: 'long' }));
  await pickDay(actualEnd);
  await page.waitForTimeout(700);

  // 5. set adults = 2 (read actual count from the Adults occupancy counter, adjust)
  let adults = await dframe().evaluate(() => {
    const lbls = [...document.querySelectorAll('*')].filter(e => /^Adults?$/.test((e.innerText || '').trim()));
    for (const l of lbls) {
      let row = l;
      for (let i = 0; i < 5; i++) {
        if (row.parentElement) row = row.parentElement;
        const m = (row.innerText || '').match(/Adults?\D+(\d+)/);
        if (m) return parseInt(m[1], 10);
      }
    }
    return 2;
  }).catch(() => 2);
  for (let i = 0; i < 5 && adults !== 2; i++) {
    await dframe().evaluate((up) => {
      const b = [...document.querySelectorAll(`button[aria-label="${up ? 'Increment' : 'Decrement'}"]`)][0];
      if (b) b.click();
    }, adults < 2).catch(() => {});
    adults += adults < 2 ? 1 : -1;
    await page.waitForTimeout(300);
  }

  // 6. dismiss calendar overlay, then click Next -> Categories
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await dframe().evaluate(() => {
    const b = document.querySelector('button[data-test-id="dates-next-button"], button[aria-label="Next"]');
    if (b) b.click();
  }).catch(() => {});
  await page.waitForTimeout(3500);

  // helper: click first button whose trimmed innerText === text (case-insensitive), retry up to ~7s
  const clickExact = async (text) => {
    for (let a = 0; a < 10; a++) {
      const ok = await dframe().evaluate((t) => {
        const b = [...document.querySelectorAll('button')]
          .find(x => x.innerText.trim().toLowerCase() === t.toLowerCase());
        if (b && !b.disabled && b.getAttribute('aria-disabled') !== 'true') { b.click(); return true; }
        return false;
      }, text).catch(() => false);
      if (ok) return true;
      await page.waitForTimeout(700);
    }
    return false;
  };

  // 7. Categories -> Show rates
  await clickExact('Show rates');
  await page.waitForTimeout(2500);
  // 8. Rates -> Book now (-> Summary)
  await clickExact('Book now');
  await page.waitForTimeout(3000);
  // 9. Summary -> Continue (-> Details = PAYMENT page)
  await clickExact('Continue');
  await page.waitForTimeout(3000);

  // ---- PAYMENT PAGE = Details step. Verify indicators. ----
  const pay = await dframe().evaluate(() => {
    const headings = [...document.querySelectorAll('h1,h2,h3,h4')].map(h => (h.innerText || '').trim());
    return {
      hasPaymentHeading: headings.some(h => /payment/i.test(h)),
      cardNumberIframe: !!document.querySelector('iframe[name*="securefields"][name*="cardNumber"]'),
      cvvIframe:        !!document.querySelector('iframe[name*="securefields"][name*="cvv"]'),
      holderName:       !!document.querySelector('input#holderName'),
      expiration:       !!document.querySelector('input#expiration'),
      confirmBtn:       !![...document.querySelectorAll('button')].some(b => /^confirm$/i.test(b.innerText.trim())),
      url: location.href,
    };
  }).catch(() => null);

  const result = {
    system: 'mews',
    target,
    entryUrl,
    finalUrl: page.url(),
    paymentReached: !!(pay && (pay.cardNumberIframe || (pay.hasPaymentHeading && pay.holderName))),
    indicators: pay,
  };

  await browser.close();
  return result;
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  const target = process.env.TARGET || 'musa';
  driveToPayment(target, { headless: true })
    .then(r => { console.log(JSON.stringify(r, null, 2)); })
    .catch(e => { console.error('FAIL:', e); process.exit(1); });
}
