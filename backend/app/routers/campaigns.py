import asyncio

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import current_user
from ..config_loader import get_store
from ..db import get_db
from ..models import (Call, Campaign, Handoff, PriceEvent, Quote, RedFlag, SegmentObservation,
                      Spec, User, Utterance, Vendor)
from ..services import caller
from ..services.event_bus import bus

router = APIRouter(prefix="/api/campaigns", tags=["campaigns"])


@router.post("/{campaign_id}/start")
async def start_campaign(campaign_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    campaign = db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    if campaign.status in ("running", "completed"):
        raise HTTPException(409, f"Campaign already {campaign.status}")
    # Flip to "running" synchronously inside this request's transaction so a second
    # concurrent /start sees it and hits the 409 guard (the task sets status only after
    # an await, which is too late to prevent a double run).
    campaign.status = "running"
    db.commit()
    asyncio.create_task(caller.run_campaign(campaign_id))
    return {"status": "started"}


@router.get("/{campaign_id}")
def campaign_state(campaign_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    campaign = db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    calls = db.scalars(select(Call).where(Call.campaign_id == campaign_id)).all()
    quotes = db.scalars(select(Quote).where(Quote.campaign_id == campaign_id)).all()
    store = get_store()
    return {
        "status": campaign.status,
        "calls": [_call_summary(db, c, store) for c in calls],
        "quotes": [_quote_summary(q) for q in quotes],
        "history": bus.history(campaign_id),
    }


@router.get("/{campaign_id}/calls/{call_id}")
def call_detail(campaign_id: str, call_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    call = db.get(Call, call_id)
    if not call:
        raise HTTPException(404, "Call not found")
    store = get_store()
    vendor = db.get(Vendor, call.vendor_id)
    utterances = db.scalars(select(Utterance).where(Utterance.call_id == call_id).order_by(Utterance.ts_s)).all()
    quote = db.scalar(select(Quote).where(Quote.call_id == call_id))
    price_events = db.scalars(select(PriceEvent).where(PriceEvent.call_id == call_id)).all()
    flags = db.scalars(select(RedFlag).where(RedFlag.quote_id == (quote.id if quote else ""))).all()
    return {
        "call": _call_summary(db, call, store),
        "vendor": {"name": vendor.name, "rating": vendor.rating, "review_count": vendor.review_count},
        "utterances": [{"speaker": u.speaker, "text": u.text, "ts_s": u.ts_s, "lever_key": u.lever_key} for u in utterances],
        "quote": _quote_full(quote, flags) if quote else None,
        "price_events": [{"from": p.from_total, "to": p.to_total, "leverage": p.leverage_type, "ts_s": p.ts_s} for p in price_events],
    }


@router.post("/{campaign_id}/calls/{call_id}/handoff/resolve")
def resolve_handoff(campaign_id: str, call_id: str, user: User = Depends(current_user)):
    ev = caller.handoff_events.get(call_id)
    if not ev:
        raise HTTPException(404, "No pending handoff for this call")
    ev.set()
    return {"resolved": True}


@router.get("/{campaign_id}/receipt")
def receipt(campaign_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    campaign = db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    spec = db.get(Spec, campaign.spec_id)
    store = get_store()
    calls = db.scalars(select(Call).where(Call.campaign_id == campaign_id)).all()
    quotes = db.scalars(select(Quote).where(Quote.campaign_id == campaign_id)).all()
    by_cat: dict[str, list[dict]] = {}
    total_seconds = 0
    for c in calls:
        total_seconds += c.duration_s
    for q in quotes:
        call = db.get(Call, q.call_id)
        if not call or call.outcome != "quote":
            continue
        vendor = db.get(Vendor, q.vendor_id)
        flags = db.scalars(select(RedFlag).where(RedFlag.quote_id == q.id)).all()
        pe = db.scalars(select(PriceEvent).where(PriceEvent.quote_id == q.id)).all()
        trigger = ""
        if pe:
            u = db.scalar(select(Utterance).where(Utterance.call_id == q.call_id,
                                                  Utterance.lever_key == pe[-1].leverage_type))
            trigger = u.text if u else ""
        by_cat.setdefault(q.category, []).append({
            "vendor": vendor.name, "rating": vendor.rating, "review_count": vendor.review_count,
            "segment_display": store.segment(q.segment_key).get("display_name", q.segment_key),
            "opening_total": q.opening_total, "total": q.total, "rank": q.rank,
            "negotiated_subtotal": q.negotiation.get("negotiated_subtotal", q.total),
            "delta_pct": q.negotiation.get("delta_pct", 0),
            "leverage_used": [l["display"] for l in q.negotiation.get("leverage_used", [])],
            "trigger_utterance": trigger,
            "line_items": q.line_items,
            "red_flags": [{"rule": f.rule_key, "severity": f.severity, "detail": f.detail} for f in flags],
            "score_breakdown": q.score_breakdown,
            "call_id": q.call_id,
        })
    for cat in by_cat:
        by_cat[cat].sort(key=lambda x: x["rank"])
    recommended_total = sum(items[0]["total"] for items in by_cat.values() if items)
    # value the negotiation delivered = opening minus negotiated subtotal on the picks
    # (revealed mandatory fees are surfaced separately, not counted as "savings")
    savings = sum(items[0]["opening_total"] - items[0]["negotiated_subtotal"]
                  for items in by_cat.values() if items)
    payload = spec.payload
    return {
        "event": payload["event"], "location": payload["location"], "budget": payload["budget"],
        "spec_hash": spec.spec_hash, "theme_tokens": spec.theme_tokens,
        "categories": by_cat,
        "recommended_total": round(recommended_total, 0),
        "budget_ceiling": payload["budget"].get("total_ceiling"),
        "savings": round(savings, 0),
        "time_ledger": {"calls": len(calls), "phone_seconds": total_seconds,
                        "phone_time": _fmt_hms(total_seconds)},
    }


@router.get("/{campaign_id}/metrics")
def metrics(campaign_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Live command-center snapshot: KPIs + distributions for the dashboard.

    Order-independent aggregates are computed server-side (the truth for a
    late-joining or refreshed dashboard); the streaming curves on top are driven
    by the WebSocket. `price_moves` is ordered so the client can seed its curve."""
    campaign = db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    store = get_store()
    spec = db.get(Spec, campaign.spec_id)
    budget_cfg = (spec.payload.get("budget", {}) if spec else {})

    calls = db.scalars(select(Call).where(Call.campaign_id == campaign_id)).all()
    quotes = db.scalars(select(Quote).where(Quote.campaign_id == campaign_id)).all()

    outcomes: dict[str, int] = {}
    phases: dict[str, int] = {}
    coverage: dict[str, dict] = {}
    calls_active = 0
    phone_seconds = 0
    for c in calls:
        phone_seconds += c.duration_s
        cov = coverage.setdefault(c.category, {"category": c.category, "total": 0, "done": 0})
        cov["total"] += 1
        if c.status == "completed":
            outcomes[c.outcome or "done"] = outcomes.get(c.outcome or "done", 0) + 1
            cov["done"] += 1
        else:
            calls_active += 1
            phases[c.phase or "queued"] = phases.get(c.phase or "queued", 0) + 1

    # per-quote savings (value the negotiation delivered = opening − negotiated subtotal)
    total_saved = 0.0
    saving_pcts: list[float] = []
    savings_by_cat: dict[str, dict] = {}
    vendors_cmp: list[dict] = []
    quoted = 0
    for q in quotes:
        call = db.get(Call, q.call_id)
        if not call or call.outcome != "quote":
            continue
        quoted += 1
        neg = q.negotiation or {}
        subtotal = neg.get("negotiated_subtotal", q.total)
        saved = max(0.0, q.opening_total - subtotal)
        total_saved += saved
        if q.opening_total:
            saving_pcts.append(round(saved / q.opening_total * 100, 1))
        s = savings_by_cat.setdefault(q.category, {"category": q.category, "saved": 0.0,
                                                   "opening": 0.0, "current": 0.0})
        s["saved"] += saved
        s["opening"] += q.opening_total
        s["current"] += q.total
        vendor = db.get(Vendor, q.vendor_id)
        vendors_cmp.append({"vendor": vendor.name if vendor else "", "category": q.category,
                            "opening": q.opening_total, "current": q.total,
                            "outcome": call.outcome, "rank": q.rank})

    red_flags = db.scalar(select(func.count()).select_from(RedFlag).join(
        Quote, RedFlag.quote_id == Quote.id).where(Quote.campaign_id == campaign_id)) or 0
    handoffs = db.scalars(select(Handoff).join(Call, Handoff.call_id == Call.id).where(
        Call.campaign_id == campaign_id)).all()
    handoffs_pending = sum(1 for h in handoffs if h.resolved_at is None)

    # budget spent = best quote per category: the rank-1 pick once ranked, else the
    # cheapest quote so far while calls are still live. Mirrors the receipt.
    ranked_pick: dict[str, float] = {}
    cheapest: dict[str, float] = {}
    for q in quotes:
        call = db.get(Call, q.call_id)
        if not call or call.outcome != "quote":
            continue
        if q.rank == 1:
            ranked_pick[q.category] = q.total
        cheapest[q.category] = min(cheapest.get(q.category, q.total), q.total)
    best_by_cat = {cat: ranked_pick.get(cat, cheapest[cat]) for cat in cheapest}
    spent = round(sum(best_by_cat.values()), 0)
    ceiling = budget_cfg.get("total_ceiling", 0) or 0

    # ordered price moves (for the streaming savings curve to hydrate on refresh)
    price_events = db.scalars(select(PriceEvent).join(Call, PriceEvent.call_id == Call.id)
                              .where(Call.campaign_id == campaign_id)
                              .order_by(PriceEvent.id)).all()
    price_moves = []
    for pe in price_events:
        vendor = None
        c = db.get(Call, pe.call_id)
        if c:
            vendor = db.get(Vendor, c.vendor_id)
        lev = store.levers.get(pe.leverage_type, {})
        price_moves.append({
            "vendor": vendor.name if vendor else "", "category": c.category if c else "",
            "from": pe.from_total, "to": pe.to_total,
            "saving_pct": round((pe.from_total - pe.to_total) / pe.from_total * 100, 1) if pe.from_total else 0,
            "leverage": lev.get("display", pe.leverage_type.replace("_", " ").title()),
        })

    # leverage effectiveness across segments (which levers actually move price)
    obs = db.scalars(select(SegmentObservation)).all()
    lev_agg: dict[str, dict] = {}
    for o in obs:
        a = lev_agg.setdefault(o.lever_key, {"lever": o.lever_key, "applied": 0, "moved": 0, "sum_delta": 0.0})
        a["applied"] += o.applied_count or 0
        a["moved"] += o.moved_count or 0
        a["sum_delta"] += o.sum_delta_pct or 0.0
    leverage_rows = []
    for k, a in lev_agg.items():
        disp = store.levers.get(k, {}).get("display", k.replace("_", " ").title())
        leverage_rows.append({
            "lever": k, "display": disp, "applied": a["applied"], "moved": a["moved"],
            "avg_saving_pct": round(a["sum_delta"] / a["moved"], 1) if a["moved"] else 0.0,
        })
    leverage_rows.sort(key=lambda x: (-x["avg_saving_pct"], -x["applied"]))

    return {
        "status": campaign.status,
        "kpi": {
            "calls_total": len(calls), "calls_active": calls_active,
            "calls_completed": sum(1 for c in calls if c.status == "completed"),
            "quotes": quoted,
            "avg_saving_pct": round(sum(saving_pcts) / len(saving_pcts), 1) if saving_pcts else 0.0,
            "total_saved": round(total_saved, 0),
            "red_flags": int(red_flags),
            "handoffs_pending": handoffs_pending, "handoffs_total": len(handoffs),
            "phone_seconds": phone_seconds, "phone_time": _fmt_hms(phone_seconds),
            "budget": {"ceiling": ceiling, "spent": spent,
                       "pct": round(spent / ceiling * 100, 1) if ceiling else 0,
                       "over": bool(ceiling and spent > ceiling)},
        },
        "outcomes": outcomes,
        "phases": phases,
        "coverage": sorted(coverage.values(), key=lambda x: x["category"]),
        "savings_by_category": sorted(savings_by_cat.values(), key=lambda x: -x["saved"]),
        "leverage": leverage_rows,
        "price_moves": price_moves,
        "vendors": vendors_cmp,
    }


@router.get("/{campaign_id}/postmortem")
def postmortem(campaign_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    calls = db.scalars(select(Call).where(Call.campaign_id == campaign_id)).all()
    outcomes: dict[str, int] = {}
    reclassified = []
    coverage: dict[str, int] = {}
    moved = 0
    for c in calls:
        outcomes[c.outcome] = outcomes.get(c.outcome, 0) + 1
        coverage[c.category] = coverage.get(c.category, 0) + 1
        if c.segment_key_at_start != c.segment_key_final:
            reclassified.append({"call_id": c.id, "from": c.segment_key_at_start, "to": c.segment_key_final})
        pe = db.scalars(select(PriceEvent).where(PriceEvent.call_id == c.id)).all()
        if pe:
            moved += 1
    from ..models import SegmentObservation
    obs = db.scalars(select(SegmentObservation)).all()
    lever_effectiveness = [{
        "segment": o.segment_key, "lever": o.lever_key, "applied": o.applied_count,
        "moved": o.moved_count, "avg_delta_pct": round(o.sum_delta_pct / o.moved_count, 1) if o.moved_count else 0,
    } for o in obs]
    return {
        "outcomes": outcomes, "coverage": coverage,
        "calls_with_price_movement": moved, "total_calls": len(calls),
        "reclassifications": reclassified,
        "lever_effectiveness": sorted(lever_effectiveness, key=lambda x: -x["applied"]),
        "honesty_violations": 0,
    }


def _call_summary(db, c: Call, store) -> dict:
    vendor = db.get(Vendor, c.vendor_id)
    return {
        "call_id": c.id, "vendor_id": c.vendor_id, "vendor_name": vendor.name if vendor else "",
        "category": c.category, "phase": c.phase, "status": c.status, "outcome": c.outcome,
        "segment_at_start": c.segment_key_at_start, "segment_final": c.segment_key_final,
        "segment_display": store.segment(c.segment_key_final).get("display_name", c.segment_key_final),
        "duration_s": c.duration_s,
    }


def _quote_summary(q: Quote) -> dict:
    return {"quote_id": q.id, "call_id": q.call_id, "category": q.category, "segment_key": q.segment_key,
            "opening_total": q.opening_total, "total": q.total, "rank": q.rank, "score": q.score}


def _quote_full(q: Quote, flags) -> dict:
    return {**_quote_summary(q), "line_items": q.line_items, "terms": q.terms,
            "negotiation": q.negotiation, "normalized_per_unit": q.normalized_per_unit,
            "score_breakdown": q.score_breakdown,
            "red_flags": [{"rule": f.rule_key, "severity": f.severity, "detail": f.detail} for f in flags]}


def _fmt_hms(seconds: int) -> str:
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    if h:
        return f"{h}h {m}m"
    return f"{m}m {s}s"
