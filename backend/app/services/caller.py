"""The Caller + Closer orchestration (spec modules 02 & 03).

Runs a campaign: orders vendors by segment (benchmark-first), places calls with
bounded concurrency, drives each conversation through the agent tools
(get_verified_leverage / log_quote / check_red_flags / reclassify_segment /
request_human / end_call), moves prices as a function of applied leverage, and
streams every event to the War Room over the event bus.

CALL_MODE=simulation (default) uses the deterministic counterparty engine.
CALL_MODE=live triggers the real ElevenLabs+Twilio connectors (see those modules).
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from ..config import settings
from ..config_loader import get_store
from ..db import SessionLocal
from ..engines import budget_guard, leverage, ranking, red_flag, segment_classifier
from ..models import (Call, Campaign, Handoff, PriceEvent, Quote, RedFlag, SegmentObservation,
                      Spec, Utterance, Vendor)
from . import elevenlabs_connector
from .counterparty import Counterparty
from .event_bus import bus

# Registry of pending human-handoff resolutions (Pull Me In)
handoff_events: dict[str, asyncio.Event] = {}
# Registry of pending mid-call trade-off questions (answer key stored back per call)
question_events: dict[str, asyncio.Event] = {}
question_answers: dict[str, str] = {}

STEP = 0.7  # seconds between utterances (tune for demo pacing)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def spec_summary(payload: dict) -> str:
    ev = payload.get("event", {})
    loc = payload.get("location", {})
    return (f"{ev.get('type', 'event').replace('_', ' ').title()} on {ev.get('date', 'TBD')}, "
            f"{ev.get('guest_count', '?')} guests, in {loc.get('city', 'town')}. "
            f"Daytime slot, weekday flexible.")


def _order_vendors(vendors: list[Vendor]) -> list[Vendor]:
    """Benchmark-first ordering (spec 6.2/9.6): fixed-grid / low-ceiling segments first
    so competing bids accumulate for the flexible vendors called last."""
    store = get_store()

    def key(v: Vendor):
        seg = store.segment(v.segment_key)
        rp = seg.get("resistance_profile", {})
        pricing = seg.get("economics", {}).get("pricing_model", "")
        grid_first = 0 if pricing in ("fixed_grid",) else 1
        return (grid_first, rp.get("typical_concession_ceiling", 0.12))

    return sorted(vendors, key=key)


async def run_campaign(campaign_id: str) -> None:
    """Public entrypoint (fire-and-forget task). Wraps the orchestration so a crash marks
    the campaign 'failed' instead of leaving it stuck 'running' (which the 409 guard would
    then block from ever restarting)."""
    try:
        await _run_campaign(campaign_id)
    except Exception as exc:  # noqa: BLE001 — background task; must not vanish silently
        import traceback
        traceback.print_exc()
        db = SessionLocal()
        try:
            c = db.get(Campaign, campaign_id)
            if c and c.status != "completed":
                c.status = "failed"
                db.commit()
        finally:
            db.close()
        await bus.publish(campaign_id, "campaign.failed", {"campaign_id": campaign_id, "error": str(exc)[:200]})


async def _run_campaign(campaign_id: str) -> None:
    db = SessionLocal()
    try:
        campaign = db.get(Campaign, campaign_id)
        spec = db.get(Spec, campaign.spec_id)
        payload = spec.payload
        event_key = payload["event"]["type"]
        region_key = payload["location"].get("region_profile", "us_ca")
        vendors = db.scalars(select(Vendor).where(Vendor.campaign_id == campaign_id,
                                                  Vendor.excluded == False)).all()  # noqa: E712
        campaign.status = "running"
        campaign.started_at = _now()
        db.commit()
    finally:
        db.close()

    await bus.publish(campaign_id, "campaign.started", {"campaign_id": campaign_id})

    # shared campaign state
    verified: list[dict] = []  # {quote_id, total, category, vendor}
    state = {"handoff_done": False, "budget": payload.get("budget", {})}
    ordered = _order_vendors(vendors)

    sem = asyncio.Semaphore(6)

    async def guarded(v: Vendor):
        async with sem:
            await asyncio.sleep(0.2)
            await run_single_call(campaign_id, v.id, payload, event_key, region_key, verified, state)

    # stagger starts slightly for a lively ticker
    tasks = []
    for i, v in enumerate(ordered):
        tasks.append(asyncio.create_task(guarded(v)))
        await asyncio.sleep(0.25)
    await asyncio.gather(*tasks)

    await finalize_campaign(campaign_id, event_key, payload)


async def _say(db, campaign_id: str, call: Call, speaker: str, text: str,
               ts: int, lever_key: str = "") -> Utterance:
    u = Utterance(call_id=call.id, ts_s=ts, speaker=speaker, text=text, lever_key=lever_key)
    db.add(u)
    db.commit()
    await bus.publish(campaign_id, "utterance", {
        "call_id": call.id, "speaker": speaker, "text": text, "ts_s": ts, "lever_key": lever_key,
        "utterance_id": u.id,
    })
    await asyncio.sleep(STEP)
    return u


async def _set_phase(db, campaign_id: str, call: Call, phase: str) -> None:
    call.phase = phase
    db.commit()
    await bus.publish(campaign_id, "call.phase", {"call_id": call.id, "phase": phase})


async def run_single_call(campaign_id: str, vendor_id: str, payload: dict,
                          event_key: str, region_key: str, verified: list[dict],
                          state: dict | None = None) -> None:
    state = state if state is not None else {"handoff_done": False, "budget": payload.get("budget", {})}
    db = SessionLocal()
    try:
        vendor = db.get(Vendor, vendor_id)
        store = get_store()
        # true segment drives the counterparty; classified segment is what the agent starts with
        vendor_dict = {"name": vendor.name, "true_segment": vendor.enrichment.get("true_segment", vendor.segment_key),
                       "price_level": vendor.price_level}
        start_segment = vendor.segment_key
        resolved = leverage.resolve_config(event_key, vendor.category, start_segment)
        cp = Counterparty(vendor_dict, resolved, payload, region_key)

        call = Call(campaign_id=campaign_id, vendor_id=vendor.id, spec_hash=payload.get("spec_hash", ""),
                    category=vendor.category, segment_key_at_start=start_segment,
                    segment_key_final=start_segment, phase="dialing", status="in_progress")
        db.add(call)
        db.commit()
        await bus.publish(campaign_id, "call.initiated", {
            "call_id": call.id, "vendor_id": vendor.id, "vendor_name": vendor.name,
            "category": vendor.category, "segment_key": start_segment,
            "segment_display": store.segment(start_segment).get("display_name", start_segment),
            "rating": vendor.rating, "review_count": vendor.review_count,
            "style": cp.style,
        })

        # CALL_MODE=live: hand this vendor to the real ElevenLabs Caller Agent. On
        # success the live transcript arrives via the webhook and drives this call's
        # UI — so we stop here. Any failure falls through to the simulated choreography
        # so the demo never stalls.
        if settings.call_mode == "live" and settings.live_calls_available:
            if await _dispatch_live(db, campaign_id, call, vendor, payload, resolved, region_key):
                return

        region = store.region(region_key)
        consent = store.prompts.get("consent_scripts", {}).get(region.get("consent_script_key", "consent_us"), "")
        ts = 0

        # 1) disclosure + spec (verbatim)
        await _set_phase(db, campaign_id, call, "intro")
        await _say(db, campaign_id, call, "agent", consent, ts); ts += 6
        await _say(db, campaign_id, call, "vendor", "Sure, go ahead.", ts); ts += 3
        await _say(db, campaign_id, call, "agent",
                   f"Great. I'm pricing a {spec_summary(payload)} What would that start at?", ts); ts += 8

        # decline / unreachable simulation for variety (non-catering only)
        sim_outcome = _forced_outcome(vendor)
        if sim_outcome == "unreachable":
            await _say(db, campaign_id, call, "system", "No answer — voicemail.", ts)
            await _finish(db, campaign_id, call, "unreachable", {"reason": "no_answer"}, cp, resolved, verified, payload, event_key)
            return

        # 2) opening price (or stonewall)
        await _set_phase(db, campaign_id, call, "discovery")
        if cp.style == "stonewaller":
            await _say(db, campaign_id, call, "vendor", cp.opening_line(), ts); ts += 5
            await _say(db, campaign_id, call, "agent",
                       "Totally fair — even a rough range for a weekday daytime would help me plan.", ts, "daytime_slot"); ts += 6
            await _say(db, campaign_id, call, "vendor", cp.stonewall_response(), ts); ts += 5
        else:
            await _say(db, campaign_id, call, "vendor", cp.opening_line(), ts); ts += 5

        quote = _open_quote(db, call, vendor, resolved, cp)
        await bus.publish(campaign_id, "quote.new", _quote_event(quote, vendor))

        # 3) negotiation — apply verified levers, price moves as a function of leverage
        await _set_phase(db, campaign_id, call, "negotiation")
        await _negotiate(db, campaign_id, call, vendor, cp, resolved, event_key, region_key,
                         payload, verified, quote, ts)
        ts += 30

        # 3a) Trade-off — the agent surfaces a scope decision to the user mid-call and
        # bargains on their behalf with the answer (one per campaign).
        await _maybe_tradeoff(db, campaign_id, call, vendor, cp, quote, state, ts)
        ts += 12

        # 3b) Pull Me In — one human handoff per campaign when a category budget is breached
        await _maybe_handoff(db, campaign_id, call, vendor, cp, payload, state, ts)
        ts += 10

        # 4) reclassification demo (flexible vendor revealed as solo)
        true_seg = vendor_dict["true_segment"]
        if true_seg != start_segment and (store.segment(true_seg).get("counterparty") or {}).get("reveal_signal"):
            await _reclassify(db, campaign_id, call, vendor, cp, event_key, region_key,
                              payload, verified, quote, true_seg, ts)
            ts += 20

        # 5) fee challenge → reveal hidden fees → red flags
        await _fee_challenge(db, campaign_id, call, vendor, cp, quote, resolved, region_key, ts)
        ts += 8

        # 6) close
        outcome = "callback" if sim_outcome == "callback" else "quote"
        await _finish(db, campaign_id, call, outcome,
                      {"reason": ""} if outcome == "quote" else {"reason": "will_call_back",
                       "promised_at": (_now() + timedelta(days=1)).isoformat(),
                       "range_hint": cp.current},
                      cp, resolved, verified, payload, event_key, quote)
    finally:
        db.close()


async def _maybe_tradeoff(db, campaign_id, call, vendor, cp, quote, state, ts):
    """Surface a scope trade-off to the user mid-call (e.g. city-view vs sea-view). The
    agent pauses, asks, and — if the user accepts — bargains the concession on their
    behalf so the price moves. One per campaign; declines/timeouts change nothing."""
    if state.get("tradeoff_done"):
        return
    store = get_store()
    tr = store.category(vendor.category).get("tradeoff")
    if not tr:
        return
    state["tradeoff_done"] = True

    await _say(db, campaign_id, call, "agent",
               "One moment — let me check a quick preference with my client.", ts); ts += 3
    await bus.publish(campaign_id, "question.asked", {
        "call_id": call.id, "vendor_name": vendor.name, "category": vendor.category,
        "question": tr["question"],
        "options": [{"key": "accept", "label": tr.get("accept_label", "Yes")},
                    {"key": "decline", "label": tr.get("decline_label", "No")}],
    })
    ev = asyncio.Event()
    question_events[call.id] = ev
    try:
        await asyncio.wait_for(ev.wait(), timeout=25)
        answer = question_answers.pop(call.id, "decline")
    except asyncio.TimeoutError:
        answer = "timeout"
    finally:
        question_events.pop(call.id, None)
    await bus.publish(campaign_id, "question.resolved", {"call_id": call.id, "answer": answer})

    if answer == "accept":
        lever_key = tr.get("lever", "scope_reduction")
        lev = store.levers.get(lever_key, {})
        await _say(db, campaign_id, call, "agent",
                   tr.get("accept_line", "Good news — my client is flexible there. What's your best rate then?"),
                   ts, lever_key); ts += 6
        from_total = cp.current
        concession = cp.apply_lever({"key": lever_key, "weight": 0.85, "unlock": lev.get("unlock", 0.35)})
        await _say(db, campaign_id, call, "vendor", cp.concede_line(concession), ts); ts += 4
        if concession > 0:
            quote.line_items = cp.base_line_items(); quote.total = cp.current; db.commit()
            pe = PriceEvent(quote_id=quote.id, call_id=call.id, from_total=from_total, to_total=cp.current,
                            trigger_utterance_id="", leverage_type=lever_key, segment_key=call.segment_key_final, ts_s=ts)
            db.add(pe); db.commit()
            _append_lever(quote, {"key": lever_key, "display": lev.get("display", lever_key.replace("_", " ").title())})
            db.commit()
            await bus.publish(campaign_id, "price.move", {
                "call_id": call.id, "vendor_name": vendor.name, "category": vendor.category,
                "from_total": from_total, "to_total": cp.current, "leverage": "Client-approved trade-off",
                "delta_pct": round((cp.current - from_total) / from_total * 100, 1) if from_total else 0,
            })
            await bus.publish(campaign_id, "quote.update", _quote_event(quote, vendor))
    else:
        note = "Client prefers to keep it as-is — no change." if answer == "decline" else "No reply in time — keeping the original scope."
        await _say(db, campaign_id, call, "system", note, ts)


async def _maybe_handoff(db, campaign_id, call, vendor, cp, payload, state, ts):
    if state.get("handoff_done"):
        return
    budget = state.get("budget", {})
    ceiling = budget.get("total_ceiling", 0) * budget.get("allocation", {}).get(vendor.category, 1)
    if not ceiling or cp.current <= ceiling:
        return
    state["handoff_done"] = True
    reason = "budget_exceeded"
    db.add(Handoff(call_id=call.id, reason=reason, urgency="high",
                   context=f"{vendor.name} at ${cp.current:.0f} vs category ceiling ${ceiling:.0f}"))
    db.commit()
    await _say(db, campaign_id, call, "agent",
               "One moment — let me bring my client onto the line for this.", ts)
    await bus.publish(campaign_id, "handoff.requested", {
        "call_id": call.id, "vendor_name": vendor.name, "reason": reason,
        "detail": f"${cp.current:.0f} is over the {vendor.category} budget of ${ceiling:.0f}",
    })
    ev = asyncio.Event()
    handoff_events[call.id] = ev
    try:
        await asyncio.wait_for(ev.wait(), timeout=12)
        resolved_by = "user"
    except asyncio.TimeoutError:
        resolved_by = "timeout"
    finally:
        handoff_events.pop(call.id, None)
    ho = db.scalar(select(Handoff).where(Handoff.call_id == call.id))
    if ho:
        ho.resolved_at = _now(); ho.resolved_by = resolved_by; db.commit()
    await bus.publish(campaign_id, "handoff.resolved", {"call_id": call.id, "resolved_by": resolved_by})
    if resolved_by == "user":
        await _say(db, campaign_id, call, "system", "Client approved a higher ceiling — continuing.", ts + 2)
    else:
        await _say(db, campaign_id, call, "system", "No pickup — capping at budget and continuing.", ts + 2)


async def _dispatch_live(db, campaign_id: str, call: Call, vendor: Vendor, payload: dict,
                         resolved: dict, region_key: str) -> bool:
    """Place a real outbound call through the ElevenLabs Caller Agent. Tags the call
    with campaign_id + call_id as dynamic variables so the post-call webhook can route
    the transcript back to this campaign. Returns True if the live call was accepted."""
    store = get_store()
    if not vendor.phone_e164:
        return False
    phone_id = settings.elevenlabs_phone_number_id
    dynamic_variables = {
        "campaign_id": campaign_id,
        "call_id": call.id,
        "vendor_name": vendor.name,
        "category": vendor.category,
        "segment_key": call.segment_key_at_start,
        "spec_summary": spec_summary(payload),
        "segment_display": store.segment(call.segment_key_at_start).get("display_name", ""),
    }
    try:
        result = await elevenlabs_connector.initiate_outbound_call(
            phone_id, vendor.phone_e164, dynamic_variables)
    except Exception as exc:  # noqa: BLE001 — never let a live failure kill the campaign
        await bus.publish(campaign_id, "call.phase", {"call_id": call.id, "phase": "dialing"})
        await _say(db, campaign_id, call, "system",
                   f"Live dial failed ({str(exc)[:80]}) — using simulation.", 0)
        return False
    call.twilio_sid = result.get("conversation_id", result.get("callSid", ""))
    call.phase = "dialing"
    db.commit()
    await bus.publish(campaign_id, "call.live", {
        "call_id": call.id, "vendor_name": vendor.name,
        "conversation_id": call.twilio_sid, "to": vendor.phone_e164,
    })
    return True


def _forced_outcome(vendor: Vendor) -> str:
    if vendor.category == "catering":
        return "quote"
    import hashlib
    h = int(hashlib.sha256(vendor.name.encode()).hexdigest()[:6], 16)
    if h % 7 == 0:
        return "callback"
    if h % 11 == 0:
        return "unreachable"
    return "quote"


def _open_quote(db, call: Call, vendor: Vendor, resolved: dict, cp: Counterparty) -> Quote:
    q = Quote(call_id=call.id, campaign_id=call.campaign_id, vendor_id=vendor.id,
              category=vendor.category, segment_key=call.segment_key_at_start, currency="USD",
              line_items=cp.base_line_items(), opening_total=cp.opening_total, total=cp.current,
              terms={"deposit_pct": 30, "deposit_refundable_until": (_now() + timedelta(days=30)).date().isoformat(),
                     "validity_days": 14, "binding": True},
              negotiation={"opening_total": cp.opening_total, "leverage_used": [], "leverage_available_unused": []},
              status="verified")
    db.add(q)
    db.commit()
    return q


async def _negotiate(db, campaign_id, call, vendor, cp, resolved, event_key, region_key,
                     payload, verified, quote, ts):
    store = get_store()
    applied = 0
    for _ in range(4):
        competitors = [v for v in verified if v["category"] == vendor.category and v["vendor"] != vendor.name]
        lev = leverage.get_verified_leverage(event_key, vendor.category, call.segment_key_final,
                                             payload, region_key, competitors, cp.current)
        # first applicable lever we haven't used yet
        used = {l["key"] for l in quote.negotiation.get("leverage_used", [])}
        candidate = next((l for l in lev["levers"] if l["key"] not in used), None)
        if not candidate or applied >= 3:
            break
        await _say(db, campaign_id, call, "agent", candidate["phrase"], ts, candidate["key"]); ts += 7
        from_total = cp.current
        concession = cp.apply_lever(candidate)
        await _say(db, campaign_id, call, "vendor", cp.concede_line(concession), ts); ts += 5
        used_entry = {"key": candidate["key"], "display": candidate["display"]}
        _append_lever(quote, used_entry)
        _record_observation(db, call.segment_key_final, candidate["key"], region_key,
                            moved=concession > 0, delta=(concession / from_total * 100) if from_total else 0)
        if concession > 0:
            quote.line_items = cp.base_line_items()
            quote.total = cp.current
            db.commit()
            pe = PriceEvent(quote_id=quote.id, call_id=call.id, from_total=from_total, to_total=cp.current,
                            trigger_utterance_id="", leverage_type=candidate["key"],
                            segment_key=call.segment_key_final, ts_s=ts, attributed=True)
            db.add(pe); db.commit()
            await bus.publish(campaign_id, "price.move", {
                "call_id": call.id, "vendor_name": vendor.name, "category": vendor.category,
                "from_total": from_total, "to_total": cp.current, "leverage": candidate["display"],
                "delta_pct": round((cp.current - from_total) / from_total * 100, 1) if from_total else 0,
            })
            await bus.publish(campaign_id, "quote.update", _quote_event(quote, vendor))
        applied += 1
        db.commit()


async def _reclassify(db, campaign_id, call, vendor, cp, event_key, region_key,
                      payload, verified, quote, true_seg, ts):
    store = get_store()
    reveal = (store.segment(true_seg).get("counterparty") or {}).get("reveal_signal", "")
    await _say(db, campaign_id, call, "vendor", reveal, ts); ts += 4
    rc = segment_classifier.reclassify(true_seg)
    call.segment_key_final = true_seg
    quote.segment_key = true_seg
    db.commit()
    await bus.publish(campaign_id, "segment.reclassified", {
        "call_id": call.id, "from_segment": call.segment_key_at_start, "to_segment": true_seg,
        "segment_display": rc["segment_display"], "note": rc["strategy_change_note"],
    })
    await _say(db, campaign_id, call, "agent",
               "Got it — then let me ask differently. We've got another event in the spring; "
               "is there room to start a relationship on this one?", ts, "relationship"); ts += 8
    # new strategy: relationship lever now available and strong
    resolved2 = leverage.resolve_config(event_key, vendor.category, true_seg)
    cp.resolved = resolved2
    cp.ceiling = store.segment(true_seg).get("resistance_profile", {}).get("typical_concession_ceiling", cp.ceiling)
    cp.max_conc = cp.opening_total * cp.ceiling
    lev = store.levers.get("relationship", {})
    from_total = cp.current
    concession = cp.apply_lever({"key": "relationship", "weight": 0.85, "unlock": lev.get("unlock", 0.35)})
    await _say(db, campaign_id, call, "vendor", cp.concede_line(concession), ts); ts += 5
    if concession > 0:
        quote.line_items = cp.base_line_items(); quote.total = cp.current; db.commit()
        pe = PriceEvent(quote_id=quote.id, call_id=call.id, from_total=from_total, to_total=cp.current,
                        trigger_utterance_id="", leverage_type="relationship", segment_key=true_seg, ts_s=ts)
        db.add(pe); db.commit()
        _append_lever(quote, {"key": "relationship", "display": "Relationship"}); db.commit()
        await bus.publish(campaign_id, "price.move", {
            "call_id": call.id, "vendor_name": vendor.name, "category": vendor.category,
            "from_total": from_total, "to_total": cp.current, "leverage": "Relationship (post-reclassify)",
            "delta_pct": round((cp.current - from_total) / from_total * 100, 1) if from_total else 0,
        })
        await bus.publish(campaign_id, "quote.update", _quote_event(quote, vendor))


async def _fee_challenge(db, campaign_id, call, vendor, cp, quote, resolved, region_key, ts):
    await _say(db, campaign_id, call, "agent",
               "Last thing — is that everything, or are there setup, delivery or service fees on top?",
               ts, "fee_challenge"); ts += 6
    revealed = cp.reveal_fees()
    await _say(db, campaign_id, call, "vendor", cp.fee_reveal_line(revealed), ts); ts += 5
    if revealed:
        quote.line_items = cp.base_line_items() + revealed
        quote.total = round(sum(li["amount"] for li in quote.line_items), 0)
        db.commit()
        await bus.publish(campaign_id, "quote.update", _quote_event(quote, vendor))


async def _finish(db, campaign_id, call, outcome, payload_out, cp, resolved, verified,
                  spec_payload, event_key, quote: Quote | None = None):
    store = get_store()
    call.status = "completed"
    call.outcome = outcome
    call.outcome_reason = payload_out.get("reason", "")
    call.phase = "closed"
    call.duration_s = max(90, int(cp.opening_total % 200) + 120)
    db.commit()

    if quote is not None and outcome == "quote":
        unit = resolved["normalization_unit"]
        guests = spec_payload.get("event", {}).get("guest_count", 25)
        if unit == "per_guest":
            quote.normalized_per_unit = round(quote.total / max(guests, 1), 2)
        elif unit == "per_hour":
            quote.normalized_per_unit = round(quote.total / 3, 2)
        else:
            quote.normalized_per_unit = quote.total
        # red flags need the segment benchmark
        bk = resolved["benchmark_key"].replace("{region_profile}", spec_payload["location"].get("region_profile", "us_ca"))
        median, _ = store.benchmark(bk, unit)
        flags = red_flag.evaluate(
            {"line_items": quote.line_items, "terms": quote.terms, "normalized_per_unit": quote.normalized_per_unit},
            resolved["category_key"], call.segment_key_final, median)
        for f in flags:
            db.add(RedFlag(quote_id=quote.id, rule_key=f["rule_key"], severity=f["severity"], detail=f["detail"]))
        # price movement is the NEGOTIATED subtotal vs opening (fees are surfaced
        # separately and must not mask the downward move from leverage)
        negotiated_subtotal = cp.current
        neg = dict(quote.negotiation)
        neg["negotiated_subtotal"] = negotiated_subtotal
        neg["delta_pct"] = round((negotiated_subtotal - quote.opening_total) / quote.opening_total * 100, 1) if quote.opening_total else 0
        quote.negotiation = neg
        db.commit()
        verified.append({"quote_id": quote.id, "total": quote.total, "category": call.category,
                         "vendor": db.get(Vendor, call.vendor_id).name})

    await bus.publish(campaign_id, "call.ended", {
        "call_id": call.id, "outcome": outcome, "reason": payload_out.get("reason", ""),
        "segment_final": call.segment_key_final,
        "quote_total": quote.total if quote else None,
    })


def _record_observation(db, segment_key, lever_key, region, moved, delta):
    obs = db.scalar(select(SegmentObservation).where(
        SegmentObservation.segment_key == segment_key,
        SegmentObservation.lever_key == lever_key,
        SegmentObservation.region_profile == region))
    if not obs:
        obs = SegmentObservation(segment_key=segment_key, lever_key=lever_key, region_profile=region,
                                 applied_count=0, moved_count=0, sum_delta_pct=0.0)
        db.add(obs)
        db.flush()
    obs.applied_count = (obs.applied_count or 0) + 1
    if moved:
        obs.moved_count = (obs.moved_count or 0) + 1
        obs.sum_delta_pct = (obs.sum_delta_pct or 0.0) + delta
    db.commit()


def _append_lever(quote: Quote, entry: dict) -> None:
    """Reassign the JSON column so SQLAlchemy detects the change (in-place .append
    on a JSON dict is not tracked)."""
    neg = dict(quote.negotiation)
    neg["leverage_used"] = list(neg.get("leverage_used", [])) + [entry]
    quote.negotiation = neg


def _quote_event(quote: Quote, vendor: Vendor) -> dict:
    return {
        "quote_id": quote.id, "call_id": quote.call_id, "vendor_id": vendor.id,
        "vendor_name": vendor.name, "category": quote.category, "segment_key": quote.segment_key,
        "opening_total": quote.opening_total, "total": quote.total,
        "line_items": quote.line_items,
    }


async def finalize_campaign(campaign_id: str, event_key: str, payload: dict) -> None:
    db = SessionLocal()
    try:
        quotes = db.scalars(select(Quote).join(Call).where(Call.campaign_id == campaign_id)).all()
        store = get_store()
        # attach data needed for ranking
        rank_input = []
        for q in quotes:
            call = db.get(Call, q.call_id)
            if call.outcome != "quote":
                continue
            vendor = db.get(Vendor, q.vendor_id)
            resolved = leverage.resolve_config(event_key, q.category, q.segment_key)
            flags = db.scalars(select(RedFlag).where(RedFlag.quote_id == q.id)).all()
            q_dict = {
                "quote_id": q.id, "category": q.category,
                "normalized_per_unit": q.normalized_per_unit,
                "completeness": ranking.completeness_ratio(q.line_items, resolved["expected_line_items"]),
                "red_flags": [{"severity": f.severity} for f in flags],
                "rating": vendor.rating, "review_count": vendor.review_count,
                "_obj": q,
            }
            rank_input.append(q_dict)
        ranking.rank_quotes(rank_input, event_key)
        for r in rank_input:
            q = r["_obj"]
            q.score = r["score"]; q.score_breakdown = r["score_breakdown"]; q.rank = r["rank"]
        db.commit()

        # budget guard
        best_by_cat: dict[str, float] = {}
        for r in rank_input:
            if r["rank"] == 1:
                best_by_cat[r["category"]] = r["_obj"].total
        bg = budget_guard.evaluate(payload.get("budget", {}), best_by_cat)

        campaign = db.get(Campaign, campaign_id)
        campaign.status = "completed"
        campaign.finished_at = _now()
        db.commit()

        await bus.publish(campaign_id, "campaign.completed", {
            "campaign_id": campaign_id, "budget": bg,
            "recommended_total": round(sum(best_by_cat.values()), 0),
        })
    finally:
        db.close()
