"""ElevenLabs Agents connector surface.

Two jobs:
1. `GET /api/integrations/elevenlabs` — a live health check the dashboard renders in
   its connector card (configured? agent reachable? which phone numbers?).
2. `POST /api/integrations/elevenlabs/webhook` — the post-call ingestion path. When a
   real ElevenLabs conversation ends, its transcript is posted here and replayed onto
   the same event bus the War Room / dashboard already consume, so live calls light up
   the exact same UI as simulated ones.

The webhook is intentionally unauthenticated (an external service posts to it); it only
fans events onto an in-memory bus keyed by a campaign id it must carry.
"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException, Request

from ..auth import current_user
from ..config import settings
from ..db import SessionLocal
from ..models import Campaign, User
from ..services import elevenlabs_connector, google_connector, twilio_connector
from ..services.event_bus import bus

router = APIRouter(prefix="/api/integrations", tags=["integrations"])


@router.get("/elevenlabs")
async def elevenlabs_status(user: User = Depends(current_user)) -> dict:
    return await elevenlabs_connector.verify_connection()


@router.get("/elevenlabs/intake-signed-url")
async def intake_signed_url(user: User = Depends(current_user)) -> dict:
    """Connection details for the conversational intake agent (the voice studio).

    The intake agent is public (enable_auth=false), so the browser can connect over
    WebRTC with just the agent id and NO API key — the robust path. We therefore return
    `agent_id` whenever it's configured, even with no key. A signed URL is added as a
    fallback when a key is present. configured:false → the UI uses browser speech."""
    agent_id = settings.elevenlabs_intake_agent_id or settings.elevenlabs_agent_id
    if not agent_id:
        return {"configured": False, "reason": "ELEVENLABS_INTAKE_AGENT_ID not set"}
    resp = {"configured": True, "agent_id": agent_id}
    if settings.elevenlabs_api_key:
        try:
            resp["signed_url"] = await elevenlabs_connector.get_signed_url(agent_id)
        except Exception as exc:  # noqa: BLE001 — signed URL is optional; WebRTC-by-id still works
            resp["signed_url_error"] = str(exc)[:200]
    return resp


@router.get("/preflight")
async def preflight(user: User = Depends(current_user)) -> dict:
    """Actually exercise every outbound integration and report per-check status, so you
    can see — before a demo — whether real calls will work. Runs the live API probes
    concurrently. Each check is ok | fail | not_configured."""
    el, tw, gg = await asyncio.gather(
        elevenlabs_connector.verify_connection(),
        twilio_connector.verify_connection(),
        google_connector.verify_connection(),
    )

    def state(configured: bool, connected: bool) -> str:
        if not configured:
            return "not_configured"
        return "ok" if connected else "fail"

    checks = [
        {
            "id": "elevenlabs",
            "name": "ElevenLabs Agents",
            "status": state(el["configured"], el["connected"]),
            "detail": (f"Agent “{el['agent_name']}” · {len(el['phone_numbers'])} phone number(s)"
                       if el["connected"] else el.get("error", "")),
            "fix": "Set ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID.",
            "meta": {"agent_name": el.get("agent_name", ""), "phone_numbers": el.get("phone_numbers", [])},
        },
        {
            "id": "elevenlabs_phone",
            "name": "Caller phone number",
            "status": ("ok" if el["connected"] and (settings.elevenlabs_phone_number_id or el.get("phone_numbers"))
                       else ("not_configured" if not el["configured"] else "fail")),
            "detail": (f"{len(el.get('phone_numbers', []))} number(s) linked to the agent"
                       if el.get("phone_numbers") else
                       ("Set ELEVENLABS_PHONE_NUMBER_ID / link a number in Convai" if el["configured"] else "")),
            "fix": "In ElevenLabs → Conversational AI → Phone numbers, link a Twilio number to the agent; set ELEVENLABS_PHONE_NUMBER_ID.",
        },
        {
            "id": "twilio",
            "name": "Twilio Voice",
            "status": state(tw["configured"], tw["connected"]),
            "detail": (f"Account {tw['account_status']} · caller-id {tw['from_number'] or '— not set'}"
                       if tw["connected"] else tw.get("error", "")),
            "fix": "Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER.",
        },
        {
            "id": "google_places",
            "name": "Google Places (discovery)",
            "status": state(gg["configured"], gg["connected"]),
            "detail": ("Live market search enabled" if gg["connected"] else gg.get("error", "")),
            "fix": "Set GOOGLE_PLACES_API_KEY (Places API v1 enabled).",
        },
    ]

    # can we actually place a real outbound call end to end?
    can_call = (settings.call_mode == "live" and el["connected"] and
                bool(settings.elevenlabs_phone_number_id or el.get("phone_numbers")))
    return {
        "call_mode": settings.call_mode,
        "can_place_live_calls": can_call,
        "summary": ("Ready to place real calls" if can_call else
                    "Running in simulation — add credentials above to enable live calls"),
        "checks": checks,
    }


def _campaign_id(body: dict) -> str:
    """Locate the campaign id the outbound call was tagged with (we pass it as a
    dynamic variable when initiating the call)."""
    if body.get("campaign_id"):
        return body["campaign_id"]
    for path in (
        ("conversation_initiation_client_data", "dynamic_variables"),
        ("metadata",),
        ("data", "metadata"),
    ):
        node = body
        for key in path:
            node = node.get(key, {}) if isinstance(node, dict) else {}
        if isinstance(node, dict) and node.get("campaign_id"):
            return node["campaign_id"]
    return ""


@router.post("/elevenlabs/webhook")
async def elevenlabs_webhook(request: Request) -> dict:
    """Ingest a finished ElevenLabs conversation and replay it onto the bus.

    Accepts either a normalized event ({campaign_id, type, payload}) or a native
    ElevenLabs post-call payload carrying a `transcript` array."""
    # Optional shared-secret gate. When configured, reject unsigned/mismatched posts so
    # arbitrary callers can't inject events onto a campaign's stream.
    if settings.elevenlabs_webhook_secret:
        if request.headers.get("x-webhook-secret") != settings.elevenlabs_webhook_secret:
            raise HTTPException(401, "Invalid webhook secret")

    body = await request.json()
    campaign_id = _campaign_id(body)
    if not campaign_id:
        return {"ok": False, "reason": "no campaign_id in payload"}

    # Only accept events for a campaign that actually exists — prevents injection to
    # guessed/arbitrary ids from ballooning the in-memory bus.
    db = SessionLocal()
    try:
        if not db.get(Campaign, campaign_id):
            raise HTTPException(404, "Unknown campaign")
    finally:
        db.close()

    # already-normalized single event → republish verbatim
    if body.get("type") and "payload" in body:
        await bus.publish(campaign_id, body["type"], body["payload"])
        return {"ok": True, "published": 1}

    # native post-call: fan the transcript out as utterances, then close the call
    data = body.get("data", body)
    call_id = body.get("call_id") or data.get("conversation_id", "el_call")
    turns = data.get("transcript") or data.get("turns") or []
    published = 0
    for i, turn in enumerate(turns):
        role = turn.get("role") or turn.get("speaker") or "vendor"
        speaker = "agent" if role in ("agent", "assistant", "ai") else "vendor"
        text = turn.get("message") or turn.get("text") or ""
        if not text:
            continue
        await bus.publish(campaign_id, "utterance", {
            "call_id": call_id, "speaker": speaker, "text": text,
            "ts_s": turn.get("time_in_call_secs", i * 5), "lever_key": "",
        })
        published += 1
    await bus.publish(campaign_id, "call.ended", {
        "call_id": call_id, "outcome": "quote",
        "reason": "", "quote_total": None,
    })
    return {"ok": True, "published": published, "call_id": call_id}
