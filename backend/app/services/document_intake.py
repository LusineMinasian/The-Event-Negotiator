"""Document intake: turn a brief/quote image into the same structured job spec fields.

Recognition is tiered so it works in any environment:
  1. Tesseract OCR   — real on-device OCR when the binary is installed
  2. Vision model    — Anthropic vision when ANTHROPIC_API_KEY is set (handles any doc)
  3. Embedded metadata — the example briefs we ship carry the spec in a PNG text chunk,
     so the upload→spec flow is demonstrable even with no OCR engine and no key.

Whatever the source, the output is one normalized field dict the wizard applies.
"""
from __future__ import annotations

import base64
import io
import json
import re

import httpx

from ..config import settings

COUNTRY_CODES = {
    "united states": "US", "usa": "US", "us": "US", "america": "US",
    "canada": "CA", "switzerland": "CH", "germany": "DE", "austria": "AT", "armenia": "AM",
}
COLOR_HEX = {
    "ivory": "#f4efe6", "gold": "#d4af37", "terracotta": "#c66a4e", "dusty blue": "#8ca3bd",
    "mint": "#a8e0c8", "blush": "#e8b7c0", "sage green": "#a8bfa0", "sage": "#a8bfa0",
    "navy": "#26324f", "burgundy": "#7b2233", "emerald": "#0f8a5f", "coral": "#f18f7a",
    "lavender": "#b9a3d6", "peach": "#f6c8a8", "cream": "#f3ead9", "rose gold": "#b76e79",
    "champagne": "#e8d5a8", "dusty rose": "#c9989a",
}
EVENT_KEYS = {
    "wedding": ["wedding", "married", "bride", "groom"],
    "baby_shower": ["baby shower", "baby-shower", "babyshower", "gender reveal"],
    "birthday": ["birthday", "bday"],
}


def recognize(image_bytes: bytes) -> dict:
    """Return {'fields': {...}, 'source': 'ocr'|'vision'|'embedded'|'none'}."""
    text = _tesseract(image_bytes)
    if text and text.strip():
        return {"fields": parse_brief_text(text), "source": "ocr"}
    if settings.anthropic_api_key:
        v = _anthropic_vision(image_bytes)
        if v:
            return {"fields": _normalize(v), "source": "vision"}
    meta = _png_metadata(image_bytes)
    if meta:
        return {"fields": _normalize(meta), "source": "embedded"}
    return {"fields": {}, "source": "none"}


# ── recognizers ───────────────────────────────────────────────────────────────
def _tesseract(image_bytes: bytes) -> str:
    try:
        import pytesseract
        from PIL import Image
        return pytesseract.image_to_string(Image.open(io.BytesIO(image_bytes)))
    except Exception:  # noqa: BLE001 — no binary / not installed → skip tier
        return ""


def _png_metadata(image_bytes: bytes) -> dict | None:
    try:
        from PIL import Image
        raw = (Image.open(io.BytesIO(image_bytes)).info or {}).get("brief_spec")
        return json.loads(raw) if raw else None
    except Exception:  # noqa: BLE001
        return None


def _anthropic_vision(image_bytes: bytes) -> dict | None:
    prompt = ("Read this event planning brief and return ONLY minified JSON with keys: "
              "event_type (wedding|birthday|baby_shower|hackathon|public_speaking|concert), date (YYYY-MM-DD), guest_count (int), "
              "city, country_code (US|CA|CH|DE|AT|AM), budget (int, digits only), currency, "
              "categories (array), colors (array of hex), keywords (array). Unknown → null.")
    try:
        b64 = base64.b64encode(image_bytes).decode()
        r = httpx.post("https://api.anthropic.com/v1/messages", timeout=40,
                       headers={"x-api-key": settings.anthropic_api_key,
                                "anthropic-version": "2023-06-01", "content-type": "application/json"},
                       json={"model": "claude-haiku-4-5-20251001", "max_tokens": 512,
                             "messages": [{"role": "user", "content": [
                                 {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": b64}},
                                 {"type": "text", "text": prompt}]}]})
        r.raise_for_status()
        txt = "".join(b.get("text", "") for b in r.json().get("content", []))
        m = re.search(r"\{.*\}", txt, re.DOTALL)
        return json.loads(m.group(0)) if m else None
    except Exception:  # noqa: BLE001 — vision is optional
        return None


# ── text parsing (OCR path) ───────────────────────────────────────────────────
def parse_brief_text(text: str) -> dict:
    low = text.lower()
    f: dict = {}

    for key, words in EVENT_KEYS.items():
        if any(w in low for w in words):
            f["event_type"] = key
            break

    m = re.search(r"(\d{4}-\d{2}-\d{2})", text)
    if m:
        f["date"] = m.group(1)
    m = re.search(r"(\d{1,4})\s*guests\b", low) or re.search(r"guest\s*count\D{0,6}(\d{1,4})", low)
    if m:
        f["guest_count"] = int(m.group(1))

    m = re.search(r"location[:\s]+([^\n]+)", low)
    if m:
        parts = [p.strip() for p in m.group(1).split(",")]
        if parts:
            f["city"] = parts[0].title()
        if len(parts) > 1:
            f["country_code"] = COUNTRY_CODES.get(parts[1].strip(), "")

    m = re.search(r"budget[:\s]+([^\n]+)", low)
    if m:
        digits = re.sub(r"[^\d]", "", m.group(1))
        if digits:
            f["budget"] = int(digits)
        if "amd" in m.group(1) or "֏" in m.group(1):
            f["currency"] = "AMD"
        elif "chf" in m.group(1) or "€" in m.group(1):
            f["currency"] = "CHF"
        elif "$" in m.group(1) or "usd" in m.group(1):
            f["currency"] = "USD"

    m = re.search(r"categories[:\s]+([^\n]+)", low)
    if m:
        f["categories"] = [c.strip() for c in m.group(1).split(",") if c.strip()]

    m = re.search(r"colors?[:\s]+([^\n]+)", low)
    if m:
        names = re.split(r"[,;/]| and ", m.group(1))
        hexes, cnames = [], []
        for n in names:
            n = n.strip()
            if n in COLOR_HEX:
                hexes.append(COLOR_HEX[n]); cnames.append(n)
        if hexes:
            f["colors"] = hexes; f["color_names"] = cnames

    m = re.search(r"notes?[:\s]+([^\n]+)", low)
    if m:
        f["keywords"] = [w.strip(" .,") for w in m.group(1).split() if len(w) > 3][:6]
    return _normalize(f)


_STOP = {"and", "the", "with", "for", "our", "are", "was"}


def _normalize(f: dict) -> dict:
    out = {
        "event_type": f.get("event_type") or None,
        "date": f.get("date") or None,
        "guest_count": int(f["guest_count"]) if f.get("guest_count") else None,
        "city": f.get("city") or "",
        "country_code": (f.get("country_code") or "").upper(),
        "budget": int(f["budget"]) if f.get("budget") else None,
        "currency": f.get("currency") or "",
        "categories": f.get("categories") or [],
        "colors": [c for c in (f.get("colors") or []) if isinstance(c, str) and c.startswith("#")],
        "color_names": f.get("color_names") or [],
        "keywords": [k for k in (str(x).lower().strip(" .,") for x in (f.get("keywords") or []))
                     if len(k) > 2 and k not in _STOP][:6],
    }
    return out
