# The Event Negotiator

**Voice agents that call the market, compare, and haggle for your event.**
Challenge 01 — *The Negotiator* · ElevenLabs × Hack-Nation · 6th Global AI Hackathon.

Pick an event (wedding · birthday · baby shower), drop an inspiration board, confirm one
structured job spec — and a fleet of voice agents phones the vendor market, negotiates using
verified leverage, and hands you a ranked, evidence-backed receipt. The vertical is **config,
not code**: swap a YAML file, swap the market.

> Runs fully offline in **simulation mode** — no API keys needed to record a demo. Real
> **Twilio + ElevenLabs** connectors are wired in and switch on when you add credentials.

---

## Quick start

Two terminals. No Docker, no Postgres, no Redis — SQLite + in-process event bus.

### 1. Backend (Python 3.11+)

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp ../.env.example ../.env          # optional — defaults work with no keys
uvicorn app.main:app --port 8000 --reload
```

### 2. Frontend (Node 18+)

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**, create an account, and start a negotiation.
(The frontend proxies `/api` and the WebSocket to `http://localhost:8000`.)

To record the demo you need **nothing but these two commands running**.

---

## The demo flow (≈ what the judges see)

1. **Onboarding** — pick the event; it loads a different config (categories, ranking weights, levers).
2. **Vibe-to-Spec** — drop an inspiration board; the palette recolors the UI (that's the vision
   model reading your board) while the structured spec fills in. Both intake paths write one spec.
3. **Confirm** — the spec is frozen and hashed (`spec_hash`); every call describes exactly this.
4. **Discovery** — the call list is built programmatically and **stratified by segment**, each
   vendor pre-classified with a confidence score.
5. **War Room** — live calls against distinct negotiation styles (stonewaller, upseller, lowballer,
   hard, flexible). Watch the **price ticker** move when leverage lands, a vendor get
   **reclassified mid-call**, and **Pull Me In** light up when a category budget is breached.
6. **Receipt** — ranked comparison per category, itemized fees (hidden ones flagged), the
   `-30%`-below-market warning, transcript-trigger quotes, and a Time Ledger.
7. **Agent Postmortem** — the honest part: outcomes, coverage, reclassifications, lever effectiveness.

Config Switch (S9) and Segment Studio (S10) are in the top nav — they prove the "config, not code"
thesis and let you build a segment strategy from five plain questions.

---

## How the brief's hard requirements are met

| Requirement | Where |
|---|---|
| One structured job spec, from voice **and** document intake, confirmed & reused verbatim | `spec_builder.py`, board upload, `spec_hash` frozen |
| Live calls vs **≥3 distinct negotiation styles** | 5 counterparty styles emerge from segment config (`counterparty.py`) |
| Prices **measurably move during a call because of leverage** — not a script | `leverage.py` → `counterparty.apply_lever()`; every drop logged as a `price_event` |
| Agent never invents a bid | `get_verified_leverage()` is the only source of numbers; competing bids come from real collected quotes |
| AI disclosure + "are you a robot?" handled | consent script first line; honest confirmation branch |
| Every call ends in a **structured outcome** | `quote` / `callback` / `decline` / `unreachable` |
| Final report ranks all quotes, cites transcript evidence | `Receipt` + Ranking Engine |
| `-30%`-below-market red flag | Red-Flag Engine, benchmark taken **per segment** |
| Vertical params are **config, not code** | four YAML levels (events / categories / segments / regions) + hot reload |
| Call list built programmatically | Discovery Service (Google Places connector + seeded fallback) |

---

## Going live (real phone calls)

Everything below is optional — the app is fully demoable without it.

1. Put credentials in `.env` and set `CALL_MODE=live`:
   - `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`
   - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`
   - `PUBLIC_BASE_URL` — a public https/wss host Twilio can reach (e.g. an ngrok tunnel)
   - `GOOGLE_PLACES_API_KEY` — optional, real vendor discovery (otherwise the seeded market)
2. The real connectors live in `backend/app/services/twilio_connector.py` and
   `elevenlabs_connector.py`. The preferred path is ElevenLabs' native outbound (it drives the
   Twilio leg); a direct Twilio `<Connect><Stream>` bridge is also implemented.

### Routing a live call to a phone for the demo

Twilio needs a public webhook URL. For the demo you have two easy options:
- **ngrok** — `ngrok http 8000`, put the https URL in `PUBLIC_BASE_URL`. Twilio calls a real number
  (your own phone, playing the "vendor").
- **Telegram bridge (planned)** — instead of PSTN, a small Telegram bot relays the agent's audio/text
  to your phone and your replies back, so you can role-play the vendor live on camera without a
  Twilio number. Hook point: swap the transport in `caller.run_single_call` (the tool calls and
  event stream stay identical). See `services/` — the counterparty interface is transport-agnostic.

---

## Architecture

```
React (Vite, TS)  ──REST + WebSocket──►  FastAPI orchestrator
  S1..S10 screens                         Spec Store · Segment Classifier
  Palette Engine                          Leverage Engine · Red-Flag · Ranking
                                          Budget Guard · Palette Extractor
                                          in-memory Event Bus
                                            │
         ┌──────────────────────────────────┼───────────────────────────┐
     Discovery                          Caller (sim / live)          SQLite
   Places + seed                     Counterparty · Twilio · 11Labs
                                            ▲ reads
                                    Config layer (YAML, hot-reload)
                                    events / categories / segments / regions
```

- **Backend:** FastAPI · SQLAlchemy · SQLite · stdlib JWT auth. `backend/app/`.
- **Config layer:** `backend/app/configs/` — 3 events, 5 categories, 20 segments, 2 regions.
- **Frontend:** React + TypeScript + Vite, one stylesheet, CSS-variable Palette Engine.

Run `python smoke_test.py` in `backend/` for a headless end-to-end run of the whole loop.

---

## Notes & honesty

Initial lever weights are **hypotheses** the system refines from `segment_observations`, not measured
truths — surfaced as such in the Postmortem. The counterparty simulation is deterministic so the demo
is reproducible; prices move strictly as a function of applied leverage, never a canned script.
