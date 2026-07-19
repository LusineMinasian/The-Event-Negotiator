import { Fragment, useEffect, useState } from "react";
import { api } from "../api";
import { clearTheme } from "../palette";
import KeysPanel from "./KeysPanel";

const EL_CONVAI = "https://elevenlabs.io/app/conversational-ai";

const PIPELINE = [
  { n: "1", t: "Intake", d: "You describe the event by voice or hand over a photographed brief. Speech and OCR turn it into structured details — type, guests, date, city, budget, vibe.", via: "ElevenLabs intake agent · Anthropic vision" },
  { n: "2", t: "Spec", d: "The details freeze into a hashed job spec. Every call from here describes exactly this — no drift, fully auditable.", via: "config layers · spec builder" },
  { n: "3", t: "Discovery", d: "A vendor call-list is built for the city and category, then stratified so the sample spans cheap↔premium and rigid↔flexible operators.", via: "Google Places · segment classifier" },
  { n: "4", t: "Campaign", d: "Outbound agents work the list in parallel. Each quotes, counters with verified levers, records price moves and pulls a human in on a breach — all streaming live.", via: "negotiation agent · Twilio · leverage engine · event bus" },
  { n: "5", t: "Receipt", d: "The best pick per category, total negotiated down, red flags and a downloadable CSV estimate — in the currency you chose.", via: "ranking · budget guard · red-flag engine" },
];

const AGENTS = [
  {
    name: "Intake Agent", role: "Voice intake studio", idField: "elevenlabs_intake_agent_id", fallback: "elevenlabs_agent_id",
    what: "Runs the conversational brief — asks about the event and writes each answer straight into the spec, then finalizes it.",
    tools: ["/spec/field", "/spec/finalize"],
  },
  {
    name: "Negotiation Agent", role: "Outbound caller", idField: "elevenlabs_agent_id", fallback: "",
    what: "Places each vendor call. Quotes and counters using only verified levers, logs every price move, flags hidden fees, reclassifies on new signals and requests a human handoff when a category budget is breached.",
    tools: ["/leverage", "/quote", "/price-move", "/red-flags", "/reclassify", "/handoff"],
  },
];

// The call lifecycle as a left-to-right flow of who's on the line at each step.
const FLOW = [
  { icon: "🙋", t: "You", d: "describe the event by voice" },
  { icon: "🎙️", t: "Intake Agent", d: "runs the brief, writes the spec" },
  { icon: "📋", t: "Job spec", d: "frozen & hashed" },
  { icon: "📞", t: "Negotiation Agent", d: "dials each vendor, haggles" },
  { icon: "🏪", t: "Vendor", d: "answers in one of 5 styles" },
];

// Situation → who is on the call. tone drives the pill colour.
const WHO = [
  { sit: "Talk through the event and build the brief", who: "Intake Agent", tone: "brand" },
  { sit: "Cold outbound call to a vendor", who: "Negotiation Agent", tone: "brand" },
  { sit: "The voice on the other end of the line", who: "Counterparty style (sim) · real vendor (live)", tone: "" },
  { sit: "Vendor won't give a number / stonewalls", who: "Negotiation Agent — asks for a weekday range", tone: "brand" },
  { sit: "Quote crosses the category budget", who: "You — “Pull Me In” handoff", tone: "warn" },
  { sit: "Vendor reveals they're a solo operator", who: "Negotiation Agent — reclassifies, switches levers", tone: "brand" },
];

// The 5 deterministic vendor personalities the caller has to read and adapt to.
const COUNTERPARTIES = [
  { key: "flexible", tag: "Flexible", d: "Gives ground to genuine reasons — especially relationship and repeat business. Often a solo operator who reveals themselves mid-call, cueing a reclassify.", win: "relationship", never: "" },
  { key: "lowballer", tag: "Lowballer", d: "The headline looks cheap, but it's a mirage — the real total is the sticker plus setup and service fees that only surface when you ask.", win: "fee challenge", never: "" },
  { key: "upseller", tag: "Upseller", d: "Would rather add than discount — answers a price question with an upgrade, and bundles fees into “packages.”", win: "scope trim", never: "" },
  { key: "hard", tag: "Hard", d: "Firm. Moves only to levers that lower their cost or fill a gap — a weekday slot, a real competing bid. Concedes a slice, never the room.", win: "competing bid", never: "volume · urgency" },
  { key: "stonewaller", tag: "Stonewaller", d: "Won't quote at first, then cracks — but only to genuine leverage, and less than the others.", win: "weekday slot", never: "" },
];

const INTEGRATIONS = [
  { name: "ElevenLabs Agents", tag: "voice",
    what: "The conversational brain. A voice studio runs the event intake, and outbound agents run each negotiation call — then call back into our /api/agent-tools/* webhooks to log quotes and move prices live.",
    keys: ["ELEVENLABS_API_KEY", "agent + intake agent IDs", "phone number ID"] },
  { name: "Twilio", tag: "telephony",
    what: "The phone line linked to the ElevenLabs agent dials real vendors over the PSTN and streams recordings back. Without it, calls run on the deterministic counterparty engine.",
    keys: ["ACCOUNT_SID", "AUTH_TOKEN", "FROM_NUMBER"] },
  { name: "Google Places", tag: "discovery",
    what: "Pulls real vendors for the event's city and category, then classifies each into a pricing segment. Falls back to a seeded 86-vendor market so discovery always works.",
    keys: ["GOOGLE_PLACES_API_KEY"] },
  { name: "Anthropic", tag: "reasoning",
    what: "Reads photographed briefs via Claude vision (haiku) when tesseract can't, and can voice richer counterparty dialogue. Everything degrades to templates/OCR when absent.",
    keys: ["ANTHROPIC_API_KEY"] },
];

const TECH = [
  { t: "FastAPI + SQLite", d: "Typed routers, SQLAlchemy 2.0 models, stdlib-JWT auth. Zero heavyweight deps." },
  { t: "Live event bus", d: "In-process async bus with sequenced, bounded per-campaign queues; a WebSocket streams every call, quote and price move to the command center." },
  { t: "Config-not-code", d: "Four YAML layers — events, categories, segments, regions — merged with conflict rules and hot-reloaded. Behaviour is data, not branches." },
  { t: "Negotiation engines", d: "Leverage (only verified, segment-weighted levers), a deterministic counterparty simulator, a segment classifier, a budget guard and a red-flag detector." },
  { t: "Simulation-first", d: "With no keys the whole flow runs on the counterparty engine — record the demo fully offline, then drop in keys to go live." },
  { t: "React + Vite front end", d: "TypeScript + Tailwind, a WebSocket live dashboard, dependency-free SVG charts and multi-currency display (USD base, FX at render)." },
];

export default function Overview() {
  const [fields, setFields] = useState<Record<string, any>>({});
  useEffect(() => {
    clearTheme();
    api.settingsKeys()
      .then((d) => setFields(Object.fromEntries((d.fields || []).map((f: any) => [f.key, f]))))
      .catch(() => {});
  }, []);

  const agentLink = (a: typeof AGENTS[number]) => {
    const id = (fields[a.idField]?.preview || (a.fallback && fields[a.fallback]?.preview) || "").trim();
    return { id, href: id ? `${EL_CONVAI}/agents/${id}` : EL_CONVAI };
  };

  return (
    <div className="container wide">
      <div className="overview-cols">
        <div className="ov-main">
          <div className="section-eyebrow">Overview</div>
          <h1>SayWhen</h1>
          <p className="sub" style={{ maxWidth: 640 }}>
            A fleet of voice agents that calls event vendors and negotiates on your behalf — venues,
            catering, florals, photo, music and more. Real connectors are wired in but key-gated, so the
            whole thing runs in <b>simulation</b> with zero keys. Paste your own keys on the right to go live.
          </p>

          <h2 style={{ marginTop: 30 }}>The pipeline</h2>
          <p className="small" style={{ maxWidth: 620, marginTop: -4, marginBottom: 4 }}>
            Five stages from a spoken idea to a negotiated estimate. Each stage names the connector or engine that powers it.
          </p>
          <div className="pipeline">
            {PIPELINE.map((s) => (
              <div key={s.n} className="pipe-step">
                <div className="pipe-n">{s.n}</div>
                <div className="min-w-0">
                  <div className="pipe-t">{s.t}</div>
                  <div className="small">{s.d}</div>
                  <div className="pipe-via mono">{s.via}</div>
                </div>
              </div>
            ))}
          </div>

          <h2 style={{ marginTop: 34 }}>Agents</h2>
          <p className="small" style={{ maxWidth: 620, marginTop: -4, marginBottom: 4 }}>
            Two ElevenLabs Convai agents drive the app. Link yours in the keys panel and they open here.
          </p>
          <div className="ov-grid">
            {AGENTS.map((a) => {
              const { id, href } = agentLink(a);
              return (
                <div key={a.name} className="card pad agent-card">
                  <div className="integration-head">
                    <div>
                      <h3 style={{ margin: 0 }}>{a.name}</h3>
                      <div className="small">{a.role}</div>
                    </div>
                    <span className={`chip ${id ? "live" : ""}`}>{id ? "● linked" : "○ not linked"}</span>
                  </div>
                  <p className="integration-what">{a.what}</p>
                  <div className="agent-tools">
                    {a.tools.map((t) => <span key={t} className="mono keycap">{t}</span>)}
                  </div>
                  <div className="agent-foot">
                    {id ? <span className="mono small agent-id" title={id}>{id}</span>
                        : <span className="small">Add its agent ID →</span>}
                    <a className="btn ghost sm" href={href} target="_blank" rel="noreferrer">
                      {id ? "Open in ElevenLabs ↗" : "ElevenLabs Convai ↗"}
                    </a>
                  </div>
                </div>
              );
            })}
          </div>

          <h2 style={{ marginTop: 34 }}>How they work together</h2>
          <p className="small" style={{ maxWidth: 620, marginTop: -4, marginBottom: 4 }}>
            One voice agent builds the brief; another works the phones. On every vendor call the
            negotiation agent leads, and hands back to you only when a price crosses your budget.
          </p>
          <div className="agent-flow">
            {FLOW.map((f, i) => (
              <Fragment key={f.t}>
                <div className="flow-node">
                  <div className="flow-ic">{f.icon}</div>
                  <div className="flow-t">{f.t}</div>
                  <div className="flow-d small">{f.d}</div>
                </div>
                {i < FLOW.length - 1 && <div className="flow-arrow">→</div>}
              </Fragment>
            ))}
          </div>
          <div className="flow-branches">
            <span className="flow-branch warn">↳ budget breach → <b>You</b> (Pull Me In)</span>
            <span className="flow-branch">↳ vendor reveal → <b>reclassify</b> → fresh levers</span>
          </div>

          <h3 style={{ marginTop: 24 }}>Who takes the call — and when</h3>
          <div className="who-list">
            {WHO.map((w) => (
              <div key={w.sit} className="who-row">
                <span className="who-sit">{w.sit}</span>
                <span className={`who-agent ${w.tone}`}>{w.who}</span>
              </div>
            ))}
          </div>

          <h3 style={{ marginTop: 24 }}>The other side of the line — 5 counterparty styles</h3>
          <p className="small" style={{ maxWidth: 620, marginTop: -4, marginBottom: 4 }}>
            In simulation these deterministic personalities play the vendor; live, a real vendor answers.
            Each rewards different leverage — reading which is the caller's whole job.
          </p>
          <div className="ov-grid">
            {COUNTERPARTIES.map((c) => (
              <div key={c.key} className="card pad cp-card">
                <div className="cp-head">
                  <span className={`cp-badge cp-${c.key}`}>{c.tag[0]}</span>
                  <h3 style={{ margin: 0 }}>{c.tag}</h3>
                </div>
                <p className="integration-what">{c.d}</p>
                <div className="cp-levers">
                  <span className="keycap good">moves to · {c.win}</span>
                  {c.never && <span className="keycap bad">never · {c.never}</span>}
                </div>
              </div>
            ))}
          </div>

          <h2 style={{ marginTop: 34 }}>Integrations</h2>
          <div className="ov-grid">
            {INTEGRATIONS.map((it) => (
              <div key={it.name} className="card pad integration">
                <div className="integration-head">
                  <h3 style={{ margin: 0 }}>{it.name}</h3>
                  <span className="chip">{it.tag}</span>
                </div>
                <p className="integration-what">{it.what}</p>
                <div className="integration-keys">
                  {it.keys.map((k) => <span key={k} className="mono keycap">{k}</span>)}
                </div>
              </div>
            ))}
          </div>

          <h2 style={{ marginTop: 34 }}>Technical implementation</h2>
          <div className="ov-grid">
            {TECH.map((t) => (
              <div key={t.t} className="card pad">
                <h3>{t.t}</h3>
                <div className="small">{t.d}</div>
              </div>
            ))}
          </div>

          <div className="banner" style={{ marginTop: 28 }}>
            Everything you see is either real or a faithful simulation — no mock screens. Keys turn the
            simulation into live calls, live discovery and live document reading, one provider at a time.
          </div>
        </div>

        <aside className="ov-right">
          <div className="card pad"><KeysPanel /></div>
        </aside>
      </div>
    </div>
  );
}
