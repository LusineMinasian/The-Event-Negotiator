"""Twilio Media Streams endpoint — the receiving end of the real-time bridge.

When we place a bridged call, we register the call's context under a one-time key and
hand Twilio a <Connect><Stream> pointing at wss://…/api/telephony/stream/{key}. Twilio
connects here once the call is answered; we then bridge it to the ElevenLabs agent
(services.media_bridge) so transcript + prices stream live onto the campaign bus.
"""
from fastapi import APIRouter, WebSocket

from ..services import media_bridge

router = APIRouter(prefix="/api/telephony", tags=["telephony"])

# key -> {campaign_id, call_id, dynamic_variables}. Consumed once when Twilio connects.
_pending: dict[str, dict] = {}


def register(key: str, ctx: dict) -> None:
    _pending[key] = ctx


@router.websocket("/stream/{key}")
async def stream(ws: WebSocket, key: str) -> None:
    await ws.accept()
    ctx = _pending.pop(key, None)
    if not ctx:
        await ws.close(code=4404)
        return
    try:
        await media_bridge.run_bridge(ws, ctx["campaign_id"], ctx["call_id"], ctx["dynamic_variables"])
    except Exception:  # noqa: BLE001 — a broken bridge must never take down the server
        try:
            await ws.close()
        except Exception:  # noqa: BLE001
            pass
