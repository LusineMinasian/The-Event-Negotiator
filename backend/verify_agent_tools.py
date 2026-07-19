"""Drive every /api/agent-tools endpoint in-process against a real seeded campaign,
watching the event bus to confirm each tool lights up the dashboard. No HTTP server.
Run: ./.venv/bin/python verify_agent_tools.py
"""
import asyncio
import os

os.environ["AGENT_TOOLS_SECRET"] = "test-secret-123"  # exercise the auth gate

import httpx
from httpx import ASGITransport

from app.db import SessionLocal, init_db
from app.main import app
from app.models import Call, Campaign, Event, Spec, User, Vendor
from app.auth import hash_password
from app.services import spec_builder
from app.services.event_bus import bus

AUTH = {"Authorization": "Bearer test-secret-123"}


async def main():
    init_db()
    db = SessionLocal()
    user = User(email="atools@test.com", name="A", password_hash=hash_password("x"))
    db.add(user); db.commit()
    event = Event(user_id=user.id, type="baby_shower", region_profile="us_ca", status="draft")
    db.add(event); db.commit()
    payload = spec_builder.default_payload("baby_shower", "us_ca")
    payload["spec_hash"] = spec_builder.compute_hash(payload)
    spec = Spec(event_id=event.id, version=1, payload=payload, spec_hash=payload["spec_hash"],
                theme_tokens={})
    db.add(spec); db.commit()
    campaign = Campaign(spec_id=spec.id, event_id=event.id, status="running")
    db.add(campaign); db.commit()

    # two catering vendors so leverage has a real competitor to cite
    seg = "catering__full_service"
    v1 = Vendor(campaign_id=campaign.id, name="Alpha Catering", category="catering",
                segment_key=seg, rating=4.5, review_count=120, price_level=2,
                enrichment={"true_segment": seg})
    v2 = Vendor(campaign_id=campaign.id, name="Beta Catering", category="catering",
                segment_key=seg, rating=4.2, review_count=80, price_level=2,
                enrichment={"true_segment": seg})
    db.add_all([v1, v2]); db.commit()

    # the Call the caller would have created before dispatching the live agent
    call = Call(campaign_id=campaign.id, vendor_id=v1.id, category="catering",
                segment_key_at_start=seg, segment_key_final=seg, phase="negotiation",
                status="in_progress")
    db.add(call); db.commit()
    cid, callid, vid2 = campaign.id, call.id, v2.id
    # a competitor quote already on the board (logged by v2's call)
    from app.models import Quote
    db.add(Quote(call_id="seed_call", campaign_id=cid, vendor_id=vid2, category="catering",
                 segment_key=seg, currency="USD", total=8400.0, opening_total=8400.0,
                 line_items=[{"label": "Food & service", "amount": 8400, "unit": "per_event"}]))
    db.commit()
    db.close()

    events: list = []
    q = bus.subscribe(cid)

    async def drain():
        while True:
            msg = await q.get()
            events.append((msg["type"], msg["payload"]))

    drainer = asyncio.create_task(drain())
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
        print("== auth gate ==")
        r = await c.get("/api/agent-tools/leverage",
                        params={"campaign_id": cid, "call_id": callid, "category": "catering",
                                "segment_key": seg, "current_total": 9000})
        print("  no-auth ->", r.status_code, "(expect 401)")

        print("== get_verified_leverage ==")
        r = await c.get("/api/agent-tools/leverage", headers=AUTH,
                        params={"campaign_id": cid, "call_id": callid, "category": "catering",
                                "segment_key": seg, "current_total": 9000})
        j = r.json(); print("  ", r.status_code, "competitors:", j.get("competitors"),
                            "| levers:", [l["key"] for l in j.get("levers", [])],
                            "| forbidden:", j.get("forbidden_levers"),
                            "| median:", j.get("market_median_per_unit"))

        print("== log_quote (opening) ==")
        r = await c.post("/api/agent-tools/quote", headers=AUTH, json={
            "campaign_id": cid, "call_id": callid, "vendor_name": "Alpha Catering",
            "category": "catering", "currency": "USD", "total": 9000,
            "line_items": [{"label": "Food & service", "amount": 9000, "unit": "per_event",
                            "included": True, "mandatory": True}],
            "terms": {"deposit_pct": 30, "validity_days": 14}})
        print("  ", r.status_code, r.json())

        print("== record_price_move ==")
        r = await c.post("/api/agent-tools/price-move", headers=AUTH, json={
            "campaign_id": cid, "call_id": callid, "vendor_name": "Alpha Catering",
            "category": "catering", "from_total": 9000, "to_total": 8250,
            "leverage_key": "competing_bid", "note": "competing bid"})
        print("  ", r.status_code, r.json())
        r = await c.post("/api/agent-tools/price-move", headers=AUTH, json={
            "campaign_id": cid, "call_id": callid, "from_total": 8250, "to_total": 8250,
            "leverage_key": "competing_bid"})
        print("  zero-move ->", r.status_code, "(expect 400)")
        r = await c.post("/api/agent-tools/price-move", headers=AUTH, json={
            "campaign_id": cid, "call_id": callid, "from_total": 8250, "to_total": 8000,
            "leverage_key": "totally_made_up"})
        print("  fake-lever ->", r.status_code, "(expect 400)")

        print("== log_quote (update after move) ==")
        r = await c.post("/api/agent-tools/quote", headers=AUTH, json={
            "campaign_id": cid, "call_id": callid, "category": "catering", "total": 8250,
            "line_items": [{"label": "Food & service", "amount": 8000, "unit": "per_event"},
                           {"label": "Service charge", "amount": 250, "unit": "per_event",
                            "disclosed_voluntarily": False}]})
        print("  ", r.status_code, r.json())

        print("== check_red_flags ==")
        r = await c.post("/api/agent-tools/red-flags", headers=AUTH, json={
            "campaign_id": cid, "call_id": callid, "category": "catering", "segment_key": seg,
            "quote": {"total": 8250, "line_items": [
                {"label": "Food & service", "amount": 8000, "unit": "per_event"},
                {"label": "Service charge", "amount": 250, "unit": "per_event",
                 "disclosed_voluntarily": False}],
                "terms": {"deposit_pct": 30}}})
        print("  ", r.status_code, r.json())

        print("== reclassify_segment ==")
        r = await c.post("/api/agent-tools/reclassify", headers=AUTH, json={
            "campaign_id": cid, "call_id": callid, "to_segment_key": "catering__bespoke_chef",
            "reason": "it's just me, I'm the chef"})
        print("  ", r.status_code, r.json())
        r = await c.post("/api/agent-tools/reclassify", headers=AUTH, json={
            "campaign_id": cid, "call_id": callid, "to_segment_key": "not_a_real_segment"})
        print("  bad-segment ->", r.status_code, "(expect 400)")

        print("== request_human (resolved by UI mid-wait) ==")
        async def resolve_soon():
            await asyncio.sleep(0.3)
            from app.services import caller
            ev = caller.handoff_events.get(callid)
            if ev:
                ev.set()
        asyncio.create_task(resolve_soon())
        r = await c.post("/api/agent-tools/handoff", headers=AUTH, json={
            "campaign_id": cid, "call_id": callid, "vendor_name": "Alpha Catering",
            "reason": "budget_exceeded", "detail": "$8,250 over the catering budget",
            "current_total": 8250})
        print("  ", r.status_code, r.json())

        print("== spec tools (intake draft) ==")
        did = "draft_1"
        await c.post("/api/agent-tools/spec/field", headers=AUTH,
                     json={"spec_draft_id": did, "path": "event.type", "value": "wedding"})
        await c.post("/api/agent-tools/spec/field", headers=AUTH,
                     json={"spec_draft_id": did, "path": "event.guest_count", "value": 80})
        r = await c.post("/api/agent-tools/spec/finalize", headers=AUTH, json={"spec_draft_id": did})
        print("  ", r.status_code, r.json())

    await asyncio.sleep(0.1)
    drainer.cancel()
    print("\n== BUS EVENTS (what the dashboard received) ==")
    for t, p in events:
        key = p.get("leverage") or p.get("resolved_by") or p.get("to_segment") or p.get("total") or ""
        print(f"  {t:24} {key}")
    types = [t for t, _ in events]
    need = ["quote.new", "price.move", "quote.update", "segment.reclassified",
            "handoff.requested", "handoff.resolved"]
    missing = [n for n in need if n not in types]
    print("\nRESULT:", "ALL DASHBOARD EVENTS PRESENT ✓" if not missing else f"MISSING {missing}")


asyncio.run(main())
