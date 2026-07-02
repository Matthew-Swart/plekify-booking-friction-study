#!/usr/bin/env python3
"""Add the ARS chart section to the live index.json (after the race section),
fix the stale race heading, and register the Shopify-UCP citation. Run on server."""
import json, os, time

P = "/var/www/plekify/horizon-v4-fresh/store_overrides/travel_2022/templates/index.json"
REG = "/var/www/plekify/horizon-v4-fresh/snippets/plekify-citation-registry.liquid"
os.system(f"cp {P} {P}.bak.{int(time.time())}")
os.system(f"cp {REG} {REG}.bak.{int(time.time())}")

# 1. Register Shopify-UCP citation marker (official dev docs)
reg = open(REG).read()
if "Shopify-UCP|||" not in reg:
    marker = ("Shopify-UCP|||Shopify Universal Commerce Protocol (UCP) — open agent-commerce standard|||"
              "shopify.dev · 2026|||https://shopify.dev/docs/agents|||"
              "Open protocol co-developed with Google; a live /.well-known/ucp manifest exposes catalog, "
              "cart and checkout to autonomous agents.\\n")
    reg = reg.replace("{%- endcapture -%}", marker + "{%- endcapture -%}", 1)
    open(REG, "w").write(reg)
    print("added Shopify-UCP citation marker")
else:
    print("Shopify-UCP marker already present")

# 2. Patch index.json
d = json.load(open(P))
sections = d.setdefault("sections", {})
order = d.setdefault("order", [])

# fix stale race heading
race_id = None
for sid, s in sections.items():
    if s.get("type") == "plekify-v10-race":
        race_id = sid
        s["settings"]["heading"] = "Plekify had the lowest booking friction of every engine we tested."
        break

# build ARS chart section with the 12 systems (v2 residential ARS)
systems = [
    ("Plekify", "3.0", True), ("Cloudbeds", "2.0", False), ("Mews", "1.9", False),
    ("Booking.com", "1.8", False), ("Stayntouch", "1.6", False), ("SiteMinder", "1.5", False),
    ("RoomRaccoon", "1.4", False), ("Travelstart", "1.4", False), ("NightsBridge", "1.35", False),
    ("Airbnb", "1.25", False), ("OPERA-ecosystem", "1.2", False), ("Expedia", "0.6", False),
]
blocks = {}
block_order = []
for i, (name, ars, hl) in enumerate(systems):
    bid = f"ars-{i+1}"
    blocks[bid] = {"type": "system", "settings": {"name": name, "ars": ars, "note": "", "highlighted": hl}}
    block_order.append(bid)

ars_id = "plekify-v10-ars-chart-1"
i = 1
while ars_id in sections:
    i += 1
    ars_id = f"plekify-v10-ars-chart-{i}"
sections[ars_id] = {
    "type": "plekify-v10-ars-chart",
    "settings": {},
    "blocks": blocks,
    "block_order": block_order,
}

# insert into order right after the race section
if race_id and race_id in order:
    if ars_id not in order:
        idx = order.index(race_id)
        order.insert(idx + 1, ars_id)
elif ars_id not in order:
    order.append(ars_id)

json.dump(d, open(P, "w"), indent=2)
print(f"inserted ARS chart section '{ars_id}' after race '{race_id}'; heading fixed")
print("order:", [s for s in order if 'race' in s or 'ars' in s])
