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

from fastapi import APIRouter, Depends, HTTPException, Request

from ..auth import current_user
from ..config import settings
from ..db import SessionLocal
from ..models import Campaign, User
from ..services import elevenlabs_connector
from ..services.event_bus import bus

router = APIRouter(prefix="/api/integrations", tags=["integrations"])


@router.get("/elevenlabs")
async def elevenlabs_status(user: User = Depends(current_user)) -> dict:
    return await elevenlabs_connector.verify_connection()


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
