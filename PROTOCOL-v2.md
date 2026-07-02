# PMS Booking-Friction Study — Protocol v2 (Pre-Registered)

> **Version:** 2.0 (DRAFT for founder sign-off)
> **Date:** 2026-07-02
> **Pre-registration locus:** This document (commit-hash stamped in the public repo) + AsPredicted / OSF snapshot (to be filed on sign-off).
> **Public repository:** https://github.com/Matthew-Swart/plekify-booking-friction-study
> **Authors:** Matthew Swart (Plekify). Independent replication is invited; see §13.
> **Supersedes:** Phase 5b (v1) — `PMS-Booking-Friction-Study-Phase5-Execution-Brief.md` + `output/METHODOLOGY.md`.
> **Status:** PRE-REGISTERED. No data collection (v2) occurs until this protocol is frozen. Any deviation requires a dated, public amendment (§14).

---

## 0. Conflict of interest & governance

Plekify (the sponsor) is also one of the systems under test. To pre-empt COI criticism:
1. The protocol, all code, and all raw per-run data are **public** before results are interpreted.
2. The friction formula, outcome taxonomy, and analysis plan are **frozen here**, before any v2 run.
3. Outcomes are **machine-collected** (Playwright event logs + DOM/network probes); no manual scoring.
4. A neutral third party may re-run the published code against the published properties and reproduce the figures (§13).

This protocol follows the empirical-software-engineering pre-registration model (Registered Reports, MSR 2020 / EMSE) and the ITT principle from clinical-trials design (§7, §11).

---

## 1. Background & objectives

v1 measured **human-click friction** across 5 PMS booking engines (276 runs, 23 properties) and found Plekify lowest-friction (4.2) / highest-completion (94%). v1 had three defensibility gaps this protocol closes:

1. **Unstratified property selection** confounded PMS-platform quality with property-tier quality (luxury safari lodges vs hostels vs surf resorts). → v2 uses **Coarsened Exact Matching** (§5).
2. **CAPTCHA/bot-blocked runs were excluded**, hiding the most strategically relevant signal and biasing competitor scores downward. → v2 treats agent-blocks as a **first-class outcome under Intent-to-Treat** (§7).
3. **Arbitrary formula weights + no agentic-commerce dimension.** → v2 adopts an **empirically grounded** friction index + a **completion-probability model**, and adds a second axis: **Agent-Readiness** (§8) — measuring whether an autonomous agent can discover and complete a booking on the open web (Shopify UCP / A2A / schema.org framing).

**Objective:** produce a defensible, reproducible, two-axis benchmark — **Human Friction** and **Agent Readiness** — of direct-booking engines (PMS/channel-manager), the OTAs they compete with, and Plekify, with confidence intervals and confounder-robustness diagnostics.

---

## 2. Research questions & pre-registered hypotheses

**RQ1 (human friction).** Does Plekify's direct-booking flow have lower friction (higher modeled completion probability) than each comparator, on matched properties?
- **H1:** Plekify's Grounded LFI is lower than every comparator's, and the ratio of geometric means (competitor ÷ Plekify) has a 95% BCa CI entirely above 1.0.

**RQ2 (agent readiness).** Does Plekify score higher on open-web Agent Readiness than each comparator?
- **H2:** Plekify's ARS exceeds every comparator's by a margin outside the measurement uncertainty of each signal.

**RQ3 (OTAs).** Do the OTAs exhibit higher friction AND lower open-web agent-readiness than direct booking?
- **H3:** OTAs show more off-domain redirects, more agent-blocks, and lower ARS than Plekify direct, reinforcing the direct-vs-OTA economics case.

**RQ4 (cloud-agent hostility).** Does egress IP reputation (datacenter vs residential) change the agent-block rate, and does that delta vary by system?
- **H4:** The datacenter–residential agent-block delta is larger for systems with enterprise bot-management (Akamai/HUMAN/Cloudflare) than for Plekify.

*Hypotheses are directional and pre-registered. Non-confirmatory results will be reported as such.*

---

## 3. Systems under test

| Category | System | Why included |
|---|---|---|
| Protagonist | **Plekify** (Shopify) | The system under sponsor; baseline |
| Core PMS / channel mgr | **SiteMinder**, **Cloudbeds**, **NightsBridge**, **RoomRaccoon** | Recognizable incumbents. RoomRaccoon is retained *as an agent-blocked exhibit*, not excluded. |
| HIA-relevant PMS | **Mews**, **Stayntouch**, **OPERA** (if a drivable public booking flow exists) | Named HIA/Acumatica-integrated PMSs (doc 50 §15.1); resonate with the 7 Jul audience. Stayntouch's export pattern mirrors Plekify's folio→GL batch. |
| OTAs / marketplaces | **Booking.com**, **Airbnb**, **Expedia**, **Travelstart** | The platforms a guest actually compares direct booking against; make the direct-vs-OTA argument concrete. |

**Excluded:** ProfitRoom (low strategic resonance for the HIA audience).

> Note: OPERA and Airbnb may be undrivable to payment (Airbnb's mandatory ID verification; OPERA's property-level gating). Per §7 these become **agent-blocked / redirected** outcomes — which is itself the finding.

---

## 4. Study design

Two studies per property, two viewports, ≥5 runs per cell — identical to v1 in structure, extended in measurement.

| Dimension | Value |
|---|---|
| Study A | "Can I find a room?" — availability search; up to 10 date attempts in a rolling 90-day window, stays 2 nights, 3 days apart |
| Study B | "Can I complete the booking?" — fixed dates (2 adults, 1 night) driven to the **payment page** (no booking completed) |
| Fixed dates (Study B) | {check-in T+45d, check-out T+47d}, T = run date. Recorded per run. |
| Viewports | Desktop 1920×1080; Mobile 375×667 |
| Runs per cell | ≥5 (raised from v1's 3 for power; see §11.4) |
| Pause between runs | 2 s (sequential), to avoid rate-limit self-inflicted noise |
| Stop condition | Payment page reached (Study B) / availability confirmed (Study A). **No real bookings. No CAPTCHA solving.** Synthetic guest data only (§12). |

---

## 5. Property selection — Coarsened Exact Matching (CEM)

### 5.1 Why CEM, not propensity-score matching
King & Nielsen (2019) show PSM can *increase* imbalance, bias, and model dependence (the "PSM paradox"). CEM coarsens covariates into substantive bins and exact-matches within them, **bounding imbalance ex ante**. We adopt CEM per the methodology literature.

### 5.2 Covariates & coarsening bins
| Covariate | Bins |
|---|---|
| Property tier (proxy for catalog/complexity) | Budget · Midscale · Upscale · Luxury |
| Booking volume class | Low · Medium · High (estimated from public footprint) |
| Region | Exact match (Africa · Europe · North America · Asia) |
| Distribution model | Direct-only · Direct + OTA · Multi-channel |

Strata without at least one property per system are pruned; analysis uses CEM weights on the matched set. A matched "apples-to-apples" subset (same tier × region × distribution) is reported as the primary head-to-head; the full field is reported as secondary.

### 5.3 Eligibility (pre-registered)
A property is **eligible** if: (a) homepage loads; (b) the booking engine is verified to belong to the target system (DOM/network trace); (c) the property is not permanently closed/sold-out for the whole window. **CAPTCHA/bot-detection does NOT make a property ineligible** — it is a measured outcome (§7).

### 5.4 Target n
≥6 eligible properties per system where achievable (OTAs: a property = a representative bookable listing on the OTA domain); ≥5 runs/cell. Final n reported with the attrition diagram.

### 5.5 Attrition diagram (CONSORT-style, to be published with results)
`Screened → Eligible → Matched (CEM) → Runs attempted → Outcomes {reached-payment | redirected | agent-blocked | errored}` with a reason at every step.

---

## 6. Outcome taxonomy (pre-registered)

Every run ends in exactly one outcome:

| Outcome | Definition | Scored as |
|---|---|---|
| **reached-payment** | Bot reaches a payment-entry page | Actual measured friction (LFI) |
| **redirected-off-domain** | Flow leaves the property's domain to a third-party booking engine/gateway and reaches payment there | Actual friction + domain-handoff penalty |
| **agent-blocked** | Bot cannot proceed due to CAPTCHA / bot-wall / bot-detection / mandatory human-ID step (e.g. Airbnb) | **ITT: max-friction penalty = timeout (30 s)** |
| **errored** | Infrastructural failure (network, timeout not caused by bot-detection, crash) | Excluded from primary; reported in attrition |

**Rationale (founder steer):** capture failures must not corrupt the test's integrity — a real guest (or agent) experiences them as friction. ITT-with-penalty is the gold-standard (clinical-trials) way to include them without biasing the comparison. v1's exclusion of CAPTCHA properties is retired.

---

## 7. Primary analysis population — Intent-to-Treat (ITT)

- **Primary:** ITT. Every initiated run is analyzed under its assigned system. agent-blocked/redirected runs receive the **max-friction penalty (timeout)** so that a system that blocks agents is not rewarded with a low score. (Multiple-imputation sensitivity in §11.5.)
- **Secondary:** Per-Protocol (reached-payment only), Inverse-Probability-Weighted to adjust for the selective dropout. Reported openly as "ideal-conditions efficacy," never as the headline.

This directly satisfies the requirement that agent-blocking be measured, not hidden, and that it count against agent-hostile systems.

---

## 8. Metrics

### 8.1 Grounded Linear Friction Index (LFI) — replaces v1's arbitrary formula
All weights calibrated to the **Form-Field Unit (FFU)**, where 1 field = 4.1% relative conversion loss (HubSpot regression). Source linkage published in the repo.

> **F = C + 6.6·H + 1.0·Fld_excess + 1.7·P + 9.8·I − 3.7·A − 5.4·Acc**
> where `Fld_excess = max(0, Fld − 8)`

| Term | Weight (FFU) | Empirical anchor |
|---|---|---|
| C — clicks | 1.0 | (retained from v1; the sole un-recalibrated term — reported in sensitivity) |
| H — domain handoffs | 6.6 | Offsite redirect ≈ 27% abandonment |
| Fld_excess — form fields beyond 8 | 1.0 | 1 field = 4.1% loss (definition of FFU) |
| P — page-load seconds | 1.7 | 1 s latency ≈ 7% conversion loss |
| I — interactive interruption (CAPTCHA/challenge) | 9.8 | CAPTCHA ≈ 40% form-conversion loss |
| A — address autocomplete | −3.7 | ≈ 15% relative conversion lift |
| Acc — accelerated checkout (Shop Pay / Apple/Google Pay / UCP-AP2) | −5.4 | ≈ 22.3% conversion lift |

v1's weights underestimated CAPTCHA by 227%, latency by 240%, autocomplete by 640%.

### 8.2 Friction-Induced Drop-off Probability Model (FIDPM) — completion-% output
Logistic model → predicted checkout-completion probability per system (baseline abandonment 70.19%):

> logit(p) = 0.856 + 0.565·H + 0.476·I + 0.058·Fld_excess + 0.247·P − 0.751·A − 0.540·Acc
> completion% = (1 − p) × 100

Reported alongside LFI (more intuitive for a non-technical audience).

### 8.3 Agent-Readiness Score (ARS) — the second axis
**Definition of "agent-ready" (pre-registered):** an autonomous agent can **discover and complete** a booking on the **open web without a private commercial agreement** (i.e. the Shopify-UCP definition, NOT a gated B2B partner API). This framing is chosen deliberately because it is the one relevant to Plekify's positioning; the alternative (B2B-API access, e.g. Booking.com's gated Demand API) is reported separately and labelled as such.

> **ARS = 0.20·SD + 0.15·BM + 0.20·CW + 0.15·AP + 0.20·API + 0.10·PA** (scale 0–3)

| Signal | Weight | Detection method | 0 → 3 scoring (condensed) |
|---|---|---|---|
| SD — Structured data | 0.20 | Parse `<script application/ld+json>`; validate schema.org `LodgingBusiness`/`Hotel`/`HotelRoom`/`Offer` with price+availability; probe `directBookingChannel` (schema.org #4824) | none → property-only → room-level → live rate+availability |
| BM — Robots / bot posture | 0.15 | Fetch `/robots.txt`; check booking-path disallows + AI-crawler (GPTBot/ClaudeBot/Google-Extended) blocks; Cloudflare/WAF signals | wildcard-block → blocks tx paths → permissive → AI-permissive w/ modern signals |
| CW — CAPTCHA / WAF friction | 0.20 | Headless Playwright on search+checkout; detect Turnstile/reCAPTCHA/hCaptcha/DataDome/Akamai/`cf-mitigated`/403 | hard bot-wall → JS challenge → rate-limit only → seamless |
| AP — Express payments | 0.15 | DOM-probe for Shop Pay/Apple Pay/Google Pay/passkeys; check `/.well-known/ucp` | card-only → wallet buttons → UCP/AP2 tokenized |
| API — Public API | 0.20 | Probe developer portal; self-serve key generation? OAuth vs WSSE/SOAP | none → enterprise-gated → documented-paid → open self-serve |
| PA — Protocol adherence | 0.10 | `/.well-known/ucp`, A2A agent-card.json, HAPI signature | proprietary → domain XML/JSON → standard → UCP/A2A native |

Each signal's raw value is published so the composite is fully auditable. ARS is measured from **both** egresses (§9); the residential–datacenter CW delta = the cloud-agent-hostility signal (RQ4).

---

## 9. Environment & egress (pre-registered)

| Axis | Egress | Rationale |
|---|---|---|
| Human friction (LFI/FIDPM, Studies A+B) | **SA residential (founder laptop)** | Matches the African-operator beachhead; residential IP avoids datacenter-only CAPTCHA false-positives. Single geo. |
| Agent readiness (ARS) + cloud-agent-hostility delta | **Hetzner datacenter (EU)** + residential cross-check | Cloud AI agents run from datacenter IPs; measuring from there is the correct agent-axis posture. |

- **Browser:** Chromium via Playwright (Node). Same code, same version on laptop + server.
- **User agent:** realistic desktop/mobile Chrome UA (documented); not a naked headless fingerprint.
- **Recorded per run:** egress type, geo, UA, viewport, timestamp (UTC), runner commit hash, system, property, study, run #.
- **Stated limitation (pre-declared):** human-friction axis is single-geo (SA residential). US/EU-residential variance is not measured in v2; flagged as a follow-up. This is honest and upgradable.

> **Correction of v1 record:** v1's `METHODOLOGY.md` states "Hetzner, Germany" but the runs were executed from the founder's SA laptop on a domestic connection. v2 records the **actual** egress per run; the v1 mis-statement is noted in the CHANGELOG.

---

## 10. Ethical constraints

- **No real bookings.** All Study B runs stop at the payment page; no card is charged, no reservation created.
- **No CAPTCHA solving** (manual or service). An unsolved CAPTCHA = agent-blocked outcome.
- **Synthetic guest data only** (obviously fake name/email). No real PII.
- **Respect `robots.txt` intent** for ARS measurement; we *measure* bot posture, we do not bypass it to transact.
- Low request volume (≥2 s pause); no load testing.

---

## 11. Statistical analysis plan (pre-registered)

### 11.1 Distribution
Booking latency is strictly positive, right-skewed → **lognormal**. Fit μ, σ by MLE on log-latency. Goodness-of-fit: KS with Lilliefers/parametric-bootstrap critical values; compare vs Gamma and log-logistic by AIC/BIC.

### 11.2 Estimand & test
Per comparator vs Plekify: **ratio of geometric means** R = geom-mean(comparator) / geom-mean(Plekify), via CEM-weighted linear regression of log-latency on the system indicator (+ uncoarsened covariates):
> ln(Y_i) = β0 + τ·T_i + Σ β_j X_ij + ε_i, weighted by CEM weights w_i.
> R = e^τ. H0: R = 1.

### 11.3 Confidence intervals
**Cluster-level non-parametric bootstrap**, B = 10,000, resampling **properties** (clusters) with replacement, recomputing CEM weights each iteration; **BCa** 95% CI on R. (Runs within a property are not independent.)

### 11.4 Sample size / power
Lognormal two-sample test on the ratio; solve n = 2σ²(z_{1−α/2}+z_{1−β})² / (ln R₁)², with σ = √ln(1+CV²). Target ≥90% power to detect R₁ = 1.10 (10% velocity difference) at α = 0.05, using v1 pilot variance. If unequal per-system n (likely), recompute the power curve and report achieved power.

### 11.5 Sensitivity analyses (all pre-declared)
1. **Formula-weight sweep:** re-rank under handoff ∈ [3,7], interruption ∈ [2,4], etc.; report whether the ranking is stable.
2. **Click-weight on/off:** C is the one un-grounded term; report with C = 0 and C = 1.
3. **ITT penalty choice:** timeout 30 s vs 60 s vs multiple imputation (FCS).
4. **Unmeasured confounding:** Rosenbaum bounds (report Γcrit; >2 moderate, >3 high robustness) and the **E-value** for the point estimate and the CI bound.
5. **Egress:** report residential-only, datacenter-only, and pooled ARS-CW deltas (RQ4).

### 11.6 Primary vs secondary endpoints
- **Primary:** ITT Grounded-LFI ratio R (per comparator vs Plekify) with BCa CI — §11.2–11.3.
- **Secondary:** FIDPM completion-%; ARS per system; Per-Protocol R; the cloud-agent-hostility delta.

---

## 12. Data, code & reproducibility

- **Public repo:** protocol (this file), runner (Node/Playwright), properties matrix, ARS probes, analysis (Python), per-run JSON, flattened CSV, results summary, attrition diagram, CHANGELOG. Tagged release `v2.0`.
- **Replication:** clone → `npm i` → `playwright install chromium` → set egress env vars → `node runner.js --system X --egress residential|datacenter`. Identical inputs reproduce identical figures.
- **Immutability:** a SHA-256 of the released results bundle is recorded in the repo; any post-hoc edit is detectable.

---

## 13. Limitations (pre-declared)

1. Human-friction axis is single-geo (SA residential).
2. Property availability is seasonal; Study A outcomes vary with real inventory.
3. Angular/Vue SPA render timing can cause infra aborts (categorized `errored`, not scored).
4. Form-field detection may under-count on non-HTML5-`required` forms (reported per system).
5. ARS measures open-web readiness; gated B2B-API access (e.g. Booking.com Demand API) is reported separately and not conflated.
6. Plekify is the sponsor; COI mitigations in §0.
7. Click-weight (C) is the one empirically un-grounded coefficient; handled in sensitivity (§11.5.2).

---

## 14. Amendments

No change to systems, properties, formula, outcome taxonomy, or analysis plan after the first v2 run without a **dated, public amendment** appended to this file and the CHANGELOG. Pre-registration timestamp = the commit hash of the frozen protocol.

---

## 15. v1 → v2 changelog (summary)

| Area | v1 (Phase 5b) | v2 |
|---|---|---|
| Formula | Arbitrary weights | Grounded LFI (empirically calibrated) + FIDPM completion-% |
| Agent-blocks | Excluded | ITT with max-friction penalty (first-class outcome) |
| Property selection | Unstratified | Coarsened Exact Matching |
| Confidence intervals | None | Cluster-bootstrap BCa + Rosenbaum/E-value |
| Axis | Human friction only | + Agent-Readiness Score (6 signals) |
| Systems | 5 PMS | + HIA PMS (Mews/Stayntouch/OPERA) + OTAs (Booking/Airbnb/Expedia/Travelstart); ProfitRoom dropped |
| Egress | Mis-stated (claimed Hetzner, was SA laptop) | SA residential (human) + Hetzner datacenter (agent), recorded per run |
| Language | Python runner (framework now lost) | Node/Playwright runner + Python analysis |

---

*End of Protocol v2.0 (DRAFT). Freezes on founder sign-off + commit + OSF/AsPredicted filing.*
