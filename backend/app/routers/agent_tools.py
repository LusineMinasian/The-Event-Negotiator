"""Live agent-tool webhooks — the bridge from the ElevenLabs Caller/Intake agents
into this backend's event bus, so a REAL phone negotiation lights up the exact same
War Room / Live Command Center as the simulation.

Each endpoint mirrors one server tool the agents are configured with (see
`agents_generate/tools/*.txt` for the paste-ready tool_config and the contract), and
publishes the same bus events `caller.py` emits during a simulated call:

    get_verified_leverage  GET  /leverage      → (read-only, the honesty source of truth)
    log_quote              POST /quote         → quote.new | quote.update
    record_price_move      POST /price-move    → price.move
    check_red_flags        POST /red-flags     → (persists RedFlag rows; read-mostly)
    reclassify_segment     POST /reclassify    → segment.reclassified
    request_human          POST /handoff       → handoff.requested → (wait) → handoff.resolved
    save_spec_field        POST /spec/field    → (intake draft; no dashboard event)
    finalize_spec          POST /spec/finalize → (intake draft; returns spec_hash)

Auth: a single workspace secret (`AGENT_TOOLS_SECRET`) sent as the Authorization header.
The model NEVER supplies campaign_id/call_id — ElevenLabs pins them from the call's
dynamic variables — so we trust the campaign id and validate everything else.
"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, Header, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import select

from ..config import settings
from ..config_loader import get_store
from ..db import SessionLocal
from ..engines import leverage as leverage_engine
from ..engines import red_flag, segment_classifier
from ..models import Call, Campaign, Handoff, PriceEvent, Quote, RedFlag, SegmentObservation, Spec, Vendor
from ..services import caller, spec_builder
from ..services.event_bus import bus

router = APIRouter(prefix="/api/agent-tools", tags=["agent-tools"])

# Long-poll timeout for request_human. Kept under the tool's response_timeout_secs (30)
# so ElevenLabs gets an answer instead of a gateway timeout.
HANDOFF_WAIT_S = 25


# ─────────────────────────── auth + lookup helpers ───────────────────────────
def _authorize(authorization: str | None) -> None:
    """Reject calls that don't carry the shared workspace secret. If no secret is
    configured the endpoints are open (keyless local demo) — same posture as the
    post-call webhook."""
    secret = settings.agent_tools_secret
    if not secret:
        return
    if not authorization:
        raise HTTPException(401, "Missing Authorization")
    token = authorization.split(" ", 1)[1] if authorization.lower().startswith("bearer ") else authorization
    if token != secret:
        raise HTTPException(401, "Invalid agent-tools secret")


def _load_call(db, campaign_id: str, call_id: str) -> tuple[Campaign, Call]:
    """Trust campaign_id (it came from the trusted launch payload) but confirm it exists
    and the call actually belongs to it — the model does not get to route across deals."""
    if not campaign_id:
        raise HTTPException(400, "campaign_id required")
    campaign = db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(404, "Unknown campaign")
    call = db.get(Call, call_id)
    if not call or call.campaign_id != campaign_id:
        raise HTTPException(404, "Call does not belong to this campaign")
    return campaign, call


def _spec_payload(db, campaign: Campaign) -> dict:
    spec = db.get(Spec, campaign.spec_id)
    return spec.payload if spec else {}


def _normalize(total: float, unit: str, payload: dict) -> float:
    """Per-unit price so quotes are comparable — mirrors caller._finish."""
    if unit == "per_guest":
        guests = (payload.get("event") or {}).get("guest_count", 25) or 25
        return round(total / max(guests, 1), 2)
    if unit == "per_hour":
        hours = ((payload.get("event") or {}).get("time_window") or {}).get("duration_h", 3) or 3
        return round(total / max(hours, 1), 2)
    return round(total, 2)


def _quote_event(quote: Quote, vendor: Vendor | None) -> dict:
    return {
        "quote_id": quote.id, "call_id": quote.call_id, "vendor_id": quote.vendor_id,
        "vendor_name": vendor.name if vendor else "", "category": quote.category,
        "segment_key": quote.segment_key, "opening_total": quote.opening_total,
        "total": quote.total, "line_items": quote.line_items,
    }


# ──────────────────────────────── get_verified_leverage ───────────────────────
@router.get("/leverage")
async def get_leverage(
    campaign_id: str = Query(...),
    call_id: str = Query(...),
    category: str = Query(""),
    segment_key: str = Query(""),
    current_total: float = Query(0.0),
    authorization: str | None = Header(None),
) -> dict:
    """The single legal source of numbers the Caller may cite. Returns only verified
    competing quotes (real, already-logged rows this campaign) and the segment-ranked
    levers with ready-to-say phrases; harmful levers are stripped. Publishes nothing."""
    _authorize(authorization)
    db = SessionLocal()
    try:
        campaign, call = _load_call(db, campaign_id, call_id)
        payload = _spec_payload(db, campaign)
        category = category or call.category
        segment_key = segment_key or call.segment_key_final or call.segment_key_at_start
        event_key = (payload.get("event") or {}).get("type", "")
        region_key = (payload.get("location") or {}).get("region_profile", "us_ca")

        vendor = db.get(Vendor, call.vendor_id)
        vendor_name = vendor.name if vendor else ""

        # verified competitors = real quotes already logged for OTHER vendors in the same
        # campaign+category. Empty ⇒ the agent literally has no competing bid to cite.
        competitors: list[dict] = []
        rows = db.scalars(select(Quote).where(Quote.campaign_id == campaign_id,
                                               Quote.category == category)).all()
        for q in rows:
            if q.call_id == call_id or not q.total:
                continue
            cq_vendor = db.get(Vendor, q.vendor_id)
            competitors.append({"quote_id": q.id, "total": q.total, "category": q.category,
                                "vendor": cq_vendor.name if cq_vendor else ""})

        result = leverage_engine.get_verified_leverage(
            event_key, category, segment_key, payload, region_key, competitors,
            current_total or 0.0)
    finally:
        db.close()

    return {
        "competitors": [{"amount": c["total"], "category": c["category"]}
                        for c in competitors if c["vendor"] != vendor_name],
        "levers": [{"key": l["key"], "display": l["display"], "phrase": l["phrase"]}
                   for l in result["levers"]],
        "forbidden_levers": [t["key"] for t in result["harmful_topics"]],
        "market_median_per_unit": (result.get("benchmark") or {}).get("median"),
        "concession_ceiling": result.get("concession_ceiling"),
    }


# ─────────────────────────────────── log_quote ───────────────────────────────
class QuoteIn(BaseModel):
    campaign_id: str
    call_id: str
    vendor_name: str | None = None
    category: str | None = None
    currency: str | None = None
    line_items: list[dict] = []
    total: float
    terms: dict | None = None


@router.post("/quote")
async def log_quote(body: QuoteIn, authorization: str | None = Header(None)) -> dict:
    """Upsert the current full itemized quote and push it to the War Room. First call for
    a vendor = the opening quote (records opening_total); later calls update it."""
    _authorize(authorization)
    db = SessionLocal()
    try:
        campaign, call = _load_call(db, body.campaign_id, body.call_id)
        payload = _spec_payload(db, campaign)
        vendor = db.get(Vendor, call.vendor_id)
        category = body.category or call.category
        store = get_store()
        segment_key = call.segment_key_final or call.segment_key_at_start
        unit = leverage_engine.resolve_config(
            (payload.get("event") or {}).get("type", ""), category, segment_key
        )["normalization_unit"]
        normalized = _normalize(body.total, unit, payload)

        quote = db.scalar(select(Quote).where(Quote.call_id == body.call_id))
        is_new = quote is None
        if is_new:
            quote = Quote(call_id=body.call_id, campaign_id=body.campaign_id,
                          vendor_id=call.vendor_id, category=category, segment_key=segment_key,
                          currency=body.currency or (payload.get("budget") or {}).get("currency", "USD"),
                          opening_total=body.total, status="verified",
                          negotiation={"opening_total": body.total, "leverage_used": [],
                                       "leverage_available_unused": []})
            db.add(quote)
        quote.line_items = body.line_items
        quote.total = body.total
        quote.normalized_per_unit = normalized
        if body.currency:
            quote.currency = body.currency
        if body.terms:
            quote.terms = body.terms
        db.commit()
        event = _quote_event(quote, vendor)
        quote_id = quote.id
    finally:
        db.close()

    await bus.publish(body.campaign_id, "quote.new" if is_new else "quote.update", event)
    return {"ok": True, "quote_id": quote_id, "total": body.total, "normalized_per_unit": normalized}


# ──────────────────────────────── record_price_move ──────────────────────────
class PriceMoveIn(BaseModel):
    campaign_id: str
    call_id: str
    vendor_name: str | None = None
    category: str | None = None
    from_total: float
    to_total: float
    leverage_key: str
    note: str | None = None


@router.post("/price-move")
async def record_price_move(body: PriceMoveIn, authorization: str | None = Header(None)) -> dict:
    """The realtime "deal changed" signal — the War Room ticker jumps and we log, on the
    record, that a number moved because of a specific lever. Guards fabricated drama:
    the lever must be real and the move non-zero."""
    _authorize(authorization)
    if body.to_total == body.from_total:
        raise HTTPException(400, "A move of zero is not a move")
    store = get_store()
    if body.leverage_key not in store.levers:
        raise HTTPException(400, f"Unknown leverage_key '{body.leverage_key}'")

    db = SessionLocal()
    try:
        campaign, call = _load_call(db, body.campaign_id, body.call_id)
        payload = _spec_payload(db, campaign)
        vendor = db.get(Vendor, call.vendor_id)
        category = body.category or call.category
        region_key = (payload.get("location") or {}).get("region_profile", "us_ca")
        segment_key = call.segment_key_final or call.segment_key_at_start
        quote = db.scalar(select(Quote).where(Quote.call_id == body.call_id))

        pe = PriceEvent(quote_id=quote.id if quote else "", call_id=body.call_id,
                        from_total=body.from_total, to_total=body.to_total,
                        leverage_type=body.leverage_key, segment_key=segment_key,
                        ts_s=0, attributed=True)
        db.add(pe)

        delta = (body.to_total - body.from_total) / body.from_total if body.from_total else 0
        _record_observation(db, segment_key, body.leverage_key, region_key,
                            moved=body.to_total < body.from_total, delta=delta * 100)

        if quote:
            quote.total = body.to_total
            lev = store.levers.get(body.leverage_key, {})
            neg = dict(quote.negotiation or {})
            neg["leverage_used"] = list(neg.get("leverage_used", [])) + [
                {"key": body.leverage_key, "display": lev.get("display", body.leverage_key.replace("_", " ").title())}]
            quote.negotiation = neg
        db.commit()
        display = store.levers.get(body.leverage_key, {}).get(
            "display", body.leverage_key.replace("_", " ").title())
        vendor_name = body.vendor_name or (vendor.name if vendor else "")
    finally:
        db.close()

    await bus.publish(body.campaign_id, "price.move", {
        "call_id": body.call_id, "vendor_name": vendor_name, "category": category,
        "from_total": body.from_total, "to_total": body.to_total,
        "leverage": body.note or display,
        "delta_pct": round(delta * 100, 1),
    })
    return {"ok": True, "delta_pct": round(delta * 100, 1)}


# ──────────────────────────────── check_red_flags ────────────────────────────
class RedFlagIn(BaseModel):
    campaign_id: str
    call_id: str
    category: str | None = None
    segment_key: str | None = None
    quote: dict


@router.post("/red-flags")
async def check_red_flags(body: RedFlagIn, authorization: str | None = Header(None)) -> dict:
    """Test the current quote against the vertical's red-flag rules (30%+ below market,
    undisclosed service charge, oversized deposit, incomplete itemization) and return the
    market median for framing. Persists RedFlag rows so the KPI count reflects live probes."""
    _authorize(authorization)
    db = SessionLocal()
    try:
        campaign, call = _load_call(db, body.campaign_id, body.call_id)
        payload = _spec_payload(db, campaign)
        store = get_store()
        category = body.category or call.category
        segment_key = body.segment_key or call.segment_key_final or call.segment_key_at_start
        region_key = (payload.get("location") or {}).get("region_profile", "us_ca")
        resolved = leverage_engine.resolve_config(
            (payload.get("event") or {}).get("type", ""), category, segment_key)
        unit = resolved["normalization_unit"]
        median, _ = store.benchmark(resolved["benchmark_key"].replace("{region_profile}", region_key), unit)

        q = dict(body.quote)
        if not q.get("normalized_per_unit") and q.get("total"):
            q["normalized_per_unit"] = _normalize(q["total"], unit, payload)

        flags = red_flag.evaluate(q, category, segment_key, median)

        # attach to the persisted quote (if logged) and de-dup on re-check
        quote = db.scalar(select(Quote).where(Quote.call_id == body.call_id))
        if quote:
            for existing in db.scalars(select(RedFlag).where(RedFlag.quote_id == quote.id)).all():
                db.delete(existing)
            for f in flags:
                db.add(RedFlag(quote_id=quote.id, rule_key=f["rule_key"],
                               severity=f["severity"], detail=f["detail"]))
            db.commit()
    finally:
        db.close()

    return {"flags": flags, "market_median_per_unit": median}


# ──────────────────────────────── reclassify_segment ─────────────────────────
class ReclassifyIn(BaseModel):
    campaign_id: str
    call_id: str
    to_segment_key: str
    reason: str | None = None


@router.post("/reclassify")
async def reclassify_segment(body: ReclassifyIn, authorization: str | None = Header(None)) -> dict:
    """Record that the vendor is actually a different segment than assumed (the phone
    reveals the truth) so the agent can re-fetch leverage and pivot. Rejects free text —
    the target must be a real segment for this call's category."""
    _authorize(authorization)
    db = SessionLocal()
    try:
        campaign, call = _load_call(db, body.campaign_id, body.call_id)
        store = get_store()
        seg = store.segment(body.to_segment_key)
        if not seg or seg.get("parent_category") != call.category:
            raise HTTPException(400, f"'{body.to_segment_key}' is not a segment for category '{call.category}'")

        from_segment = call.segment_key_final or call.segment_key_at_start
        rc = segment_classifier.reclassify(body.to_segment_key)
        call.segment_key_final = body.to_segment_key
        quote = db.scalar(select(Quote).where(Quote.call_id == body.call_id))
        if quote:
            quote.segment_key = body.to_segment_key
        db.commit()
        display = rc["segment_display"]
        note = rc["strategy_change_note"]
    finally:
        db.close()

    await bus.publish(body.campaign_id, "segment.reclassified", {
        "call_id": body.call_id, "from_segment": from_segment, "to_segment": body.to_segment_key,
        "segment_display": display, "note": note,
    })
    return {"ok": True, "to_segment_key": body.to_segment_key,
            "segment_display": display, "strategy_change_note": note}


# ──────────────────────────────── request_human ──────────────────────────────
class HandoffIn(BaseModel):
    campaign_id: str
    call_id: str
    vendor_name: str | None = None
    reason: str
    detail: str
    current_total: float | None = None


@router.post("/handoff")
async def request_human(body: HandoffIn, authorization: str | None = Header(None)) -> dict:
    """Human-in-the-loop "Pull Me In": the price crossed the client's category budget, so
    the agent brings a human in. Publishes handoff.requested, then blocks (up to
    HANDOFF_WAIT_S) on the SAME registry the UI resolves — so the existing Pull-Me-In
    button decides this live call — and returns the decision to the agent."""
    _authorize(authorization)
    db = SessionLocal()
    try:
        campaign, call = _load_call(db, body.campaign_id, body.call_id)
        vendor = db.get(Vendor, call.vendor_id)
        vendor_name = body.vendor_name or (vendor.name if vendor else "")
        db.add(Handoff(call_id=body.call_id, reason=body.reason, urgency="high", context=body.detail))
        db.commit()
    finally:
        db.close()

    await bus.publish(body.campaign_id, "handoff.requested", {
        "call_id": body.call_id, "vendor_name": vendor_name,
        "reason": body.reason, "detail": body.detail,
    })

    ev = asyncio.Event()
    caller.handoff_events[body.call_id] = ev
    try:
        await asyncio.wait_for(ev.wait(), timeout=HANDOFF_WAIT_S)
        resolved_by = "user"
    except asyncio.TimeoutError:
        resolved_by = "timeout"
    finally:
        caller.handoff_events.pop(body.call_id, None)

    db = SessionLocal()
    try:
        ho = db.scalar(select(Handoff).where(Handoff.call_id == body.call_id)
                       .order_by(Handoff.requested_at.desc()))
        if ho:
            from ..models import now as _now
            ho.resolved_at = _now()
            ho.resolved_by = resolved_by
            db.commit()
    finally:
        db.close()

    await bus.publish(body.campaign_id, "handoff.resolved", {
        "call_id": body.call_id, "resolved_by": resolved_by,
    })
    approved = resolved_by == "user"
    return {
        "ok": True, "resolved_by": resolved_by,
        "decision": "approve_higher_ceiling" if approved else "hold_at_budget",
        "new_ceiling": round(body.current_total) if (approved and body.current_total) else None,
    }


# ─────────────────────── intake spec tools (draft, no dashboard event) ────────
# Minimal in-process draft store so the Intake/Estimator agent's two tools work
# end-to-end. Each draft accumulates fields; finalize freezes a spec_hash. Binding a
# finished draft into the review wizard UI is a separate frontend step.
_spec_drafts: dict[str, dict] = {}


class SpecFieldIn(BaseModel):
    spec_draft_id: str
    path: str
    value: object = None
    confidence: float | None = None


@router.post("/spec/field")
async def save_spec_field(body: SpecFieldIn, authorization: str | None = Header(None)) -> dict:
    """Store one confirmed field of the job spec as the intake agent gathers it. `path`
    is a dotted path (e.g. 'event.guest_count'); the value is set on the draft."""
    _authorize(authorization)
    draft = _spec_drafts.setdefault(body.spec_draft_id, {})
    node = draft
    parts = body.path.split(".")
    for key in parts[:-1]:
        node = node.setdefault(key, {})
        if not isinstance(node, dict):
            raise HTTPException(400, f"path conflict at '{key}'")
    node[parts[-1]] = body.value
    return {"ok": True, "spec_draft_id": body.spec_draft_id, "path": body.path}


class SpecFinalizeIn(BaseModel):
    spec_draft_id: str


@router.post("/spec/finalize")
async def finalize_spec(body: SpecFinalizeIn, authorization: str | None = Header(None)) -> dict:
    """Freeze the accumulated draft into one structured spec and return its spec_hash —
    the same hash every downstream call will describe, verbatim."""
    _authorize(authorization)
    draft = _spec_drafts.get(body.spec_draft_id)
    if not draft:
        raise HTTPException(404, "Unknown spec_draft_id")
    spec_hash = spec_builder.compute_hash(draft)
    draft["spec_hash"] = spec_hash
    return {"ok": True, "spec_draft_id": body.spec_draft_id, "spec_hash": spec_hash, "spec": draft}


def _record_observation(db, segment_key: str, lever_key: str, region: str,
                        moved: bool, delta: float) -> None:
    """Mirror caller._record_observation so learned lever effectiveness accrues from live
    calls exactly as it does from simulated ones."""
    obs = db.scalar(select(SegmentObservation).where(
        SegmentObservation.segment_key == segment_key,
        SegmentObservation.lever_key == lever_key,
        SegmentObservation.region_profile == region))
    if not obs:
        obs = SegmentObservation(segment_key=segment_key, lever_key=lever_key,
                                 region_profile=region, applied_count=0, moved_count=0, sum_delta_pct=0.0)
        db.add(obs)
        db.flush()
    obs.applied_count = (obs.applied_count or 0) + 1
    if moved:
        obs.moved_count = (obs.moved_count or 0) + 1
        obs.sum_delta_pct = (obs.sum_delta_pct or 0.0) + delta
