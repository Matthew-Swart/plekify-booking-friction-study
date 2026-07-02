/**
 * Flow handlers — Protocol v2 §3–§7
 *   BaseHandler : shared helpers (timed nav, button-by-text, captcha/payment detect)
 *   PlekifyHandler : Shopify on-domain flow (the protagonist baseline)
 *   GenericHandler : best-effort competitor flow (OTAs/PMS — many will agent-block, by design)
 *
 * Handlers return an outcome ctx {paymentReached, redirected, captcha, botWall,
 * mandatoryAccountWall, error}; outcome.js maps it to the taxonomy. Metrics are
 * collected along the way via the Metrics helper.
 */
import { sleep, rollingStudyBDates } from './util.js';

const PAYMENT_URL = /(\/checkouts?\/)|(\/checkout)|(payment)|(\/book\/.*pay)|(\/reservation.*pay)|(\/pay($|\/))/i;

export class BaseHandler {
  constructor(page, metrics) { this.page = page; this.m = metrics; }

  async timedGoto(url, waitUntil = 'domcontentloaded') {
    this.m.markNavStart();
    try { await this.page.goto(url, { waitUntil, timeout: 30000 }); }
    finally { this.m.markNavEnd(); }
  }

  async findAndClick(texts, { role = null } = {}) {
    for (const t of texts) {
      const candidates = role
        ? await this.page.getByRole(role, { name: t }).all().catch(() => [])
        : [];
      let els = candidates;
      if (!els.length) {
        els = await this.page.getByText(t, { exact: false }).all().catch(() => []);
      }
      if (!els.length) {
        els = await this.page.getByRole('link', { name: t }).all().catch(() => []);
      }
      for (const el of els) {
        if (await el.isVisible().catch(() => false)) {
          try { await el.click({ timeout: 4000 }); this.m.recordClick(); return true; } catch { /* next */ }
        }
      }
    }
    return false;
  }

  /** Click a CSS selector if visible; returns success. */
  async clickEl(selector, { timeout = 6000 } = {}) {
    try {
      const el = this.page.locator(selector).first();
      await el.waitFor({ state: 'visible', timeout });
      await el.click({ timeout });
      return true;
    } catch { return false; }
  }

  /** Pick a calendar date by data-date, navigating months forward if needed. */
  async pickDate(dateStr) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const cell = this.page.locator(`[data-date="${dateStr}"]`);
      const visible = await cell.first().isVisible().catch(() => false);
      if (visible) { try { await cell.first().click({ timeout: 4000 }); return true; } catch { return false; } }
      // advance to next month
      const next = await this.findAndClick(['Next', '›', '→', 'Next month'], { role: 'button' });
      if (!next) {
        // try a chevron by aria
        await this.page.locator('[aria-label*="ext"], .calendar-next, .next-month').first().click({ timeout: 3000 }).catch(() => {});
      }
      await sleep(400);
    }
    return false;
  }

  async detectCaptcha() {
    // VISIBLE challenge only — defensive script preloads (Shopify hCaptcha/reCAPTCHA)
    // without a visible widget do NOT block an agent (Protocol §8.3 CW refinement).
    try {
      const det = await this.page.evaluate(() => {
        const ifr = Array.from(document.querySelectorAll('iframe'));
        const visCaptcha = ifr.some((f) => /recaptcha|hcaptcha|challenges\.cloudflare|turnstile/.test(f.src || '') && f.getBoundingClientRect().width > 60);
        const widget = !!document.querySelector('.cf-turnstile, .h-captcha, [data-sitekey]');
        const body = (document.body && document.body.innerText) || '';
        const text = /verify you are human|just a moment|checking your browser|are you a robot|access denied|sorry, you have been blocked/i.test(body);
        return visCaptcha || widget || text;
      });
      return !!det;
    } catch { return false; }
  }

  isPaymentUrl(url = this.page.url()) { return PAYMENT_URL.test(url); }

  async waitForPayment(timeout = 20000) {
    try {
      await this.page.waitForURL(PAYMENT_URL, { timeout, waitUntil: 'domcontentloaded' });
      this.m.markNavEnd();
      return true;
    } catch { return false; }
  }
}

/* ---------------- Plekify (Shopify, on-domain) ----------------
 * Proven flow (validated 2026-07-02 on plekify.com/products/simbavati-hilltop-lodge):
 *   product page → .checkin-input (opens calendar) → [data-date=checkin] →
 *   [data-date=checkout] → .search-button (See Live Rates) → .accommodation-btn-buy
 *   (Book Now) → Shopify /checkouts/ payment page. Zero domain handoffs. */
export class PlekifyHandler extends BaseHandler {
  async studyB(prop) {
    const ctx = { paymentReached: false, redirected: false, captcha: false, botWall: false, mandatoryAccountWall: false, error: null };
    const dates = rollingStudyBDates();
    try {
      await this.timedGoto(prop.bookingUrl || prop.homepageUrl);
      await sleep(1500);
      if (await this.detectCaptcha()) { ctx.captcha = true; return ctx; }
      // 1. open the calendar
      if (await this.clickEl('.checkin-input')) this.m.recordClick();
      await sleep(900);
      // 2. check-in date
      if (await this.pickDate(dates.checkin)) this.m.recordClick();
      await sleep(500);
      // 3. check-out date
      if (await this.pickDate(dates.checkout)) this.m.recordClick();
      await sleep(600);
      // 4. See Live Rates
      if (await this.clickEl('.search-button')) this.m.recordClick();
      await sleep(4000); // live rates load
      // 5. Book Now (first available room)
      const book = this.page.locator('.accommodation-btn-buy').first();
      if (await book.isVisible().catch(() => false)) {
        await book.click({ timeout: 10000 }).catch(() => {});
        this.m.recordClick();
      }
      if (await this.waitForPayment(15000)) ctx.paymentReached = true;
    } catch (e) { ctx.error = String(e).slice(0, 160); }
    return ctx;
  }

  async studyA(prop) {
    const ctx = { paymentReached: false, redirected: false, captcha: false, botWall: false, mandatoryAccountWall: false, error: null };
    try {
      await this.timedGoto(prop.bookingUrl || prop.homepageUrl);
      await sleep(1500);
      if (await this.detectCaptcha()) ctx.captcha = true;
      if (await this.clickEl('.checkin-input')) this.m.recordClick();
      await sleep(700);
      ctx.paymentReached = await this.page.locator('.calendar-day, [data-date]').first().isVisible().catch(() => false);
    } catch (e) { ctx.error = String(e).slice(0, 160); }
    return ctx;
  }
}

/* ---------------- Generic competitor (best-effort) ---------------- */
export class GenericHandler extends BaseHandler {
  async studyB(prop) {
    const ctx = { paymentReached: false, redirected: false, captcha: false, botWall: false, mandatoryAccountWall: false, error: null };
    try {
      await this.timedGoto(prop.bookingUrl || prop.homepageUrl);
      await sleep(2000); // SPA render grace
      if (await this.detectCaptcha()) { ctx.captcha = true; return ctx; }
      // mandatory account / ID wall (Airbnb-style)
      const lower = (await this.page.content().catch(() => '')).toLowerCase();
      if (/sign in to continue|log in to book|verify your identity|upload.*id|government.*id|create.*account.*book/.test(lower)) {
        ctx.mandatoryAccountWall = true; return ctx;
      }
      // best-effort: open booking, search, select, pay
      await this.findAndClick(['Book Now', 'Book', 'Check Availability', 'Reserve', 'Search']);
      await sleep(2500);
      if (await this.detectCaptcha()) { ctx.captcha = true; return ctx; }
      await this.findAndClick(['Select', 'Book Now', 'Reserve', 'Continue', 'Pay']);
      await sleep(2000);
      if (await this.waitForPayment(12000)) {
        ctx.paymentReached = true;
        ctx.redirected = this.m.handoffs > 0; // payment on a third-party domain
      }
    } catch (e) { ctx.error = String(e).slice(0, 160); }
    return ctx;
  }

  async studyA(prop) {
    const ctx = { paymentReached: false, redirected: false, captcha: false, botWall: false, mandatoryAccountWall: false, error: null };
    try {
      await this.timedGoto(prop.homepageUrl);
      await sleep(2000);
      if (await this.detectCaptcha()) ctx.captcha = true;
      await this.findAndClick(['Check Availability', 'Book Now', 'Search', 'Book']);
      await sleep(2500);
      ctx.paymentReached = /availab|rate|room|result|no availab|sold out/i.test(await this.page.content().catch(() => ''));
    } catch (e) { ctx.error = String(e).slice(0, 160); }
    return ctx;
  }
}

export const REGISTRY = {
  plekify: PlekifyHandler,
  shopify: PlekifyHandler,
  generic: GenericHandler,
  siteminder: GenericHandler, cloudbeds: GenericHandler, nightsbridge: GenericHandler, roomraccoon: GenericHandler,
  mews: GenericHandler, stayntouch: GenericHandler, opera: GenericHandler,
  booking: GenericHandler, airbnb: GenericHandler, expedia: GenericHandler, travelstart: GenericHandler,
};
