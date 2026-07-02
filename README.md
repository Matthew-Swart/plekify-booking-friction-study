# Plekify Booking-Friction Study

Open methodology, code, and raw data for the automated booking-friction benchmark referenced on [plekify.com](https://plekify.com).

## v2 (current) — two-axis: Human Friction × Agent Readiness

**Protocol:** [`PROTOCOL-v2.md`](./PROTOCOL-v2.md) (pre-registered).

v2 closes the three defensibility gaps of v1 (Phase 5b):

1. **Empirically grounded friction formula** (replaces arbitrary weights), calibrated to the Form-Field Unit (1 field = 4.1% conversion loss):
   `F = C + 6.6H + Fld_excess + P + 9.8I − 3.7A − 5.4Acc`
2. **Intent-to-Treat handling of agent-blocks** — CAPTCHA/bot-walls are a first-class outcome with a timeout penalty, not an exclusion (RoomRaccoon becomes an exhibit, not a footnote).
3. **A second axis — Agent Readiness (ARS)**: whether an autonomous agent can discover and complete a booking on the open web (Shopify-UCP frame), measured across 6 signals (structured data, robots/bot posture, CAPTCHA/WAF friction, express payments, public API, protocol adherence).

**Systems (v2):** Plekify + SiteMinder, Cloudbeds, NightsBridge, RoomRaccoon (agent-blocked exhibit) + Mews, Stayntouch, OPERA-ecosystem + Booking.com, Airbnb, Expedia, Travelstart. ProfitRoom dropped.

**Results:** [`results_v2.md`](./results_v2.md) · [`results_v2.csv`](./results_v2.csv) · [`results_v2.json`](./results_v2.json)

### Headline (v2)

| Axis | Plekify | Best competitor |
|---|---|---|
| **Agent Readiness (0–3)** | **3.0** (live UCP manifest: catalog + Shop Pay/Google Pay handlers + MCP endpoint) | ~2.1 |
| **Friction (grounded LFI, lower better)** | **5.0** | 10.3 (Cloudbeds) |

## Repo layout

```
PROTOCOL-v2.md          Pre-registered protocol (the frozen design)
src/probes/ars.js       The 6 Agent-Readiness probes
src/probes/run-probes.js  Run ARS across all properties
src/runner.js           Study A/B human-friction runner
src/metrics.js src/formulas.js src/handlers.js src/outcome.js src/util.js
properties_v2.js        CEM property matrix (35 properties, 11 systems)
analysis/analyse.py     Grounded-LFI recompute (v1 276 runs) + ARS aggregation + bootstrap CI
data/ars/<egress>/      Per-property ARS JSON + summary CSV (residential + datacenter)
data/flows/<egress>/    Per-run Study A/B JSON + CSV
friction-study-data.csv v1 raw data (276 runs) — re-scored under grounded weights for the friction axis
METHODOLOGY.md          v1 methodology (superseded by PROTOCOL-v2.md, retained for history)
```

## Reproduce

```bash
npm install
npx playwright install chromium
# Agent-readiness axis (run from each egress: laptop = residential, server = datacenter)
node src/probes/run-probes.js
# Human-friction flows
node src/runner.js --system plekify --study B --viewport desktop --runs 5
# Analysis: grounded LFI (v1 recompute) + ARS aggregation + bootstrap CI
python3 analysis/analyse.py
```

## v1 (history)

[`METHODOLOGY.md`](./METHODOLOGY.md) and [`friction-study-data.csv`](./friction-study-data.csv) are the v1 (Phase 5b) artifacts: 276 Playwright runs across 23 properties and 5 PMS platforms. v1's friction formula (`F = C + 5H + 0.5Fld + 0.5P + 3I − 0.5A − 3Acc`) used arbitrary weights; v2 re-scores the same 276 raw runs under the empirically grounded weights and adds the Agent-Readiness axis.

## License

Methodology, code, and data released under [CC0 1.0 Universal](./LICENSE).
