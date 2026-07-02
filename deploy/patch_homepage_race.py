#!/usr/bin/env python3
"""Patch the deployed travel_2022 index.json race section to v2 (grounded formula,
v2 friction numbers, comprehensive methodology + ARS table). Run on the server."""
import json, os, time

P = "/var/www/plekify/horizon-v4-fresh/store_overrides/travel_2022/templates/index.json"
os.system(f"cp {P} {P}.bak.{int(time.time())}")
d = json.load(open(P))

race = None
for s in d.get("sections", {}).values():
    if s.get("type") == "plekify-v10-race":
        race = s
        break
assert race, "plekify-v10-race section not found"

race["settings"]["github_url"] = "https://github.com/Matthew-Swart/plekify-booking-friction-study"
race["settings"]["intro"] = (
    "We scripted a real booking — pick dates, choose a room, reach the payment page — and ran it automatically. "
    "The score counts every click, form field, page and domain hand-off between the guest and payment (lower is better), "
    "under an empirically-grounded formula. Plekify runs on Shopify checkout, on the property's own domain — and is the "
    "only system here with a live Universal Commerce Protocol (UCP) manifest, so an AI booking agent can read and transact with it too."
)
race["settings"]["formula_text"] = "F = C + 6.6H + Fld_excess + P + 9.8I − 3.7A − 5.4Acc"
race["settings"]["methodology_cta_label"] = "Methodology, Agent-Readiness & open repository"
race["settings"]["honest_note"] = (
    "SiteMinder reaches the payment page a few seconds faster in raw time — but at higher friction (one domain hand-off, "
    "no express checkout, no agent-readable surface). The grounded formula weights hand-offs at 6.6× and interruptions at 9.8×, "
    "so the on-domain, zero-handoff, Shop-Pay path wins."
)

METHOD = (
"<p><strong>Two axes, both measured.</strong> First, <em>human friction</em> — a grounded Linear Friction Index re-scored "
"from 276 automated Playwright runs. Second, <em>Agent Readiness</em> — a fresh probe of whether an autonomous booking agent "
"can discover and complete a booking on the open web (the Shopify Universal Commerce Protocol definition, not a gated B2B API).</p>"

"<p><strong>The formula is empirically grounded.</strong> Every weight is calibrated to the Form-Field Unit (one extra form "
"field ≈ 4.1% relative conversion loss): a domain hand-off is weighted 6.6×, an interruption (CAPTCHA / bot-wall / mandatory "
"account wall) 9.8×, a page load 1×, address autocomplete −3.7, accelerated checkout (Shop Pay / Apple Pay / Google Pay) −5.4. "
"v1's arbitrary weights under-counted CAPTCHA by 227% and latency by 240%.</p>"

"<p><strong>Friction results (grounded LFI, lower is better, with bootstrap 95% confidence intervals):</strong></p>"
"<ul>"
"<li><strong>Plekify — 5.0</strong> (CI 4.71–5.35) · 94% success · 0 hand-offs</li>"
"<li>Cloudbeds — 10.3 (CI 8.19–12.29) · 30% success</li>"
"<li>SiteMinder — 11.4 (CI 10.64–12.06) · 80% success</li>"
"<li>NightsBridge — 17.2 (CI 16.24–18.13) · 60% success</li>"
"</ul>"
"<p>The Plekify confidence interval does not overlap the nearest competitor — the ranking is statistically robust.</p>"

"<p><strong>Agent-Readiness Score (ARS, 0–3, higher is better)</strong> — six signals: structured data (JSON-LD or a live "
"UCP catalog), robots &amp; bot posture, CAPTCHA/WAF friction, express payments, public API, and protocol adherence "
"(a real /.well-known/ucp manifest or A2A agent card):</p>"
"<ul>"
"<li><strong>Plekify — 3.0/3.0</strong>: the only system with a live UCP manifest (catalog + Shop Pay &amp; Google Pay handlers + an MCP endpoint) and zero bot-walls.</li>"
"<li>Cloudbeds 2.0 · Mews 1.9 · Booking.com 1.8 · Stayntouch 1.6 · SiteMinder 1.5 · RoomRaccoon 1.4 · Travelstart 1.4 · NightsBridge 1.35 · Airbnb 1.25 · OPERA-ecosystem 1.2 · Expedia 0.6.</li>"
"<li>Booking.com exposes rich structured data but its API is gated and its perimeter is bot-defended; Airbnb's API is closed and its book action is login/ID-walled; Expedia hard-blocks automated browsers. None is open-web agent-ready.</li>"
"</ul>"

"<p><strong>Agent-blocks are measured, not hidden.</strong> Each run is classified reached-payment, redirected off-domain, "
"agent-blocked or errored. Under Intent-to-Treat, blocked runs take a timeout-penalty floor — so a system that blocks agents "
"is never rewarded with a low score. RoomRaccoon and the OTAs are kept as agent-blocked exhibits, not excluded.</p>"

"<p><strong>Systems &amp; selection.</strong> Plekify + SiteMinder, Cloudbeds, NightsBridge, RoomRaccoon + Mews, Stayntouch, "
"the OPERA ecosystem + Booking.com, Airbnb, Expedia, Travelstart (ProfitRoom dropped). Properties are matched on tier, region and "
"distribution (Coarsened Exact Matching) so the comparison is apples-to-apples.</p>"

"<p><strong>Egress &amp; limitations.</strong> Human-friction runs execute from a residential connection; Agent-Readiness from a "
"datacenter (where cloud AI agents run). Single residential geo is a stated, upgradable limitation. The full pre-registered "
"protocol, all code, every per-run JSON and the analysis are open for independent replication at the repository below.</p>"
)
race["settings"]["methodology_text"] = METHOD

V2 = {
 "Plekify":    dict(name="Plekify", badge="On-domain · Shop Pay · UCP agent-ready", friction_score="5.0", success_rate="94%", clicks="3.5", handoffs="0", fields="8", duration="36.8s", payment="Shop Pay", status="finished", highlighted=True),
 "Cloudbeds":  dict(name="Cloudbeds", badge="Channel handoff · ARS 2.0", friction_score="10.3", success_rate="30%", clicks="3.0", handoffs="0–1", fields="—", duration="76.1s", payment="card", status="finished"),
 "ProfitRoom": dict(name="OTAs (Booking · Airbnb · Expedia)", badge="agent-blocked — bot-walls, login-walls, closed APIs · ARS 0.6–1.8", friction_score="0", success_rate="—", clicks="—", handoffs="—", fields="—", duration="—", payment="—", status="excluded"),
 "SiteMinder": dict(name="SiteMinder", badge="Channel handoff · ARS 1.5", friction_score="11.4", success_rate="80%", clicks="6.2", handoffs="1", fields="—", duration="21.6s", payment="card", status="finished"),
 "NightsBridge": dict(name="NightsBridge", badge="Channel handoff · ARS 1.4", friction_score="17.2", success_rate="60%", clicks="13.0", handoffs="1", fields="—", duration="38.0s", payment="card", status="finished"),
 "RoomRaccoon": dict(name="RoomRaccoon", badge="agent-blocked — triple-layer CAPTCHA · ARS 1.4", friction_score="0", success_rate="—", clicks="—", handoffs="—", fields="—", duration="—", payment="—", status="excluded"),
}
for b in race.get("blocks", {}).values():
    nm = b.get("settings", {}).get("name", "") if isinstance(b, dict) else ""
    if nm in V2:
        b["settings"].update(V2[nm])

json.dump(d, open(P, "w"), indent=2)
print("PATCHED", P)
print("racers:", [b.get("settings", {}).get("name") for b in race.get("blocks", {}).values()])
