# Booking-Friction Study v2 — Results

> Two-axis: **Human friction** (grounded LFI, re-scored from the v1 276-run dataset) × **Agent Readiness** (ARS, fresh v2 probes). ProfitRoom excluded per v2 decision.


## Friction (grounded LFI, lower = better) — v1 276 runs re-scored

| System | n | Success% | Mean LFI (success) | 95% CI | Mean completion% | Mean handoffs | Mean pages |
|---|---:|---:|---:|---:|---:|---:|---:|
| **plekify** | 36 | 94% | **5.03** | 4.71–5.35 | 23.1 | 0 | 1.41 |
| **cloudbeds** | 60 | 30% | **10.27** | 8.19–12.29 | 14.9 | 0.5 | 2.5 |
| **siteminder** | 60 | 80% | **11.35** | 10.64–12.06 | 10.7 | 1 | 2.75 |
| **nightsbridge** | 60 | 60% | **17.18** | 16.24–18.13 | 12.8 | 1 | 2 |

## Agent Readiness (ARS, higher = better, 0–3) — v2 fresh probes

| System | n | **ARS** | SD | BM | CW | AP | API | PA |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **plekify** | 3 | **3** | 3 | 3 | 3 | 3 | 3 | 3 |
| **cloudbeds** | 3 | **2.03** | 0.67 | 3 | 2.67 | 1 | 3 | 1.67 |
| **siteminder** | 4 | **1.5** | 0 | 3 | 3 | 1 | 1 | 1 |

_ITT (intent-to-treat) mean LFI (non-completed runs take the timeout-penalty floor):_

- plekify: 5.66
- cloudbeds: 14.56
- siteminder: 12.36
- nightsbridge: 16.87

## Key finding
Plekify is the only system with a live **UCP manifest** (catalog + Shop Pay/Google Pay handlers + MCP endpoint) and zero agent-blocking — ARS 3.0/3.0, the maximum. Every competitor scores 0.6–2.3, gated by closed APIs, missing structured data, no express-payment handlers, and (OTAs/RoomRaccoon) bot-walls.
