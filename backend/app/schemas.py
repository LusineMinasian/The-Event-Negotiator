"""Pydantic request/response schemas (the light ones; many payloads stay as dicts)."""
from __future__ import annotations

from pydantic import BaseModel, EmailStr


class RegisterIn(BaseModel):
    email: EmailStr
    password: str
    name: str = ""


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class TokenOut(BaseModel):
    token: str
    user: dict


class EventCreateIn(BaseModel):
    type: str
    region_profile: str = "us_ca"


class SpecPatchIn(BaseModel):
    payload: dict


class DiscoverIn(BaseModel):
    target_per_category: int = 4


class CampaignStartIn(BaseModel):
    pass
