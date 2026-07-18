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
    # replay history so a late-joining War Room catches up
    for msg in bus.history(campaign_id):
        await websocket.send_json(msg)
    q = bus.subscribe(campaign_id)
    try:
        while True:
            msg = await q.get()
            await websocket.send_json(msg)
    except WebSocketDisconnect:
        pass
    finally:
        bus.unsubscribe(campaign_id, q)
