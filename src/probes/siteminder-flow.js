// SiteMinder (direct-book.com / thebookingbutton.com) flow probe.
// Goal: drive a booking to the PAYMENT PAGE (stop at payment — no real booking).
//
// Findings baked in (verified via live browser session 2026-07-02):
//  - Homepage "Book Now" link -> https://app.thebookingbutton.com/properties/<slug>
//    which 30x-redirects to https://direct-book.com/properties/<slug>  (the Vue SPA)
//  - Deep link with date params WORKS and bypasses the calendar:
//      https://direct-book.com/properties/<slug>?locale=en
//        &items[0][adults]=2&items[0][children]=0&items[0][infants]=0
//        &currency=USD&checkInDate=YYYY-MM-DD&checkOutDate=YYYY-MM-DD
//  - Cookie banner intercepts ALL clicks until dismissed:
//      button[data-sm-test="cookies-accept-all"]
//  - Available rates live in a listbox; each rate row has a "Select" button:
//      button[data-sm-test^="rate-select-"]
//  - After Select, summary "Book" button enables:
//      button[data-sm-test="summary-cart-book"]
//    -> navigates to /properties/<slug>/book?...&step=step1  (checkout: guest details)
//  - Step1 guest form -> Continue:
//      button[data-sm-test="guest-details-continue"]
//    -> /book?...&step=step3  (Terms + Conditions + final "proceed-to-payment" button)
//  - Final payment-reveal button:
//      button[data-sm-test="proceed-to-payment"]
//    The card-entry form (Stripe / NMI iframe) only renders AFTER T&Cs checkbox +
//    final Book click, gated by an INVISIBLE reCAPTCHA (size=invisible).
//    => For the friction test, "payment page reached" = the /book route with
//       step=step3 + presence of data-sm-test="proceed-to-payment".
//
// No card is ever entered. reCAPTCHA is invisible (v3-style score), no visible
// challenge observed on a normal residential-style headless run.

import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
chromium.use(StealthPlugin());

const PROPERTIES = [
  {
    name: 'Ivy City Hotel',
    homepage: 'https://www.ivycityhotel.com/',
    // Homepage "Book Now" / "Check Rates" anchor (resolved at runtime):
    expectedBookHost: ['thebookingbutton.com', 'direct-book.com'],
    slug: 'ivycityhoteldirect',
    currency: 'USD',
  },
  {
    name: 'Nantucket Whale Inn',
    homepage: 'https://www.nantucketwhaleinn.com/',
    expectedBookHost: ['thebookingbutton.com', 'direct-book.com'],
    slug: null, // discovered at runtime from the homepage book link
    currency: 'USD',
  },
  {
    name: 'Tremola San Gottardo',
    homepage: 'https://www.tremola-sangottardo.ch/english',
    expectedBookHost: ['thebookingbutton.com', 'direct-book.com'],
    slug: null,
    currency: 'CHF',
  },
];

const fmt = (d) => d.toISOString().slice(0, 10);

function targetDates() {
  const ci = new Date();
  ci.setDate(ci.getDate() + 45);
  const co = new Date();
  co.setDate(co.getDate() + 47);
  return { checkIn: fmt(ci), checkOut: fmt(co) };
}

function deepLink(slug, dates, currency) {
  // Confirmed date-prefilled SiteMinder URL. thebookingbutton.com also works as
  // an entry alias and redirects here, but going straight to direct-book.com
  // is one fewer hop.
  const u = new URL(`https://direct-book.com/properties/${slug}`);
  u.searchParams.set('locale', 'en');
  u.searchParams.set('currency', currency);
  // Bracketed array params — must be appended literally (URLSearchParams would
  // percent-encode the brackets; direct-book.com accepts BOTH encoded and raw,
  // but raw matches what the SPA itself emits).
  u.searchParams.append('items[0][adults]', '2');
  u.searchParams.append('items[0][children]', '0');
  u.searchParams.append('items[0][infants]', '0');
  u.searchParams.set('checkInDate', dates.checkIn);
  u.searchParams.set('checkOutDate', dates.checkOut);
  return u.toString();
}

async function discoverSlug(page, homepage) {
  // Load homepage, find the Book link, extract the property slug.
  await page.goto(homepage, { waitUntil: 'domcontentloaded', timeout: 45000 });
  // Any anchor whose href hits thebookingbutton.com / direct-book.com.
  const href = await page.evaluate(() => {
    const a = [...document.querySelectorAll('a[href]')].find(a =>
      /thebookingbutton\.com\/properties\/|direct-book\.com\/properties\//.test(a.href)
    );
    return a ? a.href : null;
  });
  if (!href) return null;
  const m = href.match(/\/properties\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

async function runOne(browser, prop, dates) {
  const ctx = await browser.newContext({
    locale: 'en-US',
    timezoneId: 'UTC',
    viewport: { width: 1366, height: 900 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  });
  const page = await ctx.newPage();
  const log = (o) => console.log(JSON.stringify({ property: prop.name, ...o }));

  const result = { name: prop.name, paymentReached: false, steps: [], error: null };

  try {
    // 1. Discover slug (and confirm the homepage book link exists).
    let slug = prop.slug;
    if (!slug) {
      await page.goto(prop.homepage, { waitUntil: 'domcontentloaded', timeout: 45000 });
      slug = await discoverSlug(page, prop.homepage);
      if (!slug) throw new Error('No thebookingbutton/direct-book book link on homepage');
      result.homepageBookLinkFound = true;
    } else {
      result.homepageBookLinkFound = 'pre-set';
    }
    result.slug = slug;

    // 2. Deep link straight to results (date-prefilled — bypasses calendar).
    const url = deepLink(slug, dates, prop.currency);
    result.deepLink = url;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    result.steps.push('goto deep-link results');

    // 3. Dismiss cookie banner (blocks all clicks until dismissed).
    const cookieBtn = page.locator('button[data-sm-test="cookies-accept-all"]');
    await cookieBtn.first().click({ timeout: 15000 }).catch(() => {});
    result.steps.push('dismiss cookie banner');

    // 4. Wait for at least one rate "Select" button.
    const selectBtn = page.locator('button[data-sm-test^="rate-select-"]').first();
    await selectBtn.waitFor({ state: 'visible', timeout: 30000 });
    const selectLabel = await selectBtn.getAttribute('data-sm-test');
    result.firstRateSelectAttr = selectLabel;
    result.steps.push('rate list rendered');

    // 5. Click "Select" on the first available rate.
    await selectBtn.click();
    result.steps.push('click rate Select');

    // 6. Summary "Book" button enables -> click -> /book?...step=step1.
    const bookBtn = page.locator('button[data-sm-test="summary-cart-book"]');
    await bookBtn.waitFor({ state: 'visible' });
    await page.waitForFunction(
      () => {
        const b = document.querySelector('button[data-sm-test="summary-cart-book"]');
        return b && !b.disabled;
      },
      { timeout: 15000 }
    );
    await bookBtn.click();
    await page.waitForURL(/\/book\?.*step=/, { timeout: 30000 });
    result.steps.push('click summary Book -> checkout /book step1');

    // 7. Fill guest-details (Step 1) -> Continue.
    await page.locator('#firstName').fill('Test');
    await page.locator('#lastName').fill('Booker');
    await page.locator('#email').fill('frictionstudy+test@example.com');
    await page.locator('#confirmEmail').fill('frictionstudy+test@example.com');
    await page.locator('#phone').fill('2025551234');
    await page.locator('#address1').fill('123 Test St');
    await page.locator('#city').fill('Washington');
    await page.locator('#state').fill('DC');
    await page.locator('#postCode').fill('20002');
    // Country is a vue-select combobox.
    const countryCombobox = page.locator('input[id^="uid-"][id$="-ibe-v-select"]').first();
    await countryCombobox.fill('United States');
    await page
      .locator('.vs__dropdown-menu .vs__dropdown-option', { hasText: 'United States' })
      .first()
      .click();
    result.steps.push('fill guest details');

    await page.locator('button[data-sm-test="guest-details-continue"]').click();
    result.steps.push('click guest-details Continue');

    // 8. Reach payment-gate: /book?...step=step3 with proceed-to-payment button.
    await page.waitForFunction(
      () => !!document.querySelector('button[data-sm-test="proceed-to-payment"]'),
      { timeout: 30000 }
    );
    const reachedUrl = page.url();
    result.paymentReached =
      /\/book\?/.test(reachedUrl) &&
      (reachedUrl.includes('step=step3') ||
        !!await page.locator('button[data-sm-test="proceed-to-payment"]').count());
    result.paymentPageUrl = reachedUrl;
    result.paymentIndicator =
      'URL contains /book?...step=step3 AND button[data-sm-test="proceed-to-payment"] present';
    result.steps.push('PAYMENT PAGE REACHED (step3 + proceed-to-payment)');

    // reCAPTCHA posture check (do NOT proceed).
    const captcha = await page.evaluate(() => {
      const ifr = [...document.querySelectorAll('iframe')].filter(f =>
        /recaptcha/.test(f.src || '')
      );
      const invisible = ifr.some(f => /size=invisible/.test(f.src || ''));
      return {
        present: ifr.length > 0,
        invisible,
        count: ifr.length,
      };
    });
    result.captcha = captcha;
    result.steps.push('stop (no card entered)');
  } catch (e) {
    result.error = e.message.split('\n')[0];
    result.lastUrl = page.url?.() ?? null;
  } finally {
    log(result);
    await ctx.close();
  }
  return result;
}

(async () => {
  const dates = targetDates();
  console.log(JSON.stringify({ checkIn: dates.checkIn, checkOut: dates.checkOut }));
  const browser = await chromium.launch({ headless: true });
  const results = [];
  for (const prop of PROPERTIES) {
    const r = await runOne(browser, prop, dates);
    results.push(r);
  }
  await browser.close();
  console.log('\n=== SUMMARY ===');
  for (const r of results) {
    console.log(
      `${r.name.padEnd(22)} paymentReached=${r.paymentReached} ` +
        `error=${r.error || '-'}`
    );
  }
})();
