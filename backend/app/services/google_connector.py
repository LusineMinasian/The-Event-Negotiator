"""Google Places connector health check.

Discovery uses the Google Places API (Text Search) to build the real vendor call list
when GOOGLE_PLACES_API_KEY is set (see services/discovery.py). This module just verifies
the key works, for the preflight panel. Never raises.
"""
from __future__ import annotations

import httpx

from ..config import settings

PLACES_URL = "https://places.googleapis.com/v1/places:searchText"


async def verify_connection() -> dict:
    status = {"configured": bool(settings.google_places_api_key), "connected": False, "error": ""}
    if not settings.google_places_api_key:
        status["error"] = "GOOGLE_PLACES_API_KEY not set — discovery falls back to the seeded market."
        return status
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                PLACES_URL,
                headers={
                    "X-Goog-Api-Key": settings.google_places_api_key,
                    "X-Goog-FieldMask": "places.id",
                    "Content-Type": "application/json",
                },
                json={"textQuery": "event venue", "maxResultCount": 1},
            )
            if r.status_code == 200:
                status["connected"] = True
            else:
                # Places returns 400/403 with a helpful message when the key is bad/unauthorized
                try:
                    status["error"] = r.json().get("error", {}).get("message", r.text)[:200]
                except Exception:  # noqa: BLE001
                    status["error"] = f"HTTP {r.status_code}"
    except Exception as exc:  # noqa: BLE001
        status["error"] = str(exc)[:200]
    return status
