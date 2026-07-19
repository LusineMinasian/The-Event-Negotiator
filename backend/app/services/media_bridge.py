"""Real-time telephony bridge: Twilio Media Streams <-> ElevenLabs Conversational WS.

WE own the media, so we get the transcript live during the call (ElevenLabs sends
`user_transcript` / `agent_response` events per turn), and forward them straight onto the
campaign's event bus. Audio is transcoded with the stdlib `audioop`:
  Twilio  μ-law 8kHz  ->  PCM16 8kHz  ->  PCM16 16kHz  ->  ElevenLabs
  ElevenLabs PCM16 16kHz -> PCM16 8kHz -> μ-law 8kHz  ->  Twilio

Used only when settings.bridge_call_available (full Twilio + agent + public base URL).
The audio path can't be exercised without a live call; the transcode + transcript
routing are unit-tested.
"""
from __future__ import annotations

import asyncio
import base64
import json

import websockets

from ..config import settings
from ..db import SessionLocal
from ..models import Call, Vendor
from . import caller, elevenlabs_connector
from .event_bus import bus

try:  # stdlib in ≤3.12, removed in 3.13 — the bridge needs it for μ-law transcoding
    import audioop
    AVAILABLE = True
except Exception:  # noqa: BLE001
    audioop = None  # type: ignore
    AVAILABLE = False


async def run_bridge(twilio_ws, campaign_id: str, call_id: str, dynamic_variables: dict) -> None:
    """Bridge one answered Twilio call to the ElevenLabs agent until either side hangs up."""
    db = SessionLocal()
    call = db.get(Call, call_id)
    currency = dynamic_variables.pop("_currency", "USD")
    pricing = {"quote": None, "rate": caller._FX.get(currency, 1.0),
               "vendor": db.get(Vendor, call.vendor_id) if call else None}
    stream_sid: dict = {"v": None}
    in_state: dict = {"v": None}   # ratecv state, up-sample 8k->16k
    out_state: dict = {"v": None}  # ratecv state, down-sample 16k->8k
    ts_counter: dict = {"v": 0}

    signed = await elevenlabs_connector.get_signed_url(settings.elevenlabs_agent_id)
    el = await websockets.connect(signed, max_size=None)
    await el.send(json.dumps({
        "type": "conversation_initiation_client_data",
        "dynamic_variables": {k: v for k, v in dynamic_variables.items() if not k.startswith("_")},
    }))
    if call:
        await bus.publish(campaign_id, "call.phase", {"call_id": call.id, "phase": "live"})

    async def line(speaker: str, text: str) -> None:
        ts_counter["v"] += 3
        await caller.record_live_utterance(db, campaign_id, call, speaker, text, ts_counter["v"], pricing)

    async def pump_twilio() -> None:
        try:
            while True:
                m = json.loads(await twilio_ws.receive_text())
                ev = m.get("event")
                if ev == "start":
                    stream_sid["v"] = (m.get("start") or {}).get("streamSid")
                elif ev == "media":
                    ulaw = base64.b64decode(m["media"]["payload"])
                    pcm8 = audioop.ulaw2lin(ulaw, 2)
                    pcm16, in_state["v"] = audioop.ratecv(pcm8, 2, 1, 8000, 16000, in_state["v"])
                    await el.send(json.dumps({"user_audio_chunk": base64.b64encode(pcm16).decode()}))
                elif ev == "stop":
                    break
        except Exception:  # noqa: BLE001 — socket closed / malformed; end the bridge
            pass

    async def pump_el() -> None:
        try:
            async for raw in el:
                m = json.loads(raw)
                t = m.get("type")
                if t == "ping":
                    await el.send(json.dumps({"type": "pong", "event_id": (m.get("ping_event") or {}).get("event_id")}))
                elif t == "user_transcript":
                    txt = (m.get("user_transcription_event") or {}).get("user_transcript")
                    if txt:
                        await line("vendor", txt)     # the human on the phone
                elif t == "agent_response":
                    txt = (m.get("agent_response_event") or {}).get("agent_response")
                    if txt:
                        await line("agent", txt)
                elif t == "audio":
                    b64 = (m.get("audio_event") or {}).get("audio_base_64")
                    if b64 and stream_sid["v"]:
                        pcm16 = base64.b64decode(b64)
                        pcm8, out_state["v"] = audioop.ratecv(pcm16, 2, 1, 16000, 8000, out_state["v"])
                        ulaw = audioop.lin2ulaw(pcm8, 2)
                        await twilio_ws.send_text(json.dumps({
                            "event": "media", "streamSid": stream_sid["v"],
                            "media": {"payload": base64.b64encode(ulaw).decode()}}))
                elif t == "interruption":
                    if stream_sid["v"]:
                        await twilio_ws.send_text(json.dumps({"event": "clear", "streamSid": stream_sid["v"]}))
        except Exception:  # noqa: BLE001
            pass

    try:
        await asyncio.gather(pump_twilio(), pump_el())
    finally:
        try:
            await el.close()
        except Exception:  # noqa: BLE001
            pass
        if call:
            call.status = "completed"
            call.phase = "closed"
            call.outcome = call.outcome or ("quote" if pricing.get("quote") else "unreachable")
            db.commit()
            await bus.publish(campaign_id, "call.ended",
                              {"call_id": call.id, "outcome": call.outcome, "reason": "", "quote_total": None})
        db.close()
