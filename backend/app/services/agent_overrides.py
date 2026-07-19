"""In-memory, per-segment agent behavior overrides set from the UI.

Lets a user shape how the negotiation agent behaves for a given segment:
- prioritized levers are pushed FIRST (weight bumped to the top of the order),
- muted levers are never used (removed from the available set).

Applied by the leverage engine at resolve time (see engines/leverage.resolve_config),
so edits genuinely change which levers the agent leans on in the next calls.
Not persisted across restarts — this is a live demo control, not stored config.
"""
from __future__ import annotations

from threading import Lock

_LOCK = Lock()
_OVERRIDES: dict[str, dict] = {}


def get(segment_key: str) -> dict | None:
    return _OVERRIDES.get(segment_key)


def set_override(segment_key: str, prioritized, muted) -> dict:
    ov = {
        "prioritized": list(dict.fromkeys(prioritized or [])),
        "muted": list(dict.fromkeys(muted or [])),
    }
    with _LOCK:
        _OVERRIDES[segment_key] = ov
    return ov


def clear(segment_key: str) -> None:
    with _LOCK:
        _OVERRIDES.pop(segment_key, None)
