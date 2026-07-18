"""Ranking Engine (spec 7.4). Composite score: price, completeness, risk, reputation.
Price is normalized within a category across collected quotes."""
from __future__ import annotations

import math
from typing import Any

from ..config_loader import get_store

SEVERITY_PENALTY = {"high": 0.5, "medium": 0.25, "low": 0.1}


def rank_quotes(quotes: list[dict], event_key: str) -> list[dict]:
    """quotes: list of dicts with keys total, normalized_per_unit, line_items,
    expected_count, red_flags, rating, review_count, category. Mutates+returns with
    score, score_breakdown, rank (per category)."""
    store = get_store()
    weights = store.event(event_key).get("default_ranking_weights",
                                          {"price": 0.45, "completeness": 0.25, "risk": 0.20, "reputation": 0.10})

    by_cat: dict[str, list[dict]] = {}
    for q in quotes:
        by_cat.setdefault(q["category"], []).append(q)

    for cat, items in by_cat.items():
        units = [q["normalized_per_unit"] for q in items if q.get("normalized_per_unit")]
        min_u, max_u = (min(units), max(units)) if units else (0, 1)
        span = (max_u - min_u) or 1.0
        ratings = [q.get("rating", 0) * math.log1p(q.get("review_count", 0)) for q in items]
        max_rep = max(ratings) or 1.0

        for q in items:
            u = q.get("normalized_per_unit") or max_u
            price_score = 1 - (u - min_u) / span  # cheaper = higher
            completeness = q.get("completeness", 0.5)
            risk_penalty = sum(SEVERITY_PENALTY.get(f["severity"], 0.2) for f in q.get("red_flags", []))
            risk_score = max(0.0, 1 - risk_penalty)
            rep = (q.get("rating", 0) * math.log1p(q.get("review_count", 0))) / max_rep

            score = (weights["price"] * price_score
                     + weights["completeness"] * completeness
                     + weights["risk"] * risk_score
                     + weights["reputation"] * rep)
            q["score"] = round(score, 4)
            q["score_breakdown"] = {
                "price": round(weights["price"] * price_score, 4),
                "completeness": round(weights["completeness"] * completeness, 4),
                "risk": round(weights["risk"] * risk_score, 4),
                "reputation": round(weights["reputation"] * rep, 4),
            }
        items.sort(key=lambda x: -x["score"])
        for i, q in enumerate(items, start=1):
            q["rank"] = i
    return quotes


def completeness_ratio(line_items: list[dict], expected: list[str]) -> float:
    if not expected:
        return 1.0
    disclosed = {li.get("label", "").lower().split(" ")[0] for li in line_items}
    covered = sum(1 for e in expected if any(e in d or d in e for d in disclosed))
    return round(covered / len(expected), 3)
