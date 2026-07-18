# The Event Negotiator

**Voice agents that call the market, compare, and haggle for your event.**
Challenge 01 — *The Negotiator* · ElevenLabs × Hack-Nation · 6th Global AI Hackathon.

**Talk** through the event you want, watch it become a structured plan in real time, and a fleet of
voice agents phones the vendor market, negotiates using verified leverage, and hands you a ranked,
evidence-backed receipt — all tracked on a live command-center dashboard. The vertical is
**config, not code**: swap a YAML file, swap the market.

> Runs fully in **simulation mode** — no API keys needed to record a demo. Real **ElevenLabs Agents +
> Twilio + Google Places** connectors are wired in, with a live **System Check** that actually probes
> each one and turns green the moment you add credentials.

---

## Quick start

Two terminals. No Docker, no Postgres, no Redis — SQLite + an in-process event bus.

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

Open **http://localhost:5173** in **Google Chrome** (for the voice intake), create an account, and start
a negotiation. The frontend proxies `/api` and the WebSocket to `http://localhost:8000`.

To record the demo you need **nothing but these two commands running**.

---

## The demo flow (≈ what the judges see)

1. **Voice studio** (`/new`) — tap the mic and *describe* your event. As you speak, hashtag **bubbles**
   pop in for the vibe, guest count and colors; **name a color and the whole room repaints**; **drag in
   images or paste a Pinterest link** and the palette follows. In live mode the **ElevenLabs intake
   agent** talks back and collects the brief; otherwise the browser's own recognizer (Chrome → Google)
   drives it. Everything compiles into one job spec.
2. **Review & complete** — the palette and vibe are already seeded; fill in the last details (date,
   city, budget). Both intake paths write the **same** structured spec.
3. **Confirm** — the spec is frozen and hashed (`spec_hash`); every call describes exactly this, verbatim.
4. **Discovery** — the call list is built programmatically and **stratified by segment**, each vendor
   pre-classified with a confidence score (real Google Places, or a seeded market).
5. **Live Command Center** — the money screen. KPIs (active calls, quotes, negotiated-down, avg
   reduction, budget, red flags), a live **negotiation-movement** curve, negotiated-by-category,
   **leverage effectiveness**, an outcomes donut, budget guard and a live event feed — hydrated from a
   `/metrics` snapshot, then streamed over the WebSocket. The **War Room** (call tiles + price ticker) is
   one click away, with **Pull Me In** when a category budget is breached.
6. **Receipt** — a savings hero, ranked comparison per category, itemized fees (hidden ones flagged),
   the `-30%`-below-market warning, transcript-trigger quotes, and a Time Ledger.
7. **Agent Postmortem** — the honest part: outcomes, coverage, reclassifications, lever effectiveness.

**System Check** (`/system-check`) and **Config Switch** / **Segment Studio** are in the top nav.

---

## Connectors & the System Check

`/system-check` runs a **real preflight** — it actually authenticates against each provider and reports
`ok / error / not configured` with a fix hint, so you know *before* a demo whether live calls will work:

| Connector | What it checks | Powers |
|---|---|---|
| **ElevenLabs Agents** | API key valid · caller agent exists · phone numbers linked | outbound negotiation calls + the intake agent |
| **Caller phone number** | a number is linked to the agent | placing real calls |
| **Twilio Voice** | account reachable with SID/token · caller-id set | the PSTN leg |
| **Google Places** | key authorizes a live search | real vendor discovery |
| **Browser voice (Chrome)** | Web Speech API present in a secure context | the keyless voice intake |

The connector plumbing:
`elevenlabs_connector.py` (verify · signed URLs · native outbound · **post-call webhook** that replays
transcripts onto the event bus), `twilio_connector.py` (account verify · `<Connect><Stream>` bridge),
`google_connector.py` (Places verify), and `routers/integrations.py` (`/preflight`, `/elevenlabs`,
intake signed-url, webhook).

---

## Going live (real phone calls)

Everything below is optional — the app is fully demoable without it. Set the keys, then hit
`/system-check` to confirm each turns green.

```ini
CALL_MODE=live
ELEVENLABS_API_KEY=...
ELEVENLABS_AGENT_ID=...            # the caller (negotiation) agent
ELEVENLABS_INTAKE_AGENT_ID=...     # optional: conversational agent for the voice studio
ELEVENLABS_PHONE_NUMBER_ID=...     # the number the caller agent dials from
ELEVENLABS_WEBHOOK_SECRET=...      # optional: require x-webhook-secret on the post-call webhook
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM_NUMBER=...
PUBLIC_BASE_URL=https://<ngrok>    # public host Twilio/ElevenLabs webhooks can reach
GOOGLE_PLACES_API_KEY=...          # optional: real market discovery
```

The preferred path is **ElevenLabs' native outbound** (it drives the Twilio leg); a direct Twilio
`<Connect><Stream>` bridge is also implemented. Point the agent's post-call webhook at
`{PUBLIC_BASE_URL}/api/integrations/elevenlabs/webhook` so live transcripts light up the same dashboard
as simulated calls.

> **Note:** live outbound requires your own credentials and a reachable public host — it can't be
> exercised from an offline checkout. Simulation is the default and covers the entire flow with zero keys.

---

## How the brief's hard requirements are met

| Requirement | Where |
|---|---|
| One structured job spec, from **voice** and **document** intake, confirmed & reused verbatim | voice studio + board/Pinterest intake → `spec_builder.py`, `spec_hash` frozen |
| Live calls vs **≥3 distinct negotiation styles** | 5 counterparty styles emerge from segment config (`counterparty.py`) |
| Prices **measurably move during a call because of leverage** — not a script | `leverage.py` → `counterparty.apply_lever()`; every drop logged as a `price_event` |
| Agent never invents a bid | `get_verified_leverage()` is the only source of numbers; competing bids come from real collected quotes |
| AI disclosure + "are you a robot?" handled | consent script first line; honest confirmation branch |
| Every call ends in a **structured outcome** | `quote` / `callback` / `decline` / `unreachable` |
| Final report ranks all quotes, cites transcript evidence | Receipt + Ranking Engine |
| `-30%`-below-market red flag | Red-Flag Engine, benchmark taken **per segment** |
| Vertical params are **config, not code** | four YAML levels (events / categories / segments / regions) + hot reload |
| Call list built programmatically | Discovery Service (Google Places connector + seeded fallback) |

---

## Architecture

```
React (Vite · TS · Tailwind)  ──REST + WebSocket──►  FastAPI orchestrator
  Voice studio (Web Speech / 11Labs realtime)         Spec Store · Segment Classifier
  Live Command Center (SVG charts)                     Leverage · Red-Flag · Ranking
  System Check · War Room · Receipt                    Budget Guard · Palette Extractor
  Palette Engine (CSS vars)                            in-memory Event Bus (seq'd, bounded)
                                                          │
         ┌────────────────┬──────────────────────────────┼───────────────────────────┐
     Discovery       Integrations                     Caller (sim / live)          SQLite
   Places + seed   11Labs · Twilio · Google         Counterparty · Twilio · 11Labs
                                                          ▲ reads
                                                  Config layer (YAML, hot-reload)
                                                  events / categories / segments / regions
```

- **Backend:** FastAPI · SQLAlchemy · SQLite · stdlib JWT. `backend/app/` (routers · services · engines · configs).
- **Config layer:** `backend/app/configs/` — 3 events, 5 categories, 20 segments, 2 regions.
- **Frontend:** React + TypeScript + Vite + **Tailwind**. Dependency-free SVG charts; client-side vibe
  parsing + dominant-color extraction in `src/vibe.ts`; speech + realtime-agent hooks in `src/speech.ts`.

Run `python smoke_test.py` in `backend/` for a headless end-to-end run of the whole loop.

---

## Notes & honesty

Initial lever weights are **hypotheses** the system refines from `segment_observations`, not measured
truths — surfaced as such in the Postmortem. The counterparty simulation is deterministic so the demo is
reproducible; prices move strictly as a function of applied leverage, never a canned script. On the live
dashboard, **"negotiated down"** is movement across *all* calls (live activity); the **receipt**'s saving
is what you'd capture on your *recommended picks* — related but deliberately different numbers.
