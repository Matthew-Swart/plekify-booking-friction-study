/**
 * Metric collector — Protocol v2 §8.1
 * Event-driven instrumentation of a Playwright flow. Handlers route their
 * clicks/navigations through these helpers so counts are accurate (not every
 * stray DOM click). Snapshot + LFI/FIDPM computed at the end.
 */
import { lfi, fidpmCompletionPct } from './formulas.js';

export class Metrics {
  constructor() {
    this.clicks = 0;
    this.handoffs = 0;
    this.fields = 0;
    this.latencySec = 0;
    this.interruptions = 0;
    this.autocomplete = false;
    this.accelerated = false;
    this.pageCount = 0;
    this._origins = [];
    this._firstOrigin = null;
    this._navMark = 0;
    this._seenPaths = new Set();
    this._interruptionFlags = new Set();
  }

  attach(page) {
    // Track top-frame navigations for handoffs + page count.
    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame()) return;
      const url = frame.url();
      if (!url || url === 'about:blank') return;
      let origin;
      try { origin = new URL(url).origin; } catch { return; }
      if (!this._firstOrigin) {
        this._firstOrigin = origin;
        this._origins.push(origin);
        return;
      }
      if (origin !== this._origins[this._origins.length - 1]) {
        this._origins.push(origin);
        this.handoffs++; // crossed to a new domain
      }
      try {
        const path = new URL(url).pathname;
        if (!this._seenPaths.has(path)) { this._seenPaths.add(path); this.pageCount++; }
      } catch { /* ignore */ }
    });
  }

  recordClick() { this.clicks++; }
  markInterruption(kind) { if (!this._interruptionFlags.has(kind)) { this._interruptionFlags.add(kind); this.interruptions++; } }

  // Handler wraps navigations: markNavStart() before, markNavEnd() after settle.
  markNavStart() { this._navMark = Date.now(); }
  markNavEnd() { if (this._navMark) { this.latencySec += (Date.now() - this._navMark) / 1000; this._navMark = 0; } }

  async detectFields(page) {
    // Count visible editable fields across the main frame AND all iframes
    // (Mews's guest form lives inside an iframe — main-frame-only misses it).
    try {
      let total = 0;
      for (const fr of page.frames()) {
        const n = await fr.evaluate(() => {
          const els = Array.from(document.querySelectorAll('input, select, textarea'));
          return els.filter((e) => {
            const t = (e.type || '').toLowerCase();
            if (['hidden', 'submit', 'button', 'image', 'reset'].includes(t)) return false;
            if (e.disabled || e.readOnly) return false;
            const r = e.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) return false;
            return true;
          }).length;
        }).catch(() => 0);
        total += n;
      }
      this.fields = Math.max(this.fields || 0, total); // track MAX seen (multi-step steppers advance past fields)
    } catch { this.fields = Math.max(this.fields || 0, 0); }
  }

  async detectAutocomplete(page) {
    try {
      this.autocomplete = await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll('input'));
        return els.some((e) => /address|street|postal|locality|country|email|tel/i.test(e.autocomplete || ''));
      });
    } catch { this.autocomplete = false; }
  }

  async detectAccelerated(page) {
    try {
      const lower = (await page.content()).toLowerCase();
      this.accelerated = /shop[-_ ]?pay|apple[-_ ]?pay|google[-_ ]?pay|googlepay|data-shopify-pay|shop-pay-button/.test(lower);
    } catch { this.accelerated = false; }
  }

  async detectInterruptions(page) {
    // VISIBLE challenge only — an invisible/score-based reCAPTCHA (e.g. SiteMinder's
    // size=invisible) never challenges the user, so it is NOT an interruption. Matches
    // the visible-only logic in handlers.detectCaptcha and the ARS CW probe.
    try {
      const det = await page.evaluate(() => {
        const ifr = Array.from(document.querySelectorAll('iframe'));
        const visCaptcha = ifr.some((f) => /recaptcha|hcaptcha|challenges\.cloudflare|turnstile/.test(f.src || '') && f.getBoundingClientRect().width > 60);
        // visible widgets only — exclude invisible/score-based reCAPTCHA (data-size=invisible)
        const widget = !!document.querySelector('.cf-turnstile, .h-captcha, .g-recaptcha:not([data-size="invisible"]):not([data-size="hide"])');
        const body = (document.body && document.body.innerText) || '';
        const text = /verify you are human|just a moment|checking your browser|are you a robot|access denied|sorry, you have been blocked/i.test(body);
        return visCaptcha || widget || text;
      });
      if (det) this.markInterruption('captcha');
    } catch { /* ignore */ }
  }

  snapshot() {
    const m = {
      clicks: this.clicks,
      handoffs: this.handoffs,
      fields: this.fields,
      latencySec: Number(this.latencySec.toFixed(2)),
      interruptions: this.interruptions,
      autocomplete: this.autocomplete,
      accelerated: this.accelerated,
      pageCount: this.pageCount,
      origins: this._origins,
    };
    m.lfi = Number(lfi(m).toFixed(2));
    m.completionPct = Number(fidpmCompletionPct(m).toFixed(1));
    return m;
  }
}
