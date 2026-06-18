# PMS Booking Friction Study — Full Methodology

## Overview

This study measures the real-world friction guests experience when attempting to book a room through property websites powered by different Property Management Systems (PMS).

**Study conducted:** June 2026  
**Total automation runs:** 276  
**Properties tested:** 23 across 5 PMS platforms  
**Automation environment:** Hetzner Cloud (AMD Ryzen 7 3700X, 64GB RAM, Debian 12)  
**Browser automation:** Playwright 1.60.0 + Chromium (headless)

---

## Test Protocol

### Two-Study Design

**Study A — "Can I find a room?" (Availability Search)**
- Starting from the property homepage, an automated browser attempts up to 10 random date combinations within a 90-day window
- Dates are spaced 3 days apart to maximize chance of finding availability
- Measures: clicks required, pages loaded, domain handoffs, failed attempts
- Goal: simulate a guest with flexible dates hunting for availability

**Study B — "Can I complete the booking?" (Fixed-Date Checkout)**
- With known dates (15–17 September 2026, 2 adults), the bot attempts the full checkout flow through to the payment page
- Measures: clicks to checkout, form fields, domain handoffs, accelerated checkout options
- Goal: simulate a guest who knows their dates and wants to book

### Viewports Tested
- **Desktop:** 1920×1080
- **Mobile:** 375×667

### Runs per Cell
- 3 independent runs per property × study × viewport combination
- Total: 276 automated runs (23 properties × 2 studies × 2 viewports × 3 runs)
- Sequential execution with 2-second pause between runs to avoid overwhelming servers

---

## Friction Score Formula

```
F = (C × 1.0) + (H × 5.0) + (Fld × 0.5) + (P × 0.5) + (I × 3.0) − (A × 0.5) − (Acc × 3.0)
```

| Variable | Description | Weight | Rationale |
|----------|-------------|--------|-----------|
| **C** | Total clicks required | 1.0 | Every click is cognitive load |
| **H** | Domain handoffs | 5.0 | Highest weight — trust erosion when leaving property domain |
| **Fld** | Form fields to complete | 0.5 | Each field adds friction |
| **P** | Pages loaded | 0.5 | Page loads = wait time |
| **I** | Interruptions (popups, cookie banners, CAPTCHA) | 3.0 | High weight — breaks flow |
| **A** | Autofill support | −0.5 | Reduces friction |
| **Acc** | Accelerated checkout (Apple Pay, Google Pay) | −3.0 | Highest reducer — near-instant payment |

**Lower score = less friction.**

### Example Calculation: Plekify Hemingways (Study B, Desktop)
- Clicks: 4 → 4 × 1.0 = 4.0
- Handoffs: 0 → 0 × 5.0 = 0.0
- Form fields: 8 → 8 × 0.5 = 4.0
- Pages: 1 → 1 × 0.5 = 0.5
- Interruptions: 0 → 0 × 3.0 = 0.0
- Autofill: 0 → 0 × (−0.5) = 0.0
- Accelerated checkout: No → 0 × (−3.0) = 0.0
- **Total: 4.0 + 0.0 + 4.0 + 0.5 + 0.0 − 0.0 − 0.0 = 8.5**

### Example Calculation: NightsBridge Atlantic View (Study B, Desktop)
- Clicks: 13 → 13 × 1.0 = 13.0
- Handoffs: 1 → 1 × 5.0 = 5.0
- Form fields: 0 → 0 × 0.5 = 0.0
- Pages: 3 → 3 × 0.5 = 1.5
- Interruptions: 0 → 0 × 3.0 = 0.0
- Autofill: 0 → 0 × (−0.5) = 0.0
- Accelerated checkout: No → 0 × (−3.0) = 0.0
- **Total: 13.0 + 5.0 + 0.0 + 1.5 + 0.0 − 0.0 − 0.0 = 19.5**

---

## Property Selection & Pre-Qualification

### Inclusion Criteria
Every property is pre-qualified before inclusion:

1. **Homepage loads** without CAPTCHA blocking
2. **Booking engine is verified** to match the expected PMS (we trace the actual "Book" link and confirm the domain)
3. **No CAPTCHA** on the booking engine for test dates
4. **Property is not completely sold out/closed** for the 90-day test window

### Outcome Categories

| Category | Definition | Included in Score? | Example |
|----------|-----------|-------------------|---------|
| **Success** | Bot reaches payment page | ✅ Yes | Plekify Hemingways — 12/12 |
| **PMS Friction Abort** | Booking engine loads but is hard/impossible to complete | ✅ Yes (as max friction) | NightsBridge mobile room selection fails |
| **Property Ineligible** | Property closed, website down, or completely sold out | ❌ No | Mount Amanzi (zero availability) |

### Excluded Properties

| Property | PMS | Reason for Exclusion |
|----------|-----|---------------------|
| Mount Amanzi | ProfitRoom | Zero availability across all test dates (property closed) |
| Eversview | NightsBridge | No availability / broken date picker |
| Kuruman Inn | NightsBridge | CAPTCHA blocks every access |
| Mavilla | NightsBridge | Website completely down (timeouts) |
| River Inn | Cloudbeds | Broken widget (no booking button on mobile, non-editable inputs on desktop) |
| Limliwa Beach | Cloudbeds | CAPTCHA blocks every access |
| Boulders Beach Lodge | NightsBridge | CAPTCHA on every access |
| Supertubes Guesthouse | NightsBridge | Booking engine broken (zero availability, no date picker) |
| The LINE Hotel | Cloudbeds | CAPTCHA on every access |
| Freehand NYC | SiteMinder | Not actually SiteMinder (proprietary booking engine) |

---

## Automation Stack

| Component | Version / Details |
|-----------|-----------------|
| Browser | Chromium (via Playwright 1.60.0) |
| Execution mode | Headless |
| User agent | Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 |
| Viewport desktop | 1920×1080 |
| Viewport mobile | 375×667 |
| Server | Hetzner Cloud (AMD Ryzen 7 3700X, 64GB RAM, Debian 12) |
| Location | Germany (Nuremberg) |
| Python | 3.11 |

### Evidence Collection
- **Screenshots:** Full-page PNG per step (homepage, booking engine, date selection, results, payment page)
- **Video:** Screen recording per run (optional, disabled for speed)
- **Metrics:** JSON file per run with 30+ fields (clicks, handoffs, fields, duration, etc.)
- **Logs:** Full execution log with timestamps and step-by-step progress

---

## PMS-Specific Handler Details

### Plekify
- **Strategy:** Direct property page → Shopify calendar widget → "Book Now" → checkout
- **Handoffs:** 0 (on-domain checkout)
- **Key challenge:** Calendar day selection in Shopify widget
- **Handler notes:** Auto-searches calendar after date selection; waits for `/checkouts/` URL

### SiteMinder
- **Strategy:** Homepage → `direct-book.com` or `thebookingbutton.com` Vue SPA
- **Handoffs:** 1
- **Key challenge:** Vue SPA re-renders; hidden reCAPTCHA in DOM
- **Handler notes:** Uses direct URL with date params to bypass calendar; cookie banner dismissal; two-step room selection ("Select" then "Book")

### ProfitRoom
- **Strategy:** Homepage → `booking.profitroom.com` Vue SPA → `checkout.profitroom.com`
- **Handoffs:** 2
- **Key challenge:** Vue SPA takes 10–20s to render; room-selection buttons vary by property
- **Handler notes:** Direct results URL bypasses date picker; 15s wait + 7 fallback selectors + JS force-click for room buttons

### NightsBridge
- **Strategy:** Homepage → `book.nightsbridge.com` Angular SPA
- **Handoffs:** 1
- **Key challenge:** Calendar requires month-by-month navigation; room selection buttons invisible on mobile
- **Handler notes:** JS force-click for invisible homepage links; month navigation loop; expanded selector list for mobile room buttons

### Cloudbeds
- **Strategy:** Highly variable — inline widget, iframe, or external link to `hotels.cloudbeds.com`
- **Handoffs:** 0–1
- **Key challenge:** No consistent booking pattern; some widgets have non-editable date inputs
- **Handler notes:** Multiple fallback strategies (iframe navigation, link detection, non-editable input handling)

---

## Known Limitations

1. **Angular/Vue SPA timing:** Some SPAs take 10–20s to render. We wait up to 25s, but very slow connections may timeout.
2. **Form field detection:** Angular forms without HTML5 `required` attributes may under-report required fields.
3. **Availability variance:** Study A results vary based on actual property availability. A "no availability" abort means the property was sold out, not necessarily that the PMS is hard to use.
4. **CAPTCHA:** Properties with active CAPTCHA are documented as such — CAPTCHA itself is a form of friction.
5. **RoomRaccoon exclusion:** All 5 RoomRaccoon properties were excluded because triple-layer CAPTCHA (reCAPTCHA v2 + Cloudflare Turnstile + JS Challenge) makes automation impossible without human intervention.
6. **Property category variation:** Properties range from luxury safari lodges to hostels. While PMS behavior is consistent regardless of property tier, guest expectations may vary.

---

## Reproducibility

All code, property configurations, and raw results are available. The test suite can be re-run with:

```bash
cd /var/www/plekify/pms-friction-study-v3
source venv/bin/activate
python phase5/runner.py --output-dir output/phase5b --runs 3
```

### Data Files

```
output/
├── phase5b_metrics/          (276 JSON files — one per run)
├── phase5b_screenshots/      (276 dirs — step-by-step PNG evidence)
├── phase5b_execution_summary.json
└── phase5b_matrix.log        (full execution log)
```

### CSV Export

A flattened CSV export is available at `pms_friction_data.csv` with 276 rows and 18 columns including:
- PMS, property, study, viewport, run number
- Success/abort status and reason
- Friction score and all component metrics
- Duration, CAPTCHA encounters, inquiry-only flag

---

## Results Summary

| PMS | Success Rate | Avg Friction Score | Avg Duration |
|-----|-------------|-------------------|-------------|
| **Plekify** | **94%** | **4.2** | 36.8s |
| ProfitRoom | 78% | 6.8 | 49.1s |
| SiteMinder | 80% | 10.1 | 21.6s |
| NightsBridge | 60% | 14.6 | 38.0s |
| Cloudbeds | 30% | 5.8 | 76.1s |

---

## Contact & Attribution

Study designed and executed by Plekify.  
Methodology available under open terms for verification and reproduction.  
For questions about the study design or data, contact: research@plekify.com

---

*Document version: 1.0*  
*Last updated: 2026-06-13*  
*Study phase: Phase 5b FINAL*
