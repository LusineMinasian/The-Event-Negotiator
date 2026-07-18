"""Red-Flag Engine (spec 7.3). Segment rules override category rules; benchmark
is taken per-segment, not per-category."""
from __future__ import annotations

from ..config_loader import get_store


def evaluate(quote: dict, category_key: str, segment_key: str,
             segment_benchmark: float | None) -> list[dict]:
    store = get_store()
    category = store.category(category_key)
    segment = store.segment(segment_key)

    rules = {r["rule"]: r for r in category.get("red_flags", [])}
    for r in segment.get("red_flags", []):  # segment overrides
        rules[r["rule"]] = r

    flags: list[dict] = []
    line_items = quote.get("line_items", [])
    terms = quote.get("terms", {})
    normalized = quote.get("normalized_per_unit", 0) or 0
    expected = segment.get("expected_line_items_override") or category.get("expected_line_items", [])

    for rule_key, rule in rules.items():
        sev = rule.get("severity", "medium")
        if rule_key == "below_market_30" and segment_benchmark and normalized:
            threshold = rule.get("threshold", 0.70)
            if normalized < threshold * segment_benchmark:
                flags.append({"rule_key": rule_key, "severity": "high",
                              "detail": f"{normalized:.0f} is {(1 - normalized / segment_benchmark) * 100:.0f}% below the segment median ({segment_benchmark:.0f}) — a warning, not a win"})
        elif rule_key == "deposit_over_50pct":
            if terms.get("deposit_pct", 0) > 50:
                flags.append({"rule_key": rule_key, "severity": sev,
                              "detail": f"Deposit {terms.get('deposit_pct')}% > 50%"})
        elif rule_key == "non_refundable_deposit":
            if terms.get("deposit_pct", 0) > 0 and not terms.get("deposit_refundable_until"):
                flags.append({"rule_key": rule_key, "severity": sev,
                              "detail": "No refund window on the deposit"})
        elif rule_key == "service_charge_undisclosed":
            for li in line_items:
                if li.get("disclosed_voluntarily") is False:
                    flags.append({"rule_key": rule_key, "severity": sev,
                                  "detail": f"{li.get('label')} not disclosed until asked"})
                    break
        elif rule_key == "incomplete_itemization":
            disclosed = {(_root(li.get("label", ""))) for li in line_items}
            covered = sum(1 for e in expected if any(e in d or d in e for d in disclosed))
            if expected and covered / len(expected) < 0.6:
                flags.append({"rule_key": rule_key, "severity": sev,
                              "detail": f"Only {covered}/{len(expected)} expected line items disclosed"})
    return flags


def _root(label: str) -> str:
    return label.lower().split(" ")[0]
