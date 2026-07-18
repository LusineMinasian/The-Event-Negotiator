"""Segment Classifier (spec section 14). Pre-call classification from Places-like
signals, plus in-call reclassification."""
from __future__ import annotations

from typing import Any

from ..config_loader import get_store

SIGNAL_WEIGHTS = {"places_type": 0.35, "price_level": 0.25, "review_count": 0.25, "name": 0.15}


def classify(category_key: str, event_key: str, signals: dict[str, Any]) -> dict:
    """signals: {places_type, price_level, review_count, name}"""
    store = get_store()
    category = store.category(category_key)
    candidate_segments = {
        s["key"] for s in store.segments_for(category_key, event_key)
    }
    scores: dict[str, float] = {k: 0.0 for k in candidate_segments}

    for rule in category.get("segment_classifier_signals", []):
        sig = rule["signal"]
        weight = SIGNAL_WEIGHTS.get(sig, 0.1)
        val = signals.get(sig)
        if val is None:
            continue
        maps = rule.get("maps", {})
        thresholds = rule.get("thresholds", {})
        if maps and str(val) in maps:
            target = maps[str(val)]
            if target in scores:
                scores[target] += weight
        for cond, target in thresholds.items():
            if target not in scores:
                continue
            if cond.startswith("<") and _num(val) is not None and _num(val) < float(cond[1:]):
                scores[target] += weight
            elif cond.lstrip("-").isdigit() and str(val) == cond:
                scores[target] += weight

    # name heuristic
    name = (signals.get("name") or "").lower()
    if any(w in name for w in ["studio", "agency", "co.", "group", "catering co"]):
        for k in scores:
            if k.endswith(("studio_team", "full_service", "agency")):
                scores[k] += SIGNAL_WEIGHTS["name"]

    if not scores or max(scores.values()) == 0:
        # fallback: first candidate
        default = next(iter(candidate_segments), "")
        return {"segment_key": default, "confidence": 0.4, "alternatives": []}

    total = sum(scores.values()) or 1.0
    ranked = sorted(scores.items(), key=lambda kv: -kv[1])
    top_key, top_score = ranked[0]
    confidence = round(min(0.95, top_score / total + 0.15), 2)
    alternatives = [
        {"segment_key": k, "confidence": round(v / total, 2)} for k, v in ranked[1:3] if v > 0
    ]
    return {"segment_key": top_key, "confidence": confidence, "alternatives": alternatives}


def reclassify(target_segment_key: str) -> dict:
    """In-call reclassification to a revealed segment (spec 14.3)."""
    store = get_store()
    seg = store.segment(target_segment_key)
    return {
        "new_segment_key": target_segment_key,
        "confidence": 0.9,
        "segment_display": seg.get("display_name", target_segment_key),
        "strategy_change_note": f"Reclassified to {seg.get('display_name', target_segment_key)} on observed signal",
    }


def _num(v: Any) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None
