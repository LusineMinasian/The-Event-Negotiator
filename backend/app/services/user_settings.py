"""Per-user API keys applied onto the process settings.

The connectors all read the global `settings` singleton. Rather than thread a
per-request config through every call site, we overlay the requesting user's
saved keys onto `settings` at the start of each authenticated request (see
auth.current_user). Each field falls back to the environment baseline captured
at import, so clearing a user key restores whatever the deployment provides.

Single-process / effectively single-tenant: the last authenticated request wins
for concurrent multi-user use. Good enough for the demo; the UI says as much.
"""
from __future__ import annotations

from ..config import settings

# (field, human label, is_secret) — is_secret controls masking in the API.
FIELDS: list[tuple[str, str, bool]] = [
    ("elevenlabs_api_key", "ElevenLabs API key", True),
    ("elevenlabs_agent_id", "ElevenLabs caller agent ID", False),
    ("elevenlabs_intake_agent_id", "ElevenLabs voice-intake agent ID", False),
    ("elevenlabs_phone_number_id", "ElevenLabs phone number ID", False),
    ("simulation_phone_number", "Your phone number (E.164, e.g. +37499…)", False),
    ("twilio_account_sid", "Twilio Account SID", False),
    ("twilio_auth_token", "Twilio auth token", True),
    ("twilio_from_number", "Twilio from number", False),
    ("google_places_api_key", "Google Places API key", True),
    ("anthropic_api_key", "Anthropic API key", True),
]
FIELD_KEYS = [f[0] for f in FIELDS]

# Baseline from the environment (.env), captured before any user override.
_ENV_BASE: dict[str, str] = {f: getattr(settings, f, "") or "" for f in FIELD_KEYS}
_ENV_CALL_MODE: str = settings.call_mode


def apply_to_settings(data: dict) -> None:
    """Overlay a user's saved keys onto the process settings (env as fallback)."""
    for key in FIELD_KEYS:
        val = (data.get(key) or "").strip()
        setattr(settings, key, val or _ENV_BASE[key])
    mode = (data.get("call_mode") or "").strip()
    settings.call_mode = mode if mode in ("simulation", "live") else _ENV_CALL_MODE


def apply_for_user(db, user) -> None:
    """Load and apply the given user's saved keys. Safe to call every request."""
    from ..models import UserSecret
    sec = db.get(UserSecret, user.id)
    apply_to_settings(sec.data if sec and sec.data else {})


def _mask(value: str, secret: bool) -> str:
    if not value:
        return ""
    if not secret:
        return value  # ids / phone numbers aren't sensitive — show them
    return "••••" + value[-4:] if len(value) > 4 else "••••"


def status(data: dict) -> dict:
    """Masked view of a user's saved keys + what the environment already provides."""
    data = data or {}
    fields = []
    for key, label, secret in FIELDS:
        saved = (data.get(key) or "").strip()
        fields.append({
            "key": key, "label": label, "secret": secret,
            "saved": bool(saved), "preview": _mask(saved, secret),
            "env_fallback": bool(_ENV_BASE[key]),
        })
    return {
        "fields": fields,
        "call_mode": (data.get("call_mode") or _ENV_CALL_MODE),
        "live_calls_available": settings.live_calls_available,
        "demo_call_available": settings.demo_call_available,
    }
