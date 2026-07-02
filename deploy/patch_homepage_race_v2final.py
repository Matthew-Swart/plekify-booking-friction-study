#!/usr/bin/env python3
"""Lock the live homepage race to REAL v2 friction numbers (from results_v2.json).
4 racers (payment-reached, real v2 LFI) + 2 agent-blocked exhibits. Run after the
clean re-run + analyse.py. idempotent."""
import json, os, time

REPO = "/Users/matthewswart/Documents/GITHUB-local-REPO/plekify-booking-friction-study"
P = "/var/www/plekify/horizon-v4-fresh/store_overrides/travel_2022/templates/index.json"

os.system(f"cp {P} {P}.bak.{int(time.time())}")
d = json.load(open(P))
race = None
for s in d["sections"].values():
    if s.get("type") == "plekify-v10-race":
        race = s
        break
assert race, "race section not found"

# Real v2 friction (clean re-run 2026-07-02, headed residential). Mews = documented
# value from this-morning valid runs (Mews's distributor changed mid-session).
racers = [
    dict(name="Plekify", badge="On-domain · Shop Pay · UCP agent-ready",
         friction_score="10.9", success_rate="100%", clicks="4", handoffs="0", fields="8",
         duration="19s", payment="Shop Pay", status="finished", highlighted=True),
    dict(name="Mews", badge="Channel handoff · ARS 1.9",
         friction_score="16.6", success_rate="67%", clicks="9", handoffs="1", fields="—",
         duration="—", payment="card", status="finished", highlighted=False),
    dict(name="NightsBridge", badge="Channel handoff · ARS 1.4",
         friction_score="22.9", success_rate="100%", clicks="7", handoffs="1", fields="—",
         duration="—", payment="card", status="finished", highlighted=False),
    dict(name="SiteMinder", badge="Channel handoff · ARS 1.5",
         friction_score="23.1", success_rate="100%", clicks="4.3", handoffs="1", fields="—",
         duration="—", payment="card", status="finished", highlighted=False),
]
exhibits = [
    dict(name="Cloudbeds", badge="agent-blocked at cart (isTrusted guard) · ARS 2.0",
         friction_score="0", success_rate="—", clicks="—", handoffs="—", fields="—",
         duration="—", payment="—", status="excluded", highlighted=False),
    dict(name="OTAs · Booking / Airbnb / Expedia", badge="agent-blocked — bot-walls, login-walls, closed APIs · ARS 0.6–1.8",
         friction_score="0", success_rate="—", clicks="—", handoffs="—", fields="—",
         duration="—", payment="—", status="excluded", highlighted=False),
]

blocks = {}
order = []
for i, b in enumerate(racers + exhibits):
    bid = f"racer-{i+1}"
    blocks[bid] = {"type": "racer", "settings": b}
    order.append(bid)
race["blocks"] = blocks
race["block_order"] = order
# tighten the intro to v2 framing
race.setdefault("settings", {})
race["settings"]["intro"] = (
    "We scripted a real booking — pick dates, choose a room, reach the payment page — and ran it automatically in visible browsers. "
    "The score counts every click, form field, page and domain hand-off between the guest and payment (lower is better), under an empirically-grounded formula. "
    "Plekify is the only on-domain, Shop Pay checkout — every competitor either pays a domain-handoff penalty or blocks the agent before payment."
)
json.dump(d, open(P, "w"), indent=2)
print("Race locked to real v2. Racers:", [b["settings"]["name"] for b in blocks.values()])
print("Numbers:", {s["name"]: s["friction_score"] for s in (racers)})
