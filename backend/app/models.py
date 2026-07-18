"""ORM models — a pragmatic subset of the spec's data model (section 4.4)."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def _uuid(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


def now() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: _uuid("usr"))
    email: Mapped[str] = mapped_column(String, unique=True, index=True)
    name: Mapped[str] = mapped_column(String, default="")
    password_hash: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class Event(Base):
    __tablename__ = "events"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: _uuid("evt"))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    type: Mapped[str] = mapped_column(String)  # wedding | birthday | baby_shower
    region_profile: Mapped[str] = mapped_column(String, default="eu_de_ch")
    status: Mapped[str] = mapped_column(String, default="draft")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

    specs: Mapped[list["Spec"]] = relationship(back_populates="event")


class Spec(Base):
    __tablename__ = "specs"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: _uuid("spc"))
    event_id: Mapped[str] = mapped_column(ForeignKey("events.id"), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    spec_hash: Mapped[str] = mapped_column(String, default="")
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    theme_tokens: Mapped[dict] = mapped_column(JSON, default=dict)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

    event: Mapped["Event"] = relationship(back_populates="specs")


class Vendor(Base):
    __tablename__ = "vendors"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: _uuid("vnd"))
    campaign_id: Mapped[str | None] = mapped_column(ForeignKey("campaigns.id"), nullable=True, index=True)
    source: Mapped[str] = mapped_column(String, default="seed")
    external_id: Mapped[str] = mapped_column(String, default="")
    name: Mapped[str] = mapped_column(String)
    phone_e164: Mapped[str] = mapped_column(String, default="")
    category: Mapped[str] = mapped_column(String)
    segment_key: Mapped[str] = mapped_column(String, default="")
    segment_confidence: Mapped[float] = mapped_column(Float, default=0.0)
    rating: Mapped[float] = mapped_column(Float, default=0.0)
    review_count: Mapped[int] = mapped_column(Integer, default=0)
    price_level: Mapped[int] = mapped_column(Integer, default=2)
    distance_km: Mapped[float] = mapped_column(Float, default=0.0)
    enrichment: Mapped[dict] = mapped_column(JSON, default=dict)
    excluded: Mapped[bool] = mapped_column(Boolean, default=False)


class Campaign(Base):
    __tablename__ = "campaigns"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: _uuid("cmp"))
    spec_id: Mapped[str] = mapped_column(ForeignKey("specs.id"), index=True)
    event_id: Mapped[str] = mapped_column(ForeignKey("events.id"), index=True)
    status: Mapped[str] = mapped_column(String, default="planning")
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class Call(Base):
    __tablename__ = "calls"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: _uuid("call"))
    campaign_id: Mapped[str] = mapped_column(ForeignKey("campaigns.id"), index=True)
    vendor_id: Mapped[str] = mapped_column(ForeignKey("vendors.id"), index=True)
    spec_hash: Mapped[str] = mapped_column(String, default="")
    category: Mapped[str] = mapped_column(String, default="")
    segment_key_at_start: Mapped[str] = mapped_column(String, default="")
    segment_key_final: Mapped[str] = mapped_column(String, default="")
    phase: Mapped[str] = mapped_column(String, default="queued")
    status: Mapped[str] = mapped_column(String, default="queued")
    outcome: Mapped[str] = mapped_column(String, default="")
    outcome_reason: Mapped[str] = mapped_column(String, default="")
    duration_s: Mapped[int] = mapped_column(Integer, default=0)
    twilio_sid: Mapped[str] = mapped_column(String, default="")
    recording_url: Mapped[str] = mapped_column(String, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class Utterance(Base):
    __tablename__ = "utterances"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: _uuid("utt"))
    call_id: Mapped[str] = mapped_column(ForeignKey("calls.id"), index=True)
    ts_s: Mapped[int] = mapped_column(Integer, default=0)
    speaker: Mapped[str] = mapped_column(String)  # agent | vendor | system
    text: Mapped[str] = mapped_column(Text)
    lever_key: Mapped[str] = mapped_column(String, default="")


class Quote(Base):
    __tablename__ = "quotes"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: _uuid("qt"))
    call_id: Mapped[str] = mapped_column(ForeignKey("calls.id"), index=True)
    campaign_id: Mapped[str] = mapped_column(ForeignKey("campaigns.id"), index=True)
    vendor_id: Mapped[str] = mapped_column(ForeignKey("vendors.id"), index=True)
    category: Mapped[str] = mapped_column(String)
    segment_key: Mapped[str] = mapped_column(String, default="")
    currency: Mapped[str] = mapped_column(String, default="CHF")
    line_items: Mapped[list] = mapped_column(JSON, default=list)
    opening_total: Mapped[float] = mapped_column(Float, default=0.0)
    total: Mapped[float] = mapped_column(Float, default=0.0)
    normalized_per_unit: Mapped[float] = mapped_column(Float, default=0.0)
    terms: Mapped[dict] = mapped_column(JSON, default=dict)
    negotiation: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String, default="verified")
    score: Mapped[float] = mapped_column(Float, default=0.0)
    score_breakdown: Mapped[dict] = mapped_column(JSON, default=dict)
    rank: Mapped[int] = mapped_column(Integer, default=0)


class PriceEvent(Base):
    __tablename__ = "price_events"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: _uuid("pe"))
    quote_id: Mapped[str] = mapped_column(ForeignKey("quotes.id"), index=True)
    call_id: Mapped[str] = mapped_column(ForeignKey("calls.id"), index=True)
    from_total: Mapped[float] = mapped_column(Float)
    to_total: Mapped[float] = mapped_column(Float)
    trigger_utterance_id: Mapped[str] = mapped_column(String, default="")
    leverage_type: Mapped[str] = mapped_column(String, default="")
    segment_key: Mapped[str] = mapped_column(String, default="")
    ts_s: Mapped[int] = mapped_column(Integer, default=0)
    attributed: Mapped[bool] = mapped_column(Boolean, default=True)


class RedFlag(Base):
    __tablename__ = "red_flags"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: _uuid("rf"))
    quote_id: Mapped[str] = mapped_column(ForeignKey("quotes.id"), index=True)
    rule_key: Mapped[str] = mapped_column(String)
    severity: Mapped[str] = mapped_column(String)
    detail: Mapped[str] = mapped_column(String, default="")
    evidence_utterance_id: Mapped[str] = mapped_column(String, default="")


class Handoff(Base):
    __tablename__ = "handoffs"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: _uuid("ho"))
    call_id: Mapped[str] = mapped_column(ForeignKey("calls.id"), index=True)
    reason: Mapped[str] = mapped_column(String)
    urgency: Mapped[str] = mapped_column(String, default="medium")
    context: Mapped[str] = mapped_column(Text, default="")
    requested_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    resolved_by: Mapped[str] = mapped_column(String, default="")


class SegmentObservation(Base):
    __tablename__ = "segment_observations"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: _uuid("so"))
    segment_key: Mapped[str] = mapped_column(String, index=True)
    lever_key: Mapped[str] = mapped_column(String, index=True)
    region_profile: Mapped[str] = mapped_column(String, default="")
    applied_count: Mapped[int] = mapped_column(Integer, default=0)
    moved_count: Mapped[int] = mapped_column(Integer, default=0)
    sum_delta_pct: Mapped[float] = mapped_column(Float, default=0.0)


class CustomSegment(Base):
    __tablename__ = "custom_segments"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: _uuid("seg"))
    key: Mapped[str] = mapped_column(String, index=True)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    created_from: Mapped[str] = mapped_column(String, default="clone")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
