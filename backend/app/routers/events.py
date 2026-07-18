from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import current_user
from ..db import get_db
from ..models import Event, Spec, User
from ..schemas import EventCreateIn
from ..services import spec_builder

router = APIRouter(prefix="/api/events", tags=["events"])


@router.post("")
def create_event(body: EventCreateIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    event = Event(user_id=user.id, type=body.type, region_profile=body.region_profile, status="draft")
    db.add(event)
    db.commit()
    payload = spec_builder.default_payload(body.type, body.region_profile)
    spec = Spec(event_id=event.id, version=1, payload=payload, theme_tokens=payload["style"]["theme_tokens"])
    db.add(spec)
    db.commit()
    return {"event_id": event.id, "spec_id": spec.id, "payload": payload}


@router.get("")
def list_events(user: User = Depends(current_user), db: Session = Depends(get_db)):
    events = db.scalars(select(Event).where(Event.user_id == user.id).order_by(Event.created_at.desc())).all()
    out = []
    for e in events:
        spec = db.scalar(select(Spec).where(Spec.event_id == e.id).order_by(Spec.version.desc()))
        out.append({"id": e.id, "type": e.type, "region_profile": e.region_profile,
                    "status": e.status, "created_at": e.created_at.isoformat(),
                    "spec_id": spec.id if spec else None,
                    "confirmed": bool(spec and spec.confirmed_at)})
    return {"events": out}


@router.get("/{event_id}")
def get_event(event_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    event = db.get(Event, event_id)
    if not event or event.user_id != user.id:
        raise HTTPException(404, "Event not found")
    spec = db.scalar(select(Spec).where(Spec.event_id == event.id).order_by(Spec.version.desc()))
    return {"id": event.id, "type": event.type, "region_profile": event.region_profile,
            "status": event.status, "spec_id": spec.id if spec else None,
            "payload": spec.payload if spec else None,
            "confirmed": bool(spec and spec.confirmed_at)}
