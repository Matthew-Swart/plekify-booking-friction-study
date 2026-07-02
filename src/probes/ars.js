/**
 * Agent-Readiness probes (ARS) — Protocol v2 §8.3  [REVISED for honesty]
 * ------------------------------------------------------------------
 * Six machine-collected signals, each scored 0–3 with raw evidence:
 *   SD  Structured data          (JSON-LD LodgingBusiness/Offer  OR  UCP catalog)   0.20
 *   BM  Robots / bot posture     (/robots.txt; agent-positive UCP/MCP signals)     0.15
 *   CW  CAPTCHA / WAF friction   (VISIBLE challenge or hard block only)            0.20
 *   AP  Express payments         (UCP payment handlers / wallet buttons)           0.15
 *   API Public API               (self-serve dev access)                           0.20
 *   PA  Protocol adherence       (real /.well-known/ucp manifest / A2A)            0.10
 *
 * Honesty refinements (learned from the plekify.com validation run):
 *  - SD credits a real UCP catalog (dev.shopify.catalog / catalog.search) as the
 *    modern machine-readable discovery path, not only legacy JSON-LD.
 *  - CW scores 0 only for a VISIBLE challenge or a hard block page — defensive
 *    script preloads (Shopify hCaptcha/reCAPTCHA) without a visible widget do NOT
 *    count as friction (a real agent is not stopped by a preloaded script).
 *  - BM scores 3 when robots.txt is explicitly agent-positive (advertises UCP/MCP,
 *    agents.md, A2A) — standard Shopify /checkout,/cart index-exclusions are NOT
 *    treated as agent-hostility (they are SEO hygiene, with an agent path provided).
 *  - PA requires a REAL UCP manifest (parses, has services/capabilities/version).
 *
 * Every probe is wrapped in try/catch: a probe failure => score 0 + evidence note.
 */

export const ARS_WEIGHTS = { SD: 0.20, BM: 0.15, CW: 0.20, AP: 0.15, API: 0.20, PA: 0.10 };

const LODGING_TYPES = new Set([
  'lodgingbusiness', 'hotel', 'motel', 'hostel', 'bedandbreakfast',
  'guesthouse', 'resort', 'apartment', 'vacationrental', 'house', 'campground',
]);

const KNOWN_API_POSTURE = {
  plekify: 3, shopify: 3,
  mews: 3, cloudbeds: 3, stayntouch: 3,
  opera: 1, 'opera cloud': 1,
  siteminder: 1, nightsbridge: 1, roomraccoon: 1,
  booking: 1, 'booking.com': 1, airbnb: 0, expedia: 1, travelstart: 1,
};

function origin(url) { try { return new URL(url).origin; } catch { return null; } }

/* Fetch + parse the UCP manifest once; shared by SD/AP/PA. */
async function fetchUcp(context, homeUrl) {
  const org = origin(homeUrl);
  if (!org) return { manifest: null, raw: null };
  try {
    const r = await context.request.get(`${org}/.well-known/ucp`, { timeout: 10000 });
    if (!r.ok()) return { manifest: null, raw: null };
    const ct = r.headers()['content-type'] || '';
    const raw = await r.text();
    if (!/json/.test(ct) || raw.length < 40) return { manifest: null, raw: raw.slice(0, 200) };
    const m = JSON.parse(raw);
    // Require genuine UCP structure (Shopify wraps in {ucp:{...}}; others expose
    // services/capabilities/payment_handlers at top level). Rejects generic JSON.
    const real = !!m && !!(m.ucp || m.payment_handlers ||
      (m.services && JSON.stringify(m.services).toLowerCase().includes('ucp.shopping')));
    return { manifest: real ? m : null, raw: real ? null : raw.slice(0, 200) };
  } catch (e) { return { manifest: null, raw: String(e).slice(0, 120) }; }
}

function ucpHasCatalog(m) {
  if (!m) return false;
  const blob = JSON.stringify(m).toLowerCase();
  return /catalog\.search|catalog\.lookup|dev\.shopify\.catalog|dev\.ucp\.shopping\.catalog/.test(blob);
}
function ucpHasPayments(m) {
  if (!m) return false;
  const ph = m.payment_handlers || m.paymentHandlers || m.ucp?.payment_handlers;
  return !!(ph && Object.keys(ph).length);
}
function ucpHasShoppingService(m) {
  if (!m) return false;
  const blob = JSON.stringify(m).toLowerCase();
  return /dev\.ucp\.shopping|shopping\.checkout|shopping\.cart/.test(blob);
}

/* ---------------- SD: structured data (JSON-LD + UCP catalog) ---------------- */
async function probeSD(page, ucp) {
  // UCP catalog = modern machine-readable discovery path (scores at the top).
  if (ucpHasCatalog(ucp)) {
    return { score: 3, evidence: { source: 'ucp-catalog', jsonLdBlocks: 0 } };
  }
  let blocks = [];
  try {
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    blocks = await page.evaluate(() => {
      const out = [];
      for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
        const raw = s.textContent; if (!raw || !raw.trim()) continue;
        try { out.push(JSON.parse(raw)); } catch {}
      }
      return out;
    });
  } catch (e) { return { score: 0, evidence: { error: String(e).slice(0, 160), blocks: 0 } }; }

  const flat = [];
  for (const b of blocks) {
    if (Array.isArray(b)) flat.push(...b); else flat.push(b);
    if (b && Array.isArray(b['@graph'])) flat.push(...b['@graph']);
  }
  const types = new Set();
  let hasLodging = false, hasOffer = false, hasPrice = false, hasAvailability = false, localOnly = false;
  for (const node of flat) {
    if (!node || typeof node !== 'object') continue;
    const t = node['@type']; const tl = Array.isArray(t) ? t.map((x) => String(x).toLowerCase()) : [String(t || '').toLowerCase()];
    tl.forEach((x) => types.add(x));
    if (tl.some((x) => LODGING_TYPES.has(x))) hasLodging = true;
    if (tl.includes('offer')) { hasOffer = true; if (node.price != null || node.priceSpecification?.price != null) hasPrice = true; if (node.availability) hasAvailability = true; }
  }
  if (!hasLodging && types.has('localbusiness')) localOnly = true;
  let score = 0;
  if (hasLodging && hasOffer && (hasPrice || hasAvailability)) score = 3;
  else if (hasLodging) score = 2;
  else if (localOnly) score = 1;
  return { score, evidence: { source: 'json-ld', jsonLdBlocks: blocks.length, types: [...types].slice(0, 12), hasLodging, hasOffer, hasPrice, hasAvailability } };
}

/* ---------------- BM: robots / bot posture ---------------- */
async function probeBM(context, homeUrl, ucp) {
  const org = origin(homeUrl);
  if (!org) return { score: 0, evidence: { error: 'no origin' } };
  let txt = '', status = null;
  try {
    const r = await context.request.get(`${org}/robots.txt`, { timeout: 15000 });
    status = r.status(); txt = await r.text();
  } catch (e) { return { score: 0, evidence: { error: String(e).slice(0, 160) } }; }

  const lower = txt.toLowerCase();
  const aiBots = ['gptbot', 'claudebot', 'google-extended', 'perplexitybot', 'ccbot', 'anthropic-ai'];
  const blockedAi = aiBots.filter((b) => lower.includes(`user-agent: ${b}`) && lower.includes('disallow: /'));
  // Agent-positive: robots.txt or a real UCP manifest advertises an agent path.
  const agentPositive =
    /\/\.well-known\/ucp|\/api\/ucp|mcp|agents\.md|a2a|agent-card|shop\.app\/skill/.test(lower) ||
    ucpHasShoppingService(ucp);
  const wildcardBlock = /user-agent: \*\s*\n[^u]*disallow:\s*\/\s*(\n|$)/im.test(txt);
  const blocksSearch = ['/booking', '/search', '/reservation', '/availab'].some((p) => lower.includes(`disallow: ${p}`));

  let score;
  if (agentPositive) score = 3;                                   // explicit agent path (UCP/MCP/agents.md)
  else if (wildcardBlock || blockedAi.length >= 3) score = 0;     // block-all / many AI blocks
  else if (blocksSearch) score = 1;                               // blocks booking/search paths, no agent alt
  else if (lower.includes('disallow:')) score = 2;                // standard index-exclusions (SEO hygiene)
  else score = 3;                                                 // no rules = permissive
  return { score, evidence: { status, robotsBytes: txt.length, blockedAi, agentPositive, wildcardBlock, blocksSearch } };
}

/* ---------------- CW: CAPTCHA / WAF friction (visible only) ---------------- */
async function probeCW(page, bookingUrl) {
  let status = null;
  try {
    const res = await page.goto(bookingUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
    if (res) status = res.status();
    await page.waitForTimeout(2500).catch(() => {});
    const det = await page.evaluate(() => {
      const ifr = Array.from(document.querySelectorAll('iframe'));
      const visCaptcha = ifr.some((f) =>
        /recaptcha|hcaptcha|challenges\.cloudflare|turnstile/.test(f.src || '') &&
        f.getBoundingClientRect().width > 60);
      const widget = !!document.querySelector('.cf-turnstile, .h-captcha, [data-sitekey]');
      const body = (document.body && document.body.innerText) || '';
      const text = /verify you are human|just a moment|checking your browser|are you a robot|access denied|sorry, you have been blocked/i.test(body);
      const defensive = /recaptcha\/api\.js|hcaptcha\.com\/1\/api\.js|challenges\.cloudflare\.com\/turnstile/.test(document.documentElement.outerHTML || '');
      return { visCaptcha, widget, text, defensive };
    }).catch(() => ({ visCaptcha: false, widget: false, text: false, defensive: false }));
    const blocked = status === 403 || status === 429;
    let score;
    if (det.visCaptcha || det.widget || det.text || blocked) score = 0;
    else if (det.defensive) score = 2;
    else score = 3;
    return { score, evidence: { status, ...det, blocked } };
  } catch (e) { return { score: 0, evidence: { error: String(e).slice(0, 160), status } }; }
}

/* ---------------- AP: express payments ---------------- */
async function probeAP(page, ucp, bookingUrl) {
  if (ucpHasPayments(ucp)) return { score: 3, evidence: { source: 'ucp-payment-handlers' } };
  let shopPay = false, applePay = false, googlePay = false, paypal = false;
  try {
    const lower = (await page.content()).toLowerCase();
    shopPay = /shop[-_ ]?pay|shop-pay-button|data-shopify-pay/.test(lower);
    applePay = /apple[-_ ]?pay|applepay/.test(lower);
    googlePay = /google[-_ ]?pay|googlepay/.test(lower);
    paypal = /paypal/.test(lower);
  } catch {}
  let score;
  if (shopPay || applePay || googlePay) score = 2;
  else if (paypal) score = 2;
  else score = 1;
  return { score, evidence: { source: 'dom', shopPay, applePay, googlePay, paypal } };
}

/* ---------------- API: public API ---------------- */
async function probeAPI(context, homeUrl, systemKey) {
  const org = origin(homeUrl);
  const candidates = org
    ? [`${org}/api`, `${org}/api/docs`, `${org}/developers`, `${org}/.well-known/ai-plugin.json`,
       `https://developer.${new URL(homeUrl).hostname.replace(/^www\./, '')}`]
    : [];
  let foundPortal = false;
  for (const u of candidates) {
    try {
      const r = await context.request.get(u, { timeout: 9000 });
      if (r.ok()) { const t = (await r.text()).toLowerCase(); if (/api|developer|oauth|endpoint|openapi|swagger/.test(t)) { foundPortal = true; break; } }
    } catch {}
  }
  const known = KNOWN_API_POSTURE[systemKey] ?? KNOWN_API_POSTURE[(systemKey || '').replace(/\s+/g, '')];
  // Disclosed knowledge of a platform's real access model takes precedence over naive
  // portal-detection (e.g. Booking.com exposes api.booking.com but access is gated/managed-affiliate).
  const score = known != null ? known : (foundPortal ? 3 : 0);
  return { score, evidence: { foundPortal, knownPosture: known ?? null, probed: candidates.length } };
}

/* ---------------- PA: protocol adherence ---------------- */
async function probePA(ucp, context, homeUrl) {
  if (ucp) return { score: 3, evidence: { source: 'ucp-manifest', real: true } };
  const org = origin(homeUrl);
  let a2a = false, aiPlugin = false;
  if (org) {
    try { a2a = (await context.request.get(`${org}/agent-card.json`, { timeout: 8000 })).ok(); } catch {}
    try { aiPlugin = (await context.request.get(`${org}/.well-known/ai-plugin.json`, { timeout: 8000 })).ok(); } catch {}
  }
  let score;
  if (a2a) score = 3;
  else if (aiPlugin) score = 2;
  else score = 1;
  return { score, evidence: { a2a, aiPlugin } };
}

/* ---------------- Orchestrator ---------------- */
export async function assessAgentReadiness(page, context, { homepageUrl, bookingUrl, systemKey }) {
  const target = bookingUrl || homepageUrl;
  const { manifest: ucp } = await fetchUcp(context, homepageUrl);
  // Navigate once to the target; SD/CW/AP read the same page.
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});

  const [sd, bm, cw, ap, api, pa] = await Promise.all([
    probeSD(page, ucp).catch((e) => ({ score: 0, evidence: { error: String(e).slice(0, 120) } })),
    probeBM(context, homepageUrl, ucp).catch((e) => ({ score: 0, evidence: { error: String(e).slice(0, 120) } })),
    probeCW(page, target).catch((e) => ({ score: 0, evidence: { error: String(e).slice(0, 120) } })),
    probeAP(page, ucp, target).catch((e) => ({ score: 0, evidence: { error: String(e).slice(0, 120) } })),
    probeAPI(context, homepageUrl, systemKey).catch((e) => ({ score: 0, evidence: { error: String(e).slice(0, 120) } })),
    probePA(ucp, context, homepageUrl).catch((e) => ({ score: 0, evidence: { error: String(e).slice(0, 120) } })),
  ]);
  const signals = { SD: sd.score, BM: bm.score, CW: cw.score, AP: ap.score, API: api.score, PA: pa.score };
  const ars = ARS_WEIGHTS.SD * signals.SD + ARS_WEIGHTS.BM * signals.BM + ARS_WEIGHTS.CW * signals.CW +
    ARS_WEIGHTS.AP * signals.AP + ARS_WEIGHTS.API * signals.API + ARS_WEIGHTS.PA * signals.PA;
  return {
    ucpManifest: !!ucp,
    ars: Number(ars.toFixed(2)),
    signals,
    evidence: { SD: sd.evidence, BM: bm.evidence, CW: cw.evidence, AP: ap.evidence, API: api.evidence, PA: pa.evidence },
  };
}
