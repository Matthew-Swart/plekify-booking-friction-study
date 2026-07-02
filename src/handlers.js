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

/* ---------------- SiteMinder (direct-book.com SPA; date-prefilled deep-link) ----------------
 * Flow proven by src/probes/siteminder-flow.js (reaches payment on all 3 properties):
 *   deep-link -> dismiss cookie overlay (REAL playwright click, retry 3x, verify gone;
 *                overlay can RE-MOUNT on /book route) -> wait for rate list -> Select first
 *   rate -> wait summary Book ENABLED -> click -> /book step1 -> dismiss cookies again +
 *   nuke overlay divs -> fill guest fields (force fill + Vue input event) -> country v-select
 *   (+ extra required v-selects: Nantucket) -> Continue -> [Extras skip] -> proceed-to-payment.
 * Critical gotchas: .cookie-overlay intercepts ALL clicks until a REAL Playwright click on
 * cookies-accept-all (JS click is a no-op); use domcontentloaded NOT networkidle (long-lived
 * SPA connection); fill fields with force + dispatch 'input' for Vue reactivity. */
const SYNTH = { firstName: 'Test', lastName: 'Booker', email: 'frictionstudy.test@example.com', confirmEmail: 'frictionstudy.test@example.com', phone: '5551234567', address1: '1 Test St', city: 'Testville', state: 'NY', postCode: '20002' };

export class SiteMinderHandler extends BaseHandler {
  smDeepLink(slug, checkin, checkout) {
    // Raw brackets (NOT percent-encoded) — direct-book.com canonical form. The SPA
    // itself emits raw [] in its redirect; URLSearchParams percent-encodes them which
    // the SPA also accepts, but raw matches the canonical network-log form.
    return `https://direct-book.com/properties/${slug}?locale=en&items[0][adults]=2&items[0][children]=0&items[0][infants]=0&currency=USD&checkInDate=${checkin}&checkOutDate=${checkout}`;
  }

  /** Dismiss the cookie overlay. CRITICAL: a full-viewport .cookie-overlay div intercepts
   * ALL pointer events until the Accept button is PLAYWRIGHT-clicked (a raw JS el.click()
   * is a no-op — verified). The banner mounts slightly after domcontentloaded, so wait for
   * the button to be visible; retry up to 3x; confirm the overlay is actually gone. */
  async _smDismissCookies() {
    for (let i = 0; i < 3; i++) {
      const btn = this.page.locator('button[data-sm-test="cookies-accept-all"]').first();
      try {
        await btn.waitFor({ state: 'visible', timeout: 8000 });
        await btn.click({ timeout: 8000 });
      } catch { continue; }
      const gone = await this.page.evaluate(() => {
        const o = document.querySelector('.cookie-overlay');
        if (!o) return true;
        const cs = getComputedStyle(o);
        return cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0';
      }).catch(() => true);
      if (gone) return true;
    }
    return false;
  }

  /** Hard-remove any lingering cookie overlay/banner divs (the consent cookie is already
   * set after _smDismissCookies, so removing the div does not change consent state). */
  async _smNukeOverlays() {
    await this.page.evaluate(() => {
      document.querySelectorAll('.cookie-overlay, .cookie-banner, [role="dialog"][aria-label="Cookie policy"]')
        .forEach((e) => e.remove());
    }).catch(() => {});
  }

  /** Force-fill a field, falling back to a native setter + 'input'/'change' events so the
   * Vue SPA's reactivity picks the value up. */
  async _smFillField(sel, val) {
    const f = this.page.locator(sel).first();
    await f.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    await f.fill(val, { force: true }).catch(async () => {
      await this.page.evaluate(({ sel, val }) => {
        const el = document.querySelector(sel);
        if (!el) return;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        setter ? setter.call(el, val) : (el.value = val);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, { sel, val });
    });
  }

  /** Open a vue-select combobox (by its input selector) and click an option. If `text` is
   * provided, click the option whose text matches; else click the first option. */
  async _smPickVSelect(inputSel, text = null) {
    const inp = this.page.locator(inputSel).first();
    if ((await inp.count()) === 0) return false;
    await inp.click({ force: true }).catch(() => {});
    const menu = this.page.locator('.vs__dropdown-menu .vs__dropdown-option');
    const target = text
      ? this.page.locator('.vs__dropdown-menu .vs__dropdown-option', { hasText: text }).first()
      : menu.first();
    try { await target.click({ timeout: 5000 }); }
    catch { await target.click({ force: true }).catch(() => {}); }
    return true;
  }

  async studyB(prop) {
    const ctx = { paymentReached: false, redirected: false, captcha: false, botWall: false, mandatoryAccountWall: false, error: null };
    const dates = rollingStudyBDates();
    if (!prop.smSlug) { ctx.error = 'no smSlug'; return ctx; }
    try {
      // 1. Start on the property domain so the redirect to direct-book.com is counted as
      //    a domain handoff (the key trust-friction signal, ×6.6). The guest's "Book" click
      //    sends them off-domain.
      await this.timedGoto(prop.homepageUrl);
      await sleep(1200);
      this.m.recordClick(); // the guest's Book click -> off-domain booking engine

      // 2. Deep-link to the date-prefilled results (bypasses the calendar). Use
      //    domcontentloaded — NOT networkidle (the Vue SPA keeps a long-lived connection).
      await this.timedGoto(this.smDeepLink(prop.smSlug, dates.checkin, dates.checkout), 'domcontentloaded');
      await sleep(2500);
      await this._smDismissCookies();

      // 3. Wait for the rate list to render, then Select the first rate.
      const rateBtn = this.page.locator('button[data-sm-test^="rate-select-"]').first();
      await rateBtn.waitFor({ state: 'visible', timeout: 30000 });
      await rateBtn.click().catch(async () => { await rateBtn.click({ force: true }); });
      this.m.recordClick();
      await sleep(900);

      // 4. Summary "Book" — wait for it to be visible AND enabled, then click -> /book step1.
      const bookBtn = this.page.locator('button[data-sm-test="summary-cart-book"]');
      await bookBtn.waitFor({ state: 'visible' });
      await this.page.waitForFunction(
        () => { const b = document.querySelector('button[data-sm-test="summary-cart-book"]'); return b && !b.disabled; },
        { timeout: 15000 }
      );
      await bookBtn.click().catch(async () => { await bookBtn.click({ force: true }); });
      this.m.recordClick();
      await this.page.waitForURL(/\/book\?.*step=/, { timeout: 30000 });

      // The cookie banner can RE-MOUNT on the /book route — dismiss again, and hard-remove
      // any lingering overlay div so it can't block the guest-details form clicks/fills.
      await this._smDismissCookies();
      await this._smNukeOverlays();

      // 5. Wait for the guest-details form, then fill every required field. The cookie
      //    overlay can re-appear flakily; nuke it once more before filling.
      await this.page.locator('#firstName').waitFor({ state: 'attached', timeout: 30000 });
      await this._smNukeOverlays();
      const fills = [
        ['#firstName', SYNTH.firstName],
        ['#lastName', SYNTH.lastName],
        ['#email', SYNTH.email],
        ['#confirmEmail', SYNTH.confirmEmail],
        ['#phone', SYNTH.phone],
        ['#address1', SYNTH.address1],
        ['#city', SYNTH.city],
        ['#state', SYNTH.state],
        ['#postCode', SYNTH.postCode],
      ];
      for (const [sel, val] of fills) await this._smFillField(sel, val);

      // Country is a vue-select; the autocomplete="country-name" attr is the stable hook.
      await this._smPickVSelect('input[autocomplete="country-name"]', 'United States');
      // Some properties add EXTRA required v-selects (Nantucket: "How did you hear about
      // us?" / "Planned arrival time?"). Pick the first option of each to satisfy validation.
      for (const placeholder of ['Please select...', 'Select time']) {
        await this._smPickVSelect(`input[placeholder="${placeholder}"]`);
      }
      await sleep(500);

      // 6. Continue -> step3 (T&Cs + final proceed-to-payment).
      const continueBtn = this.page.locator('button[data-sm-test="guest-details-continue"]');
      await continueBtn.click({ timeout: 15000 }).catch(async () => { await continueBtn.click({ force: true }); });
      this.m.recordClick();
      await sleep(2000);

      // 7. OPTIONAL Extras upsell step (some properties insert it between guest-details
      //    and payment). If present, skip/continue past it.
      const extrasSkip = this.page.locator('button[data-sm-test="extras-skip-button-top"]');
      const extrasContinue = this.page.locator('button[data-sm-test="extras-continue"]');
      if ((await extrasSkip.count()) > 0) { await extrasSkip.first().click(); this.m.recordClick(); await sleep(1500); }
      else if ((await extrasContinue.count()) > 0) { await extrasContinue.first().click(); this.m.recordClick(); await sleep(1500); }

      // 8. Payment indicator: proceed-to-payment button present in the DOM on the /book route.
      await this.page.waitForFunction(
        () => !!document.querySelector('button[data-sm-test="proceed-to-payment"]'),
        { timeout: 30000 }
      );
      const onBookRoute = /\/book\?/.test(this.page.url());
      ctx.paymentReached = onBookRoute;
      ctx.redirected = this.m.handoffs > 0;
    } catch (e) { ctx.error = String(e).slice(0, 160); }
    return ctx;
  }
  async studyA(prop) { return GenericHandler.prototype.studyA.call(this, prop); }
}

/* ---------------- Cloudbeds (hotels.cloudbeds.com Chakra; deep-link; add-to-cart agent-block) ----------------
 * Deep-link works (dates -> room results). Add-to-cart ("Add" button) is agent-blocked
 * under headless (isTrusted guard); headed may differ. Classify the outcome honestly. */
export class CloudbedsHandler extends BaseHandler {
  async studyB(prop) {
    const ctx = { paymentReached: false, redirected: false, captcha: false, botWall: false, mandatoryAccountWall: false, error: null };
    const dates = rollingStudyBDates();
    const id = prop.cbId;
    if (!id) { ctx.error = 'no cbId'; return ctx; }
    const deep = `https://hotels.cloudbeds.com/reservation/${id}?checkin=${dates.checkin}&checkout=${dates.checkout}&adults=2`;
    try {
      await this.timedGoto(prop.homepageUrl);
      await sleep(1000);
      this.m.recordClick();
      await this.timedGoto(deep, 'domcontentloaded'); // off-domain handoff counted
      await sleep(3000);
      if (await this.detectCaptcha()) { ctx.captcha = true; return ctx; }
      // wait for room results / Add buttons
      await this.page.locator('button.cb-select-button, .cb-accommodation-card').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
      // attempt Add (agent may be blocked)
      const add = this.page.locator('button.cb-select-button').first();
      if (await add.isVisible({ timeout: 3000 }).catch(() => false)) {
        await add.click({ timeout: 5000 }).catch(() => {});
        this.m.recordClick();
        await sleep(2500);
      }
      // payment indicators (URL /payment or /confirm, stripe iframe, card field) OR still on results = blocked
      const det = await this.page.evaluate(() => ({
        payUrl: /\/payment|\/confirm/i.test(location.href),
        card: !!document.querySelector('input[autocomplete="cc-number"]'),
        iframe: !!document.querySelector('iframe[src*="stripe.com"], iframe[src*="cloudbeds"]'),
        cartEmpty: /No Accommodations Added|no accommodations/i.test(document.body.innerText || ''),
      })).catch(() => ({}));
      ctx.paymentReached = !!(det.payUrl || det.card || det.iframe);
      ctx.redirected = this.m.handoffs > 0;
      if (!ctx.paymentReached) ctx.botWall = true; // add-to-cart did not advance -> agent-block
    } catch (e) { ctx.error = String(e).slice(0, 160); }
    return ctx;
  }
  async studyA(prop) { return GenericHandler.prototype.studyA.call(this, prop); }
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
  siteminder: SiteMinderHandler,
  cloudbeds: CloudbedsHandler,
  generic: GenericHandler,
  roomraccoon: GenericHandler,
  mews: GenericHandler, stayntouch: GenericHandler, opera: GenericHandler,
  booking: GenericHandler, airbnb: GenericHandler, expedia: GenericHandler, travelstart: GenericHandler,
};
