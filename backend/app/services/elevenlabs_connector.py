"""Real ElevenLabs Agents Platform connector.

Registers the Caller Agent's server tools, mints signed URLs for the media stream,
and (preferred path) triggers native outbound calls that ElevenLabs runs over Twilio.
Used by CALL_MODE=live. Nothing here runs unless ELEVENLABS_API_KEY is set.
"""
from __future__ import annotations

import httpx

from ..config import settings

EL_API = "https://api.elevenlabs.io/v1"


def _headers() -> dict:
    return {"xi-api-key": settings.elevenlabs_api_key, "Content-Type": "application/json"}


async def get_signed_url(agent_id: str) -> str:
    """Signed websocket URL for a conversation (used when bridging Twilio media)."""
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(
            f"{EL_API}/convai/conversation/get-signed-url",
            headers={"xi-api-key": settings.elevenlabs_api_key},
            params={"agent_id": agent_id},
        )
        r.raise_for_status()
        return r.json()["signed_url"]


async def initiate_outbound_call(agent_phone_number_id: str, to_number: str,
                                 dynamic_variables: dict) -> dict:
    """Preferred live path: ElevenLabs drives the Twilio outbound leg. `dynamic_variables`
    carries the verbatim spec summary, segment profile, levers and consent script so the
    same job is described identically on every call (spec 16.2 / 16.4)."""
    if not settings.elevenlabs_api_key:
        raise RuntimeError("ElevenLabs is not configured (set ELEVENLABS_API_KEY for CALL_MODE=live).")
    body = {
        "agent_id": settings.elevenlabs_agent_id,
        "agent_phone_number_id": agent_phone_number_id,
        "to_number": to_number,
        "conversation_initiation_client_data": {
            "dynamic_variables": dynamic_variables,
        },
    }
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(f"{EL_API}/convai/twilio/outbound-call",
                              headers=_headers(), json=body)
        r.raise_for_status()
        return r.json()


async def test_outbound_call(agent_phone_number_id: str, to_number: str) -> dict:
    """One-shot diagnostic: place a single outbound call and return the REAL ElevenLabs
    response or error body (status + text), never raising. Used by the Settings
    'Test call' button so failures are visible instead of silently simulated."""
    if not settings.elevenlabs_api_key:
        return {"ok": False, "error": "ELEVENLABS_API_KEY is not set."}
    body = {
        "agent_id": settings.elevenlabs_agent_id,
        "agent_phone_number_id": agent_phone_number_id,
        "to_number": to_number,
        "conversation_initiation_client_data": {
            # provide the full set a campaign call sends, so the agent's prompt never
            # references an undefined {{variable}} (a common cause of a 1-second drop)
            "dynamic_variables": {
                "vendor_name": "Test Vendor",
                "category": "catering",
                "segment_key": "catering__full_service",
                "segment_display": "Full-service caterer",
                "spec_summary": "a quick test call from SayWhen",
                "campaign_id": "test",
                "call_id": "test",
            },
        },
    }
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(f"{EL_API}/convai/twilio/outbound-call",
                                  headers=_headers(), json=body)
    except Exception as exc:  # noqa: BLE001 — surface the network error verbatim
        return {"ok": False, "error": f"Network error reaching ElevenLabs: {exc}"[:400]}
    if r.status_code >= 400:
        return {"ok": False, "status": r.status_code, "error": (r.text or r.reason_phrase)[:400]}
    return {"ok": True, "status": r.status_code, "response": r.json()}


async def verify_connection() -> dict:
    """Best-effort health check for the dashboard's connector card. Confirms the API
    key works and the configured Caller Agent + phone numbers exist. Never raises —
    returns a structured status the UI can render even when live calls are off."""
    status = {
        "configured": bool(settings.elevenlabs_api_key),
        "agent_id": settings.elevenlabs_agent_id or "",
        "call_mode": settings.call_mode,
        "connected": False,
        "agent_name": "",
        "voice_id": "",
        "phone_numbers": [],
        "error": "",
    }
    if not settings.elevenlabs_api_key:
        status["error"] = "ELEVENLABS_API_KEY not set — running in simulation."
        return status
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            if settings.elevenlabs_agent_id:
                r = await client.get(f"{EL_API}/convai/agents/{settings.elevenlabs_agent_id}",
                                     headers={"xi-api-key": settings.elevenlabs_api_key})
                r.raise_for_status()
                data = r.json()
                status["agent_name"] = data.get("name", "")
                status["voice_id"] = (((data.get("conversation_config") or {})
                                       .get("tts") or {}).get("voice_id", ""))
            pn = await client.get(f"{EL_API}/convai/phone-numbers",
                                  headers={"xi-api-key": settings.elevenlabs_api_key})
            if pn.status_code == 200:
                body = pn.json()
                rows = body if isinstance(body, list) else body.get("phone_numbers", [])
                status["phone_numbers"] = [
                    {"id": p.get("phone_number_id") or p.get("id", ""),
                     "label": p.get("label", ""), "number": p.get("phone_number", "")}
                    for p in rows
                ]
        status["connected"] = True
    except Exception as exc:  # noqa: BLE001 — health check must not crash the dashboard
        status["error"] = str(exc)[:200]
    return status


async def get_transcript(conversation_id: str) -> dict:
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(f"{EL_API}/convai/conversations/{conversation_id}",
                             headers={"xi-api-key": settings.elevenlabs_api_key})
        r.raise_for_status()
        return r.json()


async def conversation_status(conversation_id: str) -> dict:
    """Diagnostic: ask ElevenLabs how a conversation actually went — status, how it
    ended (termination_reason) and how many turns happened. A call that Twilio shows
    as 'answered, 1 sec' with 0 turns here failed to initialise the agent. Never raises."""
    if not settings.elevenlabs_api_key:
        return {"ok": False, "error": "ELEVENLABS_API_KEY not set."}
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.get(f"{EL_API}/convai/conversations/{conversation_id}",
                                 headers={"xi-api-key": settings.elevenlabs_api_key})
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Network error: {exc}"[:300]}
    if r.status_code == 404:
        return {"ok": True, "pending": True, "status": "not_ready",
                "note": "ElevenLabs hasn't logged this conversation yet — retry in a moment."}
    if r.status_code >= 400:
        return {"ok": False, "status": r.status_code, "error": (r.text or r.reason_phrase)[:300]}
    data = r.json()
    meta = data.get("metadata") or {}
    turns = len([t for t in (data.get("transcript") or []) if t.get("message")])
    return {
        "ok": True,
        "status": data.get("status", ""),                       # e.g. done | failed | in-progress
        "termination_reason": meta.get("termination_reason", ""),
        "duration_secs": meta.get("call_duration_secs", 0),
        "turns": turns,
    }


def build_dynamic_variables(prompt_ctx: dict) -> dict:
    """Flatten the resolved leverage/spec context into ElevenLabs dynamic variables."""
    return {
        "spec_summary": prompt_ctx.get("spec_summary", ""),
        "segment_display": prompt_ctx.get("segment_display", ""),
        "bottleneck": prompt_ctx.get("bottleneck", ""),
        "concession_ceiling": str(prompt_ctx.get("concession_ceiling", "")),
        "consent_line": prompt_ctx.get("consent_line", ""),
        "levers_block": prompt_ctx.get("levers_block", ""),
        "harmful_block": prompt_ctx.get("harmful_block", ""),
        "objectives_block": prompt_ctx.get("objectives_block", ""),
        "expected_line_items": prompt_ctx.get("expected_line_items", ""),
    }
