"""User Settings — let a logged-in user store their own API keys for everything
(ElevenLabs / Twilio / Google / Anthropic) and flip call mode. Keys are applied
onto the process settings so the connectors pick them up (services.user_settings).
"""
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..auth import current_user
from ..db import get_db
from ..models import User, UserSecret
from ..services import user_settings

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
