# Plekify Booking Friction Study

Open methodology and raw data for the automated PMS booking-friction study referenced on [plekify.com](https://plekify.com).

## What this repo contains

- [`METHODOLOGY.md`](./METHODOLOGY.md) — full test protocol, formula, metrics and exclusions.
- [`friction-study-data.csv`](./friction-study-data.csv) — raw per-run data from 276 Playwright browser tests across 23 properties and 5 PMS platforms.

## Key result

| PMS | Avg friction score | Success rate | Domain handoffs |
|-----|-------------------:|-------------:|----------------:|
| **Plekify** | **4.2** | **94%** | **0** |
| ProfitRoom | 6.8 | 78% | 2 |
| Cloudbeds | 5.8 | 30% | 0–1 |
| SiteMinder | 10.1 | 80% | 1 |
| NightsBridge | 14.6 | 60% | 1 |

Friction formula:

```
F = C + 5H + 0.5Fld + 0.5P + 3I − 0.5A − 3Acc
```

Where:

- `C` = clicks to payment
- `H` = domain handoffs
- `Fld` = form fields
- `P` = pages visited
- `I` = inquiry-only flag
- `A` = autofill score
- `Acc` = accelerated checkout availability

Lower = less friction.

## Reuse

The methodology and data are released under [CC0 1.0 Universal](./LICENSE) unless otherwise noted.
