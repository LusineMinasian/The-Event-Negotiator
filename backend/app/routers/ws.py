from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..auth import decode_token
from ..services.event_bus import bus

router = APIRouter()


@router.websocket("/api/ws/campaigns/{campaign_id}")
async def campaign_ws(websocket: WebSocket, campaign_id: str, token: str = ""):
    if not decode_token(token):
        await websocket.close(code=4401)
        return
    await websocket.accept()
    # Subscribe BEFORE snapshotting history, so any event published during replay lands
    # in the queue and isn't lost. Then replay history and skip queue events we already
    # replayed (seq <= last replayed) — history holds every event up to that seq.
    q = bus.subscribe(campaign_id)
    try:
        history = bus.history(campaign_id)
        last_replayed = history[-1]["seq"] if history else 0
        for msg in history:
            await websocket.send_json(msg)
        while True:
            msg = await q.get()
            if msg.get("seq", 0) <= last_replayed:
                continue
            await websocket.send_json(msg)
    except WebSocketDisconnect:
        pass
    finally:
        bus.unsubscribe(campaign_id, q)
