"""Counterparty simulation (spec section 6.3). Five styles emerge from segment
config, not from hardcoded scripts. Prices move as a deterministic FUNCTION of the
levers the agent applies — never because a script said so. This is what keeps the
demo honest (challenge brief: "prices move because of what your agent knows and says").
"""
from __future__ import annotations

import hashlib

from ..config_loader import get_store

DEFAULT_HOURS = 3


def _jitter(seed: str, spread: float = 0.12) -> float:
    h = int(hashlib.sha256(seed.encode()).hexdigest()[:8], 16)
    return 1 + ((h % 1000) / 1000 - 0.5) * 2 * spread


def fair_price(category: str, segment_key: str, benchmark_key: str, spec_payload: dict,
               region_key: str, vendor_name: str, price_level: int) -> float:
    store = get_store()
    cat = store.category(category)
    unit = cat.get("normalization_unit", "per_event")
    median, _ = store.benchmark(benchmark_key.replace("{region_profile}", region_key), unit)
    if median is None:
        median = 1000.0
    guests = spec_payload.get("event", {}).get("guest_count", 25)
    if unit == "per_guest":
        base = median * guests
    elif unit == "per_hour":
        base = median * DEFAULT_HOURS
    else:
        base = median
    price_factor = {1: 0.85, 2: 1.0, 3: 1.15, 4: 1.35}.get(price_level, 1.0)
    return round(base * price_factor * _jitter(vendor_name), 0)


class Counterparty:
    """Holds negotiation state for one vendor on one call."""

    def __init__(self, vendor: dict, resolved: dict, spec_payload: dict, region_key: str):
        self.vendor = vendor
        self.resolved = resolved
        self.spec = spec_payload
        self.region_key = region_key
        seg = get_store().segment(vendor["true_segment"])
        self.segment_cfg = seg
        self.style = (seg.get("counterparty") or {}).get("style", "warm")
        self.hidden_fees = list((seg.get("counterparty") or {}).get("hidden_fees", []))
        rp = seg.get("resistance_profile", {})
        self.markup = rp.get("opening_markup_expected", 0.15)
        self.ceiling = rp.get("typical_concession_ceiling", 0.12)
        self.hard_floor_signal = rp.get("hard_floor_signal", "cost")

        self.fair = fair_price(resolved["category_key"], vendor["true_segment"],
                               seg.get("benchmark_key", ""), spec_payload, region_key,
                               vendor["name"], vendor.get("price_level", 2))
        self.opening_total = round(self.fair * (1 + self.markup), 0)
        self.floor = round(self.opening_total * (1 - self.ceiling), 0)
        self.max_conc = self.opening_total - self.floor
        self.conceded = 0.0
        self.current = self.opening_total
        self.fees_revealed = False
        self.price_given = False
        self.stonewall_pushes = 0

    # ---- primary item label per category ----
    def primary_label(self) -> str:
        return {
            "catering": "Food & service",
            "venue": "Venue rental",
            "decor": "Decor package",
            "photo": "Coverage",
            "music": "Performance",
        }.get(self.resolved["category_key"], "Base package")

    def base_line_items(self) -> list[dict]:
        unit = self.resolved["normalization_unit"]
        return [{"label": self.primary_label(), "amount": self.current, "unit": unit,
                 "included": True}]

    def reveal_fees(self) -> list[dict]:
        """Called when the agent challenges fees or asks directly. Returns the
        newly-revealed hidden line items."""
        if self.fees_revealed:
            return []
        self.fees_revealed = True
        revealed = []
        subtotal = self.current
        for f in self.hidden_fees:
            if "amount_pct" in f:
                amt = round(subtotal * f["amount_pct"], 0)
            else:
                amt = f.get("amount", 0)
            revealed.append({"label": f["label"], "amount": amt, "unit": f.get("unit", "per_event"),
                             "included": True, "disclosed_voluntarily": f.get("disclosed_voluntarily", True)})
        return revealed

    def apply_lever(self, lever: dict) -> float:
        """Return the concession amount (>=0) unlocked by this lever."""
        # stonewaller / hard resist the first lever more
        resistance = {"stonewaller": 0.5, "hard": 0.7, "upseller": 0.8,
                      "warm": 1.0, "lowballer": 0.4, "flexible": 1.1}.get(self.style, 1.0)
        effect = lever.get("weight", 0.5) * lever.get("unlock", 0.4) * resistance
        remaining = self.max_conc - self.conceded
        concession = round(min(remaining, effect * remaining), 0)
        if concession < 5:
            return 0.0
        self.conceded += concession
        self.current = round(self.current - concession, 0)
        return concession

    def opening_line(self) -> str:
        s = self.style
        if s == "stonewaller":
            return "Honestly we don't really quote over the phone — you'd want to come in for a viewing. I can email you a form."
        if s == "upseller":
            return f"Sure! Most clients go with our premium package. For your date I'd say around {_m(self.opening_total)}, and it's stunning."
        if s == "lowballer":
            return f"Yeah easy, we can do that for about {_m(self.opening_total)}. Real simple."
        if s == "hard":
            return f"Our rate for that is {_m(self.opening_total)}. That's pretty firm, we book out fast."
        if s == "flexible":
            return f"Let me see... for something like that I'd start around {_m(self.opening_total)}, but it depends."
        return f"Happy to help — for {self.spec.get('event', {}).get('guest_count', 25)} guests we'd be around {_m(self.opening_total)}."

    def stonewall_response(self) -> str:
        self.stonewall_pushes += 1
        if self.stonewall_pushes == 1:
            return "Like I said, it really depends on the day. Prices aren't something I give out over the phone."
        if self.stonewall_pushes == 2:
            return f"...I suppose for a weekday daytime it could start somewhere around {_m(self.opening_total)}. But that's rough."
        return f"Okay, let me be straight — {_m(self.current)}, and I can't really go under {self.hard_floor_signal}."

    def concede_line(self, concession: float) -> str:
        if concession <= 0:
            return f"I hear you, but I really can't move much — we're close to {self.hard_floor_signal}."
        return f"Alright... for that I could bring it to {_m(self.current)}."

    def fee_reveal_line(self, revealed: list[dict]) -> str:
        if not revealed:
            return "No, that's everything — nothing else on top."
        labels = ", ".join(f"{r['label']} ({_m(r['amount'])})" for r in revealed)
        return f"Oh — right, there's also {labels}. That's separate."


def _m(amount: float) -> str:
    return f"${amount:,.0f}"
