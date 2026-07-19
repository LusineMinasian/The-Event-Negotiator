"""User Settings — let a logged-in user store their own API keys for everything
(ElevenLabs / Twilio / Google / Anthropic) and flip call mode. Keys are applied
onto the process settings so the connectors pick them up (services.user_settings).
"""
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..auth import current_user
from ..config import settings
from ..db import get_db
from ..models import User, UserSecret
from ..services import elevenlabs_connector, user_settings

router = APIRouter(prefix="/api/settings", tags=["settings"])


class KeysIn(BaseModel):
    values: dict[str, str] = {}          # field -> value ("" clears it)
    call_mode: str | None = None         # "simulation" | "live"


@router.get("/keys")
def get_keys(user: User = Depends(current_user), db: Session = Depends(get_db)):
    sec = db.get(UserSecret, user.id)
    return user_settings.status(sec.data if sec else {})


@router.put("/keys")
def put_keys(body: KeysIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    sec = db.get(UserSecret, user.id)
    merged = dict(sec.data) if sec and sec.data else {}
    for key in user_settings.FIELD_KEYS:
        if key in body.values:
            merged[key] = (body.values[key] or "").strip()
    if body.call_mode in ("simulation", "live"):
        merged["call_mode"] = body.call_mode
    if sec:
        sec.data = merged
    else:
        sec = UserSecret(user_id=user.id, data=merged)
        db.add(sec)
    db.commit()
    user_settings.apply_to_settings(merged)      # take effect immediately
    return user_settings.status(merged)


@router.post("/test-call")
async def test_call(user: User = Depends(current_user)):
    """Diagnostic: place ONE real call to your saved number and report exactly what
    ElevenLabs said. current_user has already applied this user's keys to settings."""
    missing = [label for field, label in [
        ("elevenlabs_api_key", "ElevenLabs API key"),
        ("elevenlabs_agent_id", "caller agent ID"),
        ("elevenlabs_phone_number_id", "ElevenLabs phone number ID"),
        ("simulation_phone_number", "your phone number"),
    ] if not (getattr(settings, field, "") or "").strip()]
    if missing:
        return {"ok": False, "error": "Missing: " + ", ".join(missing) + ". Fill these in and Save first."}
    res = await elevenlabs_connector.test_outbound_call(
        settings.elevenlabs_phone_number_id, settings.simulation_phone_number)
    res["to"] = settings.simulation_phone_number
    return res
