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


async def get_transcript(conversation_id: str) -> dict:
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(f"{EL_API}/convai/conversations/{conversation_id}",
                             headers={"xi-api-key": settings.elevenlabs_api_key})
        r.raise_for_status()
        return r.json()


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
