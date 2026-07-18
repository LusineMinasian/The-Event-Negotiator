"""Palette Engine (spec section 21). Extract a dominant palette from an inspiration
board and derive contrast-safe UI theme tokens. Pure Pillow + stdlib colorsys —
no numpy, so it installs and runs anywhere."""
from __future__ import annotations

import colorsys
import io

try:
    from PIL import Image
    _PIL = True
except Exception:  # pragma: no cover
    _PIL = False

NAMED = {
    "blush": (232, 196, 200), "ivory": (245, 240, 232), "sage": (168, 184, 154),
    "dusty lavender": (180, 165, 195), "sky": (170, 200, 225), "peach": (245, 200, 170),
    "mint": (180, 220, 200), "charcoal": (60, 60, 66), "gold": (200, 170, 90),
    "terracotta": (200, 120, 90), "navy": (40, 55, 90), "rose": (210, 120, 140),
    "cream": (250, 245, 235), "forest": (60, 100, 80), "coral": (240, 130, 110),
}

# Fallback palettes per event when no board is uploaded.
DEFAULT_PALETTES = {
    "baby_shower": [("#E8C4C8", "blush", 0.34), ("#F5F0E8", "ivory", 0.29), ("#A8B89A", "sage", 0.21)],
    "wedding": [("#F5F0E8", "ivory", 0.36), ("#D9C6A5", "gold", 0.24), ("#8A9A8B", "sage", 0.2)],
    "birthday": [("#B4A5C3", "dusty lavender", 0.33), ("#AAC8E1", "sky", 0.27), ("#F5C8AA", "peach", 0.22)],
}


def _hex(rgb: tuple[int, int, int]) -> str:
    return "#{:02X}{:02X}{:02X}".format(*rgb)


def _name(rgb: tuple[int, int, int]) -> str:
    return min(NAMED.items(), key=lambda kv: sum((a - b) ** 2 for a, b in zip(kv[1], rgb)))[0]


def _lum(rgb: tuple[int, int, int]) -> float:
    def ch(c: float) -> float:
        c /= 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (ch(x) for x in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _contrast(fg: tuple[int, int, int], bg: tuple[int, int, int]) -> float:
    l1, l2 = _lum(fg), _lum(bg)
    hi, lo = max(l1, l2), min(l1, l2)
    return (hi + 0.05) / (lo + 0.05)


def _adjust(rgb: tuple[int, int, int], light: float, sat_cap: float) -> tuple[int, int, int]:
    h, l, s = colorsys.rgb_to_hls(*(c / 255 for c in rgb))
    l = max(l, light)
    s = min(s, sat_cap)
    r, g, b = colorsys.hls_to_rgb(h, l, s)
    return (round(r * 255), round(g * 255), round(b * 255))


def _hex_to_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def extract_palette(image_bytes: bytes) -> list[dict]:
    if not _PIL:
        return []
    try:
        img = Image.open(io.BytesIO(image_bytes)).convert("RGB").resize((200, 200))
    except Exception:
        return []
    q = img.quantize(colors=6, method=Image.Quantize.FASTOCTREE)
    pal = q.getpalette() or []
    counts = q.getcolors() or []
    total = sum(c for c, _ in counts) or 1
    out = []
    for count, idx in sorted(counts, key=lambda x: -x[0]):
        rgb = (pal[idx * 3], pal[idx * 3 + 1], pal[idx * 3 + 2])
        weight = count / total
        lum = _lum(rgb)
        if weight < 0.05:
            continue
        if (lum > 0.92 or lum < 0.05) and weight < 0.15:  # drop background/shadow unless dominant
            continue
        out.append({"hex": _hex(rgb), "name": _name(rgb), "weight": round(weight, 2)})
        if len(out) >= 4:
            break
    return out


def default_palette(event_key: str) -> list[dict]:
    return [{"hex": h, "name": n, "weight": w} for h, n, w in DEFAULT_PALETTES.get(event_key, DEFAULT_PALETTES["baby_shower"])]


def generate_theme_tokens(palette: list[dict]) -> dict:
    if not palette:
        return {"contrast_verified": False}
    rgbs = [_hex_to_rgb(p["hex"]) for p in palette]
    # accent: most saturated, forced to >= 4.5:1 against near-black text
    def sat(rgb): return colorsys.rgb_to_hls(*(c / 255 for c in rgb))[2]
    accent = max(rgbs, key=sat)
    text = (30, 30, 34)
    tries = 0
    while _contrast(text, accent) < 4.5 and tries < 8:
        accent = _adjust(accent, min(0.9, _lum_hls(accent) + 0.08), 0.6)
        tries += 1
    gradient = [_adjust(rgb, 0.93, 0.06) for rgb in rgbs[:3]]
    while len(gradient) < 3:
        gradient.append(gradient[-1] if gradient else (250, 246, 245))
    surface = _adjust(rgbs[0], 0.965, 0.03)
    border = _adjust(surface, max(0.0, _lum_hls(surface) - 0.08), 0.05)
    contrast_ok = all(_contrast(text, g) >= 4.5 for g in gradient)
    return {
        "accent": _hex(accent),
        "surface_tint": _hex(surface),
        "border_tint": _hex(border),
        "gradient_stops": [_hex(g) for g in gradient],
        "contrast_verified": contrast_ok,
    }


def _lum_hls(rgb: tuple[int, int, int]) -> float:
    return colorsys.rgb_to_hls(*(c / 255 for c in rgb))[1]
