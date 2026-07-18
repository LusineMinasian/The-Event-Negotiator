from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..auth import current_user
from ..db import get_db
from ..models import Event, Spec, User
from ..engines import palette
from ..schemas import SpecPatchIn
from ..services import spec_builder

router = APIRouter(prefix="/api/specs", tags=["specs"])


def _load(spec_id: str, user: User, db: Session) -> Spec:
    spec = db.get(Spec, spec_id)
    if not spec:
        raise HTTPException(404, "Spec not found")
    event = db.get(Event, spec.event_id)
    if not event or event.user_id != user.id:
        raise HTTPException(403, "Not your spec")
    return spec


@router.get("/{spec_id}")
def get_spec(spec_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    spec = _load(spec_id, user, db)
    return {"spec_id": spec.id, "version": spec.version, "payload": spec.payload,
            "theme_tokens": spec.theme_tokens, "spec_hash": spec.spec_hash,
            "confirmed": bool(spec.confirmed_at)}


@router.patch("/{spec_id}")
def patch_spec(spec_id: str, body: SpecPatchIn, user: User = Depends(current_user),
               db: Session = Depends(get_db)):
    spec = _load(spec_id, user, db)
    if spec.confirmed_at:
        raise HTTPException(409, "Spec is frozen; create a new version to edit")
    merged = {**spec.payload, **body.payload}
    spec.payload = merged
    db.commit()
    return {"spec_id": spec.id, "payload": spec.payload}


@router.post("/{spec_id}/board")
async def upload_board(spec_id: str, file: UploadFile = File(...),
                       user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Document-intake path B + Palette Engine: extract a palette from an inspiration
    board image and recolor the UI (spec 5.2 / 21.3)."""
    spec = _load(spec_id, user, db)
    data = await file.read()
    pal = palette.extract_palette(data)
    if not pal:
        pal = palette.default_palette(spec.payload["event"]["type"])
    tokens = palette.generate_theme_tokens(pal)
    payload = dict(spec.payload)
    payload["style"] = {**payload.get("style", {}), "source": "inspiration_board",
                        "palette": pal, "theme_tokens": tokens}
    payload.setdefault("provenance", {}).setdefault("document_fields", [])
    if "style.palette" not in payload["provenance"]["document_fields"]:
        payload["provenance"]["document_fields"].append("style.palette")
    spec.payload = payload
    spec.theme_tokens = tokens
    db.commit()
    return {"palette": pal, "theme_tokens": tokens}


@router.post("/{spec_id}/confirm")
def confirm_spec(spec_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    spec = _load(spec_id, user, db)
    missing = _missing_required(spec.payload)
    if missing:
        raise HTTPException(400, f"Missing required fields: {', '.join(missing)}")
    h = spec_builder.compute_hash(spec.payload)
    payload = dict(spec.payload)
    payload["spec_hash"] = h
    spec.payload = payload
    spec.spec_hash = h
    from datetime import datetime, timezone
    spec.confirmed_at = datetime.now(timezone.utc)
    event = db.get(Event, spec.event_id)
    event.status = "confirmed"
    db.commit()
    return {"spec_id": spec.id, "spec_hash": h, "confirmed": True}


def _missing_required(payload: dict) -> list[str]:
    from ..config_loader import get_store
    ev = get_store().event(payload["event"]["type"])
    missing = []
    for field in ev.get("required_spec_fields", []):
        cur = payload
        ok = True
        for part in field.split("."):
            if isinstance(cur, dict) and part in cur and cur[part] not in (None, "", 0):
                cur = cur[part]
            else:
                ok = False
                break
        if not ok:
            missing.append(field)
    return missing
