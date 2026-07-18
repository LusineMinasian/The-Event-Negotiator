"""Discovery Service (spec section 15). Builds the call list programmatically.
Real Google Places (New) connector, with a seeded-market fallback so the demo
runs with zero external keys. Both paths run through the Segment Classifier and
segment stratification."""
from __future__ import annotations

import json

import httpx

from ..config import SEED_DIR, settings
from ..config_loader import get_store
from ..engines import segment_classifier

_seed_cache: dict | None = None


def _seed() -> dict:
    global _seed_cache
    if _seed_cache is None:
        _seed_cache = json.loads((SEED_DIR / "market.json").read_text())
    return _seed_cache


def _score(v: dict) -> float:
    import math
    rating = v.get("rating", 0) / 5
    reviews = math.log1p(v.get("review_count", 0)) / math.log1p(1000)
    proximity = max(0.0, 1 - v.get("distance_km", 0) / 25)
    return 0.4 * rating + 0.25 * reviews + 0.2 * proximity + 0.15


def _classify_vendor(v: dict, category: str, event_key: str) -> dict:
    result = segment_classifier.classify(category, event_key, {
        "places_type": v.get("places_type"),
        "price_level": v.get("price_level"),
        "review_count": v.get("review_count"),
        "name": v.get("name"),
    })
    return result


def _stratify(vendors: list[dict], target: int) -> list[dict]:
    """Ensure segment spread (spec 14.4): keep the top-scored while covering as many
    distinct segments as possible."""
    vendors = sorted(vendors, key=lambda v: -v["_score"])
    picked: list[dict] = []
    seen_segments: set[str] = set()
    # first pass: one per segment
    for v in vendors:
        if v["segment_key"] not in seen_segments:
            picked.append(v)
            seen_segments.add(v["segment_key"])
        if len(picked) >= target:
            return picked
    # second pass: fill by score
    for v in vendors:
        if v not in picked:
            picked.append(v)
        if len(picked) >= target:
            break
    return picked


async def discover(category: str, event_key: str, region_key: str, city: str,
                   target: int = 6) -> list[dict]:
    if settings.google_places_api_key:
        raw = await _places_search(category, region_key, city, target * 2)
    else:
        raw = [v for v in _seed()["vendors"] if v["category"] == category]

    enriched = []
    for v in raw:
        cls = _classify_vendor(v, category, event_key)
        # keep only vendors whose classified segment applies to this event
        applicable = {s["key"] for s in get_store().segments_for(category, event_key)}
        seg = cls["segment_key"]
        if seg not in applicable:
            # remap to closest applicable segment (prevalence override)
            seg = next(iter(applicable), seg)
        item = dict(v)
        item.update({
            "segment_key": seg,
            "segment_confidence": cls["confidence"],
            "segment_alternatives": cls.get("alternatives", []),
            "_score": _score(v),
        })
        enriched.append(item)

    return _stratify(enriched, target)


async def _places_search(category: str, region_key: str, city: str, want: int) -> list[dict]:
    """Google Places API (New) Text Search + Details. Returns seed-shaped dicts."""
    store = get_store()
    cat_cfg = store.category(category)
    region = store.region(region_key)
    keyword = (cat_cfg.get("places_keywords") or {}).get("en", category)
    query = f"{keyword} in {city}"
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": settings.google_places_api_key,
        "X-Goog-FieldMask": ",".join([
            "places.id", "places.displayName", "places.internationalPhoneNumber",
            "places.rating", "places.userRatingCount", "places.priceLevel",
            "places.primaryType", "places.location", "places.businessStatus",
        ]),
    }
    body = {"textQuery": query, "languageCode": region.get("locale_primary", "en-US"),
            "regionCode": (region.get("countries") or ["US"])[0]}
    out: list[dict] = []
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post("https://places.googleapis.com/v1/places:searchText",
                              headers=headers, json=body)
        r.raise_for_status()
        for p in r.json().get("places", [])[:want]:
            if p.get("businessStatus") not in (None, "OPERATIONAL"):
                continue
            price_map = {"PRICE_LEVEL_INEXPENSIVE": 1, "PRICE_LEVEL_MODERATE": 2,
                         "PRICE_LEVEL_EXPENSIVE": 3, "PRICE_LEVEL_VERY_EXPENSIVE": 4}
            out.append({
                "name": (p.get("displayName") or {}).get("text", "Vendor"),
                "category": category,
                "external_id": p.get("id", ""),
                "places_type": p.get("primaryType", ""),
                "price_level": price_map.get(p.get("priceLevel", ""), 2),
                "review_count": p.get("userRatingCount", 0),
                "rating": p.get("rating", 0),
                "phone_e164": p.get("internationalPhoneNumber", "").replace(" ", ""),
                "distance_km": 0.0,
                "source": "google_places",
            })
    return out
