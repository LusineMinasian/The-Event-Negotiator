"""End-to-end smoke test of the whole loop, no HTTP server needed.
Run: ./.venv/bin/python smoke_test.py
"""
import asyncio

from app.db import SessionLocal, init_db
from app.models import Call, Campaign, Quote, User
from app.auth import hash_password
from app.services import spec_builder, discovery, caller
from app.models import Event, Spec, Vendor
from sqlalchemy import select


async def main():
    init_db()
    db = SessionLocal()

    # 1) user + event + spec
    user = User(email="demo@test.com", name="Demo", password_hash=hash_password("x"))
    db.add(user); db.commit()
    event = Event(user_id=user.id, type="baby_shower", region_profile="us_ca", status="draft")
    db.add(event); db.commit()
    payload = spec_builder.default_payload("baby_shower", "us_ca")
    payload["spec_hash"] = spec_builder.compute_hash(payload)
    spec = Spec(event_id=event.id, version=1, payload=payload, spec_hash=payload["spec_hash"],
                theme_tokens=payload["style"]["theme_tokens"])
    from datetime import datetime, timezone
    spec.confirmed_at = datetime.now(timezone.utc)
    db.add(spec); db.commit()
    print("spec_hash:", spec.spec_hash)
    print("categories:", [c["key"] for c in payload["categories"]])

    # 2) campaign + discovery
    campaign = Campaign(spec_id=spec.id, event_id=event.id, status="planning")
    db.add(campaign); db.commit()
    for cat in [c["key"] for c in payload["categories"]]:
        found = await discovery.discover(cat, "baby_shower", "us_ca", "San Francisco", 4)
        print(f"  {cat}: {[ (v['name'], v['segment_key'], round(v['segment_confidence'],2)) for v in found ]}")
        for v in found:
            db.add(Vendor(campaign_id=campaign.id, name=v["name"], phone_e164=v.get("phone_e164",""),
                          category=cat, segment_key=v["segment_key"], segment_confidence=v["segment_confidence"],
                          rating=v.get("rating",0), review_count=v.get("review_count",0),
                          price_level=v.get("price_level",2), distance_km=v.get("distance_km",0),
                          enrichment={"true_segment": v.get("true_segment", v["segment_key"])}))
    db.commit()
    cid = campaign.id
    db.close()

    # 3) run the campaign (fast — patch STEP)
    caller.STEP = 0.001
    await caller.run_campaign(cid)

    # 4) inspect results
    db = SessionLocal()
    calls = db.scalars(select(Call).where(Call.campaign_id == cid)).all()
    quotes = db.scalars(select(Quote).where(Quote.campaign_id == cid)).all()
    print(f"\nCALLS: {len(calls)}")
    for c in calls:
        print(f"  {c.category:9} {c.outcome:11} start={c.segment_key_at_start} final={c.segment_key_final}")
    print(f"\nQUOTES: {len(quotes)}")
    moved = 0
    for q in quotes:
        d = q.negotiation.get("delta_pct", 0)
        if d < 0: moved += 1
        print(f"  {q.category:9} open={q.opening_total:>7.0f} final={q.total:>7.0f} delta={d:>5}% rank={q.rank} levers={[l['display'] for l in q.negotiation.get('leverage_used',[])]}")
    print(f"\nQuotes with downward price movement: {moved}")
    from app.models import PriceEvent, RedFlag
    pes = db.scalars(select(PriceEvent)).all()
    rfs = db.scalars(select(RedFlag)).all()
    print(f"Price events: {len(pes)} | Red flags: {len(rfs)}")
    for f in rfs:
        print(f"  RED FLAG [{f.severity}] {f.rule_key}: {f.detail}")
    db.close()


if __name__ == "__main__":
    asyncio.run(main())
