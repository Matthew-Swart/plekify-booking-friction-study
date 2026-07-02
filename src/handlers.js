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

  /**
   * Start on the property's own domain so a redirect to a third-party booking
   * engine is counted as a domain handoff (the key trust-friction signal, ×6.6).
   * Tries a Book link first (real click + nav); falls back to the booking URL. */
  async openFromHomepage(prop) {
    const home = prop.homepageUrl;
    const book = prop.bookingUrl || prop.homepageUrl;
    let homeOrigin = home, bookOrigin = book;
    try { homeOrigin = new URL(home).origin; } catch { /* keep */ }
    try { bookOrigin = new URL(book).origin; } catch { /* keep */ }
    if (home && homeOrigin !== bookOrigin) {
      // Off-domain booking engine: start on the property domain, then navigate to
      // the engine. The domain handoff (×6.6) is the key trust-friction signal and
      // is real for every off-domain PMS booking engine. No fragile link-hunting.
      await this.timedGoto(home);
      await sleep(1200);
      this.m.recordClick(); // the guest's "Book" click that sends them off-domain
      await this.timedGoto(book);
      return;
    }
    await this.timedGoto(book); // on-domain (e.g. Plekify) — no handoff
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

/* ---------------- NightsBridge (Angular SPA; URL invariant — DOM payment detection) ----------------
 * Flow proven by exploration subagent on book.nightsbridge.com/{19876,30738,12292}:
 *   VIEW CALENDAR -> 2-month daterangepicker -> pick dates (scoped by month table, 2-space header)
 *   -> CHECK AVAILABILITY -> VIEW RATES AND BOOK -> BOOK NOW -> payment panel (URL never changes). */
const MONTHS_L = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export class NightsBridgeHandler extends BaseHandler {
  async studyB(prop) {
    const ctx = { paymentReached: false, redirected: false, captcha: false, botWall: false, mandatoryAccountWall: false, error: null };
    const dates = rollingStudyBDates();
    const cin = new Date(dates.checkin), cout = new Date(dates.checkout);
    const ciMonthLabel = `${MONTHS_L[cin.getMonth()]}  ${cin.getFullYear()}`; // NB renders header with TWO spaces
    const ciDay = String(cin.getDate()), coDay = String(cout.getDate());
    try {
      await this.openFromHomepage(prop); // start on property domain -> count the handoff to book.nightsbridge.com
      await sleep(2500);
      if (await this.detectCaptcha()) { ctx.captcha = true; return ctx; }
      // VIEW CALENDAR
      if (await this.clickEl('button.avl-cl-btn')) this.m.recordClick();
      await sleep(1000);
      // navigate months forward until the check-in month table is visible
      for (let i = 0; i < 14; i++) {
        const vis = await this.page.evaluate((lbl) =>
          [...document.querySelectorAll('table.calendar-table th.month, table.table-condensed th.month')]
            .map((e) => e.innerText.trim()).includes(lbl), ciMonthLabel).catch(() => false);
        if (vis) break;
        const clicked = await this.page.evaluate(() => {
          let t = document.querySelector('th.next.available') || document.querySelector('th.next');
          if (!t) {
            const ts = [...document.querySelectorAll('table.calendar-table, table.table-condensed')];
            if (ts.length) {
              const es = [...ts[ts.length - 1].querySelectorAll('thead th')]
                .filter((th) => !/month/.test(th.className || '') && (th.innerText || '').trim() === '');
              if (es.length) t = es[es.length - 1];
            }
          }
          if (t) { t.click(); return true; } return false;
        }).catch(() => false);
        if (!clicked) break;
        await sleep(350);
      }
      if (await this._nbClickDay(ciDay, ciMonthLabel)) this.m.recordClick();
      await sleep(500);
      if (await this._nbClickDay(coDay, ciMonthLabel)) this.m.recordClick();
      await sleep(700);
      if (await this.clickEl('button.check-avl-btn')) this.m.recordClick(); // CHECK AVAILABILITY
      await sleep(3500);
      // expand rates if BOOK NOW not yet visible
      const bookVisible = await this.page.locator('button.btn-book-now, button:has-text("BOOK NOW")').first().isVisible().catch(() => false);
      if (!bookVisible) {
        if (await this.clickEl('button.btn-show-rates, button:has-text("VIEW RATES AND BOOK")')) this.m.recordClick();
        await sleep(1500);
      }
      const book = this.page.locator('button.btn-book-now, button:has-text("BOOK NOW")').first();
      if (await book.isVisible().catch(() => false)) { await book.click({ timeout: 5000 }).catch(() => {}); this.m.recordClick(); }
      await sleep(3500);
      // DOM-based payment detection (URL never changes)
      const det = await this.page.evaluate(() => {
        const t = document.body.innerText; const has = (r) => r.test(t);
        return {
          pm: has(/Payment Method/i), cb: has(/CONFIRM BOOKING/i),
          card: !!document.querySelector('input[name*="card" i], input[autocomplete="cc-number"]'),
          iframe: !!document.querySelector('iframe[name*="pay" i], iframe[src*="pay" i], iframe[src*="bridgepay" i], iframe[src*="peach" i]'),
        };
      }).catch(() => ({}));
      ctx.paymentReached = !!((det.pm && det.cb) || det.card || det.iframe);
      ctx.redirected = this.m.handoffs > 0;
    } catch (e) { ctx.error = String(e).slice(0, 160); }
    return ctx;
  }

  async _nbClickDay(day, monthLabel) {
    return await this.page.evaluate(({ day, monthLabel }) => {
      const ts = [...document.querySelectorAll('table.calendar-table, table.table-condensed')];
      const tg = ts.find((t) => t.querySelector('th.month')?.innerText?.trim() === monthLabel);
      if (!tg) return false;
      const c = [...tg.querySelectorAll('td:not(.week)')]
        .filter((x) => x.innerText.trim() === String(day) && !/off|disabled/i.test(x.className || ''))[0];
      if (!c) return false;
      c.click(); return true;
    }, { day, monthLabel }).catch(() => false);
  }

  async studyA(prop) {
    const ctx = { paymentReached: false, redirected: false, captcha: false, botWall: false, mandatoryAccountWall: false, error: null };
    try {
      await this.timedGoto(prop.bookingUrl || prop.homepageUrl, 'networkidle');
      await sleep(2500);
      if (await this.detectCaptcha()) ctx.captcha = true;
      if (await this.clickEl('button.avl-cl-btn')) this.m.recordClick();
      await sleep(900);
      ctx.paymentReached = await this.page.locator('table.calendar-table, table.table-condensed').first().isVisible().catch(() => false);
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
  nightsbridge: NightsBridgeHandler,
  generic: GenericHandler,
  siteminder: GenericHandler, cloudbeds: GenericHandler, roomraccoon: GenericHandler,
  mews: GenericHandler, stayntouch: GenericHandler, opera: GenericHandler,
  booking: GenericHandler, airbnb: GenericHandler, expedia: GenericHandler, travelstart: GenericHandler,
};
