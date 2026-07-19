# SayWhen

**Voice agents that call the market, compare, and haggle for your event.**
Challenge 01 — *The Negotiator* · ElevenLabs × Hack-Nation · 6th Global AI Hackathon.

**Talk** (or upload a brief) to describe the event you want, watch it become a structured plan in real
time, and a fleet of voice agents phones the vendor market, negotiates using **verified** leverage, and
hands you a ranked, evidence-backed receipt — all tracked on a live command-center dashboard. The vertical
is **config, not code**: swap a YAML file, swap the market.

> Runs fully in **simulation mode** — no API keys, no browser extensions, nothing to sign up for. Real
> **ElevenLabs Agents + Twilio + Google Places** connectors are wired in, with a live **System Check** that
> actually probes each one and turns green the moment you add credentials.

**Vertical chosen:** event vendors (weddings · birthdays · baby showers) — a fragmented, phone-priced
market with a huge quote spread, exactly the pain the brief describes.

---

## Try it in 60 seconds (local)

Two terminals. No Docker, no Postgres, no Redis — SQLite + an in-process event bus.

**Backend** (Python 3.11+)
```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --port 8000 --reload
```

**Frontend** (Node 18+)
```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173** in **Google Chrome** (for the voice intake), create an account, and start an
event. The frontend proxies `/api` and the WebSocket to `localhost:8000`. That's the entire demo — no keys.

Headless end-to-end check: `python backend/smoke_test.py`.

---

## Deploy (one URL, one service)

The whole app ships as **one Docker web service**: FastAPI serves the API, the live WebSocket, and the
built React frontend from a single origin (no CORS, no separate frontend host). A long-lived WebSocket +
in-process event bus + writable SQLite need a real always-on process — so Render, not serverless.

**Render (blueprint):** push to GitHub → [render.com](https://render.com) → **New → Blueprint** → pick this
repo → **Apply**. It reads `render.yaml`, builds the frontend, starts the image, and gives you a URL. First
build ~3–5 min. Health check: `https://<url>/api/health`. It comes up in **simulation mode** with zero keys.

**Local (same image as prod):**
```bash
docker build -t saywhen .
docker run -p 8000:8000 saywhen   # → http://localhost:8000
```

**Going live / durable data / troubleshooting** (incl. the classic *403 when the platform clones a public
repo* → grant the platform's GitHub App access, or use Render's "Public Git repository" option) → see
**[`DEPLOY.md`](./DEPLOY.md)**.

---

## The demo flow (≈ what the judges see)

1. **Intake — voice or document.** At `/new`, tap the mic and *describe* the event: hashtag **bubbles** pop
   in for vibe, guest count and colors; **name a color and the whole room repaints**; drop images / a
   Pinterest link and the palette follows. In live mode the **ElevenLabs intake agent** talks back;
   otherwise the browser recognizer (Chrome → Google) drives it. Or **upload a brief / quote photo** (or
   click a bundled example) — it's read by **OCR / vision** into the *same* structured spec.
2. **Review & confirm.** Fill the last details (date, city with browser-detected country, budget in the
   local currency). The spec is frozen and **hashed** (`spec_hash`); every call describes exactly this,
   verbatim.
3. **Discovery.** The call list is built programmatically and **stratified by segment** (cheap↔premium,
   rigid↔flexible), each vendor pre-classified with a confidence score. Click any vendor for a **place
   card** (photos, rating, Maps/website/socials); click the **ⓘ** to see *which agent was picked and why*
   — the segment, its style, the levers that work, the ones to never raise, and the resistance profile.
4. **Live Command Center** — the money screen. KPIs, a live **negotiation-movement** curve, negotiated-by-
   category, **leverage effectiveness**, an outcomes donut, budget guard, and a live feed — hydrated from a
   `/metrics` snapshot, then streamed over the WebSocket. Click any live call to drop into its **transcript**
   (newest-first). **Pull Me In** toasts when a category budget is breached. The **War Room** (call tiles +
   price ticker) is one click away.
5. **Receipt** — a compact, real-receipt render: per pick the **~~opening price~~ → negotiated price**, the
   **contact person** who sold it, itemized fees (hidden ones flagged), the `-30%`-below-market warning,
   and transcript-trigger evidence. **Download the full estimate as CSV.**
6. **Agent Postmortem** — the honest part: outcomes, coverage, reclassifications, lever effectiveness.

**System Check** (`/system-check`), **Config Switch** and **Segment Studio** are in the top nav.

---

## How the brief's required criteria are met

| Success criterion (from the brief) | Where it lives |
|---|---|
| Loop closed: **intake → calls → negotiation → ranked recommendation** with transcript evidence | end-to-end, screens 1→6 above |
| **One structured job spec**, from **voice interview** and **≥1 document**, confirmed by the user and reused **verbatim** across every call | voice studio (ElevenLabs / Web Speech) **+** document intake (OCR → vision → sample metadata) → `spec_builder.py`, frozen `spec_hash` |
| Live calls vs **≥3 distinct negotiation styles**, quotes **structured & comparable, fees itemized** | 5 counterparty styles from segment config (`counterparty.py`); `Quote.line_items` + hidden-fee reveal |
| **≥1 negotiation where price moves during the call because of leverage** — not a script | `leverage.get_verified_leverage()` → `counterparty.apply_lever()`; every drop logged as a `price_event` |
| Agent **never invents** inventory or a fake bid | `get_verified_leverage()` is the only source of numbers; competing bids come only from **already-collected** quotes |
| **AI disclosure** + "are you a robot?" + friction handled gracefully | consent/disclosure first line + `robot_answer` (`prompts.yaml`); friction = stonewaller / callback / unreachable |
| Every call ends in a **structured outcome** | `quote` · `callback` · `unreachable` (never a vague range) |
| Final report **ranks all quotes**, cites transcript evidence, plain language | Receipt + Ranking Engine + CSV export |
| **`-30%`-below-market** red flag | Red-Flag Engine, benchmark taken **per segment** |
| Vertical params are **config, not code** | four YAML layers (events / categories / segments / regions) + hot reload |
| Call list **built programmatically** | Discovery Service (Google Places connector + seeded fallback) |

---

## What's inside (highlights)

- **Interactive intake** — voice-to-bubbles studio + real **document intake** (upload a brief/quote → OCR
  via Tesseract, or vision via Anthropic, or the metadata embedded in the shipped example briefs).
- **Live Command Center** with dependency-free SVG charts, live WebSocket stream, and drill-into-call.
- **"Why this agent?"** ⓘ popover — surfaces the segment classification and negotiation strategy per call.
- **Receipt** as a real receipt: struck→negotiated prices, contact person, itemized/hidden fees, **CSV export**.
- **Connectors preflight** (System Check) — genuinely probes ElevenLabs / Twilio / Google / browser voice.
- **Multi-region & currency** — US/CA/CH/DE/AT/**Armenia (֏)**, browser country detection, sane budget scaling.
- **`agents_generate/`** — a paste-ready pack of ElevenLabs agent **system prompts + tool/webhook contracts**
  (caller-negotiator, intake-estimator, counterparties) grounded in this repo's engines.
- Responsive down to ~390px; graceful loading/empty states; scroll-locked drawers.

---

## Connectors & the System Check

`/system-check` runs a **real preflight** — it actually authenticates against each provider and reports
`ok / error / not configured` with a fix hint, so you know *before* a demo whether live calls will work:

| Connector | What it checks | Powers |
|---|---|---|
| **ElevenLabs Agents** | API key valid · caller agent exists · phone numbers linked | outbound negotiation calls + the intake agent |
| **Caller phone number** | a number is linked to the agent | placing real calls |
| **Twilio Voice** | account reachable · caller-id set | the PSTN leg |
| **Google Places** | key authorizes a live search | real vendor discovery |
| **Browser voice (Chrome)** | Web Speech API in a secure context | the keyless voice intake |

Plumbing: `elevenlabs_connector.py` (verify · signed URLs · native outbound · **post-call webhook** that
replays transcripts onto the event bus), `twilio_connector.py` (`<Connect><Stream>` bridge),
`google_connector.py`, `document_intake.py`, and `routers/integrations.py`.

---

## Going live (real phone calls)

Optional — the app is fully demoable without it. Set keys, then hit `/system-check` to confirm green.

```ini
CALL_MODE=live
ELEVENLABS_API_KEY=...      ELEVENLABS_AGENT_ID=...        # the caller (negotiation) agent
ELEVENLABS_INTAKE_AGENT_ID=...   ELEVENLABS_PHONE_NUMBER_ID=...
ELEVENLABS_WEBHOOK_SECRET=...    # optional: x-webhook-secret on the post-call webhook
TWILIO_ACCOUNT_SID=...     TWILIO_AUTH_TOKEN=...     TWILIO_FROM_NUMBER=...
GOOGLE_PLACES_API_KEY=...        ANTHROPIC_API_KEY=...     # optional: real discovery / document vision
PUBLIC_BASE_URL=https://<host>   # so ElevenLabs/Twilio webhooks reach you
```

Preferred path: **ElevenLabs native outbound** (it drives the Twilio leg); a direct Twilio
`<Connect><Stream>` bridge is also implemented. Point the agent's post-call webhook at
`{PUBLIC_BASE_URL}/api/integrations/elevenlabs/webhook`. Full list in `.env.example`.

---

## Architecture

```
React (Vite · TS · Tailwind)  ──REST + WebSocket──►  FastAPI orchestrator
  Intake: voice studio + document OCR/vision          Spec Store · Segment Classifier
  Live Command Center (SVG charts)                     Leverage · Red-Flag · Ranking
  System Check · War Room · Receipt (+CSV)             Budget Guard · Palette Extractor
  Palette Engine (CSS vars)                            in-memory Event Bus (seq'd, bounded)
                                                          │
         ┌────────────────┬──────────────────────────────┼───────────────────────────┐
     Discovery       Integrations                     Caller (sim / live)          SQLite
   Places + seed   11Labs · Twilio · Google         Counterparty · Twilio · 11Labs
                                                          ▲ reads
                                                  Config layer (YAML, hot-reload)
                                                  events / categories / segments / regions
```

- **Backend:** FastAPI · SQLAlchemy · SQLite · stdlib JWT · Pillow (palette/briefs). `backend/app/`
  (routers · services · engines · configs).
- **Config layer:** `backend/app/configs/` — 3 events, 5 categories, 20 segments, 2 regions. Switching the
  market means editing YAML, not agents.
- **Frontend:** React + TypeScript + Vite + **Tailwind**. Dependency-free SVG charts; client vibe parsing +
  dominant-color extraction (`src/vibe.ts`); speech + realtime-agent hooks (`src/speech.ts`).
- **Deploy:** `Dockerfile` (Node build → Python runtime, single service), `render.yaml`, `DEPLOY.md`.

---

## Honesty & known limits

- The default demo runs a **deterministic counterparty simulation** streamed live — reproducible for
  judging, and prices move **strictly as a function of applied leverage**, never a canned script. Real voice
  calls (and call **recordings**) need your ElevenLabs/Twilio keys; the connectors + `agents_generate/` pack
  are ready for that switch.
- **Document intake** uses Tesseract when the binary is present, the Anthropic vision API when a key is set,
  and otherwise reads the structured spec embedded in the **example briefs** so the flow always demos.
- Initial lever weights are **hypotheses** the system refines from `segment_observations` — shown as such in
  the Postmortem, not presented as measured truth.
- On the live dashboard, **"negotiated down"** is movement across *all* calls (live activity); the
  **receipt**'s saving is what you'd capture on your *recommended picks* — related but deliberately different.
