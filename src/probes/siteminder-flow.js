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

// Slugs verified 2026-07-02 by inspecting each homepage's "Book Now" anchor.
// Ivy City: https://app.thebookingbutton.com/properties/ivycityhoteldirect
// Nantucket: https://app.thebookingbutton.com/whale/properties/nantucketdirect
//   (note the per-property partner alias "/whale/" before /properties/)
// Tremola: discovered live -> BedNBikeTremolaSanGottardoDIRECT
const PROPERTIES = [
  { name: 'Ivy City Hotel', homepage: 'https://www.ivycityhotel.com/', slug: 'ivycityhoteldirect', currency: 'USD' },
  { name: 'Nantucket Whale Inn', homepage: 'https://www.nantucketwhaleinn.com/', slug: 'nantucketdirect', currency: 'USD' },
  { name: 'Tremola San Gottardo', homepage: 'https://www.tremola-sangottardo.ch/english', slug: 'BedNBikeTremolaSanGottardoDIRECT', currency: 'CHF' },
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
  // Confirmed date-prefilled SiteMinder URL, built as a RAW string.
  // The SPA emits raw (un-encoded) [] brackets in the query string and that is
  // the form it itself redirects to; building via URLSearchParams percent-encodes
  // the brackets, which the SPA also accepts, but raw matches the canonical form
  // observed in the live network log.
  return (
    `https://direct-book.com/properties/${slug}` +
    `?locale=en` +
    `&items[0][adults]=2&items[0][children]=0&items[0][infants]=0` +
    `&currency=${currency}` +
    `&checkInDate=${dates.checkIn}&checkOutDate=${dates.checkOut}`
  );
}

async function discoverSlug(page, homepage) {
  // Load homepage, find the Book link, extract the property slug.
  await page.goto(homepage, { waitUntil: 'domcontentloaded', timeout: 45000 });
  // Anchors whose href hits thebookingbutton.com / direct-book.com with a
  // /properties/<slug> segment anywhere in the path (Nantucket inserts a
  // partner-alias segment like /whale/ before /properties/).
  const href = await page.evaluate(() => {
    const a = [...document.querySelectorAll('a[href]')].find(a =>
      /(thebookingbutton|direct-book)\.com\/.*\/properties\//.test(a.href)
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
    // NOTE: use domcontentloaded, NOT networkidle — the Vue SPA keeps a long-lived
    // connection open so networkidle never fires within 60s.
    const url = deepLink(slug, dates, prop.currency);
    result.deepLink = url;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    result.steps.push('goto deep-link results');

    // Dismiss cookie banner. CRITICAL: a full-viewport .cookie-overlay div
    // intercepts ALL pointer events until the Accept button is PLAYWRIGHT-clicked
    // (a raw JS el.click() does NOT tear down the overlay — verified). The
    // banner mounts slightly after domcontentloaded, so wait for the button to
    // be visible first; retry up to 3x.
    const dismissCookies = async () => {
      for (let i = 0; i < 3; i++) {
        const btn = page.locator('button[data-sm-test="cookies-accept-all"]').first();
        try {
          await btn.waitFor({ state: 'visible', timeout: 8000 });
          await btn.click({ timeout: 8000 });
        } catch {
          continue;
        }
        // Confirm the overlay is actually gone before returning.
        const gone = await page.evaluate(() => {
          const o = document.querySelector('.cookie-overlay');
          if (!o) return true;
          const cs = getComputedStyle(o);
          return cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0';
        });
        if (gone) return true;
      }
      return false;
    };
    await dismissCookies();
    result.steps.push('dismiss cookie banner');

    // 4. Wait for at least one rate "Select" button.
    const selectBtn = page.locator('button[data-sm-test^="rate-select-"]').first();
    await selectBtn.waitFor({ state: 'visible', timeout: 30000 });
    const selectLabel = await selectBtn.getAttribute('data-sm-test');
    result.firstRateSelectAttr = selectLabel;
    result.steps.push('rate list rendered');

    // 5. Click "Select" on the first available rate (force-click fallback in
    //    case a lingering overlay still intercepts).
    await selectBtn.click().catch(async () => {
      await selectBtn.click({ force: true });
    });
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
    await bookBtn.click().catch(async () => {
      await bookBtn.click({ force: true });
    });
    await page.waitForURL(/\/book\?.*step=/, { timeout: 30000 });
    result.steps.push('click summary Book -> checkout /book step1');

    // The cookie banner can re-mount on the /book route (separate SPA view) —
    // dismiss again so it doesn't block the guest-details form clicks.
    await dismissCookies();

    // 7. Fill guest-details (Step 1) -> Continue.
    // The Vue SPA re-renders the route after the URL change; wait for the form
    // to be ready. The cookie overlay can RE-MOUNT on /book (flaky) — nuke any
    // lingering overlay via JS so it can't block the field clicks/fills, then
    // fill each field (force=true tolerates any residual cover).
    await page.locator('#firstName').waitFor({ state: 'attached', timeout: 30000 });
    await page.evaluate(() => {
      // Hard-remove the cookie overlay if it re-appeared on /book. (The accept
      // button's Vue handler already set the consent cookie on the results page,
      // so removing the overlay div here does not change consent state.)
      document.querySelectorAll('.cookie-overlay, .cookie-banner, [role="dialog"][aria-label="Cookie policy"]')
        .forEach(e => e.remove());
    });

    const fillField = async (sel, val) => {
      await page.locator(sel).first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
      await page.locator(sel).first().fill(val, { force: true }).catch(async () => {
        // Last-resort: set value via DOM + dispatch input event so Vue picks it up.
        await page.evaluate(({ sel, val }) => {
          const el = document.querySelector(sel);
          if (el) {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
            setter ? setter.call(el, val) : (el.value = val);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, { sel, val });
      });
    };
    await fillField('#firstName', 'Test');
    await fillField('#lastName', 'Booker');
    await fillField('#email', 'frictionstudy+test@example.com');
    await fillField('#confirmEmail', 'frictionstudy+test@example.com');
    await fillField('#phone', '2025551234');
    await fillField('#address1', '123 Test St');
    await fillField('#city', 'Washington');
    await fillField('#state', 'DC');
    await fillField('#postCode', '20002');
    // Helper: open a vue-select combobox by locator and click its nth option.
    const pickVselectOption = async (combobox, which = 'first', text = null) => {
      if ((await combobox.count()) === 0) return false;
      await combobox.first().click({ force: true }).catch(() => {});
      const menu = page.locator('.vs__dropdown-menu .vs__dropdown-option');
      let target;
      if (text) {
        target = page.locator('.vs__dropdown-menu .vs__dropdown-option', { hasText: text }).first();
      } else {
        target = menu.first();
      }
      try {
        await target.click({ timeout: 5000 });
      } catch {
        await target.click({ force: true });
      }
      return true;
    };

    // Country is a vue-select (v-select) combobox. The autocomplete attribute
    // ("country-name") is the stable cross-property hook (IDs are generated
    // per page-load).
    await pickVselectOption(page.locator('input[autocomplete="country-name"]'), 'first', 'United States');
    // Some properties add EXTRA required v-select dropdowns (Nantucket:
    // "How did you hear about us?" -> placeholder="Please select...", and
    // "Planned arrival time?" -> placeholder="Select time"). Pick the first
    // option of each — the value is irrelevant; we only need to satisfy
    // client-side validation to reach the payment page.
    for (const placeholder of ['Please select...', 'Select time']) {
      await pickVselectOption(page.locator(`input[placeholder="${placeholder}"]`));
    }
    result.steps.push('fill guest details');

    const continueBtn = page.locator('button[data-sm-test="guest-details-continue"]');
    await continueBtn.click({ timeout: 15000 }).catch(async () => {
      await continueBtn.click({ force: true });
    });
    result.steps.push('click guest-details Continue');

    // OPTIONAL Extras upsell step. Some properties (Nantucket) insert a
    // Step 2 "Extras" page between guest-details and payment. If a Skip or
    // extras-Continue button is present AND we are not yet on the payment
    // page, advance past it.
    {
      const extrasSkip = page.locator('button[data-sm-test="extras-skip-button-top"]');
      const extrasContinue = page.locator('button[data-sm-test="extras-continue"]');
      if ((await extrasSkip.count()) > 0) {
        await extrasSkip.first().click();
        result.steps.push('skip Extras upsell step (property-specific)');
      } else if ((await extrasContinue.count()) > 0) {
        await extrasContinue.first().click();
        result.steps.push('continue past Extras upsell step');
      }
    }

    // 8. Reach payment-gate: /book?...step=step3 with proceed-to-payment button.
    await page.waitForFunction(
      () => !!document.querySelector('button[data-sm-test="proceed-to-payment"]'),
      { timeout: 30000 }
    );
    const reachedUrl = page.url();
    const hasProceed = (await page.locator('button[data-sm-test="proceed-to-payment"]').count()) > 0;
    result.paymentReached = /\/book\?/.test(reachedUrl) && hasProceed;
    result.paymentPageUrl = reachedUrl;
    result.paymentIndicator =
      'URL contains /book?... AND button[data-sm-test="proceed-to-payment"] is in the DOM';
    result.steps.push('PAYMENT PAGE REACHED (proceed-to-payment present)');

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
