# Booking-Friction Study v2 — Results

> Two-axis: **Human friction** (grounded LFI, re-scored from the v1 276-run dataset) × **Agent Readiness** (ARS, fresh v2 probes). ProfitRoom excluded per v2 decision.


## Friction (grounded LFI, lower = better) — v1 276 runs re-scored

| System | n | Success% | Mean LFI (success) | 95% CI | Mean completion% | Mean handoffs | Mean pages |
|---|---:|---:|---:|---:|---:|---:|---:|
| **plekify** | 36 | 94% | **5.03** | 4.71–5.35 | 23.1 | 0 | 1.41 |
| **cloudbeds** | 60 | 30% | **10.27** | 8.19–12.29 | 14.9 | 0.5 | 2.5 |
| **siteminder** | 60 | 80% | **11.35** | 10.64–12.06 | 10.7 | 1 | 2.75 |
| **nightsbridge** | 60 | 60% | **17.18** | 16.24–18.13 | 12.8 | 1 | 2 |

## Friction (v2 FRESH flows — 2026-07 headed residential, real grounded LFI)

| System | n | reached-payment | mean LFI (payment) | mean LFI (ITT) | clicks | handoffs | outcomes |
|---|---:|---:|---:|---:|---:|---:|---|
| **plekify** | 7 | 6 | 10.9 | 18.97 | 4 | 0 | reached-payment:6, errored:1 |
| **mews** | 9 | 0 | — | 16.4 | — | — | errored:9 |
| **stayntouch** | 12 | 3 | 7.9 | 14.27 | 3 | 1 | errored:9, redirected-off-domain:3 |
| **cloudbeds** | 6 | 0 | — | 16.4 | — | — | agent-blocked:4, errored:2 |
| **siteminder** | 6 | 6 | 29.4 | 29.4 | 4.3 | 1 | redirected-off-domain:6 |
| **nightsbridge** | 6 | 6 | 22.93 | 22.93 | 7 | 1 | redirected-off-domain:6 |
| **roomraccoon** | 8 | 0 | — | 16.4 | — | — | errored:6, agent-blocked:2 |
| **booking** | 2 | 0 | — | 16.4 | — | — | agent-blocked:2 |
| **airbnb** | 2 | 0 | — | 16.4 | — | — | agent-blocked:2 |
| **expedia** | 2 | 0 | — | 16.4 | — | — | agent-blocked:2 |
| **travelstart** | 2 | 0 | — | 16.4 | — | — | errored:2 |

## Agent Readiness (ARS, 0–3, higher = better) — v2 fresh probes, both egresses

| System | ARS residential | ARS datacenter | Cloud-agent Δ | SD | BM | CW | AP | API | PA |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **plekify** | **3** | 3 | +0.00 | 3 | 3 | 3 | 3 | 3 | 3 |
| **mews** | **1.87** | 1.87 | +0.00 | 0 | 2.33 | 3 | 1 | 3 | 1.67 |
| **stayntouch** | **1.57** | 1.57 | +0.00 | 0 | 0.83 | 3 | 1 | 3 | 1 |
| **cloudbeds** | **2.03** | 1.77 | +0.26 | 0.67 | 3 | 2.67 | 1 | 3 | 1.67 |
| **siteminder** | **1.5** | 1.5 | +0.00 | 0 | 3 | 3 | 1 | 1 | 1 |
| **nightsbridge** | **1.35** | 1.35 | +0.00 | 0 | 2 | 3 | 1 | 1 | 1 |
| **roomraccoon** | **1.44** | 1.24 | +0.20 | 0 | 2.25 | 3 | 1 | 1 | 1.5 |
| **opera** | **1.2** | 1.2 | +0.00 | 0 | 1 | 3 | 1 | 1 | 1 |
| **booking** | **1.75** | 1.35 | +0.40 | 2 | 2 | 3 | 1 | 1 | 1 |
| **airbnb** | **1.25** | 0.85 | +0.40 | 2 | 0 | 3 | 1 | 0 | 1 |
| **expedia** | **0.6** | 0.6 | +0.00 | 0 | 1 | 0 | 1 | 1 | 1 |
| **travelstart** | **1.4** | 1.4 | +0.00 | 0 | 1 | 3 | 1 | 1 | 3 |

_Cloud-agent Δ (residential − datacenter ARS) is the cloud-agent-hostility signal (RQ4): a positive Δ means the system penalises datacenter IPs — where cloud AI agents run. Plekify Δ = 0.00 (equally agent-friendly from any IP); OTAs show the largest Δ._


_ITT (intent-to-treat) mean LFI (non-completed runs take the timeout-penalty floor):_

- plekify: 5.66
- cloudbeds: 14.56
- siteminder: 12.36
- nightsbridge: 16.87

## Key finding
Plekify is the only system with a live **UCP manifest** (catalog + Shop Pay/Google Pay handlers + MCP endpoint) and zero agent-blocking — ARS 3.0/3.0, the maximum. Every competitor scores 0.6–2.3, gated by closed APIs, missing structured data, no express-payment handlers, and (OTAs/RoomRaccoon) bot-walls.
