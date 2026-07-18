from urllib.parse import quote_plus

import httpx
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import current_user
from ..config import settings
from ..config_loader import get_store
from ..db import get_db
from ..models import Campaign, Event, Spec, User, Vendor
from ..services import discovery

router = APIRouter(prefix="/api", tags=["discovery"])


@router.post("/specs/{spec_id}/discover")
async def run_discovery(spec_id: str, target_per_category: int = 4,
                        user: User = Depends(current_user), db: Session = Depends(get_db)):
    spec = db.get(Spec, spec_id)
    if not spec:
        raise HTTPException(404, "Spec not found")
    event = db.get(Event, spec.event_id)
    if not event or event.user_id != user.id:
        raise HTTPException(403, "Not your spec")
    if not spec.confirmed_at:
        raise HTTPException(400, "Confirm the spec before discovery")

    campaign = db.scalar(select(Campaign).where(Campaign.spec_id == spec.id))
    if not campaign:
        campaign = Campaign(spec_id=spec.id, event_id=event.id, status="planning")
        db.add(campaign)
        db.commit()
    else:
        db.query(Vendor).filter(Vendor.campaign_id == campaign.id).delete()
        db.commit()

    payload = spec.payload
    region = payload["location"].get("region_profile", "us_ca")
    city = payload["location"].get("city", "San Francisco")
    categories = [c["key"] for c in payload.get("categories", [])]

    for cat in categories:
        found = await discovery.discover(cat, event.type, region, city, target_per_category)
        for v in found:
            db.add(Vendor(
                campaign_id=campaign.id, source=v.get("source", "seed"),
                external_id=v.get("external_id", ""), name=v["name"], phone_e164=v.get("phone_e164", ""),
                category=cat, segment_key=v["segment_key"], segment_confidence=v["segment_confidence"],
                rating=v.get("rating", 0), review_count=v.get("review_count", 0),
                price_level=v.get("price_level", 2), distance_km=v.get("distance_km", 0),
                enrichment={"true_segment": v.get("true_segment", v["segment_key"]),
                            "alternatives": v.get("segment_alternatives", [])},
            ))
    db.commit()
    return {"campaign_id": campaign.id, "vendors": _vendors(db, campaign.id)}


@router.get("/campaigns/{campaign_id}/vendors")
def list_vendors(campaign_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return {"vendors": _vendors(db, campaign_id)}


@router.patch("/vendors/{vendor_id}")
def patch_vendor(vendor_id: str, body: dict, user: User = Depends(current_user),
                 db: Session = Depends(get_db)):
    v = db.get(Vendor, vendor_id)
    if not v:
        raise HTTPException(404, "Vendor not found")
    if "excluded" in body:
        v.excluded = bool(body["excluded"])
    if "segment_key" in body:
        v.segment_key = body["segment_key"]
    db.commit()
    return {"ok": True}


async def _google_details(external_id: str) -> dict:
    """Best-effort Google Place Details. Empty dict unless a key is set and the vendor
    came from Places (seeded vendors have no external_id)."""
    if not (settings.google_places_api_key and external_id):
        return {}
    fields = ("id,displayName,formattedAddress,websiteUri,googleMapsUri,"
              "internationalPhoneNumber,regularOpeningHours,editorialSummary,photos")
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(
                f"https://places.googleapis.com/v1/places/{external_id}",
                headers={"X-Goog-Api-Key": settings.google_places_api_key, "X-Goog-FieldMask": fields})
            return r.json() if r.status_code == 200 else {}
    except Exception:  # noqa: BLE001 — enrichment is optional, never 500 the card
        return {}


@router.get("/vendors/{vendor_id}/details")
async def vendor_details(vendor_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """A 'place card' for a vendor: what we know + constructed Maps/search/social links,
    enriched with real Google details (website, address, hours, photos) when available."""
    v = db.get(Vendor, vendor_id)
    if not v:
        raise HTTPException(404, "Vendor not found")
    store = get_store()
    seg = store.segment(v.segment_key)
    city = ""
    if v.campaign_id:
        camp = db.get(Campaign, v.campaign_id)
        spec = db.get(Spec, camp.spec_id) if camp else None
        if spec:
            city = (spec.payload.get("location") or {}).get("city", "")
    q = quote_plus(f"{v.name} {city}".strip())
    econ = seg.get("economics", {})
    card = {
        "id": v.id, "name": v.name, "category": v.category,
        "segment_display": seg.get("display_name", v.segment_key),
        "style": (seg.get("counterparty") or {}).get("style"),
        "rating": v.rating, "review_count": v.review_count,
        "price": "$" * max(1, min(4, v.price_level or 2)),
        "phone": v.phone_e164, "distance_km": v.distance_km, "city": city,
        "maps_url": f"https://www.google.com/maps/search/?api=1&query={q}",
        "google_url": f"https://www.google.com/search?q={q}",
        "website": "", "address": "", "opening_hours": [], "photos": [],
        "summary": seg.get("description") or f"{seg.get('display_name', v.segment_key)} · {econ.get('pricing_model', '')}".strip(" ·"),
        "socials": {
            "instagram": f"https://www.google.com/search?q={quote_plus(f'{v.name} {city} instagram')}",
            "facebook": f"https://www.google.com/search?q={quote_plus(f'{v.name} {city} facebook')}",
        },
        "source": v.source, "live": False,
    }
    g = await _google_details(v.external_id)
    if g:
        card["live"] = True
        card["website"] = g.get("websiteUri", "")
        card["address"] = g.get("formattedAddress", "")
        if g.get("googleMapsUri"):
            card["maps_url"] = g["googleMapsUri"]
        if (g.get("editorialSummary") or {}).get("text"):
            card["summary"] = g["editorialSummary"]["text"]
        card["opening_hours"] = (g.get("regularOpeningHours") or {}).get("weekdayDescriptions") or []
        names = [p["name"] for p in (g.get("photos") or [])[:6] if p.get("name")]
        enr = dict(v.enrichment or {}); enr["photo_names"] = names; v.enrichment = enr; db.commit()
        card["photos"] = [f"/api/vendors/{v.id}/photo/{i}" for i in range(len(names))]
    return card


@router.get("/vendors/{vendor_id}/photo/{idx}")
async def vendor_photo(vendor_id: str, idx: int, db: Session = Depends(get_db)):
    """Proxy a Google Places photo so the API key never reaches the browser. Unauthenticated
    because <img> can't send an Authorization header; it only serves a public place photo."""
    v = db.get(Vendor, vendor_id)
    names = ((v.enrichment or {}).get("photo_names") if v else None) or []
    if not settings.google_places_api_key or idx < 0 or idx >= len(names):
        raise HTTPException(404, "No photo")
    url = (f"https://places.googleapis.com/v1/{names[idx]}/media"
           f"?maxHeightPx=600&maxWidthPx=800&key={settings.google_places_api_key}")
    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
        r = await client.get(url)
        if r.status_code != 200:
            raise HTTPException(404, "Photo unavailable")
        return Response(content=r.content, media_type=r.headers.get("content-type", "image/jpeg"))


def _vendors(db: Session, campaign_id: str) -> list[dict]:
    store = get_store()
    vs = db.scalars(select(Vendor).where(Vendor.campaign_id == campaign_id)).all()
    out = []
    for v in vs:
        seg = store.segment(v.segment_key)
        out.append({
            "id": v.id, "name": v.name, "category": v.category, "phone": v.phone_e164,
            "segment_key": v.segment_key, "segment_display": seg.get("display_name", v.segment_key),
            "segment_confidence": v.segment_confidence, "rating": v.rating,
            "review_count": v.review_count, "price_level": v.price_level,
            "distance_km": v.distance_km, "excluded": v.excluded,
            "style": (seg.get("counterparty") or {}).get("style"),
        })
    return sorted(out, key=lambda x: (x["category"], -x["rating"]))
