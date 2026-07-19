"""Fetch ElevenLabs Conversational-AI call recordings and save them to the repo.

Lists conversations for the account (optionally scoped to an agent), keeps only
those whose phone call went to TARGET_NUMBER, downloads each recording as MP3 and
writes it plus a small JSON sidecar into call_recordings/.

Usage:
    ELEVENLABS_API_KEY=sk_... python scripts/fetch_call_audio.py [+37498603464]
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.request
import urllib.error

EL_API = "https://api.elevenlabs.io/v1"
API_KEY = os.environ.get("ELEVENLABS_API_KEY", "").strip()
AGENT_ID = os.environ.get("ELEVENLABS_AGENT_ID", "").strip()
TARGET = (sys.argv[1] if len(sys.argv) > 1 else "+37498603464").strip()
OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "call_recordings")


def _digits(s: str) -> str:
    return re.sub(r"\D", "", s or "")


def _get(path: str, params: dict | None = None, raw: bool = False):
    url = f"{EL_API}{path}"
    if params:
        from urllib.parse import urlencode
        url += "?" + urlencode({k: v for k, v in params.items() if v})
    req = urllib.request.Request(url, headers={"xi-api-key": API_KEY})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
    return data if raw else json.loads(data)


def list_conversations() -> list[dict]:
    """Page through all conversations (optionally filtered to AGENT_ID)."""
    convos, cursor = [], None
    while True:
        page = _get("/convai/conversations",
                    {"agent_id": AGENT_ID, "page_size": 100, "cursor": cursor})
        convos.extend(page.get("conversations", []))
        cursor = page.get("next_cursor")
        if not cursor or not page.get("has_more"):
            break
    return convos


def to_number_of(conv_id: str) -> str:
    """Pull the external (called) number from the conversation detail metadata."""
    d = _get(f"/convai/conversations/{conv_id}")
    meta = d.get("metadata") or {}
    phone = meta.get("phone_call") or {}
    return phone.get("external_number") or phone.get("to_number") or ""


def main() -> int:
    if not API_KEY:
        print("ERROR: set ELEVENLABS_API_KEY", file=sys.stderr)
        return 2
    os.makedirs(OUT_DIR, exist_ok=True)
    target_digits = _digits(TARGET)
    print(f"Listing conversations (agent={AGENT_ID or 'ALL'})...")
    convos = list_conversations()
    print(f"  {len(convos)} conversations total; filtering to {TARGET}")

    saved, manifest = 0, []
    for c in convos:
        cid = c.get("conversation_id") or c.get("id")
        if not cid:
            continue
        try:
            to = to_number_of(cid)
        except urllib.error.HTTPError as e:
            print(f"  ! detail {cid}: HTTP {e.code}")
            continue
        if target_digits not in _digits(to):
            continue
        try:
            audio = _get(f"/convai/conversations/{cid}/audio", raw=True)
        except urllib.error.HTTPError as e:
            print(f"  ! audio {cid}: HTTP {e.code} (recording may not be ready)")
            continue
        started = c.get("start_time_unix_secs") or int(time.time())
        base = f"{started}_{cid}"
        with open(os.path.join(OUT_DIR, base + ".mp3"), "wb") as f:
            f.write(audio)
        row = {"conversation_id": cid, "to_number": to,
               "start_time_unix_secs": started,
               "duration_secs": c.get("call_duration_secs"),
               "status": c.get("status"), "file": base + ".mp3"}
        manifest.append(row)
        with open(os.path.join(OUT_DIR, base + ".json"), "w") as f:
            json.dump(row, f, indent=2)
        saved += 1
        print(f"  ✓ saved {base}.mp3 ({len(audio)//1024} KB)")

    with open(os.path.join(OUT_DIR, "manifest.json"), "w") as f:
        json.dump(sorted(manifest, key=lambda r: r["start_time_unix_secs"]), f, indent=2)
    print(f"Done: {saved} recording(s) for {TARGET} -> call_recordings/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
