"""Generate example 'Event Planning Brief' documents (PNG) for the document-intake demo.
Each image has clean `Label: value` lines (easy for OCR/vision) and the exact structured
spec embedded in PNG metadata (key `brief_spec`) so the upload→spec flow is demonstrable
even without an OCR engine or a vision key. Run: python tools/generate_briefs.py
"""
from __future__ import annotations
import json, os
from PIL import Image, ImageDraw, ImageFont, PngImagePlugin

OUT = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "public", "brief-examples")
OUT = os.path.abspath(OUT)
os.makedirs(OUT, exist_ok=True)

INK = (26, 21, 35); MUTED = (110, 103, 121); LINE = (236, 231, 243)
VIOLET = (124, 58, 237); PLUM = (32, 26, 43); WHITE = (255, 255, 255); PANEL = (250, 248, 253)

def font(sz): return ImageFont.load_default(size=sz)

BRIEFS = [
    {"file": "wedding-yerevan", "event_type": "wedding", "title": "Wedding",
     "date": "2026-09-12", "guest_count": 180, "city": "Yerevan", "country": "Armenia", "country_code": "AM",
     "budget": 16000000, "currency": "AMD", "symbol": "AMD ",
     "categories": ["venue", "catering", "decor", "photo", "music"],
     "colors": [["ivory", "#f4efe6"], ["gold", "#d4af37"]],
     "notes": "Elegant garden venue, live music, floral arches."},
    {"file": "birthday-sf", "event_type": "birthday", "title": "Birthday",
     "date": "2026-08-20", "guest_count": 40, "city": "San Francisco", "country": "United States", "country_code": "US",
     "budget": 6000, "currency": "USD", "symbol": "$",
     "categories": ["venue", "catering", "decor", "music"],
     "colors": [["terracotta", "#c66a4e"], ["gold", "#d4af37"]],
     "notes": "Boho and cozy, dessert bar, DJ."},
    {"file": "baby-shower-berlin", "event_type": "baby_shower", "title": "Baby shower",
     "date": "2026-07-30", "guest_count": 25, "city": "Berlin", "country": "Germany", "country_code": "DE",
     "budget": 3000, "currency": "CHF", "symbol": "CHF ",
     "categories": ["venue", "catering", "decor"],
     "colors": [["dusty blue", "#8ca3bd"], ["mint", "#a8e0c8"]],
     "notes": "Intimate pastel brunch, balloons, greenery."},
    {"file": "wedding-ny", "event_type": "wedding", "title": "Wedding",
     "date": "2026-10-04", "guest_count": 120, "city": "New York", "country": "United States", "country_code": "US",
     "budget": 45000, "currency": "USD", "symbol": "$",
     "categories": ["venue", "catering", "decor", "photo", "music"],
     "colors": [["blush", "#e8b7c0"], ["sage green", "#a8bfa0"]],
     "notes": "Rustic, candles, florals, live band."},
]

def hex_rgb(h): h = h.lstrip("#"); return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def draw_brief(b):
    W, H = 820, 1120
    img = Image.new("RGB", (W, H), WHITE); d = ImageDraw.Draw(img)
    M = 56
    # soft top band
    d.rectangle([0, 0, W, 150], fill=PANEL)
    # pill badge
    d.rounded_rectangle([M, 40, M + 250, 78], radius=19, fill=WHITE, outline=LINE, width=2)
    d.text((M + 18, 50), "EVENT PLANNING BRIEF", font=font(15), fill=VIOLET)
    # title
    d.text((M, 92), b["title"], font=font(52), fill=INK, stroke_width=1, stroke_fill=INK)
    d.text((M, 162), "Prepared for The Event Negotiator", font=font(18), fill=MUTED)
    y = 214
    money = f'{b["symbol"]}{b["guest_count"] and format(b["budget"], ",")}'
    rows = [
        ("Event type", b["title"]),
        ("Date", b["date"]),
        ("Guest count", f'{b["guest_count"]} guests'),
        ("Location", f'{b["city"]}, {b["country"]}'),
        ("Budget", money),
        ("Categories", ", ".join(b["categories"])),
    ]
    for label, value in rows:
        d.line([M, y, W - M, y], fill=LINE, width=2); y += 22
        d.text((M, y), label.upper(), font=font(15), fill=MUTED); y += 26
        d.text((M, y), str(value), font=font(27), fill=INK); y += 52
    # colors
    d.line([M, y, W - M, y], fill=LINE, width=2); y += 22
    d.text((M, y), "COLORS", font=font(15), fill=MUTED); y += 30
    x = M
    for name, hx in b["colors"]:
        d.rounded_rectangle([x, y, x + 34, y + 34], radius=9, fill=hex_rgb(hx), outline=LINE, width=1)
        d.text((x + 44, y + 6), name, font=font(24), fill=INK)
        x += 44 + int(len(name) * 15) + 40
    y += 62
    # notes
    d.line([M, y, W - M, y], fill=LINE, width=2); y += 22
    d.text((M, y), "NOTES", font=font(15), fill=MUTED); y += 28
    d.text((M, y), b["notes"], font=font(23), fill=(71, 64, 79))
    # footer
    d.text((M, H - 46), "Document intake · one structured job spec", font=font(15), fill=MUTED)

    spec = {"event_type": b["event_type"], "date": b["date"], "guest_count": b["guest_count"],
            "city": b["city"], "country_code": b["country_code"], "budget": b["budget"],
            "currency": b["currency"], "categories": b["categories"],
            "colors": [c[1] for c in b["colors"]], "color_names": [c[0] for c in b["colors"]],
            "keywords": [w.strip(" .,").lower() for w in b["notes"].replace(",", " ").split()][:6]}
    meta = PngImagePlugin.PngInfo(); meta.add_text("brief_spec", json.dumps(spec))
    path = os.path.join(OUT, b["file"] + ".png")
    img.save(path, pnginfo=meta)
    return path

for b in BRIEFS:
    print("wrote", draw_brief(b))
print("done ->", OUT)
