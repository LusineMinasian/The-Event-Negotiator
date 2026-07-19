"""Leverage Engine (spec sections 7.1 / 8.6 / 19.1).

Resolves the four config levels into a lever set for one vendor, then returns
ONLY verified, segment-weighted levers with ready-to-say phrases. Harmful levers
are a hard exclusion and are never overridden downward.
"""
from __future__ import annotations

from datetime import date
from typing import Any

from ..config_loader import get_store


def _fmt_money(amount: float, currency_symbol: str) -> str:
    return f"{currency_symbol}{amount:,.0f}".replace(",", ",")


def resolve_config(event_key: str, category_key: str, segment_key: str) -> dict[str, Any]:
    """Merge event -> category -> segment with the spec's conflict rules."""
    store = get_store()
    event = store.event(event_key)
    category = store.category(category_key)
    segment = store.segment(segment_key)

    # levers: union, weight from most specific level (segment > event base)
    levers: dict[str, float] = {}
    for lk in event.get("base_levers", []):
        levers.setdefault(lk, 0.5)
    for lv in segment.get("levers", []):
        levers[lv["key"]] = lv.get("weight", 0.5)

    # harmful: union across all levels, never overridden
    harmful: dict[str, str] = {}
    for h in event.get("base_levers_harmful", []):
        harmful[h["key"]] = h.get("reason", "")
    for h in segment.get("levers_harmful", []):
        harmful[h["key"]] = h.get("reason", "")

    # a harmful lever is removed from the available set entirely
    for hk in harmful:
        levers.pop(hk, None)

    # user behavior override (set from the UI): mute levers, or push some first.
    # imported locally to avoid an engines<->services import cycle.
    from ..services import agent_overrides
    ov = agent_overrides.get(segment_key)
    if ov:
        for mk in ov.get("muted", []):
            if len(levers) > 1:  # never leave the agent with nothing to push
                levers.pop(mk, None)
        top = max(levers.values(), default=0.5)
        for i, pk in enumerate(ov.get("prioritized", [])):
            if pk in levers:  # bump above everything, preserving the user's order
                levers[pk] = top + 1.0 - i * 0.001

    # objectives: concat + dedup
    objectives = list(category.get("call_objectives", []))
    for o in segment.get("objectives_override", []):
        if o not in objectives:
            objectives.append(o)

    expected = segment.get("expected_line_items_override") or category.get("expected_line_items", [])

    return {
        "event_key": event_key,
        "category_key": category_key,
        "segment_key": segment_key,
        "segment_display": segment.get("display_name", segment_key),
        "levers": levers,
        "harmful": harmful,
        "objectives": objectives,
        "expected_line_items": expected,
        "challengeable_fees": category.get("challengeable_fees", []),
        "economics": segment.get("economics", {}),
        "resistance_profile": segment.get("resistance_profile", {}),
        "benchmark_key": segment.get("benchmark_key", f"{category_key}_{segment_key}"),
        "normalization_unit": category.get("normalization_unit", "per_event"),
    }


def _applicable(cond: str | None, ctx: dict) -> bool:
    if not cond:
        return True
    if cond == "has_verified_competitor":
        return bool(ctx.get("competitor_quotes"))
    if cond == "date_flexible":
        return ctx.get("date_flexibility", "flexible") != "strict"
    if cond == "off_season":
        return ctx.get("off_season", False)
    if cond == "order_above_min":
        return ctx.get("order_total", 0) > ctx.get("min_order_value", 0)
    if cond == "short_horizon":
        return ctx.get("horizon_days", 999) <= 30
    if cond == "decision_maker_employee":
        return ctx.get("decision_maker") == "employee"
    if cond.startswith("order_total >"):  # e.g. free_delivery_threshold
        return ctx.get("order_total", 0) > ctx.get("free_delivery_threshold", 0)
    return True


def build_context(spec_payload: dict, region_key: str, segment_cfg: dict,
                  competitor_quotes: list[dict], order_total: float) -> dict:
    store = get_store()
    region = store.region(region_key)
    econ = segment_cfg.get("economics", {})
    event = spec_payload.get("event", {})
    ev_date = event.get("date")
    off_season = False
    horizon_days = 999
    if ev_date:
        try:
            d = date.fromisoformat(ev_date)
            off_season = d.month in region.get("off_season_months", [])
            horizon_days = max((d - date.today()).days, 0)
        except ValueError:
            pass
    return {
        "competitor_quotes": competitor_quotes,
        "date_flexibility": event.get("date_flexibility", "flexible"),
        "off_season": off_season,
        "horizon_days": horizon_days,
        "order_total": order_total,
        "min_order_value": econ.get("min_order_value", 0),
        "free_delivery_threshold": region.get("free_delivery_threshold", 99999),
        "decision_maker": econ.get("decision_maker", "owner"),
    }


def get_verified_leverage(event_key: str, category_key: str, segment_key: str,
                          spec_payload: dict, region_key: str,
                          competitor_quotes: list[dict], order_total: float) -> dict:
    """The only legal source of numbers the agent may cite (spec 19.1 / 23.2)."""
    store = get_store()
    resolved = resolve_config(event_key, category_key, segment_key)
    segment_cfg = store.segment(segment_key)
    region = store.region(region_key)
    symbol = region.get("currency_symbol", "$")
    ctx = build_context(spec_payload, region_key, segment_cfg, competitor_quotes, order_total)

    # per-lever applicable_if can live on the segment lever entry or in the catalog
    seg_lever_conds = {lv["key"]: lv.get("applicable_if") for lv in segment_cfg.get("levers", [])}

    day = "Thursday"
    best_competitor = min(competitor_quotes, key=lambda q: q["total"]) if competitor_quotes else None

    levers_out = []
    for key, weight in sorted(resolved["levers"].items(), key=lambda kv: -kv[1]):
        catalog = store.levers.get(key, {})
        cond = seg_lever_conds.get(key) or catalog.get("applicable_if")
        if not _applicable(cond, ctx):
            continue
        phrase = catalog.get("phrase", "")
        if best_competitor and "{amount}" in phrase:
            phrase = phrase.replace("{amount}", _fmt_money(best_competitor["total"], symbol))
        phrase = phrase.replace("{day}", day)
        levers_out.append({
            "key": key,
            "display": catalog.get("display", key),
            "weight": round(weight, 2),
            "unlock": catalog.get("unlock", 0.4),
            "phrase": phrase,
            "source_quote_id": best_competitor["quote_id"] if (best_competitor and key in ("competing_bid", "price_match")) else None,
        })

    unit = resolved["normalization_unit"]
    median, source = store.benchmark(resolved["benchmark_key"].replace("{region_profile}", region_key), unit)

    return {
        "levers": levers_out,
        "harmful_topics": [{"key": k, "reason": v} for k, v in resolved["harmful"].items()],
        "benchmark": {"median": median, "source": source, "unit": unit, "segment_key": segment_key},
        "concession_ceiling": resolved["resistance_profile"].get("typical_concession_ceiling", 0.12),
        "objectives": resolved["objectives"],
        "expected_line_items": resolved["expected_line_items"],
    }
