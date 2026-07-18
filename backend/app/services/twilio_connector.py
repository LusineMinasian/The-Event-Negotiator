"""Real Twilio Voice connector.

Places genuine outbound PSTN calls via the Twilio REST API. Used by CALL_MODE=live.
Two supported wirings:

1. Preferred — ElevenLabs native outbound (see elevenlabs_connector.initiate_outbound_call).
   ElevenLabs drives the Twilio leg for you; you only register a number once.

2. Direct — this module dials the vendor and connects the audio to your ElevenLabs
   agent's media-stream websocket via TwiML <Connect><Stream>. Requires PUBLIC_BASE_URL
   to be a public https/wss host reachable by Twilio (e.g. an ngrok tunnel).

Nothing here runs unless the Twilio env vars are set; the simulation path is default.
"""
from __future__ import annotations

import base64

import httpx

from ..config import settings

TWILIO_API = "https://api.twilio.com/2010-04-01"


def _auth_header() -> dict:
    token = base64.b64encode(
        f"{settings.twilio_account_sid}:{settings.twilio_auth_token}".encode()
    ).decode()
    return {"Authorization": f"Basic {token}",
            "Content-Type": "application/x-www-form-urlencoded"}


def build_stream_twiml(consent_line: str, stream_ws_url: str, agent_id: str) -> str:
    """TwiML that speaks the AI-disclosure line, then bridges the call audio to the
    ElevenLabs agent over a media stream (bidirectional)."""
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<Response>"
        f"<Say>{consent_line}</Say>"
        "<Connect>"
        f'<Stream url="{stream_ws_url}">'
        f'<Parameter name="agent_id" value="{agent_id}"/>'
        "</Stream>"
        "</Connect>"
        "</Response>"
    )


async def place_call(to_number: str, twiml: str, status_callback: str | None = None) -> dict:
    """Create a real outbound call. Returns Twilio call resource (dict) incl. 'sid'."""
    if not (settings.twilio_account_sid and settings.twilio_auth_token and settings.twilio_from_number):
        raise RuntimeError("Twilio is not configured (set TWILIO_* env vars for CALL_MODE=live).")
    data = {
        "To": to_number,
        "From": settings.twilio_from_number,
        "Twiml": twiml,
        "Record": "true",
        "RecordingChannels": "dual",  # separate agent/vendor channels for price-move attribution
        "MachineDetection": "Enable",  # AMD (spec 17.2)
    }
    if status_callback:
        data["StatusCallback"] = status_callback
        data["StatusCallbackEvent"] = "initiated ringing answered completed"
    url = f"{TWILIO_API}/Accounts/{settings.twilio_account_sid}/Calls.json"
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(url, headers=_auth_header(), data=data)
        r.raise_for_status()
        return r.json()


async def fetch_recording(call_sid: str) -> str | None:
    url = f"{TWILIO_API}/Accounts/{settings.twilio_account_sid}/Calls/{call_sid}/Recordings.json"
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(url, headers=_auth_header())
        r.raise_for_status()
        recs = r.json().get("recordings", [])
        if not recs:
            return None
        return f"{TWILIO_API}/Accounts/{settings.twilio_account_sid}/Recordings/{recs[0]['sid']}.mp3"
