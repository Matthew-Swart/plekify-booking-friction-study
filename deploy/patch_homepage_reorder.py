#!/usr/bin/env python3
"""Homepage reorder (doc 52 + founder steer 2026-07-02):
 - Travel-search App Extension demo: move UP (after the friction + ARS proof).
 - WETU 'See it work' section: move DOWN (less prominent; before founder).
 - Soften the WETU section heading (doc 52: WETU is a backend content partner, de-emphasised).
Pay-note (test card) stays adjacent to the demo-stores section."""
import json, os, time

P = "/var/www/plekify/horizon-v4-fresh/store_overrides/travel_2022/templates/index.json"
os.system(f"cp {P} {P}.bak.{int(time.time())}")
d = json.load(open(P))

# New narrative order: hero -> bridge -> friction proof -> agent-readiness proof ->
# travel-search (live booking demo, MOVED UP) -> why-shopify -> dual-checkout ->
# pms-open -> see-it-book (demo stores + content, MOVED DOWN) -> pay-note (test card) ->
# founder -> pricing -> talk-to-us
new_order = [
    "cache_bust", "homepage_router", "v10-hero", "v10-bridge-rev",
    "v10-race", "plekify-v10-ars-chart-1", "v10-travel-search",
    "v10-why-shopify", "v10-dual-checkout", "v10-pms-open-v15",
    "v10-see-it-book", "v10-pay-note",
    "v10-founder3", "v10-pricing", "v10-talk-to-us",
]
present = set(d.get("order", []))
ordered = [s for s in new_order if s in present] + [s for s in d.get("order", []) if s not in new_order]
d["order"] = ordered

# Soften WETU section heading (doc 52 §0.3: WETU is a backend content partner, de-emphasised)
sib = d["sections"].get("v10-see-it-book", {})
if sib:
    sib.setdefault("settings", {})
    sib["settings"]["heading"] = "See it work — live, bookable Shopify storefronts."
    sib["settings"]["eyebrow"] = "Demo stores"

json.dump(d, open(P, "w"), indent=2)
print("REORDERED. New order:")
for s in ordered:
    print("  ", s, "->", d["sections"].get(s, {}).get("type", "?"))
