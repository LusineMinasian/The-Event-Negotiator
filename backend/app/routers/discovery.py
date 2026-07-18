from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import current_user
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
