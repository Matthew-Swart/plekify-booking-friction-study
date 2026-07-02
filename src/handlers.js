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
        const widget = !!document.querySelector('.cf-turnstile, .h-captcha, .g-recaptcha:not([data-size="invisible"]):not([data-size="hide"])');
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
/* ---------------- Mews Distributor (React SPA inside a same-origin iframe) ----------------
 * Flow proven by tmp/mews-flow-spec.mjs (reaches the Details/payment step on all 3
 * verified properties — MUSA, Elmhirst's, Sun & Ski). The whole booking app lives
 * inside a named iframe: iframe[name^="mews-distributor"]. The URL never changes
 * between steps (https://app.mews.com/distributor/{uuid}), so payment is detected
 * DOM-side via the Datatrans Secure-Fields iframes + input#expiration.
 *
 *   openFromHomepage (counts the off-domain handoff) -> goto distributor ->
 *   cookie dismiss (TOP page) -> "Select dates" -> navigate months ->
 *   pick check-in -> pick check-out -> adults=2 -> Escape + Next -> "Show rates" ->
 *   "Book now" -> "Continue" -> Details = PAYMENT page (STOP).
 *
 * Critical gotchas (see MEWS-FLOW-SPEC.json):
 *   - waitUntil=domcontentloaded (NOT networkidle — Mews holds a websocket open).
 *   - Day cells: <button aria-label="16 August 2026, Sunday">. Playwright's CSS
 *     selector engine intermittently fails on [aria-label^="..."] here, so dates
 *     are picked via frame.evaluate(() => querySelectorAll + click).
 *   - The calendar portal overlay (MonthElement in #portal-container) intercepts
 *     Playwright pointer-clicks on the dates "Next" button — press Escape first
 *     and use frame.evaluate(() => btn.click()).
 *   - EXACT-text match for forward CTAs ('Next' substring-matches carousel
 *     'Next image' buttons and misfires).
 *   - Stop at payment. NEVER click 'Confirm' (it attempts the charge). */
const MEWS_MONTHS_L = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export class MewsHandler extends BaseHandler {
  /** The distributor iframe as a Playwright Frame (for frame.evaluate). */
  _dframe() {
    return this.page.frames().find((f) => f.name().startsWith('mews-distributor')) || null;
  }
  /** The distributor iframe as a FrameLocator (for locator clicks). */
  _fl() {
    return this.page.frameLocator('iframe[name^="mews-distributor"]');
  }

  /** Advance the two-month calendar view until the target month (by index 0-11)
   * appears among the visible day buttons' parsed dates. Locale-agnostic: day
   * aria-labels localize ("16 August 2026" / "16 août 2026"), so we parse the
   * month NAME via the EN/FR/DE/ES map. Stops once any visible day is in the
   * target month + year (or near it). */
  async _mewsNavToMonth(monthNameOrIdx, year = null) {
    const dframe = this._dframe();
    if (!dframe) return false;
    const MONTHS = { january:0,janvier:0,enero:0, february:1,fevrier:1,febrero:1, march:2,mars:2,marzo:2,'märz':2, april:3,avril:3,abril:3, may:4,mai:4,mayo:4, june:5,juin:5,junio:5, july:6,juillet:6,juil:6,julio:6, august:7,aout:7,'août':7,agosto:7, september:8,sept:8,sep:8,septiembre:8,setiembre:8, october:9,octobre:9,octubre:9, november:10,novembre:10,noviembre:10, december:11,decembre:11,diciembre:11 };
    const norm = (s) => (s || '').toLowerCase().replace(/[éèê]/g, 'e');
    const target = typeof monthNameOrIdx === 'number' ? monthNameOrIdx : (MONTHS[norm(monthNameOrIdx)] ?? MONTHS[String(monthNameOrIdx).toLowerCase()]);
    if (target == null) return false;
    for (let i = 0; i < 5; i++) { // cap at 5 months — T+45 is <=2 months out; never scroll into the future
      const hit = await dframe.evaluate(({ target, year, MONTHS, norm }) => {
        const days = [...document.querySelectorAll('button[aria-label]')]
          .map((b) => b.getAttribute('aria-label') || '')
          .filter((s) => /^\d{1,2} \w+ \d{4}/.test(s));
        return days.some((label) => {
          const m = label.match(/^(\d{1,2}) (\w+) (\d{4})/);
          if (!m) return false;
          const mon = MONTHS[norm(m[2])] ?? MONTHS[m[2].toLowerCase()];
          if (mon == null) return false;
          if (year != null && parseInt(m[3], 10) !== year) return false;
          return mon === target;
        });
      }, { target, year, MONTHS, norm }).catch(() => false);
      if (hit) return true;
      await dframe.evaluate(() => {
        const b = [...document.querySelectorAll('button[aria-label]')]
          .find((x) => /next month/i.test(x.getAttribute('aria-label') || ''));
        if (b) b.click();
      }).catch(() => {});
      await sleep(450);
    }
    return false;
  }

  /** Pick an enabled day by prefix match on aria-label (e.g. "16 August 2026").
   * Returns the matched aria-label (so the caller can recompute checkout), or null. */
  async _mewsPickDay(d) {
    const dframe = this._dframe();
    if (!dframe) return null;
    const prefix = `${d.getDate()} ${MEWS_MONTHS_L[d.getMonth()]} ${d.getFullYear()}`;
    return await dframe.evaluate((prefix) => {
      const btns = [...document.querySelectorAll('button[aria-label]')].filter((b) => {
        if (b.getAttribute('aria-disabled') === 'true') return false;
        if ((b.getAttribute('data-test-date') || '').startsWith('disabled')) return false;
        return (b.getAttribute('aria-label') || '').startsWith(prefix);
      });
      if (btns.length) { btns[0].click(); return btns[0].getAttribute('aria-label'); }
      return null;
    }, prefix).catch(() => null);
  }

  /** Scan the currently-visible two-month calendar for an enabled START+END pair
   * with the given night count (default 2). Returns {startLabel, endLabel} of the
   * FIRST such pair, or null. Day aria-labels localize ("16 August 2026, Sunday" /
   * "16 août 2026, dimanche" / "16. August 2026, Sonntag") AND data-test-date
   * localizes too ("8/16/2026" EN vs "16/08/2026" FR) — so we parse the date from
   * the aria-abel's month NAME (mapped across EN/FR/DE/ES), which is unambiguous.
   * This is far more robust than targeting a fixed rolling date — Mews availability
   * varies per property and per date, and many target days are disabled. */
  /** Scan the currently-visible two-month calendar for ALL enabled START days that
   * have an enabled END exactly `nights` later. Returns the list of {startLabel,
   * endLabel} pairs (earliest first). Day aria-labels localize ("16 August 2026" /
   * "16 août 2026") AND data-test-date localizes too, so we parse the date from the
   * aria-label's month NAME (mapped across EN/FR/DE/ES), which is unambiguous.
   * Returning MULTIPLE candidates matters: Mews dynamically re-disables the chosen
   * end day once a start is selected (min-nights / per-start availability rules),
   * so a pair that looks valid pre-select can become invalid — having alternatives
   * lets the caller try the next start if the chosen one's end becomes disabled. */
  async _mewsFindEnabledPairs(nights = 2) {
    const dframe = this._dframe();
    if (!dframe) return [];
    return await dframe.evaluate((nights) => {
      const MONTHS = { january:0,janvier:0,Januar:0,enero:0, february:1,'février':1,fevrier:1,fev:1,februar:1,Februar:1,febrero:1, march:2,mars:2,mar:2,'märz':2,marzo:2, april:3,avril:3,avr:3,April:3,abril:3, may:4,mai:4,Mai:4,mayo:4, june:5,juin:5,Juni:5,junio:5, july:6,juillet:6,juil:6,Juli:6,julio:6, august:7,'août':7,aout:7,August:7,agosto:7, september:8,sept:8,sep:8,September:8,septiembre:8,setiembre:8, october:9,octobre:9,oct:9,Oktober:9,octubre:9, november:10,novembre:10,nov:10,November:10,noviembre:10, december:11,decembre:11,dec:11,Dezember:11,diciembre:11 };
      const norm = (s) => (s || '').toLowerCase().replace(/[éèê]/g, 'e');
      const btns = [...document.querySelectorAll('button[aria-label]')]
        .filter((b) => /^\d{1,2} \w+ \d{4}/.test(b.getAttribute('aria-label') || ''));
      const parsed = btns.map((b) => {
        const label = b.getAttribute('aria-label') || '';
        const m = label.match(/^(\d{1,2}) (\w+) (\d{4})/);
        let t = null;
        if (m) {
          const day = parseInt(m[1], 10);
          const mon = MONTHS[m[2]] ?? MONTHS[norm(m[2])];
          if (mon != null) t = new Date(parseInt(m[3], 10), mon, day).getTime();
        }
        const td = b.getAttribute('data-test-date') || '';
        const enabled = b.getAttribute('aria-disabled') !== 'true' && !td.startsWith('disabled');
        return { label, enabled, t };
      }).filter((p) => p.t != null);
      const en = parsed.filter((p) => p.enabled).sort((a, b) => a.t - b.t);
      const pairs = [];
      for (let i = 0; i < en.length; i++) {
        const target = en[i].t + nights * 86400000;
        const match = en.find((p) => p.t === target);
        if (match) pairs.push({ startLabel: en[i].label, endLabel: match.label });
      }
      return pairs;
    }, nights).catch(() => []);
  }

  /** Click the day button whose aria-label starts with the leading "{D} {Month}
   * {YYYY}" portion of a full label (handles the ", SelectedAsStartDate" suffix).
   * Uses a REAL Playwright pointer click via the frame locator (not a synthetic
   * element.click()) — the synthetic click intermittently fails to register the
   * end-date selection in Mews's React app on some properties (verified: Elmhirst's
   * + Calabogie). Falls back to evaluate-driven click if the locator can't find it. */
  async _mewsClickDayByLabel(label) {
    const prefix = label.split(',').slice(0, 1)[0].trim(); // "15 August 2026"
    // Primary: real Playwright click on the aria-label selector.
    try {
      const el = this._fl().locator(`button[aria-label^="${prefix}"]`).first();
      await el.waitFor({ state: 'visible', timeout: 4000 });
      await el.click({ timeout: 4000 });
      return true;
    } catch { /* fall through to evaluate-driven click */ }
    // Fallback: synthetic click via frame.evaluate.
    const dframe = this._dframe();
    if (!dframe) return false;
    return await dframe.evaluate((prefix) => {
      const b = [...document.querySelectorAll('button[aria-label]')]
        .find((x) => (x.getAttribute('aria-label') || '').startsWith(prefix));
      if (b) { b.click(); return true; }
      return false;
    }, prefix).catch(() => false);
  }

  /** Find an ENABLED day button whose parsed date matches the given Date, click it
   * (real Playwright click on the located element via its real aria-label), and
   * return the element's real (localized) aria-label. Locale-agnostic — matches on
   * the parsed {day, month, year} from the aria-label, not the label text. Returns
   * null if no enabled matching day is visible. */
  async _mewsClickDayByDate(d) {
    const dframe = this._dframe();
    if (!dframe) return null;
    const target = { day: d.getDate(), month: d.getMonth(), year: d.getFullYear() };
    // Find the real label of the matching enabled button.
    const realLabel = await dframe.evaluate((target) => {
      const MONTHS = { january:0,janvier:0,enero:0, february:1,fevrier:1,febrero:1, march:2,mars:2,marzo:2,'märz':2, april:3,avril:3,abril:3, may:4,mai:4,mayo:4, june:5,juin:5,junio:5, july:6,juillet:6,juil:6,julio:6, august:7,aout:7,'août':7,agosto:7, september:8,sept:8,sep:8,septiembre:8,setiembre:8, october:9,octobre:9,octubre:9, november:10,novembre:10,noviembre:10, december:11,decembre:11,diciembre:11 };
      const norm = (s) => (s || '').toLowerCase().replace(/[éèê]/g, 'e');
      const b = [...document.querySelectorAll('button[aria-label]')].find((x) => {
        const label = x.getAttribute('aria-label') || '';
        const m = label.match(/^(\d{1,2}) (\w+) (\d{4})/);
        if (!m) return false;
        if (parseInt(m[1], 10) !== target.day || parseInt(m[3], 10) !== target.year) return false;
        const mon = MONTHS[norm(m[2])] ?? MONTHS[m[2].toLowerCase()];
        if (mon == null || mon !== target.month) return false;
        if (x.getAttribute('aria-disabled') === 'true') return false;
        if ((x.getAttribute('data-test-date') || '').startsWith('disabled')) return false;
        return true;
      });
      return b ? b.getAttribute('aria-label') : null;
    }, target).catch(() => null);
    if (!realLabel) return null;
    // Real Playwright click on the found element's aria-label prefix.
    const ok = await this._mewsClickDayByLabel(realLabel);
    return ok ? realLabel : null;
  }

  /** After a start date is selected, find the first ENABLED day that is >= `nights`
   * nights after the start's date. Re-scans the current (post-selection) calendar
   * state — Mews dynamically disables some end days based on the chosen start
   * (min-nights / per-start availability). Returns the end day's aria-label, or
   * null. Parses the start date from its localized aria-label ("7 July 2026, ..."). */
  async _mewsPickEnabledEndAfter(startLabel, nights) {
    const dframe = this._dframe();
    if (!dframe) return null;
    return await dframe.evaluate(({ startLabel, nights }) => {
      const MONTHS = { january:0,janvier:0,Januar:0,enero:0, february:1,fevrier:1,fev:1,Februar:1,febrero:1, march:2,mars:2,mar:2,'märz':2,marzo:2, april:3,avril:3,avr:3,April:3,abril:3, may:4,mai:4,Mai:4,mayo:4, june:5,juin:5,Juni:5,junio:5, july:6,juillet:6,juil:6,Juli:6,julio:6, august:7,aout:7,'août':7,August:7,agosto:7, september:8,sept:8,sep:8,September:8,septiembre:8,setiembre:8, october:9,octobre:9,oct:9,Oktober:9,octubre:9, november:10,novembre:10,nov:10,November:10,noviembre:10, december:11,decembre:11,dec:11,Dezember:11,diciembre:11 };
      const parseLabel = (label) => {
        const m = (label || '').match(/^(\d{1,2}) (\w+) (\d{4})/);
        if (!m) return null;
        const key = m[2].toLowerCase().replace(/[éèê]/g, 'e');
        const mon = MONTHS[key] ?? MONTHS[m[2]] ?? MONTHS[m[2].toLowerCase()];
        if (mon == null) return null;
        return new Date(parseInt(m[3], 10), mon, parseInt(m[1], 10)).getTime();
      };
      const startT = parseLabel(startLabel);
      if (startT == null) return null;
      const minEnd = startT + nights * 86400000;
      const cand = [...document.querySelectorAll('button[aria-label]')]
        .map((b) => ({ label: b.getAttribute('aria-label'), t: parseLabel(b.getAttribute('aria-label')), btn: b }))
        .filter((p) => p.t != null && p.t >= minEnd)
        .filter((p) => p.btn.getAttribute('aria-disabled') !== 'true' && !((p.btn.getAttribute('data-test-date') || '').startsWith('disabled')))
        .sort((a, b) => a.t - b.t);
      return cand.length ? cand[0].label : null;
    }, { startLabel, nights }).catch(() => null);
  }

  /** Click the first enabled button whose trimmed innerText exactly matches one of
   * the given texts (case-insensitive). Retries up to ~7s. Exact match avoids the
   * 'Next' substring-matches-'Next image' carousel trap. Accepts an array so we can
   * pass language variants — Mews honours the property's configured locale (FR/DE/
   * EN) regardless of the browser locale, so a French property shows "Réserver"
   * rather than "Book now". */
  async _mewsClickExact(texts) {
    const dframe = this._dframe();
    if (!dframe) return false;
    const arr = Array.isArray(texts) ? texts.map((t) => t.toLowerCase()) : [String(texts).toLowerCase()];
    for (let a = 0; a < 10; a++) {
      const ok = await dframe.evaluate((ts) => {
        const b = [...document.querySelectorAll('button')]
          .find((x) => ts.includes(x.innerText.trim().toLowerCase()));
        if (b && !b.disabled && b.getAttribute('aria-disabled') !== 'true') { b.click(); return true; }
        return false;
      }, arr).catch(() => false);
      if (ok) return true;
      await sleep(700);
    }
    return false;
  }

  async studyB(prop) {
    const ctx = { paymentReached: false, redirected: false, captcha: false, botWall: false, mandatoryAccountWall: false, error: null };
    const dates = rollingStudyBDates();
    const cin = new Date(dates.checkin);
    const cout = new Date(dates.checkout);
    try {
      // 1. Start on the property's own domain so the redirect to app.mews.com is
      //    counted as a domain handoff (the key trust-friction signal, x6.6).
      //    openFromHomepage handles the timedGoto(home) + recordClick + timedGoto(book).
      await this.openFromHomepage(prop);
      // Wait for the distributor iframe + a visible button (render grace). Use
      // domcontentloaded-equivalent waits (NOT networkidle — websocket stays open).
      await this.page.waitForSelector('iframe[name^="mews-distributor"]', { timeout: 30000 });
      await this._fl().locator('button').first().waitFor({ state: 'visible', timeout: 25000 }).catch(() => {});
      await sleep(2000);
      if (await this.detectCaptcha()) { ctx.captcha = true; return ctx; }

      // 2. Cookie banner lives in the TOP page, not the iframe.
      if (await this.clickEl('[data-testid="actionButton-accept"]')) this.m.recordClick();
      await sleep(500);

      // 3. Open the date picker. The button text is locale-dependent
      //    ("Select dates" / "Sélectionner des dates" / "Daten auswählen").
      //    Use a CSS-locator OR with multiple text variants for robustness.
      const openedDates = await this._fl().locator('button')
        .filter({ hasText: /^(Select dates|Sélectionner des dates|Daten auswählen|Seleccionar fechas)$/i })
        .first().click({ timeout: 8000 }).then(() => true).catch(async () => {
          // Fallback: frame.evaluate click on the first button matching any variant.
          const dframe = this._dframe();
          if (!dframe) return false;
          return await dframe.evaluate(() => {
            const want = ['select dates', 'sélectionner des dates', 'daten auswählen', 'seleccionar fechas'];
            const b = [...document.querySelectorAll('button')]
              .find((x) => want.includes(x.innerText.trim().toLowerCase()));
            if (b) { b.click(); return true; }
            return false;
          }).catch(() => false);
        });
      if (openedDates) this.m.recordClick();
      await sleep(1200);

      // 4. Pick dates. Mews availability varies per property and per date, AND
      //    selecting a start DYNAMICALLY re-disables some end days (per-start
      //    min-nights rules). Near-term dates (the Study-B rolling T+45 window) are
      //    heavily restricted at some properties (Elmhirst's, Calabogie), while
      //    further-out dates (T+60..T+90) reliably allow 2-night stays. Strategy:
      //    for a sequence of candidate start dates from T+45 outward to T+90,
      //    navigate to the start's month, click the start, then re-scan the
      //    POST-SELECTION calendar for the first enabled end >=2 nights later and
      //    click it. Stop at the first complete range. Re-open the picker between
      //    failed candidates to reset the (stuck) start selection.
      const dframe = this._dframe();
      let sLabel = null, eLabel = null;
      const reopenPicker = async () => {
        if (dframe) {
          // Toggle off any selected start (plain Escape does NOT clear it).
          await dframe.evaluate(() => {
            const sel = [...document.querySelectorAll('button[aria-label]')]
              .find((b) => /SelectedAsStartDate/.test(b.getAttribute('aria-label') || ''));
            if (sel) sel.click();
          }).catch(() => {});
          await sleep(500);
        }
        await this.page.keyboard.press('Escape').catch(() => {});
        await sleep(400);
        await this._fl().locator('button')
          .filter({ hasText: /^(Select dates|Sélectionner des dates|Daten auswählen|Seleccionar fechas)$/i })
          .first().click({ timeout: 6000 }).catch(async () => {
            await dframe?.evaluate(() => {
              const want = ['select dates', 'sélectionner des dates', 'daten auswählen', 'seleccionar fechas'];
              const b = [...document.querySelectorAll('button')].find((x) => want.includes(x.innerText.trim().toLowerCase()));
              if (b) b.click();
            }).catch(() => {});
          });
        await sleep(900);
      };

      // Candidate starts: rolling T+45 first (the Study-B target), then T+46..T+52,
      // then a jump to T+60..T+75 (further-out dates bypass near-term restrictions).
      const offsets = [45, 46, 47, 48, 49, 50, 52, 54, 60, 62, 64, 66, 68, 70, 72, 75, 80, 85, 90];
      let attempts = 0;
      for (const off of offsets) {
        if (sLabel && eLabel) break;
        if (attempts++ > 10) break; // cap churn
        const start = new Date(cin.getTime() - 45 * 86400000 + off * 86400000); // off days from today
        if (attempts > 1) await reopenPicker();
        // Navigate to the start's month (locale-agnostic, by month index + year).
        await this._mewsNavToMonth(start.getMonth(), start.getFullYear());
        // Click the start day by its PARSED date (locale-agnostic — day aria-labels
        // localize, so we match on the parsed {day, month, year} not the label text).
        // Returns the real (localized) label for downstream use, or null.
        const startLabel = await this._mewsClickDayByDate(start);
        if (!startLabel) continue;
        this.m.recordClick();
        await sleep(1100);
        // Re-scan the POST-SELECTION calendar for the first enabled end >=2 nights
        // after the start (handles dynamic min-nights disabling of candidate ends).
        const endLabel = await this._mewsPickEnabledEndAfter(startLabel, 2);
        if (!endLabel) continue;
        // Click the end WITHOUT navigating away (navigating to the end's month
        // resets the start selection). The end is almost always in the SAME
        // two-month view as the start; if not, this candidate fails and we try the
        // next start offset.
        const endClicked = await this._mewsClickDayByLabel(endLabel);
        if (!endClicked) continue;
        this.m.recordClick();
        sLabel = startLabel; eLabel = endLabel;
        await sleep(700);
      }

      // Verify the range actually took (both SelectedAsStart/End present).
      if (sLabel && eLabel && dframe) {
        const ok = await dframe.evaluate(() => {
          const s = [...document.querySelectorAll('button[aria-label]')].some((b) => /SelectedAsStartDate/.test(b.getAttribute('aria-label') || ''));
          const e = [...document.querySelectorAll('button[aria-label]')].some((b) => /SelectedAsEndDate/.test(b.getAttribute('aria-label') || ''));
          return s && e;
        }).catch(() => false);
        if (!ok) { sLabel = null; eLabel = null; }
      }
      if (!sLabel || !eLabel) { ctx.error = 'no available date pair'; return ctx; }

      // 5. Set adults = 2 (read the actual count, adjust up or down).
      if (dframe) {
        let adults = await dframe.evaluate(() => {
          const lbls = [...document.querySelectorAll('*')].filter((e) => /^Adults?$/.test((e.innerText || '').trim()));
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
          await dframe.evaluate((up) => {
            const b = [...document.querySelectorAll(`button[aria-label="${up ? 'Increment' : 'Decrement'}"]`)][0];
            if (b) b.click();
          }, adults < 2).catch(() => {});
          adults += adults < 2 ? 1 : -1;
          await sleep(300);
        }
      }

      // 6. Dismiss the calendar portal overlay (it intercepts pointer-clicks on the
      //    dates "Next" button), then advance Dates -> Categories via element.click().
      await this.page.keyboard.press('Escape');
      await sleep(400);
      if (dframe) {
        const advanced = await dframe.evaluate(() => {
          const b = document.querySelector('button[data-test-id="dates-next-button"], button[aria-label="Next"]');
          if (b) { b.click(); return true; }
          return false;
        }).catch(() => false);
        if (advanced) this.m.recordClick();
      }
      await sleep(3500);

      // 7. Forward CTAs. The post-dates sequence varies by property:
      //    - Dates -> Categories ("Show rates") -> Rates ("Book now") -> Summary ("Continue") -> Details
      //    - Dates -> combined rates view ("Book now") -> Summary ("Continue") -> Details
      //    Adaptive: try Show rates (if present) then Book now then Continue. Each
      //    uses exact-text matching against EN/FR/DE/ES variants to avoid the
      //    carousel "Next image" trap and survive the property's configured locale.
      if (await this._mewsClickExact(['Show rates', 'Afficher les tarifs', 'Tarife anzeigen', 'Mostrar tarifas'])) this.m.recordClick();
      await sleep(2500);
      if (await this._mewsClickExact(['Book now', 'Réserver', 'Jetzt buchen', 'Reservar'])) this.m.recordClick();
      await sleep(3000);
      if (await this._mewsClickExact(['Continue', 'Continuer', 'Weiter', 'Continuar'])) this.m.recordClick();
      await sleep(3000);

      // ---- Details step = PAYMENT page. DOM-based detection (URL never changes). ----
      const pay = dframe
        ? await dframe.evaluate(() => {
            const headings = [...document.querySelectorAll('h1,h2,h3,h4')].map((h) => (h.innerText || '').trim());
            return {
              hasPaymentHeading: headings.some((h) => /payment/i.test(h)),
              cardNumberIframe: !!document.querySelector('iframe[name*="securefields"][name*="cardNumber"]'),
              cvvIframe: !!document.querySelector('iframe[name*="securefields"][name*="cvv"]'),
              holderName: !!document.querySelector('input#holderName'),
              expiration: !!document.querySelector('input#expiration'),
              confirmBtn: !![...document.querySelectorAll('button')].some((b) => /^confirm$/i.test(b.innerText.trim())),
            };
          }).catch(() => null)
        : null;

      ctx.paymentReached = !!(pay && (pay.cardNumberIframe || (pay.hasPaymentHeading && pay.holderName) || (pay.expiration && pay.holderName)));
      ctx.redirected = this.m.handoffs > 0; // app.mews.com is off-domain from the hotel site
    } catch (e) { ctx.error = String(e).slice(0, 160); }
    return ctx;
  }

  async studyA(prop) {
    const ctx = { paymentReached: false, redirected: false, captcha: false, botWall: false, mandatoryAccountWall: false, error: null };
    try {
      await this.openFromHomepage(prop);
      await this.page.waitForSelector('iframe[name^="mews-distributor"]', { timeout: 30000 });
      await this._fl().locator('button').first().waitFor({ state: 'visible', timeout: 25000 }).catch(() => {});
      await sleep(1500);
      if (await this.detectCaptcha()) ctx.captcha = true;
      // Study A = availability surface visible: the date picker / "Select dates" button.
      const openedDates = await this._fl().locator('button').filter({ hasText: 'Select dates' }).first()
        .click({ timeout: 8000 }).then(() => true).catch(() => false);
      if (openedDates) this.m.recordClick();
      await sleep(900);
      ctx.paymentReached = await this._dframe()?.evaluate(() =>
        !!document.querySelector('button[aria-label^=""][data-test-date]:not([aria-disabled="true"])')
      ).catch(() => false) || false;
    } catch (e) { ctx.error = String(e).slice(0, 160); }
    return ctx;
  }
}

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
  mews: MewsHandler,
  generic: GenericHandler,
  roomraccoon: GenericHandler,
  stayntouch: GenericHandler, opera: GenericHandler,
  booking: GenericHandler, airbnb: GenericHandler, expedia: GenericHandler, travelstart: GenericHandler,
};
