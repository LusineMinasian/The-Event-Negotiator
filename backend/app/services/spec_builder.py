"""Builds and freezes the single structured job spec (spec section 4). Voice intake
and document intake both write into this same shape."""
from __future__ import annotations

import hashlib
import json
from datetime import date, timedelta

from ..config_loader import get_store
from ..engines import palette


def default_payload(event_type: str, region_profile: str) -> dict:
    store = get_store()
    ev = store.event(event_type)
    region = store.region(region_profile)
    guest_default = int(sum(ev.get("typical_guest_range", [25, 25])) / 2)
    horizon = ev.get("planning_horizon_days", [30, 30])[0]
    event_date = (date.today() + timedelta(days=horizon)).isoformat()
    cats = ev.get("required_categories", []) + ev.get("optional_categories", [])
    alloc = _default_allocation(cats)
    return {
        "spec_hash": "",
        "version": 1,
        "event": {"type": event_type, "date": event_date, "date_flexibility": "weekday_ok",
                  "time_window": {"start": "14:00", "duration_h": 4},
                  "guest_count": guest_default},
        "location": {"city": "San Francisco", "country": (region.get("countries") or ["US"])[0],
                     "region_profile": region_profile, "search_radius_km": 20},
        "budget": {"currency": region.get("currency", "USD"),
                   "total_ceiling": _default_budget(event_type, guest_default),
                   "allocation": alloc, "hard_ceiling": True},
        "style": {"source": "default", "palette": palette.default_palette(event_type),
                  "density": "abundant", "keywords": [],
                  "theme_tokens": palette.generate_theme_tokens(palette.default_palette(event_type))},
        "categories": [_default_category(c, event_type, guest_default) for c in cats],
        "constraints": {"must_have": [], "deal_breakers": ["deposit_over_50pct"]},
        "provenance": {"voice_fields": [], "document_fields": []},
    }


def _default_allocation(cats: list[str]) -> dict:
    base = {"venue": 0.30, "catering": 0.30, "decor": 0.12, "photo": 0.08, "music": 0.05, "flowers": 0.10, "beauty": 0.05}
    alloc = {c: base.get(c, 0.1) for c in cats}
    total = sum(alloc.values()) or 1
    return {c: round(v / total, 2) for c, v in alloc.items()}


def _default_budget(event_type: str, guests: int) -> int:
    per_guest = {"wedding": 400, "birthday": 120, "baby_shower": 150}.get(event_type, 150)
    return int(round(per_guest * guests / 100.0)) * 100


def _default_category(cat: str, event_type: str, guests: int) -> dict:
    store = get_store()
    segs = store.segments_for(cat, event_type)
    # suggest segment preferences: exclude segments whose guest range excludes our count
    preferred, excluded, reason = [], [], ""
    for s in segs:
        lo, hi = (s.get("guest_range") or [0, 9999])
        if guests < lo:
            excluded.append(s["key"])
            if not reason:
                reason = f"{guests} guests is below the threshold for {s.get('display_name', s['key'])}"
        else:
            preferred.append(s["key"])
    return {"key": cat, "required": True, "attributes": {},
            "segment_preferences": {"preferred": preferred[:3], "excluded": excluded, "reason": reason}}


def compute_hash(payload: dict) -> str:
    core = {k: v for k, v in payload.items() if k != "spec_hash"}
    raw = json.dumps(core, sort_keys=True, ensure_ascii=False).encode()
    return "sha256:" + hashlib.sha256(raw).hexdigest()[:16]
