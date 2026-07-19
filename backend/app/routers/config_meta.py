"""Config surface for S1/S9/S10 — lets the UI show the config layer and the segment
matrix, and hot-reload it (spec 8.7)."""
from fastapi import APIRouter
from pydantic import BaseModel

from ..config import settings
from ..config_loader import get_store
from ..services import agent_overrides

router = APIRouter(prefix="/api/config", tags=["config"])


class BehaviorIn(BaseModel):
    prioritized: list[str] = []
    muted: list[str] = []


@router.get("/meta")
def meta():
    store = get_store()
    return {
        "events": [{"key": e["key"], "display_name": e.get("display_name", e["key"]),
                    "required_categories": e.get("required_categories", []),
                    "optional_categories": e.get("optional_categories", []),
                    "typical_guest_range": e.get("typical_guest_range", [])}
                   for e in store.events.values()],
        "regions": [{"key": r["key"], "currency": r.get("currency"),
                     "currency_symbol": r.get("currency_symbol"), "countries": r.get("countries", [])}
                    for r in store.regions.values()],
        "call_mode": settings.call_mode,
        "live_calls_available": settings.live_calls_available,
    }


@router.get("/segments")
def segments(category: str | None = None, event: str | None = None):
    store = get_store()
    out = []
    for seg in store.segments.values():
        if category and seg.get("parent_category") != category:
            continue
        if event and event not in seg.get("applicable_events", []):
            continue
        econ = seg.get("economics", {})
        rp = seg.get("resistance_profile", {})
        out.append({
            "key": seg["key"], "display_name": seg.get("display_name", seg["key"]),
            "parent_category": seg.get("parent_category"),
            "applicable_events": seg.get("applicable_events", []),
            "pricing_model": econ.get("pricing_model"),
            "decision_maker": econ.get("decision_maker"),
            "capacity_perishable": econ.get("capacity_perishable"),
            "min_order_exists": econ.get("min_order_exists"),
            "levers": seg.get("levers", []),
            "levers_harmful": seg.get("levers_harmful", []),
            "resistance_profile": rp,
            "style": (seg.get("counterparty") or {}).get("style"),
        })
    return {"segments": out}


@router.get("/segments/{segment_key}/behavior")
def get_behavior(segment_key: str):
    return agent_overrides.get(segment_key) or {"prioritized": [], "muted": []}


@router.post("/segments/{segment_key}/behavior")
def set_behavior(segment_key: str, body: BehaviorIn):
    return agent_overrides.set_override(segment_key, body.prioritized, body.muted)


@router.delete("/segments/{segment_key}/behavior")
def clear_behavior(segment_key: str):
    agent_overrides.clear(segment_key)
    return {"prioritized": [], "muted": []}


@router.get("/event/{event_key}")
def event_config(event_key: str):
    store = get_store()
    return store.event(event_key)


@router.post("/reload")
def reload():
    get_store().reload()
    return {"status": "reloaded"}
